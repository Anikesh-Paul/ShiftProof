/**
 * C2 — Staff evidence upload + submit (docs/API.md staff journey §2–3).
 * Ops only: upload evidence, update photoFileIds, submit → agent_jobs + events.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import {
  EvidenceLightbox,
  type EvidenceSlide,
} from "../../components/EvidenceLightbox";
import { StatusChip } from "../../components/StatusChip";
import { useAuth } from "../../lib/auth";
import { getErrorMessage } from "../../lib/errors";
import { useSlowLoading } from "../../lib/loading";
import {
  PHOTO_ACCEPT,
  PHOTO_MAX,
  PHOTO_MIN,
  getEvidencePreviewUrl,
  getShift,
  parsePhotoFileIds,
  pollJobUntilSettled,
  setShiftPhotos,
  submitShift,
  uploadEvidence,
  validatePhotoFile,
} from "../../lib/shifts";
import type { Shift } from "../../types/shiftproof";
import "./ShiftPhotos.css";

type LocalPhoto = {
  localId: string;
  file: File;
  previewUrl: string;
  uploading: boolean;
  error?: string;
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ShiftPhotos() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [shift, setShift] = useState<Shift | null>(null);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [locals, setLocals] = useState<LocalPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const loadingSlow = useSlowLoading(loading);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [lightbox, setLightbox] = useState<{
    items: EvidenceSlide[];
    startIndex: number;
  } | null>(null);

  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);

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
        const row = await getShift(shiftId);
        if (cancelled) return;
        setShift(row);
        setFileIds(parsePhotoFileIds(row.photoFileIds));
        if (row.status !== "draft") setDone(true);
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

  useEffect(() => {
    return () => {
      setLocals((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        return prev;
      });
    };
  }, []);

  const persistIds = useCallback(
    async (ids: string[]) => {
      if (!shiftId) return;
      const updated = await setShiftPhotos(shiftId, ids);
      setShift(updated);
      setFileIds(parsePhotoFileIds(updated.photoFileIds));
    },
    [shiftId],
  );

  const totalCount = fileIds.length;
  const pendingLocal = locals.length;
  const gridCount = totalCount + pendingLocal;
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

  async function addFiles(fileList: FileList | null) {
    if (!fileList?.length || !shiftId || shift?.status !== "draft") return;
    setError(null);

    const room =
      PHOTO_MAX - fileIds.length - locals.filter((p) => p.uploading).length;
    if (room <= 0) {
      setError(`Maximum ${PHOTO_MAX} photos.`);
      return;
    }

    const selected = Array.from(fileList).slice(0, room);
    const batch: LocalPhoto[] = [];

    for (const file of selected) {
      const validation = validatePhotoFile(file);
      if (validation) {
        setError(validation);
        continue;
      }
      batch.push({
        localId: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        uploading: true,
      });
    }

    if (!batch.length) return;
    setLocals((prev) => [...prev, ...batch]);

    let nextIds = [...fileIds];

    for (const item of batch) {
      try {
        const fileId = await uploadEvidence(item.file);
        nextIds = [...nextIds, fileId];
        await persistIds(nextIds);
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
  }

  async function removeId(fileId: string) {
    if (!shiftId) return;
    setError(null);
    try {
      await persistIds(fileIds.filter((id) => id !== fileId));
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

  async function onSubmit() {
    if (!user || !shiftId || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // API.md §3–4: submit + best-effort runShiftScore
      const result = await submitShift(shiftId, user.$id, totalCount);
      setShift(result.shift);
      setDone(true);
      if (
        result.job.status !== "done" &&
        result.job.status !== "failed" &&
        result.scoreTrigger.triggered
      ) {
        void pollJobUntilSettled(shiftId, { timeoutMs: 180_000 }).then(
          async () => {
            try {
              setShift(await getShift(shiftId));
            } catch {
              /* ignore */
            }
          },
        );
      }
    } catch (err) {
      setError(getErrorMessage(err, "Submit failed"));
    } finally {
      setSubmitting(false);
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
    return (
      <div className="app-page stack photos-page">
        <Link to="/staff/shifts" className="back-link">
          ← History
        </Link>

        <header className="stack-sm">
          <div className="shift-header-row">
            <h1>{done ? "Submitted" : "Your evidence"}</h1>
            <StatusChip status={shift.status} />
          </div>
          <p className="caption">
            {savedIds.length} photo{savedIds.length === 1 ? "" : "s"}
          </p>
        </header>

        {savedIds.length > 0 ? (
          <div className="photo-grid" aria-label="Submitted photos">
            {savedIds.map((id, i) => {
              const src = getEvidencePreviewUrl(id);
              const label = `Evidence ${i + 1}`;
              const slides: EvidenceSlide[] = savedIds.map((fid, j) => ({
                src: getEvidencePreviewUrl(fid),
                label: `Evidence ${j + 1}`,
              }));
              return (
                <div key={id} className="photo-tile">
                  <button
                    type="button"
                    className="photo-open"
                    onClick={() =>
                      setLightbox({ items: slides, startIndex: i })
                    }
                    aria-label={`View ${label}`}
                  >
                    <img
                      src={src}
                      alt={label}
                      className="photo-img"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = "0.35";
                      }}
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

  const canAdd = gridCount < PHOTO_MAX && !uploading;

  return (
    <div className="app-page stack photos-page">
      <Link to="/staff" className="back-link">
        ← Opening
      </Link>

      <header className="stack-sm">
        <div className="shift-header-row">
          <h1>Evidence</h1>
          <StatusChip status={shift.status} />
        </div>
        <p className="muted">
          3–8 photos for this opening check. Clear frames beat a chat dump.
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
        multiple
        className="visually-hidden"
        data-testid="staff-evidence-input"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="photo-grid">
        {(() => {
          const draftSlides: EvidenceSlide[] = [
            ...fileIds.map((id, j) => ({
              src: getEvidencePreviewUrl(id),
              label: `Evidence ${j + 1}`,
            })),
            ...locals.map((p, j) => ({
              src: p.previewUrl,
              label: `New photo ${j + 1}`,
            })),
          ];
          return (
            <>
              {fileIds.map((id, i) => {
                const src = getEvidencePreviewUrl(id);
                const label = `Evidence ${i + 1}`;
                return (
                  <div
                    key={id}
                    className="photo-tile photo-tile-enter"
                    data-enter="true"
                  >
                    <button
                      type="button"
                      className="photo-open"
                      onClick={() =>
                        setLightbox({ items: draftSlides, startIndex: i })
                      }
                      aria-label={`View ${label}`}
                    >
                      <img
                        src={src}
                        alt={label}
                        className="photo-img"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </button>
                    <div className="photo-badge caption">Saved</div>
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => void removeId(id)}
                      aria-label="Remove photo"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {locals.map((p, i) => (
                <div
                  key={p.localId}
                  className="photo-tile photo-tile-enter"
                  data-enter="true"
                >
                  <button
                    type="button"
                    className="photo-open"
                    onClick={() =>
                      setLightbox({
                        items: draftSlides,
                        startIndex: fileIds.length + i,
                      })
                    }
                    aria-label={`View new photo ${i + 1}`}
                  >
                    <img src={p.previewUrl} alt="" className="photo-img" />
                  </button>
                  {p.uploading ? (
                    <div className="photo-overlay">
                      <span className="spinner" />
                    </div>
                  ) : null}
                  {p.error ? (
                    <div className="photo-overlay photo-error">{p.error}</div>
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
            </>
          );
        })()}
        {canAdd ? (
          <button
            type="button"
            className="photo-tile photo-add"
            onClick={() => inputRef.current?.click()}
          >
            <span className="photo-add-plus" aria-hidden>
              +
            </span>
            <span className="caption">Add photo</span>
          </button>
        ) : null}
      </div>

      {lightbox ? (
        <EvidenceLightbox
          items={lightbox.items}
          startIndex={lightbox.startIndex}
          onClose={() => setLightbox(null)}
        />
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
