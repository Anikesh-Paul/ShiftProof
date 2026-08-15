/**
 * Appwrite Function: runShiftScore
 * Contract: docs/API.md — input { shiftId, jobId }
 * Recheck: { mode: "recheck", shiftId, findingId, itemId, recheckFileId }
 *
 * Default: Gemini Flash (Google AI Studio) scores Storage photos + checklist
 * → FINDINGS_SCHEMA → findings / job / events.
 *
 * Env (Function settings only — never in frontend):
 *   APPWRITE_FUNCTION_API_ENDPOINT / APPWRITE_ENDPOINT
 *   APPWRITE_FUNCTION_PROJECT_ID / APPWRITE_PROJECT_ID
 *   APPWRITE_API_KEY          (server key: TablesDB + Storage)
 *   GOOGLE_AI_API_KEY         (Google AI Studio — required for default path)
 *   GEMINI_MODEL              (optional, default gemini-flash-latest)
 *   SCORING_DEADLINE_MS       (optional, default 150000; Function timeout is 180s)
 *   ALLOW_DEMO_STUB_SCORES=1  (optional explicit emergency stub only)
 */
const { Client, TablesDB, Storage, ID, Query } = require("node-appwrite");

const DB = "shiftproof";
const EVIDENCE_BUCKET = "evidence";
const T = {
  shifts: "shifts",
  checklists: "checklists",
  findings: "findings",
  agent_jobs: "agent_jobs",
  events: "events",
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const JOB_RUNNABLE = new Set(["waiting", "failed"]);

const GENERIC_BAD_REQUEST = "Invalid request";
const GENERIC_CONFLICT = "Request cannot be processed";
const GENERIC_FAILED = "Scoring failed";

/** Low confidence cannot be silent pass/gap (TC-C3-05). */
const LOW_CONFIDENCE = 0.55;
/** Cap photos sent to the model (timeout + payload). */
const MAX_PHOTOS = 5;
/** Cap base64 chars per image (~1.2MB decoded). Phone originals are compressed on upload. */
const MAX_B64_CHARS = 1_600_000;
/** One Gemini attempt must finish in time to allow a retry inside the Function timeout. */
const GEMINI_ATTEMPT_MS = 45_000;

function scoringDeadlineMs() {
  const n = Number(process.env.SCORING_DEADLINE_MS);
  return Number.isFinite(n) && n > 0 ? n : 150_000;
}

function isValidId(id) {
  return typeof id === "string" && ID_PATTERN.test(id);
}

const CLAUSE_QUOTES = {
  "FS-01": "Food handlers must wear clean disposable gloves at the prep station.",
  "FS-02": "Handwash station must be stocked and accessible before service.",
  "FS-03": "Sanitizer must be available and filled at open.",
  "FS-04": "Food-prep surfaces must be clean and free of debris before service.",
  "FS-05": "Cold storage must show temperature within safe range at open.",
  "FS-06": "Hair restraint must be worn at the food-prep station.",
  "FS-07": "Service floor should be clear of slip hazards at open.",
  "FS-08": "Waste bins must be covered before service.",
};

const ALLOWED_STATUS = new Set(["pass", "gap", "unclear"]);

/** Deterministic stub — only when ALLOW_DEMO_STUB_SCORES=1 (never silent default). */
function scoreItemsStub(items, photoCount) {
  return items.map((item, i) => {
    const clauseId =
      (item.relatedClauseIds && item.relatedClauseIds[0]) ||
      `FS-${String(i + 1).padStart(2, "0")}`;
    const quote = CLAUSE_QUOTES[clauseId] || `Clause ${clauseId} must be met.`;
    let status = "pass";
    let confidence = 0.88;
    let evidence_note = `Photo set (${photoCount}) consistent with ${item.label}.`;
    if (i === 0) {
      status = "gap";
      confidence = 0.84;
      evidence_note = "Visual check suggests non-compliance for this item.";
    } else if (i === 1 || (photoCount < 4 && i === 2)) {
      status = "unclear";
      confidence = 0.42;
      evidence_note = "Ambiguous framing or glare; cannot confirm from evidence.";
    } else if (i === 3 && photoCount < 5) {
      status = "gap";
      confidence = 0.79;
      evidence_note = "Checklist item not clearly evidenced in uploaded photos.";
    }
    return {
      id: item.id,
      status,
      clause_id: clauseId,
      quote,
      confidence,
      evidence_note,
    };
  });
}

function parsePhotoIds(shift) {
  try {
    const ids = JSON.parse(shift.photoFileIds || "[]");
    if (!Array.isArray(ids)) return [];
    return ids
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object" && typeof x.fileId === "string") {
          return x.fileId;
        }
        return "";
      })
      .filter((x) => x);
  } catch {
    return [];
  }
}

function parseChecklistItems(checklist) {
  try {
    const items = JSON.parse(checklist.itemsJson || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/**
 * Download evidence files → Gemini inline_data parts.
 */
async function loadPhotoParts(storage, photoFileIds, log) {
  const parts = [];
  const limited = photoFileIds.slice(0, MAX_PHOTOS);
  for (const fileId of limited) {
    try {
      let mime = "";
      try {
        const meta = await storage.getFile({
          bucketId: EVIDENCE_BUCKET,
          fileId,
        });
        if (meta && meta.mimeType) mime = String(meta.mimeType).toLowerCase();
      } catch {
        /* mime unknown — skip unless we can still whitelist after download */
      }
      if (mime && !ALLOWED_MIME.has(mime)) {
        log(`skip disallowed mime fileId=${fileId} mime=${mime}`);
        continue;
      }
      const buf = await storage.getFileDownload({
        bucketId: EVIDENCE_BUCKET,
        fileId,
      });
      const b64 = Buffer.from(buf).toString("base64");
      if (b64.length > MAX_B64_CHARS) {
        log(`skip oversized photo fileId=${fileId} b64len=${b64.length}`);
        continue;
      }
      if (!b64.length) {
        log(`skip empty photo fileId=${fileId}`);
        continue;
      }
      const resolved = ALLOWED_MIME.has(mime) ? mime : "image/jpeg";
      if (!ALLOWED_MIME.has(resolved)) {
        log(`skip photo fileId=${fileId}: no allowed mime`);
        continue;
      }
      parts.push({
        inline_data: {
          mime_type: resolved,
          data: b64,
        },
      });
    } catch (e) {
      log(`skip photo fileId=${fileId}: ${e.message || e}`);
    }
  }
  return parts;
}

function buildScoringPrompt(items) {
  const checklistForModel = items.map((item, i) => ({
    id: item.id,
    label: item.label || item.id,
    relatedClauseIds: item.relatedClauseIds || [
      `FS-${String(i + 1).padStart(2, "0")}`,
    ],
  }));

  return `You are a food-safety compliance scorer for a single café opening checklist.
Score EVERY checklist item using ONLY the attached evidence photos.

Return ONLY valid JSON (no markdown fences) matching this shape:
{
  "items": [
    {
      "id": "<exact checklist item id>",
      "status": "pass" | "gap" | "unclear",
      "clause_id": "FS-XX",
      "quote": "short SOP clause quote",
      "confidence": 0.0,
      "evidence_note": "what you observe in the photos"
    }
  ]
}

Rules:
1. Include exactly one object per checklist item; use the exact "id" values given.
2. pass — photos clearly support compliance for that item.
3. gap — photos clearly show non-compliance for that item.
4. unclear — evidence missing, ambiguous, dark, cropped, glare, wrong subject, or tiny/placeholder images; also when you are not confident.
5. confidence is honest in [0, 1]. If confidence < ${LOW_CONFIDENCE}, status MUST be "unclear".
6. Prefer clause_id from relatedClauseIds; use the known quotes below when they match.
7. Do not invent objects that are not visible. Prefer unclear over guessing pass.
8. evidence_note must mention what is (or is not) visible — vary notes per item.

Known SOP quotes:
${JSON.stringify(CLAUSE_QUOTES, null, 2)}

Checklist items to score:
${JSON.stringify(checklistForModel, null, 2)}
`;
}

function retryableParseError(message) {
  const err = new Error(message);
  err.retryable = true;
  return err;
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) throw retryableParseError("Empty model text");
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      throw retryableParseError("Model response is not valid JSON");
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw retryableParseError("Model response is not valid JSON");
    }
  }
  throw retryableParseError("Model response is not valid JSON");
}

function isRetryableModelOutputError(err) {
  if (!err) return false;
  if (err.retryable === true) return true;
  const msg = String(err.message || err);
  return /not valid JSON|Empty model text|Gemini response not JSON|Unexpected end of JSON/i.test(
    msg,
  );
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Parse Gemini JSON → FINDINGS_SCHEMA items; fill missing checklist rows; force low conf → unclear.
 */
function normalizeFindings(payload, items) {
  const byId = new Map();
  const list =
    payload && Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload)
        ? payload
        : [];

  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const id = String(row.id || "").trim();
    if (!id) continue;
    let status = String(row.status || "unclear").toLowerCase();
    if (!ALLOWED_STATUS.has(status)) status = "unclear";
    let confidence = clamp01(row.confidence);
    if (confidence < LOW_CONFIDENCE) status = "unclear";
    const idx = items.findIndex((it) => it.id === id);
    const item = idx >= 0 ? items[idx] : null;
    const clauseId =
      String(row.clause_id || "").trim() ||
      (item && item.relatedClauseIds && item.relatedClauseIds[0]) ||
      `FS-${String(Math.max(1, idx + 1)).padStart(2, "0")}`;
    let quote = String(row.quote || "").trim();
    if (!quote) quote = CLAUSE_QUOTES[clauseId] || `Clause ${clauseId} must be met.`;
    let evidence_note = String(row.evidence_note || "").trim();
    if (!evidence_note) {
      evidence_note =
        status === "unclear"
          ? "Insufficient visual evidence to score this item."
          : `Scored from evidence photos for ${item ? item.label : id}.`;
    }
    quote = quote.slice(0, 1000);
    evidence_note = evidence_note.slice(0, 1000);
    byId.set(id, {
      id,
      status,
      clause_id: clauseId.slice(0, 32),
      quote,
      confidence,
      evidence_note,
    });
  }

  const scored = items.map((item, i) => {
    if (byId.has(item.id)) return byId.get(item.id);
    const clauseId =
      (item.relatedClauseIds && item.relatedClauseIds[0]) ||
      `FS-${String(i + 1).padStart(2, "0")}`;
    return {
      id: item.id,
      status: "unclear",
      clause_id: clauseId,
      quote: CLAUSE_QUOTES[clauseId] || `Clause ${clauseId} must be met.`,
      confidence: 0.3,
      evidence_note: "Model omitted this item; marked unclear.",
    };
  });

  return scored;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Transient Gemini errors worth one more try (not silent stub). */
function isRetryableGeminiHttp(status) {
  return status === 429 || status === 503 || status === 500;
}

function isDailyQuotaExhausted(status, body) {
  if (status !== 429) return false;
  const t = String(body || "").toLowerCase();
  return (
    t.includes("perday") ||
    t.includes("requests per day") ||
    t.includes("limit: 0") ||
    t.includes('"limit": 0') ||
    t.includes('"limit":0')
  );
}

function classifyGeminiError(status, body) {
  if (isDailyQuotaExhausted(status, body)) return "quota";
  if (isRetryableGeminiHttp(status)) return "retryable";
  return "fatal";
}

function isThinkingConfigRejected(status, body) {
  if (status !== 400) return false;
  return String(body || "").toLowerCase().includes("thinking");
}

/** 2.5 Flash: thinkingBudget 0. 3.x / flash-latest: MINIMAL (cannot fully disable). */
function thinkingConfigFor(model) {
  const m = String(model || "").toLowerCase();
  if (m.includes("2.5") || m.includes("2.0")) {
    return { thinkingBudget: 0 };
  }
  return { thinkingLevel: "MINIMAL" };
}

function retryDelayMs(status, attempt) {
  if (status === 429) return 12_000;
  if (status === 503) return attempt === 1 ? 5_000 : 12_000;
  return 4_000 * attempt;
}

async function callGeminiFlashOnce({
  apiKey,
  model,
  prompt,
  imageParts,
  log,
  thinkingConfig,
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;

  const parts = [{ text: prompt }, ...imageParts];
  const generationConfig = {
    temperature: 0.2,
    maxOutputTokens: 2048,
    responseMimeType: "application/json",
  };
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  const body = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig,
  };

  log(
    `Gemini request model=${model} images=${imageParts.length} think=${JSON.stringify(thinkingConfig || null)}`,
  );
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GEMINI_ATTEMPT_MS),
  });

  const rawText = await resp.text();
  if (!resp.ok) {
    const err = new Error(
      `Gemini HTTP ${resp.status}: ${rawText.slice(0, 400).replace(/\s+/g, " ")}`,
    );
    err.httpStatus = resp.status;
    err.responseBody = rawText;
    throw err;
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw retryableParseError("Gemini response not JSON");
  }

  const block = data.promptFeedback && data.promptFeedback.blockReason;
  if (block) {
    throw new Error(`Gemini blocked: ${block}`);
  }

  const cand = data.candidates && data.candidates[0];
  if (!cand) {
    throw new Error("Gemini returned no candidates");
  }
  const finish = cand.finishReason;
  if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
    log(`Gemini finishReason=${finish}`);
  }

  const textOut = ((cand.content && cand.content.parts) || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!textOut) {
    throw retryableParseError("Gemini empty text (parse/safety)");
  }
  return textOut;
}

/**
 * Up to 3 attempts on 429/503/500/timeout/parse. Skip daily-quota 429s.
 * Drop thinking config once if Gemini 400s it.
 */
async function callGeminiFlash({ apiKey, model, prompt, imageParts, log }) {
  const maxAttempts = 3;
  const started = Date.now();
  let thinkingConfig = thinkingConfigFor(model);
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const elapsed = Date.now() - started;
    if (elapsed + 8_000 > scoringDeadlineMs()) {
      log(`Gemini abort retry: ${elapsed}ms elapsed, near Function deadline`);
      break;
    }
    try {
      const textOut = await callGeminiFlashOnce({
        apiKey,
        model,
        prompt,
        imageParts,
        log,
        thinkingConfig,
      });
      log(`Gemini response chars=${textOut.length}`);
      return extractJsonObject(textOut);
    } catch (e) {
      lastErr = e;
      const status = e && e.httpStatus;
      const body = (e && e.responseBody) || String(e && e.message) || "";
      const timedOut =
        e && (e.name === "TimeoutError" || e.name === "AbortError");

      if (thinkingConfig && isThinkingConfigRejected(status, body)) {
        log("Gemini rejected thinkingConfig; retrying without it");
        thinkingConfig = null;
        continue;
      }

      if (isDailyQuotaExhausted(status, body)) {
        throw new Error(
          "Gemini daily free quota used (20 RPD). Open golden_gap_open instead of retrying.",
        );
      }

      const retryable =
        timedOut ||
        isRetryableGeminiHttp(status) ||
        isRetryableModelOutputError(e);
      if (attempt < maxAttempts && retryable) {
        const delayMs = retryDelayMs(status || 503, attempt);
        log(
          `Gemini retryable ${
            timedOut
              ? "timeout"
              : isRetryableModelOutputError(e)
                ? "parse"
                : `HTTP ${status}`
          }; attempt ${attempt}/${maxAttempts}; wait ${delayMs}ms`,
        );
        await sleep(delayMs);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("Gemini scoring stopped near Function deadline");
}

async function scoreWithGemini({
  storage,
  items,
  photoFileIds,
  log,
  minFindings = 5,
}) {
  const apiKey = process.env.GOOGLE_AI_API_KEY || "";
  if (!apiKey) {
    throw new Error(
      "GOOGLE_AI_API_KEY not set on Function (Google AI Studio key required)",
    );
  }
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  if (!photoFileIds.length) {
    throw new Error("No evidence photos available");
  }
  const imageParts = await loadPhotoParts(storage, photoFileIds, log);
  if (imageParts.length < 1) {
    throw new Error("No evidence photos available");
  }
  const prompt = buildScoringPrompt(items);
  const payload = await callGeminiFlash({
    apiKey,
    model,
    prompt,
    imageParts,
    log,
  });
  let scored;
  try {
    scored = normalizeFindings(payload, items);
  } catch (e) {
    const err = e;
    err.retryable = true;
    throw err;
  }
  if (scored.length < minFindings) {
    throw retryableParseError(`Need ≥${minFindings} findings, got ${scored.length}`);
  }
  return { scored, model, photoCountUsed: imageParts.length };
}

async function writeEvent(tables, shiftId, type, payload) {
  await tables.createRow({
    databaseId: DB,
    tableId: T.events,
    rowId: ID.unique(),
    data: {
      shiftId,
      type,
      actorUserId: "function:runShiftScore",
      payloadJson: JSON.stringify(payload),
      createdAt: new Date().toISOString(),
    },
  });
}

async function handleRecheck({ body, tables, storage, log, error, res }) {
  const { shiftId, findingId, itemId, recheckFileId } = body;
  const ids = { shiftId, findingId, itemId, recheckFileId };
  for (const [name, id] of Object.entries(ids)) {
    if (!isValidId(id)) {
      error(`invalid id field=${name}`);
      return res.json({ ok: false, error: GENERIC_BAD_REQUEST }, 400);
    }
  }

  let finding;
  try {
    finding = await tables.getRow({
      databaseId: DB,
      tableId: T.findings,
      rowId: findingId,
    });
  } catch (e) {
    error(`recheck finding load: ${e.message || e}`);
    return res.json({ ok: false, error: GENERIC_CONFLICT }, 409);
  }
  if (finding.shiftId !== shiftId || finding.itemId !== itemId) {
    error("recheck finding does not belong to shift/item");
    return res.json({ ok: false, error: GENERIC_CONFLICT }, 409);
  }

  const shift = await tables.getRow({
    databaseId: DB,
    tableId: T.shifts,
    rowId: shiftId,
  });
  const checklist = await tables.getRow({
    databaseId: DB,
    tableId: T.checklists,
    rowId: shift.checklistId || "opening_fs",
  });
  const items = parseChecklistItems(checklist);
  const item = items.find((it) => it.id === itemId);
  if (!item) {
    error("recheck item not on checklist");
    return res.json({ ok: false, error: GENERIC_CONFLICT }, 409);
  }

  try {
    const result = await scoreWithGemini({
      storage,
      items: [item],
      photoFileIds: [recheckFileId],
      log,
      minFindings: 1,
    });
    const f = result.scored[0];
    await tables.updateRow({
      databaseId: DB,
      tableId: T.findings,
      rowId: findingId,
      data: {
        status: f.status,
        clauseId: f.clause_id,
        quote: f.quote,
        confidence: f.confidence,
        evidenceNote: f.evidence_note,
        source: "ai",
        overrideReason: "",
        overriddenBy: "",
        overriddenAt: null,
      },
    });
    await writeEvent(tables, shiftId, "finding.rescored", {
      findingId,
      itemId,
      status: f.status,
      confidence: f.confidence,
      recheckFileId,
    });
    log(`recheck done finding=${findingId} status=${f.status}`);
    return res.json({
      ok: true,
      findingId,
      status: f.status,
      mode: "recheck",
    });
  } catch (e) {
    error(`recheck failed: ${e.message || e}`);
    return res.json({ ok: false, error: GENERIC_FAILED }, 500);
  }
}

async function handleFullScore({
  shiftId,
  jobId,
  tables,
  storage,
  log,
  error,
  res,
}) {
  let job;
  try {
    job = await tables.getRow({
      databaseId: DB,
      tableId: T.agent_jobs,
      rowId: jobId,
    });
  } catch (e) {
    error(`job load: ${e.message || e}`);
    return res.json({ ok: false, error: GENERIC_CONFLICT }, 409);
  }
  if (job.shiftId !== shiftId || !JOB_RUNNABLE.has(job.status)) {
    error(
      `job not runnable shiftMatch=${job.shiftId === shiftId} status=${job.status}`,
    );
    return res.json({ ok: false, error: GENERIC_CONFLICT }, 409);
  }

  try {
    await tables.updateRow({
      databaseId: DB,
      tableId: T.agent_jobs,
      rowId: jobId,
      data: {
        status: "running",
        startedAt: new Date().toISOString(),
      },
    });

    await tables.updateRow({
      databaseId: DB,
      tableId: T.shifts,
      rowId: shiftId,
      data: { status: "scoring" },
    });

    const shift = await tables.getRow({
      databaseId: DB,
      tableId: T.shifts,
      rowId: shiftId,
    });

    const photoFileIds = parsePhotoIds(shift);
    const photoCount = photoFileIds.length;
    if (photoCount < 1) {
      throw new Error("No evidence photos available");
    }

    const checklist = await tables.getRow({
      databaseId: DB,
      tableId: T.checklists,
      rowId: shift.checklistId || "opening_fs",
    });

    const items = parseChecklistItems(checklist);
    if (!items.length) {
      throw new Error("Checklist has no items");
    }

    const allowStub =
      String(process.env.ALLOW_DEMO_STUB_SCORES || "").trim() === "1";

    let scored;
    let mode = "gemini";
    let model = process.env.GEMINI_MODEL || "gemini-flash-latest";
    let photoCountUsed = 0;

    try {
      const result = await scoreWithGemini({
        storage,
        items,
        photoFileIds,
        log,
      });
      scored = result.scored;
      model = result.model;
      photoCountUsed = result.photoCountUsed;
      mode = "gemini";
      log(`mode=gemini model=${model} findings=${scored.length}`);
    } catch (geminiErr) {
      const msg = String(geminiErr.message || geminiErr);
      error(`Gemini path failed: ${msg}`);
      if (msg.includes("No evidence photos available") || !allowStub) {
        throw new Error(msg);
      }
      log("ALLOW_DEMO_STUB_SCORES=1 — using explicit stub after Gemini failure");
      scored = scoreItemsStub(items, photoCount);
      mode = "stub-explicit";
      photoCountUsed = 0;
    }

    if (scored.length < 5) {
      throw new Error("Need ≥5 findings");
    }

    const existing = await tables.listRows({
      databaseId: DB,
      tableId: T.findings,
      queries: [Query.equal("shiftId", shiftId), Query.limit(100)],
    });
    for (const row of existing.rows || []) {
      if (row.source === "ai") {
        await tables.deleteRow({
          databaseId: DB,
          tableId: T.findings,
          rowId: row.$id,
        });
      }
    }

    for (const f of scored) {
      await tables.createRow({
        databaseId: DB,
        tableId: T.findings,
        rowId: ID.unique(),
        data: {
          shiftId,
          itemId: f.id,
          status: f.status,
          clauseId: f.clause_id,
          quote: f.quote,
          confidence: f.confidence,
          evidenceNote: f.evidence_note,
          source: "ai",
        },
      });
    }

    const jobNow = await tables.getRow({
      databaseId: DB,
      tableId: T.agent_jobs,
      rowId: jobId,
    });
    const shiftNow = await tables.getRow({
      databaseId: DB,
      tableId: T.shifts,
      rowId: shiftId,
    });
    if (jobNow.status === "failed" || shiftNow.status === "closed") {
      error(
        `sweep conflict job=${jobNow.status} shift=${shiftNow.status} — skip done/scored`,
      );
      await writeEvent(tables, shiftId, "job.sweep_conflict", {
        jobId,
        jobStatus: jobNow.status,
        shiftStatus: shiftNow.status,
      });
      return res.json({ ok: false, error: GENERIC_CONFLICT }, 409);
    }

    const trace = {
      mode,
      model: mode === "gemini" ? model : null,
      photoCount,
      photoCountUsed,
      findingCount: scored.length,
      lowConfidenceThreshold: LOW_CONFIDENCE,
    };

    const transitionedToDone = jobNow.status !== "done";
    if (transitionedToDone) {
      await tables.updateRow({
        databaseId: DB,
        tableId: T.agent_jobs,
        rowId: jobId,
        data: {
          status: "done",
          finishedAt: new Date().toISOString(),
          errorMessage: null,
          traceJson: JSON.stringify(trace),
        },
      });
    }

    if (shiftNow.status !== "closed") {
      await tables.updateRow({
        databaseId: DB,
        tableId: T.shifts,
        rowId: shiftId,
        data: {
          status: "scored",
          scoredAt: new Date().toISOString(),
        },
      });
    }

    if (transitionedToDone) {
      await writeEvent(tables, shiftId, "job.done", {
        jobId,
        findingCount: scored.length,
        mode,
        model: mode === "gemini" ? model : null,
      });
    }

    log(`done mode=${mode} findings=${scored.length}`);
    return res.json({
      ok: true,
      findingCount: scored.length,
      mode,
      model: mode === "gemini" ? model : null,
    });
  } catch (e) {
    error(String(e.message || e));
    try {
      const jobNow = await tables.getRow({
        databaseId: DB,
        tableId: T.agent_jobs,
        rowId: jobId,
      });
      const shiftNow = await tables.getRow({
        databaseId: DB,
        tableId: T.shifts,
        rowId: shiftId,
      });
      const canFail =
        jobNow.status === "waiting" || jobNow.status === "running";
      if (canFail) {
        await tables.updateRow({
          databaseId: DB,
          tableId: T.agent_jobs,
          rowId: jobId,
          data: {
            status: "failed",
            finishedAt: new Date().toISOString(),
            errorMessage: String(e.message || e).slice(0, 500),
          },
        });
        await writeEvent(tables, shiftId, "job.failed", {
          jobId,
          error: String(e.message || e),
        });
      }
      if (shiftNow.status === "scoring") {
        await tables.updateRow({
          databaseId: DB,
          tableId: T.shifts,
          rowId: shiftId,
          data: { status: "submitted" },
        });
      }
    } catch (inner) {
      error(`fail cleanup: ${inner.message}`);
    }
    return res.json({ ok: false, error: GENERIC_FAILED }, 500);
  }
}

async function main({ req, res, log, error }) {
  const client = new Client()
    .setEndpoint(
      process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
        process.env.APPWRITE_ENDPOINT ||
        "https://sgp.cloud.appwrite.io/v1",
    )
    .setProject(
      process.env.APPWRITE_FUNCTION_PROJECT_ID ||
        process.env.APPWRITE_PROJECT_ID ||
        "6a5b0ce3002605c7a776",
    )
    .setKey(
      process.env.APPWRITE_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY || "",
    );

  const tables = new TablesDB(client);
  const storage = new Storage(client);

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    body = {};
  }
  if (!body.shiftId && req.bodyJson) body = req.bodyJson;

  if (body.mode === "recheck") {
    return handleRecheck({ body, tables, storage, log, error, res });
  }

  const shiftId = body.shiftId;
  const jobId = body.jobId;
  if (!isValidId(shiftId) || !isValidId(jobId)) {
    error("Missing or invalid shiftId/jobId");
    return res.json({ ok: false, error: GENERIC_BAD_REQUEST }, 400);
  }

  log(`runShiftScore shiftId=${shiftId} jobId=${jobId}`);
  return handleFullScore({
    shiftId,
    jobId,
    tables,
    storage,
    log,
    error,
    res,
  });
}

module.exports = main;
module.exports.extractJsonObject = extractJsonObject;
module.exports.isValidId = isValidId;
module.exports.ID_PATTERN = ID_PATTERN;
module.exports.clamp01 = clamp01;
module.exports.isRetryableModelOutputError = isRetryableModelOutputError;
module.exports.classifyGeminiError = classifyGeminiError;
module.exports.isRetryableGeminiHttp = isRetryableGeminiHttp;
module.exports.scoringDeadlineMs = scoringDeadlineMs;
