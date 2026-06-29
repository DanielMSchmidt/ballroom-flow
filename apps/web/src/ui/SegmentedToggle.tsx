// biome-ignore-all lint/a11y/useSemanticElements: a native <input type="radio">
// can't host the segmented fill + ≥44px touch-target styling; we implement the
// ARIA radiogroup pattern on buttons (roving focus + Arrow keys) instead.
import { cx } from "./cx";

export interface SegmentedToggleProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible group label (announced on the radiogroup). */
  ariaLabel: string;
  className?: string;
}

/**
 * SegmentedToggle — a small two/few-option segmented control (frame 1.6
 * "STEPS FOR [Leader|Follower]"). The selected segment fills with studio-blue
 * and shows white text; the rest are blue text on transparent inside a
 * 1.5px blue-tinted rounded border.
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
  className,
}: SegmentedToggleProps<T>) {
  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + options.length) % options.length;
    const opt = options[next];
    if (opt) onChange(opt.value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(
        "inline-flex overflow-hidden rounded-md border-[1.5px] border-accent-border",
        className,
      )}
    >
      {options.map((opt, idx) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={cx(
              "inline-flex min-h-[var(--bf-touch-target)] items-center justify-center",
              "px-3 text-xs font-bold transition-colors",
              selected ? "bg-accent text-ink-inverse" : "bg-transparent text-accent",
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
