import { useState } from "react";
import { getEvidencePreviewUrl } from "../lib/shifts";
import "./EvidenceImg.css";

type Props = {
  fileId: string;
  alt: string;
  className?: string;
  /** Export/print must not lazy-load; other surfaces keep the default. */
  eager?: boolean;
};

/** Thumb that falls back when the file 401s or is missing. */
export function EvidenceImg({ fileId, alt, className, eager }: Props) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <span className="evidence-img-missing caption" data-evidence="missing">
        Unavailable
      </span>
    );
  }
  return (
    <img
      src={getEvidencePreviewUrl(fileId)}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      onError={() => setMissing(true)}
    />
  );
}
