import type { ReactNode } from "react";
import { cx } from "./cx";
import { IconButton } from "./IconButton";

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Renders a ‹ back IconButton when provided. */
  onBack?: () => void;
  /** aria-label for the back button (default "Back"). */
  backLabel?: string;
  /** Right-aligned action buttons — use IconButton. */
  actions?: ReactNode;
  className?: string;
}

/**
 * ScreenHeader — compact per-screen header for inner screens (frame 1.6).
 * A ‹ back control on the left, a stacked title + small muted subtitle, and
 * trailing action slots on the right. Does not position itself, so a caller
 * can make it sticky. Every control honors the ≥44px touch target via
 * IconButton (#3, #8).
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backLabel = "Back",
  actions,
  className,
}: ScreenHeaderProps) {
  return (
    <div
      className={cx("flex items-center gap-2 border-b border-border-subtle px-3 py-1", className)}
    >
      {onBack && (
        <IconButton label={backLabel} onClick={onBack}>
          <span className="text-lg leading-none">‹</span>
        </IconButton>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-bold leading-tight text-ink">{title}</h1>
        {subtitle && (
          <div className="truncate text-2xs font-medium leading-tight text-ink-muted">
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
