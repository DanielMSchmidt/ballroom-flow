import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { ChevronRightIcon } from "./icons";

/** List — a vertical stack of rows with consistent gap. */
export function List({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("flex flex-col gap-2", className)} {...rest}>
      {children}
    </div>
  );
}

export interface ListRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  /** Leading visual (avatar, color swatch, icon). */
  leading?: ReactNode;
  /** Primary line. */
  title: ReactNode;
  /** Secondary line (metadata). */
  subtitle?: ReactNode;
  /** Trailing content (badges, chips); rendered before the chevron. */
  trailing?: ReactNode;
  /** Show the trailing chevron affordance (default true). */
  showChevron?: boolean;
}

/**
 * ListRow — a tappable row (routine, figure, member, journal entry).
 * Always a real <button> so it's keyboard-operable with a visible
 * focus ring (#7); the whole row is the ≥44px hit area (#3). When not
 * interactive, prefer a Card.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  showChevron = true,
  className,
  type = "button",
  ...rest
}: ListRowProps) {
  return (
    <button
      type={type}
      className={cx(
        "flex w-full items-center gap-3 rounded-lg border border-border-default bg-surface",
        "px-3.5 py-3 text-left shadow-sm transition-colors",
        "min-h-[var(--bf-touch-target)] disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      style={{ transitionDuration: "var(--bf-motion-fast)" }}
      {...rest}
    >
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-2xs text-ink-muted">{subtitle}</span>
        )}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>}
      {showChevron && (
        <span aria-hidden="true" className="text-ink-faint">
          <ChevronRightIcon size={16} />
        </span>
      )}
    </button>
  );
}
