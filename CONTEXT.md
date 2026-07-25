# ShiftProof

Photo-proof SOP compliance for a single demo café: staff upload opening-shift photos; AI scores checklist items; managers act on gaps and export an audit pack.

## Language

**Shift**:
One opening-check session for a site (draft → submitted → scoring → scored → closed).
_Avoid_: Session (ambiguous), inspection (implies official certification)

**Finding**:
The scored result for one checklist item on a shift: Pass, Gap, or Unclear, with clause citation and confidence.
_Avoid_: Issue, ticket, violation (use Gap for non-compliance)

**Pass**:
Evidence supports that the checklist item meets the cited SOP clause.

**Gap**:
Evidence supports non-compliance with the cited SOP clause.
_Avoid_: Fail, red item (UI may use color but the term is Gap)

**Unclear**:
Evidence is insufficient or ambiguous; a human (manager) must decide.
_Avoid_: Error, unknown, maybe

**Scoreboard**:
The structured table of findings for a shift (not a chat).
_Avoid_: Inbox (inbox is the manager list of shifts), dashboard (too generic)

**Override**:
A manager correction of an AI finding, with a recorded reason and audit event.
_Avoid_: Edit, fix (fix is the remediation task)

**Task**:
A “please fix this” job assigned from a finding (often a Gap), optionally closed after a re-check photo.
_Avoid_: Ticket, work order

**Re-check**:
A follow-up evidence photo for a task, used to re-score that finding.
_Avoid_: Appeal, second opinion

**Agent job**:
The background scoring run for a shift (waiting / running / done / failed).
_Avoid_: Build, pipeline (unless speaking informally)

**Golden shift**:
A pre-scored shift kept for demo insurance when live vision is unavailable.
_Avoid_: Fake shift (implies dishonest demo), sample-only UI mock with no DB row

**Compliance pack**:
The one-page export summarizing a shift’s scoreboard, gaps, overrides, and timestamps.
_Avoid_: Certificate, inspection pass document

**Site**:
One café location in MVP (`demo_cafe` only).
_Avoid_: Tenant, org (multi-tenancy is out of scope)

**SOP**:
The rule-book document (PDF) whose clauses are cited on findings.
_Avoid_: Policy pack (pitch language only for future multi-pack story)
