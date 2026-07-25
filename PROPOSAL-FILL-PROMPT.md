# Master Prompt: Fill `template.pptx` for ShiftProof (IIT Jammu AI First Hackathon)

**Copy everything below the line into another coding-capable LLM** (Claude / GPT / Cursor / Gemini with file + shell tools). Attach or give access to:

| Required | Path / note |
|----------|-------------|
| Template | `template.pptx` (official submission template) |
| Product truth | `PROJECT.md` |
| Repo root | JammuHackathon workspace |

| Strongly recommended | Path |
|----------------------|------|
| App map | `docs/APP.md` |
| Findings schema | `docs/FINDINGS_SCHEMA.json` |
| Seed / demo accounts | `docs/SEED.md` |
| Event rules | `config/hackathon-context.md` |
| Playwright scripts | `web/scripts/playwright-smoke.mjs`, `playwright-boosts.mjs`, `playwright-c3-loop.mjs` |
| Fallback screenshots | `web/playwright-shots/smoke/`, `boosts/`, `c3/`, `export-print/` |

If the host has the **pptx skill** scripts (Grok/Claude bundled skills), use them. Paths often look like:

```text
~/.grok/bundled/skills/pptx/scripts/
# or equivalent on your machine
```

If not, use any equivalent unpack/edit/pack tooling, but **still edit the template in place**.

---

# YOUR MISSION

You will produce a **Round 1 Idea & Proposal** deck for **ShiftProof** by **editing `template.pptx` in place**.

**Final outputs:**

1. `ShiftProof_Proposal.pptx` — 5 slides only  
2. `ShiftProof_Proposal.pdf` — for the submission form (PDF only accepted)  
3. `proposal_slides/slide-1.png` … `slide-5.png` — visual QA evidence  
4. A short verification report showing the acceptance checklist **with command evidence**

**You are not done** until every acceptance checkbox has **fresh evidence** (see §10). Do not say “done”, “complete”, or “ready to submit” without that evidence.

---

# 1. ROLE & NON-NEGOTIABLE RULES

## 1.1 Edit-in-place only

- **DO** unpack → replace text/images → pack the official template.  
- **DO NOT** recreate the deck with pptxgenjs / Google Slides / a new blank presentation.  
- **DO NOT** restyle colors, fonts, logos, freeforms, or layout. The visual system *is* the template.  
- **DO NOT** use `sed`/`awk`/regex shell hacks on PPTX XML. Prefer pptx skill scripts or careful XML editors that preserve namespaces.

## 1.2 Slide 6 instructions (read first, then delete)

The last slide of `template.pptx` says:

1. Maximum **5 slides including the title slide**  
2. Prefer **points / diagrams / infographics / pictures** over paragraphs  
3. Keep explanations **precise and easy**  
4. Idea must be innovative and impactful  
5. Follow the template structure  
6. Submit **PDF only** (no PPT/Word on the form)  
7. **Delete this instructions slide** before final submission  

## 1.3 Never list (hard freezes from PROJECT.md)

1. **No free chat** with the SOP — this is a **scoreboard product**  
2. **One vertical only:** café food-safety **opening** checklist  
3. Always show **Unclear + human-in-the-loop** (manager override)  
4. No “we guarantee you pass inspections”  
5. No “works for every industry on day one”  
6. No custom CV training / model training claims  
7. **No invented market statistics** (speaker notes ask for stats; PROJECT has none verified → skip numbers)  
8. Prefer bullets over paragraphs  
9. Preserve branding (I3C, Techible, event chrome)  
10. Delete slide 6; clean orphan notes relationships  
11. Do not change team identity fields unless empty/broken (fix the stray `]` only)

---

# 2. PRODUCT TRUTH (ShiftProof)

Use `PROJECT.md` as the single source of truth. Summary for speed:

| Field | Value |
|-------|--------|
| Product | **ShiftProof** |
| One-liner | Staff upload shift photos → AI scores them against café SOP rules → manager live gap scoreboard → fix tasks → 1-page audit pack |
| Pitch hook | WhatsApp photo compliance → auditable, clause-cited shift scoreboard managers can trust in under a minute |
| Track | **AI for Industry, Business & Productivity** |
| Themes hit | Generative AI/LLMs · AI Agents · Multimodal (vision + text) |
| MVP vertical | Café food-safety **opening** checklist only (one site) |
| Roles | **Staff** upload photos · **Manager** scoreboard, override, tasks, export |
| Stack | React web + **Appwrite Pro** (Auth, DB, Storage, Functions, Realtime) + **one multimodal LLM** (no training) |
| AI function | `runShiftScore` → structured findings JSON |
| Finding statuses | `pass` \| `gap` \| `unclear` + `clause_id` + `quote` + `confidence` + `evidence_note` |
| Golden rule | Low confidence → **unclear** + manager decides (never silent Pass/Fail) |

### Core loop (must be obvious on slides 3–4)

```text
Staff photos → Storage → Multimodal agent (vision + SOP clauses)
  → Pass / Gap / Unclear + clause quote + confidence
  → Manager inbox → override / assign fix
  → (optional) re-check photo → re-score
  → 1-page compliance pack + audit events
```

### Differentiation (slide 4)

| We are not | We are |
|------------|--------|
| Chatbot about rules | Scoreboard product |
| PDF summarizer only | Photo evidence → clause scores |
| Enterprise QMS | One deep café vertical |
| Always-correct AI | Unclear + human-in-the-loop |

### Claims to avoid

- Guaranteed inspection pass  
- Fake ultra-precise metrics  
- Multi-industry day one  

**Better framing:** helps managers gather clear evidence and a walk-through-ready report.

---

# 3. ROUND 1 SCORING MAP

| Criterion | Weight | Primary slide | What to prove |
|-----------|--------|---------------|---------------|
| Innovation & Creativity | **30%** | 4 (+3) | Closed photo→score→task→pack loop; not chat |
| Problem Relevance | **20%** | 2 | MSME SOP + WhatsApp “proof” pain is real |
| AI-First Approach | **20%** | 3 (+4) | Product dies without vision + clause scoring; show UI proof |
| Feasibility & Scalability | **15%** | 5 | 4-day C1–C8; risks + mitigations; scale is pitch-only |
| Presentation | **15%** | all | Short bullets, no overlaps, clean PDF |

---

# 4. TEMPLATE GEOMETRY (MEASURED)

- Slide size: **20.00" × 11.25"**  
- Content is **left-heavy**; **right side is often empty white space** — put diagrams/screenshots there.  
- Footer: `SS26 · AIH` (left) + `0N / 05` (right) — keep.

**Critical past failures (do not repeat):**

| Failure | Cause | Fix |
|---------|-------|-----|
| Headline overlaps subtitle | Text longer than large-font box | Enforce char budgets below |
| Diagram covers bullets | Image placed into left content column | Place only at **x ≥ 11.5"** |
| Words stuck together | Template text split across multiple `<a:t>` runs | Replace **all** fragments; verify with `--list` |
| Pack corrupt after deleting slide 6 | Orphan `notesSlide6` + rels | Delete notes + remove Relationship + Content_Types override |

Many placeholders are split, e.g. `[ Your Pr` + `oposed AI Solution ]`. When using `replace_nth_text.py`, replace **each fragment** or replace the full shape text carefully.

---

# 5. SLIDE-BY-SLIDE FILL (LOCKED COPY + BUDGETS)

Use this **locked copy** unless a field is empty or clearly wrong. Count characters **before** packing. Print a table:

| Slide | Field | Chars | Budget | Pass? |

## SLIDE 1 — Cover / Team

| Element | Action | Exact text / rule | Budget |
|---------|--------|-------------------|--------|
| I3C / Techible / event chrome | **Keep** | — | — |
| Product name `ShiftProof` | **Keep** | — | — |
| Tagline | **Replace** | Prefer: `WhatsApp shift photos → AI clause scores managers can trust.` | **≤ 80 chars, one line** |
| Track | **Keep** | `TRACK: AI for Industry, Business & Productivity` | — |
| Team Name | **Keep** | Lunaris | — |
| College | **Fix typo only** | Remove trailing `]` → `ICFAI University Tripura` | — |
| Members / emails / phones | **Keep** | Do not invent new people | — |
| Footer center | Optional | `SS26 · AIH · ShiftProof · Lunaris` | short |
| `01 / 05` | Keep | — | — |

**Images slide 1:** Keep existing AIH/decorative art. **Do not** force a login screenshot (clutter risk).

---

## SLIDE 2 — The Problem (Problem Relevance 20%)

| Element | Exact text | Budget |
|---------|------------|--------|
| Section label | Keep `THE PROBLEM` | — |
| Headline | `SOPs exist — daily proof is chaotic WhatsApp photos.` | **≤ 65 chars, one line** |
| Subline | `Cafés (5–50 staff): rules on paper, photos not clause-linked evidence.` | **≤ 85 chars** |
| Card title | Keep `Problem Statement` | — |
| Card intro | `MSME hygiene pressure without enterprise QMS cost` | short |
| Bullet 1 | `Who: Owner-managers of cafés, campus messes, food counters` | **≤ 70** |
| Bullet 2 | `Broken: unread SOP PDFs; WhatsApp “proof”; no gap log` | **≤ 70** |
| Bullet 3 | `Why now: Multimodal AI maps phone photos to SOP clauses` | **≤ 70** |
| Bullet 4 | `If unsolved: Gaps stay hidden until inspection panic` | **≤ 70** |

**Images slide 2 (recommended):**

| Asset | Spec | Placement |
|-------|------|-----------|
| Today vs failure mini-infographic | 2 columns, icons + 3–5 word labels max, flat design, high contrast | **x ≥ 11.5"**, y ≈ 4.5–8.5", ~**6.5" × 3.0"** |
| Fake stats | **Forbidden** | — |

Speaker notes mention “stat callouts” — **those shapes do not exist**. Do not invent percentages.

---

## SLIDE 3 — The Solution (AI-First 20%)

| Element | Exact text | Budget |
|---------|------------|--------|
| Section | Keep `THE SOLUTION` | — |
| Headline | `Photos in → Pass / Gap / Unclear out` | **≤ 55 chars, one line** |
| Subline | `Clause-cited scores → manager fixes → 1-page audit pack` | **≤ 75** |
| Card title | Keep `Proposed Solution` | — |
| Card intro / flow | `Flow: Photos → Storage → Vision → Scoreboard → Fix → PDF` | short |
| Bullet 1 | `Café opening checklist — one vertical MVP` | **≤ 75** |
| Bullet 2 | `Addresses: findings with clause ID + quote + confidence` | **≤ 75** |
| Bullet 3 | `AI: Multimodal LLM; low conf → Unclear (human-in-loop)` | **≤ 75** |

**Images slide 3 — critical**

| Priority | Asset | Spec | Placement |
|----------|-------|------|-----------|
| A | Process flow diagram | 5 stages: **Staff → AI agent → Scoreboard → Manager → Export**. Footer: `Low conf → Unclear · No free chat`. Colors: Pass green / Gap red / Unclear amber. PNG ≥ **1600×420**. | Right strip: **x ≈ 11.8–12.5"**, **y ≈ 5.8–6.2"**, **w ≈ 5.5–6.5"**, **h ≈ 1.4–1.8"** (keep aspect). |
| B | **Playwright scoreboard screenshot** | Real Pass/Gap/Unclear UI; crop to relevant region; do not stretch | Right side **below** flow if both fit; if only one fits → **prefer B** |

**Decision rule:**

```text
IF A and B both fit without overlapping TextBox body → use both
ELSE IF only one fits → use B (Playwright scoreboard)
ELSE shorten body bullets, then retry A
```

Body text box is ~**10.2" wide starting ~2.6"** → ends near **x ≈ 12.8"**. Long bullets + wide images **will collide**. Shorten text first.

---

## SLIDE 4 — Innovation & Technology (Innovation 30%)

**Left — Innovation & Uniqueness (4 bullets, ≤ ~80 chars each):**

1. `Not a chatbot: closed photo → score → task → pack loop`  
2. `Clause-cited findings + confidence + honest Unclear path`  
3. `vs WhatsApp chaos / enterprise QMS: one deep café vertical`  
4. `Rules alone can’t judge messy photos; vision + SOP can`  

**Right — Technology Stack details (narrow column ≤ ~60 chars):**

| Keep label | Replacement detail |
|------------|-------------------|
| AI / Model Layer | `Multimodal LLM (vision) → structured JSON findings` |
| Agents & Automation | `Appwrite Function runShiftScore: describe→match→score→cite` |
| App & Backend | `React web + Appwrite Auth/DB/Storage/Realtime` |
| Cloud & APIs | `Appwrite Pro + one multimodal vision API` |

**Images:** Keep template icons. Optional small override screenshot only if empty margin remains (default: skip).

---

## SLIDE 5 — Feasibility & Scalability (15%)

| Element | Exact text |
|---------|------------|
| Section | Keep `FEASIBILITY & SCALABILITY` |
| Headline | `Credible 4-day build + clear scale path` |
| Card title | Keep `Idea Evaluation` |
| Card intro | `4-day café MVP now → SOP packs / multi-site later (pitch only)` |
| Bullet 1 | `Feasible: Appwrite Pro + one vision API + React; ship C1–C8 loop` |
| Bullet 2 | `Risks: vision mis-score | thin demo pack | API downtime` |
| Bullet 3 | `Mitigate: Unclear+override | golden photo kits | backup demo video` |

**Images (recommended):**

| Asset | Spec | Placement |
|-------|------|-----------|
| D1–D4 timeline | D1 Schema+auth · D2 Vision+scoreboard · D3 Override+tasks · D4 PDF+demo | **x ≥ 11.5"**, y ≈ 5.0–7.5", ~**7" × 1.6"** |
| Export Playwright shot | Optional small crop | Under timeline only if room |

---

# 6. PLAYWRIGHT ASSET PIPELINE

Playwright is for **product UI proof**, not for rendering PowerPoint.

## 6.1 Live capture (preferred)

```bash
# Terminal A — from web/
npm run dev
# ensure app is on the port smoke expects (default http://localhost:5174)

# Terminal B — from repo root
node web/scripts/playwright-smoke.mjs http://localhost:5174
# optional richer loops:
node web/scripts/playwright-boosts.mjs
node web/scripts/playwright-c3-loop.mjs
```

Demo logins (see `docs/SEED.md` if different): smoke script uses  
`staff@shiftproof.demo` / `DemoStaff123!` and manager demo credentials in the same scripts.

## 6.2 Fallback (if live Appwrite/API down)

Copy from existing repo shots — **do not invent mockups**:

| Proposal asset | Prefer these sources (first that exists) |
|----------------|------------------------------------------|
| `proposal_assets/playwright/scoreboard.png` | `web/playwright-shots/smoke/06-manager-scoreboard.png` · `boosts/02-scoreboard.png` · `c3/04-manager-scoreboard.png` |
| `proposal_assets/playwright/override.png` | `smoke/08-manager-override.png` · `boosts/03-override.png` |
| `proposal_assets/playwright/export.png` | `smoke/10-manager-export.png` · `boosts/05-export.png` · `export-print/03-print-a4.png` |
| `proposal_assets/playwright/staff.png` | `smoke/02-staff-home.png` · `smoke/04-staff-evidence.png` · `staff-opening/opening-desktop.png` |
| `proposal_assets/playwright/login.png` | `smoke/01-login.png` · `smoke/11-login-desktop.png` |

```bash
mkdir -p proposal_assets/playwright
# example:
cp web/playwright-shots/smoke/06-manager-scoreboard.png proposal_assets/playwright/scoreboard.png
```

## 6.3 Non-UI diagrams only

Generate **only**:

1. Slide 3 process flow (5-stage)  
2. Optional slide 2 today-vs-failure infographic  
3. Optional slide 5 D1–D4 timeline  

Style: flat, high contrast, large labels, no paragraph text inside the image. **Never stretch** aspect ratio when placing.

---

# 7. PPTX TECHNICAL RUNBOOK

Set `SCRIPTS` to your pptx skill scripts directory.

## 7.1 Unpack & inspect

```bash
python "$SCRIPTS/office/unpack.py" template.pptx unpacked/
python "$SCRIPTS/inspect_slide.py" unpacked/ --summary --theme --media
python "$SCRIPTS/delete_slide.py" unpacked/ --list
# per slide text inventory:
python "$SCRIPTS/replace_nth_text.py" unpacked/ppt/slides/slide1.xml --list
# ... slide2–6
python "$SCRIPTS/resize_shape.py" unpacked/ppt/slides/slide1.xml --list
# ... slide2–5
```

## 7.2 Delete instructions slide + clean orphans

```bash
python "$SCRIPTS/delete_slide.py" unpacked/ 6
```

Then **manually ensure**:

1. `ppt/notesSlides/notesSlide6.xml` and its `.rels` are gone  
2. No `notesSlide6` entry in `ppt/_rels/presentation.xml.rels`  
3. No `notesSlide6` / `slide6` override left in `[Content_Types].xml`  

If pack fails with “Broken reference to notesSlide6”, remove that Relationship line.

## 7.3 Replace text

Prefer:

```bash
python "$SCRIPTS/replace_nth_text.py" slide.xml --find "OLD" --text "NEW"
# or --full for whole node text
# or --index N from --list
python "$SCRIPTS/replace_text.py" slide.xml --match "placeholder" --text "NEW" --autofit
```

After each slide, re-run `--list` and confirm **no** `[` `]` instructional leftovers.

## 7.4 Insert images (right margin only)

Copy PNG into `unpacked/ppt/media/`, add Relationship in `ppt/slides/_rels/slideN.xml.rels`, insert `<p:pic>` with:

- `a:off` / `a:ext` in **EMU** (1 inch = 914400 EMU)  
- Example for 12.0" × 6.0", size 6.0" × 1.57":  
  - x = 12.0 × 914400 = 10972800  
  - y = 6.0 × 914400 = 5486400  
  - cx = 6.0 × 914400 = 5486400  
  - cy = 1.57 × 914400 ≈ 1435608  

Always set `noChangeAspect="1"` and compute height from width using source aspect ratio.

## 7.5 Overlap check, clean, pack

```bash
python "$SCRIPTS/check_overlaps.py" unpacked/ --fix
python "$SCRIPTS/clean.py" unpacked/
python "$SCRIPTS/office/pack.py" unpacked/ ShiftProof_Proposal.pptx --original template.pptx
```

Template freeforms may report “100% overlap” with each other — that is often decorative. **Real** defects are text-through-text and text-through-screenshot. Confirm with PNG export.

---

# 8. VISUAL QA LOOP (MANDATORY)

## 8.1 Export slides to PNG

**Preferred on Windows (PowerPoint COM):**

```python
import win32com.client
from pathlib import Path
pptx = str(Path("ShiftProof_Proposal.pptx").resolve())
out = Path("proposal_slides"); out.mkdir(exist_ok=True)
ppt = win32com.client.Dispatch("PowerPoint.Application")
ppt.Visible = 1
pres = ppt.Presentations.Open(pptx, WithWindow=False)
for i in range(1, pres.Slides.Count + 1):
    pres.Slides(i).Export(str(out / f"slide-{i}.png"), "PNG", 1920, 1080)
pres.SaveAs(str(Path("ShiftProof_Proposal.pdf").resolve()), 32)  # ppSaveAsPDF
pres.Close(); ppt.Quit()
```

Or use pptx skill `render_slides.py` / LibreOffice if available on your OS.

## 8.2 Inspect each PNG (read the images)

For every slide, list issues or explicitly write “no collision / no leftover / margins OK”.

Checklist:

- [ ] No text overlapping other text  
- [ ] No diagram/screenshot covering bullets  
- [ ] Headlines single-line (or intentional clean wrap)  
- [ ] No `[placeholder]` strings  
- [ ] Footer not colliding with content  
- [ ] Style still matches template  

If any issue: fix XML/text/image → pack → **re-export → re-read**. Minimum **one** fix-and-verify cycle if first pass has issues.

## 8.3 Content scan

```bash
python -m markitdown ShiftProof_Proposal.pptx
# must show 5 slides only; no "IMPORTANT INSTRUCTIONS"; no bracket placeholders
```

---

# 9. VERIFICATION-BEFORE-COMPLETION GATE

**Iron law:** no completion claims without fresh verification evidence in the same session.

Before saying the deck is ready, run and paste evidence for:

1. `delete_slide.py --list` or markitdown → **5 slides**  
2. `markitdown` / text scan → **no placeholders / no slide 6 instructions**  
3. Pack command → **All validations PASSED**  
4. PNG exports exist for slides 1–5 **after last edit**  
5. Written visual notes per slide  
6. PDF file exists  

---

# 10. ACCEPTANCE CRITERIA (ALL REQUIRED)

- [ ] Exactly **5 slides**  
- [ ] Instructions slide removed; pack has **no** notesSlide6 broken rels  
- [ ] Zero leftover placeholders / instructional bracket text  
- [ ] Branding + team + track preserved (intended body/tagline changes only)  
- [ ] College line has **no** trailing `]`  
- [ ] No free-chat / multi-industry / inspection-guarantee claims  
- [ ] Unclear + human override present on solution and/or innovation  
- [ ] Slide 3 has **flow diagram and/or Playwright scoreboard**, no overlap  
- [ ] Char budgets respected (table printed)  
- [ ] All 5 slides PNG-reviewed after last change  
- [ ] Pack validation PASSED  
- [ ] `ShiftProof_Proposal.pdf` generated for form upload  

---

# 11. EXECUTION ORDER (DO THIS SEQUENCE)

```text
Phase 0  Read this prompt + PROJECT.md + open template.pptx (markitdown)
Phase 1  Playwright: live smoke OR copy fallback shots → proposal_assets/playwright/
Phase 2  Generate flow (+ optional timeline/infographic) diagrams only
Phase 3  Unpack template; list slides; print shape/text inventory
Phase 4  Delete slide 6; clean notes/rels/Content_Types
Phase 5  Print char-budget table; replace all locked copy (handle split runs)
Phase 6  Insert images at specified inches (right margin only)
Phase 7  check_overlaps --fix; clean; pack
Phase 8  Export PNG + PDF; read every PNG; fix; re-pack; re-export
Phase 9  Run acceptance checklist with evidence; only then declare ready
```

---

# 12. APPENDIX — QUICK PROJECT EXCERPTS

### Problem today

| Today | Why it fails |
|-------|----------------|
| SOPs as PDFs nobody opens | Rules on paper, not in ops |
| Random WhatsApp photos | Not linked to clauses; hard to audit |
| Manager must trust staff | Hope ≠ evidence |
| Pre-inspection panic | No day-to-day gap log |
| Enterprise QMS | Too expensive for MSMEs |

### Core MVP features (C1–C8) — for feasibility wording

Auth · Evidence upload · Vision score agent · Scoreboard UI · Manager inbox · Override + tasks · Café seed pack · Compliance export PDF

### Demo story arc (for consistency)

Problem (WhatsApp) → Staff photos → AI scoreboard + citations → Unclear + override → Fix task → Export pack → Scale story (pitch only)

### Findings shape (AI honesty)

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

---

# 13. START NOW

1. Confirm `template.pptx` and `PROJECT.md` are readable.  
2. Start Phase 1 (Playwright assets).  
3. Follow Phases 2–9 without skipping visual QA.  
4. Stop only when §10 is fully checked with evidence.

**Remember:** short text wins. Real screenshots beat fake UI. Right margin only for visuals. Five slides. PDF out.
