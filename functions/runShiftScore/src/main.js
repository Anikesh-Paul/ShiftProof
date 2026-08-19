/**
 * Appwrite Function: runShiftScore
 * Contract: docs/API.md — input { shiftId, jobId }, { action: "extract" },
 * or { action: "recheck", taskId }
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
 *   SCORING_DEADLINE_MS       (optional, default 110000; use 170000 if Function timeout is 180s)
 *   ALLOW_DEMO_STUB_SCORES=1  (optional explicit emergency stub only)
 */
const { Client, TablesDB, Storage, ID, Query } = require("node-appwrite");
const {
  thinkingConfigFor,
  fallbackModels,
  scoringModels,
  shouldSwitchGeminiModel,
  extractCallPolicy,
} = require(__dirname.endsWith("src") ? "./thinking" : "./src/thinking");
const {
  parseExtractPayload,
  toChecklistItems,
  bumpVersion,
} = require(__dirname.endsWith("src") ? "./liveSet" : "./src/liveSet");
const {
  LOW_CONFIDENCE,
  PASS_CONFIDENCE,
  quoteForItem,
  clauseIdForItem,
  photoIdsForScore,
  normalizeFindings,
} = require(__dirname.endsWith("src") ? "./findings" : "./src/findings");
const { runRecheck } = require(__dirname.endsWith("src") ? "./recheck" : "./src/recheck");

const DB = "shiftproof";
const EVIDENCE_BUCKET = "evidence";
const SOP_BUCKET = "sop_files";
const SOP_ID = "cafe_sop_v1";
const CHECKLIST_ID = "opening_fs";
const T = {
  shifts: "shifts",
  checklists: "checklists",
  findings: "findings",
  agent_jobs: "agent_jobs",
  events: "events",
  sops: "sops",
};

/** Cap base64 chars per image (~1.2MB decoded). Phone originals are compressed on upload. */
const MAX_B64_CHARS = 1_600_000;
/** One Gemini attempt must finish in time to allow a retry inside the Function timeout. */
const GEMINI_ATTEMPT_MS = 60_000;
/** Leave headroom under Appwrite Function timeout (120s default; set 170000 after raising to 180s). */
const SCORING_DEADLINE_MS = Number(process.env.SCORING_DEADLINE_MS || 110_000);

/** Deterministic stub — only when ALLOW_DEMO_STUB_SCORES=1 (never silent default). */
function scoreItemsStub(items, photoCount) {
  return items.map((item, i) => {
    const clauseId = clauseIdForItem(item, i);
    const quote = quoteForItem(item, clauseId);
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
  const limited = photoIdsForScore(photoFileIds);
  for (const fileId of limited) {
    try {
      let mime = "image/jpeg";
      try {
        const meta = await storage.getFile({
          bucketId: EVIDENCE_BUCKET,
          fileId,
        });
        if (meta && meta.mimeType) mime = meta.mimeType;
      } catch {
        /* keep default mime */
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
      parts.push({
        inline_data: {
          mime_type: mime,
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
  const checklistForModel = items.map((item, i) => {
    const clauseId = clauseIdForItem(item, i);
    return {
      id: item.id,
      label: item.label || item.id,
      relatedClauseIds: item.relatedClauseIds || [clauseId],
      quote: quoteForItem(item, clauseId),
    };
  });

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
      "subject": 0.8,
      "visibility": 0.8,
      "photo_indexes": [1],
      "evidence_note": "what is visible, then the judgment"
    }
  ]
}

Rules:
1. Include exactly one object per checklist item; use the exact "id" values given.
2. evidence_note describes what is visible in the photos first, then judges the item. Vary notes per item.
3. pass — only if the live quote's claim for that item is visible. Do not pass on a related object that is not the in-use check. Derive that near-miss from this item's label and quote; do not use a fixed object list.
4. gap — photos clearly show the quote's claim is not met.
5. unclear — evidence missing, ambiguous, dark, cropped, glare, wrong subject, or tiny/placeholder images; also when the photos cannot support a judgment.
6. subject and visibility are evidence-sufficiency factors in [0, 1]. subject = the clause's actual check is in frame; visibility = it can be seen. Optionally add lighting and coverage when you can score them. Omit any factor you cannot score — do not send 0 as a placeholder.
7. photo_indexes are 1-based indexes into the attached photo list that support this item. Cite only photos you actually used.
8. confidence is the fallback sufficiency in [0, 1] when you omit factors. If it would be < ${LOW_CONFIDENCE}, status MUST be "unclear".
9. Prefer clause_id from relatedClauseIds; use that item's quote from the live checklist.
10. Do not invent objects that are not visible. Prefer unclear over guessing pass.

Live checklist (labels, Clause ids, quotes):
${JSON.stringify(checklistForModel, null, 2)}
`;
}

function buildExtractPrompt() {
  return `You extract the café opening check from this SOP PDF.

Return ONLY valid JSON (no markdown fences):
{
  "items": [
    {
      "clause_id": "FS-01",
      "label": "short photo-provable opening question",
      "quote": "short verbatim quote from the SOP"
    }
  ]
}

Rules:
1. Only photo-provable café-opening rules — something a photo at open can prove.
2. At most 8 items. If more photographable rules exist, pick the eight most critical opening checks, not document order or cover pages.
3. If fewer than 3 photo-provable opening rules exist, return { "items": [] }.
4. Prefer printed clause ids (FS-01 and so on) when the SOP has them.
5. Labels are short staff-facing questions, not section titles.
6. Quotes are short verbatim lines from the SOP.
`;
}

function extractJsonAny(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty model text");
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    return JSON.parse(fence[1].trim());
  }
  try {
    return extractJsonObject(raw);
  } catch {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("Model response is not valid JSON");
  }
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty model text");
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    return JSON.parse(fence[1].trim());
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }
  throw new Error("Model response is not valid JSON");
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

function isThinkingConfigRejected(status, body) {
  if (status !== 400) return false;
  return String(body || "").toLowerCase().includes("thinking");
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
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [{ text: prompt }, ...imageParts];
  const generationConfig = {
    temperature: 0.2,
    maxOutputTokens: 8192,
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
    headers: { "Content-Type": "application/json" },
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
    throw new Error("Gemini response not JSON");
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

  const textOut = (cand.content && cand.content.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!textOut) {
    throw new Error("Gemini empty text (parse/safety)");
  }
  return textOut;
}

/**
 * One attempt per model on 429/503/500/timeout. Scoring switches model on
 * 503 or timeout so a hanging 3.6 does not burn the Function. Skip daily-quota
 * 429s. Drop thinking config once if Gemini 400s it. Still fails cleanly if
 * exhausted (no silent stub unless ALLOW_DEMO_STUB_SCORES).
 */
async function callGeminiFlash({
  apiKey,
  model,
  prompt,
  imageParts,
  log,
  thinkingLevel,
}) {
  const models =
    thinkingLevel === "HIGH" ? fallbackModels(model) : scoringModels(model);
  const maxAttempts = models.length;
  const started = Date.now();
  let modelIdx = 0;
  let currentModel = models[0];
  let thinkingConfig = thinkingConfigFor(currentModel, thinkingLevel);
  const allowThinkingDowngrade = thinkingLevel !== "HIGH";
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const elapsed = Date.now() - started;
    if (elapsed + 8_000 > SCORING_DEADLINE_MS) {
      log(`Gemini abort retry: ${elapsed}ms elapsed, near Function deadline`);
      break;
    }
    try {
      const textOut = await callGeminiFlashOnce({
        apiKey,
        model: currentModel,
        prompt,
        imageParts,
        log,
        thinkingConfig,
      });
      return { textOut, model: currentModel };
    } catch (e) {
      lastErr = e;
      const status = e && e.httpStatus;
      const body = (e && e.responseBody) || String(e && e.message) || "";
      const timedOut =
        e && (e.name === "TimeoutError" || e.name === "AbortError");

      if (
        allowThinkingDowngrade &&
        thinkingConfig &&
        isThinkingConfigRejected(status, body)
      ) {
        log("Gemini rejected thinkingConfig; retrying without it");
        thinkingConfig = null;
        attempt -= 1;
        continue;
      }

      if (isDailyQuotaExhausted(status, body)) {
        throw new Error(
          "Gemini daily free quota used (20 RPD). Open golden_gap_open instead of retrying.",
        );
      }

      const noAnswer = /empty text|no candidates|not JSON|not valid JSON/i.test(
        String((e && e.message) || ""),
      );
      const retryable =
        timedOut || isRetryableGeminiHttp(status) || noAnswer;
      if (attempt < maxAttempts && retryable) {
        const switchModel = shouldSwitchGeminiModel({
          thinkingLevel,
          status,
          timedOut,
          noAnswer,
          hasNext: modelIdx + 1 < models.length,
        });
        if (switchModel) {
          modelIdx += 1;
          currentModel = models[modelIdx];
          thinkingConfig = thinkingConfigFor(currentModel, thinkingLevel);
          log(
            `Gemini ${timedOut ? "timeout" : status ? `HTTP ${status}` : "no answer"}; fallback model=${currentModel} think=${thinkingLevel || "MEDIUM"}`,
          );
          continue;
        }
        const delayMs = retryDelayMs(status || 503, attempt);
        log(
          `Gemini retryable ${timedOut ? "timeout" : `HTTP ${status}`}; attempt ${attempt}/${maxAttempts}; wait ${delayMs}ms`,
        );
        await sleep(delayMs);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("Gemini scoring stopped near Function deadline");
}

async function scoreWithGemini({ storage, items, photoFileIds, log }) {
  const apiKey = process.env.GOOGLE_AI_API_KEY || "";
  if (!apiKey) {
    throw new Error(
      "GOOGLE_AI_API_KEY not set on Function (Google AI Studio key required)",
    );
  }
  // gemini-2.0-flash free-tier often 429 for new AI Studio keys; flash-latest works.
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const imageParts = await loadPhotoParts(storage, photoFileIds, log);
  if (imageParts.length < 1 && photoFileIds.length > 0) {
    log("warning: no photos downloaded; scoring with text-only context");
  }
  const prompt = buildScoringPrompt(items);
  const { textOut, model: usedModel } = await callGeminiFlash({
    apiKey,
    model,
    prompt,
    imageParts,
    log,
    thinkingLevel: "MEDIUM",
  });
  log(`Gemini response chars=${textOut.length}`);
  const payload = extractJsonObject(textOut);
  const scored = normalizeFindings(payload, items, imageParts.length);
  return {
    scored,
    payload,
    model: usedModel,
    photoCountUsed: imageParts.length,
  };
}

async function extractWithGemini({ storage, fileId, log }) {
  const apiKey = process.env.GOOGLE_AI_API_KEY || "";
  if (!apiKey) {
    throw new Error(
      "GOOGLE_AI_API_KEY not set on Function (Google AI Studio key required)",
    );
  }
  const policy = extractCallPolicy();
  const buf = await storage.getFileDownload({
    bucketId: SOP_BUCKET,
    fileId,
  });
  const b64 = Buffer.from(buf).toString("base64");
  if (!b64.length) {
    throw new Error("SOP file is empty");
  }
  const { textOut } = await callGeminiFlash({
    apiKey,
    model: policy.model,
    prompt: buildExtractPrompt(),
    imageParts: [
      {
        inline_data: {
          mime_type: "application/pdf",
          data: b64,
        },
      },
    ],
    log,
    thinkingLevel: "HIGH",
  });
  return textOut;
}

async function handleExtract({ tables, storage, res, log, error }) {
  log("runShiftScore action=extract");
  try {
    const sop = await tables.getRow({
      databaseId: DB,
      tableId: T.sops,
      rowId: SOP_ID,
    });
    const fileId = String(sop.fileId || "").trim();
    if (!fileId || /^TODO/i.test(fileId)) {
      throw new Error("No SOP file on record");
    }
    const textOut = await extractWithGemini({ storage, fileId, log });
    log(`extract response chars=${textOut.length}`);
    const extracted = parseExtractPayload(extractJsonAny(textOut));
    const items = toChecklistItems(extracted);
    await tables.updateRow({
      databaseId: DB,
      tableId: T.checklists,
      rowId: CHECKLIST_ID,
      data: { itemsJson: JSON.stringify(items) },
    });
    await tables.updateRow({
      databaseId: DB,
      tableId: T.sops,
      rowId: SOP_ID,
      data: {
        version: bumpVersion(sop.version),
      },
    });
    log(`extract ok items=${items.length}`);
    return res.json({ ok: true, items });
  } catch (e) {
    const message = String(e.message || e);
    error(`extract failed: ${message}`);
    return res.json({ ok: false, error: message }, 500);
  }
}

/**
 * One Task photo, one live Clause. Sync. No Agent job. Shift stays scored.
 * ALLOW_DEMO_STUB_SCORES is ignored — a Gemini throw writes nothing.
 */
async function handleRecheckAction({ tables, storage, body, res, log, error }) {
  const taskId = String((body && body.taskId) || "").trim();
  if (!taskId) {
    error("Missing taskId");
    return res.json({ ok: false, error: "taskId required" }, 400);
  }
  try {
    const result = await runRecheck({
      tables,
      taskId,
      scoreOneItem: async ({ item, photoFileId }) => {
        const scored = await scoreWithGemini({
          storage,
          items: [item],
          photoFileIds: [photoFileId],
          log,
        });
        if (scored.photoCountUsed < 1) {
          throw new Error("Re-check photo could not be loaded");
        }
        const list =
          scored.payload && Array.isArray(scored.payload.items)
            ? scored.payload.items
            : Array.isArray(scored.payload)
              ? scored.payload
              : [];
        return list.find((row) => row && String(row.id) === item.id) || list[0];
      },
      newRowId: () => ID.unique(),
      now: () => new Date().toISOString(),
      log,
    });
    return res.json(result);
  } catch (e) {
    const message = String(e.message || e);
    error(`recheck failed: ${message}`);
    return res.json({ ok: false, error: message }, 500);
  }
}

module.exports = async ({ req, res, log, error }) => {
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
  if (!body.shiftId && !body.action && req.bodyJson) body = req.bodyJson;

  if (body.action === "extract") {
    return handleExtract({ tables, storage, res, log, error });
  }

  if (body.action === "recheck") {
    return handleRecheckAction({ tables, storage, body, res, log, error });
  }

  const shiftId = body.shiftId;
  const jobId = body.jobId;
  if (!shiftId || !jobId) {
    error("Missing shiftId or jobId");
    return res.json({ ok: false, error: "shiftId and jobId required" }, 400);
  }

  log(`runShiftScore shiftId=${shiftId} jobId=${jobId}`);

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
      if (!allowStub) {
        throw new Error(msg);
      }
      log("ALLOW_DEMO_STUB_SCORES=1 — using explicit stub after Gemini failure");
      scored = normalizeFindings(
        { items: scoreItemsStub(items, photoCount) },
        items,
        photoCount,
      );
      mode = "stub-explicit";
      photoCountUsed = 0;
    }

    // Clear prior AI findings for this shift (re-run safe)
    try {
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
    } catch (e) {
      log(`skip clear findings: ${e.message}`);
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

    const trace = {
      mode,
      model: mode === "gemini" ? model : null,
      photoCount,
      photoCountUsed,
      findingCount: scored.length,
      lowConfidenceThreshold: LOW_CONFIDENCE,
      passConfidenceThreshold: PASS_CONFIDENCE,
    };

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

    await tables.updateRow({
      databaseId: DB,
      tableId: T.shifts,
      rowId: shiftId,
      data: {
        status: "scored",
        scoredAt: new Date().toISOString(),
      },
    });

    await tables.createRow({
      databaseId: DB,
      tableId: T.events,
      rowId: ID.unique(),
      data: {
        shiftId,
        type: "job.done",
        actorUserId: "function:runShiftScore",
        payloadJson: JSON.stringify({
          jobId,
          findingCount: scored.length,
          mode,
          model: mode === "gemini" ? model : null,
        }),
        createdAt: new Date().toISOString(),
      },
    });

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
      await tables.createRow({
        databaseId: DB,
        tableId: T.events,
        rowId: ID.unique(),
        data: {
          shiftId,
          type: "job.failed",
          actorUserId: "function:runShiftScore",
          payloadJson: JSON.stringify({
            jobId,
            error: String(e.message || e),
          }),
          createdAt: new Date().toISOString(),
        },
      });
    } catch (inner) {
      error(`fail cleanup: ${inner.message}`);
    }
    return res.json({ ok: false, error: String(e.message || e) }, 500);
  }
};
