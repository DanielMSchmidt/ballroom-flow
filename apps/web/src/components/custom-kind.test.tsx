// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// US-043 — Custom attribute-kind creation UI [M7, user]
// PLAN §4.5, D22, §10.2 component layer: "new user-defined kind appears". Create
// a kind → it merges into the registry and appears in the editor. Built by the
// frontend agent → dynamic import behind it.skip.
// ─────────────────────────────────────────────────────────────────────────

interface AddKindModule {
  AddKindSheet: ComponentType<Record<string, unknown>>;
}
interface AttributeEditorModule {
  AttributeEditor: ComponentType<Record<string, unknown>>;
}

describe("US-043 Custom attribute-kind creation UI", () => {
  it("creates a user-defined kind (label, color, cardinality, valueType, values)", async () => {
    // Intent: the add-kind sheet captures the full kind descriptor.
    // Arrange: render <AddKindSheet>. Act: fill label "Energy", values=[low,high]; submit.
    // Assert: onCreate is called with the descriptor.
    // Covers US-043 AC-1 (create/edit a user-defined kind).
    const { AddKindSheet } = await importComponent<AddKindModule>("../components/AddKindSheet");
    const onCreate = vi.fn();
    renderUi(<AddKindSheet open onCreate={onCreate} />);
    await userEvent.type(screen.getByLabelText(/label/i), "Energy");
    await userEvent.type(screen.getByLabelText(/values/i), "low, high");
    await userEvent.click(screen.getByRole("button", { name: /create|save/i }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "energy",
        label: "Energy",
        values: ["low", "high"],
        builtin: false,
      }),
    );
  });

  it("blocks submit when the label slugifies to an empty string (e.g. only punctuation)", async () => {
    // Intent: a label like "!!!" passes the non-empty check but slugifyKind returns "",
    //   which would create a kind with an empty `kind` key. The submit must be blocked
    //   and an error shown. Covers FIX 4 (empty-slug guard).
    const { AddKindSheet } = await importComponent<AddKindModule>("../components/AddKindSheet");
    const onCreate = vi.fn();
    renderUi(<AddKindSheet open onCreate={onCreate} />);
    await userEvent.type(screen.getByLabelText(/label/i), "!!!");
    await userEvent.click(screen.getByRole("button", { name: /create|save/i }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/enter a valid name/i)).toBeInTheDocument();
  });

  it("makes the new kind appear in the attribute editor after creation", async () => {
    // Intent: a created kind merges into the registry and shows downstream.
    // Arrange: render <AttributeEditor> with a custom "Energy" kind already merged.
    // Act/Assert: an "Energy" section appears alongside the standard kinds.
    // Covers US-043 AC-2 (new kind appears in editor/lanes/info) — §10.2 "new kind appears".
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const energy = {
      kind: "energy",
      label: "Energy",
      color: "#c0563f",
      cardinality: "single" as const,
      valueType: "enum",
      values: ["low", "high"],
      builtin: false,
    };
    renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" customKinds={[energy]} />);
    expect(screen.getByRole("heading", { name: /energy/i })).toBeInTheDocument();
  });
});
