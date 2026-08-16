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
  parsePhotoFileIds,
  pickResumableDraft,
  PHOTO_ACCEPT,
  uploadEvidence,
  validatePhotoFile,
} from "../../lib/shifts";
import type { ChecklistItem, Shift, Site, Task } from "../../types/shiftproof";
import "./StaffHome.css";

const FIX_VISIBLE = 2;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function StaffHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [site, setSite] = useState<Site | null>(null);
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
  const [draftsStatus, setDraftsStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const [fixesExpanded, setFixesExpanded] = useState(false);

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

  const loadDrafts = useCallback(async (userId: string) => {
    setDraftsStatus("loading");
    setDraftsError(null);
    try {
      const rows = await listMyShifts(userId);
      setResumeDraft(pickResumableDraft(rows));
      setDraftsStatus("ready");
    } catch (err) {
      setResumeDraft(null);
      setDraftsError(
        getErrorMessage(err, "Could not load drafts. Try again."),
      );
      setDraftsStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadDrafts(user.$id);
  }, [user, loadDrafts]);

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
    if (!user || draftsStatus !== "ready") return;
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

  return (
    <div
      className="staff-home"
      data-testid="staff-opening"
      data-drafts-status={draftsStatus}
    >
      <div className="app-page stack staff-home-page">
        {!showFixes && !fixLoading ? (
          <div
            className="staff-atmosphere staff-atmosphere--slim"
            aria-hidden="true"
          >
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
        ) : null}

        <header className="staff-head stack-sm">
          <p className="staff-site" data-testid="staff-site">
            {loading
              ? "Loading site…"
              : site
                ? site.name
                : "Site unavailable"}
          </p>
          <h1 id="staff-home-title">Opening check</h1>
          {!loading && items.length > 0 ? (
            <p className="staff-meta caption" aria-label="Check summary">
              <span>{items.length} items</span>
              <span className="staff-meta-dot" aria-hidden>
                ·
              </span>
              <span>~1 min</span>
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

        {draftsError ? (
          <div className="error-banner" role="alert" data-testid="drafts-error">
            {draftsError}
            <button
              type="button"
              className="text-btn"
              onClick={() => user && void loadDrafts(user.$id)}
            >
              Try again
            </button>
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
                    ? `${pendingUnique.length} to re-check`
                    : null}
                  {pendingUnique.length > 0 && waitingUnique.length > 0
                    ? " · "
                    : null}
                  {waitingUnique.length > 0
                    ? `${waitingUnique.length} waiting`
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
                  <div className="staff-fix-body">
                    <Link
                      to={`/staff/shifts/${t.shiftId}`}
                      className="staff-fix-title"
                    >
                      {displayFixTitle(t.title)}
                    </Link>
                    {t.recheckFileId ? (
                      <p className="caption staff-fix-status">
                        Waiting on manager
                      </p>
                    ) : null}
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
          {resumeDraft && pendingUnique.length === 0 ? (
            <p className="staff-cta-hint caption">
              {resumePhotoCount === 0
                ? "Draft waiting — add photos to finish"
                : `${resumePhotoCount} photo${resumePhotoCount === 1 ? "" : "s"} saved · finish and submit`}
            </p>
          ) : null}
          <Button
            fullWidth
            variant={pendingUnique.length > 0 ? "secondary" : "primary"}
            loading={starting}
            disabled={
              loading ||
              draftsStatus !== "ready" ||
              (!resumeDraft && items.length === 0)
            }
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

function displayFixTitle(title: string) {
  return title.replace(/^Fix:\s*/i, "");
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
