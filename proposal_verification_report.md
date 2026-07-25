# ShiftProof Round 1 Proposal — Verification Report

**Generated:** 2026-07-19  
**Artifacts:** `ShiftProof_Proposal.pptx`, `ShiftProof_Proposal.pdf`, `proposal_slides/slide-1.png` … `slide-5.png`

---

## Acceptance checklist (§10) with evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Exactly **5 slides** | **PASS** | `delete_slide.py --list` on unpacked final: slides 1–5 only. markitdown: 5× `Slide number`. Zip: no `slide6.xml`. |
| 2 | Instructions slide removed; **no** notesSlide6 broken rels | **PASS** | Zip inventory: no `notesSlide6` / `slide6`. Re-pack of final: `All validations PASSED!` |
| 3 | Zero leftover placeholders / instructional bracket text | **PASS** | markitdown scan: no `[ Your`, `[ What real`, `[ Detailed`, `IMPORTANT INSTRUCTIONS`. |
| 4 | Branding + team + track preserved | **PASS** | I3C, Techible, AIH art, Lunaris, members/emails/phones, track line present on slide 1. |
| 5 | College line has **no** trailing `]` | **PASS** | `ICFAI University Tripura` (no `]`). Regex `Tripura \]` → no match. |
| 6 | No free-chat / multi-industry / inspection-guarantee claims | **PASS** | Forbidden-claim scan: no guarantee/every-industry. Slide 3 flow footer: “No free chat”. |
| 7 | Unclear + human override on solution and/or innovation | **PASS** | Slide 3: “Unclear (human-in-loop)”; slide 4: “honest Unclear path”; UI shows Unclear + scoreboard. |
| 8 | Slide 3 has flow and/or Playwright scoreboard, no overlap | **PASS** | Composite: 5-stage flow + smoke scoreboard UI (Pass/Gap/Unclear, clause FS-02). Right margin only. |
| 9 | Char budgets respected | **PASS** | Table below — all YES. |
| 10 | All 5 slides PNG-reviewed after last change | **PASS** | `proposal_slides/slide-1.png` … `slide-5.png` timestamps match final pack; notes below. |
| 11 | Pack validation PASSED | **PASS** | `pack.py … --original template.pptx` → `All validations PASSED!` (also re-verified via unpack→pack). |
| 12 | `ShiftProof_Proposal.pdf` for form upload | **PASS** | File exists (~463 KB), exported via PowerPoint COM `ppSaveAsPDF`. |

---

## Char-budget table

| Slide | Field | Chars | Budget | Pass? |
|-------|-------|------:|-------:|:-----:|
| 1 | Tagline | 60 | 80 | YES |
| 2 | Headline | 52 | 65 | YES |
| 2 | Subline | 70 | 85 | YES |
| 2 | Bullet 1 | 58 | 70 | YES |
| 2 | Bullet 2 | 51 | 70 | YES |
| 2 | Bullet 3 | 55 | 70 | YES |
| 2 | Bullet 4 | 52 | 70 | YES |
| 3 | Headline | 36 | 55 | YES |
| 3 | Subline | 55 | 75 | YES |
| 3 | Bullet 1 | 41 | 75 | YES |
| 3 | Bullet 2 | 55 | 75 | YES |
| 3 | Bullet 3 | 54 | 75 | YES |
| 4 | Innovation 1–4 | 54–58 | 80 | YES |
| 4 | Tech details 1–4 | 40–41 | 60 | YES |

---

## Visual QA notes (per slide, after last export)

### Slide 1 — Cover
- No text-through-text; tagline wraps cleanly to 2 lines (intentional).
- College typo fixed (no trailing `]`).
- Branding (I3C / Techible / AIH art) intact; footer `SS26 · AIH · ShiftProof · Lunaris`.
- **no collision / no leftover / margins OK**

### Slide 2 — Problem
- Headline single line; subline soft-wraps once.
- TODAY vs IF UNSOLVED infographic on right (x ≥ 11.5"); does not cover bullets.
- No fake stats.
- **no collision / no leftover / margins OK**

### Slide 3 — Solution
- Flow diagram (Staff → AI agent → Scoreboard → Manager → Export) + Playwright scoreboard (Pass/Gap/Unclear, clause quote, confidence).
- Footer chip: Low conf → Unclear · No free chat.
- Body bullets short; images right of content column.
- **no collision / no leftover / margins OK** (scoreboard crop prioritizes finding + summary; override CTA may be tight at crop edge)

### Slide 4 — Innovation & Technology
- Split layout preserved; template icons kept.
- Tech stack details shortened after first-pass overflow into next row; no text-through-text on re-export.
- Unclear + not-a-chatbot differentiation present.
- **no collision / no leftover / margins OK** (`</>` is template App icon glyph)

### Slide 5 — Feasibility
- D1–D4 timeline on right; bullets feasible/risks/mitigate with Unclear+override.
- Scale path explicitly “pitch only”.
- **no collision / no leftover / margins OK**

---

## Command evidence (fresh)

```text
# Slide list
5 slides in presentation order:
  1. slide1.xml … 5. slide5.xml

# Pack
All validations PASSED!
Successfully packed unpacked to ShiftProof_Proposal.pptx

# Re-verify pack
All validations PASSED!
Successfully packed unpacked_verify to _verify_pack.pptx

# Zip
notesSlide6 present? 0
slide6 present? 0

# Content claims scan
[PASS] 5 slides / no slide 6 / no IMPORTANT INSTRUCTIONS
[PASS] no bracket placeholders / college fixed
[PASS] Unclear + human-in-loop / no guarantee / no multi-industry
```

### Output files

| File | Role |
|------|------|
| `ShiftProof_Proposal.pptx` | Final 5-slide deck (edit-in-place of `template.pptx`) |
| `ShiftProof_Proposal.pdf` | Submission form upload |
| `proposal_slides/slide-1.png` … `slide-5.png` | Visual QA evidence (1920×1080) |

---

## Method notes

- **Edit-in-place only** (unpack → replace_nth_text / insert pic → pack with `--original template.pptx`).
- Playwright assets: fallback copies from `web/playwright-shots/smoke/` (no invented mockups).
- Diagrams generated: process flow, today-vs-failure, D1–D4 timeline (flat, high contrast).
- One fix-and-verify cycle completed (slide 4 tech overflow + slide 3 image composite).
