import type { ReactNode } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export interface BadgeProps {
  tone?: BadgeTone;
  /** Optional leading icon (decorative). */
  leading?: ReactNode;
  className?: string;
  children: ReactNode;
}

const TONE: Record<BadgeTone, { bg: string; fg: string; bd: string }> = {
  neutral: {
    bg: "var(--bf-surface-sunken)",
    fg: "var(--bf-ink-secondary)",
    bd: "var(--bf-border-strong)",
  },
  accent: {
    bg: "var(--bf-accent-tint)",
    fg: "var(--bf-accent-ink)",
    bd: "var(--bf-accent-border)",
  },
  success: { bg: "var(--bf-success-tint)", fg: "var(--bf-success-ink)", bd: "var(--bf-success)" },
  warning: {
    bg: "var(--bf-warning-tint)",
    fg: "var(--bf-warning-ink)",
    bd: "var(--bf-warning-border)",
  },
  danger: { bg: "var(--bf-danger-tint)", fg: "var(--bf-danger-ink)", bd: "var(--bf-danger)" },
  info: { bg: "var(--bf-info-tint)", fg: "var(--bf-info-ink)", bd: "var(--bf-accent-border)" },
};

/**
 * Badge — small non-interactive status/count marker. Always carries a
 * text/icon child, so it never relies on color alone (#5).
 */
export function Badge({ tone = "neutral", leading, className, children }: BadgeProps) {
  const t = TONE[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-bold leading-none",
        className,
      )}
      style={{ background: t.bg, color: t.fg, borderColor: t.bd }}
    >
      {leading && (
        <span aria-hidden="true" className="inline-flex">
          {leading}
        </span>
      )}
      {children}
    </span>
  );
}
