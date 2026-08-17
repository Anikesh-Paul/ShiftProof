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

Extract uses `thinkingLevel: HIGH`, one attempt, no 2.x fallback, no MEDIUM retry. Success rewrites `opening_fs.itemsJson` (3–8 items). Failure writes nothing to the Checklist.

## Default path (Gemini Flash)

1. Job → `running`; shift → `scoring`
2. Load checklist items + evidence photos from Storage bucket `evidence` (`photoFileIds` is a JSON string array; empty slots are skipped)
3. Call **Gemini Flash** via Google AI Studio (`GOOGLE_AI_API_KEY`)
4. Parse JSON → normalize to FINDINGS_SCHEMA (low confidence → `unclear`)
5. Write ≥5 `findings` (`source: "ai"`)
6. Job → `done` (`traceJson.mode: "gemini"`), shift → `scored`, event `job.done`
7. On Gemini/API/parse failure (default): job → `failed`, event `job.failed` — **no silent stub**

## Env (Function only)

| Variable | Required | Notes |
|----------|----------|-------|
| `APPWRITE_API_KEY` | yes | Server key: TablesDB + Storage |
| `APPWRITE_FUNCTION_API_ENDPOINT` / `APPWRITE_ENDPOINT` | yes | Regional, e.g. `https://sgp.cloud.appwrite.io/v1` |
| `APPWRITE_FUNCTION_PROJECT_ID` / `APPWRITE_PROJECT_ID` | yes | Jammu project id |
| `GOOGLE_AI_API_KEY` | yes (default path) | Google AI Studio key — never put in frontend |
| `GEMINI_MODEL` | no | Default `gemini-flash-latest` (override if free-tier 429s) |
| `ALLOW_DEMO_STUB_SCORES` | no | Set to `1` only for explicit emergency stub after Gemini failure |

## Deploy

```powershell
# From repo root, with server API key:
$env:APPWRITE_API_KEY = "..."
.\functions\runShiftScore\deploy.ps1
.\functions\runShiftScore\set-vars.ps1
```

`set-vars.ps1` reads `.env` for `APPWRITE_API_KEY` and optional `GOOGLE_AI_API_KEY`.

## Smoke

1. Staff submit opening proof in the web app
2. Job: `waiting` → `running` → `done`
3. Manager scoreboard shows ≥5 findings with clause quotes
4. Function logs / `agent_jobs.traceJson` show `mode: "gemini"` (not stub)
