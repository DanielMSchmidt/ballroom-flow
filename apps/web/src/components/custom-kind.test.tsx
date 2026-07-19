// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// US-043 — Custom attribute-kind creation UI [M7, user]
// docs/concepts/notation.md § The figure editor, D22, docs/system/testing.md
// component layer: "new user-defined kind appears". Create
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
    await userEvent.type(screen.getByLabelText(/^label/i), "Energy");
    // Enum values are a chip list: a comma commits "low"; "high" is still in the
    // add-field and gets flushed on submit — both land in the descriptor.
    await userEvent.type(screen.getByLabelText(/add a value/i), "low, high");
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

  it("shows the locked slug beside the name in edit mode (wireframe 1.16b)", async () => {
    // The derived slug is held stable across a rename — surfacing it tells the
    // user why existing attributes stay linked.
    const { AddKindSheet } = await importComponent<AddKindModule>("../components/AddKindSheet");
    const initial = {
      kind: "energy",
      label: "Energy",
      color: "#0f6b66",
      cardinality: "single",
      valueType: "enum",
      values: ["low", "high"],
      builtin: false,
    } as const;
    renderUi(<AddKindSheet open initial={initial} onCreate={vi.fn()} />);
    expect(screen.getByText(/slug: energy/i)).toBeInTheDocument();
    expect(screen.getByText(/held stable/i)).toBeInTheDocument();
  });

  it("edits an existing custom kind: keeps the slug stable and saves changes", async () => {
    // Intent: US-043 AC-1 (create/EDIT). Opening the sheet with `initial` pre-fills
    // it; the slug is held stable so existing attributes keep resolving, and the
    // value chips can be removed/added.
    const { AddKindSheet } = await importComponent<AddKindModule>("../components/AddKindSheet");
    const onCreate = vi.fn();
    const initial = {
      kind: "energy",
      label: "Energy",
      color: "#2f5d8f",
      cardinality: "single" as const,
      valueType: "enum",
      values: ["low", "high"],
      builtin: false,
    };
    renderUi(<AddKindSheet open initial={initial} onCreate={onCreate} />);
    // Pre-filled label + existing value chips are present.
    expect(screen.getByDisplayValue("Energy")).toBeInTheDocument();
    // Remove "low", add "medium".
    await userEvent.click(screen.getByRole("button", { name: /remove "low"/i }));
    await userEvent.type(screen.getByLabelText(/add a value/i), "medium{Enter}");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "energy", // slug unchanged even though we edited values
        values: ["high", "medium"],
        builtin: false,
      }),
    );
  });

  it("captures description, per-value definitions, and roleAware/required flags", async () => {
    // Intent: the editor authors the data-driven RegistryKind fields (#111 / §3),
    // so a custom kind keeps its prose + flags through to persistence.
    const { AddKindSheet } = await importComponent<AddKindModule>("../components/AddKindSheet");
    const onCreate = vi.fn();
    renderUi(<AddKindSheet open onCreate={onCreate} />);
    await userEvent.type(screen.getByLabelText(/^label/i), "Energy");
    await userEvent.type(screen.getByLabelText(/description/i), "How much drive the step carries");
    await userEvent.type(screen.getByLabelText(/add a value/i), "low, high");
    // A per-value definition input appears for each committed enum value chip.
    await userEvent.type(screen.getByLabelText(/definition for "low"/i), "barely moving");
    await userEvent.click(screen.getByRole("switch", { name: /leader/i }));
    await userEvent.click(screen.getByRole("switch", { name: /required/i }));
    await userEvent.click(screen.getByRole("button", { name: /create|save/i }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "energy",
        description: "How much drive the step carries",
        valueDefs: { low: "barely moving" },
        roleAware: true,
        required: true,
      }),
    );
  });

  it("omits the optional fields when left blank (no empty description/valueDefs)", async () => {
    const { AddKindSheet } = await importComponent<AddKindModule>("../components/AddKindSheet");
    // Typed on the sheet's onCreate contract so mock.calls hands the kind back typed.
    const onCreate = vi.fn<(kind: Record<string, unknown>) => void>();
    renderUi(<AddKindSheet open onCreate={onCreate} />);
    await userEvent.type(screen.getByLabelText(/^label/i), "Energy");
    await userEvent.type(screen.getByLabelText(/add a value/i), "low, high");
    await userEvent.click(screen.getByRole("button", { name: /create|save/i }));
    const kind = onCreate.mock.calls[0]?.[0];
    expect(kind).not.toHaveProperty("description");
    expect(kind).not.toHaveProperty("valueDefs");
    expect(kind).not.toHaveProperty("roleAware");
    expect(kind).not.toHaveProperty("required");
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
    // A custom kind is a technique kind — revealed under "More attributes".
    await userEvent.click(screen.getByRole("button", { name: /more attributes/i }));
    expect(screen.getByRole("heading", { name: /energy/i })).toBeInTheDocument();
  });
});
