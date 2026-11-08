const fs = require("fs");
const path = require("path");
const { connectLambda, getStore } = require("@netlify/blobs");
const serverless = require("serverless-http");
const { app, getDatabaseSnapshot, initializeDatabase } = require("../../server");

const localDevelopment = process.env.NETLIFY_LOCAL === "true";
const databasePath = localDevelopment
  ? path.join(__dirname, "..", "..", "data", "netlify-dev.db")
  : path.join("/tmp", "gather-social", "social.db");
let store;
const runExpress = serverless(app);
let initialization;

async function initializeFromBlob() {
  const savedDatabase = store
    ? await store.get("social.db", { type: "arrayBuffer" })
    : fs.existsSync(databasePath) ? fs.readFileSync(databasePath) : null;
  if (savedDatabase) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, Buffer.from(savedDatabase));
  }
  await initializeDatabase({ databasePath });
  if (!savedDatabase && store) {
    await store.set("social.db", new Blob([getDatabaseSnapshot()]));
  }
}

exports.handler = async (event, context) => {
  if (!localDevelopment) {
    connectLambda(event);
    store ||= getStore("gather-social-database");
  }
  initialization ||= initializeFromBlob();
  await initialization;

  const requestEvent = { ...event, headers: { ...event.headers } };
  if (requestEvent.body) {
    const body = requestEvent.isBase64Encoded
      ? Buffer.from(requestEvent.body, "base64")
      : Buffer.from(requestEvent.body);
    for (const header of Object.keys(requestEvent.headers)) {
      if (header.toLowerCase() === "content-length") delete requestEvent.headers[header];
    }
    requestEvent.headers["content-length"] = String(body.length);
  }
  const response = await runExpress(requestEvent, context);
  if (store && event.httpMethod !== "GET" && event.httpMethod !== "HEAD" && event.httpMethod !== "OPTIONS") {
    await store.set("social.db", new Blob([getDatabaseSnapshot()]));
  }
  return response;
};
