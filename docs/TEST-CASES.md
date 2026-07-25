# ShiftProof — Round 2 test cases

> **Status:** FROZEN catalog (2026-07-25) — extend IDs as features land; do not renumber.  
> **How to run:** Prefer Playwright CLI scripts in `web/scripts/` (see [`ROUND2-PLAN.md`](./ROUND2-PLAN.md) §7).  
> **Accounts:** [`SEED.md`](./SEED.md) — `staff@shiftproof.demo` / `manager@shiftproof.demo`.

### Legend

| Field | Meaning |
|-------|---------|
| **ID** | Stable case id |
| **Priority** | P0 = block submit; P1 = Showcase Max; P2 = polish |
| **Type** | E2E / API / Contract / Manual / Unit |
| **Session** | First session that must pass this case |
| **Playwright** | Script or `manual` / `function-log` |
| **Status** | `pending` until verified in a session |

---

## Suite map → Playwright

| Suite | Script | Covers |
|-------|--------|--------|
| Smoke | `node scripts/playwright-smoke.mjs <baseUrl>` | Login, staff home, history, manager home, scoreboard surfaces |
| C3 loop | `node scripts/playwright-c3-loop.mjs <baseUrl>` | Upload → submit → score → manager findings |
| Fix loop | `node scripts/playwright-fix-loop.mjs <baseUrl>` | Assign → re-check UI → manager side |
| Boosts | `node scripts/playwright-boosts.mjs <baseUrl>` | Trace, unclear, export, offenders UI |
| Staff opening | `node scripts/playwright-staff-opening.mjs <baseUrl>` | Opening check path |
| Gemini kit (planned S2) | `playwright-gemini-kit.mjs` (to add) | Real `demo/photos/*` uploads |

Default base URL examples: `http://localhost:5173`, Vercel HTTPS URL.

---

## TC-C1 — Auth & role shells

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-C1-01 | Login page shows ShiftProof branding | P0 | E2E | S1 | smoke | Open `/login` → title/brand present | pending |
| TC-C1-02 | Staff login lands on staff shell | P0 | E2E | S1 | smoke | Login staff → URL `/staff` (or staff home) | pending |
| TC-C1-03 | Manager login lands on manager shell | P0 | E2E | S1 | smoke | Login manager → manager inbox/home | pending |
| TC-C1-04 | Staff cannot use manager-only routes usefully | P1 | E2E | S1 | manual / smoke | Staff opens `/manager` → redirected or no-role | pending |
| TC-C1-05 | Manager cannot use staff-only actions | P1 | E2E | S1 | manual | Manager cannot start staff opening as staff role | pending |
| TC-C1-06 | Invalid password shows error | P1 | E2E | S3 | manual | Wrong password → error, stay on login | pending |
| TC-C1-07 | Log out returns to login | P1 | E2E | S1 | fix-loop / smoke | Log out → `/login` | pending |
| TC-C1-08 | Production URL auth works | P0 | E2E | S3 | smoke @ Vercel | Same as C1-02/03 on public URL | pending |

---

## TC-C2 — Evidence upload

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-C2-01 | Start opening check creates draft shift | P0 | E2E | S1 | c3-loop | Staff → Start opening check → `/staff/shifts/:id` | pending |
| TC-C2-02 | Upload 3–8 photos | P0 | E2E | S1 | c3-loop | File input accepts images; previews/count update | pending |
| TC-C2-03 | Submit disabled until enough photos | P1 | E2E | S1 | manual | < min photos → Submit disabled | pending |
| TC-C2-04 | Submit creates `agent_jobs` waiting/running | P0 | API/E2E | S1 | c3-loop | After submit, job progresses | pending |
| TC-C2-05 | Photos stored in evidence bucket | P0 | API | S1 | function-log / Appwrite | `photoFileIds` resolve to Storage files | pending |
| TC-C2-06 | Kit upload (gap photos) | P0 | E2E | S2 | gemini-kit (planned) | Upload from `demo/photos/gap/` | pending |

---

## TC-C3 — Vision score agent (Gemini)

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-C3-01 | Job completes with ≥5 findings | P0 | E2E | S1 | c3-loop | After score, manager sees ≥5 rows | pending |
| TC-C3-02 | Each finding has clause_id + quote + confidence | P0 | Contract | S1 | c3-loop + UI | No empty clause/quote on AI rows | pending |
| TC-C3-03 | Status enum only pass\|gap\|unclear | P0 | Contract | S1 | API | Matches `FINDINGS_SCHEMA.json` | pending |
| TC-C3-04 | Default path uses Gemini (not silent stub) | P0 | API | S1 | function-log | Logs/mode show model path; not deterministic-only | pending |
| TC-C3-05 | Low confidence → unclear | P1 | API | S1 | manual / unit | Prompt rule: low conf cannot be silent pass | pending |
| TC-C3-06 | Gemini timeout/429 → job failed (default) | P0 | API | S1 | manual | Kill key/network → failed + event, not fake findings | pending |
| TC-C3-07 | Explicit stub flag only when ALLOW_DEMO_STUB_SCORES | P1 | API | S1 | manual | Flag off: no auto stub; flag on: documented path | pending |
| TC-C3-08 | Findings schema rejects unknown fields in parser | P2 | Unit | S1 | unit (planned) | Parser strips/fails extra keys safely | pending |
| TC-C3-09 | Gap kit → ≥1 gap finding (typical) | P0 | E2E | S2 | gemini-kit | Live score gap kit | pending |
| TC-C3-10 | Unclear kit → ≥1 unclear (typical) | P0 | E2E | S2 | gemini-kit | Live score unclear kit | pending |
| TC-C3-11 | Pass kit mostly pass (typical) | P1 | E2E | S2 | gemini-kit | Live score pass kit | pending |
| TC-C3-12 | Re-score after re-check updates finding | P0 | E2E | S4 | fix-loop | After re-check photo, finding updates | pending |

---

## TC-C4 — Scoreboard UI

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-C4-01 | Scoreboard shows Pass / Gap / Unclear | P0 | E2E | S1 | smoke / c3 | Chips or labels for all three statuses | pending |
| TC-C4-02 | No free-chat UI | P0 | E2E | S1 | smoke | No chat composer / SOP chat screen | pending |
| TC-C4-03 | Selecting a finding shows clause quote | P0 | E2E | S1 | smoke / boosts | Detail panel has quote | pending |
| TC-C4-04 | Status not color-only | P1 | E2E | S4 | manual | Text label present with color | pending |

---

## TC-C5 — Manager inbox + realtime

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-C5-01 | Manager sees submitted/scored shifts | P0 | E2E | S1 | smoke / c3 | Inbox lists shift after staff submit | pending |
| TC-C5-02 | Near-live update without full page reload | P1 | E2E | S1 | manual | Realtime or poll updates inbox | pending |
| TC-C5-03 | Open shift detail scoreboard | P0 | E2E | S1 | smoke | `/manager/shifts/:id` loads findings | pending |

---

## TC-C6 — Override + tasks + audit

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-C6-01 | Manager overrides finding with reason | P0 | E2E | S4 | fix-loop / boosts | Status changes; reason saved | pending |
| TC-C6-02 | Override writes audit event | P0 | API | S4 | Appwrite / UI trail | Event history shows override | pending |
| TC-C6-03 | Assign fix task to staff | P0 | E2E | S4 | fix-loop | Task open linked to finding | pending |
| TC-C6-04 | Mark task done | P1 | E2E | S4 | fix-loop | Task status done | pending |
| TC-C6-05 | Override reason required (or validated) | P1 | E2E | S4 | manual | Empty reason blocked or warned | pending |

---

## TC-C7 — Seed pack & demo content

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-C7-01 | Checklist has 6–8 items | P0 | API | S2 | Appwrite / UI | `opening_fs` items count | pending |
| TC-C7-02 | SOP PDF uploaded (not TODO fileId) | P0 | API | S2 | Appwrite | `cafe_sop_v1.fileId` real | pending |
| TC-C7-03 | demo/photos/pass has ≥4 images | P0 | Manual | S2 | filesystem | Real files, not only .gitkeep | pending |
| TC-C7-04 | demo/photos/gap has ≥3 images | P0 | Manual | S2 | filesystem | Real files | pending |
| TC-C7-05 | demo/photos/unclear has ≥3 images | P0 | Manual | S2 | filesystem | Glare/crop/dark | pending |
| TC-C7-06 | Demo accounts work | P0 | E2E | S1 | smoke | Both roles login | pending |

---

## TC-C8 — Compliance export

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-C8-01 | Export / print pack opens | P0 | E2E | S4 | boosts / smoke | Export route or print view | pending |
| TC-C8-02 | Pack includes scoreboard summary | P1 | E2E | S4 | boosts | Pass/gap/unclear counts or rows | pending |
| TC-C8-03 | Pack includes overrides / timestamps | P1 | E2E | S4 | boosts | Meta visible for audit story | pending |
| TC-C8-04 | 1-page friendly layout | P2 | Manual | S4 | print dialog | Fits demo narrative | pending |

---

## TC-BOOST — Score boosts

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-BOOST1-01 | Agent trace visible on scored shift | P1 | E2E | S4 | boosts | Steps: describe → match → score | pending |
| TC-BOOST2-01 | Unclear hero + audited override | P1 | E2E | S4 | boosts | Unclear item + reason after override | pending |
| TC-BOOST3-01 | Task → re-check photo path | P0 | E2E | S4 | fix-loop | Staff uploads re-check for open task | pending |
| TC-BOOST4-01 | Golden kits present in repo | P0 | Manual | S2 | filesystem | pass/gap/unclear kits | pending |
| TC-BOOST5-01 | Richer compliance PDF fields | P2 | E2E | S4 | boosts | Meta, gaps, overrides | pending |
| TC-BOOST6-01 | Repeat-offender strip (if data) | P2 | E2E | S4 | boosts | Strip renders or empty-safe | pending |

---

## TC-GOLD — Golden pre-scored shifts (failure insurance)

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-GOLD-01 | ≥1 golden scored shift in DB | P0 | API | S2 | Appwrite / manager UI | Manager opens without new AI run | pending |
| TC-GOLD-02 | Golden shift shows ≥5 findings | P0 | E2E | S2 | smoke | Scoreboard populated | pending |
| TC-GOLD-03 | Override + export work on golden shift | P0 | E2E | S4 | fix-loop / boosts | Video backup path | pending |

---

## TC-FULL — Full demo loop (video bar)

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-FULL-01 | Staff upload kit → Gemini score | P0 | E2E | S4 | c3 + gemini-kit | End-to-end live AI | pending |
| TC-FULL-02 | Manager override + assign | P0 | E2E | S4 | fix-loop | Task created | pending |
| TC-FULL-03 | Staff re-check → re-score | P0 | E2E | S4 | fix-loop | Finding updates | pending |
| TC-FULL-04 | Export pack | P0 | E2E | S4 | boosts | Pack available | pending |
| TC-FULL-05 | Full loop timed ≤5 minutes (manual) | P1 | Manual | S4 | stopwatch | Matches video script | pending |
| TC-FULL-06 | Failure drill: AI down → golden path | P1 | Manual | S4 | manual | No silent fake “live AI” claim | pending |

---

## TC-PKG — Packaging & security

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-PKG-01 | `.gitignore` allows web/ + functions/ | P0 | Manual | S3 | git check | Product code trackable | pending |
| TC-PKG-02 | No `.env` or API keys in git | P0 | Manual | S3 | `git grep` / status | Clean | pending |
| TC-PKG-03 | Root README is product-facing | P0 | Manual | S3 | readme review | Demo accounts + run + architecture | pending |
| TC-PKG-04 | Vercel has only VITE_ public vars | P0 | Manual | S3 | Vercel dashboard | No server keys in frontend | pending |
| TC-PKG-05 | Clone + npm install + dev works | P1 | Manual | S3 | local clone | Documented path | pending |
| TC-PKG-06 | Production smoke Playwright | P0 | E2E | S3 | smoke @ Vercel | C1 surfaces green | pending |

---

## TC-SEC — Safety (hackathon-level)

| ID | Case | Priority | Type | Session | Playwright | Steps / expected | Status |
|----|------|----------|------|---------|------------|------------------|--------|
| TC-SEC-01 | Vision key not in frontend bundle | P0 | Manual | S1 | build grep | No GOOGLE_AI in `web/dist` | pending |
| TC-SEC-02 | Demo passwords only in SEED/README demo section | P1 | Manual | S3 | review | Not reused elsewhere | pending |

---

## Unit / contract cases (implement when S1 codes scorer)

Target: small Node tests next to function or `web/src` pure helpers.

| ID | Case | Priority | Session | Suggested assert |
|----|------|----------|---------|------------------|
| TC-UNIT-01 | Parse valid Gemini JSON → findings rows | P0 | S1 | ≥1 item; enums valid |
| TC-UNIT-02 | Malformed JSON → throw / job failed path | P0 | S1 | No partial corrupt writes without fail |
| TC-UNIT-03 | Confidence &lt; threshold maps to unclear | P1 | S1 | Configurable threshold |
| TC-UNIT-04 | Image resize/cap before API (if implemented) | P2 | S1 | Payload size bound |
| TC-UNIT-05 | Clause quote non-empty after normalize | P1 | S1 | Empty quote rejected or filled from SOP map |

---

## Session exit checklist (copy into session notes)

### S1

- [ ] TC-C1-01, 02, 03  
- [ ] TC-C2-01, 02, 04  
- [ ] TC-C3-01, 02, 03, 04, 06  
- [ ] TC-C4-01, 02  
- [ ] TC-C5-01, 03  
- [ ] Playwright: `smoke` + `c3-loop` green  

### S2

- [ ] TC-C7-02..05  
- [ ] TC-C3-09, 10  
- [ ] TC-GOLD-01, 02  
- [ ] TC-BOOST4-01  
- [ ] Playwright: c3-loop (+ kit script if added), boosts  

### S3

- [ ] TC-PKG-01..04, 06  
- [ ] TC-C1-08  
- [ ] Playwright smoke on Vercel  

### S4

- [ ] TC-C6-01..03  
- [ ] TC-C8-01  
- [ ] TC-BOOST1-01, TC-BOOST3-01  
- [ ] TC-FULL-01..05  
- [ ] Full Playwright suite green  

### S5

- [ ] TC-FULL video recorded  
- [ ] TC-PKG README links final  
- [ ] Best-effort production smoke  

---

## Recording results

After each session, append a short note (or check boxes above) with:

```text
Session: S#
Date:
Base URL:
Scripts run:
PASS:
FAIL:
Blocked:
Next action:
```

Optional: keep console logs under `web/playwright-shots/<suite>/results.json` if the script writes them.
