# ShiftProof web

Vite + React + TypeScript frontend for Appwrite project **Jammu**.

Source of truth: `docs/APP.md`, `docs/API.md`, `docs/APPWRITE.md`, `docs/PERMISSIONS.md`, `docs/SEED.md`.

## Slice status

| Slice | Status |
|-------|--------|
| **C1** Auth + role shells | Done |
| **C2** Staff shift + photos + `agent_jobs` / `events` | Done — resume draft, per-item slots, staff scores, discard empties |
| **C3** `runShiftScore` | Done — **Gemini Flash** on Function (default); no silent client stub |
| **C4** Scoreboard UI (Pass / Gap / Unclear) | Done |
| **C5** Manager inbox + Realtime | Done — Today / Backlog / All, Open fixes, stuck Retry, stale-job fail on load |
| **C6** Override + tasks + events | Done — live writes, reject check, assign today’s gaps, audit trail + mark done |
| **C7** Seed pack | Appwrite / docs |
| **C8** Compliance PDF export | Done — print / Save as PDF 1-page pack |
| **Boost #1** Agent trace + citations | Done |
| **Boost #2** Hero Unclear + audited override | Done |
| **Boost #3** Task re-check photo | Done |
| **Boost #4** Golden photo pack folders | Done |
| **Boost #5** Richer compliance PDF | Done |
| **Boost #6** Repeat-offender strip | Done |
| **Phase 3** Assign → staff re-check → AI re-score → manager done | Done |

Uses only operations in `docs/API.md`. Types: `src/types/shiftproof.ts`.

Boosts Playwright: `node scripts/playwright-boosts.mjs http://localhost:5173`  
Fix-loop Playwright: `node scripts/playwright-fix-loop.mjs http://localhost:5173`  
Manager-next Playwright: `node scripts/verify-manager-next.mjs http://localhost:5173 [1|2|3]`

## Setup

```bash
cd web
# create .env with the public vars below
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

## Staff journey (current)

1. Login as **staff**. Opening CTA is **Continue opening check** if a draft exists (never a second empty draft).
2. **Fix needed** paints from the assigned-task query first (skeleton while that loads). Default list is capped; older rows sit behind Show more. A failed load shows an error + Try again — not a silent empty page.
3. Evidence is **one Add photo per checklist item** (3–8 total). Legacy unmapped shots stay under Other photos. Remove deletes the Storage file. Discard draft is allowed on drafts.
4. After submit, staff see **Your scores** (Pass / Gap / Unclear). Assigned gaps can take a re-check photo here. Stuck `submitted`/`scoring` jobs show **Try scoring again**.
5. History filters: **Needs me** (draft + in-progress) / **Done** / **All**. Extra empty drafts can be discarded in one action.

## Smoke path

1. Login as **staff** → Continue or Start opening check (same draft if one exists)
2. Photograph checklist items (3–8) → Submit proof → read scores
3. Login as **manager** → Today first (live, or sample banner if no submitted shifts). Backlog / All for older rows. Open fixes lists live tasks.
4. Open scoreboard → select finding → Override / Request new photo / Assign fix. **Reject check** closes invalid evidence. **Close opening** archives a reviewed shift. Stuck scores: Retry. Failed chip = score failed, not still scoring.
5. On Today, **Assign today’s gaps** creates a `Fix:` task per unassigned Gap (not Unclear) for that shift’s staff.
6. Export pack → Print / Save PDF (identity, photos, human audit).

## Manager journey (current)

1. Inbox is **Today** (open gaps / unclear / in-progress + older stuck), **Backlog** (older open gaps), **All**. Repeat-gap rows filter with `?item=`.
2. Scoreboard: finding thumbs via `photoForItem` (slotted or 1:1), else the evidence gallery. No `evidenceFileId` column — schema frozen.
3. **Reject check** → confirm “Photos are not an opening check.” → `closeShift({ reason: "invalid_evidence" })`. Staff shift page shows “Manager rejected this check — submit a real opening.” Storage files stay.
4. Stale `waiting`/`running` jobs older than 10 minutes are marked `failed` once per inbox/scoreboard load. Shift status is unchanged so Retry still works.

## Round 2 verification

Plan: [`../docs/ROUND2-PLAN.md`](../docs/ROUND2-PLAN.md) · cases: [`../docs/TEST-CASES.md`](../docs/TEST-CASES.md)

```bash
# Dev server running, then:
node scripts/playwright-smoke.mjs http://localhost:5173
node scripts/playwright-c3-loop.mjs http://localhost:5173
node scripts/playwright-fix-loop.mjs http://localhost:5173
node scripts/playwright-boosts.mjs http://localhost:5173
node scripts/verify-usability.mjs http://localhost:5173
node scripts/verify-fixes-timing.mjs http://localhost:5173
node scripts/verify-manager-next.mjs http://localhost:5173 1
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
4. Source: `../functions/runShiftScore/`. Requires Function env `VERTEX_API_KEY` (never in Vite).

Playwright C3 loop: `node scripts/playwright-c3-loop.mjs http://localhost:5173`
