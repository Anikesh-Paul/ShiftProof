/**
 * Server-key Agent-job seeding for e2e failure-state tests — the database is
 * the app's external contract (spec: Testing Decisions). Reuses the demo-script
 * pattern: root .env service-role key + node-appwrite shipped in the
 * runShiftScore function's node_modules. Never logs secrets.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const NODE_APPWRITE = join(
  REPO_ROOT,
  "functions",
  "runShiftScore",
  "node_modules",
  "node-appwrite",
);

export type SeedJobStatus = "waiting" | "running" | "done" | "failed";

const DB = "shiftproof";
const STAFF_USER_ID = "demo_staff";

function loadEnv(): Record<string, string> {
  const map: Record<string, string> = {};
  const envPath = join(REPO_ROOT, ".env");
  if (!existsSync(envPath)) return map;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    map[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return map;
}

/** Suite skips seeding tests gracefully when the server key is absent. */
export function hasServerKey(): boolean {
  try {
    if (!existsSync(NODE_APPWRITE)) return false;
    return Boolean(loadEnv().APPWRITE_API_KEY);
  } catch {
    return false;
  }
}

let server: ReturnType<typeof connect> | null = null;

function connect() {
  const { Client, TablesDB, Functions } = require(NODE_APPWRITE);
  const env = loadEnv();
  const client = new Client()
    .setEndpoint(env.APPWRITE_ENDPOINT || "https://sgp.cloud.appwrite.io/v1")
    .setProject(env.APPWRITE_PROJECT_ID || "6a5b0ce3002605c7a776")
    .setKey(env.APPWRITE_API_KEY);
  return {
    tables: new TablesDB(client),
    functions: new Functions(client),
  };
}

function sdk() {
  if (!hasServerKey()) {
    throw new Error("server key unavailable — guard tests with hasServerKey()");
  }
  server ??= connect();
  return server;
}

/** Seed a draft Shift owned by the demo staff user. */
export async function seedDraftShift(
  opts: { photoFileIds?: string[] } = {},
): Promise<string> {
  const { tables } = sdk();
  const { ID } = require(NODE_APPWRITE);
  const now = new Date().toISOString();
  const row = await tables.createRow({
    databaseId: DB,
    tableId: "shifts",
    rowId: ID.unique(),
    data: {
      siteId: "demo_cafe",
      checklistId: "opening_fs",
      createdBy: STAFF_USER_ID,
      status: "draft",
      photoFileIds: JSON.stringify(opts.photoFileIds ?? []),
      startedAt: now,
    },
    permissions: [
      'read("users")',
      `update("user:${STAFF_USER_ID}")`,
      `delete("user:${STAFF_USER_ID}")`,
    ],
  });
  return row.$id as string;
}

/** Draft ids for the demo staff user, newest first. */
export async function listStaffDraftIds(): Promise<string[]> {
  const { tables } = sdk();
  const { Query } = require(NODE_APPWRITE);
  const result = await tables.listRows({
    databaseId: DB,
    tableId: "shifts",
    queries: [
      Query.equal("createdBy", STAFF_USER_ID),
      Query.equal("status", "draft"),
      Query.orderDesc("startedAt"),
      Query.limit(100),
    ],
  });
  return (result.rows ?? []).map((row: { $id: string }) => row.$id);
}

/** Seed a submitted Shift owned by the demo staff user. */
export async function seedSubmittedShift(
  opts: { submittedAt?: string; photoFileIds?: string[] } = {},
): Promise<string> {
  const { tables } = sdk();
  const { ID } = require(NODE_APPWRITE);
  const submittedAt = opts.submittedAt ?? new Date().toISOString();
  const row = await tables.createRow({
    databaseId: DB,
    tableId: "shifts",
    rowId: ID.unique(),
    data: {
      siteId: "demo_cafe",
      checklistId: "opening_fs",
      createdBy: STAFF_USER_ID,
      status: "submitted",
      photoFileIds: JSON.stringify(opts.photoFileIds ?? []),
      startedAt: submittedAt,
      submittedAt,
    },
    permissions: [
      'read("users")',
      `update("user:${STAFF_USER_ID}")`,
      `delete("user:${STAFF_USER_ID}")`,
    ],
  });
  return row.$id as string;
}

export async function seedAgentJob(
  shiftId: string,
  status: SeedJobStatus,
  opts: { errorMessage?: string } = {},
): Promise<string> {
  const { tables } = sdk();
  const { ID } = require(NODE_APPWRITE);
  const row = await tables.createRow({
    databaseId: DB,
    tableId: "agent_jobs",
    rowId: ID.unique(),
    data: {
      shiftId,
      status,
      startedAt: status === "waiting" ? null : new Date().toISOString(),
      errorMessage: opts.errorMessage ?? null,
      finishedAt:
        status === "done" || status === "failed"
          ? new Date().toISOString()
          : null,
      traceJson: null,
    },
    permissions: ['read("users")'],
  });
  return row.$id as string;
}

export async function setAgentJobStatus(
  jobId: string,
  status: SeedJobStatus,
  opts: { errorMessage?: string } = {},
): Promise<void> {
  const { tables } = sdk();
  await tables.updateRow({
    databaseId: DB,
    tableId: "agent_jobs",
    rowId: jobId,
    data: {
      status,
      errorMessage: opts.errorMessage ?? null,
      finishedAt:
        status === "done" || status === "failed"
          ? new Date().toISOString()
          : null,
    },
  });
}

export async function listJobIdsFor(shiftId: string): Promise<string[]> {
  const { tables } = sdk();
  const { Query } = require(NODE_APPWRITE);
  const result = await tables.listRows({
    databaseId: DB,
    tableId: "agent_jobs",
    queries: [
      Query.equal("shiftId", shiftId),
      Query.orderDesc("$createdAt"),
      Query.limit(25),
    ],
  });
  return (result.rows ?? []).map((row: { $id: string }) => row.$id);
}

export async function getShiftStatus(shiftId: string): Promise<string> {
  const { tables } = sdk();
  const row = await tables.getRow({
    databaseId: DB,
    tableId: "shifts",
    rowId: shiftId,
  });
  return row.status as string;
}

export async function latestJobFor(
  shiftId: string,
): Promise<{ id: string; status: SeedJobStatus } | null> {
  const { tables } = sdk();
  const { Query } = require(NODE_APPWRITE);
  const result = await tables.listRows({
    databaseId: DB,
    tableId: "agent_jobs",
    queries: [
      Query.equal("shiftId", shiftId),
      Query.orderDesc("$createdAt"),
      Query.limit(1),
    ],
  });
  const row = result.rows?.[0];
  return row ? { id: row.$id, status: row.status } : null;
}

/** Seed one Finding so a Scoreboard can appear without live Gemini. */
export async function seedFinding(
  shiftId: string,
  opts: {
    itemId?: string;
    status?: "pass" | "gap" | "unclear";
  } = {},
): Promise<string> {
  const { tables } = sdk();
  const { ID } = require(NODE_APPWRITE);
  const row = await tables.createRow({
    databaseId: DB,
    tableId: "findings",
    rowId: ID.unique(),
    data: {
      shiftId,
      itemId: opts.itemId ?? "gloves_worn",
      status: opts.status ?? "gap",
      clauseId: "FS-01",
      quote: "Food handlers must wear clean disposable gloves at the prep station.",
      confidence: 0.86,
      evidenceNote: "Seeded e2e finding.",
      source: "ai",
    },
    permissions: ['read("users")'],
  });
  return row.$id as string;
}

export async function markShiftScored(shiftId: string): Promise<void> {
  const { tables } = sdk();
  await tables.updateRow({
    databaseId: DB,
    tableId: "shifts",
    rowId: shiftId,
    data: {
      status: "scored",
      scoredAt: new Date().toISOString(),
    },
  });
}

/** Newest runShiftScore execution id — proves Retry re-triggered scoring. */
export async function latestExecutionId(): Promise<string | null> {
  const { functions } = sdk();
  const { Query } = require(NODE_APPWRITE);
  const result = await functions.listExecutions({
    functionId: "runShiftScore",
    queries: [Query.orderDesc("$createdAt"), Query.limit(1)],
  });
  const list = result.executions || result.rows || [];
  return list[0]?.$id ?? null;
}
