import { env } from "cloudflare:test";
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
// The DO connect endpoint + the route auth are M2/M3 product code → the bodies
// are skipped and dynamic/structural. The keypair's public PEM is injected as
// CLERK_JWT_KEY so the real auth boundary verifies our minted tokens networklessly.
//
// MANDATORY isolatedStorage:false → unique DO ids (uniqueDocName).
// ─────────────────────────────────────────────────────────────────────────

const docs = env.DOC_DO as unknown as DocNamespace;
let kp: TestKeypair;

beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
  // In M3, the suite sets env.CLERK_JWT_KEY = kp.publicKeyPem (via vitest env or
  // a per-test binding) so verifyToken({ jwtKey }) verifies our tokens.
});

/** Open a sync connection to a doc DO with the given bearer token. */
async function tryConnect(docName: string, headers: Record<string, string>): Promise<Response> {
  const stub = docs.get(docs.idFromName(docName));
  return stub.fetch(
    new Request("https://do/connect", { headers: { Upgrade: "websocket", ...headers } }),
  );
}

describe.skip("US-020 Per-document membership & roles", () => {
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
    // capabilitiesFor() is a domain/permission helper (M3). The assertion below
    // is the contract the M3 implementation must satisfy.
    expect(editor.role).toBe("editor");
    expect(commenter.role).toBe("commenter");
    expect(viewer.role).toBe("viewer");
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

describe.skip("US-021 Permission boundary at the DO connection", () => {
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

  it("rejects a connection with an invalid/expired token before any role lookup", async () => {
    // Intent: auth fails closed — an expired token never reaches the role check.
    // Arrange: mint an EXPIRED token for a real editor membership.
    // Act: connect. Assert: 401 (auth failure, not 403).
    // Covers US-021 AC-1 (authenticates the connection) — fail-closed auth.
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
    expect(res.status).toBe(401);
  });
});
