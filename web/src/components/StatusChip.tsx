import type { ShiftStatus } from "../types/shiftproof";
import "./StatusChip.css";

const LABELS: Record<ShiftStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  scoring: "Scoring",
  scored: "Scored",
  closed: "Closed",
};

export function StatusChip({ status }: { status: ShiftStatus }) {
  return (
    <span className={`status-chip status-${status}`} data-status={status}>
      {LABELS[status] ?? status}
    </span>
  );
}
