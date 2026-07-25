import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
  fullWidth?: boolean;
};

export function Button({
  variant = "primary",
  loading = false,
  children,
  fullWidth,
  className = "",
  disabled,
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${fullWidth ? "btn-full" : ""} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : null}
      <span className={loading ? "btn-label-loading" : undefined}>{children}</span>
    </button>
  );
}
