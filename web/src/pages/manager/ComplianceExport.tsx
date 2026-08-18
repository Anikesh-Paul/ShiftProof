/**
 * C8 — 1-page compliance pack (PROJECT.md / APP.md).
 * Print / Save as PDF via browser — no invented REST endpoints.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { FindingChip } from "../../components/FindingChip";
import { EvidenceImg } from "../../components/EvidenceImg";
import { confidenceBand } from "../../lib/confidence";
import { formatEventType, formatFindingSource } from "../../lib/events";
import { displayEvidenceNote } from "../../lib/evidenceNote";
import { getErrorMessage } from "../../lib/errors";
import {
  citationForFinding,
  formatManagerWhen,
  isHarnessName,
  itemLabel,
  listEvents,
  listTasks,
  loadManagerShift,
  openFixTitle,
  shortItemLabel,
  type ManagerShiftSummary,
} from "../../lib/manager";
import { displayStaffName } from "../../lib/staffNames";
import {
  getChecklist,
  getSite,
  parseChecklistItems,
  parsePhotoFileIds,
  photoForItem,
} from "../../lib/shifts";
import type {
  AuditEvent,
  ChecklistItem,
  Finding,
  FindingStatus,
  ShiftStatus,
  Task,
  TaskStatus,
} from "../../types/shiftproof";
import "./ComplianceExport.css";

export function ComplianceExport() {
  const { shiftId = "" } = useParams();
  const [item, setItem] = useState<ManagerShiftSummary | null>(null);
  const [siteName, setSiteName] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printReady, setPrintReady] = useState(false);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [generatedAt] = useState(() => new Date().toISOString());
  const evidenceRef = useRef<HTMLElement>(null);
  const photoIds = item ? parsePhotoFileIds(item.shift.photoFileIds) : [];
  const photoKey = photoIds.join("\0");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [result, site, checklist] = await Promise.all([
          loadManagerShift(shiftId),
          getSite().catch(() => null),
          getChecklist().catch(() => null),
        ]);
        if (cancelled) return;
        if (!result) {
          setError("Shift not found.");
          return;
        }
        setItem(result.item);
        if (site?.name) setSiteName(site.name);
        else setSiteName("Demo café");
        if (checklist) setChecklistItems(parseChecklistItems(checklist));

        if (result.source === "live" && !shiftId.startsWith("demo_shift_")) {
          const [t, e] = await Promise.all([
            listTasks(result.item.shift.$id).catch(() => [] as Task[]),
            listEvents(result.item.shift.$id).catch(() => [] as AuditEvent[]),
          ]);
          if (!cancelled) {
            setTasks(t);
            setEvents(e);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, "Could not load export data"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  useEffect(() => {
    if (loading || !item) return;
    if (photoIds.length === 0) {
      setPrintReady(true);
      return;
    }
    setPrintReady(false);
    let cancelled = false;
    void decodeEvidenceImages(evidenceRef.current).then(() => {
      if (!cancelled) setPrintReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loading, item, photoKey, photoIds.length]);

  if (loading) {
    return (
      <div className="app-page">
        <p className="muted">Preparing compliance pack…</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="app-page stack">
        <Link to="/manager" className="back-link">
          ← Inbox
        </Link>
        <div className="error-banner" role="alert">
          {error || "Shift not found."}
        </div>
      </div>
    );
  }

  const { shift, findings } = item;
  const gaps = findings.filter((f) => f.status === "gap");
  const unclear = findings.filter((f) => f.status === "unclear");
  const passes = findings.filter((f) => f.status === "pass");
  const overrides = findings.filter((f) => f.source === "manager_override");

  return (
    <div className="export-shell">
      <div className="export-toolbar no-print">
        <Link to={`/manager/shifts/${shift.$id}`} className="back-link">
          ← Scoreboard
        </Link>
        <Button
          variant="primary"
          disabled={!printReady}
          data-print-ready={printReady ? "true" : "false"}
          onClick={async () => {
            await decodeEvidenceImages(evidenceRef.current);
            window.print();
          }}
        >
          Print / Save PDF
        </Button>
      </div>

      <article className="export-page" aria-label="Compliance pack">
        <header className="export-header">
          <div>
            <p className="export-brand">ShiftProof</p>
            <h1>Opening compliance pack</h1>
          </div>
          <div className="export-meta caption">
            <p>{siteName}</p>
            <p>Generated {formatLong(generatedAt)}</p>
          </div>
          <p className="export-gap-line" data-testid="pack-gap-sentence">
            {packGapSentence(findings, shift.submittedAt || shift.startedAt)}
          </p>
        </header>

        <section className="export-summary" data-testid="export-meta">
          <div>
            <span className="export-label">Site</span>
            <p>{siteName}</p>
          </div>
          <div>
            <span className="export-label">Staff</span>
            <p>{displayStaffName(item.staffLabel)}</p>
          </div>
          <div>
            <span className="export-label">Opening</span>
            <p>{formatLong(shift.submittedAt || shift.startedAt)}</p>
          </div>
          <div>
            <span className="export-label">Status</span>
            <p>{formatShiftStatus(shift.status)}</p>
          </div>
          <div>
            <span className="export-label">Scored</span>
            <p>{shift.scoredAt ? formatLong(shift.scoredAt) : "—"}</p>
          </div>
          <div>
            <span className="export-label">Pack generated</span>
            <p>{formatLong(generatedAt)}</p>
          </div>
        </section>

        {photoIds.length > 0 ? (
          <section
            ref={evidenceRef}
            className="export-section export-photos"
            aria-label="Evidence"
            data-testid="export-evidence"
          >
            <h2>Evidence</h2>
            <ul className="list-plain export-photo-grid">
              {photoIds.map((id, i) => (
                <li key={id} className="export-photo-tile" data-file-id={id}>
                  <EvidenceImg
                    fileId={id}
                    alt={`Evidence ${i + 1}`}
                    className="export-photo-img"
                    eager
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="export-tally">
          {passes.length > 0 ? (
            <span>
              <strong>{passes.length}</strong> Pass
            </span>
          ) : null}
          <span>
            <strong>{gaps.length}</strong> Gap
          </span>
          {unclear.length > 0 ? (
            <span>
              <strong>{unclear.length}</strong> Unclear
            </span>
          ) : null}
          {overrides.length > 0 ? (
            <span>
              <strong>{overrides.length}</strong> Override
              {overrides.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </section>

        <section className="export-section">
          <h2>Scoreboard</h2>
          {findings.length === 0 ? (
            <p className="muted">No findings on this shift yet.</p>
          ) : (
            <table className="export-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Item</th>
                  <th>Clause</th>
                  <th>Quote</th>
                  <th>Conf.</th>
                  <th>Evidence</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody data-testid="export-scoreboard">
                {[...findings]
                  .sort((a, b) => findingStatusRank(a.status) - findingStatusRank(b.status))
                  .map((f) => {
                    const note = displayEvidenceNote(f.evidenceNote);
                    const cite = citationForFinding(f, checklistItems);
                    const photoId = photoForItem(
                      f.itemId,
                      shift.photoFileIds,
                      checklistItems,
                    );
                    return (
                      <tr key={f.$id} className="export-row">
                        <td className="export-cell-status">
                          <FindingChip status={f.status} />
                        </td>
                        <td className="export-cell-item">
                          {shortItemLabel(f.itemId) || itemLabel(f.itemId)}
                        </td>
                        <td
                          className="export-cell-clause"
                          data-label="Clause"
                        >
                          {cite.gap ? "No clause cited" : cite.clauseId}
                        </td>
                        <td
                          className="export-cell-quote export-note"
                          data-label="Quote"
                        >
                          {cite.quote
                            ? `“${cite.quote}”`
                            : "No quote on file"}
                        </td>
                        <td
                          className="export-cell-conf"
                          data-label="Confidence"
                        >
                          {confidenceBand(f.confidence)}
                        </td>
                        <td
                          className="export-cell-evidence export-note"
                          data-label="Evidence"
                        >
                          {exportEvidenceCell(photoId, note, photoIds.length > 0)}
                        </td>
                        <td
                          className="export-cell-source"
                          data-testid="export-source"
                          data-source={f.source}
                          data-label="Source"
                        >
                          {f.source === "manager_override"
                            ? `Override${f.overrideReason ? `: ${f.overrideReason}` : ""}`
                            : formatFindingSource(f.source)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </section>

        {tasks.length > 0 ? (
          <section className="export-section">
            <h2>Fix tasks</h2>
            <ul className="export-gaps">
              {tasks.map((t) => {
                const f = findings.find((find) => find.$id === t.findingId);
                return (
                  <li key={t.$id} className="export-task-row">
                    <div>
                      <strong>{openFixTitle(t, f)}</strong> —{" "}
                      {formatTaskStatus(t.status)}
                      {t.recheckFileId ? " · re-check photo on file" : ""}
                      {t.doneAt ? ` · done ${formatLong(t.doneAt)}` : ""}
                    </div>
                    {t.recheckFileId ? (
                      <span data-testid="recheck-photo">
                        <EvidenceImg
                          fileId={t.recheckFileId}
                          alt="Re-check photo"
                          className="export-recheck-img"
                          eager
                        />
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {events.length > 0 ? (
          <section className="export-section">
            <h2>Audit trail</h2>
            <ul className="export-events">
              {events.slice(0, 15).map((ev) => (
                <li key={ev.$id}>
                  {formatEventType(ev.type)} ·{" "}
                  {formatLong(ev.createdAt || ev.$createdAt)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="export-footer caption">
          ShiftProof · clause-cited opening proof · operational record only
        </footer>
      </article>
    </div>
  );
}

function exportEvidenceCell(
  photoId: string | null,
  note: string | null,
  shiftHasPhotos: boolean,
) {
  if (photoId) {
    return (
      <span className="export-evidence-file">
        <EvidenceImg
          fileId={photoId}
          alt=""
          className="export-cell-thumb"
          eager
          compact
        />
        {note ? <span>{note}</span> : null}
      </span>
    );
  }
  if (note) return note;
  if (shiftHasPhotos) return "Photo on file";
  return "No photo on file";
}

function decodeEvidenceImages(root: HTMLElement | null): Promise<void> {
  if (!root) return Promise.resolve();
  const deadline = Date.now() + 8000;
  return new Promise((resolve) => {
    const tick = () => {
      const pending = root.querySelectorAll("[data-evidence='pending']");
      const imgs = [...root.querySelectorAll<HTMLImageElement>("img")];
      const decoded =
        pending.length === 0 &&
        imgs.every((img) => img.complete && img.naturalWidth > 0);
      if (decoded || Date.now() >= deadline) {
        resolve();
        return;
      }
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

function findingStatusRank(status: FindingStatus | string): number {
  if (status === "gap") return 0;
  if (status === "unclear") return 1;
  return 2;
}

const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  scoring: "Scoring",
  scored: "Scored",
  closed: "Closed",
};

function formatShiftStatus(status: ShiftStatus | string): string {
  return (
    SHIFT_STATUS_LABELS[status as ShiftStatus] ??
    (status ? status.charAt(0).toUpperCase() + status.slice(1) : "—")
  );
}

function formatTaskStatus(status: TaskStatus | string): string {
  return status === "done" ? "Done" : "Open";
}

function formatPackDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(date);
}

/** This Shift’s stored Gaps only — Unclear stays in the tally, not this line. */
function packGapSentence(
  findings: Finding[],
  submittedAt?: string,
): string {
  const date = formatPackDay(submittedAt ?? "");
  const gaps = findings.filter((f) => f.status === "gap");
  if (gaps.length === 0) return `${date}: no Gaps`;
  const labels = gaps
    .map((f) => shortItemLabel(f.itemId) || itemLabel(f.itemId))
    .filter((label) => label && !isHarnessName(label))
    .join(", ");
  const noun = gaps.length === 1 ? "Gap" : "Gaps";
  if (!labels) return `${date}: ${gaps.length} ${noun}`;
  return `${date}: ${gaps.length} ${noun} — ${labels}`;
}

function formatLong(iso: string): string {
  return formatManagerWhen(iso, { year: true });
}
