const functions = require("@google-cloud/functions-framework");
const axios = require("axios");
const base64url = require("base64url");
const jwt = require("jsonwebtoken");
const getCountryISO2 = require("country-iso-3-to-2");

const WEBHOOK_URL = "https://hooks.slack.com/services/xxxxxxxxxxx/xxxxxx"; // CHANGE HERE

const isDiscord = WEBHOOK_URL.includes("discord.com/"); // DECIDES SLACK OR DISCORD VIA URL

const decodeRawEvent = (signedPayload) => {
  if (!signedPayload?.includes(".")) throw new Error("invalid signedPayload");

  let event;
  try {
    event = JSON.parse(base64url.decode(signedPayload.split(".")[1]));
  } catch (error) {
    throw new Error("decode event" + error.message);
  }

  if (event?.data?.signedTransactionInfo) {
    const transactionInfo = jwt.decode(event.data.signedTransactionInfo);
    if (transactionInfo.originalTransactionId) {
      event.data.transactionInfo = transactionInfo;
      delete event?.data?.signedTransactionInfo;
    }
  }

  if (event?.data?.signedRenewalInfo) {
    const renewalInfo = jwt.decode(event.data.signedRenewalInfo);
    if (renewalInfo.originalTransactionId) {
      event.data.renewalInfo = renewalInfo;
      delete event?.data?.signedRenewalInfo;
    }
  }

  return event;
};

const slackMessage = ({title, items = [], subItems = [], appAppleId, bundleId}) => {
  const item = ({name, value}) => `*${name}:* ${value || ""}`;

  return {
    text: title,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*<https://apps.apple.com/tr/app/id${appAppleId}|${bundleId}>*\n` +
            items
              .filter(({value}) => Boolean(value))
              .map(item)
              .join("\n")
        },
        accessory: {
          type: "image",
          image_url:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/App_Store_%28iOS%29.svg/512px-App_Store_%28iOS%29.svg.png",
          alt_text: "App Store"
        }
      },
      {
        type: "divider"
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: subItems
              .filter(({value}) => Boolean(value))
              .map(item)
              .join("\n")
          }
        ]
      },
      {
        type: "divider"
      }
    ]
  };
};

const discordMessage = ({title, items = [], subItems = [], appAppleId, bundleId}) => {
  const item = ({name, value}) => `${name}: ${value || ""}`;

  return {
    username: "IAP Events",
    content: title,
    embeds: [
      {
        title: bundleId,
        url: `https://apps.apple.com/tr/app/id${appAppleId}`,
        color: 15258703,
        fields: items.filter((e) => Boolean(e.value)),
        thumbnail: {
          url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/App_Store_%28iOS%29.svg/512px-App_Store_%28iOS%29.svg.png"
        },
        footer: {
          text: subItems
            .filter(({value}) => Boolean(value))
            .map(item)
            .join("\n")
        }
      }
    ]
  };
};

functions.http("main", async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end("Only POST method is accepted");
    return;
  }

  try {
    const {notificationType, subtype, data} = decodeRawEvent(req.body.signedPayload); // https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2decodedpayload
    const {transactionInfo, appAppleId, bundleId} = data;
    const flagEmoji = `:flag${isDiscord ? "_" : "-"}${getCountryISO2(transactionInfo?.storefront)?.toLowerCase()}:`;

    const price = typeof transactionInfo.price === "number" ? String(transactionInfo.price / 1000) : ""; //https://developer.apple.com/documentation/appstoreservernotifications/price

    const priceWithCurrency = `${price} ${transactionInfo.currency}`;

    const title = `💵 ${isDiscord ? "" : flagEmoji} ${notificationType || ""} ${priceWithCurrency} 🔔`;
    const items = [
      {name: "Event", value: notificationType},
      {name: "Event Subtype", value: subtype},
      {name: "Product", value: transactionInfo?.productId},
      {name: "Country", value: `${flagEmoji} ${transactionInfo?.storefront}`},
      {name: "Price", value: ":dollar: " + priceWithCurrency}
    ];
    const subItems = [
      {name: "Environment", value: transactionInfo?.environment},
      {name: "ID", value: transactionInfo?.originalTransactionId},
      {name: "Type", value: transactionInfo?.type},
      {name: "Expires Date", value: new Date(transactionInfo?.expiresDate).toISOString()}
    ];

    const payload = {title, items, subItems, appAppleId, bundleId};
    await axios.post(WEBHOOK_URL, isDiscord ? discordMessage(payload) : slackMessage(payload));

    res.status(200).send("Notification sent successfully");
  } catch (error) {
    console.error("Error sending notification", error);
    res.status(500).send("Internal Server Error");
  }
});
