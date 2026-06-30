import { cx } from "./cx";

export interface SectionDividerProps {
  label: string;
  className?: string;
}

/**
 * SectionDivider — the uppercase section-label row in the reading view
 * (frame 1.6: "1ST LONG SIDE" followed by a hairline rule that fills the row).
 * The label is a compact, muted, letter-spaced Inconsolata 700 eyebrow; the
 * 1px rule uses the --bf-hairline token and flexes to fill the remaining width.
 */
export function SectionDivider({ label, className }: SectionDividerProps) {
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <span className="text-2xs font-bold uppercase leading-none tracking-wider text-ink-muted">
        {label}
      </span>
      <span
        aria-hidden="true"
        className="h-px flex-1"
        style={{ background: "var(--bf-hairline)" }}
      />
    </div>
  );
}
