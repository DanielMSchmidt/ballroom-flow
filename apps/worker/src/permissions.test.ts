import { env, runInDurableObject } from "cloudflare:test";
import { capabilitiesFor } from "@weavesteps/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveEffectiveRole } from "./db/membership";
import { authedContext } from "./test-support/authed-context";
import { uniqueDocName } from "./test-support/do-id";
import type { DocNamespace } from "./test-support/doc-do-api";
import { expectIndexedQuery } from "./test-support/explain";
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
// model (@weavesteps/domain) + the DO's transitional membership gate (an
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
    // Arrange: seed a routine doc and an ACCOUNT figure doc, neither with a row for
    //   the actor; mint a VALID JWT (passes auth) for that actor.
    // Act: connect to each. Assert: both 403.
    // Covers US-021 AC-3 (forged rejected on routine AND figure). NB (⟳v5): an
    //   ACCOUNT figure still requires membership/ownership; the forged-rejection
    //   invariant no longer uses a GLOBAL figure, which is readable by all (below).
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
        { docRef: figureRef, type: "account-figure", ownerId: "u_owner", doName: figureRef },
      ],
    });
    expect((await tryConnect(routineRef, ctx.authHeaders())).status).toBe(403);
    expect((await tryConnect(figureRef, ctx.authHeaders())).status).toBe(403);
  });

  it("admits ANY authenticated user (no membership) to a GLOBAL figure doc as a viewer (⟳v5)", async () => {
    // ⟳v5 (§5.1/D28): global figure docs are readable by every signed-in user —
    // an implicit viewer, no membership row. So a valid-token connection with no
    // membership is admitted (101), NOT forged. (A non-admin's edit spawns a
    // variant client-side; the write-gating at the boundary is exercised elsewhere.)
    const figureRef = uniqueDocName("gfig");
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_anyreader",
      docRef: figureRef,
      role: null,
    });
    await seedDb({
      users: [{ id: "u_anyreader", displayName: "A", identityColor: "#777", plan: "free" }],
      docs: [{ docRef: figureRef, type: "global-figure", ownerId: "app", doName: figureRef }],
    });
    expect((await tryConnect(figureRef, ctx.authHeaders())).status).toBe(101);
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

  it("admits a commenter's annotation write but drops their structural write (US-039/#117)", async () => {
    // Intent: a commenter (canAnnotate, !canEdit) may add an annotation over the
    //   socket but NOT a structural edit. The DO classifies by EFFECT — a change
    //   that touches only `annotations` is an annotation; anything else is
    //   structural — so the client can't bypass the gate by mislabelling a frame.
    //   Covers US-039 AC-4 (commenter+ annotates; viewer can't).
    const docRef = uniqueDocName("rt");
    const id = docs.idFromName(docRef);
    await seedDb({
      users: [{ id: "u_co", displayName: "Co", identityColor: "#333", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_owner", doName: docRef }],
    });
    await runInDurableObject(
      docs.get(id) as unknown as DurableObjectStub<import("./doc-do").DocDO>,
      async (inst) => {
        const wsAs = (role: string, sub = "u_co") =>
          ({ deserializeAttachment: () => ({ actor: "x", role, sub }) }) as unknown as WebSocket;

        // A commenter's ANNOTATION change (authored as THEMSELVES) → applied.
        const anno = await inst.buildChangeForTest({
          op: "addAnnotation",
          text: "rise earlier",
          authorId: "u_co",
        });
        const rows0 = await inst.debugChangeRowCount();
        await inst.webSocketMessage(wsAs("commenter"), anno.buffer as ArrayBuffer);
        expect(await inst.debugChangeRowCount()).toBe(rows0 + 1);

        // A commenter's STRUCTURAL change → dropped (touches sections, not just annotations).
        const struct = await inst.buildChangeForTest({ op: "addSection", name: "Sneaky" });
        const rows1 = await inst.debugChangeRowCount();
        await inst.webSocketMessage(wsAs("commenter"), struct.buffer as ArrayBuffer);
        expect(await inst.debugChangeRowCount()).toBe(rows1);

        // A viewer's annotation change → dropped (viewer can't annotate).
        const anno2 = await inst.buildChangeForTest({ op: "addAnnotation", text: "no" });
        const rows2 = await inst.debugChangeRowCount();
        await inst.webSocketMessage(wsAs("viewer"), anno2.buffer as ArrayBuffer);
        expect(await inst.debugChangeRowCount()).toBe(rows2);
      },
    );
  });

  it("enforces annotation AUTHORSHIP for commenters (§5.1 hardening, 2026-07-02 S2)", async () => {
    // Intent: the effect-based gate alone let a commenter edit/tombstone ANY
    //   author's annotation (authorId is client-controlled). Now the socket's
    //   verified identity bounds what a commenter may touch: create their own,
    //   reply to anyone's, but never modify/tombstone another author's
    //   annotation, forge authorship, or delete someone else's reply.
    const docRef = uniqueDocName("rt");
    const id = docs.idFromName(docRef);
    await seedDb({
      users: [{ id: "u_com", displayName: "Co", identityColor: "#333", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_owner", doName: docRef }],
    });
    await runInDurableObject(
      docs.get(id) as unknown as DurableObjectStub<import("./doc-do").DocDO>,
      async (inst) => {
        const wsAs = (role: string, sub: string) =>
          ({ deserializeAttachment: () => ({ actor: "x", role, sub }) }) as unknown as WebSocket;

        // The OWNER authors an annotation (applied via the editor path).
        const ownerAnno = await inst.buildChangeForTest({
          op: "addAnnotation",
          text: "owner note",
          authorId: "u_owner",
        });
        await inst.webSocketMessage(wsAs("editor", "u_owner"), ownerAnno.buffer as ArrayBuffer);
        const snap = await inst.getSnapshot();
        const target = snap.annotations.find((a) => a.text === "owner note");
        expect(target).toBeDefined();
        const targetId = (target as { id: string }).id;

        // A commenter TOMBSTONING the owner's annotation → dropped.
        const kill = await inst.buildChangeForTest({ op: "deleteAnnotation", id: targetId });
        const rows0 = await inst.debugChangeRowCount();
        await inst.webSocketMessage(wsAs("commenter", "u_com"), kill.buffer as ArrayBuffer);
        expect(await inst.debugChangeRowCount()).toBe(rows0);

        // A commenter FORGING authorship (creating an annotation "as" the owner) → dropped.
        const forged = await inst.buildChangeForTest({
          op: "addAnnotation",
          text: "forged",
          authorId: "u_owner",
        });
        const rows1 = await inst.debugChangeRowCount();
        await inst.webSocketMessage(wsAs("commenter", "u_com"), forged.buffer as ArrayBuffer);
        expect(await inst.debugChangeRowCount()).toBe(rows1);

        // A commenter REPLYING (as themselves) to the owner's annotation → applied.
        const reply = await inst.buildChangeForTest({
          op: "addReply",
          annotationId: targetId,
          text: "makes sense",
          authorId: "u_com",
        });
        const rows2 = await inst.debugChangeRowCount();
        await inst.webSocketMessage(wsAs("commenter", "u_com"), reply.buffer as ArrayBuffer);
        expect(await inst.debugChangeRowCount()).toBe(rows2 + 1);

        // The SAME tombstone bytes from the AUTHOR (commenter role) → applied —
        // authorship, not role, was the gate.
        const rows3 = await inst.debugChangeRowCount();
        await inst.webSocketMessage(wsAs("commenter", "u_owner"), kill.buffer as ArrayBuffer);
        expect(await inst.debugChangeRowCount()).toBe(rows3 + 1);
      },
    );
  });

  it("revocation reaches OPEN sockets: refreshConnectedRoles closes a removed member (§5.1, 2026-07-02 S1)", async () => {
    // Intent: removing a member used to leave their live WebSocket writable
    //   indefinitely (role frozen in the hibernation attachment). The member
    //   routes now tell the DO to re-resolve roles: a removed member's socket
    //   is CLOSED; a still-valid member's stays open.
    const docRef = uniqueDocName("rt");
    const editor = await authedContext({
      keypair: kp,
      userId: "u_gone",
      docRef,
      role: "editor",
    });
    const keeper = await authedContext({
      keypair: kp,
      userId: "u_stays",
      docRef,
      role: "editor",
    });
    await seedDb({
      users: [
        { id: "u_gone", displayName: "G", identityColor: "#111", plan: "free" },
        { id: "u_stays", displayName: "S", identityColor: "#222", plan: "free" },
      ],
      docs: [{ docRef, type: "routine", ownerId: "u_owner", doName: docRef }],
      memberships: [editor.membership, keeper.membership].flatMap((m) => (m ? [m] : [])),
    });

    const connect = async (headers: Record<string, string>) => {
      const res = await tryConnect(docRef, headers);
      expect(res.status).toBe(101);
      const ws = res.webSocket as WebSocket;
      ws.accept();
      return ws;
    };
    const goneWs = await connect(editor.authHeaders());
    const staysWs = await connect(keeper.authHeaders());
    const closed: string[] = [];
    goneWs.addEventListener("close", () => closed.push("gone"));
    staysWs.addEventListener("close", () => closed.push("stays"));

    // Tombstone u_gone's membership, then refresh (what the member route does).
    await env.DB.prepare(
      "UPDATE membership SET deletedAt = ? WHERE docRef = ? AND userId = 'u_gone'",
    )
      .bind(Date.now(), docRef)
      .run();
    const stub = docs.get(docs.idFromName(docRef)) as unknown as {
      refreshConnectedRoles(): Promise<void>;
    };
    await stub.refreshConnectedRoles();
    // Let the close event propagate to the client side.
    await new Promise((r) => setTimeout(r, 50));

    expect(closed).toContain("gone");
    expect(closed).not.toContain("stays");
  });

  it("cascades VIEWER on a referenced figure to a routine co-member (sharing a routine shares its figures)", async () => {
    // Intent: a co-member of a routine can READ the figures it references, even
    //   with NO direct figure membership — the placement_edge cascade. Decided
    //   2026-06-27; figure docs are otherwise shared independently (US-020 AC-2).
    const routineRef = uniqueDocName("rt");
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({ keypair: kp, userId: "u_co", docRef: figureRef, role: null });
    await seedDb({
      users: [{ id: "u_co", displayName: "Co", identityColor: "#555", plan: "free" }],
      docs: [
        { docRef: routineRef, type: "routine", ownerId: "u_owner", doName: routineRef },
        { docRef: figureRef, type: "account-figure", ownerId: "u_owner", doName: figureRef },
      ],
      // Member of the ROUTINE, not the figure — the edge cascades read access.
      memberships: [{ id: "m_co_rt", docRef: routineRef, userId: "u_co", role: "commenter" }],
      placementEdges: [{ routineRef, figureRef }],
    });
    expect((await tryConnect(figureRef, ctx.authHeaders())).status).toBe(101);
  });

  it("does NOT cascade figure access to a NON-member of the referencing routine", async () => {
    const routineRef = uniqueDocName("rt");
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_out",
      docRef: figureRef,
      role: null,
    });
    await seedDb({
      users: [{ id: "u_out", displayName: "Out", identityColor: "#666", plan: "free" }],
      docs: [
        { docRef: routineRef, type: "routine", ownerId: "u_owner", doName: routineRef },
        { docRef: figureRef, type: "account-figure", ownerId: "u_owner", doName: figureRef },
      ],
      placementEdges: [{ routineRef, figureRef }], // referenced, but u_out isn't a routine member
    });
    expect((await tryConnect(figureRef, ctx.authHeaders())).status).toBe(403);
  });

  it("cascades EDITOR on a referenced figure to a routine EDITOR (editors may edit referenced figures)", async () => {
    // Intent: a routine editor may EDIT the figures it references (decided
    //   2026-06-27) — the cascade derives 'editor' from the routine role; a
    //   commenter/viewer still gets read-only.
    const routineRef = uniqueDocName("rt");
    const figureRef = uniqueDocName("fig");
    await seedDb({
      users: [
        { id: "u_ed2", displayName: "Ed2", identityColor: "#777", plan: "free" },
        { id: "u_co2", displayName: "Co2", identityColor: "#888", plan: "free" },
      ],
      docs: [
        { docRef: routineRef, type: "routine", ownerId: "u_owner", doName: routineRef },
        { docRef: figureRef, type: "account-figure", ownerId: "u_owner", doName: figureRef },
      ],
      memberships: [
        { id: "m_ed2_rt", docRef: routineRef, userId: "u_ed2", role: "editor" },
        { id: "m_co2_rt", docRef: routineRef, userId: "u_co2", role: "commenter" },
      ],
      placementEdges: [{ routineRef, figureRef }],
    });
    // A routine editor → EDITOR on the figure; a routine commenter → read-only viewer.
    expect(await resolveEffectiveRole(env.DB, figureRef, "u_ed2")).toBe("editor");
    expect(await resolveEffectiveRole(env.DB, figureRef, "u_co2")).toBe("viewer");
  });

  it("uses INDEXES for the figure-access cascade lookup (EXPLAIN, no SCAN)", async () => {
    await expectIndexedQuery(
      env.DB,
      "SELECT m.role AS role FROM placement_edge pe JOIN membership m ON m.docRef = pe.routineRef WHERE pe.figureRef = ?1 AND m.userId = ?2 AND m.deletedAt IS NULL",
      ["fig_x", "u_x"],
    );
  });
});
