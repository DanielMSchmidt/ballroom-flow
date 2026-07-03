import type { ReactNode } from "react";
import { useMessages } from "../i18n";
import { uiMessages } from "../i18n/messages/ui";
import { cx } from "./cx";
import { OfflineIcon } from "./icons";

export interface OfflineStateProps {
  /** Override the default title. */
  title?: string;
  description?: ReactNode;
  /** Optional retry action. */
  action?: ReactNode;
  className?: string;
}

/**
 * OfflineState — the honest "you're offline" DATA state
 * (DESIGN-PRINCIPLES #20). The installed shell is interactive; this
 * communicates that document data needs connectivity (the document's
 * DO) rather than presenting stale data as live or hanging silently.
 * Uses the desaturated `offline` tokens so it reads as "not live".
 */
export function OfflineState({ title, description, action, className }: OfflineStateProps) {
  const t = useMessages(uiMessages);
  return (
    <div
      role="status"
      className={cx(
        "flex flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center",
        className,
      )}
      style={{
        background: "var(--bf-offline-tint)",
        borderColor: "var(--bf-offline)",
        color: "var(--bf-offline-ink)",
      }}
    >
      <span aria-hidden="true">
        <OfflineIcon size={28} />
      </span>
      <h3 className="text-sm font-bold">{title ?? t.offlineTitle}</h3>
      <p className="max-w-xs text-2xs">{description ?? t.offlineDescription}</p>
      {action}
    </div>
  );
}
