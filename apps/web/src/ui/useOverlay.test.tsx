// Regression: an overlay must not thrash focus / scroll lock when its parent
// re-renders while it's open (the "flicker" when the choreo syncs in the
// background). The setup effect keys on `open` alone — a fresh inline `onClose`
// each render must NOT re-run it. See useOverlay.ts.
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOverlay } from "./useOverlay";

/** A minimal overlay: a panel with two inputs, wired through useOverlay. A fresh
 *  `onClose` closure is created every render (like the real callsites do). Two
 *  focusables matter: if the setup effect re-runs it grabs the FIRST one, so a
 *  user parked on the SECOND is a detectable focus theft (the flicker). */
function Overlay({ open, bump }: { open: boolean; bump: number }) {
  const panelRef = useRef<HTMLDivElement>(null);
  // A new function identity each render — mirrors `onClose={() => setX(null)}`.
  const onClose = () => {};
  useOverlay(open, onClose, panelRef);
  if (!open) return null;
  return (
    <div ref={panelRef} data-testid="panel" data-bump={bump}>
      <input data-testid="first" />
      <input data-testid="field" />
    </div>
  );
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("useOverlay", () => {
  it("does not steal focus back into the panel when the parent re-renders with a new onClose", () => {
    const { rerender, getByTestId } = render(<Overlay open bump={0} />);
    const field = getByTestId("field");

    // Simulate the user focusing the SECOND input inside the open overlay.
    field.focus();
    expect(document.activeElement).toBe(field);

    // Parent re-renders on a background sync frame (new onClose closure). If the
    // effect re-ran it would yank focus back to the first focusable.
    rerender(<Overlay open bump={1} />);
    rerender(<Overlay open bump={2} />);

    // Focus stays where the user put it — the effect didn't re-run and grab it.
    expect(document.activeElement).toBe(field);
  });

  it("locks and restores body scroll exactly once across background re-renders", () => {
    document.body.style.overflow = "auto";
    const { rerender, unmount } = render(<Overlay open bump={0} />);
    expect(document.body.style.overflow).toBe("hidden");

    // Re-renders while open must not toggle the lock (which would flicker scroll).
    rerender(<Overlay open bump={1} />);
    expect(document.body.style.overflow).toBe("hidden");

    // Closing restores the original overflow the effect captured on open.
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("preserves the page scroll position across open/close (the note-sheet scroll loss)", () => {
    // The incident: the app scrolls on the BODY; `overflow: hidden` alone lets
    // the browser coerce the body's scrollTop toward 0 while an overlay is
    // open, so closing the note Sheet dumped the reader back at the top of the
    // choreo. The lock must fix the body at its current offset and restore the
    // real scroll on close.
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    Object.defineProperty(window, "scrollY", { value: 480, configurable: true });

    const { unmount } = render(<Overlay open bump={0} />);
    // Locked: the body is fixed at the pre-open offset (no visual jump).
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-480px");

    unmount();
    // Unlocked: styles restored, and the page is scrolled back where it was.
    expect(document.body.style.position).toBe("");
    expect(scrollTo).toHaveBeenCalledWith(0, 480);

    vi.unstubAllGlobals();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  it("restores focus on close without scrolling the page (preventScroll)", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    const focusSpy = vi.spyOn(button, "focus");

    const { unmount } = render(<Overlay open bump={0} />);
    unmount();

    // An un-preventScroll'ed focus restore scrolls the refocused element into
    // view — compounding the scroll loss the lock above just fixed.
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    button.remove();
  });

  it("Escape still closes using the latest onClose after re-renders", () => {
    const first = vi.fn();
    const second = vi.fn();
    function Host({ onClose }: { onClose: () => void }) {
      const panelRef = useRef<HTMLDivElement>(null);
      useOverlay(true, onClose, panelRef);
      return (
        <div ref={panelRef}>
          <input />
        </div>
      );
    }
    const { rerender } = render(<Host onClose={first} />);
    // Swap the handler after mount — the ref must forward Escape to the latest.
    rerender(<Host onClose={second} />);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
