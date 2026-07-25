const fs = require("fs");
const key = fs
  .readFileSync(".env", "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("APPWRITE_API_KEY="))
  .slice("APPWRITE_API_KEY=".length);
const base = "https://sgp.cloud.appwrite.io/v1";
const h = {
  "X-Appwrite-Project": "6a5b0ce3002605c7a776",
  "X-Appwrite-Key": key,
};
const qs = [
  encodeURIComponent('orderDesc("$createdAt")'),
  encodeURIComponent("limit(8)"),
]
  .map((q) => "queries[]=" + q)
  .join("&");
fetch(base + "/tablesdb/shiftproof/tables/agent_jobs/rows?" + qs, { headers: h })
  .then(async (r) => {
    const t = await r.text();
    console.log("status", r.status);
    console.log(t.slice(0, 2000));
  })
  .catch((e) => console.error(e));
