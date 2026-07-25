/**
 * C8 — 1-page compliance pack (PROJECT.md / APP.md).
 * Print / Save as PDF via browser — no invented REST endpoints.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { FindingChip } from "../../components/FindingChip";
import { getErrorMessage } from "../../lib/errors";
import {
  itemLabel,
  listEvents,
  listTasks,
  loadManagerShift,
  type ManagerShiftSummary,
} from "../../lib/manager";
import { getSite } from "../../lib/shifts";
import type { AuditEvent, Task } from "../../types/shiftproof";
import "./ComplianceExport.css";

export function ComplianceExport() {
  const { shiftId = "" } = useParams();
  const [item, setItem] = useState<ManagerShiftSummary | null>(null);
  const [siteName, setSiteName] = useState("Demo café");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const generatedAt = new Date().toISOString();

  return (
    <div className="export-shell">
      <div className="export-toolbar no-print">
        <Link to={`/manager/shifts/${shift.$id}`} className="back-link">
          ← Scoreboard
        </Link>
        <Button
          variant="primary"
          onClick={() => window.print()}
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
            <span className="export-label">Shift ID</span>
            <p>{shift.$id}</p>
          </div>
          <div>
            <span className="export-label">Status</span>
            <p>{shift.status}</p>
          </div>
          <div>
            <span className="export-label">Staff</span>
            <p>{item.staffLabel}</p>
          </div>
          <div>
            <span className="export-label">Started</span>
            <p>{formatLong(shift.startedAt)}</p>
          </div>
          <div>
            <span className="export-label">Submitted</span>
            <p>
              {shift.submittedAt ? formatLong(shift.submittedAt) : "—"}
            </p>
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
                  .sort((a, b) => rank(a.status) - rank(b.status))
                  .map((f) => (
                    <tr key={f.$id}>
                      <td>
                        <FindingChip status={f.status} />
                      </td>
                      <td>{itemLabel(f.itemId)}</td>
                      <td>{f.clauseId}</td>
                      <td className="export-note">“{f.quote}”</td>
                      <td>{Math.round(f.confidence * 100)}%</td>
                      <td className="export-note">{f.evidenceNote}</td>
                      <td>
                        {f.source === "manager_override"
                          ? `Override${f.overrideReason ? `: ${f.overrideReason}` : ""}`
                          : "AI"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>

        {gaps.length > 0 || unclear.length > 0 ? (
          <section className="export-section">
            <h2>Open gaps & unclear</h2>
            <ul className="export-gaps">
              {[...gaps, ...unclear].map((f) => (
                <li key={f.$id}>
                  <strong>
                    {itemLabel(f.itemId)} ({f.clauseId})
                  </strong>
                  — “{f.quote}”
                  {f.overrideReason
                    ? ` Override: ${f.overrideReason}`
                    : ""}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {tasks.length > 0 ? (
          <section className="export-section">
            <h2>Fix tasks</h2>
            <ul className="export-gaps">
              {tasks.map((t) => (
                <li key={t.$id}>
                  <strong>{t.title}</strong> — {t.status}
                  {t.recheckFileId ? " · re-check photo on file" : ""}
                  {t.doneAt ? ` · done ${formatLong(t.doneAt)}` : ""}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {events.length > 0 ? (
          <section className="export-section">
            <h2>Audit trail</h2>
            <ul className="export-events">
              {events.slice(0, 15).map((ev) => (
                <li key={ev.$id}>
                  {ev.type} · {formatLong(ev.createdAt || ev.$createdAt)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="export-footer caption">
          ShiftProof · clause-cited opening proof · not a certification claim ·
          demo / operational record only
        </footer>
      </article>
    </div>
  );
}

function rank(status: string): number {
  if (status === "gap") return 0;
  if (status === "unclear") return 1;
  return 2;
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
