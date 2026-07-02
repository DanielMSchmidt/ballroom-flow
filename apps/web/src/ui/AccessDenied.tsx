import type { ReactNode } from "react";
import { cx } from "./cx";
import { WarningIcon } from "./icons";

export interface AccessDeniedProps {
  /** Override the default title. */
  title?: string;
  description?: ReactNode;
  /** Optional action (e.g. "Back to your choreos"). */
  action?: ReactNode;
  className?: string;
}

/**
 * AccessDenied — the calm, explicit "you don't have access" state shown when the
 * per-document permission boundary (US-021) denies the viewer. It is deliberately
 * VISUALLY DISTINCT from {@link OfflineState} (DESIGN-PRINCIPLES #20: don't conflate
 * denied with offline): denied is a settled, neutral state — not a transient
 * connectivity problem and not an alarming error the user can retry away. Uses the
 * raised neutral surface (not the desaturated offline tint) so the two read apart.
 */
export function AccessDenied({ title, description, action, className }: AccessDeniedProps) {
  return (
    <div
      role="alert"
      className={cx(
        "flex flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center",
        className,
      )}
      style={{
        background: "var(--bf-surface-raised)",
        borderColor: "var(--bf-border-strong)",
        color: "var(--bf-ink)",
      }}
    >
      <span aria-hidden="true" style={{ color: "var(--bf-ink-muted)" }}>
        <WarningIcon size={28} />
      </span>
      <h3 className="text-sm font-bold">{title ?? "You don't have access"}</h3>
      <p className="max-w-xs text-2xs" style={{ color: "var(--bf-ink-secondary)" }}>
        {description ??
          "You're not a member of this choreo, so it can't be opened. Ask the owner for an invite link to join."}
      </p>
      {action}
    </div>
  );
}
