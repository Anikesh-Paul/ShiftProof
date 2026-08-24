/**
 * Cloud health check: Vertex models + live runShiftScore execution.
 *   node functions/runShiftScore/test-cloud.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client, TablesDB, Functions, ID } = require("node-appwrite");
const { geminiRequestTarget } = require("./src/geminiClient");
const { thinkingConfigFor } = require("./src/thinking");

const ROOT = path.resolve(__dirname, "..", "..");
const MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
];
const SHIFT_ID = "6a868f70002c0b9be30e";

function loadDotEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.indexOf("=") < 1) continue;
    const i = t.indexOf("=");
    let value = t.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = value;
  }
  return env;
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

async function pingModel(env, model) {
  const target = geminiRequestTarget({
    model,
    env: { ...env, GEMINI_PROVIDER: "vertex" },
  });
  const thinkingConfig = thinkingConfigFor(model, "MEDIUM");
  const started = Date.now();
  let resp;
  try {
    resp = await fetch(target.url, {
      method: "POST",
      headers: target.headers,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: 'Reply with JSON only: {"pong":true}' }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 256,
          responseMimeType: "application/json",
          thinkingConfig,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    return {
      model,
      ok: false,
      http: err.name === "TimeoutError" || err.name === "AbortError" ? "timeout" : "fetch-error",
      ms: Date.now() - started,
      error: String(err.message || err).slice(0, 200),
    };
  }
  const raw = await resp.text();
  const ms = Date.now() - started;
  if (!resp.ok) {
    return {
      model,
      ok: false,
      http: resp.status,
      ms,
      error: raw.slice(0, 240).replace(/\s+/g, " "),
    };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { model, ok: false, http: resp.status, ms, error: "response not JSON" };
  }
  const text = visibleText(data);
  return {
    model,
    ok: /pong/i.test(text),
    http: resp.status,
    ms,
    preview: text.slice(0, 80).replace(/\s+/g, " "),
  };
}

async function liveScore(env) {
  const client = new Client()
    .setEndpoint(env.APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
  const tables = new TablesDB(client);
  const functions = new Functions(client);
  const job = await tables.createRow({
    databaseId: "shiftproof",
    tableId: "agent_jobs",
    rowId: ID.unique(),
    data: {
      shiftId: SHIFT_ID,
      status: "waiting",
      startedAt: null,
      errorMessage: null,
      finishedAt: null,
      traceJson: null,
    },
  });
  const started = Date.now();
  const execution = await functions.createExecution({
    functionId: "runShiftScore",
    body: JSON.stringify({ shiftId: SHIFT_ID, jobId: job.$id }),
    async: false,
    path: "/",
    method: "POST",
  });
  let jobAfter = null;
  try {
    jobAfter = await tables.getRow({
      databaseId: "shiftproof",
      tableId: "agent_jobs",
      rowId: job.$id,
    });
  } catch {
    jobAfter = null;
  }
  let trace = null;
  try {
    trace = jobAfter && jobAfter.traceJson ? JSON.parse(jobAfter.traceJson) : null;
  } catch {
    trace = jobAfter && jobAfter.traceJson;
  }
  return {
    ms: Date.now() - started,
    executionStatus: execution.status,
    responseStatus: execution.responseStatusCode,
    logs: String(execution.logs || "")
      .split(/\r?\n/)
      .filter(Boolean),
    errors: String(execution.errors || "").slice(0, 400),
    responseBody: String(execution.responseBody || "").slice(0, 500),
    jobStatus: jobAfter && jobAfter.status,
    jobError: jobAfter && jobAfter.errorMessage,
    trace,
  };
}

async function main() {
  const env = loadDotEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }
  console.log("--- vertex model pings ---");
  const pings = [];
  for (const model of MODELS) {
    const row = await pingModel(env, model);
    pings.push(row);
    console.log(JSON.stringify(row));
  }
  console.log("--- live runShiftScore score ---");
  const live = await liveScore(env);
  console.log(JSON.stringify(live, null, 2));
  const functionOk =
    live.executionStatus === "completed" &&
    live.responseStatus === 200 &&
    live.jobStatus === "done";
  const liteOk = pings.find((p) => p.model === "gemini-3.5-flash-lite")?.ok;
  const flash35Ok = pings.find((p) => p.model === "gemini-3.5-flash")?.ok;
  console.log("--- summary ---");
  console.log(
    JSON.stringify({
      functionOk,
      vertex35Flash: Boolean(flash35Ok),
      vertex35FlashLite: Boolean(liteOk),
      liveModel: live.trace && live.trace.model,
      liveMode: live.trace && live.trace.mode,
    }),
  );
  process.exit(functionOk ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
