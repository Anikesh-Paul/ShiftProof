import { useState } from "react";
import { getEvidencePreviewUrl } from "../lib/shifts";
import "./EvidenceImg.css";

type Props = {
  fileId: string;
  alt: string;
  className?: string;
};

/** Thumb that falls back when the file 401s or is missing. */
export function EvidenceImg({ fileId, alt, className }: Props) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return <span className="evidence-img-missing caption">Unavailable</span>;
  }
  return (
    <img
      src={getEvidencePreviewUrl(fileId)}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setMissing(true)}
    />
  );
}
