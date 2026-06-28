import type { RoutineDoc } from "@ballroom/domain";
import { describe, expect, it, vi } from "vitest";
import type { SyncState } from "./doc-connection";
import type { ResolvedPlacement, RoutineStore } from "./routine";
import type { RoutineSnapshotModel } from "./routine-snapshot";
import { openRoutineView } from "./routine-view";

// ─────────────────────────────────────────────────────────────────────────
// Read/edit split facade (role-aware hybrid):
//  • viewer (editable:false) → snapshot only, NEVER opens a live socket;
//  • editor (editable:true)  → ONE live routine WS opened immediately (live
//    convergence), reads from the snapshot until it hydrates, then from live.
// ─────────────────────────────────────────────────────────────────────────

const routineDoc = (title: string): RoutineDoc => ({
  id: "rt",
  title,
  dance: "waltz",
  ownerId: "u",
  sections: [],
  annotations: [],
  schemaVersion: 1,
  deletedAt: null,
});

function fakeSnapshot(): RoutineSnapshotModel {
  return {
    readRoutine: () => routineDoc("from-snapshot"),
    readPlacements: (): ResolvedPlacement[] => [],
    readAnnotations: () => [],
    customKinds: () => [],
    syncState: () => "live",
    subscribe: () => () => {},
    refetch: () => {},
    figureFor: () => null,
    close: vi.fn(),
  };
}

/** A fake live store whose hydration is driven by the test (setLive). */
function fakeLive() {
  let state: SyncState = "connecting";
  const subs = new Set<() => void>();
  const notify = () => {
    for (const fn of subs) fn();
  };
  const addSection = vi.fn();
  const openFigure = vi.fn();
  const store: RoutineStore = {
    readRoutine: () => routineDoc("from-live"),
    readPlacements: () => [],
    readAnnotations: () => [],
    customKinds: () => [],
    syncState: () => state,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    close: vi.fn(),
    openFigure,
    addSection,
    renameSection: vi.fn(),
    moveSection: vi.fn(),
    deleteSection: vi.fn(),
    addPlacement: vi.fn(),
    movePlacement: vi.fn(),
    deletePlacement: vi.fn(),
    setFigureAttributes: vi.fn(),
    setFigureAlignment: vi.fn(),
    createAnnotation: vi.fn(),
    addReply: vi.fn(),
    deleteAnnotation: vi.fn(),
    deleteReply: vi.fn(),
    createCustomKind: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  };
  return {
    store,
    addSection,
    openFigure,
    setLive: () => {
      state = "live";
      notify();
    },
  };
}

describe("openRoutineView — viewer (read-only) mode", () => {
  it("reads from the snapshot and NEVER opens a live socket; mutators are no-ops", async () => {
    const live = fakeLive();
    const openLive = vi.fn(async () => live.store);
    const view = openRoutineView("rt", {
      editable: false,
      openSnapshot: () => fakeSnapshot(),
      openLive,
    });
    expect(view.readRoutine().title).toBe("from-snapshot");
    view.addSection("nope"); // a viewer can't edit
    view.openFigure("f1");
    // Give any stray async a chance — nothing should have opened the live store.
    await Promise.resolve();
    expect(openLive).not.toHaveBeenCalled();
    expect(live.addSection).not.toHaveBeenCalled();
    view.close();
  });
});

describe("openRoutineView — editor mode", () => {
  it("opens ONE live routine WS immediately (before any edit) for live convergence", async () => {
    const live = fakeLive();
    const openLive = vi.fn(async () => live.store);
    const view = openRoutineView("rt", {
      editable: true,
      openSnapshot: () => fakeSnapshot(),
      openLive,
    });
    await vi.waitFor(() => expect(openLive).toHaveBeenCalledTimes(1));
    view.close();
  });

  it("reads from the snapshot until live hydrates, then from the live store", async () => {
    const live = fakeLive();
    const view = openRoutineView("rt", {
      editable: true,
      openSnapshot: () => fakeSnapshot(),
      openLive: async () => live.store,
    });
    // Before hydration, content comes from the snapshot.
    expect(view.readRoutine().title).toBe("from-snapshot");
    await vi.waitFor(() => expect(view.syncState()).not.toBe("live")); // live store connecting
    live.setLive();
    await vi.waitFor(() => expect(view.readRoutine().title).toBe("from-live"));
    view.close();
  });

  it("applies an edit on the live store once it has hydrated", async () => {
    const live = fakeLive();
    const view = openRoutineView("rt", {
      editable: true,
      openSnapshot: () => fakeSnapshot(),
      openLive: async () => live.store,
    });
    view.addSection("Intro");
    // Deferred until the live store hydrates.
    await Promise.resolve();
    expect(live.addSection).not.toHaveBeenCalled();
    live.setLive();
    await vi.waitFor(() => expect(live.addSection).toHaveBeenCalledWith("Intro"));
    view.close();
  });

  it("openFigure connects that figure on the live store (lazy figures)", async () => {
    const live = fakeLive();
    const view = openRoutineView("rt", {
      editable: true,
      openSnapshot: () => fakeSnapshot(),
      openLive: async () => live.store,
    });
    view.openFigure("fig1");
    await vi.waitFor(() => expect(live.openFigure).toHaveBeenCalledWith("fig1"));
    view.close();
  });
});
