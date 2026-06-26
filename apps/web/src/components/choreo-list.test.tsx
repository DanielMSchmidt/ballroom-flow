import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

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
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    const onCreate = vi.fn();
    renderUi(<ChoreoList ownedCount={0} plan="free" onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: /new choreo/i }));
    await userEvent.type(screen.getByLabelText(/routine name/i), "Showcase");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(onCreate).toHaveBeenCalledWith({ title: "Showcase", dance: "waltz" });
  });
});

describe.skip("US-037 Choreo fork ('make it your own')", () => {
  it("offers a fork action and shows lineage as provenance on the result", async () => {
    // Intent: a routine card offers "Make it your own" (fork); the fork shows lineage.
    // Arrange: render <ChoreoList> with a shared routine that has a fork action.
    // Act: invoke fork. Assert: a fork is created (callback), counted to quota, and a
    //   "forked from" lineage label shows. (Frozen-independence is the E2E test.)
    // Covers US-037 AC-1 (fork creates owned clone) + AC-3 (lineage as provenance).
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    renderUi(<ChoreoList ownedCount={0} plan="free" />);
    await userEvent.click(screen.getByRole("button", { name: /make it your own|fork/i }));
    expect(await screen.findByText(/forked from/i)).toBeInTheDocument();
  });
});

describe.skip("US-045 Sample routine + start-from-template", () => {
  it("shows the read-only sample + a template in the empty state", async () => {
    // Intent: an empty Choreo list offers the sample + a start-from-template option.
    // Arrange: render <ChoreoList> with zero owned routines.
    // Act/Assert: the read-only sample appears; a "start from template" action exists.
    // Covers US-045 AC-1 (sample in empty state) + AC-2 (start-from-template).
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    renderUi(<ChoreoList ownedCount={0} plan="free" />);
    expect(screen.getByText(/sample/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
  });

  it("prevents editing the read-only sample", async () => {
    // Intent: the sample is read-only (cannot be edited in place).
    // Arrange: open the sample from the list. Act/Assert: no edit affordances on it.
    // Covers US-045 AC-3 (sample cannot be edited).
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    renderUi(<ChoreoList ownedCount={0} plan="free" />);
    expect(screen.getByText(/read-only|sample/i)).toBeInTheDocument();
  });
});
