import type { ReactNode } from "react";
import { cx } from "./cx";

export interface EmptyStateProps {
  /** Decorative icon. */
  icon?: ReactNode;
  title: string;
  /** Guiding description — handwritten note voice fits here. */
  description?: ReactNode;
  /** Primary + optional secondary actions guiding the next step (#19). */
  actions?: ReactNode;
  className?: string;
}

/**
 * EmptyState — a designed, guiding empty state for any list/collection
 * (DESIGN-PRINCIPLES #19). Never a blank area: it names the next action.
 */
export function EmptyState({ icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong",
        "bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="text-ink-faint">
          {icon}
        </span>
      )}
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {description && (
        <p
          className="max-w-xs text-ink-secondary"
          style={{
            fontFamily: "var(--bf-font-note)",
            fontSize: "var(--bf-text-md)",
            lineHeight: "var(--bf-leading-normal)",
          }}
        >
          {description}
        </p>
      )}
      {actions && (
        <div className="mt-1 flex flex-col items-stretch gap-2 self-stretch">{actions}</div>
      )}
    </div>
  );
}
