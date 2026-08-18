/**
 * C2 — List own shifts (docs/API.md staff §5).
 */
import {
  useEffect,
  useState,
  type AnimationEvent,
} from "react";
import { Link } from "react-router-dom";
import { StatusChip } from "../../components/StatusChip";
import { useAuth } from "../../lib/auth";
import { getErrorMessage } from "../../lib/errors";
import { useSlowLoading } from "../../lib/loading";
import {
  deleteDraftShift,
  isEmptyDraft,
  listMyShifts,
  parsePhotoFileIds,
  pickResumableDraft,
} from "../../lib/shifts";
import type { Shift } from "../../types/shiftproof";
import "./MyShifts.css";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MyShifts() {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [filter, setFilter] = useState<"needs" | "done" | "all">("needs");
  const loadingSlow = useSlowLoading(loading);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listMyShifts(user.$id);
        if (!cancelled) setShifts(rows);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, "Could not load shifts"));
      } finally {
        if (!cancelled) setLoading(false);
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

  const resumeDraft = pickResumableDraft(shifts);
  const leftoverEmpty = shifts.filter(
    (s) => isEmptyDraft(s) && s.$id !== resumeDraft?.$id,
  );
  const visibleShifts = shifts.filter((s) => {
    if (leftoverEmpty.some((d) => d.$id === s.$id)) return false;
    if (filter === "all") return true;
    if (filter === "needs") {
      return (
        s.status === "draft" ||
        s.status === "submitted" ||
        s.status === "scoring"
      );
    }
    return s.status === "scored" || s.status === "closed";
  });
  const needsCount = shifts.filter(
    (s) =>
      !leftoverEmpty.some((d) => d.$id === s.$id) &&
      (s.status === "draft" ||
        s.status === "submitted" ||
        s.status === "scoring"),
  ).length;
  const doneCount = shifts.filter(
    (s) => s.status === "scored" || s.status === "closed",
  ).length;
  // Latest resumable draft only keeps accent CTA — restraint on repeated ember links
  const primaryDraftId = resumeDraft?.$id ?? null;

  async function discardLeftoverEmpty() {
    if (!leftoverEmpty.length) return;
    setDiscarding(true);
    setError(null);
    const results = await Promise.allSettled(
      leftoverEmpty.map((s) => deleteDraftShift(s.$id)),
    );
    const deleted = new Set(
      leftoverEmpty
        .filter((_, i) => results[i]?.status === "fulfilled")
        .map((s) => s.$id),
    );
    if (deleted.size) {
      setShifts((prev) => prev.filter((s) => !deleted.has(s.$id)));
    }
    if (results.some((r) => r.status === "rejected")) {
      setError("Not everything could be discarded");
    }
    setDiscarding(false);
  }

  return (
    <div className="app-page stack">
      <header className="stack-sm">
        <h1>History</h1>
        <div className="history-filters" role="tablist" aria-label="Filter history">
          {(
            [
              ["needs", `Needs me (${needsCount})`],
              ["done", `Done (${doneCount})`],
              ["all", "All"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`history-filter${filter === id ? " is-active" : ""}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
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

      {loading ? (
        <div className="stack-sm">
          <ul className="list-plain shift-list" aria-busy>
            {[0, 1].map((i) => (
              <li
                key={i}
                className="skeleton-card"
                style={{ minHeight: "5rem" }}
              />
            ))}
          </ul>
          {loadingSlow ? (
            <p className="loading-slow-hint" role="status">
              Still loading history…
            </p>
          ) : null}
        </div>
      ) : visibleShifts.length === 0 && leftoverEmpty.length === 0 ? (
        <div className="card stack-sm staff-settle-in">
          <h2>
            {filter === "needs"
              ? "Nothing needs you"
              : filter === "done"
                ? "No scored checks yet"
                : "No shifts yet"}
          </h2>
          <p className="muted">
            {filter === "needs"
              ? "Drafts and in-progress scores show here. Scored checks are under Done."
              : "Start an opening check, upload 3–8 photos, and submit proof."}
          </p>
          <Link to="/staff" className="text-btn is-accent">
            Go to opening
          </Link>
        </div>
      ) : (
        <div className="stack">
        {leftoverEmpty.length > 0 ? (
          <p
            className="caption history-clutter"
            data-testid="history-leftover"
            data-leftover-ids={leftoverEmpty.map((s) => s.$id).join(" ")}
          >
            {leftoverEmpty.length} leftover empty draft
            {leftoverEmpty.length === 1 ? "" : "s"}
            <button
              type="button"
              className="text-btn"
              disabled={discarding}
              onClick={() => void discardLeftoverEmpty()}
            >
              {discarding ? "Discarding…" : "Discard"}
            </button>
          </p>
        ) : null}
        <ul className="list-plain shift-list stagger-in">
          {visibleShifts.map((shift) => {
            const count = parsePhotoFileIds(shift.photoFileIds).length;
            const when = formatWhen(shift.startedAt);
            const isDraft = shift.status === "draft";
            const isPrimaryDraft = isDraft && shift.$id === primaryDraftId;
            const stuck =
              (shift.status === "submitted" || shift.status === "scoring") &&
              isStuckScoring(shift);

            return (
              <li key={shift.$id}>
                <Link
                  to={`/staff/shifts/${shift.$id}`}
                  className="shift-row card shift-row-link"
                >
                  <div className="shift-row-top">
                    <StatusChip status={shift.status} />
                    <span className="caption">
                      {count} photo{count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="shift-when">{when}</p>
                  {isDraft ? (
                    <span
                      className={`shift-link${isPrimaryDraft ? " is-primary" : ""}`}
                    >
                      Continue draft
                    </span>
                  ) : stuck ? (
                    <p className="caption">Scoring stuck</p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
        </div>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function isStuckScoring(shift: Shift): boolean {
  if (shift.status !== "submitted" && shift.status !== "scoring") return false;
  const raw = shift.submittedAt || shift.startedAt;
  const then = Date.parse(raw);
  if (!Number.isFinite(then)) return false;
  return Date.now() - then > 90_000;
}
