export type ConfidenceBand = "High" | "Medium" | "Low";

/** Display-only band from stored Confidence. Low < 0.55, Medium 0.55–0.79, High ≥ 0.80. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.80) return "High";
  if (confidence >= 0.55) return "Medium";
  return "Low";
}
