/**
 * C4 scoreboard + C6 override / assign fix / tasks / events (docs/API.md).
 * No free chat. Live Appwrite writes when source is live; demo stays local.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type AnimationEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import {
  EvidenceLightbox,
  type EvidenceSlide,
} from "../../components/EvidenceLightbox";
import { FindingChip } from "../../components/FindingChip";
import { StatusChip } from "../../components/StatusChip";
import { useAuth } from "../../lib/auth";
import { getErrorMessage } from "../../lib/errors";
import { useSlowLoading } from "../../lib/loading";
import {
  applyLocalOverride,
  assignFixTask,
  attachRecheckAndRescore,
  DEMO_AGENT_TRACE,
  getAgentJobTrace,
  hasForcedCitation,
  itemLabel,
  listEvents,
  listTasks,
  loadManagerShift,
  markTaskDone,
  overrideFinding,
  type ManagerShiftSummary,
} from "../../lib/manager";
import {
  getEvidencePreviewUrl,
  parsePhotoFileIds,
  uploadEvidence,
} from "../../lib/shifts";
import { resolveStaffLabel } from "../../lib/staffNames";
import type {
  AuditEvent,
  Finding,
  FindingStatus,
  Task,
} from "../../types/shiftproof";
import "./ManagerShiftDetail.css";

type StickyMode = "idle" | "override" | "assign";

type AgentTrace = {
  jobId: string;
  status: string;
  steps: string[];
  raw: Record<string, unknown> | null;
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ManagerShiftDetail() {
  const { shiftId = "" } = useParams();
  const { user } = useAuth();
  const [item, setItem] = useState<ManagerShiftSummary | null>(null);
  const [source, setSource] = useState<"live" | "demo">("demo");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [agentTrace, setAgentTrace] = useState<AgentTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingSlow = useSlowLoading(loading);
  const [showAll, setShowAll] = useState(false);
  const [lightbox, setLightbox] = useState<{
    items: EvidenceSlide[];
    startIndex: number;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<StickyMode>("idle");
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [overrideTo, setOverrideTo] = useState<FindingStatus>("pass");
  const [toast, setToast] = useState<string | null>(null);
  const [recheckTaskId, setRecheckTaskId] = useState<string | null>(null);

  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);
  const [toastShown, setToastShown] = useState<string | null>(null);
  const [toastExiting, setToastExiting] = useState(false);

  useEffect(() => {
    if (error) {
      setErrorShown(error);
      setErrorExiting(false);
      return;
    }
    if (errorShown && !errorExiting) {
      if (prefersReducedMotion()) {
        setErrorShown(null);
        setErrorExiting(false);
      } else {
        setErrorExiting(true);
      }
    }
  }, [error, errorShown, errorExiting]);

  useEffect(() => {
    if (toast) {
      setToastShown(toast);
      setToastExiting(false);
      return;
    }
    if (toastShown && !toastExiting) {
      if (prefersReducedMotion()) {
        setToastShown(null);
        setToastExiting(false);
      } else {
        setToastExiting(true);
      }
    }
  }, [toast, toastShown, toastExiting]);

  function onErrorExitEnd(e: AnimationEvent<HTMLDivElement>) {
    if (!errorExiting) return;
    if (e.animationName && e.animationName !== "toast-out") return;
    setErrorShown(null);
    setErrorExiting(false);
  }

  function onToastExitEnd(e: AnimationEvent<HTMLParagraphElement>) {
    if (!toastExiting) return;
    if (e.animationName && e.animationName !== "toast-out") return;
    setToastShown(null);
    setToastExiting(false);
  }

  const loadExtras = useCallback(async (id: string, isDemo: boolean) => {
    if (isDemo || id.startsWith("demo_shift_")) {
      setAgentTrace(DEMO_AGENT_TRACE);
      // Phase 3 — sample open task assigned to shift staff for re-check demo
      setTasks([
        {
          $id: "local_task_demo",
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
          shiftId: id,
          findingId: "fa1",
          title: "Fix: Gloves at prep",
          status: "open",
          assignedTo: "demo_staff",
          createdBy: "demo_manager",
          createdAt: new Date().toISOString(),
        },
      ]);
      return;
    }
    try {
      const [t, e, trace] = await Promise.all([
        listTasks(id),
        listEvents(id),
        getAgentJobTrace(id).catch(() => null),
      ]);
      setTasks(t);
      setEvents(e);
      setAgentTrace(trace ?? DEMO_AGENT_TRACE);
    } catch {
      // Non-blocking for scoreboard
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadManagerShift(shiftId);
        if (cancelled) return;
        if (!result) {
          setError("Shift not found.");
          setItem(null);
          setLoading(false);
          return;
        }
        // Paint scoreboard first — extras (trace/tasks/events) fill in after
        setItem(result.item);
        setSource(result.source);
        setLoading(false);
        void loadExtras(result.item.shift.$id, result.source === "demo");
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, "Could not load scoreboard"));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shiftId, loadExtras]);

  const selected = useMemo(
    () => item?.findings.find((f) => f.$id === selectedId) ?? null,
    [item, selectedId],
  );

  const visibleFindings = useMemo(() => {
    if (!item) return [];
    const open = item.findings.filter(
      (f) => f.status === "gap" || f.status === "unclear",
    );
    if (showAll) {
      return [...item.findings].sort((a, b) => rank(a) - rank(b));
    }
    return open;
  }, [item, showAll]);

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status === "open"),
    [tasks],
  );

  const unclearFindings = useMemo(
    () => item?.findings.filter((f) => f.status === "unclear") ?? [],
    [item],
  );

  const citationGaps = useMemo(
    () => (item?.findings ?? []).filter((f) => !hasForcedCitation(f)),
    [item],
  );

  function selectFinding(f: Finding) {
    setSelectedId(f.$id);
    setMode("idle");
    setReason("");
    setToast(null);
    setError(null);
  }

  async function runOverride() {
    if (!item || !selected || !user) return;
    if (!reason.trim()) {
      setError("Add a short reason for the override.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (source === "demo") {
        setItem(
          applyLocalOverride(
            item,
            selected.$id,
            overrideTo,
            reason.trim(),
            user.$id,
          ),
        );
        setEvents((prev) => [
          {
            $id: `local_${Date.now()}`,
            $createdAt: new Date().toISOString(),
            $updatedAt: new Date().toISOString(),
            shiftId: item.shift.$id,
            type: "finding.overridden",
            actorUserId: user.$id,
            payloadJson: JSON.stringify({
              findingId: selected.$id,
              from: selected.status,
              to: overrideTo,
              reason: reason.trim(),
            }),
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      } else {
        await overrideFinding({
          findingId: selected.$id,
          shiftId: item.shift.$id,
          from: selected.status,
          to: overrideTo,
          reason: reason.trim(),
          userId: user.$id,
        });
        const refreshed = await loadManagerShift(shiftId);
        if (refreshed) {
          setItem(refreshed.item);
          setSource(refreshed.source);
        }
        await loadExtras(item.shift.$id, false);
      }
      setToast(`Overrode to ${overrideTo}.`);
      setMode("idle");
      setReason("");
      setSelectedId(null);
    } catch (err) {
      setError(getErrorMessage(err, "Override failed"));
      setMode("override");
    } finally {
      setSaving(false);
    }
  }

  async function runAssign() {
    if (!item || !selected || !user) return;
    setError(null);
    setSaving(true);
    const title = `Fix: ${itemLabel(selected.itemId)}`;
    const assignedTo = item.shift.createdBy;
    try {
      if (source === "demo") {
        const localTask: Task = {
          $id: `local_task_${Date.now()}`,
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
          shiftId: item.shift.$id,
          findingId: selected.$id,
          title,
          status: "open",
          assignedTo,
          createdBy: user.$id,
          createdAt: new Date().toISOString(),
        };
        setTasks((prev) => [localTask, ...prev]);
        setEvents((prev) => [
          {
            $id: `local_ev_${Date.now()}`,
            $createdAt: new Date().toISOString(),
            $updatedAt: new Date().toISOString(),
            shiftId: item.shift.$id,
            type: "task.created",
            actorUserId: user.$id,
            payloadJson: JSON.stringify({
              findingId: selected.$id,
              taskId: localTask.$id,
              title,
              assignedTo,
            }),
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setToast(
          `Task assigned to ${resolveStaffLabel(assignedTo)} (sample): ${title}`,
        );
      } else {
        await assignFixTask({
          shiftId: item.shift.$id,
          findingId: selected.$id,
          title,
          userId: user.$id,
          assignedTo,
        });
        await loadExtras(item.shift.$id, false);
        setToast(
          `Task assigned to ${resolveStaffLabel(assignedTo)}: ${title}`,
        );
      }
      setMode("idle");
      setSelectedId(null);
    } catch (err) {
      setError(getErrorMessage(err, "Could not create task"));
      setMode("assign");
    } finally {
      setSaving(false);
    }
  }

  async function completeTask(taskId: string) {
    if (!item || !user) return;
    setError(null);
    try {
      if (source === "demo" || taskId.startsWith("local_")) {
        setTasks((prev) =>
          prev.map((t) =>
            t.$id === taskId
              ? {
                  ...t,
                  status: "done" as const,
                  doneAt: new Date().toISOString(),
                }
              : t,
          ),
        );
        setEvents((prev) => [
          {
            $id: `local_ev_done_${Date.now()}`,
            $createdAt: new Date().toISOString(),
            $updatedAt: new Date().toISOString(),
            shiftId: item.shift.$id,
            type: "task.done",
            actorUserId: user.$id,
            payloadJson: JSON.stringify({ taskId }),
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setToast("Task marked done.");
      } else {
        await markTaskDone({
          taskId,
          shiftId: item.shift.$id,
          userId: user.$id,
        });
        await loadExtras(item.shift.$id, false);
        setToast("Task marked done.");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Could not update task"));
    }
  }

  /**
   * Manager can also attach re-check (backup). Primary path is staff upload.
   * Re-check re-scores the finding; task stays open until Mark done.
   */
  async function onRecheckFile(taskId: string, fileList: FileList | null) {
    if (!fileList?.[0] || !item || !user) return;
    const task = tasks.find((t) => t.$id === taskId);
    if (!task) return;
    setError(null);
    setRecheckTaskId(taskId);
    try {
      if (source === "demo" || taskId.startsWith("local_")) {
        setTasks((prev) =>
          prev.map((t) =>
            t.$id === taskId
              ? {
                  ...t,
                  recheckFileId: `demo_recheck_${Date.now()}`,
                }
              : t,
          ),
        );
        // Local demo: flip matching finding to pass after re-check
        setItem((prev) => {
          if (!prev) return prev;
          const findings = prev.findings.map((f) =>
            f.$id === task.findingId
              ? {
                  ...f,
                  status: "pass" as const,
                  confidence: 0.91,
                  evidenceNote: "Re-check photo confirms compliance after fix.",
                  source: "ai" as const,
                  overrideReason: undefined,
                }
              : f,
          );
          return {
            ...prev,
            findings,
            gapCount: findings.filter((f) => f.status === "gap").length,
            unclearCount: findings.filter((f) => f.status === "unclear")
              .length,
            passCount: findings.filter((f) => f.status === "pass").length,
          };
        });
        setEvents((prev) => [
          {
            $id: `local_ev_recheck_${Date.now()}`,
            $createdAt: new Date().toISOString(),
            $updatedAt: new Date().toISOString(),
            shiftId: item.shift.$id,
            type: "task.recheck",
            actorUserId: user.$id,
            payloadJson: JSON.stringify({ taskId, findingId: task.findingId }),
            createdAt: new Date().toISOString(),
          },
          {
            $id: `local_ev_rescore_${Date.now()}`,
            $createdAt: new Date().toISOString(),
            $updatedAt: new Date().toISOString(),
            shiftId: item.shift.$id,
            type: "finding.rescored",
            actorUserId: user.$id,
            payloadJson: JSON.stringify({
              findingId: task.findingId,
              status: "pass",
            }),
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setToast("Re-check attached (sample). AI re-scored Pass — mark done when ready.");
      } else {
        const fileId = await uploadEvidence(fileList[0]);
        await attachRecheckAndRescore({
          taskId,
          shiftId: item.shift.$id,
          findingId: task.findingId,
          recheckFileId: fileId,
          userId: user.$id,
        });
        const refreshed = await loadManagerShift(item.shift.$id);
        if (refreshed) {
          setItem(refreshed.item);
          setSource(refreshed.source);
        }
        await loadExtras(item.shift.$id, false);
        setToast("Re-check saved. Finding re-scored — mark done when ready.");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Could not attach re-check photo"));
    } finally {
      setRecheckTaskId(null);
    }
  }

  if (loading) {
    return (
      <div className="app-page stack">
        <div className="skeleton-card" style={{ minHeight: "3rem" }} />
        <div className="skeleton-card" style={{ minHeight: "8rem" }} />
        <div className="skeleton-card" style={{ minHeight: "8rem" }} />
        {loadingSlow ? (
          <p className="loading-slow-hint" role="status">
            Still loading scoreboard…
          </p>
        ) : null}
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

  const openCount = item.gapCount + item.unclearCount;
  const evidenceIds = parsePhotoFileIds(item.shift.photoFileIds);
  const evidenceSlides: EvidenceSlide[] = evidenceIds.map((fid, j) => ({
    src: getEvidencePreviewUrl(fid),
    label: `Evidence ${j + 1}`,
  }));

  return (
    <div className={`manager-detail ${selected ? "has-sticky" : ""}`}>
      <div className="app-page stack manager-detail-page staff-settle-in">
        <div className="manager-detail-nav">
          <Link to="/manager" className="back-link">
            ← Inbox
          </Link>
          <Link
            to={`/manager/shifts/${item.shift.$id}/export`}
            className="text-btn is-accent export-link"
          >
            Export pack
          </Link>
        </div>

        <header className="stack-sm">
          <div className="manager-detail-meta">
            <StatusChip status={item.shift.status} />
            <span className="caption">
              {formatWhen(item.shift.submittedAt || item.shift.startedAt)}
            </span>
          </div>
          <h1>Scoreboard</h1>
          <p className="muted">
            {item.staffLabel}
            {source === "demo" ? " · sample data" : ""}
          </p>
        </header>

        <div className="manager-tally" aria-label="Finding counts">
          <span>
            <strong>{item.gapCount}</strong> Gap
          </span>
          <span className="tally-sep" aria-hidden>
            ·
          </span>
          <span>
            <strong>{item.unclearCount}</strong> Unclear
          </span>
          {showAll || item.passCount > 0 ? (
            <>
              <span className="tally-sep" aria-hidden>
                ·
              </span>
              <span>
                <strong>{item.passCount}</strong> Pass
              </span>
            </>
          ) : null}
        </div>

        {/* Evidence photos — same bucket staff uploaded to; manager can review frames */}
        <section
          className="card stack-sm evidence-gallery"
          aria-label="Shift evidence photos"
        >
          <div className="evidence-gallery-head">
            <h2>Evidence</h2>
            <p className="caption">
              {evidenceIds.length === 0
                ? "No photos on this shift"
                : `${evidenceIds.length} photo${evidenceIds.length === 1 ? "" : "s"} from opening check`}
            </p>
          </div>
          {evidenceIds.length > 0 ? (
            <ul className="list-plain evidence-grid">
              {evidenceIds.map((id, i) => {
                const src = getEvidencePreviewUrl(id);
                const label = `Evidence ${i + 1}`;
                return (
                  <li key={id} className="evidence-tile">
                    <button
                      type="button"
                      className="evidence-link"
                      onClick={() =>
                        setLightbox({
                          items: evidenceSlides,
                          startIndex: i,
                        })
                      }
                      aria-label={`View ${label}`}
                    >
                      <img
                        src={src}
                        alt={label}
                        className="evidence-img"
                        loading="lazy"
                        onError={(e) => {
                          const el = e.currentTarget;
                          el.style.display = "none";
                          const fallback = el.nextElementSibling;
                          if (fallback instanceof HTMLElement) {
                            fallback.hidden = false;
                          }
                        }}
                      />
                      <span className="evidence-missing caption" hidden>
                        Unavailable
                      </span>
                      <span className="evidence-index caption">{i + 1}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted caption">
              Photos appear here once staff uploads and saves evidence.
            </p>
          )}
        </section>

        {/* Boost #1 — agent trace (product copy, no debug stub/job ids) */}
        {agentTrace ? (
          <section
            className="card stack-sm agent-trace"
            data-testid="agent-trace"
            aria-label="Agent trace"
          >
            <h2>How this was scored</h2>
            <p className="caption">
              {agentTrace.status === "done" ? "Scoring complete" : agentTrace.status}
            </p>
            <ol className="agent-trace-steps">
              {agentTrace.steps
                .map(stripStepNumber)
                .filter(Boolean)
                .map((s) => (
                  <li key={s}>{s}</li>
                ))}
            </ol>
            {citationGaps.length > 0 ? (
              <p className="caption" data-testid="citation-warning">
                {citationGaps.length} finding(s) missing clause/quote/confidence.
              </p>
            ) : (
              <p className="caption" data-testid="citations-ok">
                All findings carry clause · quote · confidence.
              </p>
            )}
          </section>
        ) : null}

        {/* Boost #2 — hero Unclear */}
        {unclearFindings.length > 0 ? (
          <section
            className="hero-unclear card stack-sm"
            data-testid="hero-unclear"
            aria-label="Unclear findings need review"
          >
            <h2>Needs human eyes</h2>
            <p className="muted">
              AI marked Unclear — override with a reason or assign a fix.
            </p>
            <ul className="list-plain hero-unclear-list">
              {unclearFindings.map((f) => (
                <li key={f.$id}>
                  <button
                    type="button"
                    className="hero-unclear-item"
                    onClick={() => selectFinding(f)}
                  >
                    <FindingChip status="unclear" />
                    <span className="finding-title">{itemLabel(f.itemId)}</span>
                    <span className="citation-bar caption" data-testid="citation">
                      {f.clauseId} · {Math.round(f.confidence * 100)}% · “
                      {f.quote.slice(0, 80)}
                      {f.quote.length > 80 ? "…" : ""}”
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="manager-filter-row">
          <p className="caption">
            {showAll
              ? "All findings"
              : openCount === 0
                ? "No open gaps on this shift"
                : "Open gaps only"}
          </p>
          <button
            type="button"
            className="text-btn"
            onClick={() => setShowAll((v) => !v)}
            aria-pressed={showAll}
          >
            {showAll ? "Hide passes" : "Show all"}
          </button>
        </div>

        {errorShown ? (
          <div
            className="error-banner"
            data-enter={!errorExiting ? "true" : undefined}
            data-exit={errorExiting ? "true" : undefined}
            role="alert"
            onAnimationEnd={onErrorExitEnd}
          >
            {errorShown}
          </div>
        ) : null}

        {toastShown ? (
          <p
            className="manager-toast"
            data-enter={!toastExiting ? "true" : undefined}
            data-exit={toastExiting ? "true" : undefined}
            role="status"
            onAnimationEnd={onToastExitEnd}
          >
            {toastShown}
          </p>
        ) : null}

        {visibleFindings.length === 0 ? (
          <div className="card stack-sm">
            <h2>
              {item.findings.length === 0
                ? item.shift.status === "scored"
                  ? "No findings yet"
                  : "Waiting on score"
                : "No open gaps"}
            </h2>
            <p className="muted">
              {item.findings.length === 0
                ? "Scoring writes Pass / Gap / Unclear when runShiftScore finishes (C3)."
                : "Show all to review passes."}
            </p>
          </div>
        ) : (
          <ul
            className="list-plain finding-list stagger-in"
            role="listbox"
            aria-label="Findings"
          >
            {visibleFindings.map((f) => {
              const isSelected = f.$id === selectedId;
              return (
                <li key={f.$id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`finding-row card ${isSelected ? "is-selected" : ""}`}
                    onClick={() => selectFinding(f)}
                  >
                    <div className="finding-row-top">
                      <FindingChip status={f.status} />
                      <span className="caption citation-clause">{f.clauseId}</span>
                    </div>
                    <p className="finding-title">{itemLabel(f.itemId)}</p>
                    {/* Boost #1 forced citation */}
                    <p
                      className="citation-bar caption"
                      data-testid="citation"
                    >
                      {f.clauseId} · conf {Math.round(f.confidence * 100)}%
                    </p>
                    <p className="finding-quote muted">“{f.quote}”</p>
                    <p className="finding-note caption">{f.evidenceNote}</p>
                    {f.source === "manager_override" && f.overrideReason ? (
                      <p
                        className="override-reason caption"
                        data-testid="override-reason"
                      >
                        Override: {f.overrideReason}
                      </p>
                    ) : null}
                    <p className="finding-conf caption">
                      {f.source === "manager_override" ? "Manager override" : "AI"}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* C6 — open fix tasks */}
        {openTasks.length > 0 || tasks.length > 0 ? (
          <section className="card stack-sm manager-side-panel">
            <h2>Fix tasks</h2>
            {tasks.length === 0 ? (
              <p className="muted caption">No tasks yet.</p>
            ) : (
              <ul className="list-plain task-list">
                {tasks.map((t) => (
                  <li key={t.$id} className="task-row" data-testid="fix-row">
                    <div className="stack-sm">
                      <p className="task-title">{t.title}</p>
                      <p className="caption">
                        {t.status === "open" ? "Open" : "Done"}
                        {t.assignedTo
                          ? ` · ${resolveStaffLabel(t.assignedTo)}`
                          : ""}
                        {t.createdAt ? ` · ${formatWhen(t.createdAt)}` : ""}
                      </p>
                      {t.recheckFileId ? (
                        <p
                          className="caption task-recheck-status"
                          data-testid="task-recheck-status"
                        >
                          Re-check on file · AI re-scored — close when ready
                        </p>
                      ) : t.status === "open" ? (
                        <p className="caption muted">
                          Waiting for staff re-check photo
                        </p>
                      ) : null}
                    </div>
                    {t.status === "open" ? (
                      <div className="task-actions">
                        <label className="recheck-upload">
                          <span className="caption">
                            {recheckTaskId === t.$id
                              ? "Uploading…"
                              : t.recheckFileId
                                ? "Replace re-check"
                                : "Re-check photo"}
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="visually-hidden"
                            data-testid="recheck-input"
                            disabled={recheckTaskId === t.$id}
                            onChange={(e) => {
                              void onRecheckFile(t.$id, e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <Button
                          variant={t.recheckFileId ? "primary" : "secondary"}
                          className="task-done-btn"
                          data-testid="task-mark-done"
                          onClick={() => void completeTask(t.$id)}
                        >
                          Mark done
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {/* C6 — audit events */}
        {events.length > 0 ? (
          <section className="card stack-sm manager-side-panel">
            <h2>Audit trail</h2>
            <ul className="list-plain event-list">
              {events.slice(0, 12).map((ev) => (
                <li key={ev.$id} className="event-row caption">
                  <span className="event-type">{formatEventType(ev.type)}</span>
                  <span>{formatWhen(ev.createdAt || ev.$createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {selected ? (
        <div className="manager-sticky" role="region" aria-label="Finding actions">
          <div className="manager-sticky-inner">
            <p className="manager-sticky-label caption">
              Selected: {itemLabel(selected.itemId)}
            </p>

            {mode === "override" ? (
              <div className="manager-sticky-form stack-sm">
                <label className="field">
                  <span>Set status</span>
                  <select
                    value={overrideTo}
                    onChange={(e) =>
                      setOverrideTo(e.target.value as FindingStatus)
                    }
                  >
                    <option value="pass">Pass</option>
                    <option value="gap">Gap</option>
                    <option value="unclear">Unclear</option>
                  </select>
                </label>
                <label className="field">
                  <span>Reason (required)</span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why are you overriding AI?"
                    autoFocus
                  />
                </label>
                <div className="manager-sticky-actions">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setMode("idle");
                      setReason("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    loading={saving}
                    onClick={() => void runOverride()}
                  >
                    Save override
                  </Button>
                </div>
              </div>
            ) : mode === "assign" ? (
              <div className="manager-sticky-form stack-sm">
                <p className="muted">
                  Assign fix:{" "}
                  <strong>Fix: {itemLabel(selected.itemId)}</strong>
                </p>
                <p className="caption" data-testid="assign-to-staff">
                  To {item ? resolveStaffLabel(item.shift.createdBy) : "staff"}{" "}
                  — they upload a re-check photo; AI re-scores; you mark done.
                </p>
                <div className="manager-sticky-actions">
                  <Button variant="secondary" onClick={() => setMode("idle")}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    loading={saving}
                    data-testid="create-task-btn"
                    onClick={() => void runAssign()}
                  >
                    Assign to staff
                  </Button>
                </div>
              </div>
            ) : (
              <div className="manager-sticky-actions">
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    setOverrideTo(
                      selected.status === "pass" ? "gap" : "pass",
                    );
                    setMode("override");
                  }}
                >
                  Override
                </Button>
                <Button
                  variant="primary"
                  disabled={saving}
                  onClick={() => setMode("assign")}
                >
                  Assign fix
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="manager-sticky manager-sticky-hint" aria-live="polite">
          <div className="manager-sticky-inner">
            <p className="caption">
              Select a finding to override or assign a fix.
            </p>
          </div>
        </div>
      )}

      {lightbox ? (
        <EvidenceLightbox
          items={lightbox.items}
          startIndex={lightbox.startIndex}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

function rank(f: Finding): number {
  if (f.status === "gap") return 0;
  if (f.status === "unclear") return 1;
  return 2;
}

/** Drop debug mode lines; strip leading "1. " so <ol> does not double-number. */
function stripStepNumber(step: string): string {
  if (/^Mode:\s*/i.test(step.trim())) return "";
  return step.replace(/^\s*\d+\.\s*/, "").trim();
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatEventType(type: string): string {
  switch (type) {
    case "finding.overridden":
      return "Override";
    case "task.created":
      return "Task created";
    case "task.recheck":
      return "Re-check photo";
    case "finding.rescored":
      return "Re-scored";
    case "task.done":
      return "Task done";
    case "shift.submitted":
      return "Submitted";
    case "job.done":
      return "Scored";
    case "job.failed":
      return "Score failed";
    default:
      return type;
  }
}
