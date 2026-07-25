# ShiftProof web

Vite + React + TypeScript frontend for Appwrite project **Jammu**.

Source of truth: `docs/APP.md`, `docs/API.md`, `docs/APPWRITE.md`, `docs/PERMISSIONS.md`, `docs/SEED.md`.

## Slice status

| Slice | Status |
|-------|--------|
| **C1** Auth + role shells | Done |
| **C2** Staff shift + photos + `agent_jobs` / `events` | Done |
| **C3** `runShiftScore` | Done — **Gemini Flash** on Function (default); no silent client stub |
| **C4** Scoreboard UI (Pass / Gap / Unclear) | Done |
| **C5** Manager inbox + Realtime | Done (subscribe + reload) |
| **C6** Override + tasks + events | Done — live writes + audit trail + mark done |
| **C7** Seed pack | Appwrite / docs |
| **C8** Compliance PDF export | Done — print / Save as PDF 1-page pack |
| **Boost #1** Agent trace + citations | Done |
| **Boost #2** Hero Unclear + audited override | Done |
| **Boost #3** Task re-check photo | Done |
| **Boost #4** Golden photo pack folders | Done (`demo/photos/`) |
| **Boost #5** Richer compliance PDF | Done |
| **Boost #6** Repeat-offender strip | Done |
| **Phase 3** Assign → staff re-check → AI re-score → manager done | Done |

Uses only operations in `docs/API.md`. Types: `src/types/shiftproof.ts`.

Boosts Playwright: `node scripts/playwright-boosts.mjs http://localhost:5173`  
Fix-loop Playwright: `node scripts/playwright-fix-loop.mjs http://localhost:5173`

## Setup

```bash
cd web
cp .env.example .env
npm install
npm run dev
```

### Env

```
VITE_APPWRITE_ENDPOINT=https://sgp.cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=6a5b0ce3002605c7a776
```

Enable **Email/Password** auth in Appwrite Console if login fails.

## Demo accounts (`docs/SEED.md`)

| Role    | Email                    | Password         |
|---------|--------------------------|------------------|
| staff   | staff@shiftproof.demo    | DemoStaff123!    |
| manager | manager@shiftproof.demo  | DemoManager123!  |

## Realtime channels (C5)

Working Appwrite TablesDB channel strings (via `Channel.tablesdb`):

```
tablesdb.shiftproof.tables.shifts.rows
tablesdb.shiftproof.tables.findings.rows
tablesdb.shiftproof.tables.agent_jobs.rows
tablesdb.shiftproof.tables.tasks.rows
```

Subscribed in `src/lib/manager.ts` → `subscribeManagerTables`. Manager home reloads inbox on events.

## Smoke path

1. Login as **staff** → Start opening check  
2. Upload 3–8 photos → Submit proof  
3. Login as **manager** → inbox (live or sample if no submitted shifts)  
4. Open scoreboard → select finding → Override / Assign fix (live when findings exist)  
5. Export pack → Print / Save PDF

## Round 2 verification

Plan: [`../docs/ROUND2-PLAN.md`](../docs/ROUND2-PLAN.md) · cases: [`../docs/TEST-CASES.md`](../docs/TEST-CASES.md)

```bash
# Dev server running, then:
node scripts/playwright-smoke.mjs http://localhost:5173
node scripts/playwright-c3-loop.mjs http://localhost:5173
node scripts/playwright-fix-loop.mjs http://localhost:5173
node scripts/playwright-boosts.mjs http://localhost:5173
```

## Scripts

```bash
npm run dev
npm run build
npm run lint

# Playwright smoke (dev server running)
node scripts/playwright-smoke.mjs http://localhost:5173
```

## C3 scoring

1. Submit triggers cloud Function `runShiftScore` (`functions.createExecution`).
2. Function loads evidence photos + checklist → **Gemini Flash** → findings (`docs/FINDINGS_SCHEMA.json`).
3. Default: Gemini failure → job `failed` (no silent stub). Optional Function env `ALLOW_DEMO_STUB_SCORES=1` for explicit emergency only.
4. Source: `../functions/runShiftScore/`. Requires Function env `GOOGLE_AI_API_KEY` (never in Vite).

Playwright C3 loop: `node scripts/playwright-c3-loop.mjs http://localhost:5173`
