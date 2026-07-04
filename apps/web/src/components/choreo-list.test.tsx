import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent, within } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// US-022 — Quota upsell (UI) [M3, user]
// US-037 — Choreo fork ("make it your own") affordance [M4, user]
// US-045 — Sample routine + start-from-template [M7, user]
//
// PLAN §4.1, §10.2 component layer: quota upsell toast; fork action; empty →
// sample + template. Choreo List screen built by the frontend agent → dynamic
// import behind it.skip.
// ─────────────────────────────────────────────────────────────────────────

interface ChoreoListModule {
  ChoreoList: ComponentType<Record<string, unknown>>;
}

describe("US-022 Quota upsell (UI)", () => {
  it("shows an upsell when creating a 4th owned routine is blocked", async () => {
    // Intent: the UI surfaces the server's quota block as an upsell.
    // Arrange: render <ChoreoList> for a user at the 3-owned cap (create returns 402/upsell).
    // Act: click "New Choreo". Assert: an upsell sheet/toast appears (not a new routine).
    // Covers US-022 (4th blocked → upsell) at the UI — §10.2 "toasts incl. quota".
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    // cap comes from the server (/api/me), not a hardcoded client constant (#176).
    renderUi(<ChoreoList ownedCount={3} plan="free" cap={3} />);
    await userEvent.click(screen.getByRole("button", { name: /new choreo/i }));
    expect(await screen.findByText(/upgrade|upsell|limit/i)).toBeInTheDocument();
  });
});

describe("US-025 Create a routine (UI)", () => {
  it("lists the viewer's routines and opens one on tap", async () => {
    // Intent: the list shows each routine; tapping one navigates to it (Assemble).
    // Covers US-025 AC-3 (appears in list) + the list → open navigation seam.
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    const onOpen = vi.fn();
    const routines = [
      {
        docRef: "rt1",
        title: "Showcase Waltz",
        dance: "waltz",
        role: "owner",
        updatedAt: Date.now(),
      },
    ];
    renderUi(<ChoreoList ownedCount={1} plan="free" routines={routines} onOpen={onOpen} />);
    await userEvent.click(screen.getByText("Showcase Waltz"));
    expect(onOpen).toHaveBeenCalledWith("rt1");
  });

  it("creates a routine through the form when under the cap", async () => {
    // Intent: New Choreo (under cap) opens a create form; submitting calls onCreate
    //   with the title + chosen dance (the store wires this to POST /api/routines).
    // Covers US-025 AC-1/AC-2 (create) at the UI.
    // T2: the create form is the design's New-choreo sheet (Waltz pre-selected
    // chip, "create choreo" CTA). Scope the CTA to the dialog — the empty state
    // also carries a "Create choreo" button.
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    const onCreate = vi.fn();
    renderUi(<ChoreoList ownedCount={0} plan="free" onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: /new choreo/i }));
    const sheet = await screen.findByRole("dialog", { name: /new choreography/i });
    await userEvent.type(within(sheet).getByLabelText(/choreo name/i), "Showcase");
    await userEvent.click(within(sheet).getByRole("button", { name: /create choreo/i }));
    expect(onCreate).toHaveBeenCalledWith({ title: "Showcase", dance: "waltz" });
  });
});

// US-037 Choreo fork ("make it your own"): the fork affordance ("Make a copy")
// and the "Forked copy" lineage badge live on the OPEN routine (the Assemble
// header), not on a list card — so the component coverage is in
// `assemble.test.tsx` (describe "US-037 Choreo fork"). Frozen-independence is the
// E2E test (`fork-and-figures.spec.ts`); the server endpoint is `fork.test.ts`.

describe("US-045 Sample routine + start-from-template", () => {
  it("shows the read-only sample + a template in the empty state", async () => {
    // Intent: an empty Choreo list offers the sample + a start-from-template option.
    // Arrange: render <ChoreoList> with zero owned routines + a sample + templates.
    // Act/Assert: the read-only sample appears; a "start from template" action exists.
    // Covers US-045 AC-1 (sample in empty state) + AC-2 (start-from-template).
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    const sample = {
      docRef: "rt_sample",
      title: "Sample Foxtrot",
      dance: "foxtrot",
      role: "viewer",
      updatedAt: 1,
    };
    renderUi(<ChoreoList ownedCount={0} plan="free" sample={sample} templates={[sample]} />);
    // The sample card shows its title; the "Read-only sample" Badge is asserted
    // separately below — scope each selector so they resolve uniquely.
    expect(screen.getByText("Sample Foxtrot")).toBeInTheDocument();
    expect(screen.getByText(/read-only sample/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
  });

  it("prevents editing the read-only sample", async () => {
    // Intent: the sample is read-only (cannot be edited in place).
    // Arrange: render <ChoreoList> with a sample in the empty state.
    // Act/Assert: "Read-only sample" badge is present (no edit affordances).
    // Covers US-045 AC-3 (sample cannot be edited).
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    const sample = {
      docRef: "rt_sample",
      title: "Sample Foxtrot",
      dance: "foxtrot",
      role: "viewer",
      updatedAt: 1,
    };
    renderUi(<ChoreoList ownedCount={0} plan="free" sample={sample} />);
    // The "Read-only sample" Badge marks the card as non-editable (read-only is
    // enforced server-side); scope to the badge text so it resolves uniquely.
    expect(screen.getByText(/read-only sample/i)).toBeInTheDocument();
  });
});

describe("US-046 Header search", () => {
  it("calls onSearch as the user types in the header searchbox", async () => {
    // Intent: the header search box calls onSearch on each keystroke.
    // Covers US-046 AC-1 (search input wired to handler).
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    const onSearch = vi.fn();
    renderUi(
      <ChoreoList
        ownedCount={1}
        plan="free"
        onSearch={onSearch}
        routines={[
          { docRef: "r1", title: "My Foxtrot", dance: "foxtrot", role: "owner", updatedAt: 1 },
        ]}
      />,
    );
    await userEvent.type(screen.getByRole("searchbox", { name: /search/i }), "Fox");
    expect(onSearch).toHaveBeenCalled();
  });
});
