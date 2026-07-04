import { type ReactNode, useId, useRef } from "react";
import { useMessages } from "../i18n";
import { uiMessages } from "../i18n/messages/ui";
import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { CloseIcon } from "./icons";
import { useOverlay } from "./useOverlay";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Title — also the dialog's accessible name (#8). */
  title: string;
  /** Optional eyebrow line beside the title (e.g. "Waltz · add to 1st Long Side"). */
  meta?: ReactNode;
  children: ReactNode;
}

/**
 * Sheet (BottomSheet) — the primary mobile overlay (add-figure, info,
 * new-choreo, link picker). Slides up from the bottom; on desktop it
 * is centered with a max width so it isn't a stretched mobile sheet
 * (#2). Dialog semantics + Escape/focus handling via useOverlay
 * (#7, #8). Animation is motion-gated (#9).
 */
export function Sheet({ open, onClose, title, meta, children }: SheetProps) {
  const t = useMessages(uiMessages);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlay(open, onClose, panelRef);
  if (!open) return null;

  // Height is the DYNAMIC viewport (dvh), not `inset-0`'s full layout viewport:
  // on mobile the browser toolbar makes innerHeight > dvh, so a `bottom-0` sheet
  // anchored to the layout-viewport bottom pushes its lower content into the dead
  // zone behind the toolbar — unreachable to taps (and to Playwright's
  // scroll-into-view). Anchoring to dvh keeps the sheet's bottom at the visible edge.
  return (
    <div className="fixed inset-x-0 top-0 h-[100dvh]" style={{ zIndex: "var(--bf-z-overlay)" }}>
      {/* scrim */}
      <button
        type="button"
        aria-label={t.close}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(20,18,12,0.35)]"
        style={{ animation: "bf-fade-in var(--bf-motion-base) var(--bf-ease-out)" }}
      />
      {/* panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "absolute inset-x-0 bottom-0 mx-auto max-h-[85dvh] w-full overflow-hidden",
          "rounded-t-xl bg-surface outline-none",
          // desktop: centered card, not a full-bleed bottom sheet (#2)
          "lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:max-w-md",
          "lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-xl",
        )}
        style={{
          zIndex: "var(--bf-z-sheet)",
          boxShadow: "var(--bf-shadow-sheet)",
          animation: "bf-sheet-in var(--bf-motion-slow) var(--bf-ease-out)",
        }}
      >
        <div className="bf-scroll max-h-[85dvh] overflow-y-auto px-4.5 pb-8 pt-3.5">
          {/* grab handle (decorative) */}
          <div
            aria-hidden="true"
            className="mx-auto mb-3.5 h-1 w-9 rounded-pill bg-border-strong lg:hidden"
          />
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id={titleId} className="text-sm font-bold text-ink">
              {title}
            </h2>
            {meta && <span className="text-2xs text-ink-muted">{meta}</span>}
            <IconButton
              label={t.close}
              variant="filled"
              onClick={onClose}
              className="ml-auto lg:flex"
            >
              <CloseIcon size={14} />
            </IconButton>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
