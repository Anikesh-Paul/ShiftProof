# ShiftProof

**Photo-proof SOP compliance for a single café.**  
Staff upload opening-shift photos → AI scores checklist items (Pass / Gap / Unclear) with SOP clause quotes → managers review Today / Backlog, override or reject a check, assign fixes (including all of today’s gaps), retry or fail a stale score, and export a one-page compliance pack.

Built for **AI First Hackathon**.

| | |
|--|--|
| **Live app** | [shift-proof-phi.vercel.app](https://shift-proof-phi.vercel.app) |
| **Repo** | [github.com/Anikesh-Paul/ShiftProof](https://github.com/Anikesh-Paul/ShiftProof) |

---

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Staff | `staff@shiftproof.demo` | `DemoStaff123!` |
| Manager | `manager@shiftproof.demo` | `DemoManager123!` |

Hackathon demo only — rotate before any real production use.


---

## Quick start (frontend)

```powershell
cd web
# create web/.env with the public vars below
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
| [`types/shiftproof.ts`](types/shiftproof.ts) | Shared types |

---

## Architecture

```
Staff photos → Appwrite Storage (evidence)
            → Function runShiftScore
                 → Gemini Flash (GOOGLE_AI_API_KEY on Function only)
                 → findings: pass | gap | unclear + clause + quote + confidence
            → Staff scores (read-only) + manager scoreboard → override / reject / tasks → re-check → export PDF
```

- **Scoreboard only** — no free chat.  
- **One staff draft at a time** — Opening resumes the latest draft instead of creating another.  
- **Failure policy:** Gemini errors → job `failed` (no silent stub). Optional `ALLOW_DEMO_STUB_SCORES=1` on the Function only. Staff can retry a stuck score from the shift page. A manager inbox/scoreboard load marks `waiting`/`running` jobs older than 10 minutes `failed` (shift stays submitted so Retry still works).

### Deploy Function (maintainers)

```powershell
# Root .env (never commit): APPWRITE_API_KEY, GOOGLE_AI_API_KEY
.\functions\runShiftScore\deploy.ps1
.\functions\runShiftScore\set-vars.ps1
```

See [`functions/runShiftScore/README.md`](functions/runShiftScore/README.md).

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
