/**
 * ShiftProof shared types — single source of field names for frontend + Functions.
 * Keep in sync with docs/APPWRITE.md. Do not rename enums mid-hackathon.
 */

export type RoleLabel = "staff" | "manager";

export type ShiftStatus =
  | "draft"
  | "submitted"
  | "scoring"
  | "scored"
  | "closed";

export type FindingStatus = "pass" | "gap" | "unclear";

export type FindingSource = "ai" | "manager_override" | "staff_recheck";

export type AgentJobStatus = "waiting" | "running" | "done" | "failed";

export type TaskStatus = "open" | "done";

export type EventType =
  | "shift.submitted"
  | "shift.closed"
  | "job.done"
  | "job.failed"
  | "job.retry"
  | "finding.overridden"
  | "finding.attested"
  | "finding.rescored"
  | "task.created"
  | "task.recheck"
  | "task.done"
  | string;

/** Appwrite system fields present on rows */
export interface AppwriteRowMeta {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  $permissions?: string[];
}

export interface Site extends AppwriteRowMeta {
  name: string;
  timezone?: string;
}

export interface Sop extends AppwriteRowMeta {
  siteId: string;
  title: string;
  fileId: string;
  clauseCount?: number;
  version?: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  requiredPhoto: boolean;
  relatedClauseIds: string[];
}

export interface Checklist extends AppwriteRowMeta {
  siteId: string;
  title: string;
  /** JSON string of ChecklistItem[] in Appwrite; parse in app layer */
  itemsJson: string;
}

export interface Shift extends AppwriteRowMeta {
  siteId: string;
  checklistId: string;
  createdBy: string;
  status: ShiftStatus;
  /** JSON string of evidence file IDs */
  photoFileIds?: string;
  startedAt: string;
  submittedAt?: string;
  scoredAt?: string;
}

export interface Finding extends AppwriteRowMeta {
  shiftId: string;
  itemId: string;
  status: FindingStatus;
  clauseId: string;
  quote: string;
  confidence: number;
  evidenceNote: string;
  source: FindingSource;
  overrideReason?: string;
  overriddenBy?: string;
  overriddenAt?: string;
}

export interface Task extends AppwriteRowMeta {
  shiftId: string;
  findingId: string;
  title: string;
  status: TaskStatus;
  assignedTo?: string;
  createdBy: string;
  recheckFileId?: string;
  createdAt: string;
  doneAt?: string;
}

export interface AgentJob extends AppwriteRowMeta {
  shiftId: string;
  status: AgentJobStatus;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  traceJson?: string;
}

export interface AuditEvent extends AppwriteRowMeta {
  shiftId: string;
  type: EventType;
  actorUserId: string;
  payloadJson?: string;
  createdAt: string;
}

/** AI function payload (JSON) — snake_case per FINDINGS_SCHEMA.json */
export interface FindingsPayloadItem {
  id: string;
  status: FindingStatus;
  clause_id: string;
  quote: string;
  confidence: number;
  evidence_note: string;
}

export interface FindingsPayload {
  items: FindingsPayloadItem[];
}

export interface CreateShiftInput {
  siteId: string;
  checklistId: string;
  createdBy: string;
  status: "draft";
  photoFileIds: string;
  startedAt: string;
}

export interface OverrideFindingInput {
  status: FindingStatus;
  source: "manager_override";
  overrideReason: string;
  overriddenBy: string;
  overriddenAt: string;
}

export interface CreateTaskInput {
  shiftId: string;
  findingId: string;
  title: string;
  status: "open";
  assignedTo?: string;
  createdBy: string;
  recheckFileId?: string;
  createdAt: string;
  doneAt?: string;
}

export interface CreateAgentJobInput {
  shiftId: string;
  status: "waiting";
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  traceJson?: string;
}

export interface RunShiftScoreRequest {
  shiftId: string;
  jobId: string;
}

/** Constants matching live Appwrite project Jammu */
export const APPWRITE_IDS = {
  projectId: "6a5b0ce3002605c7a776",
  endpoint: "https://sgp.cloud.appwrite.io/v1",
  databaseId: "shiftproof",
  tables: {
    sites: "sites",
    sops: "sops",
    checklists: "checklists",
    shifts: "shifts",
    findings: "findings",
    tasks: "tasks",
    agent_jobs: "agent_jobs",
    events: "events",
  },
  buckets: {
    sop_files: "sop_files",
    evidence: "evidence",
  },
  functions: {
    runShiftScore: "runShiftScore",
  },
  seed: {
    siteId: "demo_cafe",
    checklistId: "opening_fs",
    sopId: "cafe_sop_v1",
  },
} as const;
