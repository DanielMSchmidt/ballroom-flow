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
import type { RoutineDoc } from "./doc-types";

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

  it("converges a section REORDER on one client with a soft-DELETE on another (US-026 AC-3)", async () => {
    // Intent: two replicas of a routine — client A reorders sections, client B
    //   soft-deletes a DIFFERENT section — merge with no lost edits: the order A
    //   chose holds, the section B deleted stays tombstoned, both replicas converge.
    // Multi-actor scenario: A and B edit the same routine offline, then reconnect.
    //
    // HONEST LIMITATION (#63): the store's `moveSection` reorder is a JSON-copy
    //   splice — it removes the moved section's Automerge object and re-inserts a
    //   PLAIN COPY (a new object). So a concurrent edit to the SAME section being
    //   moved would be lost (the open sortKey work). This test asserts the
    //   ACHIEVABLE converged state: A and B touch DIFFERENT sections, which is the
    //   case that must converge cleanly — and does.
    const seed: RoutineDoc = {
      id: "r1",
      title: "Routine",
      dance: "waltz",
      ownerId: "u1",
      sections: [
        { id: "s1", name: "Intro", placements: [], deletedAt: null },
        { id: "s2", name: "Middle", placements: [], deletedAt: null },
        { id: "s3", name: "Finale", placements: [], deletedAt: null },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    const base = buildRoutineDoc(seed);

    // Client A: reorder — move s1 to the end via the store's JSON-copy splice.
    const left = await applyMutations(base, [
      (d: RoutineDoc) => {
        const i = d.sections.findIndex((s) => s.id === "s1");
        const moved = JSON.parse(JSON.stringify(d.sections[i]));
        d.sections.splice(i, 1);
        d.sections.push(moved);
      },
    ]);

    // Client B: soft-delete a DIFFERENT section (s3) — a tombstone flip in place.
    const right = await applyMutations(base, [
      (d: RoutineDoc) => {
        const s = d.sections.find((sec) => sec.id === "s3");
        if (s) s.deletedAt = Date.now();
      },
    ]);

    const { converged } = await exchangeAndAssertConverged(left, right);

    // No lost edits: A's order holds (s1 moved after s2), B's delete holds (s3 gone
    // from the default read), s2 untouched.
    const live = readRoutine(converged);
    expect(live.sections.map((s) => s.id)).toEqual(["s2", "s1"]);

    // The deleted section stays TOMBSTONED (not hard-removed) — visible only with
    // includeDeleted, carrying its deletedAt.
    const all = readRoutine(converged, { includeDeleted: true });
    const s3 = all.sections.find((s) => s.id === "s3");
    expect(s3?.deletedAt).toBeTruthy();
    // All three sections survive in the doc (B's delete is a flip, not a removal).
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
