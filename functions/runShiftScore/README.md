# runShiftScore (C3)

Appwrite Function for ShiftProof vision scoring. Contract: `docs/API.md`, schema: `docs/FINDINGS_SCHEMA.json`.

## Input

Score a Shift:

```json
{ "shiftId": "<id>", "jobId": "<id>" }
```

Extract the live clause set from the SOP now on record (manager upload, sync wait on Inbox):

```json
{ "action": "extract" }
```

Score one Re-check photo against that Task’s Finding (sync wait; no Agent job; Shift stays scored):

```json
{ "action": "recheck", "taskId": "<id>" }
```

Re-check loads `task.recheckFileId` + the linked Finding’s live Clause only. `ALLOW_DEMO_STUB_SCORES` is ignored. On Gemini error the Function writes nothing.

Extract uses `thinkingLevel: HIGH` on 3.x only: `gemini-3.7-flash`, then `gemini-3.6-flash`, then `gemini-3.5-flash-lite`. No 2.x fallback, no MEDIUM retry. Success rewrites `opening_fs.itemsJson` (3–8 items). Failure writes nothing to the Checklist.

Scoring (`MEDIUM`) on Vertex tries `gemini-3.7-flash`, then `gemini-3.6-flash`, then `gemini-3.5-flash-lite`. On AI Studio the order is lite → 3.6 → 3.7 (3.7 503s on that pool). `GEMINI_MODEL` does not reorder this list. A 503, timeout, or empty answer switches model immediately. 2.x models 404 on new AI Studio keys.

## Default path (Gemini Flash)

1. Job → `running`; shift → `scoring`
2. Load the live Checklist + every evidence photo from Storage bucket `evidence` (up to eight; empty slots are skipped). Photos only — not the SOP PDF.
3. Call **Gemini Flash** at `thinkingLevel: MEDIUM` via Vertex (`VERTEX_API_KEY`) when that key is set; otherwise Google AI Studio
4. Parse JSON → normalize to FINDINGS_SCHEMA (low confidence → `unclear`). Clause id + quote come from the live Checklist item, not a hardcoded café map.
5. Write one `findings` row per live Checklist item (`source: "ai"`). Count follows the live set (3–8), not a floor of five.
6. Job → `done` (`traceJson.mode: "gemini"`), shift → `scored`, event `job.done`
7. On Gemini/API/parse failure (default): job → `failed`, event `job.failed` — **no silent stub**

## Env (Function only)

| Variable | Required | Notes |
|----------|----------|-------|
| `APPWRITE_API_KEY` | yes | Server key: TablesDB + Storage |
| `APPWRITE_FUNCTION_API_ENDPOINT` / `APPWRITE_ENDPOINT` | yes | Regional, e.g. `https://sgp.cloud.appwrite.io/v1` |
| `APPWRITE_FUNCTION_PROJECT_ID` / `APPWRITE_PROJECT_ID` | yes | Jammu project id |
| `VERTEX_API_KEY` | yes (Vertex path) | Agent Platform / Vertex key — never put in frontend |
| `VERTEX_PROJECT_ID` | yes (Vertex path) | GCP project id |
| `VERTEX_LOCATION` | no | Default `global` |
| `GEMINI_PROVIDER` | no | `vertex` or `studio`. Auto `vertex` when `VERTEX_API_KEY` is set |
| `GOOGLE_AI_API_KEY` | studio path only | Google AI Studio key — unused on Vertex |
| `GEMINI_MODEL` | no | Ignored for scoring order |
| `ALLOW_DEMO_STUB_SCORES` | no | Set to `1` only for explicit emergency stub after Gemini failure |

## Deploy

```powershell
# From repo root, with server API key:
$env:APPWRITE_API_KEY = "..."
.\functions\runShiftScore\deploy.ps1
.\functions\runShiftScore\set-vars.ps1
```

`set-vars.ps1` reads `.env` for `APPWRITE_API_KEY`, Vertex vars, and optional `GOOGLE_AI_API_KEY`. Do not run it until you are ready to point the cloud Function at Vertex.

## Smoke

1. Staff submit opening proof in the web app
2. Job: `waiting` → `running` → `done`
3. Manager scoreboard shows one clause-cited Finding per live Checklist item
4. Function logs / `agent_jobs.traceJson` show `mode: "gemini"` (not stub)
