// biome-ignore-all lint/a11y/useSemanticElements: a native <input type="radio">
// can't host the segmented fill + ≥44px touch-target styling; we implement the
// ARIA radiogroup pattern on buttons (roving focus + Arrow keys) instead.
import { useRef } from "react";
import { cx } from "./cx";

export interface SegmentedToggleProps<T extends string> {
  /** `ariaLabel` gives a compact segment (e.g. "L") its full accessible name
   *  ("Leader") so the visual abbreviation is never the only name (#5, #8). */
  options: { value: T; label: string; ariaLabel?: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible group label (announced on the radiogroup). */
  ariaLabel: string;
  /** "solid" (default) — the frame-1.6 studio-blue fill. "muted" — the compact
   *  header variant (design 1.23 "L · F"): accent-tinted selected segment,
   *  faint unselected text, neutral border. */
  tone?: "solid" | "muted";
  className?: string;
}

/**
 * SegmentedToggle — a small two/few-option segmented control (frame 1.6
 * "STEPS FOR [Leader|Follower]"). The selected segment fills with studio-blue
 * and shows white text; the rest are blue text on transparent inside a
 * 1.5px blue-tinted rounded border. The `muted` tone is the compact header
 * variant (design 1.23): selected = accent text on the accent tint.
 *
 * A11y mirrors the radiogroup pattern: roving focus (only the selected radio
 * is tabbable) with Arrow keys moving the selection (#7, #8). State is carried
 * by fill + weight, not color alone (#5).
 */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  tone = "solid",
  className,
}: SegmentedToggleProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + options.length) % options.length;
    const opt = options[next];
    if (!opt) return;
    onChange(opt.value);
    // Roving focus: move DOM focus to the now-selected segment so keyboard
    // users stay on the active radio (ARIA radiogroup pattern, #7).
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(
        "inline-flex overflow-hidden rounded-md border-[1.5px]",
        tone === "muted" ? "border-border-strong" : "border-accent-border",
        className,
      )}
    >
      {options.map((opt, idx) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttons.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.ariaLabel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={cx(
              "inline-flex min-h-[var(--bf-touch-target)] items-center justify-center",
              "px-3 text-xs font-bold transition-colors",
              tone === "muted"
                ? selected
                  ? "bg-accent-tint text-accent"
                  : "bg-transparent text-ink-faint"
                : selected
                  ? "bg-accent text-ink-inverse"
                  : "bg-transparent text-accent",
            )}
            style={{ transitionDuration: "var(--bf-motion-fast)" }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
