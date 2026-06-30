import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyMutations,
  assertCommutative,
  assertIdempotent,
  exchangeAndAssertConverged,
  loadAutomerge,
} from "./__fixtures__";
import { buildRoutineDoc, readRoutine } from "./doc-routine";
import type { Placement, RoutineDoc, Section } from "./doc-types";
import { keyBetween, sequentialKeys } from "./order";

// ── Small lint-safe lookups (no non-null assertions) for the reorder tests ──
function req<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}
const sectionById = (d: RoutineDoc, id: string): Section =>
  req(
    d.sections.find((s) => s.id === id),
    `section ${id}`,
  );
const placementById = (s: Section, id: string): Placement =>
  req(
    s.placements.find((p) => p.id === id),
    `placement ${id}`,
  );
const keyOf = (e: { sortKey?: string } | undefined, what: string): string =>
  req(req(e, what).sortKey, `${what} sortKey`);

// ─────────────────────────────────────────────────────────────────────────
// US-009 — Automerge convergence invariants [M1, system/developer]
// PLAN §5.3, §10.2 invariant: "Automerge convergence/commutativity/idempotence
// (fast-check, shuffled/partitioned changes incl. across forks)".
//
// These are PROPERTY tests (fast-check) over real in-memory Automerge docs via
// the convergence helper. The helper dynamic-imports Automerge (not yet a dep —
// see TEST-MAP.md), so the bodies stay skipped until M1. RED→GREEN: add the
// `@automerge/automerge` dependency + the M1 doc builders, then unskip.
//
// The model doc here is a simple counts map keyed by attribute id (a stand-in
// for a figure's attribute set); the M1 version swaps in real buildFigureDoc.
// ─────────────────────────────────────────────────────────────────────────

interface CountsDoc {
  counts: Record<string, number>;
}

describe("US-009 Automerge convergence invariants", () => {
  it("converges regardless of edit order (commutative) — property", async () => {
    // Intent: shuffled changes converge to one doc (commutativity), INCLUDING
    //   the hard case — multiple changes writing the SAME cell (LWW conflict).
    // Multi-actor scenario: a sequence of attribute writes; keys are drawn from a
    //   small pool so writes collide on the same key within a case, exercising
    //   conflict-LWW commutativity, not just independent-change commutativity.
    // Arrange (property): a random list of [key, value] writes (keys MAY repeat).
    //   Act: capture each as a discrete Automerge change off a common base.
    //   Assert: applying the change set forward vs reversed converges (heads).
    // Covers US-009 AC-1 (different orders converge; commutative, incl. same-cell).
    const A = await loadAutomerge();
    await fc.assert(
      fc.asyncProperty(
        // Small key pool (a–d) so 1–8 writes frequently target the same cell —
        // a plain array (not uniqueArray) lets keys repeat, forcing LWW races.
        fc.array(fc.tuple(fc.constantFrom("a", "b", "c", "d"), fc.integer()), {
          minLength: 1,
          maxLength: 8,
        }),
        async (writes) => {
          const base = A.from<CountsDoc>({ counts: {} });
          const changes: Uint8Array[] = [];
          let cur = base;
          for (const [k, v] of writes) {
            const next = A.change(cur, (d) => {
              d.counts[k] = v;
            });
            changes.push(...A.getChanges(cur, next));
            cur = next;
          }
          await assertCommutative(base, changes);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("converges two partitioned (offline) replicas with no lost edits", async () => {
    // Intent: two replicas edited "offline" then merged keep BOTH edits.
    // Multi-actor scenario: replica L and R diverge on different keys, reconnect.
    // Arrange: clone a base into two replicas. Act: apply disjoint mutations to each.
    // Assert: exchangeAndAssertConverged → both byte-identical AND both keys present.
    // Covers US-009 AC-2 (partitioned converge, no lost edits) + AC-4 (across replicas).
    const A = await loadAutomerge();
    const base = A.from<CountsDoc>({ counts: {} });
    const left = await applyMutations(base, [(d: CountsDoc) => (d.counts.l = 1)]);
    const right = await applyMutations(base, [(d: CountsDoc) => (d.counts.r = 2)]);
    const { converged } = await exchangeAndAssertConverged(left, right);
    expect(converged.counts).toMatchObject({ l: 1, r: 2 });
  });

  it("is idempotent when the same change is applied twice", async () => {
    // Intent: a duplicate change delivery is a no-op (also the WS invariant US-015).
    // Arrange: a base doc + one captured change. Act: apply it once, then again.
    // Assert: the doc bytes are identical after the duplicate.
    // Covers US-009 AC-3 (idempotent on duplicates).
    const A = await loadAutomerge();
    const base = A.from<CountsDoc>({ counts: {} });
    const edited = A.change(base, (d) => {
      d.counts.x = 9;
    });
    const change = A.getChanges(base, edited);
    await assertIdempotent(base, change);
  });

  // ── US-026 / #63 — sortKey reorder convergence (PLAN §5.3) ────────────────
  // Reorder is now a per-field `sortKey` update, not a JSON-copy splice. The
  // splice removed the moved Automerge object and re-inserted a plain copy, so a
  // concurrent edit to the moved item (or a second concurrent splice) was lost.
  // These tests prove the NOW-ACHIEVABLE same-section convergence: concurrent
  // reorders within one section land deterministically with no lost edits, and a
  // concurrent edit to a MOVED item survives.

  // Seed a routine with explicit ascending sortKeys: 3 sections; section s2 holds
  // 3 placements p1<p2<p3.
  const seedReorderRoutine = (): RoutineDoc => {
    const sk = sequentialKeys(3);
    const pk = sequentialKeys(3);
    return {
      id: "r1",
      title: "Routine",
      dance: "waltz",
      ownerId: "u1",
      sections: [
        { id: "s1", name: "Intro", placements: [], sortKey: sk[0], deletedAt: null },
        {
          id: "s2",
          name: "Middle",
          sortKey: sk[1],
          placements: [
            { id: "p1", figureRef: "f1", sortKey: pk[0], deletedAt: null },
            { id: "p2", figureRef: "f2", sortKey: pk[1], deletedAt: null },
            { id: "p3", figureRef: "f3", sortKey: pk[2], deletedAt: null },
          ],
          deletedAt: null,
        },
        { id: "s3", name: "Finale", placements: [], sortKey: sk[2], deletedAt: null },
      ],
      annotations: [],
      schemaVersion: 3,
      deletedAt: null,
    };
  };

  it("converges two replicas reordering DIFFERENT placements in the SAME section (#63)", async () => {
    // The case the JSON-copy splice could not do: two clients reorder placements
    // in the SAME section offline, then merge. Each reorder is a per-field write
    // on a distinct object, so BOTH land and the replicas converge to one
    // deterministic order with no lost edits.
    const base = buildRoutineDoc(seedReorderRoutine());
    const ps = sectionById(readRoutine(base), "s2").placements;
    const k0 = keyOf(ps[0], "p1");
    const k2 = keyOf(ps[2], "p3");

    // L: move p1 to the end (after p3).
    const left = await applyMutations(base, [
      (d: RoutineDoc) => {
        placementById(sectionById(d, "s2"), "p1").sortKey = keyBetween(k2, null);
      },
    ]);
    // R: move p3 to the front (before p1).
    const right = await applyMutations(base, [
      (d: RoutineDoc) => {
        placementById(sectionById(d, "s2"), "p3").sortKey = keyBetween(null, k0);
      },
    ]);

    const { converged } = await exchangeAndAssertConverged(left, right);
    const order = sectionById(readRoutine(converged), "s2").placements.map((p) => p.id);
    expect(order).toEqual(["p3", "p2", "p1"]);
  });

  it("keeps a concurrent edit to a MOVED placement (the object is never deleted)", async () => {
    // The splice deleted the moved placement's object and re-inserted a copy — a
    // concurrent edit to it was lost. sortKey moves it in place, so a concurrent
    // perPlacementAlignment edit on the SAME, moved placement survives the merge.
    const base = buildRoutineDoc(seedReorderRoutine());
    const k2 = keyOf(sectionById(readRoutine(base), "s2").placements[2], "p3");

    // L: reorder p1 to the end.
    const left = await applyMutations(base, [
      (d: RoutineDoc) => {
        placementById(sectionById(d, "s2"), "p1").sortKey = keyBetween(k2, null);
      },
    ]);
    // R: edit that SAME placement's alignment concurrently.
    const right = await applyMutations(base, [
      (d: RoutineDoc) => {
        placementById(sectionById(d, "s2"), "p1").perPlacementAlignment = {
          qualifier: "facing",
          direction: "LOD",
        };
      },
    ]);

    const { converged } = await exchangeAndAssertConverged(left, right);
    const s2 = sectionById(readRoutine(converged), "s2");
    // p1 moved to the end (L) AND carries R's alignment edit (no lost edit).
    expect(s2.placements.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
    expect(placementById(s2, "p1").perPlacementAlignment).toEqual({
      qualifier: "facing",
      direction: "LOD",
    });
  });

  it("converges two replicas moving the SAME placement (LWW on sortKey, no divergence)", async () => {
    // Two concurrent moves of the SAME placement: Automerge LWW picks one sortKey
    // deterministically, so BOTH replicas converge to the same order (the old
    // double-splice could clobber the array into divergent states).
    const base = buildRoutineDoc(seedReorderRoutine());
    const ps = sectionById(readRoutine(base), "s2").placements;
    const k0 = keyOf(ps[0], "p1");
    const k2 = keyOf(ps[2], "p3");

    const left = await applyMutations(base, [
      (d: RoutineDoc) => {
        placementById(sectionById(d, "s2"), "p2").sortKey = keyBetween(k2, null); // p2 → end
      },
    ]);
    const right = await applyMutations(base, [
      (d: RoutineDoc) => {
        placementById(sectionById(d, "s2"), "p2").sortKey = keyBetween(null, k0); // p2 → front
      },
    ]);

    // exchangeAndAssertConverged asserts both replicas reach identical heads.
    const { left: ml, right: mr } = await exchangeAndAssertConverged(left, right);
    const orderL = sectionById(readRoutine(ml), "s2").placements.map((p) => p.id);
    const orderR = sectionById(readRoutine(mr), "s2").placements.map((p) => p.id);
    expect(orderL).toEqual(orderR); // deterministic — no divergence
    expect([...orderL].sort()).toEqual(["p1", "p2", "p3"]); // no lost placements
  });

  it("converges a SECTION reorder + self-edit with a concurrent soft-DELETE of another (US-026 AC-3)", async () => {
    // The original US-026 AC-3 case, now sortKey-based: A reorders sections (moves
    // s1 to the end) AND renames it; B soft-deletes a DIFFERENT section (s3). Both
    // land, replicas converge, B's delete is a tombstone (not a removal), and —
    // unlike the old splice — A's rename on the MOVED section is NOT lost.
    const base = buildRoutineDoc(seedReorderRoutine());
    const sectionKeys = readRoutine(base).sections.map((s) => keyOf(s, s.id));
    const lastSectionKey = sectionKeys[sectionKeys.length - 1] ?? null;

    const left = await applyMutations(base, [
      (d: RoutineDoc) => {
        const s1 = sectionById(d, "s1");
        s1.sortKey = keyBetween(lastSectionKey, null); // move after s3
        s1.name = "Outro"; // self-edit on the moved section
      },
    ]);
    const right = await applyMutations(base, [
      (d: RoutineDoc) => {
        sectionById(d, "s3").deletedAt = Date.now(); // tombstone flip in place
      },
    ]);

    const { converged } = await exchangeAndAssertConverged(left, right);

    // A's order holds (s1 after s2) + rename kept; B's delete holds (s3 dropped).
    const live = readRoutine(converged);
    expect(live.sections.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(sectionById(live, "s1").name).toBe("Outro");

    // s3 stays TOMBSTONED (a flip, not a hard removal) — visible with includeDeleted.
    const all = readRoutine(converged, { includeDeleted: true });
    expect(sectionById(all, "s3").deletedAt).toBeTruthy();
    expect(all.sections.map((s) => s.id).sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("converges shuffled/partitioned changes across a fork (cloned doc)", async () => {
    // Intent: convergence holds even when changes are made on a CLONED (forked) doc and
    //   merged back — the fork shares history so merges remain conflict-free.
    // Multi-actor scenario: a base doc is cloned; the origin and the clone each get
    //   disjoint edits offline, then the clone's changes are merged into the origin.
    // Arrange: from a common base, derive replica `origin` and a `clone` (A.merge into a
    //   fresh init = a shared-history copy). Act: edit each independently. Assert:
    //   exchangeAndAssertConverged → byte-identical and BOTH edits survive.
    // Covers US-009 AC-4 (convergence holds across forks incl. cloned docs).
    const A = await loadAutomerge();
    const base = A.from<CountsDoc>({ counts: { seed: 0 } });
    const clone = A.merge(A.init<CountsDoc>(), base); // shared-history clone
    const origin = await applyMutations(base, [(d: CountsDoc) => (d.counts.origin = 1)]);
    const forked = await applyMutations(clone, [(d: CountsDoc) => (d.counts.forked = 2)]);
    const { converged } = await exchangeAndAssertConverged(origin, forked);
    expect(converged.counts).toMatchObject({ seed: 0, origin: 1, forked: 2 });
  });
});
