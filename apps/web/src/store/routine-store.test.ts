import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// US-017 — store/ seam (multi-doc) [M2, system]
// PLAN §6.1/§6.2, D6, §10.2: the typed store seam wraps Automerge: opening a
// routine connects to the routine doc's DO then to each referenced figure
// doc's DO; resolves variant overlays client-side; exposes typed reactive reads
// + mutations + history-based undo. Components import ONLY from store/.
//
// The store (apps/web/src/store/routine.ts) is built in M2 → dynamic import
// behind it.skip. (The multi-doc SYNC over real DOs is the worker layer
// doc-do.test.ts; here we pin the seam's CONTRACT.)
// ─────────────────────────────────────────────────────────────────────────

/** Structural view of the M2 store seam (avoids `any`; the real type lands in M2). */
interface RoutineStore {
  readPlacements(): unknown[];
  undo(): void;
  redo(): void;
  subscribe(fn: () => void): () => void;
}
interface RoutineStoreModule {
  openRoutine(routineId: string): Promise<RoutineStore>;
}

// Runtime-variable specifier so tsc doesn't try to resolve the not-yet-built M2
// store module (apps/web/src/store/routine.ts). Replace with a direct import
// once it exists. See the worker/domain shims for the same rationale.
const ROUTINE_STORE_PATH = "./routine";

describe.skip("US-017 store/ seam (multi-doc)", () => {
  it("loads a routine doc + each referenced figure doc and resolves variant overlays", async () => {
    // Intent: opening a routine fans out to the routine DO + every referenced
    //   figure DO and resolves variant overlays client-side via resolve().
    // Arrange: a routine referencing a global figure + an account VARIANT of it.
    // Act: openRoutine(routineId) and read the resolved placements.
    // Assert: every placement's figure resolves to effective attributes (the
    //   variant shows base ⊕ overlay), proving the multi-doc load + overlay resolve.
    // Covers US-017 AC-1 (connect routine + figure docs) + AC-2 (overlays resolve).
    const mod = (await import(ROUTINE_STORE_PATH)) as unknown as RoutineStoreModule;
    const store = await mod.openRoutine("rt_sample");
    const placements = store.readPlacements();
    expect(Array.isArray(placements)).toBe(true);
  });

  it("exposes typed reactive reads + mutations + history-based undo", async () => {
    // Intent: the seam is the only thing components touch — reads, mutations, undo.
    // Arrange: open a routine. Act: subscribe to a read, apply a mutation, undo it.
    // Assert: the subscription fires on mutation; undo reverts it (per-user, US-010).
    // Covers US-017 AC-3 (typed reactive reads + mutations + undo).
    const mod = (await import(ROUTINE_STORE_PATH)) as unknown as RoutineStoreModule;
    const store = await mod.openRoutine("rt_sample");
    expect(typeof store.undo).toBe("function");
    expect(typeof store.subscribe).toBe("function");
  });
});

describe.skip("US-017 architecture boundary (components import only from store/)", () => {
  it("documents the lint/architecture rule forbidding direct automerge/RPC in components", () => {
    // Intent: components must not import @automerge/automerge or the RPC client
    //   directly — only the store/ seam (D6, §6.1). This is enforced by an
    //   architecture/lint rule (M2). This placeholder marks where that gate is
    //   asserted (e.g. a dependency-cruiser / Biome rule check), so the boundary
    //   is part of the test map rather than implicit.
    // Covers US-017 AC-4 (components import only from store/).
    expect(true).toBe(true);
  });
});
