import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyMutations,
  assertCommutative,
  assertIdempotent,
  exchangeAndAssertConverged,
  loadAutomerge,
} from "./__fixtures__";

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
    // Intent: shuffled independent changes converge to one doc (commutativity).
    // Multi-actor scenario: a sequence of independent attribute writes.
    // Arrange (property): a random list of unique-key writes. Act: capture each
    //   as a discrete Automerge change off a common base. Assert: applying the
    //   change set in forward vs reversed order yields byte-identical docs.
    // Covers US-009 AC-1 (different orders converge; commutative).
    const A = await loadAutomerge();
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.tuple(fc.string({ minLength: 1, maxLength: 4 }), fc.integer()), {
          minLength: 1,
          maxLength: 8,
          selector: ([k]) => k,
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
