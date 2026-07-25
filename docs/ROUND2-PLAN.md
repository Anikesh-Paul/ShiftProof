# Round 2 delivery plan — ShiftProof (Showcase Max)

> **Status:** FROZEN (2026-07-25)  
> **Source of truth** for multi-session work until Round 2 submit (Jul 28).  
> Product spec remains [`PROJECT.md`](../PROJECT.md). Test catalog: [`TEST-CASES.md`](./TEST-CASES.md).

---

## 1. Goal

Ship **Showcase Max** for Round 2:

| Deliverable | Required |
|-------------|----------|
| Working MVP (full loop) | Yes |
| Real multimodal vision scoring (Gemini Flash) | Yes |
| Demo kits + SOP in Appwrite | Yes |
| Public GitHub (product monorepo) | Yes |
| Judge-facing root README | Yes |
| Public host (Vercel) | Yes (cut only under ladder) |
| Demo video 3–5 min (full loop) | Yes |
| Polish (trace, PDF, motion) | Yes if core path green |
| Playwright CLI verification after each session | Yes |
| Test cases executed / extended per session | Yes |

### Round 2 scoring (reminder)

| Criterion | Weight |
|-----------|--------|
| Technical Implementation | 30% |
| AI Integration, Innovation & Real-world Impact | 25% |
| User Experience & Design | 15% |
| Feasibility & Scalability | 15% |
| Final Pitch & Demo | 15% |

---

## 2. Frozen decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Quality bar | **Showcase Max** |
| 2 | Time-slip ladder | **Credibility-first** (see §3) |
| 3 | Vision | **Gemini Flash via Google AI Studio** (`GOOGLE_AI_API_KEY` on Function only). GCP $300 credits only if free tier blocks. |
| 4 | Session order | **AI spine first** (S1 → S5 below) |
| 5 | Scoring failure | **No silent auto-stub.** Optional **explicit** emergency fallback (`ALLOW_DEMO_STUB_SCORES`). **Golden pre-scored shifts** for video insurance. |
| 6 | Demo photos | **Grok Imagine** → `demo/photos/{pass,gap,unclear}/` |
| 7 | Hosting | **Vercel** for `web/` (public `VITE_APPWRITE_*` only) |
| 8 | GitHub | **Product monorepo** + product root README; never commit secrets |
| 9 | Video script | **Full loop**: problem → upload → Gemini scoreboard → agent trace → override → assign → re-check → re-score → export PDF |
| 10 | Verification | **Playwright CLI** after each session; cases in [`TEST-CASES.md`](./TEST-CASES.md) |

**ADRs:**

- [`docs/adr/0001-gemini-flash-ai-studio-for-scoring.md`](./adr/0001-gemini-flash-ai-studio-for-scoring.md)
- [`docs/adr/0002-scoring-failure-and-golden-shifts.md`](./adr/0002-scoring-failure-and-golden-shifts.md)

---

## 3. Credibility-first cut ladder

If time runs out, cut in this order (first = drop first):

1. Motion / visual polish  
2. PDF chrome / extra report flourishes  
3. Deep agent-trace polish  
4. Public host (only if video + GitHub are excellent)  
5. **Never cut:** real Gemini path, photo kits, GitHub, product README, dry-run, video  

Silent auto-stub scoring must **not** appear as the “live AI” segment in the submitted video.

---

## 4. Hard constraints

### Do

- One vertical: café opening food-safety checklist  
- Scoreboard only (Pass / Gap / Unclear) — no free chat  
- Vision keys only in Appwrite Function env  
- Frozen field names: `docs/FINDINGS_SCHEMA.json`, `docs/APPWRITE.md`, `types/shiftproof.ts`

### Do not

- Second industry, multi-site, checklist builder, analytics dashboard  
- Commit `.env`, API keys, Appwrite server keys  
- Lead with GCP/Vertex setup before a working AI Studio key  

### Repo packaging note (S3 must fix)

Root [`.gitignore`](../.gitignore) currently ignores `web/` and `functions/` among other paths. **S3 must fix `.gitignore`** so the product monorepo can actually be committed publicly without leaking secrets.

---

## 5. Session plan (execute one-by-one)

Each session ends only when **exit criteria + Playwright gate** pass (or failures are listed with severity).

---

### Session 1 — Real Gemini scoring (AI spine)

**Goal:** Default production path scores with Gemini Flash; happy path is not deterministic stub.

| Step | Work |
|------|------|
| 1.1 | Google AI Studio key → Function env `GOOGLE_AI_API_KEY` only |
| 1.2 | Rewrite `functions/runShiftScore`: Storage photos + checklist → Gemini Flash → `FINDINGS_SCHEMA` → findings/job/events |
| 1.3 | Low confidence → `unclear`; API/parse failure → job `failed` (default) |
| 1.4 | Client: prefer Function; disable silent stub as default |
| 1.5 | Optional explicit fallback: `ALLOW_DEMO_STUB_SCORES=1` (documented, off for recording) |
| 1.6 | Deploy Function; UI smoke submit |

**Exit criteria**

- [ ] Staff submit → job `waiting` → `running` → `done`  
- [ ] ≥5 findings with `clause_id`, `quote`, `confidence`, `status`  
- [ ] Findings vary with evidence (not fixed index pattern alone)  
- [ ] Default path does not silent-stub on success  

**Playwright gate (S1)**

```powershell
cd web
npm run dev
# other terminal, after dev is up:
node scripts/playwright-smoke.mjs http://localhost:5173
node scripts/playwright-c3-loop.mjs http://localhost:5173
```

Map to cases: **TC-C1-***, **TC-C2-***, **TC-C3-*** in [`TEST-CASES.md`](./TEST-CASES.md).  
After Gemini is live, extend C3 script (or add `playwright-gemini-kit.mjs`) to upload **real kit images** when available (S2).

**Manual / API checks (S1)**

- [ ] Function logs show Gemini call (not only stub branch)  
- [ ] `ALLOW_DEMO_STUB_SCORES` unset → API down → job `failed` (or explicit UI), not silent pass mix  

---

### Session 2 — Demo kits + SOP (C7)

**Goal:** Judge-ready evidence + rule book; golden shifts for insurance.

| Step | Work |
|------|------|
| 2.1 | Grok Imagine: pass (4–6), gap (3–5), unclear (3–4) → `demo/photos/...` |
| 2.2 | Café SOP PDF (FS-01… clauses aligned to checklist) |
| 2.3 | Upload to `sop_files`; set `sops.cafe_sop_v1.fileId` |
| 2.4 | Live-score each kit; tune prompt if needed |
| 2.5 | Seed **1–2 golden pre-scored shifts** for video backup |

**Exit criteria**

- [ ] Three kits on disk with real image files (not only `.gitkeep`)  
- [ ] SOP `fileId` ≠ `TODO_UPLOAD_SOP_PDF`  
- [ ] Gap kit produces ≥1 `gap`; unclear kit produces ≥1 `unclear` (typical)  
- [ ] Manager can open a golden scored shift without a fresh AI run  

**Playwright gate (S2)**

```powershell
# Prefer kit images once present:
node scripts/playwright-c3-loop.mjs http://localhost:5173
node scripts/playwright-boosts.mjs http://localhost:5173
# After golden shift seed:
node scripts/playwright-fix-loop.mjs http://localhost:5173
```

Map to: **TC-C7-***, **TC-BOOST4-***, **TC-GOLD-***.

---

### Session 3 — Package (GitHub + README + Vercel)

**Goal:** Judges can find, clone, run, and click.

| Step | Work |
|------|------|
| 3.1 | Fix `.gitignore` for product monorepo; keep secrets out |
| 3.2 | Root product README (problem, stack, demo accounts, run, architecture, links) |
| 3.3 | De-emphasize idea-factory as internal |
| 3.4 | First commits + public GitHub remote |
| 3.5 | Vercel deploy `web/` with `VITE_APPWRITE_*` only |
| 3.6 | README links: repo, live URL, video placeholder |

**Exit criteria**

- [ ] Public clone includes `web/`, `functions/runShiftScore/`, `docs/`, `demo/photos/`  
- [ ] No secrets in git history  
- [ ] Live HTTPS login with demo accounts  
- [ ] Product README is root front door  

**Playwright gate (S3)**

```powershell
# Against production URL after Vercel deploy:
node scripts/playwright-smoke.mjs https://YOUR-VERCEL-URL
```

Map to: **TC-PKG-***, **TC-C1-*** on production base URL.

---

### Session 4 — Polish + full dry-run

**Goal:** Full video script works; polish only if path is green.

| Step | Work |
|------|------|
| 4.1 | Full loop dry-run (script §6) timed |
| 4.2 | Failure drill: API down → explicit fallback or golden shift |
| 4.3 | Polish if 4.1 green: trace UX, PDF, motion (`plans/`) |
| 4.4 | Bugfix from dry-run; re-verify |

**Exit criteria**

- [ ] One clean full-loop rehearsal  
- [ ] Documented fallback if live AI fails mid-take  
- [ ] Playwright suite green on local (and production if stable)  

**Playwright gate (S4)**

```powershell
node scripts/playwright-smoke.mjs http://localhost:5173
node scripts/playwright-c3-loop.mjs http://localhost:5173
node scripts/playwright-fix-loop.mjs http://localhost:5173
node scripts/playwright-boosts.mjs http://localhost:5173
```

Map to: **TC-FULL-***, **TC-C6-***, **TC-BOOST3-***, **TC-C8-***.

---

### Session 5 — Record & submit

**Goal:** Round 2 artifacts complete.

| Step | Work |
|------|------|
| 5.1 | Record 3–5 min full-loop video (live preferred) |
| 5.2 | If live fails: golden shift path + narration; keep backup take |
| 5.3 | README: video link + final URLs |
| 5.4 | Submission checklist complete |
| 5.5 | Code freeze; hotfix only if portal requires |

**Exit criteria**

- [ ] GitHub · README · 3–5 min video · working MVP (+ host)  
- [ ] Final Playwright smoke on live URL (best effort)  

**Playwright gate (S5)**

```powershell
node scripts/playwright-smoke.mjs https://YOUR-VERCEL-URL
```

---

## 6. Video script (full loop, 3–5 min)

| Time (guide) | On screen |
|--------------|-----------|
| 0:00–0:20 | Problem: WhatsApp photo chaos / SOPs ignored |
| 0:20–0:50 | Staff login → start opening check → upload gap or mixed kit |
| 0:50–1:40 | Gemini scoring → scoreboard Pass/Gap/Unclear + clause quotes |
| 1:40–2:00 | Agent trace (boost #1) |
| 2:00–2:40 | Manager override + reason; assign fix |
| 2:40–3:40 | Staff re-check photo → re-score |
| 3:40–4:30 | Export 1-page compliance pack |
| 4:30–5:00 | Scale story (pitch only): more SOP packs / multi-site later |

**Backup:** open golden pre-scored shift → override → export; narrate that AI already produced findings.

---

## 7. Playwright CLI — standard operating procedure

### Prerequisites

- Dev server or Vercel URL  
- Demo accounts from [`SEED.md`](./SEED.md)  
- Playwright installed (scripts currently resolve global `@playwright/test`; S3/S4 may vendor it into `web/` for reproducibility)

### Existing scripts (`web/scripts/`)

| Script | Purpose | Session |
|--------|---------|---------|
| `playwright-smoke.mjs` | C1–C8 surfaces, login both roles | All |
| `playwright-c3-loop.mjs` | Staff submit → score → manager findings | S1, S2, S4 |
| `playwright-fix-loop.mjs` | Assign → re-check → done | S2, S4 |
| `playwright-boosts.mjs` | Boost UI surfaces | S2, S4 |
| `playwright-staff-opening.mjs` | Staff opening flow | S1+ |
| Others (`ui-audit*`, `shot-*`) | Design/debug | Optional polish |

### Command template

```powershell
cd C:\Users\kamal\Desktop\JammuHackathon\web
npm run dev
# separate terminal:
node scripts/playwright-smoke.mjs http://localhost:5173
node scripts/playwright-c3-loop.mjs http://localhost:5173
node scripts/playwright-fix-loop.mjs http://localhost:5173
node scripts/playwright-boosts.mjs http://localhost:5173
```

Shots land under `web/playwright-shots/<suite>/`. Treat **PASS/FAIL console lines** as the gate; screenshots are evidence.

### Planned script upgrades (implement during sessions)

| New / extended | When | Why |
|----------------|------|-----|
| Kit-aware C3 (`playwright-gemini-kit.mjs` or extend c3) | S2 | Upload real `demo/photos/*` files |
| Assert no silent stub markers | S1 | e.g. findings not all matching old deterministic pattern; or job payload mode ≠ stub |
| Production smoke npm script | S3 | `node scripts/playwright-smoke.mjs $env:PLAYWRIGHT_BASE_URL` |
| Optional: `@playwright/test` in `web/package.json` | S3 | Stop depending on global install path |

---

## 8. Subagent & skill map

| Session | Primary | Optional subagents | Skills |
|---------|---------|--------------------|--------|
| S1 | Implement Function + client | explore (API/schema), general-purpose (prompt/JSON) | Appwrite MCP if needed |
| S2 | Kits + SOP + golden seed | Imagine batch for photos | `imagine` / image_gen |
| S3 | README + git + Vercel | explore (secret leak scan) | — |
| S4 | Dry-run + polish | check-work / review | verification-before-completion |
| S5 | Record checklist | — | — |

**Rule:** Do not invent Appwrite tables/columns. Update `docs/` first if schema must change.

---

## 9. Secrets & env

| Where | Vars |
|-------|------|
| Local / Function only (never commit) | `GOOGLE_AI_API_KEY`, `APPWRITE_API_KEY` |
| Frontend (Vercel + `.env.example`) | `VITE_APPWRITE_ENDPOINT`, `VITE_APPWRITE_PROJECT_ID` |
| Optional Function | `ALLOW_DEMO_STUB_SCORES=1` (explicit emergency only) |

---

## 10. Submission checklist (Round 2)

- [ ] Public GitHub repo (product monorepo)  
- [ ] Product README (run + demo accounts + architecture + links)  
- [ ] Working MVP with **real** Gemini scoring  
- [ ] Demo kits + SOP uploaded  
- [ ] Vercel URL (or justified cut)  
- [ ] Demo video 3–5 min (full loop)  
- [ ] Playwright gates recorded for S1–S4 (notes or CI-less log)  
- [ ] No free chat / no second industry  

---

## 11. How to start the next coding session

```text
Read docs/ROUND2-PLAN.md and docs/TEST-CASES.md.
We are on Session 1 — Real Gemini scoring.
Do not start Session 2 until S1 exit criteria + Playwright gate pass.
Follow AGENTS.md: surgical changes, no scope creep.
```

---

## 12. Related docs

| File | Role |
|------|------|
| [`PROJECT.md`](../PROJECT.md) | Product specification |
| [`TEST-CASES.md`](./TEST-CASES.md) | Full test catalog |
| [`API.md`](./API.md) | Allowed operations |
| [`APPWRITE.md`](./APPWRITE.md) | Live IDs |
| [`SEED.md`](./SEED.md) | Demo accounts & seed |
| [`FINDINGS_SCHEMA.json`](./FINDINGS_SCHEMA.json) | AI JSON contract |
| [`../CONTEXT.md`](../CONTEXT.md) | Domain glossary |
| [`../web/README.md`](../web/README.md) | Frontend slice status |
