# ShiftProof

**Photo-proof SOP compliance for a single café.**  
Staff upload opening-shift photos → AI scores checklist items (Pass / Gap / Unclear) with SOP clause quotes → managers override, assign fixes, and export a one-page compliance pack.

Built for **AI First Hackathon · IIT Jammu · Round 2 (Showcase Max)**.

| | |
|--|--|
| **Live app** | _Vercel URL — set after deploy (see Links)_ |
| **Video** | _3–5 min demo — link TBD (Session 5)_ |
| **Repo** | [github.com/Anikesh-Paul/ShiftProof](https://github.com/Anikesh-Paul/ShiftProof) |

---

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Staff | `staff@shiftproof.demo` | `DemoStaff123!` |
| Manager | `manager@shiftproof.demo` | `DemoManager123!` |

Hackathon demo only — rotate before any real production use. Details: [`docs/SEED.md`](docs/SEED.md).

**Golden shifts (no live AI):** open as manager  
`/manager/shifts/golden_gap_open` or `/manager/shifts/golden_pass_open`.

---

## Quick start (frontend)

```powershell
cd web
copy .env.example .env   # already has public Appwrite endpoint + project id
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) → log in with a demo account.

**Public env only (safe in Vercel):**

```
VITE_APPWRITE_ENDPOINT=https://sgp.cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=6a5b0ce3002605c7a776
```

Never put `GOOGLE_AI_API_KEY` or Appwrite server keys in `web/` or Vercel frontend env.

---

## What you get in this monorepo

| Path | Contents |
|------|----------|
| [`web/`](web/) | React + Vite client (staff + manager) |
| [`functions/runShiftScore/`](functions/runShiftScore/) | Appwrite Function — **Gemini Flash** vision scoring |
| [`docs/`](docs/) | API, Appwrite IDs, schema, Round 2 plan, test cases |
| [`demo/photos/`](demo/photos/) | Pass / gap / unclear photo kits |
| [`demo/Cafe_Food_Safety_Opening_SOP_v1.pdf`](demo/Cafe_Food_Safety_Opening_SOP_v1.pdf) | Opening SOP (FS-01…) |
| [`types/shiftproof.ts`](types/shiftproof.ts) | Shared types |
| [`PROJECT.md`](PROJECT.md) | Full product specification |

---

## Architecture

```
Staff photos → Appwrite Storage (evidence)
            → Function runShiftScore
                 → Gemini Flash (GOOGLE_AI_API_KEY on Function only)
                 → findings: pass | gap | unclear + clause + quote + confidence
            → Manager scoreboard → override / tasks → re-check → export PDF
```

- **Scoreboard only** — no free chat.  
- **Failure policy:** Gemini errors → job `failed` (no silent stub). Optional `ALLOW_DEMO_STUB_SCORES=1` on the Function only.  
- **ADRs:** [`docs/adr/`](docs/adr/)

### Deploy Function (maintainers)

```powershell
# Root .env (never commit): APPWRITE_API_KEY, GOOGLE_AI_API_KEY
.\functions\runShiftScore\deploy.ps1
.\functions\runShiftScore\set-vars.ps1
```

See [`functions/runShiftScore/README.md`](functions/runShiftScore/README.md).

### Demo kits & SOP seed

```powershell
node demo/build-sop-pdf.mjs
node demo/seed-s2.mjs
node demo/live-score-kit.mjs gap
```

---

## Smoke the product

```powershell
cd web
npm run dev
# other terminal:
node scripts/playwright-smoke.mjs http://localhost:5173
node scripts/playwright-c3-loop.mjs http://localhost:5173
node scripts/playwright-boosts.mjs http://localhost:5173
```

Plan & cases: [`docs/ROUND2-PLAN.md`](docs/ROUND2-PLAN.md) · [`docs/TEST-CASES.md`](docs/TEST-CASES.md).

---

## Stack

| Layer | Choice |
|-------|--------|
| UI | React, Vite, TypeScript |
| Backend | Appwrite (Auth, TablesDB, Storage, Functions, Realtime) |
| Vision | Gemini Flash via Google AI Studio (Function env) |
| Host | Vercel (`web/` only) |

Region endpoint: **Singapore** (`https://sgp.cloud.appwrite.io/v1`).

---

## Links

| Resource | URL |
|----------|-----|
| GitHub | https://github.com/Anikesh-Paul/ShiftProof |
| Live demo | _TBD — deploy `web/` to Vercel with `VITE_APPWRITE_*` only_ |
| Demo video | _TBD (Session 5)_ |
| Spec | [`PROJECT.md`](PROJECT.md) |
| Domain language | [`CONTEXT.md`](CONTEXT.md) |

### Vercel deploy (`web/` only)

```powershell
cd web
# once: vercel login
vercel --prod
# Project settings → Environment Variables (Production):
#   VITE_APPWRITE_ENDPOINT=https://sgp.cloud.appwrite.io/v1
#   VITE_APPWRITE_PROJECT_ID=6a5b0ce3002605c7a776
```

Then in **Appwrite Console → Auth → Settings → Platforms**, add the Vercel HTTPS origin (Web platform) so browser login is not CORS-blocked.

Internal ideation notes (not the product): [`docs/INTERNAL-HACKATHON-FACTORY.md`](docs/INTERNAL-HACKATHON-FACTORY.md).
