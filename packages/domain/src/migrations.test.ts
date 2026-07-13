import { describe, expect, it } from "vitest";
import { z } from "zod";
import { importDomain } from "./__fixtures__";
import { type MigrationStep, runLadder } from "./migrations";

// ─────────────────────────────────────────────────────────────────────────
// US-013 — Migration ladder (schemaVersion) [M1, system/developer]
// PLAN §2.1, §7, §10.2 invariant: "migration ladder". Every doc carries a
// schemaVersion; an ordered chain upgrades older docs; unknown values survive;
// migrating a current doc is a no-op. Used by JSON import (US-048).
//
// Product `migrate`/`CURRENT_SCHEMA_VERSION` (M1) don't exist yet → dynamic
// import, skipped.
// ─────────────────────────────────────────────────────────────────────────

describe("US-013 Migration ladder (schemaVersion)", () => {
  it("upgrades an older-version doc through the ordered ladder to current", async () => {
    // Intent: a v(N-1) doc migrates to the current schemaVersion.
    // Arrange: a routine-shaped doc tagged schemaVersion: 1 (older).
    // Act: migrate(doc). Assert: result.schemaVersion === CURRENT_SCHEMA_VERSION
    //   and is ≥ the input version.
    // Covers US-013 AC-1 (schemaVersion present) + AC-2 (ordered chain upgrades).
    const { migrate, CURRENT_SCHEMA_VERSION } = await importDomain();
    const old = { schemaVersion: 1, kind: "routine", title: "Old", sections: [] };
    const migrated = migrate(old);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("preserves unknown attribute values across a migration (no data loss)", async () => {
    // Intent: a forward-compatible value survives the migration ladder.
    // Arrange: an older doc carrying an unknown attribute value.
    // Act: migrate(doc). Assert: the unknown value is still present afterwards.
    // Covers US-013 AC-3 (unknown values survive).
    const { migrate } = await importDomain();
    const old = {
      schemaVersion: 1,
      kind: "figure",
      attributes: [{ id: "a1", kind: "step", count: 1, value: "FUTURE_VALUE" }],
    };
    const migrated = migrate(old);
    const attributes = z.array(z.object({ value: z.string() })).parse(migrated.attributes);
    expect(attributes[0]?.value).toBe("FUTURE_VALUE");
  });

  it("is a no-op when the doc is already at the current version", async () => {
    // Intent: re-migrating a current doc changes nothing (idempotent ladder).
    // Arrange: a doc at CURRENT_SCHEMA_VERSION. Act: migrate it.
    // Assert: deeply equal to the input.
    // Covers US-013 AC-4 (already-current is a no-op).
    const { migrate, CURRENT_SCHEMA_VERSION } = await importDomain();
    const current = { schemaVersion: CURRENT_SCHEMA_VERSION, kind: "routine", sections: [] };
    expect(migrate(current)).toEqual(current);
  });

  // ── Extra edge cases (in the spirit of US-013, beyond the listed ACs) ──

  it("preserves figureType across a migration (immutable identity, #91/#92)", async () => {
    // Intent: figureType is an immutable family identity — a migration must never
    // rewrite it (US-011/US-041 rely on it). Pin that it survives migrate().
    const { migrate } = await importDomain();
    const fig = {
      schemaVersion: 1,
      kind: "figure",
      figureType: "feather",
      dance: "foxtrot",
      attributes: [],
    };
    expect(migrate(fig).figureType).toBe("feather");
  });

  it("runs the ladder in order across multiple versions (synthetic ladder)", () => {
    // Intent: prove the ladder machinery iterates v→v+1 to the target. Production
    // has no v2 step yet (CURRENT=1), so exercise the mechanism with a fake ladder.
    const ladder: Record<number, MigrationStep> = {
      1: (d) => ({ ...d, steppedFrom1: true }),
      2: (d) => ({ ...d, steppedFrom2: true }),
    };
    const result = runLadder({ schemaVersion: 1, x: "keep" }, ladder, 3);
    expect(result.schemaVersion).toBe(3);
    expect(result.steppedFrom1).toBe(true);
    expect(result.steppedFrom2).toBe(true);
    expect(result.x).toBe("keep"); // untouched fields survive
  });

  it("throws if a migration step rewrites figureType (guard fires)", () => {
    // Intent: the immutability invariant is structurally enforced — a buggy step
    // that changes figureType is rejected, not silently applied.
    const badLadder: Record<number, MigrationStep> = {
      1: (d) => ({ ...d, figureType: "hacked" }),
    };
    expect(() => runLadder({ schemaVersion: 1, figureType: "feather" }, badLadder, 2)).toThrow(
      /figureType is immutable/,
    );
  });

  it("throws if a migration step rewrites dance (guard fires)", () => {
    // Intent: `dance` is also a copied-not-resolved identity field that family-note
    // matching depends on (matchesFigureType gates on danceScope === figure.dance),
    // so rewriting it would silently break this-dance notes. Same guard as figureType.
    const badLadder: Record<number, MigrationStep> = {
      1: (d) => ({ ...d, dance: "waltz" }),
    };
    expect(() => runLadder({ schemaVersion: 1, dance: "foxtrot" }, badLadder, 2)).toThrow(
      /dance is immutable/,
    );
  });

  it("treats an untagged doc as v1", () => {
    // Intent: a doc with no schemaVersion is migrated from the earliest version.
    const ladder: Record<number, MigrationStep> = { 1: (d) => ({ ...d, upgraded: true }) };
    const result = runLadder({ kind: "figure" }, ladder, 2);
    expect(result.schemaVersion).toBe(2);
    expect(result.upgraded).toBe(true);
  });

  // ── v3 → v4: assign sortKeys to sections + placements (#63, PLAN §5.3) ──
  // (migrate() applies the full ladder, so a v2 doc lands at v4 with sortKeys.)

  it("assigns ascending sortKeys to sections and placements in array order (#63)", async () => {
    const { migrate, CURRENT_SCHEMA_VERSION } = await importDomain();
    const routine = {
      schemaVersion: 2,
      sections: [
        {
          id: "s1",
          name: "Intro",
          placements: [
            { id: "p1", figureRef: "f1" },
            { id: "p2", figureRef: "f2" },
          ],
        },
        { id: "s2", name: "Body", placements: [] },
      ],
    };
    const migrated = z
      .object({
        schemaVersion: z.number(),
        sections: z.array(
          z.object({
            id: z.string(),
            sortKey: z.string().optional(),
            placements: z.array(z.object({ sortKey: z.string().optional() })),
          }),
        ),
      })
      .parse(migrate(routine));
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // Sections keyed in array order (ascending).
    const sk = migrated.sections.map((s) => s.sortKey);
    expect(sk.every((k) => typeof k === "string")).toBe(true);
    expect(String(sk[0]) < String(sk[1])).toBe(true);
    // Placements within s1 keyed in array order (ascending).
    const pk = (migrated.sections[0]?.placements ?? []).map((p) => p.sortKey);
    expect(pk.every((k) => typeof k === "string")).toBe(true);
    expect(String(pk[0]) < String(pk[1])).toBe(true);
  });

  it("is deterministic — two migrations of the same doc assign identical sortKeys", async () => {
    // Both replicas migrate the same persisted bytes, so the backfill converges.
    const { migrate } = await importDomain();
    const doc = () => ({
      schemaVersion: 2,
      sections: [
        { id: "s1", name: "A", placements: [{ id: "p1", figureRef: "f1" }] },
        { id: "s2", name: "B", placements: [] },
      ],
    });
    expect(migrate(doc())).toEqual(migrate(doc()));
  });

  it("does not inject sortKey/placements onto a doc that lacks sections (figure doc)", async () => {
    // Automerge can't store undefined: a figure doc (no `sections`) must pass the
    // v3→v4 step with the version bump alone — no spurious keys.
    const { migrate, CURRENT_SCHEMA_VERSION } = await importDomain();
    const figure = { schemaVersion: 2, figureType: "feather", dance: "foxtrot", attributes: [] };
    const migrated = migrate(figure);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect("sections" in migrated).toBe(false);
    expect("sortKey" in migrated).toBe(false);
  });

  it("preserves an existing sortKey rather than overwriting it (idempotent)", async () => {
    const { migrate } = await importDomain();
    const routine = {
      schemaVersion: 2,
      sections: [{ id: "s1", name: "A", sortKey: "PRESET", placements: [] }],
    };
    const migrated = z
      .object({ sections: z.array(z.object({ sortKey: z.string().optional() })) })
      .parse(migrate(routine));
    expect(migrated.sections[0]?.sortKey).toBe("PRESET");
  });

  it("strips a stray `overlay` key from an old doc on migration (v2→v3)", async () => {
    // Intent: the `Overlay` type and `overlay?` field on `FigureDoc` are retired
    // (§5.2, §2.5.1 #14–18). Old persisted docs may carry a stray `overlay` key.
    // The v2→v3 step must silently strip it so it does not linger; attributes and
    // identity fields must survive intact. CRITICAL: the strip must NEVER assign
    // `undefined` (Automerge cannot store it) — it builds a new object without
    // the key instead.
    const { migrate, CURRENT_SCHEMA_VERSION } = await importDomain();

    // A v1 figure doc that previously had an overlay (the pre-v2 shape).
    const oldFigure = {
      schemaVersion: 1,
      figureType: "natural-turn",
      dance: "waltz",
      attributes: [{ id: "a1", kind: "footwork", count: 1, value: "HT" }],
      overlay: {
        overrides: { a1: "T" },
        tombstones: [],
        additions: [{ id: "v1", kind: "sway", count: 2, value: "left" }],
        rename: "My Natural Turn",
      },
    };
    const migrated = migrate(oldFigure);

    // Migrated to current version.
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    // overlay key is gone — not set to undefined, just absent.
    expect("overlay" in migrated).toBe(false);

    // Automerge-safety: no undefined values written.
    for (const v of Object.values(migrated)) {
      expect(v).not.toBeUndefined();
    }

    // Identity fields and attributes survive intact.
    expect(migrated.figureType).toBe("natural-turn");
    expect(migrated.dance).toBe("waltz");
    expect(z.array(z.object({ id: z.string() })).parse(migrated.attributes)[0]?.id).toBe("a1");
  });

  it("strips overlay from a v2 doc that was migrated before the overlay-removal step", async () => {
    // Intent: docs already at schemaVersion 2 (migrated before this PR) may still
    // carry a stray `overlay` key. The v2→v3 step must strip it on read.
    const { migrate, CURRENT_SCHEMA_VERSION } = await importDomain();

    const v2DocWithOverlay = {
      schemaVersion: 2,
      figureType: "feather",
      dance: "foxtrot",
      attributes: [],
      overlay: { overrides: {}, tombstones: [], additions: [] },
    };
    const migrated = migrate(v2DocWithOverlay);

    // migrate() runs to CURRENT: the overlay strip happens at the v2→v3 step.
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect("overlay" in migrated).toBe(false);
    expect(migrated.figureType).toBe("feather");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// v5 milestone step 1 (PLAN §7) — `migrateDraft`: the DO-load-path
// draft-mutating counterpart of `migrate`, called inside an Automerge
// `A.change`. Exercised here against plain mutable objects (a Draft duck-types
// as a plain object for get/set/delete/enumerate — see `proxies.js`'s
// `ownKeys`/`getOwnPropertyDescriptor` traps — so a plain-object test proves
// the same write-back logic the DO relies on).
// ─────────────────────────────────────────────────────────────────────────

describe("migrateDraft (v5 milestone step 1 — DO load path)", () => {
  it("mutates a v1 draft in place to the same result migrate() would compute", async () => {
    const { migrate, migrateDraft, CURRENT_SCHEMA_VERSION } = await importDomain();
    const shape = () => ({
      schemaVersion: 1,
      figureType: "natural-turn",
      dance: "waltz",
      attributes: [{ id: "a1", kind: "step", count: 1, value: "H" }],
    });
    const draft = shape();
    migrateDraft(draft);
    expect(draft.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrate(shape())).toEqual(draft);
  });

  it("is a total no-op — no key is written — when the draft is already current", async () => {
    const { migrateDraft, CURRENT_SCHEMA_VERSION } = await importDomain();
    const target = { schemaVersion: CURRENT_SCHEMA_VERSION, kind: "routine", sections: [] };
    // A Proxy that throws on any write/delete trap: proves migrateDraft performs
    // ZERO mutations on an already-current doc (PLAN §7: "no empty change, no
    // version downgrade" — the enclosing A.change must produce nothing to persist).
    const guarded = new Proxy(target, {
      set() {
        throw new Error("migrateDraft wrote to an already-current draft");
      },
      deleteProperty() {
        throw new Error("migrateDraft deleted a key on an already-current draft");
      },
    });
    expect(() => migrateDraft(guarded)).not.toThrow();
    expect(target).toEqual({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: "routine",
      sections: [],
    });
  });

  it("leaves an untouched sub-tree's object identity alone (only changed keys are written)", async () => {
    const { migrateDraft, CURRENT_SCHEMA_VERSION } = await importDomain();
    // schemaVersion 3 → 4 only backfills sortKeys; a figure-shaped draft (no
    // `sections`) has nothing for the v3→v4 step to do, so `attributes` must
    // survive as the SAME array reference (never rebuilt/reassigned).
    const attributes = [{ id: "a1", kind: "footwork", count: 1, value: "H" }];
    const draft = {
      schemaVersion: 3,
      figureType: "feather",
      dance: "foxtrot",
      attributes,
    };
    migrateDraft(draft);
    expect(draft.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(draft.attributes).toBe(attributes); // untouched — same reference
  });

  it("deletes a stripped key (v2→v3 overlay) rather than assigning undefined", async () => {
    const { migrateDraft } = await importDomain();
    const draft = {
      schemaVersion: 2,
      figureType: "feather",
      dance: "foxtrot",
      attributes: [],
      overlay: { overrides: {}, tombstones: [], additions: [] },
    };
    migrateDraft(draft);
    expect("overlay" in draft).toBe(false);
    for (const v of Object.values(draft)) expect(v).not.toBeUndefined();
  });

  it("is deterministic — migrating two identically-shaped drafts yields identical output", async () => {
    const { migrateDraft } = await importDomain();
    const shape = () => ({
      schemaVersion: 2,
      sections: [
        { id: "s1", name: "A", placements: [{ id: "p1", figureRef: "f1" }] },
        { id: "s2", name: "B", placements: [] },
      ],
    });
    const d1 = shape();
    const d2 = shape();
    migrateDraft(d1);
    migrateDraft(d2);
    expect(d1).toEqual(d2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Builder v3 ① (owner-approved 2026-07-07) — v4→v5: counts-based figure length.
// A figure doc's authored `bars` becomes `counts = bars × beatsPerBar` (the
// dance's), and the legacy `bars` key is dropped. Routine/account docs (no
// `bars`) pass through with the version bump alone.
// ─────────────────────────────────────────────────────────────────────────
describe("migration v4→v5 — bars → counts (Builder v3 ①)", () => {
  it("converts a Waltz figure's bars to counts (× 3) and drops bars", async () => {
    const { migrate, CURRENT_SCHEMA_VERSION } = await importDomain();
    const v4Figure = {
      schemaVersion: 4,
      figureType: "natural-turn",
      dance: "waltz",
      attributes: [],
      bars: 2,
    };
    const migrated = migrate(v4Figure);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.counts).toBe(6); // 2 bars × 3 beats
    expect("bars" in migrated).toBe(false);
  });

  it("uses the figure's own dance meter (Quickstep 4/4 → × 4)", async () => {
    const { migrate } = await importDomain();
    const migrated = migrate({
      schemaVersion: 4,
      figureType: "quarter-turn",
      dance: "quickstep",
      attributes: [],
      bars: 3,
    });
    expect(migrated.counts).toBe(12);
  });

  it("leaves a routine doc untouched but for the version bump", async () => {
    const { migrate, CURRENT_SCHEMA_VERSION } = await importDomain();
    const routine = { schemaVersion: 4, sections: [], annotations: [] };
    const migrated = migrate(routine);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect("counts" in migrated).toBe(false);
  });

  it("never double-converts: a figure already carrying counts keeps it", async () => {
    const { migrate } = await importDomain();
    const migrated = migrate({
      schemaVersion: 4,
      figureType: "whisk",
      dance: "waltz",
      attributes: [],
      bars: 2,
      counts: 5, // authored by a newer client pre-migration
    });
    expect(migrated.counts).toBe(5);
    expect("bars" in migrated).toBe(false);
  });

  it("clamps a huge legacy bars value to the 64-count ceiling (§2.5.2 invariant)", async () => {
    const { migrate } = await importDomain();
    // 30 bars × 4 beats = 120 counts pre-clamp — must not exceed the authored
    // 1–64 bound the create schema and the LENGTH stepper both enforce.
    const migrated = migrate({
      schemaVersion: 4,
      figureType: "long-figure",
      dance: "foxtrot",
      attributes: [],
      bars: 30,
    });
    expect(migrated.counts).toBe(64);
  });
});
