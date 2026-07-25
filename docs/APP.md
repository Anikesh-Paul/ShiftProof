# ShiftProof — App map

> Product map for AI coding sessions. Full spec: [`PROJECT.md`](../PROJECT.md).

## One-liner

Staff upload shift photos → AI scores them against café SOP rules → manager sees a live gap scoreboard → fix tasks → export a 1-page audit pack.

## Roles

| Role label | User id (demo) | Primary actions |
|------------|----------------|-----------------|
| `staff` | `demo_staff` | Login → start shift → upload 3–8 photos → submit → (later) re-check photo |
| `manager` | `demo_manager` | Login → live scoreboard/inbox → override AI → assign fix → export pack |

**MVP tenancy:** one demo site (`demo_cafe`). No multi-site.

## Stack

| Layer | Choice |
|-------|--------|
| Backend | Appwrite project **Jammu** (TablesDB, Auth, Storage, Functions, Realtime) |
| Frontend | Web app (React / Vite or Next — decide at frontend start) |
| AI | One multimodal LLM via Function `runShiftScore` (stub exists; deploy later) |

Env prefix assumed for Vite: `VITE_APPWRITE_*`. Change in `.env.example` if using Next (`NEXT_PUBLIC_`).

## Build order (vertical slices)

Ship **C1–C8** before boosts. Frontend should only implement ops in [`API.md`](./API.md).

| Slice | What |
|-------|------|
| **C1** | Auth + role-gated shell (staff vs manager) |
| **C2** | Staff: create shift, upload evidence, create `agent_jobs` row |
| **C3** | Function scores → writes `findings` (≥5 items) |
| **C4** | Scoreboard UI: pass / gap / unclear (no chat) |
| **C5** | Manager inbox + Realtime on jobs/findings/shifts |
| **C6** | Override finding + create task + write `events` |
| **C7** | Seed pack (SOP PDF, checklist, demo photos) |
| **C8** | 1-page compliance PDF export |

## Non-goals (do not build unless asked)

- Free chat with the SOP  
- Second industry / multi-site  
- Voice, email/SMS polish  
- Checklist builder UI  
- Full analytics dashboard  
- Native mobile apps  

## Source-of-truth files (frontend memory)

| File | Use |
|------|-----|
| [`APPWRITE.md`](./APPWRITE.md) | Live IDs |
| [`API.md`](./API.md) | Allowed operations only |
| [`PERMISSIONS.md`](./PERMISSIONS.md) | Role matrix |
| [`../types/shiftproof.ts`](../types/shiftproof.ts) | Field names & enums |
| [`FINDINGS_SCHEMA.json`](./FINDINGS_SCHEMA.json) | AI findings JSON |
| [`SEED.md`](./SEED.md) | Demo data & accounts |

## Rule for AI agents

Do **not** invent tables, columns, statuses, or endpoints.  
If the UI needs something missing → update Appwrite + these docs **first**, then code.
