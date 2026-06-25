import { describe, expect, it } from "vitest";
import { importDomain } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-013 — Migration ladder (schemaVersion) [M1, system/developer]
// PLAN §2.1, §7, §10.2 invariant: "migration ladder". Every doc carries a
// schemaVersion; an ordered chain upgrades older docs; unknown values survive;
// migrating a current doc is a no-op. Used by JSON import (US-048).
//
// Product `migrate`/`CURRENT_SCHEMA_VERSION` (M1) don't exist yet → dynamic
// import, skipped.
// ─────────────────────────────────────────────────────────────────────────

describe.skip("US-013 Migration ladder (schemaVersion)", () => {
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
});
