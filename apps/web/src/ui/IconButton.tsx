import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type IconButtonVariant = "plain" | "filled" | "inverse";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** REQUIRED accessible name — icon-only buttons must be labelled (#8). */
  label: string;
  variant?: IconButtonVariant;
  /** The icon node (decorative; hidden from AT). */
  children: ReactNode;
}

const VARIANTS: Record<IconButtonVariant, string> = {
  plain: "bg-transparent text-ink-secondary",
  filled: "bg-surface-sunken text-ink-secondary",
  inverse: "bg-surface-inverse text-ink-inverse",
};

/**
 * IconButton — a square icon-only control.
 * - Enforces an accessible name via the required `label` prop (#8).
 * - 44×44px hit area even though the glyph is smaller (#3).
 */
export function IconButton({
  label,
  variant = "plain",
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex items-center justify-center rounded-md transition-colors",
        "size-[var(--bf-touch-target)] shrink-0",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
      style={{ transitionDuration: "var(--bf-motion-fast)" }}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
    </button>
  );
}
