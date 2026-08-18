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
import { EvidenceImg } from "../../components/EvidenceImg";
import { useAuth } from "../../lib/auth";
import { getErrorMessage } from "../../lib/errors";
import {
  assignFixTask,
  DEMO_REPEAT_OFFENDERS,
  isSameLocalDay,
  formatManagerWhen,
  formatManagerWhenRange,
  isHarnessName,
  isStuckScoring,
  itemLabel,
  listOpenTasks,
  loadManagerInbox,
  loadRepeatOffenders,
  mergeTasksById,
  shortItemLabel,
  subscribeManagerTables,
  sweepStaleJobs,
  type ManagerShiftSummary,
} from "../../lib/manager";
import { useSlowLoading } from "../../lib/loading";
import {
  extractSopLiveSet,
  getChecklist,
  getSite,
  getSop,
  isSopFileReady,
  parseChecklistItems,
  parsePhotoFileIds,
  photoForItem,
  retryShiftScore,
  uploadSopPdf,
} from "../../lib/shifts";
import { displayStaffName, resolveStaffLabel } from "../../lib/staffNames";
import type { ChecklistItem, Sop, Task } from "../../types/shiftproof";
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
  const [siteName, setSiteName] = useState("");
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
  const [retryingJobs, setRetryingJobs] = useState(false);
  const [jobsToast, setJobsToast] = useState<string | null>(null);

  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);
  const loadingSlow = useSlowLoading(loading);

  const sopInputRef = useRef<HTMLInputElement>(null);
  const [sop, setSop] = useState<Sop | null>(null);
  const [liveItems, setLiveItems] = useState<ChecklistItem[]>([]);
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
        const [row, checklist] = await Promise.all([
          getSop(),
          getChecklist().catch(() => null),
        ]);
        if (!cancelled) {
          setSop(row);
          if (checklist) setLiveItems(parseChecklistItems(checklist));
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
      await extractSopLiveSet();
      const [sopRow, checklist] = await Promise.all([
        getSop(),
        getChecklist(),
      ]);
      setSop(sopRow);
      setLiveItems(parseChecklistItems(checklist));
      setSopMessage(null);
    } catch (err) {
      setSopError(
        getErrorMessage(
          err,
          "The new file was not read. The previous opening check is still in force.",
        ),
      );
      try {
        const checklist = await getChecklist();
        setLiveItems(parseChecklistItems(checklist));
      } catch {
        /* keep last known live set */
      }
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

  const failedItems = useMemo(
    () => items.filter((s) => s.latestJob?.status === "failed"),
    [items],
  );

  const jobTargets = useMemo(() => {
    const seen = new Set<string>();
    const out: ManagerShiftSummary[] = [];
    for (const row of [...stuckItems, ...failedItems]) {
      if (seen.has(row.shift.$id)) continue;
      seen.add(row.shift.$id);
      out.push(row);
    }
    return out;
  }, [stuckItems, failedItems]);

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
    const todayNeeds = todayItems.filter((s) => {
      if (isStuckScoring(s.shift, s.latestJob)) return false;
      if (
        s.latestJob?.status === "failed" &&
        s.gapCount === 0 &&
        s.unclearCount === 0
      ) {
        return false;
      }
      return (
        s.gapCount > 0 ||
        s.unclearCount > 0 ||
        s.shift.status === "submitted" ||
        s.shift.status === "scoring"
      );
    });
    return sortTodayInbox(todayNeeds);
  }, [itemFilter, view, items, timeZone, todayItems]);

  const listed = useMemo(
    () => (view === "all" ? asInboxClusters(defaultList) : clusterInboxRows(defaultList)),
    [defaultList, view],
  );

  const sopReady = isSopFileReady(sop?.fileId);
  const waitingOnStaff = openTasks.filter((t) => !t.recheckFileId).length;
  const glanceChips = useMemo(
    () =>
      repeatOffenders
        .filter(
          (r) =>
            !isHarnessName(r.itemId) &&
            !isHarnessName(r.label) &&
            shortItemLabel(r.itemId),
        )
        .slice(0, 4),
    [repeatOffenders],
  );
  const activeFilter = glanceChips.find((r) => r.itemId === itemFilter);

  const headline = loading
    ? "Checking shifts…"
    : itemFilter
      ? shortItemLabel(itemFilter) || itemLabel(itemFilter)
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
          : jobTargets.length > 0
            ? "Retry stuck jobs here, or close them from the scoreboard."
            : "When staff leave open gaps today, they land here first.";

  function setView(next: InboxView) {
    const nextParams = new URLSearchParams(params);
    if (next === "today") nextParams.delete("view");
    else nextParams.set("view", next);
    nextParams.delete("item");
    setParams(nextParams);
  }

  function setItemFilter(itemId: string | null) {
    const nextParams = new URLSearchParams(params);
    if (itemId) nextParams.set("item", itemId);
    else nextParams.delete("item");
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
          title: `Fix: ${shortItemLabel(finding.itemId) || itemLabel(finding.itemId)}`,
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

  async function retryStuckJobs() {
    if (!user || retryingJobs || jobTargets.length === 0) return;
    setRetryingJobs(true);
    setJobsToast(null);
    setError(null);
    const live = jobTargets.filter(
      (row) => source !== "demo" && !row.shift.$id.startsWith("demo_shift_"),
    );
    if (live.length === 0) {
      setJobsToast("Retry is sample-only on these shifts.");
      setRetryingJobs(false);
      return;
    }
    try {
      const settled = await Promise.allSettled(
        live.map((row) => retryShiftScore(row.shift.$id, user.$id)),
      );
      const ok = settled.filter((r) => r.status === "fulfilled").length;
      const firstErr = settled.find((r) => r.status === "rejected");
      if (ok > 0) {
        setJobsToast(
          ok === 1 ? "Retrying 1 opening." : `Retrying ${ok} openings.`,
        );
        void reload({ silent: true });
      }
      if (firstErr && firstErr.status === "rejected" && ok === 0) {
        setError(getErrorMessage(firstErr.reason, "Could not retry scoring"));
      }
    } catch (err) {
      setError(getErrorMessage(err, "Could not retry scoring"));
    } finally {
      setRetryingJobs(false);
    }
  }

  const stuckCount = stuckItems.length;
  const failedCount = failedItems.filter(
    (s) => !stuckItems.some((stuck) => stuck.shift.$id === s.shift.$id),
  ).length;
  const jobsLine =
    stuckCount > 0 && failedCount > 0
      ? `${stuckCount} stuck · ${failedCount} failed`
      : stuckCount > 0
        ? stuckCount === 1
          ? "1 opening is stuck"
          : `${stuckCount} openings are stuck`
        : failedCount === 1
          ? "1 score failed"
          : `${failedCount} scores failed`;

  return (
    <div className="app-page stack manager-home">
      <header className="manager-home-header">
        <div className="manager-home-kicker">
          {siteName ? <p className="manager-site">{siteName}</p> : null}
          {liveHint ? (
            <span className="manager-live-pill" role="status">
              {liveHint}
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
                            {displayStaffName(
                              resolveStaffLabel(
                                task.assignedTo ||
                                  shiftRow?.shift.createdBy ||
                                  "",
                              ),
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
          {(["today", "backlog", "all"] as const).map((key) => (
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
          ))}
        </div>

        {!loading && glanceChips.length > 0 ? (
          <div
            className="manager-repeat-chips"
            data-testid="repeat-offender"
            role="group"
            aria-label="Repeat gaps"
          >
            {glanceChips.map((r) => (
              <button
                key={r.itemId}
                type="button"
                className={`manager-repeat-chip${itemFilter === r.itemId ? " is-active" : ""}`}
                aria-pressed={itemFilter === r.itemId}
                onClick={() =>
                  setItemFilter(itemFilter === r.itemId ? null : r.itemId)
                }
              >
                {shortItemLabel(r.itemId)} {r.count}/{r.of}
              </button>
            ))}
          </div>
        ) : null}

        {view === "today" && !itemFilter && todayGaps > 0 && !loading ? (
          <div className="manager-today-actions">
            <Button
              variant="primary"
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

        {view === "today" && !itemFilter && !loading && jobTargets.length > 0 ? (
          <div
            className="manager-jobs-banner"
            role="status"
            data-testid="inbox-jobs"
          >
            <p className="manager-jobs-copy">{jobsLine}</p>
            <div className="manager-jobs-actions">
              <Button
                variant="quiet"
                loading={retryingJobs}
                data-testid="retry-stuck-jobs"
                onClick={() => void retryStuckJobs()}
              >
                Retry all
              </Button>
              {jobsToast ? (
                <p className="manager-sop-toast" role="status">
                  {jobsToast}
                </p>
              ) : null}
            </div>
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
          view === "today" && !itemFilter && jobTargets.length > 0 ? null : (
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
          )
        ) : (
          <ul className="list-plain manager-list">
            {listed.map((cluster) => {
              const row = cluster.row;
              const itemsPreview = openItemsPreview(row.findings);
              const kind = inboxRowKind(row, view);
              const thumbId = inboxRowPhoto(row, liveItems);
              const when =
                cluster.count > 1
                  ? formatManagerWhenRange(cluster.from, cluster.to)
                  : formatManagerWhen(cluster.from);
              const gapCount = row.gapCount * cluster.count;
              const unclearCount = row.unclearCount * cluster.count;
              return (
                <li
                  key={row.shift.$id}
                  data-cluster-count={cluster.count > 1 ? cluster.count : undefined}
                >
                  <Link
                    to={`/manager/shifts/${row.shift.$id}`}
                    className={`manager-row is-${kind}`}
                  >
                    <div className="manager-row-main">
                      <div className="manager-row-top">
                        <p className="manager-row-staff">
                          {displayStaffName(row.staffLabel)}
                        </p>
                        {when ? (
                          <time className="caption manager-row-when" dateTime={cluster.from}>
                            {when}
                          </time>
                        ) : null}
                      </div>
                      {itemsPreview ? (
                        <p className="manager-row-items">{itemsPreview}</p>
                      ) : null}
                      <div className="manager-row-meta">
                        {row.latestJob?.status === "failed" ? (
                          <span className="manager-meta-wait">
                            Score failed
                          </span>
                        ) : isStuckScoring(row.shift, row.latestJob) ? (
                          <span className="manager-meta-wait">
                            Stuck — open to retry
                          </span>
                        ) : row.shift.status === "scoring" ||
                          row.shift.status === "submitted" ? (
                          <span className="manager-meta-wait">
                            {scoringWaitLabel(row)}
                          </span>
                        ) : (
                          <>
                            {cluster.count > 1 ? (
                              <span className="manager-meta-wait">
                                {cluster.count} openings
                              </span>
                            ) : null}
                            {gapCount > 0 ? (
                              <span className="manager-pill is-gap">
                                {gapCount} Gap
                              </span>
                            ) : null}
                            {unclearCount > 0 ? (
                              <span className="manager-pill is-unclear">
                                {unclearCount} Unclear
                              </span>
                            ) : null}
                            {view === "all" && row.passCount > 0 ? (
                              <span className="manager-pill is-pass">
                                {row.passCount} Pass
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                    {thumbId ? (
                      <span className="manager-row-thumb" aria-hidden>
                        <EvidenceImg
                          fileId={thumbId}
                          alt=""
                          className="manager-row-thumb-img"
                          compact
                        />
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!sopLoading ? (
        <div
          className={sopReady ? "manager-sop-panel" : "manager-sop-missing"}
          data-testid="sop-upload"
        >
          <input
            ref={sopInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="manager-sop-file"
            onChange={(e) => void onSopFileChange(e)}
            disabled={sopUploading}
          />
          {!sopReady ? (
            <>
              <span>Missing</span>
              <button
                type="button"
                className="text-btn"
                disabled={sopUploading}
                onClick={() => sopInputRef.current?.click()}
              >
                Upload
              </button>
            </>
          ) : (
            <>
              <details className="manager-sop-details">
                <summary>
                  {liveItems.length > 0
                    ? `Opening check · ${liveItems.length} items`
                    : "Opening check"}
                </summary>
                {liveItems.length > 0 ? (
                  <ol
                    className="manager-sop-clauses"
                    data-testid="live-clause-set"
                  >
                    {liveItems.map((item) => (
                      <li key={item.id}>{item.label}</li>
                    ))}
                  </ol>
                ) : null}
              </details>
              <button
                type="button"
                className="text-btn"
                disabled={sopUploading}
                onClick={() => sopInputRef.current?.click()}
              >
                Replace
              </button>
            </>
          )}
          {sopUploading ? (
            <p className="manager-sop-toast" role="status">
              Reading the SOP…
            </p>
          ) : sopMessage ? (
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

function openFixTitle(task: Task, finding?: { itemId: string }): string {
  const kind = /^retake:/i.test(task.title) ? "Retake" : "Fix";
  if (finding) {
    const label =
      shortItemLabel(finding.itemId) || itemLabel(finding.itemId);
    if (!isHarnessName(finding.itemId) && !isHarnessName(label)) {
      return `${kind}: ${label}`;
    }
    return kind;
  }
  if (isHarnessName(task.title)) return kind;
  return task.title;
}

function todayInboxRank(row: ManagerShiftSummary): number {
  if (row.gapCount > 0) return 0;
  if (row.unclearCount > 0) return 1;
  if (row.latestJob?.status === "failed") return 3;
  if (
    isStuckScoring(row.shift, row.latestJob) ||
    row.shift.status === "submitted" ||
    row.shift.status === "scoring"
  ) {
    return 2;
  }
  return 4;
}

function sortTodayInbox(
  rows: ManagerShiftSummary[],
): ManagerShiftSummary[] {
  return [...rows].sort((a, b) => todayInboxRank(a) - todayInboxRank(b));
}

type InboxCluster = {
  row: ManagerShiftSummary;
  count: number;
  from: string;
  to: string;
};

function clusterSubmittedAt(row: ManagerShiftSummary): string {
  return row.shift.submittedAt || row.shift.startedAt || "";
}

function inboxClusterKey(row: ManagerShiftSummary): string {
  const staff = row.shift.createdBy || displayStaffName(row.staffLabel);
  const kind =
    row.gapCount > 0
      ? "gap"
      : row.unclearCount > 0
        ? "unclear"
        : inboxRowKind(row, "today");
  const open = row.findings
    .filter((f) => f.status === "gap" || f.status === "unclear")
    .map((f) => `${f.itemId}:${f.status}`)
    .sort()
    .join(",");
  return `${staff}|${kind}|${open}`;
}

function stamp(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function pickClusterRepresentative(
  members: ManagerShiftSummary[],
): ManagerShiftSummary {
  const first = members[0];
  if (!first) {
    throw new Error("inbox cluster is empty");
  }
  let best = first;
  for (const row of members) {
    const rank = todayInboxRank(row) - todayInboxRank(best);
    if (rank < 0) {
      best = row;
      continue;
    }
    if (
      rank === 0 &&
      stamp(clusterSubmittedAt(row)) > stamp(clusterSubmittedAt(best))
    ) {
      best = row;
    }
  }
  return best;
}

function asInboxClusters(rows: ManagerShiftSummary[]): InboxCluster[] {
  return rows.map((row) => {
    const when = clusterSubmittedAt(row);
    return { row, count: 1, from: when, to: when };
  });
}

function clusterInboxRows(rows: ManagerShiftSummary[]): InboxCluster[] {
  const groups = new Map<string, ManagerShiftSummary[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = inboxClusterKey(row);
    const list = groups.get(key);
    if (list) {
      list.push(row);
    } else {
      groups.set(key, [row]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const members = groups.get(key) ?? [];
    const row = pickClusterRepresentative(members);
    const times = members.map(clusterSubmittedAt).filter(Boolean).sort();
    return {
      row,
      count: members.length,
      from: times[0] || clusterSubmittedAt(row),
      to: times[times.length - 1] || clusterSubmittedAt(row),
    };
  });
}

function inboxRowKind(
  row: ManagerShiftSummary,
  view: InboxView,
): "gap" | "unclear" | "stuck" | "failed" | "pass" | "wait" {
  if (row.latestJob?.status === "failed") return "failed";
  if (isStuckScoring(row.shift, row.latestJob)) return "stuck";
  if (row.gapCount > 0) return "gap";
  if (row.unclearCount > 0) return "unclear";
  if (row.shift.status === "submitted" || row.shift.status === "scoring") {
    return "wait";
  }
  if (view === "all" && row.passCount > 0) return "pass";
  return "wait";
}

function inboxRowPhoto(
  row: ManagerShiftSummary,
  items: ChecklistItem[],
): string | null {
  const open = row.findings.filter(
    (f) => f.status === "gap" || f.status === "unclear",
  );
  for (const finding of open) {
    const id = photoForItem(finding.itemId, row.shift.photoFileIds, items);
    if (id) return id;
  }
  return parsePhotoFileIds(row.shift.photoFileIds)[0] || null;
}

function scoringWaitLabel(row: ManagerShiftSummary): string {
  const parts: string[] = [];
  if (row.gapCount > 0) parts.push(`${row.gapCount} gap`);
  if (row.unclearCount > 0) parts.push(`${row.unclearCount} unclear`);
  return parts.join(" · ") || "Waiting on score…";
}

function openItemsPreview(
  findings: { itemId: string; status: string }[],
): string | null {
  const open = findings.filter(
    (f) => f.status === "gap" || f.status === "unclear",
  );
  if (open.length === 0) return null;
  const labels = open
    .map((f) => shortItemLabel(f.itemId))
    .filter(Boolean);
  if (labels.length === 0) return null;
  const shown = labels.slice(0, 2);
  const extra = labels.length - 2;
  return extra > 0 ? `${shown.join(" · ")} +${extra}` : shown.join(" · ");
}

