/**
 * C4 + C5 — Manager inbox (API.md manager §1) + Realtime reload.
 * Gap-first list; live rows preferred; demo only when live empty.
 * SOP PDF upload → sop_files + sops.cafe_sop_v1.fileId.
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
import { Link } from "react-router-dom";
import { Button } from "../../components/Button";
import { StatusChip } from "../../components/StatusChip";
import { getErrorMessage } from "../../lib/errors";
import {
  DEMO_REPEAT_OFFENDERS,
  loadManagerInbox,
  loadRepeatOffenders,
  openGapCount,
  shiftsWithOpenGaps,
  subscribeManagerTables,
  type ManagerShiftSummary,
} from "../../lib/manager";
import { useSlowLoading } from "../../lib/loading";
import {
  getSite,
  getSop,
  getSopFileUrl,
  isSopFileReady,
  uploadSopPdf,
} from "../../lib/shifts";
import type { Sop } from "../../types/shiftproof";
import "./ManagerHome.css";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ManagerHome() {
  const [items, setItems] = useState<ManagerShiftSummary[]>([]);
  const [source, setSource] = useState<"live" | "demo">("demo");
  const [siteName, setSiteName] = useState("Demo café");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [liveHint, setLiveHint] = useState<string | null>(null);
  const [repeatOffenders, setRepeatOffenders] = useState<
    { itemId: string; label: string; count: number; of: number }[]
  >([]);

  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);
  const loadingSlow = useSlowLoading(loading);

  const sopInputRef = useRef<HTMLInputElement>(null);
  const [sop, setSop] = useState<Sop | null>(null);
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
      const [inbox, site, offenders] = await Promise.all([
        loadManagerInbox(),
        getSite().catch(() => null),
        loadRepeatOffenders(5).catch(() => DEMO_REPEAT_OFFENDERS),
      ]);
      setItems(inbox.items);
      setSource(inbox.source);
      if (site?.name) setSiteName(site.name);
      setRepeatOffenders(
        offenders.length
          ? offenders
          : inbox.source === "demo"
            ? DEMO_REPEAT_OFFENDERS
            : [],
      );
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load inbox"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await getSop();
        if (!cancelled) {
          setSop(row);
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
      setSopMessage("SOP PDF saved.");
    } catch (err) {
      setSopError(getErrorMessage(err, "Could not upload SOP PDF"));
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

  const gapShifts = useMemo(() => shiftsWithOpenGaps(items), [items]);
  const waitingShifts = useMemo(
    () =>
      items.filter(
        (s) =>
          (s.shift.status === "submitted" || s.shift.status === "scoring") &&
          s.findings.length === 0,
      ),
    [items],
  );
  const defaultList = useMemo(() => {
    if (showAll) return items;
    const gapIds = new Set(gapShifts.map((g) => g.shift.$id));
    const waitingOnly = waitingShifts.filter((w) => !gapIds.has(w.shift.$id));
    return [...gapShifts, ...waitingOnly];
  }, [showAll, items, gapShifts, waitingShifts]);

  const openGaps = openGapCount(items);
  const sopReady = isSopFileReady(sop?.fileId);
  const scoredClean = items.filter(
    (s) =>
      s.shift.status === "scored" &&
      s.gapCount === 0 &&
      s.unclearCount === 0,
  ).length;

  const headline = loading
    ? "Checking shifts…"
    : openGaps === 0
      ? waitingShifts.length > 0
        ? "Checks in progress"
        : "Nothing needs you"
      : openGaps === 1
        ? "1 gap needs a look"
        : `${openGaps} gaps need a look`;

  const lede = loading
    ? "Loading opening checks…"
    : openGaps > 0
      ? "Open gaps first. Tap a shift to review and act."
      : waitingShifts.length > 0
        ? "Staff submitted proof — waiting on scoring."
        : "When staff leave open gaps, they land here first.";

  return (
    <div className="app-page stack manager-home">
      <header className="manager-home-header">
        <div className="manager-home-kicker">
          <p className="manager-site">{siteName}</p>
          {liveHint ? (
            <span className="manager-live-pill" role="status">
              {liveHint}
            </span>
          ) : source === "demo" && !loading ? (
            <span className="manager-live-pill is-sample" role="status">
              Sample data
            </span>
          ) : null}
        </div>
        <h1>{headline}</h1>
        <p className="muted manager-lede">{lede}</p>
      </header>

      {!loading ? (
        <div className="manager-pulse" aria-label="Inbox summary">
          <div className="manager-pulse-item">
            <span className="manager-pulse-value is-gap">{openGaps}</span>
            <span className="manager-pulse-label">Open gaps</span>
          </div>
          <div className="manager-pulse-item">
            <span className="manager-pulse-value is-wait">
              {waitingShifts.length}
            </span>
            <span className="manager-pulse-label">Scoring</span>
          </div>
          <div className="manager-pulse-item">
            <span className="manager-pulse-value">{scoredClean}</span>
            <span className="manager-pulse-label">Clean scores</span>
          </div>
          <div className="manager-pulse-item">
            <span className="manager-pulse-value">{items.length}</span>
            <span className="manager-pulse-label">Shifts</span>
          </div>
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

      <section className="manager-inbox" aria-labelledby="inbox-heading">
        <div className="manager-section-head">
          <h2 id="inbox-heading">
            {showAll ? "All shifts" : "Needs attention"}
          </h2>
          {items.length > 0 ? (
            <button
              type="button"
              className="text-btn manager-filter-btn"
              onClick={() => setShowAll((v) => !v)}
              aria-pressed={showAll}
            >
              {showAll ? "Needs attention" : "Show all"}
            </button>
          ) : null}
        </div>

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
          <div className="manager-empty staff-settle-in">
            <h3>
              {items.length === 0 ? "No opening checks yet" : "All clear"}
            </h3>
            <p className="muted">
              {items.length === 0
                ? "When staff submit an opening check, shifts appear here."
                : "No open gaps. Show all shifts to review clean scores."}
            </p>
            {items.length > 0 ? (
              <button
                type="button"
                className="text-btn is-accent"
                onClick={() => setShowAll(true)}
              >
                Show all shifts
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="list-plain manager-list stagger-in">
            {defaultList.map((row) => (
              <li key={row.shift.$id}>
                <Link
                  to={`/manager/shifts/${row.shift.$id}`}
                  className="manager-row"
                >
                  <div className="manager-row-main">
                    <div className="manager-row-top">
                      <StatusChip status={row.shift.status} />
                      <time className="caption manager-row-when">
                        {formatWhen(
                          row.shift.submittedAt || row.shift.startedAt,
                        )}
                      </time>
                    </div>
                    <p className="manager-row-staff">{row.staffLabel}</p>
                    <div className="manager-row-meta">
                      {row.shift.status === "scoring" ||
                      row.shift.status === "submitted" ? (
                        <span className="manager-meta-wait">
                          {row.findings.length
                            ? `${row.gapCount} gap · ${row.unclearCount} unclear`
                            : "Waiting on score…"}
                        </span>
                      ) : (
                        <>
                          <span
                            className={`manager-pill${row.gapCount > 0 ? " is-gap" : ""}`}
                          >
                            {row.gapCount} Gap
                          </span>
                          <span
                            className={`manager-pill${row.unclearCount > 0 ? " is-unclear" : ""}`}
                          >
                            {row.unclearCount} Unclear
                          </span>
                          {row.passCount > 0 ? (
                            <span className="manager-pill is-pass">
                              {row.passCount} Pass
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                  <span className="manager-row-go" aria-hidden>
                    Review
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!loading && repeatOffenders.length > 0 ? (
        <section
          className="manager-side-block"
          data-testid="repeat-offender"
          aria-labelledby="repeat-heading"
        >
          <h2 id="repeat-heading">Repeat gaps</h2>
          <p className="caption muted">Across recent scored shifts</p>
          <ul className="list-plain repeat-list">
            {repeatOffenders.map((r) => (
              <li key={r.itemId} className="repeat-row">
                <span className="repeat-label">{r.label}</span>
                <span className="repeat-count">
                  {r.count}/{r.of}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className="manager-side-block manager-sop"
        aria-labelledby="sop-heading"
        data-testid="sop-upload"
      >
        <div className="manager-section-head">
          <h2 id="sop-heading">Opening SOP</h2>
          {!sopLoading ? (
            <span
              className={`manager-sop-badge${sopReady ? " is-ready" : " is-missing"}`}
            >
              {sopReady ? "On file" : "Missing"}
            </span>
          ) : null}
        </div>
        {sopLoading ? (
          <p className="caption muted">Loading SOP…</p>
        ) : (
          <>
            <p className="muted manager-sop-status">
              {sop?.title || "Café food-safety SOP"}
              {!sopReady
                ? " — upload a PDF so scoring can cite clauses."
                : null}
            </p>
            <div className="manager-sop-actions">
              <input
                ref={sopInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="manager-sop-file"
                onChange={(e) => void onSopFileChange(e)}
                disabled={sopUploading}
              />
              <Button
                variant={sopReady ? "secondary" : "primary"}
                loading={sopUploading}
                onClick={() => sopInputRef.current?.click()}
              >
                {sopReady ? "Replace PDF" : "Upload PDF"}
              </Button>
              {sopReady && sop?.fileId ? (
                <a
                  className="text-btn"
                  href={getSopFileUrl(sop.fileId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open
                </a>
              ) : null}
            </div>
            {sopMessage ? (
              <p className="manager-sop-toast" role="status">
                {sopMessage}
              </p>
            ) : null}
            {sopError ? (
              <div className="error-banner" role="alert">
                {sopError}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
