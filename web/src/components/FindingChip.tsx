import type { FindingStatus } from "../types/shiftproof";
import "./FindingChip.css";

const LABELS: Record<FindingStatus, string> = {
  pass: "Pass",
  gap: "Gap",
  unclear: "Unclear",
};

export function FindingChip({ status }: { status: FindingStatus }) {
  return (
    <span className={`finding-chip finding-${status}`} data-status={status}>
      {LABELS[status]}
    </span>
  );
}
