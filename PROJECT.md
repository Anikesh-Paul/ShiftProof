# ShiftProof — Project Details

> **Official project specification** for the IIT Jammu AI First Hackathon (Summer School 2026).  
> This file is the single source of truth for *what we are building*.  
> For plain-English onboarding, see [`explanation.md`](explanation.md).  
> For idea-selection history, see [`output/FINAL-SHORTLIST.md`](output/FINAL-SHORTLIST.md).

---

## 1. Project identity

| Field | Value |
|--------|--------|
| **Product name** | **ShiftProof** |
| **One-liner** | Staff upload shift photos → AI scores them against café SOP rules → manager sees a live gap scoreboard → fix tasks → export a 1-page audit pack |
| **Pitch hook** | “WhatsApp photo compliance becomes an auditable, clause-cited shift scoreboard your manager can trust in under a minute.” |
| **Primary track** | **AI for Industry, Business & Productivity** |
| **Hackathon** | AI First Hackathon @ Summer School 2026 — IIT Jammu · Techible · IIC–IIT Jammu |
| **Format** | Online · team of 2–3 |
| **Prize pool** | ₹30,000 + AI credits + mentorship + goodies |
| **Team score (idea factory)** | **8.35 / 10** (highest shortlisted) |
| **Feasibility** | **GO** (high confidence for 4-day MVP) |
| **Winning capacity** | **High** |
| **MVP vertical** | **Café food-safety opening checklist only** (one industry, one site) |
| **Status** | **Locked recommendation** — build this; do not thrash ideas after proposal work starts |

### Tech themes hit (hackathon requirement)

1. Generative AI & Large Language Models (LLMs)  
2. AI Agents & Automation Frameworks  
3. Multimodal AI (vision + text)

---

## 2. Problem statement

### Who suffers?

Owner-managers of **small operations (≈5–50 people)** — especially cafés, food counters, campus messes, and similar shops — who already have written SOPs (rule books) that staff rarely follow in practice.

### What goes wrong today?

| Today | Why it fails |
|-------|----------------|
| SOPs live as PDFs nobody opens | Rules exist on paper, not in daily ops |
| “Proof” is random **WhatsApp photos** | Messy, not linked to clauses, hard to search later |
| Manager must **trust** staff | “I hope they did it” ≠ evidence |
| Pre-inspection panic cleanups | No day-to-day gap log across shifts |
| Enterprise QMS tools | Too expensive / complex for MSMEs |

### Why now?

- Multimodal models can map **messy phone photos** to SOP clauses without training a custom CV model.
- A multi-role web product (staff + manager) + storage + jobs is realistic in days on **Appwrite Pro**.
- India MSME hygiene/quality pressure is real **without** needing a government or hospital partnership.

---

## 3. Solution overview

**ShiftProof** turns chaotic photo “proof” into a **structured shift scoreboard**:

```
Staff photos → Storage → AI agent (vision + SOP clauses)
        → Pass / Gap / Unclear + clause quote + confidence
        → Manager live inbox → override / assign fix
        → (optional) re-check photo → re-score item
        → 1-page compliance pack PDF + audit history
```

### Full user journey (5 steps)

1. Manager has a **café food-safety SOP PDF** and a **6–8 item opening checklist** ready (seeded for MVP).  
2. Staff starts an **opening shift check** and uploads **3–8 photos**.  
3. AI scores each checklist item as **Pass / Gap / Unclear**, with **clause ID + quote + confidence**.  
4. Manager sees red gaps live, can **override AI**, leave a reason, and **assign a fix**.  
5. System exports a **1-page audit pack** and keeps an **event history** (what AI said vs what manager decided).

### What we are *not* building

| Out of scope (hard freeze) |
|----------------------------|
| Second industry (factory, hospital, multi-vertical QMS) |
| Free chat with the SOP |
| Voice notes, email/SMS polish |
| Custom checklist builder UI (seed JSON is enough) |
| Full analytics dashboard |
| Certification / “you will pass inspection” claims |
| Hardware sensors, native mobile app stores |
| Model training / custom CV pipelines |

---

## 4. Users & roles

| Role | Primary actions |
|------|-----------------|
| **Staff** | Log in → start shift check → upload 3–8 photos → (boost) upload one re-check photo after a fix |
| **Manager** | Log in → live gap inbox / scoreboard → override AI → assign fix task → export compliance pack |

**MVP tenancy:** one demo café (one org, one site). No multi-site enterprise tenancy required for the hackathon.

---

## 5. Features

### 5.1 Core MVP (must ship) — C1–C8

| # | Feature | Done when |
|---|---------|-----------|
| **C1** | Appwrite shell + auth | Staff and manager can log into role-specific screens |
| **C2** | Evidence upload | Staff starts shift → uploads 3–8 photos → `agent_jobs` row created |
| **C3** | Vision score agent | Function returns ≥5 structured findings |
| **C4** | Scoreboard UI | Pass / Gap / Unclear table — **no free chat** |
| **C5** | Manager inbox | Realtime (or near-live) results; second role login works |
| **C6** | Override + tasks | Manager can correct AI, assign ≥1 fix; audit `events` saved |
| **C7** | Vertical seed pack | Café SOP PDF + 6–8 checklist items + demo photos in repo |
| **C8** | Compliance export | 1-page PDF + ready demo accounts |

### 5.2 Score-boost features (after core only) — #1–#6

Implement **in order**. If short on time: **1 → 2 → 3** first, then **4 → 5 → 6**.

| # | Feature | Why it helps judges |
|---|---------|---------------------|
| **1** | Agent trace + forced citations | Visible steps; every row has clause_id + quote + confidence |
| **2** | Hero Unclear + audited override | Honest AI; manager reason saved; glare photo in demo |
| **3** | Task → re-check photo | Full gap → fix → proof loop |
| **4** | Golden multi-photo demo pack | All-pass / clear-fail / unclear kits; whole-set score |
| **5** | Audit-ready compliance PDF | Meta, scoreboard, gaps, overrides, timestamps |
| **6** | Repeat-offender strip | e.g. “No gloves: 3/5 recent shifts” (tiny panel only) |

### 5.3 “Done” checklist

**Core done when:**

- [ ] Staff can log in, start a shift, upload photos  
- [ ] AI finishes with ≥5 item results  
- [ ] Manager can log in and see scoreboard / inbox  
- [ ] Manager can override and assign at least one fix  
- [ ] Important actions are in audit history  
- [ ] Demo SOP + checklist + photos are in the project  
- [ ] 1-page report downloads  
- [ ] There is **no** free chat screen  

---

## 6. Tech stack

| Layer | Choice |
|-------|--------|
| **Frontend** | Web app — React / Next.js (or similar) |
| **Backend** | **Appwrite Pro** (Auth, Databases, Storage, Functions, Realtime) |
| **AI** | One multimodal LLM API (e.g. GPT-4o / Claude vision / Gemini Flash) — **do not train models** |
| **Build tools** | Grok Build / Claude Code / Codex / OpenCode |
| **Languages** | English UI first |
| **Hosting** | Public web link for judges (as needed) |

### Appwrite service map

| Service | Use |
|---------|-----|
| **Auth** | Email/password; roles `staff` \| `manager` |
| **Database** | `sites`, `sops`, `checklist_templates` / checklists, `shifts`, `findings`, `tasks`, `agent_jobs`, `events` |
| **Storage** | SOP PDFs; evidence photos (and re-check photos) |
| **Functions** | `runShiftScore` (+ optional re-score-one-item) |
| **Realtime** | Manager inbox + job status (“agent working”) |
| **Messaging** | Cut for MVP |

---

## 7. AI architecture

### Pipeline

```
Staff photos → Appwrite Storage
     → Function: multimodal LLM (structured JSON)
     → findings: { item, status, clause_id, quote, confidence, evidence_note }
     → Manager Realtime inbox → override / assign task
     → (boost) re-check photo → re-score item → audit
     → Export 1-page pack + events log
```

### Agent steps (visible for boost #1)

1. Describe photos (scene understanding)  
2. Match checklist items to SOP clauses  
3. Score each item: `pass` | `gap` | `unclear`  
4. Write structured findings  
5. If low confidence → **human review** (do not silently guess)

### What is AI vs what is not

| AI does | App / product does |
|---------|-------------------|
| Understand photos | Auth & roles |
| Match evidence to clauses | Checklist + photo storage |
| Pass / Gap / Unclear + confidence | Tasks, scoreboard UI, PDF export |
| Optional re-score after fix photo | Audit log schema, realtime feed |

### Fixed findings JSON schema

```json
{
  "items": [
    {
      "id": "gloves_worn",
      "status": "pass | gap | unclear",
      "clause_id": "FS-04",
      "quote": "Short quote from the SOP clause…",
      "confidence": 0.0,
      "evidence_note": "What the model thinks it saw"
    }
  ]
}
```

**Golden rule:** Low confidence → `unclear` + manager decides. Never silent Pass/Fail.

### Pragmatic AI notes

- Prefer **one multimodal model**, one structured JSON pass over the **whole photo set**.  
- For a short café SOP, chunk text at ingest; **skip vector DB** if time is tight.  
- Freeze schema on Day 1 and do not change field names mid-hackathon.

---

## 8. Data model (logical)

| Record | Meaning |
|--------|---------|
| **Site** | One demo café |
| **SOP** | Rule-book file + metadata |
| **Checklist** | 6–8 opening items to prove with photos |
| **Shift** | One shift-check session |
| **Finding** | Score for one checklist item |
| **Task** | “Please fix this” job |
| **Agent job** | waiting / running / done / failed |
| **Event** | Audit: what AI said, what manager changed |

---

## 9. Demo content pack (non-optional)

Weak content makes the product look ordinary. Treat this as equal priority to code.

| Asset | Target quality |
|-------|----------------|
| **SOP PDF** | 10–20 clear café hygiene / opening rules with clause IDs |
| **Checklist** | 6–8 photo-provable items |
| **All-good photos** | Clean, clearly correct scenes |
| **Problem photos** | Obvious fails (no gloves, dirty counter, missing sanitizer) |
| **Unclear photo** | Glare, too dark, or partial scene |
| **Demo accounts** | One staff + one manager login |

---

## 10. Build plan (4 days)

| Day | Core ship | Boosts if core early |
|-----|-----------|----------------------|
| **D1** | Appwrite project, schema, auth, React shell, upload smoke, 1 vision call on fixed image; freeze JSON schema | Start golden pack (#4) |
| **D2** | Seed SOP + checklist → multi-photo → ≥5 findings with citations → scoreboard | Agent trace + forced citations (#1); finish photo kits (#4) |
| **D3** | Manager override, tasks, audit events, Realtime, second role | Unclear hero + audited override (#2); start re-check (#3) |
| **D4** | Demo accounts, PDF export, pitch script, README, backup video/screenshots | Finish re-check (#3); polish PDF (#5); strip (#6) if time |

### Suggested split (2–3 people)

| Person | Focus |
|--------|--------|
| **A** | Backend + AI function (schema, Storage, `runShiftScore`, confidence rules) |
| **B** | Frontend (upload, scoreboard, manager inbox, overrides) |
| **C** (or A/B share) | SOP, checklist, demo photos, PDF polish, pitch, README |

### Daily discipline

1. Happy path first  
2. Then real auth/storage/jobs  
3. Then Unclear / failure path  
4. Then polish and extras  

### Live demo failure modes

| Failure | Mitigation |
|---------|------------|
| Vision misreads | Pre-tested photos; show Unclear + override as product feature |
| Function timeout | Smaller images; short path; backup recording |
| API / network down | Screenshots + recorded demo video |
| Looks like chatbot | Never add free chat — only scoreboard |

---

## 11. Demo script (~90 seconds)

| Time | Audience sees |
|------|----------------|
| 0:00 | WhatsApp photo chaos (problem) |
| 0:15 | Staff uploads messy counter photos |
| 0:40 | Scoreboard: green / red / yellow (unclear) + rule quotes |
| 1:00 | Manager assigns a fix (optional re-photo) |
| 1:15 | Glare photo → **Unclear** (feature, not bug) |
| 1:25 | Download 1-page compliance pack |

### Finale live demo (7 min) story arc

1. Problem (WhatsApp mess)  
2. Staff photo path  
3. AI scoreboard with citations  
4. Unclear + human override  
5. Fix task (+ re-check if ready)  
6. Export pack  
7. Scale story (more SOP packs / multi-site — **pitch only**, not built)

---

## 12. Hackathon timeline & submissions

| Phase | Window | Deliverable |
|-------|--------|-------------|
| Pre-hackathon | Jul 3–14 | Registration, team of 2–3 |
| **Round 1 — Idea & Proposal** | Jul 15–21 | PDF proposal **≤5 pages** + video pitch **≤1.5 min** |
| **Round 2 — Prototype / MVP** | Jul 23–28 | GitHub repo, README, demo video **3–5 min**, working MVP |
| **Grand Finale** | Jul 30–31 | **7-min** live demo + **3-min** Q&A |

### Round 1 scoring (how ShiftProof answers)

| Criterion | Weight | Our answer |
|-----------|--------|------------|
| Innovation & Creativity | 30% | Closed photo→score→task→pack loop, not chat |
| Problem Relevance | 20% | MSME SOP + WhatsApp “proof” is real |
| AI-First Approach | 20% | Product dies without vision + clause scoring |
| Feasibility & Scalability | 15% | One café now; packs / multi-site later |
| Presentation & Communication | 15% | Clear 90s demo story |

### Round 2 scoring (MVP)

| Criterion | Weight |
|-----------|--------|
| Technical Implementation | 30% |
| AI Integration, Innovation & Real-world Impact | 25% |
| User Experience & Design | 15% |
| Feasibility & Scalability | 15% |
| Final Pitch & Demo | 15% |

### Finale scoring

| Criterion | Weight |
|-----------|--------|
| Live Prototype Performance | 30% |
| Business Model & Real-world Scalability | 25% |
| Defence of Technical Architecture | 20% |
| Pitch Delivery & Time Management | 25% |

### Proposal PDF outline (≤5 pages)

1. Problem: rules exist; proof is chaotic WhatsApp photos  
2. Users: staff + owner/manager  
3. Solution + AI flow diagram (include Unclear / HITL)  
4. Stack: Appwrite Pro + multimodal LLM + web app  
5. Feasibility: 4-day vertical slice + scale path  
6. Team + demo plan  

### Claims to avoid

- “We guarantee you pass official inspections”  
- Fake ultra-precise metrics  
- “Works for every industry on day one”  

**Better framing:**  
“Helps managers gather clear evidence and a walk-through-ready report.”

---

## 13. Differentiation & risks

### Differentiation

| We are not | We are |
|------------|--------|
| Chatbot about rules | Scoreboard product |
| PDF summarizer only | Photo evidence → clause scores |
| Enterprise QMS | One deep café vertical |
| Always-correct AI | Unclear + human-in-the-loop |

### Main risks

| Risk | Mitigation |
|------|------------|
| Vision mis-score | Confidence, Unclear, manager override |
| Thin demo pack | Invest early in SOP + photos |
| Scope creep | Hard freezes in §3 and §5 |
| “Just ChatGPT + login” smell | No chat; always show clause quote |
| Live failure on stage | Pre-tested pack + backup video |

### Hard freezes (do not break)

1. **One industry only:** café food-safety opening checklist  
2. **Scoreboard only** — no free chat  
3. Demo must show at least one **Unclear** path  
4. Boosts never unlock multi-industry, voice, email polish, or chat  

---

## 14. Scale story (pitch only — not MVP)

After the hackathon, the same spine can grow:

- More **SOP packs** (closing checklist, retail, campus lab)  
- **Multi-site** owner dashboards  
- Stronger audit exports for walk-throughs  
- Optional notifications (later)

Do **not** build multi-industry or multi-site in the MVP window.

---

## 15. Backups (if track preference changes)

| Rank | Idea | Track | When to pick instead |
|------|------|--------|----------------------|
| **#1** | **ShiftProof** | Industry & Productivity | **Default — build this** |
| #2 | CampusCarbon | Sustainability | Same tech spine; prefer green story |
| #3 | SchemePack | Governance & Social Impact | Only if 5–8 schemes curated on Day 1 |

**Rule:** Build **one** product. Do not hedge across three tracks.

---

## 16. Pre-Day-1 setup checklist

- [ ] Appwrite project (Auth, DB, Storage, Functions, Realtime)  
- [ ] One multimodal AI API key (pick one provider and stick to it)  
- [ ] Hosting plan for public demo URL (if needed)  
- [ ] Two demo logins: staff + manager  
- [ ] Café SOP draft (10–20 clauses)  
- [ ] Checklist of 6–8 items  
- [ ] Photo kits: pass / fail / unclear  

---

## 17. Coding-session prompt (paste into AI tools)

```text
We are building ShiftProof for the IIT Jammu AI First Hackathon.
Read PROJECT.md, explanation.md, and output/FINAL-SHORTLIST.md first.

Build a simple web app with Appwrite:
- Two logins: staff and manager
- Staff uploads shift photos
- AI checks photos against a café food-safety checklist/SOP
- Results show as a Pass / Gap / Unclear scoreboard (no chat)
- Manager can override, assign a fix, and export a 1-page report

Only one vertical: café opening food-safety checklist.
Finish core features C1–C8 before extras #1–#6.
```

---

## 18. Related files

| File | Purpose |
|------|---------|
| [`PROJECT.md`](PROJECT.md) | **This file** — full project specification |
| [`explanation.md`](explanation.md) | Plain-English team guide |
| [`README.md`](README.md) | Idea-factory multi-agent toolkit |
| [`config/hackathon-context.md`](config/hackathon-context.md) | Event rules, dates, scoring |
| [`config/team-profile.md`](config/team-profile.md) | Team constraints |
| [`docs/ROUND2-PLAN.md`](docs/ROUND2-PLAN.md) | **Frozen** Round 2 multi-session plan (Showcase Max) |
| [`docs/TEST-CASES.md`](docs/TEST-CASES.md) | Round 2 test catalog + Playwright gates |
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary |
| [`output/FINAL-SHORTLIST.md`](output/FINAL-SHORTLIST.md) | Final idea decision + feature tables |
| [`output/ideas-iter1.md`](output/ideas-iter1.md) | Original idea write-ups |
| [`output/feasibility-iter1.md`](output/feasibility-iter1.md) | Shipability, cuts, demo risks |
| [`output/review-iter1.md`](output/review-iter1.md) | Scoring vs other ideas |
| [`output/research-brief-iter1.md`](output/research-brief-iter1.md) | Landscape & clichés to avoid |
| [`output/run-log.md`](output/run-log.md) | Agent run audit trail |

---

## 19. Bottom line

**ShiftProof** helps a café manager stop relying on messy WhatsApp photos.  
Staff upload shift photos. AI checks them against the rule book. The manager sees clear **Pass / Gap / Unclear** results with **clause citations**, assigns fixes, and downloads a simple report.

1. Ship the **full core loop** first (C1–C8).  
2. Add boosts **in order** (#1–#6) only if time allows.  
3. **Never** add free chat or a second industry during the hackathon.  
4. **Always** show the rule quote and an honest **Unclear** example.

Strong demo content + a calm live demo = impressive, useful, and realistic — which is why this idea ranked **#1**.
