import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent, within } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// T2 — Choreo list design parity (frames 1.1–1.5).
//   1.1 list · 1.2 empty · 1.3 forked card · 1.4 Open/Fork sheet · 1.5 new-choreo
// These cover the parity-specific behaviors layered on the US-022/025/045/046
// coverage in `choreo-list.test.tsx`.
// ─────────────────────────────────────────────────────────────────────────

interface ChoreoListModule {
  ChoreoList: ComponentType<Record<string, unknown>>;
}

const load = () => importComponent<ChoreoListModule>("../components/ChoreoList");

describe("T2 Choreo header (frame 1.1)", () => {
  it('renders the "My Choreos" title and a New-choreo action', async () => {
    const { ChoreoList } = await load();
    renderUi(<ChoreoList ownedCount={0} plan="free" />);
    expect(screen.getByRole("heading", { name: "My Choreos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new choreo/i })).toBeInTheDocument();
  });
});

describe("T2 Routine card (frame 1.1)", () => {
  const baseRoutine = {
    docRef: "rt1",
    title: "Gold Waltz",
    dance: "waltz",
    role: "owner",
    updatedAt: Date.UTC(2025, 5, 15),
  };

  it("shows the dance + a human date in the meta line", async () => {
    const { ChoreoList } = await load();
    renderUi(<ChoreoList ownedCount={1} plan="free" routines={[baseRoutine]} />);
    expect(screen.getByText("Gold Waltz")).toBeInTheDocument();
    // Meta line: dance label + human month/year (not a raw locale date).
    expect(screen.getByText(/Waltz · Jun 2025/)).toBeInTheDocument();
  });

  it('shows "no figures yet" when the routine has zero figures', async () => {
    const { ChoreoList } = await load();
    renderUi(
      <ChoreoList ownedCount={1} plan="free" routines={[{ ...baseRoutine, figureCount: 0 }]} />,
    );
    expect(screen.getByText(/no figures yet/i)).toBeInTheDocument();
  });

  it('shows a derived "N bars" when available', async () => {
    const { ChoreoList } = await load();
    renderUi(
      <ChoreoList
        ownedCount={1}
        plan="free"
        routines={[{ ...baseRoutine, figureCount: 3, bars: 7 }]}
      />,
    );
    expect(screen.getByText(/7 bars/)).toBeInTheDocument();
  });

  it("exposes a per-card overflow menu that opens the Open/Fork sheet", async () => {
    const { ChoreoList } = await load();
    const onOpen = vi.fn();
    renderUi(<ChoreoList ownedCount={1} plan="free" routines={[baseRoutine]} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /more options for gold waltz/i }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/choose what to do with this routine/i)).toBeInTheDocument();
    // Opening the menu must NOT navigate (menu is separate from the card tap).
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("T2 Forked card (frame 1.3)", () => {
  it("renders the forked-from lineage line when lineage is present", async () => {
    const { ChoreoList } = await load();
    const routines = [
      {
        docRef: "rt_fork",
        title: "Gold Waltz (my copy)",
        dance: "waltz",
        role: "owner",
        updatedAt: Date.UTC(2025, 5, 15),
        forkedFromTitle: "Gold Waltz",
      },
    ];
    renderUi(<ChoreoList ownedCount={1} plan="free" routines={routines} />);
    expect(screen.getByText(/forked from Gold Waltz/i)).toBeInTheDocument();
  });
});

describe("T2 Empty state (frame 1.2)", () => {
  it("shows the designed empty copy + a create action", async () => {
    const { ChoreoList } = await load();
    renderUi(<ChoreoList ownedCount={0} plan="free" />);
    expect(screen.getByText(/no choreos yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/each dance gets its own routine — plus extras for practice/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create choreo/i })).toBeInTheDocument();
  });
});

describe("T2 Open/Fork sheet (frame 1.4)", () => {
  const routines = [
    {
      docRef: "rt1",
      title: "Gold Waltz",
      dance: "waltz",
      role: "owner",
      updatedAt: Date.UTC(2025, 5, 15),
    },
  ];

  it("Open → opens the routine", async () => {
    const { ChoreoList } = await load();
    const onOpen = vi.fn();
    renderUi(<ChoreoList ownedCount={1} plan="free" routines={routines} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /more options for gold waltz/i }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: /^open/i }));
    expect(onOpen).toHaveBeenCalledWith("rt1");
  });

  it("Fork → forks the routine", async () => {
    const { ChoreoList } = await load();
    const onFork = vi.fn();
    renderUi(<ChoreoList ownedCount={1} plan="free" routines={routines} onFork={onFork} />);
    await userEvent.click(screen.getByRole("button", { name: /more options for gold waltz/i }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: /fork — make it your own/i }));
    expect(onFork).toHaveBeenCalledWith("rt1");
  });
});

describe("D7 Quota label (design 1.18)", () => {
  it("shows 'Free · N of M' in the header when on free plan with a known cap", async () => {
    // Intent (D7 design 1.18): a free-plan user at quota sees 'Free · 2 of 3' in the
    //   'My Choreos' header so they know how many owned routines they have left.
    const { ChoreoList } = await load();
    renderUi(<ChoreoList ownedCount={2} plan="free" cap={3} />);
    expect(screen.getByText(/free · 2 of 3/i)).toBeInTheDocument();
  });

  it("does not show the quota label when cap is unknown", async () => {
    // Intent: cap is sourced from /api/me which may not have loaded yet — don't show
    //   stale UI while it resolves.
    const { ChoreoList } = await load();
    renderUi(<ChoreoList ownedCount={2} plan="free" />);
    expect(screen.queryByText(/free · /i)).toBeNull();
  });

  it("does not show the quota label for a pro user", async () => {
    const { ChoreoList } = await load();
    renderUi(<ChoreoList ownedCount={5} plan="pro" cap={3} />);
    expect(screen.queryByText(/free · /i)).toBeNull();
  });
});

describe("T2 New-choreo sheet (frame 1.5)", () => {
  it("creates with the dance picked from chips", async () => {
    const { ChoreoList } = await load();
    const onCreate = vi.fn();
    renderUi(<ChoreoList ownedCount={0} plan="free" onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: /new choreo/i }));
    const sheet = await screen.findByRole("dialog", { name: /new choreography/i });
    // Pick a non-default dance via its chip.
    await userEvent.click(within(sheet).getByRole("button", { name: "Quickstep" }));
    await userEvent.type(within(sheet).getByLabelText(/routine name/i), "Silver Quickstep");
    await userEvent.click(within(sheet).getByRole("button", { name: /create choreo/i }));
    expect(onCreate).toHaveBeenCalledWith({ title: "Silver Quickstep", dance: "quickstep" });
  });

  it("cancel closes the sheet without creating", async () => {
    const { ChoreoList } = await load();
    const onCreate = vi.fn();
    renderUi(<ChoreoList ownedCount={0} plan="free" onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: /new choreo/i }));
    const sheet = await screen.findByRole("dialog", { name: /new choreography/i });
    await userEvent.click(within(sheet).getByRole("button", { name: /cancel/i }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /new choreography/i })).not.toBeInTheDocument();
  });
});
