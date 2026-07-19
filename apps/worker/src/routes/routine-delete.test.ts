import { SELF } from "cloudflare:test";
import { zRoutineList } from "@weavesteps/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-025 — Delete a routine from the Choreo overview [M3, user]
// docs/concepts/collaboration.md; docs/concepts/figures.md § The library screen.
// The REST surface behind the Choreo-card ⋯ → Delete: an OWNER
// soft-deletes (tombstones) their routine; an editor/commenter/viewer cannot.
// Soft-delete only (deletedAt) — the row is never hard-removed, and the deleted
// routine drops out of GET /api/routines.
// ─────────────────────────────────────────────────────────────────────────

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

/** The viewer's listed routine docRefs (mirrors the Choreo list read). */
async function listDocRefs(headers: Record<string, string>): Promise<string[]> {
  const res = await SELF.fetch("https://x/api/routines", { headers });
  expect(res.status).toBe(200);
  const body = zRoutineList.parse(await res.json());
  return body.routines.map((r) => r.docRef);
}

/** Read a routine's `deletedAt` tombstone straight from D1. */
async function deletedAt(docRef: string): Promise<number | null> {
  const { env } = await import("cloudflare:test");
  const row = await env.DB.prepare("SELECT deletedAt FROM document_registry WHERE docRef = ?")
    .bind(docRef)
    .first<{ deletedAt: number | null }>();
  return row?.deletedAt ?? null;
}

describe("US-025 Delete a routine", () => {
  it("lets the owner soft-delete their routine (drops out of the list)", async () => {
    // Intent: an owner deletes a routine; it's tombstoned, not hard-removed, and
    //   disappears from their Choreo list. Covers the delete-flow happy path.
    const docRef = "rt_del_owner";
    const owner = await authedContext({ keypair: kp, userId: "u_own", docRef, role: "editor" });
    await seedDb({
      users: [{ id: "u_own", displayName: "Own", identityColor: "#111", plan: "free" }],
      // ownerId === the actor → resolveEffectiveRole elevates to "owner" (canDelete).
      docs: [{ docRef, type: "routine", ownerId: "u_own", doName: docRef, title: "Doomed" }],
      memberships: owner.membership ? [owner.membership] : [],
    });

    expect(await listDocRefs(owner.authHeaders())).toContain(docRef);

    const res = await SELF.fetch(`https://x/api/routines/${docRef}`, {
      method: "DELETE",
      headers: owner.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Soft-delete: the row survives with a deletedAt tombstone, and the list omits it.
    expect(await deletedAt(docRef)).toBeTypeOf("number");
    expect(await listDocRefs(owner.authHeaders())).not.toContain(docRef);
  });

  it("forbids a non-owner member (editor) from deleting", async () => {
    // Intent: only the owner may delete; a shared-in EDITOR is refused (403) and the
    //   routine is untouched. Covers the owner-only (canDelete) gate.
    const docRef = "rt_del_editor";
    const editor = await authedContext({ keypair: kp, userId: "u_ed", docRef, role: "editor" });
    await seedDb({
      users: [
        { id: "u_owner2", displayName: "O2", identityColor: "#111", plan: "free" },
        { id: "u_ed", displayName: "Ed", identityColor: "#222", plan: "free" },
      ],
      docs: [{ docRef, type: "routine", ownerId: "u_owner2", doName: docRef, title: "Shared" }],
      memberships: editor.membership ? [editor.membership] : [],
    });

    const res = await SELF.fetch(`https://x/api/routines/${docRef}`, {
      method: "DELETE",
      headers: editor.authHeaders(),
    });
    expect(res.status).toBe(403);
    expect(await deletedAt(docRef)).toBeNull();
  });

  it("forbids a non-member from deleting", async () => {
    // Intent: a valid token with no membership on the doc can't delete it (403).
    const docRef = "rt_del_nonmember";
    const stranger = await authedContext({ keypair: kp, userId: "u_str", docRef, role: null });
    await seedDb({
      users: [{ id: "u_owner3", displayName: "O3", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_owner3", doName: docRef, title: "Theirs" }],
    });

    const res = await SELF.fetch(`https://x/api/routines/${docRef}`, {
      method: "DELETE",
      headers: stranger.authHeaders(),
    });
    expect(res.status).toBe(403);
    expect(await deletedAt(docRef)).toBeNull();
  });

  it("rejects an unauthenticated delete (401)", async () => {
    const res = await SELF.fetch("https://x/api/routines/rt_whatever", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("404s an unknown / already-deleted routine for the owner", async () => {
    // Intent: deleting a routine that doesn't exist (or is already tombstoned)
    //   resolves to 404 once it's gone — never a phantom 200. The owner is elevated
    //   via ownerId even though the registry row is tombstoned (ownerOf ignores it).
    const docRef = "rt_del_twice";
    const owner = await authedContext({ keypair: kp, userId: "u_tw", docRef, role: "editor" });
    await seedDb({
      users: [{ id: "u_tw", displayName: "Tw", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_tw", doName: docRef, title: "Once" }],
      memberships: owner.membership ? [owner.membership] : [],
    });

    const first = await SELF.fetch(`https://x/api/routines/${docRef}`, {
      method: "DELETE",
      headers: owner.authHeaders(),
    });
    expect(first.status).toBe(200);

    const second = await SELF.fetch(`https://x/api/routines/${docRef}`, {
      method: "DELETE",
      headers: owner.authHeaders(),
    });
    expect(second.status).toBe(404);
  });
});
