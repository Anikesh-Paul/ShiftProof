import type { ShiftStatus } from "../types/shiftproof";
import "./StatusChip.css";

const LABELS: Record<ShiftStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  scoring: "Scoring",
  scored: "Scored",
  closed: "Closed",
};

export function StatusChip({
  status,
  jobFailed,
}: {
  status: ShiftStatus;
  jobFailed?: boolean;
}) {
  if (jobFailed && (status === "submitted" || status === "scoring")) {
    return (
      <span className="status-chip status-failed" data-status="failed">
        Failed
      </span>
    );
  }
  return (
    <span className={`status-chip status-${status}`} data-status={status}>
      {LABELS[status] ?? status}
    </span>
  );
}
