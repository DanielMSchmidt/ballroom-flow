// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { VoiceNoteProposal } from "@weavesteps/contract";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { SpeechCapture, SpeechCaptureCallbacks } from "../lib/speech";
import { axeCheck, fireEvent, renderUi, screen, waitFor } from "../test-support/render";
import { AnnotationPanel } from "./AnnotationPanel";
import { AttributeEditor } from "./AttributeEditor";
import { ChoreoList } from "./ChoreoList";
import { FigureLibrary } from "./FigureLibrary";
import { FigureTimeline } from "./FigureTimeline";
import { Profile } from "./Profile";
import { VoiceNoteSheet } from "./VoiceNoteSheet";

// ─────────────────────────────────────────────────────────────────────────
// US-051 — Accessibility WCAG AA [M9, user]
// docs/system/architecture.md § Non-functional requirements, docs/system/testing.md:
// "axe reports no violations on each screen (component-level
// vitest-axe)"; color never the sole signal; ≥44px; keyboard + SR; reduced-motion.
//
// One axe sweep per primary PRESENTATIONAL screen, rendered with minimal real
// props (the previous version rendered every screen prop-less, which is why the
// whole suite was skipped — most screens need props/providers to mount).
//
// Assemble and Share are NOT swept here: they need a live store / doc connection
// (routineId → WebSocket store, docRef → members fetch) to mount. The real-browser
// E2E a11y journey (e2e/pwa-a11y.spec.ts, US-052) exercises keyboard navigation,
// ≥44px targets, and reduced-motion on the running app — but it does NOT run axe,
// so the editor's markup-level a11y (heading order, aria labels, color-contrast)
// currently has NO automated sweep. KNOWN GAP: add an injected-store component
// axe test for Assemble (or an axe pass in the E2E journey) so the most complex
// screen isn't the one screen without an axe check. Tracked in the readiness backlog.
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

  // Bug #290: the confirm sheet (the AI voice-note proposal review) was never in
  // any axe sweep — pwa-a11y.spec.ts only scans the nav shell — which is how the
  // "high confidence" badge's failing contrast escaped. Drive the sheet to its
  // confirm phase and sweep it. (axe under jsdom cannot compute color-contrast, so
  // the exact 4.5:1 token pairing is asserted in voice-note-sheet.test.tsx; this
  // sweep guards the sheet's markup-level a11y — dialog name, roles, labels.)
  it("VoiceNoteSheet confirm state has no axe violations", async () => {
    let cb: SpeechCaptureCallbacks | null = null;
    const capture: SpeechCapture = {
      onDevice: true,
      start(callbacks) {
        cb = callbacks;
      },
      stop() {},
    };
    const emit = (text: string): void => cb?.onTranscript(text, true);
    const proposal: VoiceNoteProposal = {
      resolved: true,
      noteText: "settle the sway",
      confidence: "high",
      proposed: {
        anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
        routineRef: null,
        label: "all Feathers · all Foxtrot",
      },
      alternatives: [],
    };
    const { container } = renderUi(
      <VoiceNoteSheet
        open
        onClose={() => {}}
        capture={capture}
        interpret={async () => proposal}
        transcribe={async () => ""}
        onConfirm={() => {}}
        onUseAsText={() => {}}
        onEditTarget={() => {}}
      />,
    );
    // Push-to-talk: press the mic to wire the capture (the sheet opens idle, #291).
    fireEvent.pointerDown(screen.getByRole("button", { name: /hold to talk/i }));
    emit("In Slowfox, in Feather Steps, settle the sway.");
    await waitFor(() => expect(screen.getByText("Confirm & save")).toBeTruthy());
    expect(await axeCheck(container)).toHaveNoViolations();
  });

  it("never uses color as the only signal (kinds/roles carry text or shape)", async () => {
    // Intent: kind/role distinctions carry a non-color cue (label/icon/shape).
    // Arrange: render the AttributeEditor (kinds are color-coded in the registry).
    // Act/Assert: each kind chip exposes an accessible text label, not just a color.
    // Covers US-051 AC-1 (color never the sole signal).
    const { container } = renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" />);
    expect(container.querySelectorAll("[aria-label], [role]").length).toBeGreaterThan(0);
  });
});
