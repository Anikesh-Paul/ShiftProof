/**
 * C4 + C5 — Manager inbox (API.md manager §1) + Realtime reload.
 * Today first; backlog for older gaps; close removes a shift from the inbox.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type ChangeEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { StatusChip } from "../../components/StatusChip";
import { useAuth } from "../../lib/auth";
import { getErrorMessage } from "../../lib/errors";
import {
  assignFixTask,
  DEMO_REPEAT_OFFENDERS,
  isSameLocalDay,
  isStuckScoring,
  itemLabel,
  listOpenTasks,
  loadManagerInbox,
  loadRepeatOffenders,
  mergeTasksById,
  subscribeManagerTables,
  sweepStaleJobs,
  type ManagerShiftSummary,
} from "../../lib/manager";
import { useSlowLoading } from "../../lib/loading";
import {
  getSite,
  getSop,
  isSopFileReady,
  uploadSopPdf,
} from "../../lib/shifts";
import { resolveStaffLabel } from "../../lib/staffNames";
import type { Sop, Task } from "../../types/shiftproof";
import "./ManagerHome.css";

type InboxView = "today" | "backlog" | "all";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function parseView(raw: string | null): InboxView {
  if (raw === "backlog" || raw === "all") return raw;
  return "today";
}

export function ManagerHome() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = parseView(params.get("view"));
  const itemFilter = params.get("item");

  const [items, setItems] = useState<ManagerShiftSummary[]>([]);
  const [source, setSource] = useState<"live" | "demo">("demo");
  const [siteName, setSiteName] = useState("Demo café");
  const [timeZone, setTimeZone] = useState("Asia/Kolkata");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveHint, setLiveHint] = useState<string | null>(null);
  const [repeatOffenders, setRepeatOffenders] = useState<
    { itemId: string; label: string; count: number; of: number }[]
  >([]);
  const [openTasks, setOpenTasks] = useState<Task[]>([]);
  const [fixesExpanded, setFixesExpanded] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignToast, setAssignToast] = useState<string | null>(null);

  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);
  const loadingSlow = useSlowLoading(loading);

  const sopInputRef = useRef<HTMLInputElement>(null);
  const [sop, setSop] = useState<Sop | null>(null);
  const [sopLoading, setSopLoading] = useState(true);
  const [sopUploading, setSopUploading] = useState(false);
  const [sopMessage, setSopMessage] = useState<string | null>(null);
  const [sopError, setSopError] = useState<string | null>(null);

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

  function onErrorExitEnd(e: AnimationEvent<HTMLDivElement>) {
    if (!errorExiting) return;
    if (e.animationName && e.animationName !== "toast-out") return;
    setErrorShown(null);
    setErrorExiting(false);
  }

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const [inbox, site, offenders, tasks] = await Promise.all([
        loadManagerInbox(),
        getSite().catch(() => null),
        loadRepeatOffenders(5).catch(() => DEMO_REPEAT_OFFENDERS),
        listOpenTasks().catch(() => [] as Task[]),
      ]);
      if (user && inbox.source === "live") {
        await sweepStaleJobs(inbox.items, user.$id);
      }
      setItems(inbox.items);
      setSource(inbox.source);
      if (site?.name) setSiteName(site.name);
      if (site?.timezone) setTimeZone(site.timezone);
      setRepeatOffenders(
        offenders.length
          ? offenders
          : inbox.source === "demo"
            ? DEMO_REPEAT_OFFENDERS
            : [],
      );
      setOpenTasks((prev) =>
        inbox.source === "demo" ? [] : mergeTasksById(prev, tasks),
      );
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load inbox"));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await getSop();
        if (!cancelled) {
          setSop(row);
          setSopError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSopError(getErrorMessage(err, "Could not load SOP meta"));
        }
      } finally {
        if (!cancelled) setSopLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSopFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSopUploading(true);
    setSopMessage(null);
    setSopError(null);
    try {
      const updated = await uploadSopPdf(file);
      setSop(updated);
      setSopMessage("SOP PDF saved.");
    } catch (err) {
      setSopError(getErrorMessage(err, "Could not upload SOP PDF"));
    } finally {
      setSopUploading(false);
    }
  }

  useEffect(() => {
    if (source === "demo") return;
    const unsub = subscribeManagerTables(() => {
      setLiveHint("Updating…");
      void reload({ silent: true }).finally(() => {
        setLiveHint(null);
      });
    });
    return unsub;
  }, [source, reload]);

  const waitingShifts = useMemo(
    () =>
      items.filter(
        (s) =>
          (s.shift.status === "submitted" || s.shift.status === "scoring") &&
          s.findings.length === 0,
      ),
    [items],
  );

  const todayItems = useMemo(
    () =>
      items.filter((s) =>
        isSameLocalDay(s.shift.submittedAt || s.shift.startedAt, timeZone),
      ),
    [items, timeZone],
  );

  const stuckItems = useMemo(
    () => items.filter((s) => isStuckScoring(s.shift, s.latestJob)),
    [items],
  );

  const todayGaps = todayItems.reduce((n, s) => n + s.gapCount, 0);
  const todayUnclear = todayItems.reduce((n, s) => n + s.unclearCount, 0);

  const defaultList = useMemo(() => {
    if (itemFilter) {
      return items.filter((s) =>
        s.findings.some(
          (f) =>
            f.itemId === itemFilter &&
            (f.status === "gap" || f.status === "unclear"),
        ),
      );
    }
    if (view === "all") return items;
    if (view === "backlog") {
      return items.filter((s) => {
        if (isSameLocalDay(s.shift.submittedAt || s.shift.startedAt, timeZone)) {
          return false;
        }
        if (isStuckScoring(s.shift, s.latestJob)) return false;
        return s.gapCount > 0 || s.unclearCount > 0;
      });
    }
    const todayIds = new Set(todayItems.map((s) => s.shift.$id));
    const stuckOnly = stuckItems.filter((s) => !todayIds.has(s.shift.$id));
    const todayNeeds = todayItems.filter(
      (s) =>
        s.gapCount > 0 ||
        s.unclearCount > 0 ||
        s.shift.status === "submitted" ||
        s.shift.status === "scoring",
    );
    return [...todayNeeds, ...stuckOnly];
  }, [itemFilter, view, items, timeZone, todayItems, stuckItems]);

  const sopReady = isSopFileReady(sop?.fileId);
  const waitingOnStaff = openTasks.filter((t) => !t.recheckFileId).length;
  const activeFilter = repeatOffenders.find((r) => r.itemId === itemFilter);

  const headline = loading
    ? "Checking shifts…"
    : itemFilter
      ? itemLabel(itemFilter)
      : todayGaps === 0
        ? todayUnclear > 0
          ? todayUnclear === 1
            ? "1 photo needs a look"
            : `${todayUnclear} photos need a look`
          : stuckItems.length > 0 || waitingShifts.length > 0
            ? "Checks in progress"
            : "Nothing needs you today"
        : todayGaps === 1
          ? "1 gap needs a look"
          : `${todayGaps} gaps need a look`;

  const lede = loading
    ? "Loading opening checks…"
    : itemFilter && activeFilter
      ? `Failed on ${activeFilter.count} of the last ${activeFilter.of} scored openings.`
      : todayGaps > 0
        ? "Today’s open gaps first. Older checks sit in Backlog."
        : todayUnclear > 0
          ? "Today’s unclear photos need a retake, not a fix task."
          : stuckItems.length > 0
            ? "Older scoring jobs are still running — retry or close them."
            : "When staff leave open gaps today, they land here first.";

  function setView(next: InboxView) {
    const nextParams = new URLSearchParams();
    if (next !== "today") nextParams.set("view", next);
    setParams(nextParams);
  }

  function setItemFilter(itemId: string | null) {
    const nextParams = new URLSearchParams();
    if (itemId) nextParams.set("item", itemId);
    setParams(nextParams);
  }

  async function assignTodayGaps() {
    if (!user || assigning) return;
    setAssigning(true);
    setAssignToast(null);
    setError(null);
    const openFindingIds = new Set(openTasks.map((t) => t.findingId));
    const pending: {
      shiftId: string;
      findingId: string;
      title: string;
      assignedTo: string;
      local: boolean;
    }[] = [];
    let staffLabel = "";
    for (const row of todayItems.filter((s) => s.shift.status === "scored")) {
      for (const finding of row.findings) {
        if (finding.status !== "gap") continue;
        if (openFindingIds.has(finding.$id)) continue;
        openFindingIds.add(finding.$id);
        pending.push({
          shiftId: row.shift.$id,
          findingId: finding.$id,
          title: `Fix: ${itemLabel(finding.itemId)}`,
          assignedTo: row.shift.createdBy,
          local: source === "demo" || row.shift.$id.startsWith("demo_shift_"),
        });
        staffLabel = row.staffLabel;
      }
    }
    const created: Task[] = [];
    try {
      const settled = await Promise.allSettled(
        pending.map(async (job) => {
          if (job.local) {
            const now = new Date().toISOString();
            const localTask: Task = {
              $id: `local_task_${job.findingId}`,
              $createdAt: now,
              $updatedAt: now,
              shiftId: job.shiftId,
              findingId: job.findingId,
              title: job.title,
              status: "open",
              assignedTo: job.assignedTo,
              createdBy: user.$id,
              createdAt: now,
            };
            return localTask;
          }
          return assignFixTask({
            shiftId: job.shiftId,
            findingId: job.findingId,
            title: job.title,
            userId: user.$id,
            assignedTo: job.assignedTo,
          });
        }),
      );
      let firstError: unknown = null;
      for (const result of settled) {
        if (result.status === "fulfilled") created.push(result.value);
        else if (!firstError) firstError = result.reason;
      }
      if (created.length) {
        setOpenTasks((prev) => mergeTasksById(created, prev));
      }
      if (firstError && created.length === 0) throw firstError;
      setAssignToast(
        `Assigned ${created.length} fixes to ${staffLabel || "staff"}.`,
      );
      if (source !== "demo") {
        void reload({ silent: true });
      }
      if (firstError) {
        setError(getErrorMessage(firstError, "Could not assign today’s gaps"));
      }
    } catch (err) {
      if (created.length) {
        setOpenTasks((prev) => mergeTasksById(created, prev));
      }
      setError(getErrorMessage(err, "Could not assign today’s gaps"));
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="app-page stack manager-home">
      <header className="manager-home-header">
        <div className="manager-home-kicker">
          <p className="manager-site">{siteName}</p>
          {liveHint ? (
            <span className="manager-live-pill" role="status">
              {liveHint}
            </span>
          ) : source === "demo" && !loading ? (
            <span className="manager-live-pill is-sample" role="status">
              Sample
            </span>
          ) : null}
        </div>
        <h1>{headline}</h1>
        <p className="muted manager-lede">{lede}</p>
      </header>

      {source === "demo" && !loading ? (
        <div className="manager-sample-banner" role="status">
          Sample inbox — not today’s café. Live shifts appear here when staff
          submit proof.
        </div>
      ) : null}

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

      {!loading && openTasks.length > 0 ? (
        <section
          className="manager-inbox"
          aria-label="Open fixes"
          data-testid="open-fixes"
        >
          <button
            type="button"
            className="manager-fixes-summary"
            aria-expanded={fixesExpanded}
            onClick={() => setFixesExpanded((v) => !v)}
          >
            {openTasks.length === 1
              ? "1 open fix"
              : `${openTasks.length} open fixes`}
            {" · "}
            {waitingOnStaff === 1
              ? "1 waiting on staff"
              : `${waitingOnStaff} waiting on staff`}
          </button>
          {fixesExpanded ? (
            <ul className="list-plain manager-list">
              {openTasks.map((task) => {
                const shiftRow = items.find((s) => s.shift.$id === task.shiftId);
                const finding = shiftRow?.findings.find(
                  (f) => f.$id === task.findingId,
                );
                const title = openFixTitle(task, finding);
                const waitingRecheck = Boolean(task.recheckFileId);
                return (
                  <li key={task.$id} data-finding-id={task.findingId}>
                    <Link
                      to={`/manager/shifts/${task.shiftId}`}
                      className="manager-row"
                    >
                      <div className="manager-row-main">
                        <p className="manager-row-staff">{title}</p>
                        <div className="manager-row-meta">
                          <span className="caption">
                            {resolveStaffLabel(
                              task.assignedTo ||
                                shiftRow?.shift.createdBy ||
                                "",
                            )}
                          </span>
                          <span
                            className={`manager-pill${waitingRecheck ? " is-pass" : " is-unclear"}`}
                          >
                            {waitingRecheck
                              ? "Re-check on file"
                              : "Waiting on staff"}
                          </span>
                        </div>
                      </div>
                      <span className="manager-row-go" aria-hidden>
                        Review
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="manager-inbox" aria-label="Inbox">
        <div className="manager-view-tabs" role="tablist" aria-label="Inbox">
          {itemFilter ? (
            <button
              type="button"
              className="text-btn manager-filter-btn"
              onClick={() => setItemFilter(null)}
            >
              Clear
            </button>
          ) : (
            (["today", "backlog", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                className={`text-btn manager-filter-btn${view === key ? " is-active" : ""}`}
                aria-selected={view === key}
                onClick={() => setView(key)}
              >
                {key === "today"
                  ? "Today"
                  : key === "backlog"
                    ? "Backlog"
                    : "All"}
              </button>
            ))
          )}
        </div>

        {view === "today" && !itemFilter && todayGaps > 0 && !loading ? (
          <div className="manager-today-actions">
            <Button
              variant="quiet"
              loading={assigning}
              data-testid="assign-today-gaps"
              onClick={() => void assignTodayGaps()}
            >
              Assign today’s gaps
            </Button>
            {assignToast ? (
              <p className="manager-sop-toast" role="status">
                {assignToast}
              </p>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="stack-sm">
            <ul
              className="list-plain manager-list"
              aria-busy="true"
              aria-label="Loading"
            >
              {[0, 1, 2].map((i) => (
                <li key={i} className="manager-row skeleton-card" />
              ))}
            </ul>
            {loadingSlow ? (
              <p className="loading-slow-hint" role="status">
                Still loading inbox…
              </p>
            ) : null}
          </div>
        ) : defaultList.length === 0 ? (
          <div className="manager-empty staff-settle-in">
            <h3>
              {items.length === 0
                ? "No opening checks yet"
                : itemFilter
                  ? "No matching shifts"
                  : view === "backlog"
                    ? "Backlog is empty"
                    : "All clear today"}
            </h3>
            <p className="muted">
              {items.length === 0
                ? "When staff submit an opening check, shifts appear here."
                : itemFilter
                  ? "No open gaps for this checklist item in the inbox."
                  : view === "today"
                    ? "No open gaps today. Backlog holds older checks."
                    : "Show all shifts to review clean scores."}
            </p>
            {items.length > 0 && view !== "all" && !itemFilter ? (
              <button
                type="button"
                className="text-btn is-accent"
                onClick={() => setView("all")}
              >
                Show all shifts
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="list-plain manager-list stagger-in">
            {defaultList.map((row) => (
              <li key={row.shift.$id}>
                <Link
                  to={`/manager/shifts/${row.shift.$id}`}
                  className="manager-row"
                >
                  <div className="manager-row-main">
                    <div className="manager-row-top">
                      <StatusChip
                        status={row.shift.status}
                        jobFailed={row.latestJob?.status === "failed"}
                      />
                      <time className="caption manager-row-when">
                        {formatWhen(
                          row.shift.submittedAt || row.shift.startedAt,
                        )}
                      </time>
                    </div>
                    <p className="manager-row-staff">{row.staffLabel}</p>
                    <div className="manager-row-meta">
                      {row.latestJob?.status === "failed" ? (
                        <span className="manager-meta-wait">Score failed</span>
                      ) : isStuckScoring(row.shift, row.latestJob) ? (
                        <span className="manager-meta-wait">
                          Scoring stuck — retry from the scoreboard
                        </span>
                      ) : row.shift.status === "scoring" ||
                        row.shift.status === "submitted" ? (
                        <span className="manager-meta-wait">
                          {row.findings.length
                            ? `${row.gapCount} gap · ${row.unclearCount} unclear`
                            : "Waiting on score…"}
                        </span>
                      ) : (
                        <>
                          <span
                            className={`manager-pill${row.gapCount > 0 ? " is-gap" : ""}`}
                          >
                            {row.gapCount} Gap
                          </span>
                          <span
                            className={`manager-pill${row.unclearCount > 0 ? " is-unclear" : ""}`}
                          >
                            {row.unclearCount} Unclear
                          </span>
                          {row.passCount > 0 ? (
                            <span className="manager-pill is-pass">
                              {row.passCount} Pass
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                  <span className="manager-row-go" aria-hidden>
                    Review
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!loading && repeatOffenders.length > 0 ? (
        <section
          className="manager-side-block"
          data-testid="repeat-offender"
          aria-labelledby="repeat-heading"
        >
          <h2 id="repeat-heading">Repeat gaps</h2>
          <p className="caption muted">
            Failed on this many of the last {repeatOffenders[0]?.of ?? 5}{" "}
            scored openings
          </p>
          <ul className="list-plain repeat-list">
            {repeatOffenders.map((r) => (
              <li key={r.itemId}>
                <button
                  type="button"
                  className={`repeat-row repeat-row-btn${itemFilter === r.itemId ? " is-active" : ""}`}
                  onClick={() =>
                    setItemFilter(itemFilter === r.itemId ? null : r.itemId)
                  }
                >
                  <span className="repeat-label">{r.label}</span>
                  <span className="repeat-count">
                    {r.count}/{r.of}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!sopLoading && !sopReady ? (
        <div className="manager-sop-missing" data-testid="sop-upload">
          <span>Missing</span>
          <input
            ref={sopInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="manager-sop-file"
            onChange={(e) => void onSopFileChange(e)}
            disabled={sopUploading}
          />
          <button
            type="button"
            className="text-btn"
            disabled={sopUploading}
            onClick={() => sopInputRef.current?.click()}
          >
            Upload
          </button>
          {sopMessage ? (
            <p className="manager-sop-toast" role="status">
              {sopMessage}
            </p>
          ) : null}
          {sopError ? (
            <div className="error-banner" role="alert">
              {sopError}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
