/**
 * C8 — 1-page compliance pack (PROJECT.md / APP.md).
 * Print / Save as PDF via browser — no invented REST endpoints.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { FindingChip } from "../../components/FindingChip";
import { EvidenceImg } from "../../components/EvidenceImg";
import { formatEventType, formatFindingSource } from "../../lib/events";
import { getErrorMessage } from "../../lib/errors";
import {
  itemLabel,
  listEvents,
  listTasks,
  loadManagerShift,
  type ManagerShiftSummary,
} from "../../lib/manager";
import { getSite, parsePhotoFileIds } from "../../lib/shifts";
import type {
  AuditEvent,
  FindingStatus,
  ShiftStatus,
  Task,
  TaskStatus,
} from "../../types/shiftproof";
import "./ComplianceExport.css";

export function ComplianceExport() {
  const { shiftId = "" } = useParams();
  const [item, setItem] = useState<ManagerShiftSummary | null>(null);
  const [siteName, setSiteName] = useState("Demo café");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printReady, setPrintReady] = useState(false);
  const [generatedAt] = useState(() => new Date().toISOString());
  const evidenceRef = useRef<HTMLElement>(null);
  const photoIds = item ? parsePhotoFileIds(item.shift.photoFileIds) : [];
  const photoKey = photoIds.join("\0");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [result, site] = await Promise.all([
          loadManagerShift(shiftId),
          getSite().catch(() => null),
        ]);
        if (cancelled) return;
        if (!result) {
          setError("Shift not found.");
          return;
        }
        setItem(result.item);
        if (site?.name) setSiteName(site.name);

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
        </header>

        <section className="export-summary" data-testid="export-meta">
          <div>
            <span className="export-label">Site</span>
            <p>{siteName}</p>
          </div>
          <div>
            <span className="export-label">Staff</span>
            <p>{item.staffLabel}</p>
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
          <span>
            <strong>{passes.length}</strong> Pass
          </span>
          <span>
            <strong>{gaps.length}</strong> Gap
          </span>
          <span>
            <strong>{unclear.length}</strong> Unclear
          </span>
          <span>
            <strong>{overrides.length}</strong> Override
            {overrides.length === 1 ? "" : "s"}
          </span>
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
                    return (
                      <tr key={f.$id} className="export-row">
                        <td className="export-cell-status">
                          <FindingChip status={f.status} />
                        </td>
                        <td className="export-cell-item">{itemLabel(f.itemId)}</td>
                        <td className="export-cell-clause">{f.clauseId}</td>
                        <td className="export-cell-quote export-note">
                          {f.quote ? `“${f.quote}”` : "—"}
                        </td>
                        <td className="export-cell-conf">
                          {confidenceLabel(f.confidence)}
                        </td>
                        <td className="export-cell-evidence export-note">
                          {note || "—"}
                        </td>
                        <td
                          className="export-cell-source"
                          data-testid="export-source"
                          data-source={f.source}
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
                  <li key={t.$id}>
                    <strong>{openFixTitle(t, f)}</strong> —{" "}
                    {formatTaskStatus(t.status)}
                    {t.recheckFileId ? " · re-check photo on file" : ""}
                    {t.doneAt ? ` · done ${formatLong(t.doneAt)}` : ""}
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

function decodeEvidenceImages(root: HTMLElement | null): Promise<void> {
  if (!root) return Promise.resolve();
  const imgs = [...root.querySelectorAll<HTMLImageElement>("img")];
  return Promise.all(
    imgs.map((img) => img.decode().catch(() => undefined)),
  ).then(() => undefined);
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

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}% sure`;
}

function displayEvidenceNote(note: string | undefined): string | null {
  if (!note?.trim()) return null;
  if (/seeded e2e finding\.?/i.test(note.trim())) return null;
  if (/seeded/i.test(note.trim())) return null;
  return note;
}

function isHarnessName(text: string): boolean {
  return /\be2e\b/i.test(text) || /durability[-_ ]/i.test(text);
}

function openFixTitle(task: Task, finding?: { itemId: string }): string {
  const kind = /^retake:/i.test(task.title) ? "Retake" : "Fix";
  if (finding) {
    const label = itemLabel(finding.itemId);
    if (!isHarnessName(finding.itemId) && !isHarnessName(label)) {
      return `${kind}: ${label}`;
    }
    return kind;
  }
  if (isHarnessName(task.title)) return kind;
  return task.title;
}

function formatLong(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
