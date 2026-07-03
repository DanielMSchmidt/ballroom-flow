import { type ReactNode, useRef } from "react";
import { ScreenHeader } from "./ScreenHeader";
import { useOverlay } from "./useOverlay";

export interface FullScreenProps {
  open: boolean;
  /** The ‹ back control + Escape close this surface. */
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** aria-label for the back button (default "Back"). */
  backLabel?: string;
  /** Right-aligned header actions (IconButtons). */
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * FullScreen — an inner screen that fully covers the app (frame 1.11 figure
 * editor): a sticky {@link ScreenHeader} with a ‹ back control, then a scrolling
 * body. Unlike Sheet/Modal it is NOT a modal-within-modal — it replaces the
 * screen, so opening a figure reads as a navigation, not a stacked dialog.
 *
 * Reuses the overlay plumbing (Escape closes, focus moves in + restores on close,
 * background scroll locked — #7/#16). Height is `100dvh` (not `inset-0`) so deep
 * content is never hidden behind a mobile browser's dynamic toolbar.
 */
export function FullScreen({
  open,
  onClose,
  title,
  subtitle,
  // Default back label is localized by ScreenHeader (undefined passes through).
  backLabel,
  actions,
  children,
}: FullScreenProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay(open, onClose, panelRef);
  if (!open) return null;
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      className="fixed inset-x-0 top-0 flex h-[100dvh] flex-col bg-surface outline-none"
      style={{ zIndex: "var(--bf-z-overlay)" }}
    >
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={onClose}
        backLabel={backLabel}
        actions={actions}
        className="sticky top-0 z-10 bg-surface"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
