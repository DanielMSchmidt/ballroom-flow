// attribute-predicate-anchors — the attribute path in the link picker (v4 § 3.6,
// docs/concepts/annotations.md § Anchors, § The Journal). Walks choreo → An attribute →
// family → value → role → scope, asserting the exact JournalLink + anchor; the "No value
// logged" row yields the PREDICATE_NONE sentinel; a custom kind appears; Tango omits `rise`;
// the figure path is untouched.
import type { RegistryKind } from "@weavesteps/domain";
import { describe, expect, it, vi } from "vitest";
import { axeCheck, renderUi, screen, userEvent, waitFor } from "../test-support/render";
import { type JournalLink, JournalLinkPicker } from "./JournalLinkPicker";

const waltz = [{ docRef: "rt1", title: "Gold Waltz", dance: "waltz" }];
const tango = [{ docRef: "rt2", title: "Tango One", dance: "tango" }];

const customKind: RegistryKind = {
  kind: "energy",
  label: "Energy",
  color: "#8a5cab",
  cardinality: "single",
  valueType: "enum",
  values: ["soft", "sharp"],
  builtin: false,
};

function renderPicker(over: Partial<React.ComponentProps<typeof JournalLinkPicker>> = {}) {
  const onPick = vi.fn<(l: JournalLink) => void>();
  renderUi(
    <JournalLinkPicker
      open
      onClose={() => {}}
      onPick={onPick}
      loadRoutineOptions={async () => waltz}
      loadRoutineFigures={async () => []}
      {...over}
    />,
  );
  return { onPick };
}

describe("link picker — attribute-predicate path (v4 § 3.6)", () => {
  it("walks choreo → An attribute → Sway → to_L → Leader → every dance to the exact link + anchor", async () => {
    const { onPick } = renderPicker();
    await userEvent.click(await screen.findByText("Gold Waltz"));
    await userEvent.click(await screen.findByText("An attribute"));
    await userEvent.click(await screen.findByText("Sway"));
    // Sway values render as their tokens (to_L / to_R); pick the left sway.
    await userEvent.click(await screen.findByText("to_L"));
    await userEvent.click(await screen.findByRole("radio", { name: "Leader" }));
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await userEvent.click(await screen.findByText("Every dance"));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    const link = onPick.mock.calls[0]?.[0];
    expect(link).toMatchObject({
      home: "accountPredicate",
      attrKind: "sway",
      attrValue: "to_L",
      role: "leader",
      scope: "all",
      anchor: {
        type: "attributePredicate",
        kind: "sway",
        value: "to_L",
        role: "leader",
        scope: "all",
      },
    });
  });

  it("the 'No value logged' row yields the PREDICATE_NONE sentinel", async () => {
    const { onPick } = renderPicker();
    await userEvent.click(await screen.findByText("Gold Waltz"));
    await userEvent.click(await screen.findByText("An attribute"));
    await userEvent.click(await screen.findByText("Sway"));
    await userEvent.click(await screen.findByText("No value logged"));
    // Both = no role; go straight to scope.
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await userEvent.click(await screen.findByText("This choreo only"));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0]?.[0]).toMatchObject({
      home: "accountPredicate",
      attrKind: "sway",
      attrValue: "none",
      scope: "routine",
      routineRef: "rt1",
    });
  });

  it("a custom kind appears in the attribute-family list", async () => {
    renderPicker({ customKinds: [customKind] });
    await userEvent.click(await screen.findByText("Gold Waltz"));
    await userEvent.click(await screen.findByText("An attribute"));
    expect(await screen.findByText("Energy")).toBeInTheDocument();
  });

  it("omits `rise` for a Tango choreo (dance gate)", async () => {
    renderPicker({ loadRoutineOptions: async () => tango });
    await userEvent.click(await screen.findByText("Tango One"));
    await userEvent.click(await screen.findByText("An attribute"));
    // Sway applies to Tango; Rise & Fall does not.
    expect(await screen.findByText("Sway")).toBeInTheDocument();
    expect(screen.queryByText("Rise & Fall")).toBeNull();
  });

  it("the figure path is untouched (regression): choreo → A figure from this choreo", async () => {
    renderPicker();
    await userEvent.click(await screen.findByText("Gold Waltz"));
    await userEvent.click(await screen.findByText("A figure from this choreo"));
    // Lands on the figure chooser (empty here), NOT the attribute family list.
    expect(await screen.findByText(/no figures yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Attribute families")).toBeNull();
  });

  it("back-navigation returns through the attribute steps", async () => {
    renderPicker();
    await userEvent.click(await screen.findByText("Gold Waltz"));
    await userEvent.click(await screen.findByText("An attribute"));
    await userEvent.click(await screen.findByText("Sway"));
    // back from value → family
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByText("Which attribute?")).toBeInTheDocument();
  });

  it("is axe-clean across the attribute picker steps (target, family, value, role, scope)", async () => {
    const { container } = renderUi(
      <JournalLinkPicker
        open
        onClose={() => {}}
        onPick={() => {}}
        loadRoutineOptions={async () => waltz}
        loadRoutineFigures={async () => []}
      />,
    );
    await userEvent.click(await screen.findByText("Gold Waltz"));
    expect(await axeCheck(container)).toHaveNoViolations(); // target step
    await userEvent.click(await screen.findByText("An attribute"));
    expect(await axeCheck(container)).toHaveNoViolations(); // family step
    await userEvent.click(await screen.findByText("Sway"));
    expect(await axeCheck(container)).toHaveNoViolations(); // value step
    await userEvent.click(await screen.findByText("to_L"));
    expect(await axeCheck(container)).toHaveNoViolations(); // role step
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(await axeCheck(container)).toHaveNoViolations(); // scope step
  });
});
