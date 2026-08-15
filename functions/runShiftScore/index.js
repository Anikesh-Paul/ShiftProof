/**
 * Appwrite Function: runShiftScore
 * Contract: docs/API.md — input { shiftId, jobId }
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

const DB = "shiftproof";
const EVIDENCE_BUCKET = "evidence";
const T = {
  shifts: "shifts",
  checklists: "checklists",
  findings: "findings",
  agent_jobs: "agent_jobs",
  events: "events",
};

/** Low confidence cannot be silent pass/gap (TC-C3-05). */
const LOW_CONFIDENCE = 0.55;
/** Cap photos sent to the model (timeout + payload). */
const MAX_PHOTOS = 5;
/** Cap base64 chars per image (~1.2MB decoded). Phone originals are compressed on upload. */
const MAX_B64_CHARS = 1_600_000;
/** One Gemini attempt must finish in time to allow a retry inside the Function timeout. */
const GEMINI_ATTEMPT_MS = 45_000;
/** Leave headroom under Appwrite Function timeout (120s default; set 170000 after raising to 180s). */
const SCORING_DEADLINE_MS = Number(process.env.SCORING_DEADLINE_MS || 110_000);

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
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string" && x) : [];
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
    // Cap lengths to Appwrite column limits
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

  // Ensure every checklist item has a finding
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
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

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
 * Up to 3 attempts on 429/503/500/timeout. Skip daily-quota 429s (retrying
 * burns the same empty bucket). Drop thinking config once if Gemini 400s it.
 * Still fails cleanly if exhausted (no silent stub unless ALLOW_DEMO_STUB_SCORES).
 */
async function callGeminiFlash({ apiKey, model, prompt, imageParts, log }) {
  const maxAttempts = 3;
  const started = Date.now();
  let thinkingConfig = thinkingConfigFor(model);
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const elapsed = Date.now() - started;
    if (elapsed + 8_000 > SCORING_DEADLINE_MS) {
      log(`Gemini abort retry: ${elapsed}ms elapsed, near Function deadline`);
      break;
    }
    try {
      return await callGeminiFlashOnce({
        apiKey,
        model,
        prompt,
        imageParts,
        log,
        thinkingConfig,
      });
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

      const retryable = timedOut || isRetryableGeminiHttp(status);
      if (attempt < maxAttempts && retryable) {
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
  const textOut = await callGeminiFlash({
    apiKey,
    model,
    prompt,
    imageParts,
    log,
  });
  log(`Gemini response chars=${textOut.length}`);
  const payload = extractJsonObject(textOut);
  const scored = normalizeFindings(payload, items);
  if (scored.length < 5) {
    throw new Error(`Need ≥5 findings, got ${scored.length}`);
  }
  return { scored, model, photoCountUsed: imageParts.length };
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
  if (!body.shiftId && req.bodyJson) body = req.bodyJson;

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
      scored = scoreItemsStub(items, photoCount);
      mode = "stub-explicit";
      photoCountUsed = 0;
    }

    if (scored.length < 5) {
      throw new Error("Need ≥5 findings");
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
