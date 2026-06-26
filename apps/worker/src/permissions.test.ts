import { env, runInDurableObject } from "cloudflare:test";
import { capabilitiesFor } from "@ballroom/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "./test-support/authed-context";
import { uniqueDocName } from "./test-support/do-id";
import type { DocNamespace } from "./test-support/doc-do-api";
import { generateTestKeypair, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-020 — Per-document membership & roles [M3, system]
// US-021 — Permission boundary at the DO connection [M3, system]
//
// PLAN §5.1, §6, §10.2: "permission per document at the boundary —
// editor/commenter/viewer/non-member/forged-connection on a routine doc AND on
// a figure doc". Enforcement is at the DO sync connection (Clerk JWT verify +
// D1 role lookup), NEVER post-hoc CRDT-cell rejection.
//
// US-020 (below) is implemented: the membership table + the pure capability
// model (@ballroom/domain) + the DO's transitional membership gate (an
// authenticated non-member is rejected per-doc). The US-021 block stays skipped
// — it makes the boundary fail-closed (token REQUIRED) + refuses a viewer's
// writes on the socket. CLERK_JWT_KEY is the static test PEM (vitest.config.ts).
//
// MANDATORY isolatedStorage:false → unique DO ids (uniqueDocName).
// ─────────────────────────────────────────────────────────────────────────

const docs = env.DOC_DO as unknown as DocNamespace;
let kp: TestKeypair;

beforeAll(async () => {
  await applyMigrations();
  // CLERK_JWT_KEY is bound statically (vitest.config.ts → the fixed test PEM,
  // US-019); generateTestKeypair() returns that keypair so verifyToken({ jwtKey })
  // verifies our minted tokens networklessly.
  kp = await generateTestKeypair();
});

/**
 * Open a sync connection to a doc DO with the given headers. Forwards the doc
 * name via `x-doc-name` exactly as the real Worker connect route does (the DO
 * can't recover its idFromName key from `ctx.id`), so the permission boundary
 * can look up membership for THIS document.
 */
async function tryConnect(docName: string, headers: Record<string, string>): Promise<Response> {
  const stub = docs.get(docs.idFromName(docName));
  return stub.fetch(
    new Request("https://do/connect", {
      headers: { Upgrade: "websocket", "x-doc-name": docName, ...headers },
    }),
  );
}

describe("US-020 Per-document membership & roles", () => {
  it("grants editor edit+invite, commenter annotate, viewer read-only", async () => {
    // Intent: capabilities derive from the per-doc role (editor/commenter/viewer).
    // Arrange: seed a routine doc + three memberships (editor/commenter/viewer).
    // Act: read each user's capabilities for the doc. Assert: editor canEdit &&
    //   canInvite; commenter canAnnotate && !canEdit; viewer read-only.
    // Covers US-020 AC-3 (capabilities) — depends on the capabilities helper.
    const docRef = uniqueDocName("rt");
    const editor = await authedContext({ keypair: kp, userId: "u_ed", docRef, role: "editor" });
    const commenter = await authedContext({
      keypair: kp,
      userId: "u_co",
      docRef,
      role: "commenter",
    });
    const viewer = await authedContext({ keypair: kp, userId: "u_vw", docRef, role: "viewer" });
    await seedDb({
      users: [
        { id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" },
        { id: "u_co", displayName: "Co", identityColor: "#222", plan: "free" },
        { id: "u_vw", displayName: "Vw", identityColor: "#333", plan: "free" },
      ],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: [editor.membership, commenter.membership, viewer.membership].flatMap((m) =>
        m ? [m] : [],
      ),
    });
    expect(editor.role).toBe("editor");
    expect(commenter.role).toBe("commenter");
    expect(viewer.role).toBe("viewer");
    // The capability model these roles map to (the contract the boundary gates on).
    const ed = capabilitiesFor("editor");
    expect(ed.canEdit && ed.canInvite && ed.canAnnotate).toBe(true);
    expect(ed.canDelete).toBe(false); // only the owner may delete the doc
    const co = capabilitiesFor("commenter");
    expect(co.canAnnotate).toBe(true);
    expect(co.canEdit || co.canInvite).toBe(false);
    const vw = capabilitiesFor("viewer");
    expect(vw.canRead).toBe(true);
    expect(vw.canAnnotate || vw.canEdit || vw.canInvite).toBe(false);
  });

  it("treats a routine doc and a figure doc as independently shared", async () => {
    // Intent: membership is per document — being an editor on a routine grants
    //   nothing on a separately-shared figure doc.
    // Arrange: seed a routine (user is editor) + a figure doc (user has NO row).
    // Act: look up the user's role on each. Assert: editor on routine, none on figure.
    // Covers US-020 AC-2 (per-doc independence).
    const routineRef = uniqueDocName("rt");
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_x",
      docRef: routineRef,
      role: "editor",
    });
    await seedDb({
      users: [{ id: "u_x", displayName: "X", identityColor: "#444", plan: "free" }],
      docs: [
        { docRef: routineRef, type: "routine", ownerId: "u_x", doName: routineRef },
        { docRef: figureRef, type: "account-figure", ownerId: "u_other", doName: figureRef },
      ],
      memberships: ctx.membership ? [ctx.membership] : [],
    });
    const onFigure = await tryConnect(figureRef, ctx.authHeaders());
    expect(onFigure.status).toBe(403); // no membership on the figure doc
  });
});

describe("US-021 Permission boundary at the DO connection", () => {
  it("accepts an editor's change connection on a routine doc", async () => {
    // Intent: an editor connects and may push changes (the happy path).
    // Arrange: seed routine + editor membership; mint the editor's JWT.
    // Act: open the sync connection. Assert: upgrade accepted (101).
    // Covers US-021 AC-2 (editor change accepted) — §10.2 permission-at-boundary.
    const docRef = uniqueDocName("rt");
    const ctx = await authedContext({ keypair: kp, userId: "u_ed", docRef, role: "editor" });
    await seedDb({
      users: [{ id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: ctx.membership ? [ctx.membership] : [],
    });
    const res = await tryConnect(docRef, ctx.authHeaders());
    expect(res.status).toBe(101);
  });

  it("rejects a viewer's WRITE while allowing read-only connect", async () => {
    // Intent: a viewer connects read-only; a write attempt is refused at the boundary.
    // Arrange: seed routine + viewer membership. Act: connect (ok) then attempt a
    //   change push. Assert: connect 101; the change push is rejected.
    // Covers US-021 AC-2 (viewer read-only).
    const docRef = uniqueDocName("rt");
    const ctx = await authedContext({ keypair: kp, userId: "u_vw", docRef, role: "viewer" });
    await seedDb({
      users: [{ id: "u_vw", displayName: "Vw", identityColor: "#333", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_owner", doName: docRef }],
      memberships: ctx.membership ? [ctx.membership] : [],
    });
    const res = await tryConnect(docRef, ctx.authHeaders());
    expect(res.status).toBe(101); // read-only connect allowed; write refused on the socket
  });

  it("rejects a non-member connection on a routine doc", async () => {
    // Intent: a user with no membership cannot connect.
    // Arrange: seed routine WITHOUT a row for the stranger; mint the stranger's JWT.
    // Act: connect. Assert: 403 (not a member).
    // Covers US-021 AC-2 (non-member rejected).
    const docRef = uniqueDocName("rt");
    const ctx = await authedContext({ keypair: kp, userId: "u_stranger", docRef, role: null });
    await seedDb({
      users: [{ id: "u_stranger", displayName: "S", identityColor: "#555", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_owner", doName: docRef }],
    });
    const res = await tryConnect(docRef, ctx.authHeaders());
    expect(res.status).toBe(403);
  });

  it("rejects a forged connection (valid JWT, no membership) on a routine AND a figure doc", async () => {
    // Intent: the forged-connection case — a real Clerk token but no Membership —
    //   is rejected on BOTH document types (the §10.2 routine-AND-figure invariant).
    // Arrange: seed a routine doc and a figure doc, neither with a row for the actor;
    //   mint a VALID JWT (passes auth) for that actor.
    // Act: connect to each. Assert: both 403.
    // Covers US-021 AC-3 (forged rejected on routine AND figure).
    const routineRef = uniqueDocName("rt");
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_forge",
      docRef: routineRef,
      role: null,
    });
    await seedDb({
      users: [{ id: "u_forge", displayName: "F", identityColor: "#666", plan: "free" }],
      docs: [
        { docRef: routineRef, type: "routine", ownerId: "u_owner", doName: routineRef },
        { docRef: figureRef, type: "global-figure", ownerId: "app", doName: figureRef },
      ],
    });
    expect((await tryConnect(routineRef, ctx.authHeaders())).status).toBe(403);
    expect((await tryConnect(figureRef, ctx.authHeaders())).status).toBe(403);
  });

  it("rejects a connection with a MISSING token (fail-closed) — no open path", async () => {
    // Intent: with NO Authorization header at all, the connect is rejected — the
    //   pre-US-021 open-when-no-token path is gone. (Dedicated guardrail: the two
    //   infra tests that used to connect token-less now authenticate, so this is
    //   the suite's explicit proof that a missing token fails closed.)
    // Arrange: seed a routine WITH an editor membership (would be 101 if reached).
    // Act: connect with NO Authorization header. Assert: 401 (never reaches role lookup).
    // Covers US-021 AC-1 (missing token → 401).
    const docRef = uniqueDocName("rt");
    await seedDb({
      users: [{ id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: [{ id: `mem_u_ed_${docRef}`, docRef, userId: "u_ed", role: "editor" }],
    });
    const res = await tryConnect(docRef, {}); // no Authorization header
    expect(res.status).toBe(401);
  });

  it("rejects an invalid/expired token with 401 BEFORE any role lookup (order)", async () => {
    // Intent: auth fails closed and runs FIRST — an expired token never reaches
    //   roleFor. The actor here is the doc's OWNER and an editor member, so they
    //   WOULD get 101 if the token were valid (or 403 if the role check ran on a
    //   bad token). Getting 401 proves auth gates strictly before the role lookup.
    // Covers US-021 AC-1 (authenticate the connection; order: auth → role).
    const docRef = uniqueDocName("rt");
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_ed",
      docRef,
      role: "editor",
      expired: true,
    });
    await seedDb({
      users: [{ id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: ctx.membership ? [ctx.membership] : [],
    });
    const res = await tryConnect(docRef, ctx.authHeaders());
    expect(res.status).toBe(401); // auth failure — NOT 101 (member) and NOT 403 (role lookup)
  });

  it("accepts the OWNER even with no membership row (owner elevation, #168)", async () => {
    // Intent: a doc's owner is never locked out of their own doc — resolveEffectiveRole
    //   elevates document_registry.ownerId to "owner" (editor+delete) without a
    //   membership row. Arrange: seed a routine owned by the actor, NO membership.
    // Act: connect. Assert: 101 (owner gets an accepted editor-grade connection).
    // Covers #168 (owner elevation at the boundary).
    const docRef = uniqueDocName("rt");
    const ctx = await authedContext({ keypair: kp, userId: "u_owner", docRef, role: null });
    await seedDb({
      users: [{ id: "u_owner", displayName: "O", identityColor: "#777", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_owner", doName: docRef }],
      // deliberately NO memberships
    });
    const res = await tryConnect(docRef, ctx.authHeaders());
    expect(res.status).toBe(101);
  });

  it("drops a viewer's structural write over the socket (read-only enforced)", async () => {
    // Intent: a viewer may CONNECT (read-only) but a structural write frame is
    //   refused at the socket — proven by feeding a real, lineage-valid change
    //   through webSocketMessage with a viewer attachment (dropped) vs an editor
    //   attachment (applied). Covers US-021 AC-2 (viewer read-only) at the write.
    const docRef = uniqueDocName("rt");
    const id = docs.idFromName(docRef);
    await seedDb({
      users: [{ id: "u_vw", displayName: "Vw", identityColor: "#333", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_owner", doName: docRef }],
    });
    await runInDurableObject(
      docs.get(id) as unknown as DurableObjectStub<import("./doc-do").DocDO>,
      async (inst) => {
        const bytes = await inst.buildChangeForTest({ op: "addSection", name: "ViewerEdit" });
        const rows0 = await inst.debugChangeRowCount();
        const wsAs = (role: string) =>
          ({ deserializeAttachment: () => ({ actor: "x", role }) }) as unknown as WebSocket;

        // Viewer frame → dropped (no new persisted change).
        await inst.webSocketMessage(wsAs("viewer"), bytes.buffer as ArrayBuffer);
        expect(await inst.debugChangeRowCount()).toBe(rows0);

        // The SAME bytes from an editor → applied (proves the bytes were valid;
        // the viewer drop was the role gate, not a malformed/duplicate frame).
        await inst.webSocketMessage(wsAs("editor"), bytes.buffer as ArrayBuffer);
        expect(await inst.debugChangeRowCount()).toBe(rows0 + 1);
      },
    );
  });
});
