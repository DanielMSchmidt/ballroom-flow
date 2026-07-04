import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds default padding. Set false to control padding yourself. */
  padded?: boolean;
  /** Subtle raised shadow. */
  raised?: boolean;
  children: ReactNode;
}

/**
 * Card — the studio-paper surface container (white paper on the
 * charcoal/studio backdrop). Non-interactive by default; for tappable
 * rows use ListRow.
 */
export function Card({ padded = true, raised, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        "rounded-lg border border-border-default bg-surface",
        padded && "p-3.5",
        raised && "shadow-sm",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
