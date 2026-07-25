# Permissions — ShiftProof

## Role model

Roles are Appwrite **user labels** (not Teams):

| Label | Meaning |
|-------|---------|
| `staff` | Frontline café worker |
| `manager` | Owner / shift manager |

Demo users: `demo_staff` → `staff`, `demo_manager` → `manager`.

Frontend reads `account.get().labels`.

## Table-level permissions (as provisioned)

All tables currently use authenticated-user CRUD for hackathon speed:

```
read("users"), create("users"), update("users"), delete("users")
```

| Table | Row security | Notes |
|-------|--------------|-------|
| sites | off | Seed read by any logged-in user |
| sops | off | |
| checklists | off | |
| shifts | **on** | Set row `$permissions` on create (see API.md) |
| findings | off | Any user can read (demo); tighten later |
| tasks | off | |
| agent_jobs | off | |
| events | off | |

## Intended product matrix (document for later tighten)

| Resource | staff | manager |
|----------|-------|---------|
| sites / sops / checklists read | yes | yes |
| sites / sops / checklists write | no* | yes* |
| shifts create | yes (own) | yes |
| shifts read | own | all |
| shifts update | own draft/submit | status / close |
| evidence upload | yes | yes (recheck) |
| findings create | via Function | rare |
| findings update (override) | no | yes |
| tasks create/update | limited | yes |
| agent_jobs create | yes (on submit) | read |
| events create | yes (submit) | yes (override/task) |
| events read | own shift | all |

\*MVP seed was created via console/MCP; staff does not need write on seed tables.

## Storage

| Bucket | Current permissions | Intended |
|--------|---------------------|----------|
| `sop_files` | users CRUD | manager write; all users read |
| `evidence` | users CRUD | staff create; staff+manager read |

`fileSecurity` is **false** on both (bucket-level only).

## Function

| Function | execute |
|----------|---------|
| `runShiftScore` | `users` (any logged-in user may execute once deployed) |

## Auth methods

Email/password users created via Users API. Ensure **Email/Password** session is enabled in Appwrite Console → Auth if client login fails.

## Hardening later (not blocking MVP)

1. Replace table `users` write with `label:staff` / `label:manager` where appropriate.  
2. Enable fileSecurity on `evidence` and set per-file permissions to owner + managers.  
3. Restrict findings create to Function API key only.
