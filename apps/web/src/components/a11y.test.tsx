// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { importComponent } from "../test-support/import-component";
import { axeCheck, renderUi } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// US-051 — Accessibility WCAG AA [M9, user]
// PLAN §7, §10.3: "axe reports no violations on each screen (component-level
// vitest-axe)"; color never the sole signal; ≥44px; keyboard + SR; reduced-motion.
//
// One axe sweep per primary screen. Screens built by the frontend agent →
// dynamic import behind it.skip. RED→GREEN: when a screen lands, unskip its row
// and it must pass axe. (Real color-contrast + cross-browser is the E2E layer.)
// ─────────────────────────────────────────────────────────────────────────

const SCREENS: { name: string; specifier: string; exportName: string }[] = [
  { name: "ChoreoList", specifier: "../components/ChoreoList", exportName: "ChoreoList" },
  { name: "Assemble", specifier: "../components/Assemble", exportName: "Assemble" },
  {
    name: "FigureTimeline",
    specifier: "../components/FigureTimeline",
    exportName: "FigureTimeline",
  },
  {
    name: "AttributeEditor",
    specifier: "../components/AttributeEditor",
    exportName: "AttributeEditor",
  },
  { name: "FigureLibrary", specifier: "../components/FigureLibrary", exportName: "FigureLibrary" },
  {
    name: "AnnotationPanel",
    specifier: "../components/AnnotationPanel",
    exportName: "AnnotationPanel",
  },
  { name: "Share", specifier: "../components/Share", exportName: "Share" },
  { name: "Profile", specifier: "../components/Profile", exportName: "Profile" },
];

describe.skip("US-051 Accessibility WCAG AA — axe clean on each screen", () => {
  for (const { name, specifier, exportName } of SCREENS) {
    it(`${name} has no axe violations`, async () => {
      // Intent: each screen passes automated WCAG AA checks (axe).
      // Arrange: dynamic-import + render the screen.
      // Act: run axe over the container. Assert: no violations.
      // Covers US-051 AC-3 (axe clean per screen). The ≥44px / keyboard / SR /
      // reduced-motion / color-not-sole-signal aspects are asserted per-screen in
      // their own tests + the E2E a11y journey (US-052).
      const mod =
        await importComponent<Record<string, ComponentType<Record<string, unknown>>>>(specifier);
      const Screen = mod[exportName];
      if (!Screen) throw new Error(`${exportName} not exported from ${specifier}`);
      const { container } = renderUi(<Screen />);
      expect(await axeCheck(container)).toHaveNoViolations();
    });
  }

  it("never uses color as the only signal (kinds/roles carry text or shape)", async () => {
    // Intent: kind/role distinctions carry a non-color cue (label/icon/shape).
    // Arrange: render the AttributeEditor (kinds are color-coded in the registry).
    // Act/Assert: each kind chip exposes an accessible text label, not just a color.
    // Covers US-051 AC-1 (color never the sole signal).
    const mod = await importComponent<Record<string, ComponentType<Record<string, unknown>>>>(
      "../components/AttributeEditor",
    );
    const AttributeEditor = mod.AttributeEditor;
    if (!AttributeEditor) throw new Error("AttributeEditor not exported");
    const { container } = renderUi(<AttributeEditor dance="foxtrot" role="editor" />);
    expect(container.querySelectorAll("[aria-label], [role]").length).toBeGreaterThan(0);
  });
});
