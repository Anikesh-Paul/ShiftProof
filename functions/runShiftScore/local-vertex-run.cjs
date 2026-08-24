/**
 * Invoke runShiftScore locally on Vertex. Does not deploy.
 * SHIFTPROOF_LOCAL_DRY_RUN=1 skips checklist/findings/job writes.
 *
 *   node functions/runShiftScore/local-vertex-run.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client, TablesDB, Query } = require("node-appwrite");

function loadDotEnv() {
  const filePath = path.resolve(__dirname, "..", "..", ".env");
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function applyEnv(fileEnv, { forceModel } = {}) {
  for (const [k, v] of Object.entries(fileEnv)) {
    if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
  }
  process.env.GEMINI_PROVIDER = "vertex";
  process.env.SHIFTPROOF_LOCAL_DRY_RUN = "1";
  if (forceModel) process.env.GEMINI_FORCE_SCORING_MODEL = forceModel;
  delete process.env.ALLOW_DEMO_STUB_SCORES;
}

function invoke(handler, body, { quiet } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    handler({
      req: { body: JSON.stringify(body) },
      res: {
        json(data, status) {
          finish({ status: status || 200, data });
          return data;
        },
      },
      log: (m) => {
        if (!quiet) console.log(`[runShiftScore] ${m}`);
      },
      error: (m) => console.error(`[runShiftScore:error] ${m}`),
    }).then((returned) => {
      if (!settled) finish({ status: 200, data: returned });
    }, reject);
  });
}

function parseArgs(argv) {
  const out = { times: 1, force37: false, extract: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--score-37") {
      out.force37 = true;
      out.extract = false;
    } else if (a === "--times") {
      out.times = Math.max(1, Number(argv[++i]) || 1);
    } else if (a === "--extract") {
      out.extract = true;
    }
  }
  return out;
}

async function pickShift(tables) {
  const listed = await tables.listRows({
    databaseId: "shiftproof",
    tableId: "shifts",
    queries: [Query.limit(25), Query.orderDesc("$createdAt")],
  });
  const scored = [];
  for (const row of listed.rows || []) {
    if (String(row.$id).startsWith("golden_")) continue;
    let photos = [];
    try {
      photos = JSON.parse(row.photoFileIds || "[]");
    } catch {
      photos = [];
    }
    const n = Array.isArray(photos) ? photos.filter(Boolean).length : 0;
    if (n > 0) scored.push({ id: row.$id, status: row.status, photos: n });
  }
  scored.sort((a, b) => b.photos - a.photos);
  return scored[0] || null;
}

async function main() {
  const args = parseArgs(process.argv);
  const fileEnv = loadDotEnv();
  applyEnv(fileEnv, {
    forceModel: args.force37 ? "gemini-3.7-flash" : "",
  });
  if (!String(process.env.VERTEX_API_KEY || "").trim()) {
    console.error("VERTEX_API_KEY missing in .env");
    process.exit(2);
  }

  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  const tables = new TablesDB(client);
  const shift = await pickShift(tables);
  if (!shift) {
    console.error("No non-golden shift with photos found");
    process.exit(1);
  }

  const handler = require("./src/main.js");
  console.log(
    JSON.stringify({
      provider: process.env.GEMINI_PROVIDER,
      dryRun: process.env.SHIFTPROOF_LOCAL_DRY_RUN,
      forceModel: process.env.GEMINI_FORCE_SCORING_MODEL || null,
      times: args.times,
      shift,
    }),
  );

  if (args.extract) {
    console.log("--- extract ---");
    const extract = await invoke(handler, { action: "extract" });
    console.log(JSON.stringify(extract, null, 2));
    if (!(extract.status === 200 && extract.data && extract.data.ok)) {
      process.exit(1);
    }
  }

  const quiet = args.times > 1;
  const rows = [];
  for (let i = 1; i <= args.times; i++) {
    const started = Date.now();
    const score = await invoke(handler, { shiftId: shift.id }, { quiet });
    const ms = Date.now() - started;
    const data = score.data || {};
    const ok =
      score.status === 200 &&
      data.ok === true &&
      (!args.force37 || data.model === "gemini-3.7-flash");
    const row = {
      n: i,
      ok,
      http: score.status,
      ms,
      model: data.model || null,
      findings: data.findingCount || 0,
      photos: data.photoCountUsed || 0,
      error: data.error ? String(data.error).slice(0, 160) : null,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }

  const passed = rows.filter((r) => r.ok).length;
  const failed = rows.length - passed;
  const times = rows.map((r) => r.ms);
  const summary = {
    passed,
    failed,
    total: rows.length,
    msMin: Math.min(...times),
    msMax: Math.max(...times),
    msAvg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    models: [...new Set(rows.map((r) => r.model).filter(Boolean))],
  };
  console.log("--- summary ---");
  console.log(JSON.stringify(summary));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
