import { useEffect, useState } from "react";
import { getEvidencePreviewUrl } from "../lib/shifts";
import "./EvidenceImg.css";

export const PHOTO_UNAVAILABLE = "Photo unavailable";
export const PHOTO_UNAVAILABLE_HINT =
  "Photo unavailable — ask staff to resubmit";

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

/** Thumb that falls back when the file 401s or is missing. */
export function EvidenceImg({
  fileId,
  alt,
  className,
  eager,
  compact,
  onMissingChange,
}: Props) {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
  }, [fileId]);

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
  return (
    <img
      src={getEvidencePreviewUrl(fileId)}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      onError={() => {
        setMissing(true);
        onMissingChange?.(fileId, true);
      }}
    />
  );
}
