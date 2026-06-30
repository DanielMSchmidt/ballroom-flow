import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import type { AttributeKind } from "./tokens";

export type ChipTone = "neutral" | "accent" | AttributeKind;

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Color family. Attribute kinds tint to their token color. */
  tone?: ChipTone;
  /** Selected/active visual + aria-pressed (the "pick one" pattern). */
  selected?: boolean;
  /** Render as a static label (span) instead of a toggle button. */
  asStatic?: boolean;
  /** Optional leading dot/icon — keeps color from being the only cue (#5). */
  leading?: ReactNode;
  children: ReactNode;
}

// Token-driven tint/ink/border per tone. Attribute kinds reuse the
// --bf-kind-* families so a chip always matches its lane (#22, #24).
const TONE_STYLE: Record<ChipTone, { tint: string; ink: string; border: string; solid: string }> = {
  neutral: {
    tint: "var(--bf-surface-sunken)",
    ink: "var(--bf-ink-secondary)",
    border: "var(--bf-border-strong)",
    solid: "var(--bf-ink)",
  },
  accent: {
    tint: "var(--bf-accent-tint)",
    ink: "var(--bf-accent-ink)",
    border: "var(--bf-accent-border)",
    solid: "var(--bf-accent)",
  },
  direction: {
    tint: "var(--bf-kind-direction-tint)",
    ink: "var(--bf-kind-direction-ink)",
    border: "var(--bf-kind-direction-border)",
    solid: "var(--bf-kind-direction)",
  },
  footwork: {
    tint: "var(--bf-kind-footwork-tint)",
    ink: "var(--bf-kind-footwork-ink)",
    border: "var(--bf-kind-footwork-border)",
    solid: "var(--bf-kind-footwork)",
  },
  footPosition: {
    tint: "var(--bf-kind-footPosition-tint)",
    ink: "var(--bf-kind-footPosition-ink)",
    border: "var(--bf-kind-footPosition-border)",
    solid: "var(--bf-kind-footPosition)",
  },
  rise: {
    tint: "var(--bf-kind-rise-tint)",
    ink: "var(--bf-kind-rise-ink)",
    border: "var(--bf-kind-rise-border)",
    solid: "var(--bf-kind-rise)",
  },
  position: {
    tint: "var(--bf-kind-position-tint)",
    ink: "var(--bf-kind-position-ink)",
    border: "var(--bf-kind-position-border)",
    solid: "var(--bf-kind-position)",
  },
  sway: {
    tint: "var(--bf-kind-sway-tint)",
    ink: "var(--bf-kind-sway-ink)",
    border: "var(--bf-kind-sway-border)",
    solid: "var(--bf-kind-sway)",
  },
  turn: {
    tint: "var(--bf-kind-turn-tint)",
    ink: "var(--bf-kind-turn-ink)",
    border: "var(--bf-kind-turn-border)",
    solid: "var(--bf-kind-turn)",
  },
};

/**
 * Chip / Tag — compact label or single-select toggle.
 * - As a toggle (default) it's a real button: keyboard-operable (#7),
 *   sets `aria-pressed`, and has a ≥44px hit area via min-height.
 * - `asStatic` renders a non-interactive span for read-only tags.
 */
export function Chip({
  tone = "neutral",
  selected,
  asStatic,
  leading,
  className,
  children,
  type = "button",
  ...rest
}: ChipProps) {
  const t = TONE_STYLE[tone];
  const style = selected
    ? { background: t.solid, color: "var(--bf-ink-inverse)", borderColor: t.solid }
    : { background: t.tint, color: t.ink, borderColor: t.border };

  const content = (
    <>
      {leading && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {leading}
        </span>
      )}
      <span>{children}</span>
    </>
  );

  const classes = cx(
    "inline-flex items-center gap-1.5 rounded-pill border text-xs font-semibold",
    "px-3 py-1.5 leading-none",
    !asStatic && "min-h-[var(--bf-touch-target)] cursor-pointer transition-colors",
    className,
  );

  if (asStatic) {
    return (
      <span className={classes} style={style}>
        {content}
      </span>
    );
  }

  return (
    <button
      type={type}
      aria-pressed={selected || undefined}
      className={classes}
      style={{ ...style, transitionDuration: "var(--bf-motion-fast)" }}
      {...rest}
    >
      {content}
    </button>
  );
}
