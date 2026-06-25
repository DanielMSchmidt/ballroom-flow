import { describe, expect, it } from "vitest";
import { importDomain } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-001 — ULID id generation [M1, system/developer]
// PLAN §2.1, §10.2 invariant: "all ids are client-generated ULIDs".
//
// These prove the id primitive every document shape depends on. Product module
// `@ballroom/domain` does not export `newId`/`ids` yet (M1 §9 1.1), so the body
// dynamic-imports it; until then the suite is skipped (GREEN).
//
// RED→GREEN: implement `ids.ts` exporting `newId(): string` (a ULID) so each
// assertion below passes, then remove `.skip`.
// ─────────────────────────────────────────────────────────────────────────

describe.skip("US-001 ULID id generation", () => {
  it("generates a valid 26-char Crockford-base32 ULID", async () => {
    // Intent: every entity id is a syntactically valid ULID.
    // Scenario: the system mints one id (no user, no network).
    // Arrange: import the id factory. Act: mint one id.
    // Assert: 26 chars, Crockford base32 alphabet (no I,L,O,U).
    // Covers AC-1 "valid 26-char ULID".
    const { newId } = await importDomain();
    const id = newId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("mints monotonically sortable ids in creation order", async () => {
    // Intent: ids sort lexicographically by creation time (US-001 AC-2).
    // Scenario: system mints a sequence within the same millisecond.
    // Arrange: import factory. Act: mint N ids in a tight loop.
    // Assert: the array is already in sorted order (monotonic ULID).
    // Covers AC-2 "sort lexicographically by creation time (monotonic)".
    const { newId } = await importDomain();
    const ids = Array.from({ length: 1000 }, () => newId());
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("does not collide across two independent generators (two clients)", async () => {
    // Intent: client-generated ids are collision-free in practice (AC-3).
    // Multi-actor scenario: two clients mint ids independently, offline.
    // Arrange: import factory. Act: mint two large id sets.
    // Assert: the union has no duplicates.
    // Covers AC-3 "generated client-side; two clients never collide".
    const { newId } = await importDomain();
    const a = Array.from({ length: 5000 }, () => newId());
    const b = Array.from({ length: 5000 }, () => newId());
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
  });
});
