import { IconButton } from "./IconButton";

export interface StepperProps {
  /** Accessible group name, e.g. "Bars" (also the visible unit when `unit` is set). */
  label: string;
  value: number;
  /** Inclusive bounds; the matching control disables at each end. */
  min?: number;
  max?: number;
  /** Step per press (default 1). */
  step?: number;
  onChange: (next: number) => void;
  /** Trailing unit rendered after the value, e.g. "bars" → "3 bars". */
  unit?: string;
  /** Hide the leading `label` text (still the group's accessible name). */
  hideLabel?: boolean;
}

/**
 * Stepper — a compact − value + numeric control (frame 1.11 "− N bars +"). Two
 * IconButtons flank a live value; each honors the ≥44px touch target (#3) and
 * disables at its bound. The value is an aria-live region so a screen reader
 * announces the new count on each press. Used for a figure's bar count (creation
 * + editor header) and any other bounded integer.
 */
export function Stepper({
  label,
  value,
  min = 1,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  onChange,
  unit,
  hideLabel = false,
}: StepperProps) {
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a stepper is two real <button>s around a value; role="group" labels the set without a <fieldset>'s form semantics.
    <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
      {!hideLabel && (
        <span className="mr-1 text-2xs font-bold uppercase tracking-wider text-ink-muted">
          {label}
        </span>
      )}
      <IconButton
        label={`Decrease ${label.toLowerCase()}`}
        variant="filled"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        <span className="text-base leading-none">−</span>
      </IconButton>
      <span
        aria-live="polite"
        className="min-w-[3.5ch] text-center text-sm font-bold tabular-nums text-ink"
      >
        {value}
        {unit ? ` ${unit}` : ""}
      </span>
      <IconButton
        label={`Increase ${label.toLowerCase()}`}
        variant="filled"
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        <span className="text-base leading-none">+</span>
      </IconButton>
    </div>
  );
}
