/**
 * Local-only Vertex ping. Does not deploy, does not touch Appwrite Function env.
 *
 * 1. Paste the Agent Platform key into VERTEX_API_KEY in repo-root .env
 * 2. From repo root: node functions/runShiftScore/smoke-vertex.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  geminiRequestTarget,
} = require("./src/geminiClient");

function loadDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function main() {
  const envPath = path.resolve(__dirname, "..", "..", ".env");
  const fileEnv = loadDotEnv(envPath);
  const env = { ...fileEnv, GEMINI_PROVIDER: "vertex" };
  const key = String(env.VERTEX_API_KEY || "").trim();
  if (!key || key === "PASTE_VERTEX_API_KEY_HERE") {
    console.error(
      "Paste your Vertex / Agent Platform API key into VERTEX_API_KEY in .env, then re-run:",
    );
    console.error("  node functions/runShiftScore/smoke-vertex.cjs");
    process.exit(2);
  }

  const model = "gemini-3.7-flash";
  const target = geminiRequestTarget({ model, env });
  const safeUrl = target.url.replace(/key=[^&]+/, "key=REDACTED");
  console.log(`provider=${target.provider}`);
  console.log(`model=${model}`);
  console.log(`url=${safeUrl}`);

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: "Reply with the single word: pong" }],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 256,
    },
  };

  const resp = await fetch(target.url, {
    method: "POST",
    headers: target.headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await resp.text();
  console.log(`http=${resp.status}`);
  if (!resp.ok) {
    console.error(raw.slice(0, 800).replace(/\s+/g, " "));
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("Vertex response was not JSON");
    console.error(raw.slice(0, 400));
    process.exit(1);
  }
  const text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  console.log(`text=${text.slice(0, 200) || "(empty)"}`);
  if (!/pong/i.test(text)) {
    console.error("Unexpected reply — Vertex answered but not with pong.");
    process.exit(1);
  }
  console.log("ok: Vertex 3.7 Flash answered. Production is still AI Studio.");
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
