import { cx } from "./cx";

export interface CountLabelProps {
  /**
   * The already-formatted count label, e.g. "1", "&", "2", "3a".
   * Float conversion (e=.25, &=.5, a=.75, modulo the dance phrase)
   * lives in packages/domain — this is the PRESENTATIONAL seam only
   * (DESIGN-PRINCIPLES #27). Pass the domain's formatted string here;
   * never raw decimals.
   */
  value: string;
  className?: string;
}

/**
 * CountLabel — renders a beat-count chip in the accent style used for
 * the step count throughout the timeline. Purely presentational: it
 * does not interpret the value. The conversion seam keeps the domain
 * (packages/domain) as the single source of float-count truth.
 */
export function CountLabel({ value, className }: CountLabelProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center justify-center rounded-sm bg-accent-tint px-1.5 py-0.5",
        "text-xs font-bold tabular-nums text-accent-ink",
        className,
      )}
    >
      {value}
    </span>
  );
}
