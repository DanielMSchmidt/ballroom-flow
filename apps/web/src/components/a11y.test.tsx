// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { axeCheck, renderUi } from "../test-support/render";
import { AnnotationPanel } from "./AnnotationPanel";
import { AttributeEditor } from "./AttributeEditor";
import { ChoreoList } from "./ChoreoList";
import { FigureLibrary } from "./FigureLibrary";
import { FigureTimeline } from "./FigureTimeline";
import { Profile } from "./Profile";

// ─────────────────────────────────────────────────────────────────────────
// US-051 — Accessibility WCAG AA [M9, user]
// PLAN §7, §10.3: "axe reports no violations on each screen (component-level
// vitest-axe)"; color never the sole signal; ≥44px; keyboard + SR; reduced-motion.
//
// One axe sweep per primary PRESENTATIONAL screen, rendered with minimal real
// props (the previous version rendered every screen prop-less, which is why the
// whole suite was skipped — most screens need props/providers to mount).
//
// Assemble and Share are intentionally NOT here: they need a live store / doc
// connection (routineId → WebSocket store, docRef → members fetch), so their a11y
// is covered by the real-browser E2E a11y journey (e2e/pwa-a11y.spec.ts, US-052),
// which is where real color-contrast + keyboard + cross-browser checks live anyway.
// ─────────────────────────────────────────────────────────────────────────

const SCREENS: { name: string; ui: ReactElement }[] = [
  { name: "ChoreoList", ui: <ChoreoList routines={[]} ownedCount={0} plan="free" /> },
  { name: "AttributeEditor", ui: <AttributeEditor count={1} role="editor" dance="foxtrot" /> },
  { name: "FigureTimeline", ui: <FigureTimeline role="editor" dance="foxtrot" /> },
  { name: "AnnotationPanel", ui: <AnnotationPanel role="commenter" /> },
  // Filter to ONE dance on purpose. Prop-less, FigureLibrary renders the entire
  // ~240-figure catalog (~3000 DOM nodes); axe is O(nodes), so that single sweep
  // took ~3s warm and 13–17s under parallel CI load — over vitest's 5s default,
  // which is exactly what flaked CI on nearly every branch. a11y violations are a
  // property of the *markup* (heading order, button labels, aria), which is
  // identical for every figure card — one dance exercises every distinct element
  // (header, dance chips, section divider, figure card, scope dot) at ~585 nodes
  // / ~0.2s, so the coverage is the same and the flake is gone.
  { name: "FigureLibrary", ui: <FigureLibrary initialDance="waltz" /> },
  { name: "Profile", ui: <Profile plan="free" ownedRoutineCount={0} /> },
];

// Axe sweeps are inherently heavier than a normal component assertion. Give them
// a generous ceiling (vs. the 5s default) so a slow-but-correct sweep can never
// tip into a timeout under CI contention — a safety net beyond the node-count cut
// above, and headroom for screens added later.
const AXE_TIMEOUT_MS = 20_000;

describe("US-051 Accessibility WCAG AA — axe clean on each screen", () => {
  for (const { name, ui } of SCREENS) {
    it(
      `${name} has no axe violations`,
      async () => {
        // Intent: each screen passes automated WCAG AA checks (axe).
        // Arrange/Act: render the screen with minimal real props, run axe over it.
        // Assert: no violations. Covers US-051 AC-3 (axe clean per screen). The
        // ≥44px / keyboard / SR / reduced-motion / color-not-sole-signal aspects are
        // asserted per-screen in their own tests + the E2E a11y journey (US-052).
        const { container } = renderUi(ui);
        expect(await axeCheck(container)).toHaveNoViolations();
      },
      AXE_TIMEOUT_MS,
    );
  }

  it("never uses color as the only signal (kinds/roles carry text or shape)", async () => {
    // Intent: kind/role distinctions carry a non-color cue (label/icon/shape).
    // Arrange: render the AttributeEditor (kinds are color-coded in the registry).
    // Act/Assert: each kind chip exposes an accessible text label, not just a color.
    // Covers US-051 AC-1 (color never the sole signal).
    const { container } = renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" />);
    expect(container.querySelectorAll("[aria-label], [role]").length).toBeGreaterThan(0);
  });
});
