import type { RoutineDoc } from "@ballroom/domain";
import { describe, expect, it, vi } from "vitest";
import type { SyncState } from "./doc-connection";
import type { ResolvedPlacement, RoutineStore } from "./routine";
import type { RoutineSnapshotModel } from "./routine-snapshot";
import { openRoutineView } from "./routine-view";

// ─────────────────────────────────────────────────────────────────────────
// Read/edit split facade: reads come from the cheap snapshot; the live WS store
// opens LAZILY on the first edit and the write is deferred until it hydrates.
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

/** A fake snapshot model with fixed content, already "live". */
function fakeSnapshot(): RoutineSnapshotModel {
  return {
    readRoutine: () => routineDoc("from-snapshot"),
    readPlacements: (): ResolvedPlacement[] => [],
    readAnnotations: () => [],
    customKinds: () => [],
    syncState: () => "live",
    subscribe: () => () => {},
    refetch: () => {},
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
    setLive: () => {
      state = "live";
      notify();
    },
  };
}

describe("openRoutineView (read/edit split facade)", () => {
  it("reads from the snapshot and does NOT open the live store until an edit", () => {
    const openLive = vi.fn(async () => fakeLive().store);
    const view = openRoutineView("rt", {
      openSnapshot: () => fakeSnapshot(),
      openLive,
    });
    expect(view.readRoutine().title).toBe("from-snapshot");
    expect(openLive).not.toHaveBeenCalled();
    view.close();
  });

  it("first edit opens the live store and applies the write only AFTER it hydrates", async () => {
    const live = fakeLive();
    const openLive = vi.fn(async () => live.store);
    const view = openRoutineView("rt", {
      openSnapshot: () => fakeSnapshot(),
      openLive,
    });

    view.addSection("Intro");
    // The live store is opened, but the write is held until it hydrates.
    await vi.waitFor(() => expect(openLive).toHaveBeenCalledTimes(1));
    expect(live.addSection).not.toHaveBeenCalled();

    // Hydrate the live store → the deferred write now lands.
    live.setLive();
    await vi.waitFor(() => expect(live.addSection).toHaveBeenCalledWith("Intro"));
    view.close();
  });

  it("reads switch from the snapshot to the live store once it has hydrated", async () => {
    const live = fakeLive();
    const openLive = vi.fn(async () => live.store);
    const view = openRoutineView("rt", { openSnapshot: () => fakeSnapshot(), openLive });

    view.addSection("X");
    await vi.waitFor(() => expect(openLive).toHaveBeenCalled());
    // Before hydration, reads still come from the snapshot.
    expect(view.readRoutine().title).toBe("from-snapshot");
    live.setLive();
    // After hydration, reads come from the authoritative live store.
    await vi.waitFor(() => expect(view.readRoutine().title).toBe("from-live"));
    view.close();
  });

  it("a second edit does NOT reopen the live store", async () => {
    const live = fakeLive();
    const openLive = vi.fn(async () => live.store);
    const view = openRoutineView("rt", { openSnapshot: () => fakeSnapshot(), openLive });
    view.addSection("A");
    await vi.waitFor(() => expect(openLive).toHaveBeenCalledTimes(1));
    live.setLive();
    view.addSection("B");
    await vi.waitFor(() => expect(live.addSection).toHaveBeenCalledTimes(2));
    expect(openLive).toHaveBeenCalledTimes(1);
    view.close();
  });
});
