import { useEffect, useRef, useState } from "react";
import { getEvidencePreviewUrl } from "../lib/shifts";
import "./EvidenceImg.css";

export const PHOTO_UNAVAILABLE = "Photo unavailable";
export const PHOTO_UNAVAILABLE_HINT =
  "Photo unavailable — ask staff to resubmit";

const EAGER_WAIT_MS = 6000;

type Props = {
  fileId: string;
  alt: string;
  className?: string;
  /** Export/print must not lazy-load; other surfaces keep the default. */
  eager?: boolean;
  /** 40px thumbs — short label. Gallery / export use the full sentence. */
  compact?: boolean;
  onMissingChange?: (fileId: string, missing: boolean) => void;
};

/** Thumb that falls back when the file 401s, is empty, or never decodes. */
export function EvidenceImg({
  fileId,
  alt,
  className,
  eager,
  compact,
  onMissingChange,
}: Props) {
  const [missing, setMissing] = useState(!fileId.trim());
  const [ready, setReady] = useState(!eager);
  const onMissingRef = useRef(onMissingChange);
  onMissingRef.current = onMissingChange;

  useEffect(() => {
    if (!fileId.trim()) {
      setMissing(true);
      setReady(false);
      onMissingRef.current?.(fileId, true);
      return;
    }
    setMissing(false);
    setReady(!eager);

    if (!eager) return;

    let cancelled = false;
    const url = getEvidencePreviewUrl(fileId);
    const fail = () => {
      if (cancelled) return;
      setMissing(true);
      setReady(false);
      onMissingRef.current?.(fileId, true);
    };
    const ok = (width: number) => {
      if (cancelled) return;
      if (width < 1) {
        fail();
        return;
      }
      setMissing(false);
      setReady(true);
    };

    const probe = new Image();
    const timer = window.setTimeout(fail, EAGER_WAIT_MS);
    probe.onload = () => {
      window.clearTimeout(timer);
      ok(probe.naturalWidth);
    };
    probe.onerror = () => {
      window.clearTimeout(timer);
      fail();
    };
    probe.src = url;
    void probe
      .decode()
      .then(() => {
        window.clearTimeout(timer);
        ok(probe.naturalWidth);
      })
      .catch(() => {
        window.clearTimeout(timer);
        fail();
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileId, eager]);

  if (missing) {
    return (
      <span
        className={`evidence-img-missing caption${compact ? " is-compact" : ""}`}
        data-evidence="missing"
        role="img"
        aria-label={PHOTO_UNAVAILABLE_HINT}
      >
        {compact ? PHOTO_UNAVAILABLE : PHOTO_UNAVAILABLE_HINT}
      </span>
    );
  }

  if (eager && !ready) {
    return (
      <span
        className={`evidence-img-missing${compact ? " is-compact" : ""}`}
        data-evidence="pending"
        aria-hidden
      />
    );
  }

  return (
    <img
      src={getEvidencePreviewUrl(fileId)}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth < 1) {
          setMissing(true);
          onMissingRef.current?.(fileId, true);
        }
      }}
      onError={() => {
        setMissing(true);
        onMissingRef.current?.(fileId, true);
      }}
    />
  );
}
