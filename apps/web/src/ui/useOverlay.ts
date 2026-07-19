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

    const previouslyFocused = document.activeElement;
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
    // Body scroll lock that PRESERVES the scroll position. The app scrolls on
    // the BODY (AppShell has no inner scroll container), and `overflow: hidden`
    // alone lets browsers coerce the body's scrollTop toward 0 while locked —
    // closing the note Sheet dumped the reader back at the TOP of the choreo.
    // Fixing the body at its current offset keeps the visual position; cleanup
    // restores the styles and the real scroll.
    const scrollY = window.scrollY;
    const bodyStyle = document.body.style;
    const prev = {
      overflow: bodyStyle.overflow,
      position: bodyStyle.position,
      top: bodyStyle.top,
      left: bodyStyle.left,
      right: bodyStyle.right,
      width: bodyStyle.width,
    };
    bodyStyle.overflow = "hidden";
    bodyStyle.position = "fixed";
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.left = "0";
    bodyStyle.right = "0";
    bodyStyle.width = "100%";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      bodyStyle.overflow = prev.overflow;
      bodyStyle.position = prev.position;
      bodyStyle.top = prev.top;
      bodyStyle.left = prev.left;
      bodyStyle.right = prev.right;
      bodyStyle.width = prev.width;
      window.scrollTo(0, scrollY);
      // preventScroll: refocusing the opener must not scroll it into view —
      // that would re-lose the position the lock above just preserved.
      // (instanceof stands in for the old "has a focus method" probe — only
      // HTML/SVG elements are focusable.)
      if (previouslyFocused instanceof HTMLElement || previouslyFocused instanceof SVGElement) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, panelRef]);
}
