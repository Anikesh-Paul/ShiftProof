# API contract — ShiftProof (Appwrite SDK ops)

> **Frontend may only call operations listed here.**  
> If UI needs something missing: update Appwrite schema + this file first.  
> IDs: [`APPWRITE.md`](./APPWRITE.md). Types: [`../types/shiftproof.ts`](../types/shiftproof.ts).

## Client setup

```ts
// Endpoint MUST be regional (sgp)
// VITE_APPWRITE_ENDPOINT=https://sgp.cloud.appwrite.io/v1
// VITE_APPWRITE_PROJECT_ID=6a5b0ce3002605c7a776

import { Client, Account, TablesDB, Storage, Functions, ID, Query } from "appwrite";

const client = new Client()
  .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT)
  .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);

const account = new Account(client);
const tables = new TablesDB(client);
const storage = new Storage(client);
const functions = new Functions(client);

export const DB = "shiftproof";
```

> SDK method names may vary slightly by Appwrite SDK version (`createRow` vs `createDocument`). Prefer TablesDB row APIs matching table IDs in APPWRITE.md.

## Errors

| HTTP / Appwrite | Meaning |
|-----------------|---------|
| 401 | Not logged in / session expired |
| 403 | Permission denied (wrong role or row security) |
| 404 | Missing row/file |
| 400 | Validation (enum, required field) |

Surface `message` from Appwrite error objects in the UI. Do not invent alternate error shapes.

---

## Auth

| Op | SDK | Notes |
|----|-----|-------|
| Register | `account.create(userId, email, password, name)` | Optional for MVP; demo users already exist |
| Login | `account.createEmailPasswordSession(email, password)` | |
| Logout | `account.deleteSession('current')` | |
| Me | `account.get()` | Read `$id`, `name`, `email`, `labels` |
| Role | from `user.labels` | Expect `staff` or `manager` |

**Routing rule:**  
- has label `manager` → manager shell  
- has label `staff` → staff shell  
- neither → show “contact admin” (do not invent roles)

---

## Read seed / config

| Op | Table / bucket | Query |
|----|----------------|-------|
| Get site | `sites` | get row `demo_cafe` |
| Get checklist | `checklists` | get row `opening_fs` |
| Parse items | | `JSON.parse(row.itemsJson)` → `ChecklistItem[]` |
| Get SOP meta | `sops` | get `cafe_sop_v1` (file may still be placeholder) |
| Upload SOP PDF | Storage `sop_files` | `storage.createFile('sop_files', ID.unique(), pdf)` then `tables.updateRow(sops, cafe_sop_v1, { fileId })` — manager UI on inbox |

---

## Staff journey

### 1. Start shift (draft)

**Create row** `shifts`:

```ts
{
  siteId: "demo_cafe",
  checklistId: "opening_fs",
  createdBy: user.$id,
  status: "draft",
  photoFileIds: "[]",
  startedAt: new Date().toISOString()
}
```

**Row permissions (rowSecurity=true on shifts):** set so creator can read/update; prefer also `read` for all `users` so manager inbox works, e.g.:

- `read("user:USER_ID")`, `update("user:USER_ID")`, `delete("user:USER_ID")`
- `read("users")` (or manager label if you tighten later)

### 2. Upload evidence photos (3–8)

**Storage create file** → bucket `evidence`:

- `storage.createFile('evidence', ID.unique(), file)`
- Collect returned file `$id`s

**Update shift:**

```ts
{
  photoFileIds: JSON.stringify(fileIds)
}
```

### 3. Submit shift + start AI job

**Update shift:**

```ts
{
  status: "submitted", // then "scoring" when job starts
  submittedAt: new Date().toISOString()
}
```

**Create row** `agent_jobs`:

```ts
{
  shiftId: shift.$id,
  status: "waiting",
  startedAt: null,
  errorMessage: null,
  finishedAt: null,
  traceJson: null
}
```

**Create event** `events`:

```ts
{
  shiftId: shift.$id,
  type: "shift.submitted",
  actorUserId: user.$id,
  payloadJson: JSON.stringify({ photoCount: fileIds.length }),
  createdAt: new Date().toISOString()
}
```

### 4. Trigger scoring (when Function is deployed)

```ts
functions.createExecution("runShiftScore", JSON.stringify({ shiftId, jobId }), false);
```

Until the Function is deployed, frontend may **poll** `agent_jobs` / leave status `waiting`, or a later session implements the Function body.

### 5. List own shifts

```ts
tables.listRows(DB, "shifts", [
  Query.equal("createdBy", user.$id),
  Query.orderDesc("startedAt")
]);
```

### 6. Read findings for a shift

```ts
tables.listRows(DB, "findings", [Query.equal("shiftId", shiftId)]);
```

### 7. Read job status

```ts
tables.listRows(DB, "agent_jobs", [Query.equal("shiftId", shiftId)]);
// or get by job id
```

### 8. Open fix tasks (Phase 3)

List open tasks assigned to this staff (or on their shifts):

```ts
// Prefer assignedTo when set
tables.listRows(DB, "tasks", [
  Query.equal("assignedTo", user.$id),
  Query.equal("status", "open"),
]);
// Also include open tasks on shifts where createdBy === user.$id
```

Staff home shows these as **Open fixes**. Flow after manager assigns:

1. Staff uploads one re-check photo → Storage `evidence`  
2. Update task: `recheckFileId` (status stays `open` until manager closes)  
3. Event `task.recheck`  
4. Re-score the linked finding (AI stub → typically `pass` with high confidence; `source: "ai"`)  
5. Event `finding.rescored`  
6. Manager marks task `done` (see manager §6)

---

## Manager journey

### 1. Inbox / list shifts

```ts
tables.listRows(DB, "shifts", [
  Query.equal("status", ["submitted", "scoring", "scored"]),
  Query.orderDesc("submittedAt")
]);
```

### 2. Scoreboard for one shift

- List `findings` by `shiftId`
- Show table: itemId, status (pass/gap/unclear), clauseId, quote, confidence, evidenceNote  
- **No free chat**

### 3. Override a finding

**Update row** `findings`:

```ts
{
  status: "pass" | "gap" | "unclear", // manager decision
  source: "manager_override",
  overrideReason: string, // required in UI even if column optional
  overriddenBy: user.$id,
  overriddenAt: new Date().toISOString()
}
```

**Create event:**

```ts
{
  shiftId,
  type: "finding.overridden",
  actorUserId: user.$id,
  payloadJson: JSON.stringify({ findingId, from, to, reason }),
  createdAt: new Date().toISOString()
}
```

### 4. Assign fix task

**Create row** `tasks`:

```ts
{
  shiftId,
  findingId,
  title: "Fix: …",
  status: "open",
  assignedTo: shift.createdBy, // staff who submitted (recommended)
  createdBy: user.$id,
  recheckFileId: null,
  createdAt: new Date().toISOString(),
  doneAt: null
}
```

**Event:** `type: "task.created"` (payload includes `assignedTo`)

### 5. Staff re-check + AI re-score (Phase 3 / boost #3)

Staff uploads one proof photo after fixing the gap:

1. **Storage** `evidence` — `storage.createFile(...)` → `recheckFileId`  
2. **Update task** (leave `status: "open"`):

```ts
{ recheckFileId }
```

3. **Event** `task.recheck`  
4. **Update finding** (AI re-score stub → usually `pass` with high confidence, `source: "ai"`)  
5. **Event** `finding.rescored`  

Manager reviews the re-score, then marks the task done (§6).

### 6. Mark task done

```ts
{ status: "done", doneAt: new Date().toISOString() }
```

**Event:** `type: "task.done"`

### 7. List events (audit)

```ts
tables.listRows(DB, "events", [
  Query.equal("shiftId", shiftId),
  Query.orderDesc("createdAt")
]);
```

---

## Realtime (manager)

Subscribe to table channels for:

- `agent_jobs` — job waiting/running/done  
- `findings` — new scores  
- `shifts` — status changes  
- `tasks` — new fixes  

Exact channel strings depend on Appwrite version; typically database/table subscriptions via `client.subscribe`. Document the working channel string in the frontend README when implemented.

---

## Function contract: `runShiftScore` (Gemini Flash)

**Input (JSON body):**

```json
{ "shiftId": "<id>", "jobId": "<id>" }
```

**Side effects (default production path):**

1. Set job `status=running`, `startedAt=now`  
2. Load shift photos from Storage `evidence` + checklist items  
3. Call **Gemini Flash** (Google AI Studio, `GOOGLE_AI_API_KEY` on Function only) → parse [`FINDINGS_SCHEMA.json`](./FINDINGS_SCHEMA.json)  
4. Low confidence → `unclear`; create one `findings` row per checklist item (`source: "ai"`)  
5. Set job `status=done`, `finishedAt=now`, `traceJson.mode=gemini`; shift `status=scored`, `scoredAt=now`  
6. Event `job.done`  
7. On Gemini/API/parse failure (default): job `status=failed`, `errorMessage=…`, event `job.failed` — **no silent stub**  
8. Optional: Function env `ALLOW_DEMO_STUB_SCORES=1` enables explicit stub only after Gemini fails  

**Client:** prefer `functions.createExecution("runShiftScore", …)`. Do not auto-run client deterministic stub on submit.

---

## Forbidden for frontend agents

- Inventing REST paths like `/api/reports`  
- New tables/columns without updating APPWRITE.md  
- Free-chat UI  
- Renaming enums mid-hackathon  
- Storing API keys in client code  
