/**
 * C4 scoreboard + C6 override / assign fix / tasks / events (docs/API.md).
 * No free chat. Live Appwrite writes when source is live; demo stays local.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { EvidenceImg } from "../../components/EvidenceImg";
import {
  EvidenceLightbox,
  type EvidenceSlide,
} from "../../components/EvidenceLightbox";
import { FindingChip } from "../../components/FindingChip";
import { useAuth } from "../../lib/auth";
import { confidenceBand } from "../../lib/confidence";
import { formatEventType, formatFindingSource } from "../../lib/events";
import { getErrorMessage } from "../../lib/errors";
import { useSlowLoading } from "../../lib/loading";
import {
  applyLocalOverride,
  assignFixTask,
  attachRecheckAndRescore,
  closeShift,
  DEMO_AGENT_TRACE,
  formatManagerWhen,
  getAgentJobTrace,
  hasForcedCitation,
  isStuckScoring,
  itemLabel,
  listEvents,
  listTasks,
  loadManagerShift,
  markTaskDone,
  mergeTasksById,
  overrideFinding,
  isHarnessName,
  shortItemLabel,
  subscribeManagerTables,
  sweepStaleJobs,
  type ManagerShiftSummary,
} from "../../lib/manager";
import { RECHECK_FALLBACK_TOAST } from "../../lib/scoreShift";
import {
  getChecklist,
  getEvidenceFileUrl,
  parseChecklistItems,
  parsePhotoFileIds,
  photoForItem,
  retryShiftScore,
  uploadEvidence,
} from "../../lib/shifts";
import { displayStaffName, resolveStaffLabel } from "../../lib/staffNames";
import type {
  AuditEvent,
  ChecklistItem,
  Finding,
  FindingStatus,
  Task,
} from "../../types/shiftproof";
import "./ManagerShiftDetail.css";

type StickyMode = "idle" | "override" | "assign" | "retake";

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
  const navigate = useNavigate();
  const listRef = useRef<HTMLUListElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDetailsElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [item, setItem] = useState<ManagerShiftSummary | null>(null);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [traceOpen, setTraceOpen] = useState(false);
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
  const [missingPhotos, setMissingPhotos] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

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
      setTasks((prev) => mergeTasksById(t, prev));
      setEvents(e);
      setAgentTrace(trace);
    } catch {
      // Non-blocking for the findings table
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTasks([]);
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
        if (result.source === "live" && user && result.item.latestJob) {
          void sweepStaleJobs([result.item], user.$id).then(() => {
            if (!cancelled) setItem({ ...result.item });
          });
        }
        setTraceOpen(false);
        void getChecklist()
          .then((c) => setChecklistItems(parseChecklistItems(c)))
          .catch(() => setChecklistItems([]));
        // If every finding is Pass (e.g. golden after overrides), default to Show all
        // so managers / demo path can still select rows without an empty board.
        const openGaps = result.item.findings.filter(
          (f) => f.status === "gap" || f.status === "unclear",
        ).length;
        if (result.item.findings.length > 0 && openGaps === 0) {
          setShowAll(true);
        } else {
          setShowAll(false);
        }
        setLoading(false);
        void loadExtras(result.item.shift.$id, result.source === "demo");
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, "Could not load this opening"));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shiftId, loadExtras, user]);

  useEffect(() => {
    if (source !== "live" || !shiftId) return;
    let cancelled = false;
    const unsub = subscribeManagerTables(() => {
      void (async () => {
        try {
          const result = await loadManagerShift(shiftId);
          if (cancelled || !result) return;
          setItem(result.item);
          setSource(result.source);
          void loadExtras(result.item.shift.$id, result.source === "demo");
        } catch {
          /* keep the painted summary */
        }
      })();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [source, shiftId, loadExtras]);

  const selected = useMemo(
    () => item?.findings.find((f) => f.$id === selectedId) ?? null,
    [item, selectedId],
  );
  const formOpen = Boolean(selected) && mode !== "idle";

  useLayoutEffect(() => {
    const root = detailRef.current;
    if (!formOpen) {
      root?.style.removeProperty("--sticky-sheet-height");
      return;
    }
    const sheet = stickyRef.current;
    if (!sheet || !root) return;
    const apply = () => {
      root.style.setProperty("--sticky-sheet-height", `${sheet.offsetHeight}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [formOpen, mode]);

  useEffect(() => {
    if (!formOpen) return;
    closeOverflow();
    const sheet = stickyRef.current;
    const findingId = selectedId;
    if (!sheet || !findingId) return;

    const keepFindingVisible = () => {
      scrollFindingAboveSheet(listRef.current, findingId, sheet);
    };
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      keepFindingVisible();
      window.requestAnimationFrame(() => {
        if (!cancelled) keepFindingVisible();
      });
    });
    const vv = window.visualViewport;
    vv?.addEventListener("resize", keepFindingVisible);
    vv?.addEventListener("scroll", keepFindingVisible);

    if (!sheet.contains(document.activeElement)) {
      sheet.focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSheet();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = sheetFocusables(sheet);
      if (nodes.length === 0) {
        e.preventDefault();
        sheet.focus({ preventScroll: true });
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === sheet)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", keepFindingVisible);
      vv?.removeEventListener("scroll", keepFindingVisible);
      document.removeEventListener("keydown", onKey);
      const back = returnFocusRef.current;
      returnFocusRef.current = null;
      if (back && document.contains(back)) {
        back.focus({ preventScroll: true });
      }
    };
  }, [formOpen, selectedId, mode]);

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

  const onPhotoMissing = useCallback((fileId: string, missing: boolean) => {
    if (!missing) return;
    setMissingPhotos((prev) => {
      if (prev.has(fileId)) return prev;
      const next = new Set(prev);
      next.add(fileId);
      return next;
    });
  }, []);

  function openEvidence(fileId: string, startIndex: number) {
    if (!item || missingPhotos.has(fileId)) return;
    const ids = parsePhotoFileIds(item.shift.photoFileIds);
    setLightbox({
      items: ids.map((fid, j) => ({
        src: getEvidenceFileUrl(fid),
        label: `Evidence ${j + 1}`,
      })),
      startIndex: startIndex >= 0 ? startIndex : 0,
    });
  }

  function closeOverflow() {
    const el = overflowRef.current;
    if (el?.open) el.open = false;
  }

  function selectFinding(f: Finding) {
    setSelectedId(f.$id);
    setReason("");
    setToast(null);
    setError(null);
  }

  function startOverride(f: Finding) {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeOverflow();
    selectFinding(f);
    setOverrideTo(f.status === "pass" ? "gap" : "pass");
    setMode("override");
  }

  function startAssign(f: Finding) {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeOverflow();
    selectFinding(f);
    setMode(f.status === "unclear" ? "retake" : "assign");
  }

  function closeSheet() {
    setMode("idle");
    setReason("");
    setError(null);
  }

  function focusTask(findingId: string) {
    setMode("idle");
    setSelectedId(null);
    requestAnimationFrame(() => {
      const row = document.querySelector(
        `[data-testid="fix-row"][data-finding-id="${findingId}"]`,
      );
      if (row instanceof HTMLElement) {
        row.scrollIntoView({ block: "center", behavior: "smooth" });
        row.focus();
      }
    });
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

  async function runAssign(kind: "fix" | "retake" = "fix") {
    if (!item || !selected || !user) return;
    setError(null);
    setSaving(true);
    const title =
      kind === "retake"
        ? `Retake: ${glanceLabel(selected.itemId)}`
        : `Fix: ${glanceLabel(selected.itemId)}`;
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
        setTasks((prev) => mergeTasksById([localTask], prev));
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
          `Task assigned to ${displayStaffName(resolveStaffLabel(assignedTo))} (sample): ${title}`,
        );
      } else {
        const created = await assignFixTask({
          shiftId: item.shift.$id,
          findingId: selected.$id,
          title,
          userId: user.$id,
          assignedTo,
        });
        // Reload extras, then merge so a stale/silent refetch cannot drop it
        await loadExtras(item.shift.$id, false);
        setTasks((prev) => mergeTasksById([created], prev));
        setToast(
          `Task assigned to ${displayStaffName(resolveStaffLabel(assignedTo))}: ${title}`,
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

  async function runRetry() {
    if (!item || !user) return;
    setError(null);
    setSaving(true);
    try {
      if (source === "demo" || item.shift.$id.startsWith("demo_shift_")) {
        setToast("Retry is sample-only on this shift.");
      } else {
        await retryShiftScore(item.shift.$id, user.$id);
        const refreshed = await loadManagerShift(shiftId);
        if (refreshed) {
          setItem(refreshed.item);
          setSource(refreshed.source);
        }
        await loadExtras(item.shift.$id, false);
        setToast("Scoring started again.");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Could not retry scoring"));
    } finally {
      setSaving(false);
    }
  }

  async function runClose() {
    if (!item || !user) return;
    const ok = window.confirm("Close this opening? It leaves the inbox.");
    if (!ok) return;
    setError(null);
    setSaving(true);
    try {
      if (source === "demo" || item.shift.$id.startsWith("demo_shift_")) {
        setToast("Closed (sample).");
        navigate("/manager");
      } else {
        await closeShift({ shiftId: item.shift.$id, userId: user.$id });
        navigate("/manager");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Could not close this opening"));
    } finally {
      setSaving(false);
    }
  }

  async function runReject() {
    if (!item || !user) return;
    const ok = window.confirm("Photos are not an opening check.");
    if (!ok) return;
    setError(null);
    setSaving(true);
    try {
      if (source === "demo" || item.shift.$id.startsWith("demo_shift_")) {
        setToast("Rejected (sample).");
        navigate("/manager");
      } else {
        await closeShift({
          shiftId: item.shift.$id,
          userId: user.$id,
          reason: "invalid_evidence",
        });
        navigate("/manager");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Could not reject this check"));
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
   * Live path scores via the Function; sample rows stay Attestation.
   */
  async function onRecheckFile(taskId: string, fileList: FileList | null) {
    if (!fileList?.[0] || !item || !user) return;
    const task = tasks.find((t) => t.$id === taskId);
    if (!task) return;
    setError(null);
    setRecheckTaskId(taskId);
    try {
      if (source === "demo" || taskId.startsWith("local_")) {
        // Local demo: staff Attestation — not a fake AI score. Override fields stay.
        const attestedAt = new Date().toISOString();
        const recheckFileId = `demo_recheck_${Date.now()}`;
        setTasks((prev) =>
          prev.map((t) =>
            t.$id === taskId
              ? {
                  ...t,
                  recheckFileId,
                }
              : t,
          ),
        );
        setItem((prev) => {
          if (!prev) return prev;
          const findings = prev.findings.map((f) =>
            f.$id === task.findingId
              ? {
                  ...f,
                  status: "pass" as const,
                  evidenceNote: `Staff attested after fix. Re-check photo ${recheckFileId} is the basis.`,
                  source: "staff_recheck" as const,
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
            $createdAt: attestedAt,
            $updatedAt: attestedAt,
            shiftId: item.shift.$id,
            type: "task.recheck",
            actorUserId: user.$id,
            payloadJson: JSON.stringify({ taskId, findingId: task.findingId }),
            createdAt: attestedAt,
          },
          {
            $id: `local_ev_attest_${Date.now()}`,
            $createdAt: attestedAt,
            $updatedAt: attestedAt,
            shiftId: item.shift.$id,
            type: "finding.attested",
            actorUserId: user.$id,
            payloadJson: JSON.stringify({
              findingId: task.findingId,
              status: "pass",
              attestedBy: user.$id,
              attestedAt,
            }),
            createdAt: attestedAt,
          },
          ...prev,
        ]);
        setToast("Re-check attached (sample). Staff attested — mark done when ready.");
      } else {
        const fileId = await uploadEvidence(fileList[0]);
        const result = await attachRecheckAndRescore({
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
        setToast(
          result.fallback
            ? RECHECK_FALLBACK_TOAST
            : "Re-check scored — mark done when ready.",
        );
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
            Still loading this opening…
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
  const stuck = isStuckScoring(item.shift, item.latestJob);
  const jobFailed = item.latestJob?.status === "failed";
  const hasFindings = item.findings.length > 0;
  const failureDetail = scoringFailureDetail(item.latestJob);

  return (
    <div
      ref={detailRef}
      className={`manager-detail ${formOpen ? "has-sticky" : ""}`}
    >
      <div
        className="app-page stack manager-detail-page"
        inert={formOpen ? true : undefined}
      >
        <div className="manager-detail-nav">
          <Link to="/manager" className="back-link">
            ← Inbox
          </Link>
          {item.findings.length > 0 || item.shift.status !== "closed" ? (
            <details ref={overflowRef} className="scoreboard-overflow">
              <summary
                className="text-btn scoreboard-overflow-trigger"
                data-testid="scoreboard-overflow"
              >
                More
              </summary>
              <div className="scoreboard-overflow-menu">
                {item.findings.length > 0 ? (
                  <Link
                    to={`/manager/shifts/${item.shift.$id}/export`}
                    className="scoreboard-overflow-item"
                  >
                    Export pack
                  </Link>
                ) : null}
                {item.shift.status !== "closed" ? (
                  <>
                    <button
                      type="button"
                      className="scoreboard-overflow-item"
                      data-testid="reject-check-btn"
                      disabled={saving}
                      onClick={() => void runReject()}
                    >
                      Reject check
                    </button>
                    <button
                      type="button"
                      className="scoreboard-overflow-item"
                      disabled={saving}
                      onClick={() => void runClose()}
                    >
                      Close opening
                    </button>
                  </>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>

        <header className="stack-sm">
          <h1>{scoreboardHeading(item)}</h1>
          {source === "demo" ? (
            <p className="caption muted">Sample data</p>
          ) : null}
          {!stuck ? (
            <p
              className="muted"
              data-testid="shift-status"
              data-status={shiftStatusCode(item)}
            >
              {shiftStatusSentence(item)}
            </p>
          ) : null}
        </header>

        {stuck ? (
          <div
            className="manager-stuck-banner"
            role="status"
            data-testid="stuck-banner"
          >
            <p
              className="manager-stuck-title"
              data-testid="shift-status"
              data-status={jobFailed ? "failed" : "stuck"}
            >
              {shiftStatusSentence(item)}
            </p>
            {failureDetail ? (
              <p className="caption muted">{failureDetail}</p>
            ) : null}
            <Button
              variant="primary"
              loading={saving}
              onClick={() => void runRetry()}
            >
              Retry scoring
            </Button>
          </div>
        ) : null}

        {hasFindings ? (
        <p className="manager-tally" aria-label="Finding counts">
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
        </p>
        ) : null}

        {agentTrace && hasFindings ? (
          <section
            className="agent-trace"
            data-testid="agent-trace"
            aria-label="How this was scored"
          >
            <button
              type="button"
              className="agent-trace-toggle"
              aria-expanded={traceOpen}
              onClick={() => setTraceOpen((v) => !v)}
            >
              <h2>How this was scored</h2>
              <span className="caption">{traceOpen ? "Hide" : "Show"}</span>
            </button>
            {traceOpen && agentTrace.status !== "failed" ? (
              <>
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
                    {citationGaps.length} finding(s) missing
                    clause/quote/confidence.
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        {unclearFindings.length > 0 ? (
          <p
            className="hero-unclear"
            data-testid="hero-unclear"
            role="status"
          >
            {unclearFindings.length === 1
              ? "1 photo is unclear — request a retake, don’t assign a fix."
              : `${unclearFindings.length} photos are unclear — request a retake, don’t assign a fix.`}
          </p>
        ) : null}

        {hasFindings ? (
        <div className="manager-filter-row">
          <p className="caption">
            {showAll
              ? "All findings"
              : openCount === 0
                ? "No open items"
                : "Open items"}
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
        ) : null}

        {errorShown && !formOpen ? (
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
          stuck || jobFailed ? null : (
          <div className="stack-sm manager-empty-findings">
            <h2>
              {item.findings.length === 0
                ? item.shift.status === "scored"
                  ? "No findings yet"
                  : "Waiting on score"
                : "No open gaps"}
            </h2>
            <p className="muted">
              {item.findings.length === 0
                ? "Scores appear here when this opening is scored."
                : "Show all to review passes."}
            </p>
          </div>
          )
        ) : (
          <ul
            ref={listRef}
            className="list-plain finding-list"
            aria-label="Findings"
          >
            {visibleFindings.map((f) => {
              const isSelected = f.$id === selectedId && mode !== "idle";
              const photoId = photoForItem(
                f.itemId,
                item.shift.photoFileIds,
                checklistItems,
              );
              const photoIndex = photoId
                ? evidenceIds.indexOf(photoId)
                : -1;
              const note = displayEvidenceNote(f.evidenceNote);
              return (
                <li key={f.$id}>
                  <article
                    data-finding-id={f.$id}
                    data-source={f.source}
                    data-testid="finding-row"
                    className={`finding-row ${isSelected ? "is-selected" : ""}`}
                  >
                    <div className="finding-row-top">
                      <FindingChip status={f.status} />
                    </div>
                    <div className="finding-title-row">
                      <p className="finding-title">{glanceLabel(f.itemId)}</p>
                      {photoId ? (
                        <button
                          type="button"
                          className="finding-photo"
                          disabled={missingPhotos.has(photoId)}
                          onClick={() => openEvidence(photoId, photoIndex)}
                          aria-label={
                            missingPhotos.has(photoId)
                              ? "Photo unavailable"
                              : "View evidence photo"
                          }
                        >
                          <EvidenceImg
                            fileId={photoId}
                            alt=""
                            className="finding-photo-img"
                            compact
                            onMissingChange={onPhotoMissing}
                          />
                        </button>
                      ) : null}
                    </div>
                    <p
                      className="citation-bar caption"
                      data-testid="citation"
                    >
                      {f.clauseId} · {confidenceBand(f.confidence)}
                    </p>
                    {f.quote ? (
                    <p className="finding-quote muted">“{f.quote}”</p>
                    ) : null}
                    {note ? (
                      <p className="finding-note caption">{note}</p>
                    ) : null}
                    {f.overrideReason ? (
                      <p
                        className="override-reason caption"
                        data-testid="override-reason"
                      >
                        Override: {f.overrideReason}
                      </p>
                    ) : null}
                    {f.source && f.source !== "ai" ? (
                      <p
                        className="finding-conf caption"
                        data-testid="finding-source"
                        data-source={f.source}
                      >
                        {formatFindingSource(f.source)}
                      </p>
                    ) : null}
                    <div className="finding-actions">
                      {openTasks.some((t) => t.findingId === f.$id) ? (
                        <Button
                          variant="secondary"
                          disabled={saving}
                          onClick={() => focusTask(f.$id)}
                        >
                          View open fix
                        </Button>
                      ) : f.status !== "pass" ? (
                        <Button
                          variant="primary"
                          disabled={saving}
                          onClick={() => startAssign(f)}
                        >
                          {f.status === "unclear"
                            ? "Request photo"
                            : "Assign fix"}
                        </Button>
                      ) : null}
                      <Button
                        variant="quiet"
                        disabled={saving}
                        onClick={() => startOverride(f)}
                      >
                        Override
                      </Button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}

        {evidenceIds.length > 0 ? (
          <section
            className="evidence-gallery"
            aria-label="Shift evidence photos"
          >
            <div className="evidence-gallery-head">
              <h2>Evidence</h2>
              <p className="caption">
                {evidenceIds.length} photo
                {evidenceIds.length === 1 ? "" : "s"}
              </p>
            </div>
            <ul className="list-plain evidence-grid">
              {evidenceIds.map((id, i) => {
                const label = `Evidence ${i + 1}`;
                const gone = missingPhotos.has(id);
                return (
                  <li key={id} className="evidence-tile">
                    <button
                      type="button"
                      className="evidence-link"
                      disabled={gone}
                      onClick={() => openEvidence(id, i)}
                      aria-label={gone ? "Photo unavailable" : `View ${label}`}
                    >
                      <EvidenceImg
                        fileId={id}
                        alt={label}
                        className="evidence-img"
                        onMissingChange={onPhotoMissing}
                      />
                      {gone ? null : (
                        <span className="evidence-index caption">{i + 1}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* C6 — open fix tasks */}
        {openTasks.length > 0 || tasks.length > 0 ? (
          <section className="stack-sm manager-side-panel">
            <h2>Fix tasks</h2>
            {openTasks.length === 0 ? (
              <p className="muted caption">
                {tasks.length} closed · none open
              </p>
            ) : (
              <ul className="list-plain task-list">
                {openTasks.map((t) => {
                  const linked = item.findings.find(
                    (f) => f.$id === t.findingId,
                  );
                  const canMarkDone =
                    Boolean(t.recheckFileId) && linked?.status === "pass";
                  const attested = linked?.source === "staff_recheck";
                  return (
                  <li
                    key={t.$id}
                    className="task-row"
                    data-testid="fix-row"
                    data-finding-id={t.findingId}
                    tabIndex={-1}
                  >
                    <div className="stack-sm">
                      <p className="task-title">
                        {linked
                          ? `${/^retake:/i.test(t.title) ? "Retake" : "Fix"}: ${glanceLabel(linked.itemId)}`
                          : isHarnessName(t.title)
                            ? /^retake:/i.test(t.title)
                              ? "Retake"
                              : "Fix"
                            : t.title}
                      </p>
                      <p className="caption">
                        {t.status === "open" ? "Open" : "Done"}
                        {t.assignedTo
                          ? ` · ${displayStaffName(resolveStaffLabel(t.assignedTo))}`
                          : ""}
                        {t.createdAt ? ` · ${formatManagerWhen(t.createdAt)}` : ""}
                      </p>
                      {t.recheckFileId ? (
                        <>
                          <p
                            className="caption task-recheck-status"
                            data-testid="task-recheck-status"
                          >
                            {attested
                              ? "Re-check on file · staff attested — close when ready"
                              : "Re-check on file"}
                          </p>
                          <span data-testid="recheck-photo">
                            <EvidenceImg
                              fileId={t.recheckFileId}
                              alt="Re-check photo"
                              className="task-recheck-img"
                            />
                          </span>
                        </>
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
                              ? "Scoring re-check…"
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
                          variant={canMarkDone ? "primary" : "secondary"}
                          className="task-done-btn"
                          data-testid="task-mark-done"
                          disabled={!canMarkDone}
                          onClick={() => void completeTask(t.$id)}
                        >
                          Mark done
                        </Button>
                      </div>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {/* C6 — audit events */}
        {events.length > 0 ? (
          <section className="stack-sm manager-side-panel">
            <h2>Audit trail</h2>
            <ul className="list-plain event-list">
              {events.slice(0, 12).map((ev) => (
                <li key={ev.$id} className="event-row caption">
                  <span className="event-type">{formatEventType(ev.type)}</span>
                  <span>{formatManagerWhen(ev.createdAt || ev.$createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {formOpen && selected ? (
        <div
          ref={stickyRef}
          className="manager-sticky"
          role="region"
          aria-modal="true"
          aria-label="Finding actions"
          tabIndex={-1}
        >
          <div className="manager-sticky-inner">
            <p className="manager-sticky-label caption">
              {mode === "override"
                ? `Override ${glanceLabel(selected.itemId)}`
                : mode === "retake"
                  ? `Request photo · ${glanceLabel(selected.itemId)}`
                  : `Assign ${glanceLabel(selected.itemId)}`}
            </p>
            {errorShown ? (
              <div className="error-banner" role="alert">
                {errorShown}
              </div>
            ) : null}

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
                    placeholder="Add a short reason"
                  />
                </label>
                <div className="manager-sticky-actions">
                  <Button variant="secondary" onClick={closeSheet}>
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
            ) : (
              <div className="manager-sticky-form stack-sm">
                <p className="caption" data-testid="assign-to-staff">
                  To{" "}
                  {item
                    ? displayStaffName(resolveStaffLabel(item.shift.createdBy))
                    : "staff"}{" "}
                  — they send a new photo; you mark it done.
                </p>
                <div className="manager-sticky-actions">
                  <Button variant="secondary" onClick={closeSheet}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    loading={saving}
                    data-testid="create-task-btn"
                    onClick={() =>
                      void runAssign(mode === "retake" ? "retake" : "fix")
                    }
                  >
                    {mode === "retake" ? "Request photo" : "Assign to staff"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

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

const SHEET_FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function sheetFocusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SHEET_FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0,
  );
}

function scrollFindingAboveSheet(
  list: HTMLUListElement | null,
  findingId: string,
  sheet: HTMLElement,
) {
  const row = list?.querySelector(
    `[data-finding-id="${CSS.escape(findingId)}"]`,
  );
  if (!(row instanceof HTMLElement)) return;
  const chrome = document.querySelector(".shell-chrome");
  const chromeH =
    chrome instanceof HTMLElement ? chrome.getBoundingClientRect().height : 0;
  const gap = 12;
  const vv = window.visualViewport;
  const viewTop = vv?.offsetTop ?? 0;
  const viewH = vv?.height ?? window.innerHeight;
  const sheetH = sheet.getBoundingClientRect().height;
  const rect = row.getBoundingClientRect();
  const topMin = viewTop + chromeH + gap;
  const bottomMax = viewTop + viewH - sheetH - gap;
  const behavior = prefersReducedMotion() ? "auto" : "smooth";
  if (rect.height > bottomMax - topMin || rect.top < topMin) {
    window.scrollBy({ top: rect.top - topMin, behavior });
  } else if (rect.bottom > bottomMax) {
    window.scrollBy({ top: rect.bottom - bottomMax, behavior });
  }
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

function glanceLabel(itemId: string): string {
  return shortItemLabel(itemId) || itemLabel(itemId);
}

function scoringFailureDetail(job?: { errorMessage?: string } | null): string | null {
  const raw = job?.errorMessage?.trim();
  if (!raw) return null;
  if (/seeded e2e/i.test(raw) || isHarnessName(raw)) return null;
  return raw;
}

function formatTitleTime(iso: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "");
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    if (Number.isNaN(hour)) return iso;
    return `${hour}:${minute}`;
  } catch {
    return iso;
  }
}

function shiftOutcome(item: ManagerShiftSummary): string {
  if (item.gapCount > 0) return `${item.gapCount} Gap`;
  if (item.unclearCount > 0) return `${item.unclearCount} Unclear`;
  if (item.latestJob?.status === "failed") return "Failed";
  if (isStuckScoring(item.shift, item.latestJob)) return "Stuck";
  if (item.shift.status === "submitted" || item.shift.status === "scoring") {
    return "Scoring";
  }
  if (item.shift.status === "closed") return "Closed";
  if (item.passCount > 0) return "All Pass";
  return "Waiting";
}

function shiftStatusCode(item: ManagerShiftSummary): string {
  if (item.latestJob?.status === "failed") return "failed";
  if (isStuckScoring(item.shift, item.latestJob)) return "stuck";
  return item.shift.status;
}

function shiftStatusSentence(item: ManagerShiftSummary): string {
  if (item.shift.status === "closed") return "This opening is closed.";
  if (item.latestJob?.status === "failed") return "Scoring failed.";
  if (isStuckScoring(item.shift, item.latestJob)) return "Scoring is stuck.";
  if (
    item.shift.status === "scoring" ||
    item.latestJob?.status === "waiting" ||
    item.latestJob?.status === "running"
  ) {
    return "Scoring is in progress.";
  }
  if (item.shift.status === "submitted") return "Waiting to score.";
  if (item.shift.status === "scored") {
    if (item.gapCount > 0) {
      return item.gapCount === 1
        ? "1 gap still open."
        : `${item.gapCount} gaps still open.`;
    }
    if (item.unclearCount > 0) {
      return "Unclear photos need a retake.";
    }
    return "All checks passed.";
  }
  return "This opening is a draft.";
}

function scoreboardHeading(item: ManagerShiftSummary): string {
  const staff = displayStaffName(item.staffLabel);
  const time = formatTitleTime(item.shift.submittedAt || item.shift.startedAt);
  return `${staff}, ${time} — ${shiftOutcome(item)}`;
}

function displayEvidenceNote(note: string | undefined): string | null {
  if (!note?.trim()) return null;
  if (/seeded e2e finding\.?/i.test(note.trim())) return null;
  return note;
}

