import { cx } from "./cx";

export interface SpinnerProps {
  /** px diameter. Default 18. */
  size?: number;
  /** Accessible label; rendered as sr-only text + aria-label. */
  label?: string;
  className?: string;
}

/**
 * Spinner — indeterminate loading indicator (DESIGN-PRINCIPLES #18).
 * Animation is gated by the global reduced-motion rule (#9): it still
 * renders as a static ring, so the busy state stays legible.
 */
export function Spinner({ size = 18, label = "Loading", className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cx("inline-flex items-center justify-center", className)}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ animation: "bf-spin 0.7s linear infinite" }}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="bf-sr-only">{label}</span>
    </span>
  );
}
