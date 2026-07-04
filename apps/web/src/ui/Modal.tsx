import { type ReactNode, useId, useRef } from "react";
import { useMessages } from "../i18n";
import { uiMessages } from "../i18n/messages/ui";
import { Button, type ButtonVariant } from "./Button";
import { cx } from "./cx";
import { useOverlay } from "./useOverlay";

export interface ModalAction {
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Body content (description, form). */
  children?: ReactNode;
  /** Confirm/primary action. */
  confirm?: ModalAction;
  /** Cancel/secondary action. Defaults to a "Cancel" that calls onClose. */
  cancel?: Partial<ModalAction>;
}

/**
 * Modal / Dialog — centered confirm dialog. Used for destructive
 * confirms (delete routine/section/figure — #28) and short forms.
 * Same a11y plumbing as Sheet (#7, #8); motion-gated (#9).
 */
export function Modal({ open, onClose, title, children, confirm, cancel }: ModalProps) {
  const t = useMessages(uiMessages);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useOverlay(open, onClose, panelRef);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: "var(--bf-z-overlay)" }}
    >
      <button
        type="button"
        aria-label={t.close}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(20,18,12,0.4)]"
        style={{ animation: "bf-fade-in var(--bf-motion-base) var(--bf-ease-out)" }}
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={children ? descId : undefined}
        tabIndex={-1}
        className={cx("relative w-full max-w-sm rounded-xl bg-surface p-5 outline-none")}
        style={{
          zIndex: "var(--bf-z-sheet)",
          boxShadow: "var(--bf-shadow-md)",
          animation: "bf-pop-in var(--bf-motion-base) var(--bf-ease-out)",
        }}
      >
        <h2 id={titleId} className="text-md font-bold text-ink">
          {title}
        </h2>
        {children && (
          <div id={descId} className="mt-2 text-sm text-ink-secondary">
            {children}
          </div>
        )}
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" fullWidth onClick={cancel?.onClick ?? onClose}>
            {cancel?.label ?? t.cancel}
          </Button>
          {confirm && (
            <Button
              variant={confirm.variant ?? "primary"}
              fullWidth
              loading={confirm.loading}
              onClick={confirm.onClick}
            >
              {confirm.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
