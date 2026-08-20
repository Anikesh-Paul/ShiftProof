/**
 * C2 — Staff evidence upload + submit (docs/API.md staff journey §2–3).
 * After submit: read-only scores (API.md §6). Draft: resume / discard (§1, §5b).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import {
  EvidenceLightbox,
  type EvidenceSlide,
} from "../../components/EvidenceLightbox";
import { EvidenceImg } from "../../components/EvidenceImg";
import { FindingChip } from "../../components/FindingChip";
import { StatusChip } from "../../components/StatusChip";
import { useAuth } from "../../lib/auth";
import { getErrorMessage } from "../../lib/errors";
import { useSlowLoading } from "../../lib/loading";
import { latestEventReason } from "../../lib/events";
import {
  attachRecheckAndRescore,
  listEvents,
  listTasks,
} from "../../lib/manager";
import { displayEvidenceNote } from "../../lib/evidenceNote";
import { RECHECK_FALLBACK_TOAST } from "../../lib/scoreShift";
import {
  PHOTO_ACCEPT,
  PHOTO_MAX,
  PHOTO_MIN,
  deleteDraftShift,
  deleteEvidenceFile,
  getChecklist,
  getEvidenceFileUrl,
  getEvidencePreviewUrl,
  getLatestJob,
  getShift,
  listFindingsForShift,
  parseChecklistItems,
  parsePhotoFileIds,
  pollJobUntilSettled,
  retryShiftScore,
  setShiftPhotos,
  SubmitInterruptedError,
  submitShift,
  uploadEvidence,
  validatePhotoFile,
} from "../../lib/shifts";
import type {
  AgentJob,
  AuditEvent,
  ChecklistItem,
  Finding,
  Shift,
  Task,
} from "../../types/shiftproof";
import "./ShiftPhotos.css";

type LocalPhoto = {
  localId: string;
  file: File;
  previewUrl: string;
  uploading: boolean;
  error?: string;
};

function localPhotoId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* insecure context — fall through */
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function findingRank(status: Finding["status"]) {
  if (status === "gap") return 0;
  if (status === "unclear") return 1;
  return 2;
}

function isStuck(shift: Shift, job: AgentJob | null): boolean {
  // With a job, failure is the job's own status — never an age guess.
  if (job) return job.status === "failed";
  // No job on a submitted/scoring shift is stranded — recover immediately.
  return shift.status === "submitted" || shift.status === "scoring";
}

export function ShiftPhotos() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef<string[]>([]);
  const persistTail = useRef(Promise.resolve());
  const cancelledLocals = useRef(new Set<string>());

  const [shift, setShift] = useState<Shift | null>(null);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [locals, setLocals] = useState<LocalPhoto[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [openTasks, setOpenTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [latestJob, setLatestJob] = useState<AgentJob | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingSlow = useSlowLoading(loading);
  const [submitting, setSubmitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [recheckFindingId, setRecheckFindingId] = useState<string | null>(null);
  const [recheckToast, setRecheckToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [readyIds, setReadyIds] = useState<Set<string>>(() => new Set());
  const [lightbox, setLightbox] = useState<{
    items: EvidenceSlide[];
    startIndex: number;
  } | null>(null);

  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);
  const [sopExpanded, setSopExpanded] = useState(false);
  const [clearingPhotos, setClearingPhotos] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const markReady = useCallback((id: string) => {
    setReadyIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const bindPhoto = useCallback(
    (id: string) => (el: HTMLImageElement | null) => {
      if (el?.complete && el.naturalWidth > 0) markReady(id);
    },
    [markReady],
  );

  function onPreviewError(id: string, img: HTMLImageElement) {
    if (!img.dataset.fallback) {
      img.dataset.fallback = "1";
      img.src = getEvidenceFileUrl(id);
      return;
    }
    markReady(id);
    img.style.opacity = "0.35";
  }

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

  useEffect(() => {
    if (!shiftId) return;
    let cancelled = false;
    (async () => {
      try {
        const [row, checklist] = await Promise.all([
          getShift(shiftId),
          getChecklist().catch(() => null),
        ]);
        if (cancelled) return;
        const parsedItems = checklist ? parseChecklistItems(checklist) : [];
        setShift(row);
        setItems(parsedItems);
        const pool = parsePhotoFileIds(row.photoFileIds);
        committedRef.current = pool;
        setFileIds(pool);
        if (row.status !== "draft") {
          setDone(true);
          try {
            const [scored, tasks, job, evs] = await Promise.all([
              listFindingsForShift(shiftId),
              listTasks(shiftId).catch(() => [] as Task[]),
              getLatestJob(shiftId).catch(() => null),
              listEvents(shiftId).catch(() => [] as AuditEvent[]),
            ]);
            if (!cancelled) {
              setFindings(scored);
              setOpenTasks(tasks.filter((t) => t.status === "open"));
              setLatestJob(job);
              setEvents(evs);
            }
          } catch {
            if (!cancelled) setFindings([]);
          }
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, "Could not load shift"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  const shiftStatus = shift?.status;

  useEffect(() => {
    if (!shiftId || !shiftStatus) return;
    if (shiftStatus !== "submitted" && shiftStatus !== "scoring") return;
    let cancelled = false;
    void pollJobUntilSettled(shiftId, {
      timeoutMs: 180_000,
      isCancelled: () => cancelled,
    }).then(async () => {
      if (cancelled) return;
      try {
        const [row, scored, job] = await Promise.all([
          getShift(shiftId),
          listFindingsForShift(shiftId).catch(() => [] as Finding[]),
          getLatestJob(shiftId).catch(() => null),
        ]);
        if (cancelled) return;
        setShift(row);
        setFindings(scored);
        setLatestJob(job);
      } catch {
        /* keep last known row */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shiftId, shiftStatus]);

  useEffect(() => {
    return () => {
      setLocals((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        return prev;
      });
    };
  }, []);

  const persistUpdate = useCallback(
    (updater: (prev: string[]) => string[]) => {
      const run = async () => {
        if (!shiftId) return;
        const prev = committedRef.current;
        const next = updater(prev);
        if (prev.join("\0") === next.join("\0")) return;
        const updated = await setShiftPhotos(shiftId, next);
        const parsed = parsePhotoFileIds(updated.photoFileIds);
        committedRef.current = parsed;
        setShift(updated);
        setFileIds(parsed);
      };
      const p = persistTail.current.then(run, run);
      persistTail.current = p.then(
        () => undefined,
        () => undefined,
      );
      return p;
    },
    [shiftId],
  );

  const dropLocal = useCallback((localId: string) => {
    setLocals((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }, []);

  async function commitUploadedFile(localId: string, fileId: string) {
    if (cancelledLocals.current.has(localId)) {
      cancelledLocals.current.delete(localId);
      void deleteEvidenceFile(fileId);
      return;
    }
    let applied = false;
    await persistUpdate((prev) => {
      if (cancelledLocals.current.has(localId)) return prev;
      applied = true;
      return [...prev, fileId];
    });
    if (!applied) {
      cancelledLocals.current.delete(localId);
      void deleteEvidenceFile(fileId);
      return;
    }
    dropLocal(localId);
  }

  const totalCount = fileIds.length;
  const inFlightCount = locals.filter((p) => p.uploading).length;
  const uploading = inFlightCount > 0;
  const canSubmit =
    shift?.status === "draft" &&
    !uploading &&
    totalCount >= PHOTO_MIN &&
    totalCount <= PHOTO_MAX &&
    !submitting;
  const canAddPhoto =
    shift?.status === "draft" &&
    totalCount + inFlightCount < PHOTO_MAX &&
    !uploading &&
    !submitting;

  const progress = Math.min(1, totalCount / PHOTO_MIN);
  const hint = uploading
    ? "Uploading…"
    : totalCount < PHOTO_MIN
      ? `${totalCount} / ${PHOTO_MIN}`
      : `${totalCount} photos · min ${PHOTO_MIN}`;

  const itemLabel = useCallback(
    (itemId: string) => items.find((i) => i.id === itemId)?.label ?? itemId,
    [items],
  );

  async function addFiles(fileList: FileList | null) {
    if (!fileList?.length || !shiftId || shift?.status !== "draft") return;
    setError(null);

    const files = Array.from(fileList);
    const inFlights = locals.filter((p) => p.uploading).length;
    const currentTotal = committedRef.current.length + inFlights;

    if (currentTotal + files.length > PHOTO_MAX) {
      setError(`Maximum ${PHOTO_MAX} photos.`);
      return;
    }

    for (const file of files) {
      const validation = validatePhotoFile(file);
      if (validation) {
        setError(validation);
        return;
      }
    }

    const newLocals: LocalPhoto[] = files.map((file) => ({
      localId: localPhotoId(),
      file,
      previewUrl: URL.createObjectURL(file),
      uploading: true,
    }));

    newLocals.forEach((l) => cancelledLocals.current.delete(l.localId));
    setLocals((prev) => [...prev, ...newLocals]);

    await Promise.all(
      newLocals.map(async (local) => {
        try {
          const fileId = await uploadEvidence(local.file);
          await commitUploadedFile(local.localId, fileId);
        } catch (err) {
          if (cancelledLocals.current.has(local.localId)) {
            cancelledLocals.current.delete(local.localId);
            return;
          }
          setLocals((prev) =>
            prev.map((p) =>
              p.localId === local.localId
                ? {
                    ...p,
                    uploading: false,
                    error: getErrorMessage(err, "Upload failed"),
                  }
                : p,
            ),
          );
          setError(getErrorMessage(err, "Upload failed"));
        }
      }),
    );
  }

  async function retryLocal(item: LocalPhoto) {
    if (!shiftId || shift?.status !== "draft") return;
    setError(null);
    setLocals((prev) =>
      prev.map((p) =>
        p.localId === item.localId
          ? { ...p, uploading: true, error: undefined }
          : p,
      ),
    );
    try {
      cancelledLocals.current.delete(item.localId);
      const fileId = await uploadEvidence(item.file);
      await commitUploadedFile(item.localId, fileId);
    } catch (err) {
      if (cancelledLocals.current.has(item.localId)) {
        cancelledLocals.current.delete(item.localId);
        return;
      }
      setLocals((prev) =>
        prev.map((p) =>
          p.localId === item.localId
            ? {
                ...p,
                uploading: false,
                error: getErrorMessage(err, "Upload failed"),
              }
            : p,
        ),
      );
      setError(getErrorMessage(err, "Upload failed"));
    }
  }

  async function removePhoto(fileId: string) {
    setError(null);
    try {
      await persistUpdate((prev) => prev.filter((id) => id !== fileId));
      void deleteEvidenceFile(fileId);
    } catch (err) {
      setError(getErrorMessage(err, "Could not remove photo"));
    }
  }

  function removeLocal(localId: string) {
    cancelledLocals.current.add(localId);
    dropLocal(localId);
  }

  async function clearAllPhotos() {
    if ((fileIds.length === 0 && locals.length === 0) || !shiftId || shift?.status !== "draft") return;
    const total = fileIds.length + locals.length;
    if (total > 0) {
      const ok = window.confirm(
        `Remove all ${total} photo${total === 1 ? "" : "s"} from this check? This cannot be undone.`,
      );
      if (!ok) return;
    }
    setClearingPhotos(true);
    setError(null);
    try {
      for (const loc of locals) {
        cancelledLocals.current.add(loc.localId);
      }
      setLocals([]);
      const toDelete = [...fileIds];
      await persistUpdate(() => []);
      for (const fid of toDelete) {
        void deleteEvidenceFile(fid);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Could not clear photos"));
    } finally {
      setClearingPhotos(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void addFiles(e.dataTransfer.files);
    }
  }

  async function discardDraft() {
    if (!shiftId || shift?.status !== "draft") return;
    if (fileIds.length > 0) {
      const ok = window.confirm(
        `Discard this draft and ${fileIds.length} photo${fileIds.length === 1 ? "" : "s"}?`,
      );
      if (!ok) return;
    }
    setDiscarding(true);
    setError(null);
    try {
      await deleteDraftShift(shiftId, fileIds);
      navigate("/staff");
    } catch (err) {
      setError(getErrorMessage(err, "Could not discard draft"));
      setDiscarding(false);
    }
  }

  async function onSubmit() {
    if (!user || !shiftId || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitShift(shiftId, user.$id, totalCount);
      setShift(result.shift);
      setDone(true);
      setLatestJob(result.job);
      if (result.shift.status === "scored") {
        try {
          setFindings(await listFindingsForShift(shiftId));
        } catch {
          setFindings([]);
        }
      }
    } catch (err) {
      if (err instanceof SubmitInterruptedError) {
        setShift(err.shift);
        setDone(true);
        setLatestJob(err.job);
        setError(err.message);
        return;
      }
      if (shiftId) {
        try {
          const row = await getShift(shiftId);
          if (row.status !== "draft") {
            setShift(row);
            setDone(true);
            setLatestJob(await getLatestJob(shiftId).catch(() => null));
          }
        } catch {
          /* keep local draft */
        }
      }
      setError(getErrorMessage(err, "Submit failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onRetryScore() {
    if (!user || !shiftId) return;
    setRetrying(true);
    setError(null);
    try {
      const result = await retryShiftScore(shiftId, user.$id);
      setShift(result.shift);
      setLatestJob(result.job);
      if (!result.scoreTrigger.triggered && result.scoreTrigger.error) {
        setError(result.scoreTrigger.error);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Could not retry scoring"));
    } finally {
      setRetrying(false);
    }
  }

  async function onFindingRecheck(task: Task, fileList: FileList | null) {
    if (!fileList?.[0] || !user) return;
    const file = fileList[0];
    const invalid = validatePhotoFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setRecheckFindingId(task.findingId);
    setError(null);
    setRecheckToast(null);
    try {
      const fileId = await uploadEvidence(file);
      const result = await attachRecheckAndRescore({
        taskId: task.$id,
        shiftId: task.shiftId,
        findingId: task.findingId,
        recheckFileId: fileId,
        userId: user.$id,
      });
      setOpenTasks((prev) =>
        prev.map((t) =>
          t.$id === task.$id ? { ...t, recheckFileId: fileId } : t,
        ),
      );
      const scored = await listFindingsForShift(task.shiftId).catch(
        () => null,
      );
      if (scored) setFindings(scored);
      if (result.fallback) setRecheckToast(RECHECK_FALLBACK_TOAST);
    } catch (err) {
      setError(getErrorMessage(err, "Could not upload re-check photo"));
    } finally {
      setRecheckFindingId(null);
    }
  }

  if (loading) {
    return (
      <div className="app-page stack">
        <div className="skeleton-card skeleton-header" />
        <div className="skeleton-card skeleton-gallery" />
        {loadingSlow ? (
          <p className="loading-slow-hint" role="status">
            Still loading evidence…
          </p>
        ) : null}
      </div>
    );
  }

  if (!shift) {
    return (
      <div className="app-page stack">
        <Link to="/staff" className="back-link">
          ← Opening
        </Link>
        <h1>Shift not found</h1>
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  if (done || shift.status !== "draft") {
    const savedIds = parsePhotoFileIds(shift.photoFileIds);
    const heading =
      shift.status === "scored" || shift.status === "closed"
        ? "Your scores"
        : shift.status === "scoring"
          ? "Scoring"
          : "Submitted";
    const stuck = isStuck(shift, latestJob);
    const showRetry =
      Boolean(user) &&
      (stuck ||
        (Boolean(error) &&
          (shift.status === "submitted" || shift.status === "scoring") &&
          latestJob?.status !== "done"));
    const rejected = latestEventReason(events) === "invalid_evidence";
    const lede = rejected
      ? "Manager rejected this check — submit a real opening."
      : null;
    const sortedFindings = [...findings].sort(
      (a, b) => findingRank(a.status) - findingRank(b.status),
    );
    const gapCount = findings.filter((f) => f.status === "gap").length;
    const unclearCount = findings.filter((f) => f.status === "unclear").length;
    const passCount = findings.filter((f) => f.status === "pass").length;
    const nextRecheckFindingId =
      sortedFindings.find((f) => {
        const task = openTasks.find((t) => t.findingId === f.$id);
        return Boolean(
          task && (!task.recheckFileId || f.status !== "pass"),
        );
      })?.$id ?? null;
    const slides: EvidenceSlide[] = savedIds.map((fid, j) => ({
      src: getEvidenceFileUrl(fid),
      label: `Evidence ${j + 1}`,
    }));

    return (
      <div className="app-page stack photos-page">
        <Link to="/staff/shifts" className="back-link">
          ← History
        </Link>

        <header className="stack-sm">
          <div
            className="shift-header-row"
            data-job-status={latestJob?.status ?? "none"}
          >
            <h1>{heading}</h1>
            <StatusChip status={shift.status} jobFailed={latestJob?.status === "failed"} />
          </div>
          {lede ? (
            <p
              className="muted"
              data-testid={rejected ? "invalid-evidence-reason" : undefined}
            >
              {lede}
            </p>
          ) : null}
        </header>

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

        {recheckToast ? (
          <p className="success-banner" role="status" data-testid="recheck-toast">
            {recheckToast}
          </p>
        ) : null}

        {showRetry ? (
          <Button
            loading={retrying}
            onClick={() => void onRetryScore()}
          >
            Try scoring again
          </Button>
        ) : null}

        <div className="staff-submission-card" data-testid="staff-submission-card">
          <div className="staff-submission-header">
            <div className="staff-submission-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="staff-submission-info">
              <h2 className="staff-submission-title">Opening Proof Submitted</h2>
              <p className="staff-submission-meta caption">
                {savedIds.length} photo{savedIds.length === 1 ? "" : "s"} logged · {items.length > 0 ? `${items.length} SOP items checked` : "Ready for review"}
              </p>
            </div>
          </div>
        </div>

        {findings.length > 0 ? (
          <section className="staff-scores" aria-label="Scores">
            <div className="staff-scores-head">
              <p className="caption">
                {gapCount} gap · {unclearCount} unclear · {passCount} pass
              </p>
            </div>
            <ul className="list-plain staff-score-list">
              {sortedFindings.map((f) => {
                const assigned =
                  openTasks.find((t) => t.findingId === f.$id) ?? null;
                const note =
                  f.status === "unclear"
                    ? displayEvidenceNote(f.evidenceNote)
                    : null;
                return (
                  <li
                    key={f.$id}
                    className="staff-score-row"
                    data-finding-id={f.$id}
                  >
                    <FindingChip status={f.status} />
                    <div className="staff-score-copy">
                      <p className="staff-score-label">{itemLabel(f.itemId)}</p>
                      {note ? (
                        <p
                          className="staff-score-quote caption"
                          data-testid="staff-evidence-note"
                        >
                          {note}
                        </p>
                      ) : null}
                      {f.status === "unclear" ? (
                        <p className="caption staff-unclear-tip">
                          Tip: Frame clearly with direct lighting and ensure gauges or labels are visible.
                        </p>
                      ) : null}
                      {assigned &&
                      (!assigned.recheckFileId || f.status !== "pass") ? (
                        <div className="staff-score-recheck-open">
                          {assigned.recheckFileId ? (
                            <span data-testid="recheck-photo">
                              <EvidenceImg
                                fileId={assigned.recheckFileId}
                                alt="Re-check photo"
                                className="staff-recheck-thumb"
                              />
                            </span>
                          ) : null}
                          <label
                            className={
                              f.$id === nextRecheckFindingId
                                ? "staff-score-recheck"
                                : "staff-score-recheck is-quiet"
                            }
                          >
                            {recheckFindingId === f.$id
                              ? "Scoring re-check…"
                              : "Re-check photo"}
                            <input
                              type="file"
                              accept={PHOTO_ACCEPT}
                              className="visually-hidden"
                              data-testid="staff-recheck-input"
                              disabled={recheckFindingId === f.$id}
                              onChange={(e) => {
                                void onFindingRecheck(assigned, e.target.files);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        </div>
                      ) : assigned?.recheckFileId ? (
                        <div className="staff-score-recheck-sent">
                          <p className="caption">
                            Re-check sent · waiting on manager
                          </p>
                          <span data-testid="recheck-photo">
                            <EvidenceImg
                              fileId={assigned.recheckFileId}
                              alt="Re-check photo"
                              className="staff-recheck-thumb"
                            />
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : shift.status === "scored" || shift.status === "closed" ? (
          <p className="muted caption">No scores written for this shift yet.</p>
        ) : (
          <p className="muted caption" role="status">
            Waiting on scores…
          </p>
        )}

        {savedIds.length > 0 ? (
          <div className="photo-grid" aria-label="Submitted photos">
            {savedIds.map((id, i) => {
              const src = getEvidencePreviewUrl(id);
              const label = `Evidence ${i + 1}`;
              const ready = readyIds.has(id);
              return (
                <div
                  key={id}
                  className={`photo-tile${ready ? "" : " is-loading"}`}
                >
                  <button
                    type="button"
                    className="photo-open"
                    onClick={() =>
                      setLightbox({ items: slides, startIndex: i })
                    }
                    aria-label={`View ${label}`}
                  >
                    <img
                      ref={bindPhoto(id)}
                      src={src}
                      alt={label}
                      className={`photo-img${ready ? " is-ready" : ""}`}
                      onLoad={() => markReady(id)}
                      onError={(e) =>
                        onPreviewError(id, e.target as HTMLImageElement)
                      }
                    />
                  </button>
                  <div className="photo-badge caption">{i + 1}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted caption">No photos on this shift.</p>
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

  return (
    <div className="app-page stack photos-page">
      <div className="photo-toolbar">
        <Link to="/staff" className="back-link">
          ← Opening
        </Link>
        <div className="photo-toolbar-actions">
          {fileIds.length > 0 ? (
            <button
              type="button"
              className="text-btn photo-clear-btn"
              disabled={discarding || uploading || clearingPhotos}
              onClick={() => void clearAllPhotos()}
            >
              {clearingPhotos ? "Clearing…" : "Clear all photos"}
            </button>
          ) : null}
          <button
            type="button"
            className="text-btn photo-discard-btn"
            disabled={discarding || uploading || clearingPhotos}
            onClick={() => void discardDraft()}
          >
            {discarding ? "Discarding…" : "Discard draft"}
          </button>
        </div>
      </div>

      <header className="stack-sm">
        <div className="shift-header-row">
          <h1>Evidence</h1>
          <StatusChip status={shift.status} />
        </div>
      </header>

      <div
        className="photo-progress"
        role="status"
        aria-label={`${totalCount} of ${PHOTO_MIN} minimum photos`}
      >
        <div className="photo-progress-row">
          <div className="photo-progress-track">
            <div
              className="photo-progress-fill"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <p className="photo-hint">{hint}</p>
        </div>
        <p className="photo-guidance caption">
          Tip: 1 photo can cover multiple checklist items (e.g. coffee bar & grinders in one frame).
        </p>
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

      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        multiple
        className="visually-hidden"
        data-testid="staff-evidence-input"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {items.length > 0 ? (
        <section
          className="photo-shot-card"
          aria-label="What to cover"
        >
          <button
            type="button"
            className="photo-shot-head"
            onClick={() => setSopExpanded((prev) => !prev)}
            aria-expanded={sopExpanded}
          >
            <div className="photo-shot-title-group">
              <h2 className="photo-shot-heading">What to cover</h2>
              <p className="photo-shot-subtitle">
                {items.length} SOP items required for opening verification
              </p>
            </div>
            <div className="photo-shot-toggle">
              <span className="photo-shot-toggle-text">
                {sopExpanded ? "Hide" : "View"}
              </span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`photo-shot-chevron${sopExpanded ? " is-open" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>

          {sopExpanded ? (
            <ol className="photo-shot-list">
              {items.map((item, i) => (
                <li
                  key={item.id}
                  className="photo-shot-row"
                  data-testid="cover-item"
                  data-item-id={item.id}
                >
                  <span className="photo-shot-index" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="photo-shot-row-content">
                    <div className="photo-shot-row-top">
                      <span className="photo-shot-label">{item.label}</span>
                    </div>
                    {item.quote ? (
                      <p className="photo-shot-quote">{item.quote}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      {fileIds.length > 0 || locals.length > 0 ? (
        <section className="photo-gallery-section" aria-label="Evidence photos">
          <div className="photo-gallery-head">
            <h2 className="photo-gallery-title">
              Uploaded photos ({totalCount + inFlightCount}/{PHOTO_MAX})
            </h2>
            {fileIds.length > 0 ? (
              <button
                type="button"
                className="text-btn photo-clear-inline"
                disabled={uploading || discarding || clearingPhotos}
                onClick={() => void clearAllPhotos()}
              >
                Clear all
              </button>
            ) : null}
          </div>

          <div
            className={`photo-grid${isDragging ? " is-dragging" : ""}`}
            data-testid="photo-grid"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {fileIds.map((id, i) => {
              const ready = readyIds.has(id);
              const label = `Evidence ${i + 1}`;
              return (
                <div
                  key={id}
                  className={`photo-tile${ready ? "" : " is-loading"}`}
                  data-file-id={id}
                  data-testid="persisted-photo"
                >
                  <img
                    ref={bindPhoto(id)}
                    src={getEvidencePreviewUrl(id)}
                    alt={label}
                    className={`photo-img${ready ? " is-ready" : ""}`}
                    onLoad={() => markReady(id)}
                    onError={(e) =>
                      onPreviewError(id, e.target as HTMLImageElement)
                    }
                  />
                  <button
                    type="button"
                    className="photo-remove"
                    onClick={() => void removePhoto(id)}
                    aria-label={`Remove photo ${i + 1}`}
                    title={`Remove photo ${i + 1}`}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                  <div className="photo-badge caption">{i + 1}</div>
                </div>
              );
            })}
            {locals.map((p) => (
              <div key={p.localId} className="photo-tile" data-testid="local-photo">
                <img src={p.previewUrl} alt="" className="photo-img is-ready" />
                {p.uploading ? (
                  <div className="photo-overlay">
                    <span className="spinner" />
                    <span className="photo-overlay-label">Uploading…</span>
                  </div>
                ) : null}
                {p.error ? (
                  <div className="photo-overlay photo-error">
                    <span>{p.error}</span>
                    <button
                      type="button"
                      className="photo-retry"
                      onClick={() => void retryLocal(p)}
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="photo-remove"
                  onClick={() => removeLocal(p.localId)}
                  aria-label="Remove photo"
                  title="Remove photo"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}

            {canAddPhoto ? (
              <button
                type="button"
                className="photo-tile photo-tile-add"
                data-testid="add-photo-btn"
                onClick={() => inputRef.current?.click()}
                aria-label="Add more photos"
              >
                <div className="photo-tile-add-icon" aria-hidden>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <span className="photo-tile-add-title">Add photo</span>
                <span className="photo-tile-add-meta">
                  {totalCount + inFlightCount} of {PHOTO_MAX}
                </span>
              </button>
            ) : null}
          </div>

          {canAddPhoto ? (
            <div className="photo-actions-row">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => inputRef.current?.click()}
              >
                Choose photos from device
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {canAddPhoto && fileIds.length === 0 && locals.length === 0 ? (
        <button
          type="button"
          className={`photo-empty-dropzone${isDragging ? " is-dragging" : ""}`}
          data-testid="add-photo-btn"
          onClick={() => inputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="photo-empty-icon-wrap" aria-hidden>
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <div className="photo-empty-copy">
            <span className="photo-empty-title">Upload evidence photos</span>
            <span className="photo-empty-sub">
              Add 3–8 photos covering the checklist above
            </span>
            <span className="photo-empty-cue">
              Click to choose files or drop photos here
            </span>
          </div>
        </button>
      ) : null}

      <p className="caption photo-formats">
        JPG, PNG, or WebP · max 10 MB per photo
      </p>

      <div className="photo-submit-bar">
        <Button
          fullWidth
          loading={submitting}
          disabled={!canSubmit}
          onClick={() => void onSubmit()}
        >
          Submit proof
        </Button>
      </div>
    </div>
  );
}
