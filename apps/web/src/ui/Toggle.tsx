import { useId } from "react";
import { cx } from "./cx";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible label. Visible unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Toggle / Switch — boolean control built as an accessible
 * `role="switch"` button (#7, #8). 44px hit area; the track/knob
 * transition is motion-gated (#9).
 */
export function Toggle({ checked, onChange, label, hideLabel, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill border transition-colors",
          // keep a 44px hit area without a 44px track
          "before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          checked ? "bg-accent border-accent" : "bg-surface-sunken border-border-strong",
        )}
        style={{ transitionDuration: "var(--bf-motion-fast)" }}
      >
        <span
          aria-hidden="true"
          className={cx(
            "inline-block size-5 rounded-round bg-surface shadow-sm transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
          style={{ transitionDuration: "var(--bf-motion-fast)" }}
        />
      </button>
      {!hideLabel && (
        <label htmlFor={id} className="cursor-pointer text-sm text-ink-secondary select-none">
          {label}
        </label>
      )}
    </span>
  );
}
