import { cx } from "./cx";
import { ChevronDownIcon, ChevronRightIcon } from "./icons";

export interface SectionDividerProps {
  label: string;
  className?: string;
  /** Collapse toggle (Builder v3 reading view: tap the divider → fold the
   *  section). Providing `onToggle` turns the chevron+label into a button;
   *  plain callers (FigureLibrary) omit it and keep the static eyebrow row. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** Accessible name for the toggle ("Collapse {label}" / "Expand {label}") —
   *  required whenever `onToggle` is set. */
  toggleLabel?: string;
  /** Muted meta after the rule (the design's "3 figs" while collapsed). */
  meta?: string;
}

/**
 * SectionDivider — the uppercase section-label row in the reading view
 * (frame 1.6: "1ST LONG SIDE" followed by a hairline rule that fills the row).
 * The label is a compact, muted, letter-spaced Inconsolata 700 eyebrow; the
 * 1px rule uses the --bf-hairline token and flexes to fill the remaining width.
 * With `onToggle` it gains the Builder-v3 ▾/▸ collapse affordance.
 */
export function SectionDivider({
  label,
  className,
  collapsed = false,
  onToggle,
  toggleLabel,
  meta,
}: SectionDividerProps) {
  const eyebrow = (
    <span className="text-2xs font-bold uppercase leading-none tracking-wider text-ink-muted">
      {label}
    </span>
  );
  return (
    <div className={cx("flex items-center gap-2", className)}>
      {onToggle ? (
        <button
          type="button"
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex min-w-0 items-center gap-2 py-1 text-left"
        >
          <span aria-hidden="true" className="flex-none text-ink-muted">
            {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
          </span>
          {eyebrow}
        </button>
      ) : (
        eyebrow
      )}
      <span
        aria-hidden="true"
        className="h-px flex-1"
        style={{ background: "var(--bf-hairline)" }}
      />
      {meta && (
        <span className="flex-none whitespace-nowrap text-2xs font-semibold text-ink-faint">
          {meta}
        </span>
      )}
    </div>
  );
}
