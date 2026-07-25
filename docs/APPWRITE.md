# Appwrite live IDs — project Jammu

> Updated when backend was provisioned via Appwrite MCP.  
> Client SDK must use the **region endpoint** (Singapore).

## Connection

| Key | Value |
|-----|--------|
| Project name | **Jammu** |
| Project ID | `6a5b0ce3002605c7a776` |
| Region | `sgp` |
| API endpoint | `https://sgp.cloud.appwrite.io/v1` |
| Console (global) | `https://cloud.appwrite.io` |

## Database (TablesDB)

| Key | Value |
|-----|--------|
| Database ID | `shiftproof` |
| Database name | ShiftProof |
| API style | **TablesDB** (tables + rows, not legacy Collections) |

> Frontend / Node SDK: use `TablesDB` (or the project’s current Appwrite SDK Tables API).  
> Table IDs below map 1:1 to the plan’s “collections”.

## Tables

| Table ID | Name | Row security |
|----------|------|--------------|
| `sites` | Sites | false |
| `sops` | SOPs | false |
| `checklists` | Checklists | false |
| `shifts` | Shifts | **true** |
| `findings` | Findings | false |
| `tasks` | Tasks | false |
| `agent_jobs` | Agent Jobs | false |
| `events` | Events | false |

### Columns

#### `sites`

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| name | string(255) | yes | |
| timezone | string(64) | no | default `Asia/Kolkata` |

#### `sops`

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| siteId | string(64) | yes | |
| title | string(255) | yes | |
| fileId | string(64) | yes | Storage file in `sop_files` |
| clauseCount | integer | no | |
| version | string(32) | no | default `1` |

#### `checklists`

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| siteId | string(64) | yes | |
| title | string(255) | yes | |
| itemsJson | mediumtext | yes | JSON array of checklist items |

#### `shifts`

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| siteId | string(64) | yes | |
| checklistId | string(64) | yes | |
| createdBy | string(64) | yes | user `$id` |
| status | enum | yes | `draft` \| `submitted` \| `scoring` \| `scored` \| `closed` |
| photoFileIds | mediumtext | no | JSON string array of evidence file IDs |
| startedAt | datetime | yes | ISO 8601 |
| submittedAt | datetime | no | |
| scoredAt | datetime | no | |

Indexes: `idx_createdBy` (createdBy), `idx_status` (status)

#### `findings`

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| shiftId | string(64) | yes | |
| itemId | string(64) | yes | checklist item id |
| status | enum | yes | `pass` \| `gap` \| `unclear` |
| clauseId | string(32) | yes | e.g. `FS-04` |
| quote | string(1000) | yes | |
| confidence | float 0–1 | yes | |
| evidenceNote | string(1000) | yes | |
| source | enum | yes | `ai` \| `manager_override` |
| overrideReason | string(500) | no | |
| overriddenBy | string(64) | no | |
| overriddenAt | datetime | no | |

Index: `idx_shiftId` (shiftId)

#### `tasks`

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| shiftId | string(64) | yes | |
| findingId | string(64) | yes | |
| title | string(255) | yes | |
| status | enum | yes | `open` \| `done` |
| assignedTo | string(64) | no | |
| createdBy | string(64) | yes | |
| recheckFileId | string(64) | no | evidence file |
| createdAt | datetime | yes | app field (not only `$createdAt`) |
| doneAt | datetime | no | |

Index: `idx_shiftId` (shiftId)

#### `agent_jobs`

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| shiftId | string(64) | yes | |
| status | enum | yes | `waiting` \| `running` \| `done` \| `failed` |
| errorMessage | string(1000) | no | |
| startedAt | datetime | no | |
| finishedAt | datetime | no | |
| traceJson | mediumtext | no | agent steps (boost later) |

Index: `idx_shiftId` (shiftId)

#### `events`

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| shiftId | string(64) | yes | |
| type | string(64) | yes | e.g. `shift.submitted` |
| actorUserId | string(64) | yes | |
| payloadJson | mediumtext | no | |
| createdAt | datetime | yes | |

Index: `idx_shiftId` (shiftId)

## Storage buckets

| Bucket ID | Name | Max size | Extensions |
|-----------|------|----------|------------|
| `sop_files` | SOP Files | 10 MB | pdf |
| `evidence` | Evidence Photos | 10 MB | jpg, jpeg, png, webp |

## Functions

| Function ID | Name | Runtime | Status |
|-------------|------|---------|--------|
| `runShiftScore` | runShiftScore | node-18.0 | **Deployed + active**; `execute`: users; env: `APPWRITE_API_KEY`, endpoint/project, **`GOOGLE_AI_API_KEY`** (Gemini Flash); optional `ALLOW_DEMO_STUB_SCORES`, `GEMINI_MODEL`; node-appwrite@27 TablesDB |

## Seeded row IDs

| Table | Row ID |
|-------|--------|
| sites | `demo_cafe` |
| checklists | `opening_fs` |
| sops | `cafe_sop_v1` (SOP PDF in `sop_files` — set via `demo/seed-s2.mjs`) |
| golden shifts | `golden_gap_open`, `golden_pass_open` (pre-scored; manager can open without AI) |

## Demo users

| User ID | Email | Labels |
|---------|-------|--------|
| `demo_staff` | staff@shiftproof.demo | `staff` |
| `demo_manager` | manager@shiftproof.demo | `manager` |

Passwords: see [`SEED.md`](./SEED.md) (demo only).

## Enums (frozen)

```
ShiftStatus:     draft | submitted | scoring | scored | closed
FindingStatus:   pass | gap | unclear
FindingSource:   ai | manager_override
AgentJobStatus:  waiting | running | done | failed
TaskStatus:      open | done
RoleLabel:       staff | manager
```
