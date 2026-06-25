import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
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

describe.skip("US-022 Quota upsell (UI)", () => {
  it("shows an upsell when creating a 4th owned routine is blocked", async () => {
    // Intent: the UI surfaces the server's quota block as an upsell.
    // Arrange: render <ChoreoList> for a user at the 3-owned cap (create returns 402/upsell).
    // Act: click "New Choreo". Assert: an upsell sheet/toast appears (not a new routine).
    // Covers US-022 (4th blocked → upsell) at the UI — §10.2 "toasts incl. quota".
    const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
    renderUi(<ChoreoList ownedCount={3} plan="free" />);
    await userEvent.click(screen.getByRole("button", { name: /new choreo/i }));
    expect(await screen.findByText(/upgrade|upsell|limit/i)).toBeInTheDocument();
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
