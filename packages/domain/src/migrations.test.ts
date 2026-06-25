import { describe, expect, it } from "vitest";
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
    const migrated = migrate(old) as unknown as { attributes: Array<{ value: unknown }> };
    expect(migrated.attributes[0]?.value).toBe("FUTURE_VALUE");
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
    expect((migrate(fig) as { figureType?: string }).figureType).toBe("feather");
  });

  it("runs the ladder in order across multiple versions (synthetic ladder)", () => {
    // Intent: prove the ladder machinery iterates v→v+1 to the target. Production
    // has no v2 step yet (CURRENT=1), so exercise the mechanism with a fake ladder.
    const ladder: Record<number, MigrationStep> = {
      1: (d) => ({ ...d, steppedFrom1: true }),
      2: (d) => ({ ...d, steppedFrom2: true }),
    };
    const result = runLadder({ schemaVersion: 1, x: "keep" }, ladder, 3) as Record<string, unknown>;
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
    const result = runLadder({ kind: "figure" }, ladder, 2) as Record<string, unknown>;
    expect(result.schemaVersion).toBe(2);
    expect(result.upgraded).toBe(true);
  });
});
