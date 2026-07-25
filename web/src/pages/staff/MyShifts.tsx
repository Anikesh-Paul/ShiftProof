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
import { listMyShifts, parsePhotoFileIds } from "../../lib/shifts";
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

  // Latest draft only keeps accent CTA — restraint on repeated ember links
  const primaryDraftId =
    shifts.find((s) => s.status === "draft")?.$id ?? null;

  return (
    <div className="app-page stack">
      <header className="stack-sm">
        <h1>History</h1>
        <p className="muted">Your opening checks at this site.</p>
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
      ) : shifts.length === 0 ? (
        <div className="card stack-sm staff-settle-in">
          <h2>No shifts yet</h2>
          <p className="muted">
            Start an opening check, upload 3–8 photos, and submit proof.
          </p>
          <Link to="/staff" className="text-btn is-accent">
            Go to opening
          </Link>
        </div>
      ) : (
        <ul className="list-plain shift-list stagger-in">
          {shifts.map((shift) => {
            const count = parsePhotoFileIds(shift.photoFileIds).length;
            const when = formatWhen(shift.startedAt);
            const isDraft = shift.status === "draft";
            const isPrimaryDraft = isDraft && shift.$id === primaryDraftId;
            const statusLine =
              shift.status === "draft"
                ? "Draft — continue photos"
                : shift.status === "submitted" || shift.status === "scoring"
                  ? "Submitted · scoring job waiting"
                  : shift.status === "scored"
                    ? "Scored — manager can review"
                    : shift.status;
            // Staff can always open: draft to edit, submitted+ to review photos
            const actionLabel = isDraft
              ? "Continue draft"
              : count > 0
                ? "View photos"
                : "View shift";

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
                      {actionLabel}
                    </span>
                  ) : (
                    <>
                      <p className="caption">{statusLine}</p>
                      <span className="shift-link">{actionLabel}</span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
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
