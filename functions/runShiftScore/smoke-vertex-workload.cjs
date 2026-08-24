/**
 * Local 3.7 Flash workload check (not pong). Does not deploy.
 * Extract: HIGH thinking + SOP PDF (the path that starts on 3.7).
 * Score: MEDIUM thinking + photos (the path that 503'd on AI Studio).
 *
 *   node functions/runShiftScore/smoke-vertex-workload.cjs
 *   node functions/runShiftScore/smoke-vertex-workload.cjs --studio
 */
const fs = require("node:fs");
const path = require("node:path");
const { geminiRequestTarget } = require("./src/geminiClient");
const { thinkingConfigFor } = require("./src/thinking");

const ATTEMPT_MS = 60_000;
const ROOT = path.resolve(__dirname, "..", "..");

function loadDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

function filePart(filePath, mime) {
  const data = fs.readFileSync(filePath).toString("base64");
  return { inline_data: { mime_type: mime, data } };
}

function visibleText(data) {
  const parts =
    (data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts) ||
    [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text || "")
    .join("")
    .trim();
}

async function callOnce({ env, model, prompt, imageParts, thinkingLevel, label }) {
  const target = geminiRequestTarget({ model, env });
  const thinkingConfig = thinkingConfigFor(model, thinkingLevel);
  const generationConfig = {
    temperature: 0.2,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
  };
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;

  const started = Date.now();
  let resp;
  try {
    resp = await fetch(target.url, {
      method: "POST",
      headers: target.headers,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(ATTEMPT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      label,
      provider: target.provider,
      model,
      think: thinkingLevel,
      images: imageParts.length,
      ms: Date.now() - started,
      http: timedOut ? "timeout" : "fetch-error",
      error: timedOut ? `aborted after ${ATTEMPT_MS}ms` : String(err.message || err),
    };
  }

  const raw = await resp.text();
  const ms = Date.now() - started;
  if (!resp.ok) {
    return {
      label,
      provider: target.provider,
      model,
      think: thinkingLevel,
      images: imageParts.length,
      ms,
      http: resp.status,
      error: raw.slice(0, 400).replace(/\s+/g, " "),
    };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return {
      label,
      provider: target.provider,
      model,
      think: thinkingLevel,
      images: imageParts.length,
      ms,
      http: resp.status,
      error: "response not JSON",
    };
  }

  const cand = data.candidates && data.candidates[0];
  const text = visibleText(data);
  let jsonOk = false;
  try {
    const parsed = JSON.parse(text);
    jsonOk = Boolean(parsed && (parsed.items || parsed.id));
  } catch {
    jsonOk = text.includes("{") && text.includes("items");
  }

  const usage = data.usageMetadata || {};
  return {
    label,
    provider: target.provider,
    model,
    think: thinkingLevel,
    images: imageParts.length,
    ms,
    http: resp.status,
    finish: cand && cand.finishReason,
    thoughts: usage.thoughtsTokenCount || 0,
    outTokens: usage.candidatesTokenCount || 0,
    textChars: text.length,
    jsonOk,
    preview: text.slice(0, 120).replace(/\s+/g, " "),
  };
}

async function main() {
  const fileEnv = loadDotEnv(path.join(ROOT, ".env"));
  const useStudio = process.argv.includes("--studio");
  const env = useStudio
    ? { ...fileEnv, GEMINI_PROVIDER: "studio" }
    : { ...fileEnv, GEMINI_PROVIDER: "vertex" };

  if (!useStudio && !String(env.VERTEX_API_KEY || "").trim()) {
    console.error("VERTEX_API_KEY missing in .env");
    process.exit(2);
  }
  if (useStudio && !String(env.GOOGLE_AI_API_KEY || "").trim()) {
    console.error("GOOGLE_AI_API_KEY missing in .env");
    process.exit(2);
  }

  const extractPrompt = `You extract the café opening check from this SOP PDF.

Return ONLY valid JSON (no markdown fences):
{ "items": [ { "clause_id": "FS-01", "label": "short photo-provable opening question", "quote": "short verbatim quote from the SOP" } ] }

Rules:
1. Only photo-provable café-opening rules — something a photo at open can prove.
2. At most 8 items.
3. If fewer than 3 photo-provable opening rules exist, return { "items": [] }.`;

  const scorePrompt = `You are a food-safety compliance scorer. Score EVERY checklist item using ONLY the attached evidence photos.
Return ONLY valid JSON: { "items": [ { "id": "gloves", "status": "pass"|"gap"|"unclear", "confidence": 0.8, "evidence_note": "what is visible" } ] }
Include exactly one object per id: gloves, handwash.`;

  const pdf = filePart(
    path.join(ROOT, "demo", "cafe-sop-extract-test.pdf"),
    "application/pdf",
  );
  const photos = [
    filePart(path.join(ROOT, "demo", "photos", "pass", "FS-01-gloves-worn.jpg"), "image/jpeg"),
    filePart(path.join(ROOT, "demo", "photos", "pass", "FS-02-handwash-stocked.jpg"), "image/jpeg"),
    filePart(path.join(ROOT, "demo", "photos", "pass", "FS-03-sanitizer-filled.jpg"), "image/jpeg"),
    filePart(path.join(ROOT, "demo", "photos", "pass", "FS-04-counter-clean.jpg"), "image/jpeg"),
  ];

  const jobs = [
    {
      label: "extract-HIGH-pdf",
      prompt: extractPrompt,
      imageParts: [pdf],
      thinkingLevel: "HIGH",
    },
    {
      label: "score-MEDIUM-4photos",
      prompt: scorePrompt,
      imageParts: photos,
      thinkingLevel: "MEDIUM",
    },
  ];

  let failed = 0;
  for (const job of jobs) {
    const result = await callOnce({
      env,
      model: "gemini-3.7-flash",
      ...job,
    });
    console.log(JSON.stringify(result));
    if (result.http !== 200 || !result.jsonOk) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
