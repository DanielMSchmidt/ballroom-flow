import { type RefObject, useEffect, useRef } from "react";

/**
 * Shared overlay behavior for Sheet / Modal:
 *  - Escape closes (no focus trap that swallows it — #16).
 *  - Focus moves into the panel on open and restores on close (#7).
 *  - Background scroll is locked while open.
 * Focus is *contained* (wraps with Tab) but not *trapped against
 * Escape* — toasts/dialogs never trap the user (#16).
 */
export function useOverlay(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
) {
  // Read the latest onClose through a ref so the effect below does NOT depend on
  // its identity. Callers pass an inline handler (`onClose={() => setX(null)}`)
  // that is a fresh closure every render, and the routine editor re-renders on
  // every background sync frame (a collaborator's live edit). If the effect
  // re-ran on each of those, it would restore focus to the background and then
  // re-grab it into the panel — and toggle the body scroll lock — on every
  // frame, which reads as the overlay "flickering" and steals focus from an
  // input the user is typing in. Keying the effect on `open` alone makes the
  // open/focus/lock setup run once per open, immune to background re-renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    // Move focus into the panel (first focusable, else the panel).
    const focusables = panel?.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    );
    (focusables?.[0] ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panel) {
        const items = panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, panelRef]);
}
