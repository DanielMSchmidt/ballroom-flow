import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useMessages } from "../i18n";
import { uiMessages } from "../i18n/messages/ui";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to fill the container width (common for thumb-zone CTAs). */
  fullWidth?: boolean;
  /** Show a spinner and mark the control busy; also disables it. */
  loading?: boolean;
  /** Optional leading icon (decorative; hidden from AT). */
  leadingIcon?: ReactNode;
  children: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  // charcoal primary — matches the prototype's #1c1c1e CTAs
  primary: "bg-surface-inverse text-ink-inverse border border-transparent",
  secondary: "bg-surface text-ink-secondary border border-border-strong",
  ghost: "bg-transparent text-accent border border-transparent",
  danger: "bg-danger text-ink-inverse border border-transparent",
};

const SIZES: Record<ButtonSize, string> = {
  // both honor the 44px min touch target via min-height (#3)
  sm: "text-xs px-3 gap-1.5",
  md: "text-sm px-4 gap-2",
};

/**
 * Button — primary action control.
 * - ≥44px effective hit area via `min-height` (DESIGN-PRINCIPLES #3).
 * - Visible focus ring inherited from the global :focus-visible rule (#7).
 * - `loading` sets aria-busy and swaps in a Spinner without losing width.
 */
export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  loading,
  leadingIcon,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const t = useMessages(uiMessages);
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center rounded-md font-bold leading-none",
        "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        "min-h-[var(--bf-touch-target)]",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      style={{ transitionDuration: "var(--bf-motion-fast)" }}
      {...rest}
    >
      {loading ? (
        <Spinner size={16} label={t.working} />
      ) : (
        leadingIcon && (
          <span aria-hidden="true" className="inline-flex">
            {leadingIcon}
          </span>
        )
      )}
      <span>{children}</span>
    </button>
  );
}
