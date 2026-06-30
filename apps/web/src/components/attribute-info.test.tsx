// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role.
//
// Frame 1.13 — Attribute info sheet: a plain-language reference for one attribute
// kind. Colour dot + title + description + a VALUES glossary (chip + definition)
// + a "Used in N steps" footer. Registry-derived, so it also works for a custom
// kind (no prose definitions, but the values still render).
import { ATTRIBUTE_REGISTRY, type Attribute, type RegistryKind } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

interface InfoModule {
  AttributeInfoSheet: ComponentType<Record<string, unknown>>;
}
interface AttributeEditorModule {
  AttributeEditor: ComponentType<Record<string, unknown>>;
}
const load = () => importComponent<InfoModule>("../components/AttributeInfoSheet");

describe("AttributeInfoSheet (frame 1.13)", () => {
  it("shows the kind title, a plain-language description, and a VALUES glossary", async () => {
    const { AttributeInfoSheet } = await load();
    renderUi(
      <AttributeInfoSheet
        open
        kind={ATTRIBUTE_REGISTRY.footwork}
        usageCount={9}
        scopeLabel="Gold Waltz"
      />,
    );
    // Title (the human label) + a VALUES section.
    expect(screen.getByRole("heading", { name: /footwork/i })).toBeInTheDocument();
    expect(screen.getByText(/values/i)).toBeInTheDocument();
    // A chip per registry value (heel is a footwork value).
    expect(screen.getByText("heel")).toBeInTheDocument();
    // The prose description is registry-derived (RegistryKind.description, T5).
    expect(screen.getByText(/in order of contact/i)).toBeInTheDocument();
    // A per-value definition is registry-derived (RegistryKind.valueDefs, T5).
    expect(screen.getByText(/heel leads/i)).toBeInTheDocument();
    // Footer counts usage.
    expect(screen.getByText(/used in 9 steps/i)).toBeInTheDocument();
    expect(screen.getByText(/gold waltz/i)).toBeInTheDocument();
  });

  it("renders a custom kind's own description + value definitions (registry-derived, T5)", async () => {
    const { AttributeInfoSheet } = await load();
    const energy: RegistryKind = {
      kind: "energy",
      label: "Energy",
      color: "#c0563f",
      cardinality: "single",
      valueType: "enum",
      values: ["low", "high"],
      description: "How much drive the step carries.",
      valueDefs: { high: "High — driving through the floor" },
      builtin: false,
    };
    renderUi(<AttributeInfoSheet open kind={energy} usageCount={0} />);
    expect(screen.getByText(/how much drive/i)).toBeInTheDocument();
    expect(screen.getByText(/driving through the floor/i)).toBeInTheDocument();
  });

  it("renders a custom kind's values with no crash (registry-derived)", async () => {
    const { AttributeInfoSheet } = await load();
    const energy: RegistryKind = {
      kind: "energy",
      label: "Energy",
      color: "#c0563f",
      cardinality: "single",
      valueType: "enum",
      values: ["low", "high"],
      builtin: false,
    };
    renderUi(<AttributeInfoSheet open kind={energy} usageCount={0} />);
    expect(screen.getByRole("heading", { name: /energy/i })).toBeInTheDocument();
    expect(screen.getByText("low")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("invokes onSelectValue when a value chip is tapped", async () => {
    const { AttributeInfoSheet } = await load();
    const onSelectValue = vi.fn();
    renderUi(
      <AttributeInfoSheet
        open
        kind={ATTRIBUTE_REGISTRY.position}
        usageCount={3}
        onSelectValue={onSelectValue}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /closed/i }));
    expect(onSelectValue).toHaveBeenCalledWith("closed");
  });

  it("is reachable from the attribute editor via a per-kind info affordance", async () => {
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const figureAttributes: Attribute[] = [
      {
        id: "footwork-1-heel",
        kind: "footwork",
        count: 1,
        value: "heel",
        role: null,
        deletedAt: null,
      },
      {
        id: "footwork-3-toe",
        kind: "footwork",
        count: 3,
        value: "toe",
        role: null,
        deletedAt: null,
      },
    ];
    renderUi(
      <AttributeEditor
        count={1}
        dance="foxtrot"
        role="editor"
        value={[figureAttributes[0]]}
        figureAttributes={figureAttributes}
        scopeLabel="Gold Waltz"
      />,
    );
    // Tap the Footwork info affordance → the info sheet opens with the description.
    await userEvent.click(screen.getByRole("button", { name: /about footwork/i }));
    expect(screen.getByText(/in order of contact/i)).toBeInTheDocument();
    // Usage counts the distinct steps using footwork across the whole figure (2).
    expect(screen.getByText(/used in 2 steps across gold waltz/i)).toBeInTheDocument();
  });
});
