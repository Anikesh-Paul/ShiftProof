/**
 * C2 — Staff evidence upload + submit (docs/API.md staff journey §2–3).
 * After submit: read-only scores (API.md §6). Draft: resume / discard (§1, §5b).
 */
import {
  useCallback,
  useEffect,
  useMemo,
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
  parsePhotoSlots,
  pollJobUntilSettled,
  retryShiftScore,
  serializePhotoSlots,
  setShiftPhotos,
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
  itemId: string | null;
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function findingRank(status: Finding["status"]) {
  if (status === "gap") return 0;
  if (status === "unclear") return 1;
  return 2;
}

function isStuck(shift: Shift, job: AgentJob | null): boolean {
  if (job?.status === "failed") return true;
  if (shift.status !== "submitted" && shift.status !== "scoring") return false;
  const raw = shift.submittedAt || shift.startedAt;
  const then = Date.parse(raw);
  if (!Number.isFinite(then)) return false;
  return Date.now() - then > 90_000;
}

export function ShiftPhotos() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetKeyRef = useRef<string | null>(null);

  const [shift, setShift] = useState<Shift | null>(null);
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<string[]>([]);
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
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [readyIds, setReadyIds] = useState<Set<string>>(() => new Set());
  const [lightbox, setLightbox] = useState<{
    items: EvidenceSlide[];
    startIndex: number;
  } | null>(null);

  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);

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
        const parsed = parsePhotoSlots(row.photoFileIds, parsedItems);
        setSlots(parsed.slots);
        setExtras(parsed.extras);
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
    void pollJobUntilSettled(shiftId, { timeoutMs: 180_000 }).then(async () => {
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

  const persistSlots = useCallback(
    async (nextSlots: Record<string, string>, nextExtras: string[]) => {
      if (!shiftId) return;
      const ids = serializePhotoSlots(items, nextSlots, nextExtras);
      const updated = await setShiftPhotos(shiftId, ids);
      setShift(updated);
      const parsed = parsePhotoSlots(updated.photoFileIds, items);
      setSlots(parsed.slots);
      setExtras(parsed.extras);
    },
    [shiftId, items],
  );

  const fileIds = useMemo(
    () => [...Object.values(slots).filter(Boolean), ...extras],
    [slots, extras],
  );
  const totalCount = fileIds.length;
  const uploading = locals.some((p) => p.uploading);
  const canSubmit =
    shift?.status === "draft" &&
    !uploading &&
    totalCount >= PHOTO_MIN &&
    totalCount <= PHOTO_MAX &&
    !submitting;

  const statusHint = useMemo(() => {
    if (uploading) return "Uploading to evidence storage…";
    if (totalCount < PHOTO_MIN) {
      const need = PHOTO_MIN - totalCount;
      return `${totalCount} of ${PHOTO_MIN}–${PHOTO_MAX} · add ${need} more`;
    }
    return `${totalCount} photos ready · submit when done`;
  }, [totalCount, uploading]);

  const progress = Math.min(1, totalCount / PHOTO_MIN);

  const itemLabel = useCallback(
    (itemId: string) => items.find((i) => i.id === itemId)?.label ?? itemId,
    [items],
  );

  function pickFiles(key: string) {
    targetKeyRef.current = key;
    inputRef.current?.click();
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList?.length || !shiftId || shift?.status !== "draft") return;
    const key = targetKeyRef.current;
    targetKeyRef.current = null;
    setError(null);

    const file = fileList[0];
    if (!file) return;
    const validation = validatePhotoFile(file);
    if (validation) {
      setError(validation);
      return;
    }

    const itemId = key && key !== "extra" ? key : null;
    if (!itemId && totalCount >= PHOTO_MAX) {
      setError(`Maximum ${PHOTO_MAX} photos.`);
      return;
    }
    if (itemId && !slots[itemId] && totalCount >= PHOTO_MAX) {
      setError(`Maximum ${PHOTO_MAX} photos.`);
      return;
    }

    const local: LocalPhoto = {
      localId: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      uploading: true,
      itemId,
    };
    setLocals((prev) => [...prev, local]);

    try {
      const fileId = await uploadEvidence(file);
      const nextSlots = { ...slots };
      let nextExtras = [...extras];
      if (itemId) {
        const previous = nextSlots[itemId];
        nextSlots[itemId] = fileId;
        if (previous) void deleteEvidenceFile(previous);
      } else {
        nextExtras = [...nextExtras, fileId];
      }
      await persistSlots(nextSlots, nextExtras);
      setLocals((prev) => {
        const target = prev.find((p) => p.localId === local.localId);
        if (target) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((p) => p.localId !== local.localId);
      });
    } catch (err) {
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
      const fileId = await uploadEvidence(item.file);
      const nextSlots = { ...slots };
      let nextExtras = [...extras];
      if (item.itemId) {
        const previous = nextSlots[item.itemId];
        nextSlots[item.itemId] = fileId;
        if (previous) void deleteEvidenceFile(previous);
      } else {
        nextExtras = [...nextExtras, fileId];
      }
      await persistSlots(nextSlots, nextExtras);
      setLocals((prev) => {
        const target = prev.find((p) => p.localId === item.localId);
        if (target) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((p) => p.localId !== item.localId);
      });
    } catch (err) {
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

  async function removeSlot(itemId: string) {
    const fileId = slots[itemId];
    if (!fileId) return;
    setError(null);
    try {
      const next = { ...slots };
      delete next[itemId];
      await persistSlots(next, extras);
      void deleteEvidenceFile(fileId);
    } catch (err) {
      setError(getErrorMessage(err, "Could not remove photo"));
    }
  }

  async function removeExtra(fileId: string) {
    setError(null);
    try {
      await persistSlots(
        slots,
        extras.filter((id) => id !== fileId),
      );
      void deleteEvidenceFile(fileId);
    } catch (err) {
      setError(getErrorMessage(err, "Could not remove photo"));
    }
  }

  function removeLocal(localId: string) {
    setLocals((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
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
    try {
      const fileId = await uploadEvidence(file);
      await attachRecheckAndRescore({
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
    } catch (err) {
      setError(getErrorMessage(err, "Could not upload re-check photo"));
    } finally {
      setRecheckFindingId(null);
    }
  }

  if (loading) {
    return (
      <div className="app-page stack">
        <div className="skeleton-card" style={{ minHeight: "3rem" }} />
        <div className="skeleton-card" style={{ minHeight: "12rem" }} />
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
    const rejected = latestEventReason(events) === "invalid_evidence";
    const lede = rejected
      ? "Manager rejected this check — submit a real opening."
      : shift.status === "scored" || shift.status === "closed"
        ? "Fix gaps here when a task is assigned — or wait for the manager."
        : stuck
          ? "Scoring did not finish. Retry, or check back in a minute."
          : "Photos are in. Scores appear here when AI finishes.";
    const sortedFindings = [...findings].sort(
      (a, b) => findingRank(a.status) - findingRank(b.status),
    );
    const gapCount = findings.filter((f) => f.status === "gap").length;
    const unclearCount = findings.filter((f) => f.status === "unclear").length;
    const passCount = findings.filter((f) => f.status === "pass").length;
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
          <div className="shift-header-row">
            <h1>{heading}</h1>
            <StatusChip status={shift.status} />
          </div>
          <p
            className="muted"
            data-testid={rejected ? "invalid-evidence-reason" : undefined}
          >
            {lede}
          </p>
          <p className="caption">
            {savedIds.length} photo{savedIds.length === 1 ? "" : "s"}
          </p>
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

        {stuck && user ? (
          <Button
            loading={retrying}
            onClick={() => void onRetryScore()}
          >
            Try scoring again
          </Button>
        ) : null}

        {findings.length > 0 ? (
          <section className="staff-scores" aria-labelledby="staff-scores-title">
            <div className="staff-scores-head">
              <h2 id="staff-scores-title">Scores</h2>
              <p className="caption">
                {gapCount} gap · {unclearCount} unclear · {passCount} pass
              </p>
            </div>
            <ul className="list-plain staff-score-list">
              {sortedFindings.map((f) => {
                const assigned =
                  openTasks.find((t) => t.findingId === f.$id) ?? null;
                return (
                  <li key={f.$id} className="staff-score-row">
                    <FindingChip status={f.status} />
                    <div className="staff-score-copy">
                      <p className="staff-score-label">{itemLabel(f.itemId)}</p>
                      {f.status !== "pass" && f.quote ? (
                        <p className="caption staff-score-quote">“{f.quote}”</p>
                      ) : null}
                      {f.status !== "pass" ? (
                        assigned && !assigned.recheckFileId ? (
                          <label className="staff-score-recheck">
                            {recheckFindingId === f.$id
                              ? "Uploading…"
                              : "Upload re-check photo"}
                            <input
                              type="file"
                              accept={PHOTO_ACCEPT}
                              className="visually-hidden"
                              disabled={recheckFindingId === f.$id}
                              onChange={(e) => {
                                void onFindingRecheck(assigned, e.target.files);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        ) : assigned?.recheckFileId ? (
                          <p className="caption">Re-check sent · waiting on manager</p>
                        ) : (
                          <p className="caption">
                            Manager will assign a fix if this still needs work.
                          </p>
                        )
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

  const canAddExtra = totalCount < PHOTO_MAX && !uploading;
  const extraLocals = locals.filter((p) => !p.itemId);

  return (
    <div className="app-page stack photos-page">
      <div className="photo-toolbar">
        <Link to="/staff" className="back-link">
          ← Opening
        </Link>
        <button
          type="button"
          className="text-btn"
          disabled={discarding || uploading}
          onClick={() => void discardDraft()}
        >
          {discarding ? "Discarding…" : "Discard draft"}
        </button>
      </div>

      <header className="stack-sm">
        <div className="shift-header-row">
          <h1>Evidence</h1>
          <StatusChip status={shift.status} />
        </div>
        <p className="muted">
          One photo per item when you can. 3–8 shots total to submit.
        </p>
      </header>

      <div
        className="photo-progress"
        role="status"
        aria-label={`${totalCount} of ${PHOTO_MIN} minimum photos`}
      >
        <div className="photo-progress-track">
          <div
            className="photo-progress-fill"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
        <p className="photo-hint">{statusHint}</p>
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
        capture="environment"
        className="visually-hidden"
        data-testid="staff-evidence-input"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {items.length > 0 ? (
        <ol className="item-photo-list">
          {items.map((item, i) => {
            const fileId = slots[item.id];
            const local = locals.find((p) => p.itemId === item.id);
            const ready = fileId ? readyIds.has(fileId) : true;
            return (
              <li key={item.id} className="item-photo-row">
                <div className="item-photo-copy">
                  <span className="photo-shot-index" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="item-photo-label">{item.label}</span>
                </div>
                {fileId ? (
                  <div
                    className={`item-photo-tile${ready ? "" : " is-loading"}`}
                  >
                    <img
                      ref={bindPhoto(fileId)}
                      src={getEvidencePreviewUrl(fileId)}
                      alt={item.label}
                      className={`photo-img${ready ? " is-ready" : ""}`}
                      onLoad={() => markReady(fileId)}
                      onError={(e) =>
                        onPreviewError(fileId, e.target as HTMLImageElement)
                      }
                    />
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => void removeSlot(item.id)}
                      aria-label={`Remove photo for ${item.label}`}
                    >
                      ×
                    </button>
                  </div>
                ) : local ? (
                  <div className="item-photo-tile">
                    <img src={local.previewUrl} alt="" className="photo-img is-ready" />
                    {local.uploading ? (
                      <div className="photo-overlay">
                        <span className="spinner" />
                      </div>
                    ) : null}
                    {local.error ? (
                      <div className="photo-overlay photo-error">
                        <span>{local.error}</span>
                        <button
                          type="button"
                          className="photo-retry"
                          onClick={() => void retryLocal(local)}
                        >
                          Retry
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => removeLocal(local.localId)}
                      aria-label="Remove photo"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="item-photo-add"
                    disabled={!canAddExtra}
                    onClick={() => pickFiles(item.id)}
                  >
                    Add photo
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}

      {extras.length > 0 || extraLocals.length > 0 ? (
        <section className="stack-sm" aria-label="Other photos">
          <h2 className="photo-shot-heading">Other photos</h2>
          <div className="photo-grid">
            {extras.map((id) => {
              const ready = readyIds.has(id);
              return (
                <div
                  key={id}
                  className={`photo-tile${ready ? "" : " is-loading"}`}
                >
                  <img
                    ref={bindPhoto(id)}
                    src={getEvidencePreviewUrl(id)}
                    alt=""
                    className={`photo-img${ready ? " is-ready" : ""}`}
                    onLoad={() => markReady(id)}
                    onError={(e) =>
                      onPreviewError(id, e.target as HTMLImageElement)
                    }
                  />
                  <button
                    type="button"
                    className="photo-remove"
                    onClick={() => void removeExtra(id)}
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {extraLocals.map((p) => (
              <div key={p.localId} className="photo-tile">
                <img src={p.previewUrl} alt="" className="photo-img is-ready" />
                {p.uploading ? (
                  <div className="photo-overlay">
                    <span className="spinner" />
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
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {canAddExtra ? (
        <button
          type="button"
          className="text-btn"
          onClick={() => pickFiles("extra")}
        >
          Add extra photo
        </button>
      ) : null}

      <p className="caption photo-formats">
        JPG, PNG, or WebP · max 10 MB · {PHOTO_MIN}–{PHOTO_MAX} required
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
