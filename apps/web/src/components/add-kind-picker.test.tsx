// Frame 1.15 — Add-attribute type picker. A sheet listing the standard kinds +
// any custom kinds, plus a dashed "＋ new attribute type" footer that opens the
// custom-type builder (frame 1.16).
import type { RegistryKind } from "@weavesteps/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

interface PickerModule {
  AddKindPicker: ComponentType<Record<string, unknown>>;
}
const load = () => importComponent<PickerModule>("../components/AddKindPicker");

// NOTE: `head` is a BUILTIN kind since the WDSF technique-book charting (its slug is
// reserved — mergeRegistry ignores a colliding custom kind), so the custom fixture
// uses its own slug.
const energy: RegistryKind = {
  kind: "energy",
  label: "Energy",
  color: "#4a9d9a",
  cardinality: "single",
  valueType: "enum",
  values: ["low", "high"],
  builtin: false,
};

describe("AddKindPicker (frame 1.15)", () => {
  it("lists standard + custom kinds and marks the custom one", async () => {
    const { AddKindPicker } = await load();
    renderUi(<AddKindPicker open customKinds={[energy]} />);
    // A standard kind and the custom kind both appear.
    expect(screen.getByRole("button", { name: /rise & fall/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /energy/i })).toBeInTheDocument();
    // The custom kind is marked "custom".
    expect(screen.getByText(/custom/i)).toBeInTheDocument();
  });

  it("surfaces registry-derived L/F (roleAware) + required affordances (T5)", async () => {
    const { AddKindPicker } = await load();
    renderUi(<AddKindPicker open dance="waltz" />);
    // Direction is the required slot → a required marker; role-aware kinds show L/F.
    expect(screen.getAllByLabelText("required").length).toBeGreaterThan(0);
    expect(screen.getAllByText("L/F").length).toBeGreaterThan(0);
  });

  it("calls onSelectKind with the chosen kind", async () => {
    const { AddKindPicker } = await load();
    const onSelectKind = vi.fn();
    renderUi(<AddKindPicker open onSelectKind={onSelectKind} />);
    // Anchored so it doesn't also match the "Foot Position" kind button.
    await userEvent.click(screen.getByRole("button", { name: /^position/i }));
    expect(onSelectKind).toHaveBeenCalledWith(expect.objectContaining({ kind: "position" }));
  });

  it("opens the builder from the ＋ new attribute type footer and emits onCreate", async () => {
    const { AddKindPicker } = await load();
    const onCreate = vi.fn();
    renderUi(<AddKindPicker open onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: /new attribute type/i }));
    // The builder's Label field is now present.
    await userEvent.type(screen.getByLabelText(/^label/i), "Energy");
    await userEvent.type(screen.getByLabelText(/add a value/i), "low, high");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ kind: "energy" }));
  });
});
