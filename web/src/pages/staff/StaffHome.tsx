/**
 * Staff Opening tab — habit-first home (docs/APP.md staff journey).
 * Redesign: calm task surface, not marketing hero stack.
 */
import {
  useCallback,
  useEffect,
  useState,
  type AnimationEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { useAuth } from "../../lib/auth";
import { getErrorMessage } from "../../lib/errors";
import { useSlowLoading } from "../../lib/loading";
import {
  attachRecheckAndRescore,
  listOpenFixTasksForStaff,
} from "../../lib/manager";
import {
  createDraftShift,
  getChecklist,
  getSite,
  listMyShifts,
  parseChecklistItems,
  getEvidencePreviewUrl,
  getShift,
  parsePhotoFileIds,
  pickResumableDraft,
  PHOTO_ACCEPT,
  uploadEvidence,
  validatePhotoFile,
} from "../../lib/shifts";
import type { ChecklistItem, Shift, Site, Task } from "../../types/shiftproof";
import "./StaffHome.css";

const FIX_VISIBLE = 4;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function StaffHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [site, setSite] = useState<Site | null>(null);
  const [checklistTitle, setChecklistTitle] = useState<string>("");
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [fixTasks, setFixTasks] = useState<Task[]>([]);
  const [fixLoading, setFixLoading] = useState(true);
  const [recheckTaskId, setRecheckTaskId] = useState<string | null>(null);
  const [fixToast, setFixToast] = useState<string | null>(null);
  const [resumeDraft, setResumeDraft] = useState<Shift | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const [fixesExpanded, setFixesExpanded] = useState(false);
  const [fixThumbs, setFixThumbs] = useState<Record<string, string>>({});

  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);
  const loadingSlow = useSlowLoading(loading);

  const loadFixTasks = useCallback(
    async (userId: string, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setFixLoading(true);
      try {
        const tasks = await listOpenFixTasksForStaff(userId, (partial) => {
          setFixTasks(partial);
          setFixLoading(false);
          setFixError(null);
        });
        setFixTasks(tasks);
        setFixError(null);
      } catch (err) {
        if (!opts?.silent) setFixTasks([]);
        setFixError(
          getErrorMessage(
            err,
            "Could not load fix tasks. Try again.",
          ),
        );
      } finally {
        setFixLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, c] = await Promise.all([getSite(), getChecklist()]);
        if (cancelled) return;
        setSite(s);
        setChecklistTitle(c.title);
        setItems(parseChecklistItems(c));
      } catch (err) {
        if (!cancelled)
          setError(getErrorMessage(err, "Could not load site data"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadFixTasks(user.$id);
  }, [user, loadFixTasks]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listMyShifts(user.$id);
        if (!cancelled) setResumeDraft(pickResumableDraft(rows));
      } catch {
        if (!cancelled) setResumeDraft(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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

  async function startShift() {
    if (!user) return;
    setError(null);
    setStarting(true);
    try {
      if (resumeDraft) {
        navigate(`/staff/shifts/${resumeDraft.$id}`);
        return;
      }
      const shift = await createDraftShift(user.$id);
      navigate(`/staff/shifts/${shift.$id}`);
    } catch (err) {
      setError(getErrorMessage(err, "Could not start shift"));
    } finally {
      setStarting(false);
    }
  }

  async function onStaffRecheck(task: Task, fileList: FileList | null) {
    if (!fileList?.[0] || !user) return;
    const file = fileList[0];
    const invalid = validatePhotoFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setFixToast(null);
    setRecheckTaskId(task.$id);
    try {
      const fileId = await uploadEvidence(file);
      await attachRecheckAndRescore({
        taskId: task.$id,
        shiftId: task.shiftId,
        findingId: task.findingId,
        recheckFileId: fileId,
        userId: user.$id,
      });
      setFixTasks((prev) =>
        prev.map((t) =>
          t.$id === task.$id ? { ...t, recheckFileId: fileId } : t,
        ),
      );
      setFixToast(
        "Re-check uploaded. AI re-scored this item — manager will close the task.",
      );
      await loadFixTasks(user.$id, { silent: true });
    } catch (err) {
      setError(getErrorMessage(err, "Could not upload re-check photo"));
    } finally {
      setRecheckTaskId(null);
    }
  }

  const uniqueFixes = uniqueFixTasks(fixTasks);
  const pendingUnique = uniqueFixes.filter((t) => !t.recheckFileId);
  const waitingUnique = uniqueFixes.filter((t) => t.recheckFileId);
  const hiddenFixCount = Math.max(0, uniqueFixes.length - FIX_VISIBLE);
  const visibleFixes = (fixesExpanded ? uniqueFixes : uniqueFixes.slice(0, FIX_VISIBLE));

  const showFixes = uniqueFixes.length > 0;
  const showFixSkeleton = fixLoading && uniqueFixes.length === 0;
  const resumePhotoCount = resumeDraft
    ? parsePhotoFileIds(resumeDraft.photoFileIds).length
    : 0;

  const visibleFixKey = visibleFixes.map((t) => `${t.$id}:${t.shiftId}`).join(",");

  useEffect(() => {
    if (!visibleFixKey) return;
    let cancelled = false;
    const rows = visibleFixKey.split(",").map((pair) => {
      const [id, shiftId] = pair.split(":");
      return { id, shiftId };
    });
    void Promise.all(
      rows.map(async ({ id, shiftId }) => {
        if (!id || !shiftId) return null;
        try {
          const row = await getShift(shiftId);
          const first = parsePhotoFileIds(row.photoFileIds)[0];
          return first ? ([id, getEvidencePreviewUrl(first)] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setFixThumbs((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const pair of pairs) {
          if (pair && next[pair[0]] !== pair[1]) {
            next[pair[0]] = pair[1];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [visibleFixKey]);

  return (
    <div className="staff-home" data-testid="staff-opening">
      <div className="app-page stack staff-home-page">
        {/* Full-bleed hero photo; title stays on paper below */}
        <div className="staff-atmosphere" aria-hidden="true">
          <img
            className={
              photoLoaded
                ? "staff-atmosphere-photo is-loaded"
                : "staff-atmosphere-photo"
            }
            src="/staff-open.jpg"
            alt=""
            width={1600}
            height={900}
            decoding="async"
            onLoad={() => setPhotoLoaded(true)}
          />
          <div className="staff-atmosphere-scrim" />
        </div>

        <header className="staff-head stack-sm">
          <p className="staff-site" data-testid="staff-site">
            {loading
              ? "Loading site…"
              : site
                ? site.name
                : "Site unavailable"}
          </p>
          <h1 id="staff-home-title">Opening check</h1>
          <p className="staff-lede">
            {loading
              ? "Loading checklist…"
              : "Photograph each item — about a minute. Submit once when you have 3–8 clear shots."}
          </p>
          {!loading && items.length > 0 ? (
            <p className="staff-meta caption" aria-label="Check summary">
              <span>{items.length} items</span>
              <span className="staff-meta-dot" aria-hidden>
                ·
              </span>
              <span>~1 min</span>
              <span className="staff-meta-dot" aria-hidden>
                ·
              </span>
              <span>3–8 photos</span>
              {checklistTitle ? (
                <>
                  <span className="staff-meta-dot" aria-hidden>
                    ·
                  </span>
                  <span className="staff-meta-checklist">{checklistTitle}</span>
                </>
              ) : null}
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

        {fixError ? (
          <div className="error-banner" role="alert">
            {fixError}
            <button
              type="button"
              className="text-btn"
              onClick={() => user && void loadFixTasks(user.$id)}
            >
              Try again
            </button>
          </div>
        ) : null}

        {fixToast ? (
          <p className="success-banner" role="status" data-testid="fix-toast">
            {fixToast}
          </p>
        ) : null}

        {showFixSkeleton ? (
          <div
            className="staff-fixes staff-fixes-skeleton-block"
            aria-busy
            aria-label="Loading fixes"
          >
            <div className="skeleton-card staff-fixes-skeleton" />
          </div>
        ) : null}

        {showFixes ? (
          <section
            className="staff-fixes"
            aria-labelledby="open-fixes-title"
            data-testid="open-fixes"
          >
            <div className="staff-fixes-head">
              <h2 id="open-fixes-title">Fix needed</h2>
              {!fixLoading && uniqueFixes.length > 0 ? (
                <p className="staff-fixes-count caption">
                  {pendingUnique.length > 0
                    ? `${pendingUnique.length} need${pendingUnique.length === 1 ? "s" : ""} a re-check photo`
                    : null}
                  {pendingUnique.length > 0 && waitingUnique.length > 0
                    ? " · "
                    : null}
                  {waitingUnique.length > 0
                    ? `${waitingUnique.length} waiting on manager`
                    : null}
                </p>
              ) : null}
            </div>

            <ul className="list-plain staff-fix-list">
              {visibleFixes.map((t) => (
                <li
                  key={t.$id}
                  className="staff-fix-row"
                  data-testid="staff-fix-row"
                  data-state={t.recheckFileId ? "sent" : "needs-photo"}
                >
                  {fixThumbs[t.$id] ? (
                    <img
                      className="staff-fix-thumb"
                      src={fixThumbs[t.$id]}
                      alt=""
                      width={56}
                      height={56}
                    />
                  ) : null}
                  <div className="staff-fix-body">
                    <p className="staff-fix-title">{t.title}</p>
                    <p className="caption staff-fix-status">
                      {formatFixWhen(t.createdAt || t.$createdAt)}
                      {t.recheckFileId
                        ? " · re-check on file, waiting for manager"
                        : " · upload one clear photo after you fix it"}
                    </p>
                    <Link
                      to={`/staff/shifts/${t.shiftId}`}
                      className="text-btn staff-fix-shift-link"
                    >
                      View scores
                    </Link>
                  </div>
                  {!t.recheckFileId ? (
                    <label className="staff-recheck-upload">
                      <span>
                        {recheckTaskId === t.$id
                          ? "Uploading…"
                          : "Re-check photo"}
                      </span>
                      <input
                        type="file"
                        accept={PHOTO_ACCEPT}
                        className="visually-hidden"
                        data-testid="staff-recheck-input"
                        disabled={recheckTaskId === t.$id}
                        onChange={(e) => {
                          void onStaffRecheck(t, e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  ) : (
                    <span
                      className="staff-fix-done-chip"
                      data-testid="staff-recheck-done"
                    >
                      Sent
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {hiddenFixCount > 0 ? (
              <button
                type="button"
                className="text-btn staff-fixes-more"
                onClick={() => setFixesExpanded((v) => !v)}
              >
                {fixesExpanded
                  ? "Show fewer"
                  : `Show ${hiddenFixCount} more`}
              </button>
            ) : null}
          </section>
        ) : null}

        <section
          className="staff-checklist-panel"
          aria-labelledby="photo-list-title"
          data-testid="staff-checklist"
        >
          <div className="staff-checklist-head">
            <h2 id="photo-list-title">What to photograph</h2>
            <p className="muted staff-checklist-lede">
              Clear shots of each item — proof for the manager.
            </p>
          </div>

          {loading ? (
            <div className="stack-sm">
              <div
                className="skeleton-card staff-list-skeleton"
                aria-busy
                aria-label="Loading checklist"
              />
              {loadingSlow ? (
                <p className="loading-slow-hint" role="status">
                  Still loading checklist…
                </p>
              ) : null}
            </div>
          ) : items.length > 0 ? (
            <ol className="staff-checklist stagger-in">
              {items.map((item, i) => (
                <li key={item.id}>
                  <span className="checklist-index" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="checklist-label">{item.label}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No checklist items loaded.</p>
          )}
        </section>
      </div>

      <div
        className="staff-cta-bar"
        role="region"
        aria-label={
          resumeDraft ? "Continue opening check" : "Start opening check"
        }
      >
        <div className="staff-cta-inner">
          {pendingUnique.length > 0 ? (
            <p className="staff-cta-hint caption">
              {pendingUnique.length} open fix
              {pendingUnique.length === 1 ? "" : "es"} above
              {resumeDraft ? " — or continue your draft" : " — or start a new check"}
            </p>
          ) : resumeDraft ? (
            <p className="staff-cta-hint caption">
              {resumePhotoCount === 0
                ? "Draft waiting — add photos to finish"
                : `${resumePhotoCount} photo${resumePhotoCount === 1 ? "" : "s"} saved · finish and submit`}
            </p>
          ) : (
            <p className="staff-cta-hint caption">
              Photograph · Submit · Manager reviews scores
            </p>
          )}
          <Button
            fullWidth
            loading={starting}
            disabled={loading || (!resumeDraft && items.length === 0)}
            data-testid="start-opening-check"
            onClick={() => void startShift()}
          >
            {resumeDraft ? "Continue opening check" : "Start opening check"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function uniqueFixTasks(tasks: Task[]): Task[] {
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const t of tasks) {
    const key = t.findingId || t.$id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function formatFixWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
