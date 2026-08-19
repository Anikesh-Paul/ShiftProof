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
  inboxCopy,
  isKnownItemId,
  itemLabel,
  listOpenTasks,
  loadManagerInbox,
  loadRepeatOffenders,
  mergeTasksById,
  openFixTitle,
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
import {
  asInboxClusters,
  clusterInboxRows,
  inboxRowsForView,
  sortBacklogClusters,
} from "../../lib/inboxCluster";
import {
  groupOpenFixesByItem,
  type OpenFixItemGroup,
} from "../../lib/openFixGroups";
import { displayStaffName, resolveStaffLabel } from "../../lib/staffNames";
import type { ChecklistItem, Sop, Task } from "../../types/shiftproof";
import "./ManagerHome.css";

type InboxView = "today" | "backlog" | "all";

const OPEN_FIX_CAP = 4;

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
  const [listTruncated, setListTruncated] = useState(false);
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
  const [fixesShowAll, setFixesShowAll] = useState(false);
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
      setListTruncated(inbox.source === "live" && inbox.truncated);
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

  const defaultList = useMemo(
    () => inboxRowsForView(items, view, timeZone, itemFilter),
    [itemFilter, view, items, timeZone],
  );

  const listed = useMemo(() => {
    if (view === "all") return asInboxClusters(defaultList);
    const clusters = clusterInboxRows(defaultList);
    return view === "backlog" ? sortBacklogClusters(clusters) : clusters;
  }, [defaultList, view]);

  const sopReady = isSopFileReady(sop?.fileId);
  const waitingTasks = openTasks.filter((t) => !t.recheckFileId);
  const recheckTasks = openTasks.filter((t) => Boolean(t.recheckFileId));
  const waitingOnStaff = waitingTasks.length;
  const openFixOverflow =
    waitingTasks.length > OPEN_FIX_CAP || recheckTasks.length > OPEN_FIX_CAP;
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
  const itemKnown = !itemFilter || isKnownItemId(itemFilter);
  const backlogGaps = defaultList.reduce((n, s) => n + s.gapCount, 0);
  const backlogUnclear = defaultList.reduce((n, s) => n + s.unclearCount, 0);

  const { headline, lede } = inboxCopy({
    loading,
    itemFilter,
    itemKnown,
    view,
    listedCount: listed.length,
    listTruncated,
    todayGaps,
    todayUnclear,
    checksInProgress: stuckItems.length > 0 || waitingShifts.length > 0,
    jobsWaiting: jobTargets.length > 0,
    backlogEmpty: defaultList.length === 0,
    backlogGaps,
    backlogUnclear,
  });

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
  const emptyTodayDesk = view === "today" && todayGaps === 0 && !itemFilter;
  const jobsUnderLede =
    emptyTodayDesk && !loading && jobTargets.length > 0;
  const hideTodayGlance = view === "today" && todayGaps === 0;
  const hideTodayFixes = view === "today" && todayGaps === 0;
  const jobsBanner = (
    <JobsBanner
      jobsLine={jobsLine}
      retrying={retryingJobs}
      toast={jobsToast}
      onShowAll={() => setView("all")}
      onRetry={() => void retryStuckJobs()}
    />
  );

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
        <p className="muted manager-lede" data-testid="inbox-lede">
          {lede}
        </p>
        {jobsUnderLede ? jobsBanner : null}
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

      {(!sopLoading ||
        (!loading && openTasks.length > 0 && !hideTodayFixes)) ? (
        <div className="manager-desk-lines">
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
                tabIndex={-1}
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

          {!loading && openTasks.length > 0 && !hideTodayFixes ? (
            <section
              className="manager-inbox manager-fixes"
              aria-label="Open fixes"
              data-testid="open-fixes"
            >
              <button
                type="button"
                className="manager-fixes-summary"
                aria-expanded={fixesExpanded}
                onClick={() => {
                  setFixesExpanded((v) => {
                    if (v) setFixesShowAll(false);
                    return !v;
                  });
                }}
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
                <div
                  className={`manager-fixes-expanded${fixesShowAll ? " is-show-all" : ""}`}
                >
                  <OpenFixBucket
                    label="Waiting on staff"
                    tasks={waitingTasks}
                    items={items}
                    showAll={fixesShowAll}
                  />
                  <OpenFixBucket
                    label="Re-check on file"
                    tasks={recheckTasks}
                    items={items}
                    showAll={fixesShowAll}
                  />
                  {openFixOverflow ? (
                    <button
                      type="button"
                      className="text-btn"
                      aria-pressed={fixesShowAll}
                      onClick={() => setFixesShowAll((v) => !v)}
                    >
                      {fixesShowAll ? "Show less" : "Show all"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
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

        {!loading &&
        !hideTodayGlance &&
        (glanceChips.length > 0 || (itemFilter && !itemKnown)) ? (
          <div
            className="manager-repeat-chips"
            data-testid="repeat-offender"
            role="group"
            aria-label="Repeat gaps"
          >
            {itemFilter && !itemKnown ? (
              <button
                type="button"
                className="manager-repeat-chip is-active"
                aria-pressed="true"
                onClick={() => setItemFilter(null)}
              >
                No matching item
              </button>
            ) : null}
            {glanceChips.map((r) => (
              <button
                key={r.itemId}
                type="button"
                className={`manager-repeat-chip${itemFilter === r.itemId ? " is-active" : ""}`}
                aria-pressed={itemFilter === r.itemId}
                aria-label={`${shortItemLabel(r.itemId)}: gap in ${r.count} of last ${r.of} shifts`}
                title={`Gap in ${r.count} of last ${r.of} shifts`}
                onClick={() =>
                  setItemFilter(itemFilter === r.itemId ? null : r.itemId)
                }
              >
                <span className="manager-repeat-chip-label">
                  {shortItemLabel(r.itemId)}
                </span>{" "}
                <span className="manager-repeat-chip-rate" aria-hidden="true">
                  {r.count}/{r.of}
                </span>
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

        {!jobsUnderLede &&
        view === "today" &&
        !itemFilter &&
        !loading &&
        jobTargets.length > 0
          ? jobsBanner
          : null}

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
                  ? itemKnown
                    ? "No open gaps for this checklist item in the inbox."
                    : "Clear the filter to see today’s openings."
                  : view === "today"
                    ? "No open gaps today. Backlog holds older checks."
                    : view === "backlog"
                      ? "Nothing waiting from earlier days."
                      : "Show all shifts to review clean scores."}
            </p>
            {items.length > 0 && itemFilter ? (
              <button
                type="button"
                className="text-btn is-accent"
                onClick={() => setItemFilter(null)}
              >
                Clear filter
              </button>
            ) : items.length > 0 && view !== "all" ? (
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
              const hasPhoto =
                parsePhotoFileIds(row.shift.photoFileIds).length > 0;
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
                        {!hasPhoto ? (
                          <span className="manager-meta-wait">No photo</span>
                        ) : null}
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
    </div>
  );
}

function JobsBanner({
  jobsLine,
  retrying,
  toast,
  onShowAll,
  onRetry,
}: {
  jobsLine: string;
  retrying: boolean;
  toast: string | null;
  onShowAll: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      className="manager-jobs-banner"
      role="status"
      data-testid="inbox-jobs"
    >
      <button
        type="button"
        className="text-btn manager-jobs-copy"
        aria-label={`${jobsLine}. Show on All.`}
        onClick={onShowAll}
      >
        {jobsLine}
      </button>
      <div className="manager-jobs-actions">
        <button
          type="button"
          className="text-btn manager-jobs-retry"
          data-testid="retry-stuck-jobs"
          disabled={retrying}
          aria-busy={retrying || undefined}
          onClick={onRetry}
        >
          {retrying ? "Retrying…" : "Retry all"}
        </button>
        {toast ? (
          <p className="manager-sop-toast" role="status">
            {toast}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function OpenFixBucket({
  label,
  tasks,
  items,
  showAll,
}: {
  label: string;
  tasks: Task[];
  items: ManagerShiftSummary[];
  showAll: boolean;
}) {
  if (tasks.length === 0) return null;
  const groups = showAll ? groupOpenFixesByItem(tasks, items) : [];
  return (
    <div className="manager-fix-group">
      <p className="manager-fix-group-label">
        {label} ({tasks.length})
      </p>
      <ul className="list-plain manager-list">
        {showAll
          ? groups.map((group) => (
              <OpenFixItemRow
                key={group.label.toLowerCase()}
                group={group}
              />
            ))
          : tasks.slice(0, OPEN_FIX_CAP).map((task) => (
              <OpenFixRow key={task.$id} task={task} items={items} />
            ))}
      </ul>
    </div>
  );
}

function OpenFixItemRow({ group }: { group: OpenFixItemGroup }) {
  const lead = group.tasks[0];
  if (!lead) return null;
  return (
    <li data-item-id={group.itemId} data-group-count={group.count}>
      <Link to={`/manager/shifts/${lead.shiftId}`} className="manager-row">
        <div className="manager-row-main">
          <p className="manager-row-staff">
            {group.label} · {group.count}
          </p>
        </div>
        <span className="manager-row-go" aria-hidden>
          Review
        </span>
      </Link>
    </li>
  );
}

function OpenFixRow({
  task,
  items,
}: {
  task: Task;
  items: ManagerShiftSummary[];
}) {
  const shiftRow = items.find((s) => s.shift.$id === task.shiftId);
  const finding = shiftRow?.findings.find((f) => f.$id === task.findingId);
  const title = openFixTitle(task, finding);
  const waitingRecheck = Boolean(task.recheckFileId);
  return (
    <li data-finding-id={task.findingId}>
      <Link to={`/manager/shifts/${task.shiftId}`} className="manager-row">
        <div className="manager-row-main">
          <p className="manager-row-staff">{title}</p>
          <div className="manager-row-meta">
            <span className="caption">
              {displayStaffName(
                resolveStaffLabel(
                  task.assignedTo || shiftRow?.shift.createdBy || "",
                ),
              )}
            </span>
            <span
              className={`manager-pill${waitingRecheck ? " is-pass" : " is-unclear"}`}
            >
              {waitingRecheck ? "Re-check on file" : "Waiting on staff"}
            </span>
          </div>
        </div>
        <span className="manager-row-go" aria-hidden>
          Review
        </span>
      </Link>
    </li>
  );
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

