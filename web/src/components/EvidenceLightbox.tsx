import { useCallback, useEffect, useRef, useState } from "react";
import "./EvidenceLightbox.css";

export type EvidenceSlide = {
  src: string;
  label?: string;
};

type Props = {
  items: EvidenceSlide[];
  /** Index of the photo that was opened */
  startIndex?: number;
  onClose: () => void;
};

/**
 * Full-screen photo viewer with horizontal snap scroll.
 * Prev/next (or swipe/scroll) moves between uploads without closing.
 * Prefer this over target=_blank Appwrite URLs (session drops in new tabs).
 */
export function EvidenceLightbox({
  items,
  startIndex = 0,
  onClose,
}: Props) {
  const safeItems = items.length > 0 ? items : [];
  const initial = Math.min(
    Math.max(0, startIndex),
    Math.max(0, safeItems.length - 1),
  );
  const [index, setIndex] = useState(initial);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const skipScrollSync = useRef(false);

  const goTo = useCallback(
    (next: number) => {
      if (safeItems.length === 0) return;
      const clamped = Math.min(Math.max(0, next), safeItems.length - 1);
      setIndex(clamped);
      const el = scrollerRef.current;
      if (!el) return;
      skipScrollSync.current = true;
      const slide = el.children[clamped] as HTMLElement | undefined;
      if (slide) {
        el.scrollTo({ left: slide.offsetLeft, behavior: "smooth" });
      }
      window.setTimeout(() => {
        skipScrollSync.current = false;
      }, 350);
    },
    [safeItems.length],
  );

  // Jump to startIndex on open
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || safeItems.length === 0) return;
    const slide = el.children[initial] as HTMLElement | undefined;
    if (slide) {
      el.scrollTo({ left: slide.offsetLeft, behavior: "auto" });
    }
  }, [initial, safeItems.length]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(index + 1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(index - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, goTo, index]);

  function onScroll() {
    if (skipScrollSync.current) return;
    const el = scrollerRef.current;
    if (!el || safeItems.length === 0) return;
    const w = el.clientWidth || 1;
    const i = Math.round(el.scrollLeft / w);
    const clamped = Math.min(Math.max(0, i), safeItems.length - 1);
    if (clamped !== index) setIndex(clamped);
  }

  if (safeItems.length === 0) return null;

  const current = safeItems[index];
  const multi = safeItems.length > 1;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current?.label || "Photos"}
      onClick={onClose}
    >
      <button
        type="button"
        className="lightbox-close"
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>

      {multi ? (
        <p className="lightbox-count" aria-live="polite">
          {index + 1} / {safeItems.length}
        </p>
      ) : null}

      <div
        className="lightbox-stage"
        onClick={(e) => e.stopPropagation()}
      >
        {multi ? (
          <button
            type="button"
            className="lightbox-nav lightbox-nav-prev"
            onClick={() => goTo(index - 1)}
            disabled={index <= 0}
            aria-label="Previous photo"
          >
            ‹
          </button>
        ) : null}

        <div
          ref={scrollerRef}
          className="lightbox-scroller"
          onScroll={onScroll}
        >
          {safeItems.map((item, i) => (
            <div
              key={`${item.src}-${i}`}
              className="lightbox-slide"
              aria-hidden={i !== index}
            >
              <img
                src={item.src}
                alt={item.label || `Photo ${i + 1}`}
                className="lightbox-img"
                draggable={false}
              />
            </div>
          ))}
        </div>

        {multi ? (
          <button
            type="button"
            className="lightbox-nav lightbox-nav-next"
            onClick={() => goTo(index + 1)}
            disabled={index >= safeItems.length - 1}
            aria-label="Next photo"
          >
            ›
          </button>
        ) : null}
      </div>

      {multi ? (
        <div
          className="lightbox-dots"
          role="tablist"
          aria-label="Photos"
          onClick={(e) => e.stopPropagation()}
        >
          {safeItems.map((item, i) => (
            <button
              key={`dot-${item.src}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={`lightbox-dot${i === index ? " is-active" : ""}`}
              aria-label={item.label || `Photo ${i + 1}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
