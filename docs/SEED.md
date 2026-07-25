# Seed data — ShiftProof

## Demo site

| Field | Value |
|-------|--------|
| Row ID | `demo_cafe` |
| name | Jammu Demo Café |
| timezone | Asia/Kolkata |

## Checklist

| Field | Value |
|-------|--------|
| Row ID | `opening_fs` |
| siteId | `demo_cafe` |
| title | Opening food-safety |

### Item IDs (8)

| id | label | relatedClauseIds |
|----|-------|------------------|
| gloves_worn | Gloves worn at food-prep station | FS-01 |
| handwash_station | Handwash station stocked | FS-02 |
| sanitizer_available | Sanitizer available and filled | FS-03 |
| counter_clean | Food-prep counter clean | FS-04 |
| fridge_temp | Fridge temperature in range | FS-05 |
| hair_restraint | Hair restraint worn | FS-06 |
| floor_clear | Floor clear of hazards | FS-07 |
| waste_bin_covered | Waste bin covered | FS-08 |

## SOP meta

| Field | Value |
|-------|--------|
| Row ID | `cafe_sop_v1` |
| title | Café Food-Safety Opening SOP v1 |
| fileId | Set by Session 2 seed (`demo/seed-s2.mjs`) — not `TODO_UPLOAD_SOP_PDF` |
| clauseCount | 12 |
| version | 1 |

Clause IDs pattern: `FS-01` … `FS-12` (align checklist relatedClauseIds).

## Demo accounts

| Role | User ID | Email | Password (demo only) | Labels |
|------|---------|-------|----------------------|--------|
| staff | `demo_staff` | staff@shiftproof.demo | `DemoStaff123!` | staff |
| manager | `demo_manager` | manager@shiftproof.demo | `DemoManager123!` | manager |

**Security:** demo credentials for hackathon only. Rotate before any public production deploy. Do not reuse these passwords elsewhere.

## Demo photo kits (Session 2)

| Kit | Path | Typical story |
|-----|------|----------------|
| pass | `demo/photos/pass/` | Clean open evidence |
| gap | `demo/photos/gap/` | Bare hands, dirty counter, open bin |
| unclear | `demo/photos/unclear/` | Glare / dark / crop |

## Golden pre-scored shifts (video insurance)

| Shift row ID | Kit | Purpose |
|--------------|-----|---------|
| `golden_gap_open` | gap findings pre-written | Manager opens without live AI |
| `golden_pass_open` | mostly pass | Clean scoreboard backup |

Re-seed: `node demo/build-sop-pdf.mjs` then `node demo/seed-s2.mjs`.  
Live-score a kit: `node demo/live-score-kit.mjs gap`.

## Still manual

1. Enable **Email/Password** auth in Appwrite Console if login fails.  
2. Deploy Function `runShiftScore` with `GOOGLE_AI_API_KEY` (Session 1).

## Seed strategy

| Asset | How created |
|-------|-------------|
| Tables + columns + indexes | Appwrite MCP (done) |
| Buckets | Appwrite MCP (done) |
| Users + labels | Appwrite MCP (done) |
| site / checklist / sop rows | Appwrite MCP (done) |
| SOP PDF file | Manual / later upload |
| Vision Function body | Later session |
