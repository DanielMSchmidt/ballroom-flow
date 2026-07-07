import { env, runInDurableObject } from "cloudflare:test";
import * as A from "@automerge/automerge";
import { SYNC_FRAME_SNAPSHOT } from "@weavesteps/contract";
import {
  CURRENT_SCHEMA_VERSION,
  type RoutineDoc,
  readRoutine,
  undoLastChange,
} from "@weavesteps/domain";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { listRoutines } from "./db/routines";
import { authedContext } from "./test-support/authed-context";
import { uniqueDocName } from "./test-support/do-id";
import type { DocNamespace, DocStub } from "./test-support/doc-do-api";
import { expectIndexedQuery } from "./test-support/explain";
import { generateTestKeypair, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-014 — Per-document SQLite-backed DO hosts an Automerge doc [M2, system]
// US-015 — Live WebSocket sync (two clients converge) [M2, system]
// US-016 — DO alarm: compaction + D1 index projection + invite expiry [M2]
//
// PLAN §6, D23, §10.2: "two clients converge through a real per-document DO;
// DO SQLite persistence (doc survives eviction/reload); alarm compaction + D1
// index projection". Run in real workerd via vitest-pool-workers.
//
// MANDATORY: isolatedStorage:false → every test uses a UNIQUE DO id
// (uniqueDocName). The DO class + its RPC/WS API are built in M2 (doc-do.ts), so
// the bodies stay skipped; they address `env.DOC_DO` (the M2 binding) only
// inside the skipped bodies. The DO methods (applyChange/getSnapshot/
// runAlarmForTest…) are the M2 contract (doc-do-api.ts) — implement + unskip.
// ─────────────────────────────────────────────────────────────────────────

/** The M2 DO binding, typed against the structural M2 contract (no `any`). */
const docs = env.DOC_DO as unknown as DocNamespace;

/** A unique DO stub for one test (isolatedStorage:false → unique id required). */
function freshDoc(prefix: string): { name: string; stub: DocStub } {
  const name = uniqueDocName(prefix);
  return { name, stub: docs.get(docs.idFromName(name)) };
}

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  // US-021 made the DO connect FAIL-CLOSED, so the WS-connect tests below must
  // authenticate + be a member/owner. CLERK_JWT_KEY is the static test PEM.
  kp = await generateTestKeypair();
});

describe("US-014 Per-document SQLite-backed DO hosts an Automerge doc", () => {
  it("seedDoc durably seeds a fresh doc's content at create, no-clobber after (#205)", async () => {
    // Intent: the create routes server-seed the doc's initial CRDT content so it's
    // DO-persisted the instant the doc exists (vs a racy client write). Assert it
    // seeds a fresh DO and survives a forced cold-load, and NEVER overwrites a doc
    // that already has content (idempotent create / retried request).
    const { stub } = freshDoc("routine");
    await stub.seedDoc({
      id: "rt_seed",
      title: "Server Seeded",
      dance: "foxtrot",
      ownerId: "u_seed",
      sections: [],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    await stub.reloadForTest(); // force the SQLite cold-load path
    const seeded = await stub.getSnapshot();
    expect(seeded.title).toBe("Server Seeded");
    expect(seeded.dance).toBe("foxtrot");

    // No-clobber: a second seed (e.g. a retried create) must NOT overwrite content.
    await stub.seedDoc({ id: "rt_seed", title: "DIFFERENT", dance: "waltz", sections: [] });
    expect((await stub.getSnapshot()).title).toBe("Server Seeded");
  });

  it("a connect to a not-yet-seeded doc does not poison/block a later seedDoc", async () => {
    // ROBUSTNESS — the collaborator seed race. If a client connects to a doc's DO
    // BEFORE the create route's seedDoc runs (user B receives a synced placement
    // and opens the new figure's DO before user A's POST /api/figures seeds it),
    // the connect must NOT auto-materialize + persist an empty-routine placeholder:
    // that used to trip seedDoc's no-clobber, leaving the doc permanently empty
    // (the figure stuck null even after a reload). The seed must still win.
    const { name, stub } = freshDoc("routine");
    const ctx = await authedContext({ keypair: kp, userId: "u_ed", docRef: name, role: "editor" });
    await seedDb({
      users: [{ id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" }],
      docs: [{ docRef: name, type: "routine", ownerId: "u_ed", doName: name }],
      memberships: ctx.membership ? [ctx.membership] : [],
    });

    // A client connects BEFORE the doc is seeded.
    const res = await stub.fetch(
      new Request("https://do/connect", {
        headers: { Upgrade: "websocket", "x-doc-name": name, ...ctx.authHeaders() },
      }),
    );
    expect(res.status).toBe(101);
    res.webSocket?.accept();

    // NOW the create route seeds the doc — it must take effect, not be no-clobbered
    // by a placeholder the connect persisted.
    await stub.seedDoc({
      id: name,
      title: "Server Seeded",
      dance: "foxtrot",
      ownerId: "u_ed",
      sections: [],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    await stub.reloadForTest(); // force the SQLite cold-load path
    expect((await stub.getSnapshot()).title).toBe("Server Seeded");
  });

  it("persists incremental changes to DO SQLite and rehydrates after eviction", async () => {
    // Intent: the DO keeps the doc in memory + persists INCREMENTAL changes; a
    //   cold DO (post-eviction) rebuilds the same doc from SQLite (M0.5 S1).
    // Scenario: one client writes a change; the DO is EVICTED; the next access
    //   must cold-load from SQLite — not read a still-warm in-memory doc.
    // Arrange: a unique routine DO; apply a change. Act: force a real eviction
    //   (drop the in-memory doc) so the next read goes through getDoc's SQLite
    //   replay branch; then read the doc back. Assert: rehydrated doc has the change.
    // Covers US-014 AC-1 (incremental persist) + AC-2 (rehydrate) — §10.2 "SQLite persistence".
    //
    // NB: vitest-pool-workers keeps the DO warm between two `.get(id)` calls, so a
    // plain re-get would read `this.doc` and never exercise rehydration. The DO's
    // `reloadForTest()` hook drops the in-memory doc and re-runs the cold-load, so
    // the assertion below genuinely goes through the SQLite-replay branch.
    const stub = docs.get(docs.idFromName(uniqueDocName("routine")));

    const change = await stub.applyChange({ op: "addSection", name: "Intro" });
    expect(change.byteLength).toBeGreaterThan(0); // a real incremental change, not an empty no-op

    // Simulate eviction: drop the in-memory doc so the next read MUST rehydrate
    // from SQLite (A.applyChanges(A.init(), changes)) rather than read warm state.
    await stub.reloadForTest();

    const doc = await stub.getSnapshot(); // forced through the SQLite cold-load path
    expect((doc.sections ?? []).map((s) => s.name)).toContain("Intro");
  });

  it("gives routine docs and figure docs each their own DO", async () => {
    // Intent: one DO per document (the per-document topology, §6/D23).
    // Arrange: a routine DO and a figure DO by distinct unique names.
    // Act: write to the routine only. Assert: the figure DO is independent (no bleed).
    // Covers US-014 AC-3 (one DO per document).
    const routine = freshDoc("routine");
    const figure = freshDoc("figure");
    await routine.stub.applyChange({ op: "addSection", name: "OnlyRoutine" });
    const figDoc = await figure.stub.getSnapshot();
    expect(figDoc.sections ?? []).toHaveLength(0);
  });

  it("appends one SQLite row per change, never a full rewrite", async () => {
    // Intent: persistence is genuinely INCREMENTAL (AC-1) — each edit adds rows
    //   to the change log rather than rewriting the whole doc. With the
    //   getChanges(before, after) model, a single addSection is one change, so 3
    //   edits add exactly 3 rows on top of the 1 seed row (4 total). A full-
    //   rewrite design would hold a single row; a multi-change-per-op leak would
    //   inflate it.
    // Covers US-014 AC-1 ("incremental changes, not a full rewrite") + pins the
    //   getChanges switch (#106) to one-row-per-op.
    const { stub } = freshDoc("routine");
    for (const name of ["A", "B", "C"]) {
      await stub.applyChange({ op: "addSection", name });
    }
    // The DO's own change-log row count (test hook) proves persistence is
    // incremental: 1 seed + 3 one-change ops = 4 rows.
    expect(await stub.debugChangeRowCount()).toBe(4);
  });
});

describe("US-015 Live WebSocket sync (two clients converge)", () => {
  it("converges two clients exchanging Automerge changes over the DO", async () => {
    // Intent: two clients of one DO converge on each other's changes (M0.5 S2).
    // Scenario: client B opens a real WS to the DO (101 upgrade); client A edits
    //   via the RPC transport; the DO applies + persists it; a fresh read of the
    //   same DO reflects A's edit — the shared state both clients sync against.
    // Assert: the WS upgrade is 101 AND the doc both clients share converges on
    //   A's change. (The live broadcast wire is exercised end-to-end in the E2E
    //   convergence spec — vitest-pool-workers can't drive a full WS delivery
    //   cycle, SPIKE-FINDINGS sharp-edge #3, so the DO sync core is asserted here
    //   via the RPC stand-in the spike used.)
    // Covers US-015 AC-1 — §10.2 "two clients converge through a real DO".
    const { name, stub } = freshDoc("routine");

    // US-021: the connect is fail-closed — B authenticates as a member of THIS doc.
    const ctx = await authedContext({ keypair: kp, userId: "u_ed", docRef: name, role: "editor" });
    await seedDb({
      users: [{ id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" }],
      docs: [{ docRef: name, type: "routine", ownerId: "u_ed", doName: name }],
      memberships: ctx.membership ? [ctx.membership] : [],
    });
    const res = await stub.fetch(
      new Request("https://do/connect", {
        headers: { Upgrade: "websocket", "x-doc-name": name, ...ctx.authHeaders() },
      }),
    );
    expect(res.status).toBe(101); // B's Hibernatable WS connection is accepted
    res.webSocket?.accept();

    // A edits; the shared doc the WS clients sync against converges on it.
    await stub.applyChange({ op: "addSection", name: "FromA" });
    const shared = await stub.getSnapshot();
    expect((shared.sections ?? []).map((s) => s.name)).toContain("FromA");
  });

  it("keeps state across a hibernation/wake cycle", async () => {
    // Intent: Hibernatable WS hibernation then wake must not drop doc state or
    //   buffered changes (the one unknown M0.5 deferred).
    // Scenario: connect, write, let the DO hibernate, wake on a new message.
    // Arrange/Act: write a change, trigger hibernation, reconnect + read.
    // Assert: the doc still has the change after wake.
    // Covers US-015 AC-2 (hibernation/wake keeps state).
    const { stub } = freshDoc("routine");
    await stub.applyChange({ op: "addSection", name: "Survives" });

    // Simulate hibernation/eviction: the next read must rehydrate from SQLite,
    // not return a warm in-memory doc (vitest-pool-workers keeps the DO warm).
    await stub.reloadForTest();

    const doc = await stub.getSnapshot();
    expect((doc.sections ?? []).map((s) => s.name)).toContain("Survives");
  });

  it("is idempotent when the same change arrives twice over the socket", async () => {
    // Intent: a duplicate change delivery is a no-op (CRDT idempotence on the wire).
    // Arrange: a DO with one applied change. Act: deliver the SAME change bytes again.
    // Assert: the doc snapshot is unchanged AND no extra row is persisted — the DO
    //   detects the duplicate (heads unchanged) and skips persist + broadcast,
    //   rather than relying only on Automerge's natural state idempotence.
    // Covers US-015 AC-3 (duplicate change idempotent).
    const { stub } = freshDoc("routine");
    const change = await stub.applyChange({ op: "addSection", name: "Once" });
    const before = await stub.getSnapshot();
    const rowsBefore = await stub.debugChangeRowCount();

    await stub.applyRawChange(change);

    const after = await stub.getSnapshot();
    expect(after).toEqual(before);
    // The duplicate must NOT append a second row for the same change.
    expect(await stub.debugChangeRowCount()).toBe(rowsBefore);
  });

  it("catches a new client up with ONE snapshot frame, not a per-change replay (D10)", async () => {
    // Intent: the on-connect catch-up is a SINGLE tagged snapshot frame (the whole
    //   doc as an A.save blob), NOT one binary frame per historical change. As a
    //   doc ages the old replay grew unbounded on the wire (compaction bounds the
    //   SQLite log, not the replay); the snapshot is O(1) frames regardless of N.
    // Assert: exactly ONE frame; its 1-byte tag is SYNC_FRAME_SNAPSHOT; and
    //   A.load of the payload reconstructs the doc's full state.
    const { stub } = freshDoc("routine");
    // N>1 changes: a per-change replay would be 4+ frames (plus the seed change).
    for (const name of ["A", "B", "C", "D"]) await stub.applyChange({ op: "addSection", name });

    const frames = await stub.catchUpFramesForTest();
    expect(frames).toHaveLength(1); // ONE snapshot frame, not a per-change replay
    const frame = frames[0];
    if (!frame) throw new Error("expected a catch-up frame");
    expect(frame[0]).toBe(SYNC_FRAME_SNAPSHOT); // the 1-byte type tag

    // A.load of the payload (frame minus the tag byte) equals the doc.
    const loaded = A.toJS(A.load<{ sections?: { name: string }[] }>(frame.slice(1))) as {
      sections?: { name: string }[];
    };
    const snap = await stub.getSnapshot();
    expect((loaded.sections ?? []).map((s) => s.name)).toEqual(
      (snap.sections ?? []).map((s) => s.name),
    );
  });

  it("sends NO snapshot frame for a not-yet-seeded doc (only the caught-up marker)", async () => {
    // A connect to an unseeded doc must not synthesize a placeholder snapshot —
    // it sends no snapshot frame at all (the client keeps its own empty init and
    // goes live on the caught-up marker; a later seedDoc broadcasts the content).
    const { stub } = freshDoc("routine");
    expect(await stub.catchUpFramesForTest()).toHaveLength(0);
  });

  it("drops a malformed WS frame without crashing the handler (frames are untrusted)", async () => {
    // Intent: even from an authorized EDITOR socket, a garbage frame (not valid
    //   Automerge change bytes) must be DROPPED, not crash webSocketMessage / take
    //   down the DO. Automerge's applyChanges throws "Invalid magic bytes" on
    //   garbage; webSocketMessage swallows it. (The socket carries an editor
    //   attachment so the US-021 role gate passes and we genuinely exercise the
    //   malformed-bytes path, not a read-only drop.)
    // Arrange: a DO with a real applied change. Act: deliver garbage bytes via
    //   webSocketMessage directly. Assert: it doesn't throw AND the doc is intact.
    const realDocs = env.DOC_DO;
    const id = realDocs.idFromName(uniqueDocName("routine"));
    const stub = realDocs.get(id) as unknown as DocStub;
    await stub.applyChange({ op: "addSection", name: "Keep" });
    const before = await stub.getSnapshot();
    const rowsBefore = await stub.debugChangeRowCount();

    // Call the DO's webSocketMessage with garbage bytes (no real socket needed —
    // broadcast no-ops with no connected sockets). Must resolve, not reject.
    const editorWs = {
      deserializeAttachment: () => ({ actor: "e", role: "editor" }),
    } as unknown as WebSocket;
    await runInDurableObject(
      realDocs.get(id) as unknown as DurableObjectStub<import("./doc-do").DocDO>,
      async (instance) => {
        await expect(
          instance.webSocketMessage(editorWs, new Uint8Array([9, 9, 9, 9]).buffer),
        ).resolves.toBeUndefined();
      },
    );

    // The garbage frame changed nothing.
    expect(await stub.getSnapshot()).toEqual(before);
    expect(await stub.debugChangeRowCount()).toBe(rowsBefore);
  });
});

describe("US-016 DO alarm: compaction + D1 index projection + invite expiry", () => {
  it("compacts persisted history on the alarm (off the request path)", async () => {
    // Intent: the alarm compacts the incremental change log into a single
    //   snapshot, bounding the log (replay-on-connect cost) without losing state.
    // Arrange: a DO with many incremental changes. Act: run the alarm. Assert: the
    //   change log is folded into the snapshot — far fewer change rows after — and
    //   the doc is unchanged.
    // Covers US-016 AC-1 (compaction) + AC-4 (off request path).
    const { stub } = freshDoc("routine");
    for (let i = 0; i < 20; i++) await stub.applyChange({ op: "addSection", name: `S${i}` });
    const rowsBefore = await stub.debugChangeRowCount();
    const before = await stub.getSnapshot();

    await stub.runAlarmForTest();

    const rowsAfter = await stub.debugChangeRowCount();
    expect(rowsAfter).toBeLessThan(rowsBefore); // change log folded into the snapshot
    expect(rowsAfter).toBe(0); // fully compacted
    // State survives compaction — even through a forced cold-load from the snapshot.
    await stub.reloadForTest();
    expect(await stub.getSnapshot()).toEqual(before);
  });

  it("auto-compacts a write-heavy doc that never sets metadata (edits schedule the alarm)", async () => {
    // Intent: a write-heavy doc that never calls setMetadata must STILL get
    //   compacted — edits schedule a coalesced alarm past the change-log
    //   threshold (Staff review #125: the under-compaction direction). Without
    //   this, the log grows unbounded and US-015 replay-on-connect scans it all.
    // Arrange/Act: edit far past the COMPACT_THRESHOLD (64), with NO setMetadata.
    // Assert: the change log stayed BOUNDED — the edit-scheduled alarm fired and
    //   compacted it (workerd runs the scheduled alarm), so the log is well under
    //   the number of edits. A pre-#125 build (compaction only on setMetadata)
    //   would hold ~71 rows here.
    // Covers the #125 under-compaction fix folded into the US-016 review loop.
    const { stub } = freshDoc("routine");
    for (let i = 0; i < 70; i++) await stub.applyChange({ op: "addSection", name: `E${i}` });
    expect(await stub.debugChangeRowCount()).toBeLessThan(70); // auto-compacted, log bounded
    // State is intact through the auto-compaction (and a forced cold-load).
    const snap = await stub.getSnapshot();
    expect((snap.sections ?? []).length).toBe(70);
    await stub.reloadForTest();
    expect((await stub.getSnapshot()).sections?.length).toBe(70);
  });

  it("projects a thin registry row to D1 on the alarm", async () => {
    // Intent: the alarm writes title/dance/owner/updatedAt/figureType to D1 so
    //   list/search work WITHOUT reading CRDT content.
    // Arrange: a routine DO with metadata. Act: run the alarm. Assert: a
    //   document_registry row exists in D1 reflecting the metadata.
    // Covers US-016 AC-2 (D1 index projection).
    const { name, stub } = freshDoc("routine");
    // doName is the DO's idFromName key; the DO can't recover it from ctx.id, so
    // the caller supplies it (it's the registry's #50 doId-scoped key).
    await stub.setMetadata({
      doName: name,
      title: "Projected",
      dance: "foxtrot",
      ownerId: "user_x",
    });
    await stub.runAlarmForTest();
    const row = await env.DB.prepare("SELECT title, dance FROM document_registry WHERE doName = ?")
      .bind(name)
      .first<{ title: string; dance: string }>();
    expect(row).toMatchObject({ title: "Projected", dance: "foxtrot" });
  });

  it("projection WITHOUT setMetadata derives identity from the doc and never clobbers the eager row (2026-07-02 C2)", async () => {
    // Production never calls setMetadata: docs get their doName from the connect
    // header (rememberDoName) and nothing else. The projection used to upsert
    // ownerId="" / type='routine' / title=NULL over the route-created registry
    // row — the owner lost DELETE rights (ownerId mismatch), the routine dropped
    // out of the quota count, and figure docs were re-typed as routines. Pin:
    // identity now comes from the seeded DOC, and unknown fields never blank
    // known ones.
    const { name, stub } = freshDoc("routine");
    // The eager row the create route writes (createOwnedRoutine analog).
    await env.DB.prepare(
      "INSERT INTO document_registry (docRef, type, ownerId, doName, title, dance, updatedAt) VALUES (?1, 'routine', 'u_eager', ?1, 'Eager Title', 'waltz', 1)",
    )
      .bind(name)
      .run();
    await stub.seedDoc({
      id: name,
      title: "Doc Title",
      dance: "waltz",
      ownerId: "u_eager",
      sections: [],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    await stub.setMetadata({ doName: name }); // ONLY the key — like a bare connect

    await stub.runAlarmForTest();

    const row = await env.DB.prepare(
      "SELECT type, ownerId, title, dance FROM document_registry WHERE doName = ?",
    )
      .bind(name)
      .first<{ type: string; ownerId: string; title: string; dance: string }>();
    // Owner survives (delete rights + quota count intact); the title projects
    // from the DOC (so CRDT renames reach the list), not NULL.
    expect(row).toMatchObject({
      type: "routine",
      ownerId: "u_eager",
      title: "Doc Title",
      dance: "waltz",
    });
  });

  it("a FIGURE doc's projection keeps its type/owner without setMetadata (2026-07-02 C2)", async () => {
    const { name, stub } = freshDoc("fig");
    await env.DB.prepare(
      "INSERT INTO document_registry (docRef, type, ownerId, doName, title, dance, figureType, updatedAt) VALUES (?1, 'account-figure', 'u_figowner', ?1, 'Feather', 'foxtrot', 'feather', 1)",
    )
      .bind(name)
      .run();
    await stub.seedDoc({
      id: name,
      scope: "account",
      ownerId: "u_figowner",
      figureType: "feather",
      dance: "foxtrot",
      name: "Feather",
      source: "custom",
      attributes: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    await stub.setMetadata({ doName: name }); // bare key, as on connect

    await stub.runAlarmForTest();

    const row = await env.DB.prepare(
      "SELECT type, ownerId, title FROM document_registry WHERE doName = ?",
    )
      .bind(name)
      .first<{ type: string; ownerId: string; title: string }>();
    // Previously re-typed to 'routine' with ownerId "" — the figure vanished
    // from its owner's library and lost its owner.
    expect(row).toMatchObject({ type: "account-figure", ownerId: "u_figowner", title: "Feather" });
  });

  it("expires THIS doc's due invites on the alarm, leaving other docs' invites alone (#127)", async () => {
    // Intent: expired invites are reaped off the request path — but a per-document
    //   DO reaps ONLY its own invites (#127), never another doc's rows.
    // Arrange: give the DO its identity (doName), then seed a due invite for THIS
    //   doc and a due invite for a DIFFERENT doc. Act: run the alarm.
    // Assert: this doc's invite is reaped; the other doc's invite is untouched.
    // Covers US-016 AC-3 (invite expiry sweep) + #127 (scoped to this doc).
    const { name, stub } = freshDoc("routine");
    await stub.setMetadata({ doName: name, ownerId: "user_x" });
    const mineId = `inv-${crypto.randomUUID()}`;
    const otherId = `inv-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO invite (id, docRef, role, expiresAt, redeemedAt) VALUES (?, ?, ?, ?, NULL)",
    )
      .bind(mineId, name, "editor", Date.now() - 1000)
      .run();
    await env.DB.prepare(
      "INSERT INTO invite (id, docRef, role, expiresAt, redeemedAt) VALUES (?, ?, ?, ?, NULL)",
    )
      .bind(otherId, "some-other-doc", "editor", Date.now() - 1000)
      .run();

    await stub.runAlarmForTest();

    const mine = await env.DB.prepare("SELECT redeemedAt FROM invite WHERE id = ?")
      .bind(mineId)
      .first<{ redeemedAt: number | null }>();
    const other = await env.DB.prepare("SELECT redeemedAt FROM invite WHERE id = ?")
      .bind(otherId)
      .first<{ redeemedAt: number | null }>();
    expect(mine?.redeemedAt).not.toBeNull(); // this doc's due invite was reaped
    expect(other?.redeemedAt).toBeNull(); // another doc's invite is left alone (#127)
  });

  it("isolates alarm steps: a failing D1 projection still runs invite expiry and never throws", async () => {
    // Intent: the alarm's steps (compact / project-to-D1 / expire-invites) are
    //   INDEPENDENT + best-effort. A transient failure in one (e.g. D1 briefly
    //   unavailable for the index projection) must NOT abort the others or surface
    //   as an unhandled alarm rejection — which would silently drop compaction and
    //   invite expiry, leaving a doc unsearchable and expired invites redeemable.
    // Arrange: a DO with identity + a due invite; force projectToD1 to throw.
    // Act: run the alarm. Assert: it resolves (no throw) AND the due invite is still
    //   reaped — proving expiry ran after the projection failed.
    const realDocs = env.DOC_DO;
    const name = uniqueDocName("routine");
    const id = realDocs.idFromName(name);
    const stub = realDocs.get(id) as unknown as DocStub;
    await stub.setMetadata({ doName: name, ownerId: "user_x" });
    const inviteId = `inv-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO invite (id, docRef, role, expiresAt, redeemedAt) VALUES (?, ?, ?, ?, NULL)",
    )
      .bind(inviteId, name, "editor", Date.now() - 1000)
      .run();

    await runInDurableObject(
      realDocs.get(id) as unknown as DurableObjectStub<import("./doc-do").DocDO>,
      async (instance) => {
        // projectToD1 is a private step; force it to fail to simulate a transient
        // D1 error during the alarm tick.
        vi.spyOn(
          instance as unknown as { projectToD1: () => Promise<void> },
          "projectToD1",
        ).mockRejectedValue(new Error("D1 projection boom"));
        await expect(instance.alarm()).resolves.toBeUndefined();
      },
    );

    const row = await env.DB.prepare("SELECT redeemedAt FROM invite WHERE id = ?")
      .bind(inviteId)
      .first<{ redeemedAt: number | null }>();
    expect(row?.redeemedAt).not.toBeNull(); // expiry ran despite the projection failing
  });
});

describe("T6 DO alarm: projects routine lesson/practice annotations to journal_entry", () => {
  async function journalCount(routineRef: string): Promise<number> {
    return (
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM journal_entry WHERE routineRef = ? AND deletedAt IS NULL",
        )
          .bind(routineRef)
          .first<{ n: number }>()
      )?.n ?? 0
    );
  }

  it("projects ONLY lesson/practice annotations (a plain note is not a journal entry)", async () => {
    const { name, stub } = freshDoc("routine");
    await stub.setMetadata({ doName: name, docRef: name, type: "routine", ownerId: "u_j" });
    await stub.applyChange({
      op: "addAnnotation",
      kind: "lesson",
      authorId: "u_j",
      text: "L",
      anchors: [],
    });
    await stub.applyChange({
      op: "addAnnotation",
      kind: "practice",
      authorId: "u_j",
      text: "P",
      anchors: [],
    });
    await stub.applyChange({
      op: "addAnnotation",
      kind: "note",
      authorId: "u_j",
      text: "N",
      anchors: [],
    });
    await stub.runAlarmForTest();
    expect(await journalCount(name)).toBe(2); // lesson + practice; the note is skipped
  });

  it("a non-routine (figure) DO projects NO journal rows (scoping, #per-doc-layering)", async () => {
    const { name, stub } = freshDoc("figure");
    // type 'global-figure' → projectJournalToD1 short-circuits even with annotations.
    await stub.setMetadata({ doName: name, docRef: name, type: "global-figure", ownerId: "u_j" });
    await stub.applyChange({
      op: "addAnnotation",
      kind: "lesson",
      authorId: "u_j",
      text: "L",
      anchors: [],
    });
    await stub.runAlarmForTest();
    expect(await journalCount(name)).toBe(0);
  });

  it("an annotation edit arms a coalesced alarm that projects without an explicit run", async () => {
    const { name, stub } = freshDoc("routine");
    await stub.setMetadata({ doName: name, docRef: name, type: "routine", ownerId: "u_j" });
    // Burst of edits → one coalesced alarm; do NOT call runAlarmForTest — the
    // scheduled alarm (run by workerd) must project the rows on its own.
    await stub.applyChange({
      op: "addAnnotation",
      kind: "lesson",
      authorId: "u_j",
      text: "A",
      anchors: [],
    });
    await stub.applyChange({
      op: "addAnnotation",
      kind: "practice",
      authorId: "u_j",
      text: "B",
      anchors: [],
    });
    // Poll until the scheduled alarm fires and projects (eventually consistent).
    let n = 0;
    for (let i = 0; i < 50 && n < 2; i++) {
      n = await journalCount(name);
      if (n < 2) await new Promise((r) => setTimeout(r, 20));
    }
    expect(n).toBe(2);
  });
});

describe("US-025 DO alarm: routine-card projection (bars / figureCount / forkedFromTitle)", () => {
  /** Read the projected card columns for a doc directly from D1. */
  async function cardRow(
    doName: string,
  ): Promise<{ bars: number | null; figureCount: number | null }> {
    const row = await env.DB.prepare(
      "SELECT bars, figureCount FROM document_registry WHERE doName = ?",
    )
      .bind(doName)
      .first<{ bars: number | null; figureCount: number | null }>();
    return { bars: row?.bars ?? null, figureCount: row?.figureCount ?? null };
  }

  /** Seed a figure DO with the given attribute counts + project it via its alarm. */
  async function seedFigure(counts: number[], dance: string): Promise<string> {
    const { name, stub } = freshDoc("figure");
    await stub.seedDoc({
      id: name,
      scope: "global",
      ownerId: "u_card",
      figureType: "natural-turn",
      dance,
      name: "Natural Turn",
      source: "library",
      attributes: counts.map((count, i) => ({
        id: `a${i}`,
        kind: "direction",
        count,
        role: null,
        value: "fwd",
        deletedAt: null,
      })),
      schemaVersion: 1,
      deletedAt: null,
    });
    await stub.setMetadata({
      doName: name,
      docRef: name,
      type: "global-figure",
      dance,
      ownerId: "u_card",
      title: "Natural Turn",
      figureType: "natural-turn",
    });
    await stub.runAlarmForTest();
    return name;
  }

  it("a FIGURE DO projects its OWN bar count (barsForFigure, max count across roles)", async () => {
    // count 5 (leader) and 7 (follower) → max 7; Waltz phraseBeats 6 → phrase 2 → 2 bars.
    const twoBars = await seedFigure([5, 7], "waltz");
    expect((await cardRow(twoBars)).bars).toBe(2);

    const oneBar = await seedFigure([1], "waltz"); // max 1 → 1 bar
    expect((await cardRow(oneBar)).bars).toBe(1);
  });

  it("a ROUTINE DO projects figureCount (non-deleted placements) + bars (Σ referenced figures)", async () => {
    const f1 = await seedFigure([7], "waltz"); // 2 bars
    const f2 = await seedFigure([1], "waltz"); // 1 bar

    const { name, stub } = freshDoc("routine");
    await stub.seedDoc({
      id: name,
      title: "Card Routine",
      dance: "waltz",
      ownerId: "u_card",
      sections: [
        {
          id: "s1",
          name: "Intro",
          deletedAt: null,
          placements: [
            { id: "p1", figureRef: f1, deletedAt: null }, // f1 placed twice
            { id: "p2", figureRef: f1, deletedAt: null },
            { id: "p3", figureRef: f2, deletedAt: null },
            { id: "p4", figureRef: f2, deletedAt: 12345 }, // tombstoned → excluded
          ],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    await stub.setMetadata({
      doName: name,
      docRef: name,
      type: "routine",
      dance: "waltz",
      ownerId: "u_card",
      title: "Card Routine",
    });
    await stub.runAlarmForTest();

    // figureCount = 3 live placements (p4 tombstoned); bars = f1*2 + f2 = 2+2+1 = 5.
    expect(await cardRow(name)).toEqual({ bars: 5, figureCount: 3 });

    // And it surfaces through the list projection the Choreo card reads.
    const list = await listRoutines(env.DB, "u_card");
    const item = list.find((r) => r.docRef === name);
    expect(item).toMatchObject({ bars: 5, figureCount: 3 });
  });

  it("projects figureCount 0 for a routine with no placements ('no figures yet')", async () => {
    const { name, stub } = freshDoc("routine");
    await stub.setMetadata({
      doName: name,
      docRef: name,
      type: "routine",
      dance: "tango",
      ownerId: "u_empty",
      title: "Empty",
    });
    await stub.runAlarmForTest();
    expect(await cardRow(name)).toEqual({ bars: 0, figureCount: 0 });
  });

  it("resolves forkedFromTitle from forkedFromRef on the list read", async () => {
    const origin = uniqueDocName("rt_origin");
    const fork = uniqueDocName("rt_fork");
    await seedDb({
      users: [{ id: "u_lin", displayName: "Lin", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: origin,
          type: "routine",
          ownerId: "u_lin",
          doName: origin,
          title: "Origin Routine",
        },
        {
          docRef: fork,
          type: "routine",
          ownerId: "u_lin",
          doName: fork,
          title: "My Fork",
          forkedFromRef: origin,
        },
      ],
    });
    const list = await listRoutines(env.DB, "u_lin");
    expect(list.find((r) => r.docRef === fork)?.forkedFromTitle).toBe("Origin Routine");
    // A non-fork carries no lineage line.
    expect(list.find((r) => r.docRef === origin)?.forkedFromTitle).toBeUndefined();
  });

  it("keeps the joined Choreo-list query indexed (EXPLAIN, no SCAN)", async () => {
    // The forkedFromTitle self-join must stay a PK lookup, not a table scan: outer
    // routine rows from document_registry_owner_idx, the origin title from the PK.
    await expectIndexedQuery(
      env.DB,
      "SELECT dr.docRef, dr.title, dr.dance, dr.updatedAt, dr.bars, dr.figureCount, origin.title " +
        "FROM document_registry dr " +
        "LEFT JOIN document_registry origin ON origin.docRef = dr.forkedFromRef " +
        "WHERE dr.ownerId = ? AND dr.type = 'routine' AND dr.deletedAt IS NULL " +
        "ORDER BY dr.updatedAt DESC",
      ["u_card"],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// v5 milestone step 1 (PLAN §7, 2026-07-02 review): "the ladder runs on the DO
// load path, and fresh docs are stamped CURRENT_SCHEMA_VERSION". Before this,
// `migrate()`/`CURRENT_SCHEMA_VERSION` had zero production callers — every seed
// site stamped a hardcoded `schemaVersion: 1` and the system survived on
// lenient reads only. These tests pin the load-path wiring in doc-do.ts
// (`loadPersisted` → `migrateOnLoad`, `packages/domain/src/migrations.ts`
// `migrateDraft`).
// ─────────────────────────────────────────────────────────────────────────

describe("v5 milestone step 1 — migration ladder wired into the DO load path", () => {
  it("migrates a persisted v1-shaped doc on load and the upgrade STAYS persisted after reload", async () => {
    // Arrange: a routine seeded at schemaVersion 1 — legacy shape: a section/
    // placement with no sortKey (v3→v4), plus a stray top-level `attributes`
    // array carrying a legacy `step`-kind entry (v1→v2 footwork retag; the
    // ladder only checks for the array's presence, so exercising both steps on
    // one doc is legitimate here even though a real routine doc never carries
    // `attributes`).
    const { stub } = freshDoc("routine");
    await stub.seedDoc({
      id: "rt_legacy",
      title: "Legacy Routine",
      dance: "waltz",
      ownerId: "u_legacy",
      sections: [
        {
          id: "s1",
          name: "Intro",
          placements: [{ id: "p1", figureRef: "f1", deletedAt: null }],
        },
      ],
      annotations: [],
      attributes: [{ id: "a1", kind: "step", count: 1, value: "H" }],
      schemaVersion: 1,
      deletedAt: null,
    });

    // seedDoc caches the UNMIGRATED doc straight into memory (this.doc) — force
    // the SQLite cold-load path so `loadPersisted`/`migrateOnLoad` actually runs.
    await stub.reloadForTest();
    const migrated = await stub.getSnapshot();

    const migratedTyped = migrated as unknown as {
      schemaVersion: number;
      sections: Array<{ sortKey?: string; placements: Array<{ sortKey?: string }> }>;
      attributes: Array<{ kind: string }>;
    };
    expect(migratedTyped.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migratedTyped.sections[0]?.sortKey).toEqual(expect.any(String));
    expect(migratedTyped.sections[0]?.placements[0]?.sortKey).toEqual(expect.any(String));
    expect(migratedTyped.attributes[0]?.kind).toBe("footwork"); // step → footwork retag (v1→v2)

    // STAYS migrated: the upgrade was PERSISTED as a real change, not just
    // recomputed on this one read — a further eviction/reload must read back
    // the SAME migrated state (identical sortKeys — no re-migration artifact).
    await stub.reloadForTest();
    const again = await stub.getSnapshot();
    expect(again).toEqual(migrated);
  });

  it("a brand-new doc is born at CURRENT_SCHEMA_VERSION, never a hardcoded legacy version", async () => {
    const { stub } = freshDoc("routine");
    // No seedDoc: the FIRST touch auto-materializes the empty routine (getDoc's
    // never-before-used path), which must itself stamp CURRENT — not `1`.
    await stub.applyChange({ op: "addSection", name: "Basic" });
    const fresh = await stub.getSnapshot();
    expect(fresh.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("a doc already at CURRENT passes through untouched — no extra change is persisted", async () => {
    const { stub } = freshDoc("routine");
    await stub.seedDoc({
      id: "rt_current",
      title: "Already Current",
      dance: "waltz",
      ownerId: "u_cur",
      sections: [],
      annotations: [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      deletedAt: null,
    });
    const rowsAfterSeed = await stub.debugChangeRowCount();
    await stub.reloadForTest(); // forces loadPersisted/migrateOnLoad to run
    expect(await stub.debugChangeRowCount()).toBe(rowsAfterSeed); // no migration change appended
    expect((await stub.getSnapshot()).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("the migration change is never a user's undo target — undo reverts the user's edit, not the schema upgrade", async () => {
    const realDocs = env.DOC_DO;
    const name = uniqueDocName("routine");
    const id = realDocs.idFromName(name);
    const stub = realDocs.get(id) as unknown as DocStub;

    // A legacy v1 doc, migrated on load (as above).
    await stub.seedDoc({
      id: name,
      title: "Legacy",
      dance: "waltz",
      ownerId: "u_undo",
      sections: [{ id: "s1", name: "Intro", placements: [] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    await stub.reloadForTest(); // runs + persists the migration

    // A real user's op-based edit AFTER the migration.
    await stub.applyChange({ op: "addSection", name: "UserEdit" });

    await runInDurableObject(
      realDocs.get(id) as unknown as DurableObjectStub<import("./doc-do").DocDO>,
      async (instance) => {
        const doc = (instance as unknown as { getDoc: () => A.Doc<RoutineDoc> }).getDoc();
        const changes = A.getAllChanges(doc).map((c) => A.decodeChange(c));
        const migration = changes.find((c) => c.message === "ballroom:migrate");
        expect(migration).toBeDefined();
        const userEdit = changes[changes.length - 1];
        expect(userEdit?.message).not.toBe("ballroom:migrate");
        // The migration and the user's op-based edit are attributed to DIFFERENT
        // actors — the structural guarantee that keeps per-user undo
        // (`undoLastChange`, which filters strictly by actor id) from ever
        // selecting the migration change.
        expect(userEdit?.actor).not.toBe(migration?.actor);

        // Undo, scoped to the user's own actor: reverts ONLY their edit.
        const undone = undoLastChange(doc, userEdit?.actor as string);
        const routine = readRoutine(undone);
        expect(routine.sections.some((s) => s.name === "UserEdit")).toBe(false);
        // The migration's effects (schemaVersion bump) are untouched by the undo.
        expect(routine.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      },
    );
  });
});

describe("storage-format version marker", () => {
  // The DO's SQLite layout (changes/snapshot/doc_meta) is otherwise unversioned:
  // if the persistence scheme ever changes (e.g. adopting automerge-repo storage,
  // the D6 escape hatch), a migrator must be able to tell which generation a
  // DO's storage is in WITHOUT shape-sniffing tables across every document.
  // storage_meta stamps generation 1 at construction — for brand-new DOs and,
  // idempotently, for every pre-marker DO the moment it next wakes up.
  it("stamps storage_meta with the current storage version on construction", async () => {
    const { stub } = freshDoc("routine");
    expect(await stub.debugStorageVersion()).toBe(1);
  });

  it("keeps the marker stable across edits and reloads (idempotent stamp)", async () => {
    const { stub } = freshDoc("routine");
    await stub.applyChange({ op: "addSection", name: "A" });
    await stub.reloadForTest(); // simulated eviction → constructor re-runs
    expect(await stub.debugStorageVersion()).toBe(1);
  });
});

describe("legacy break → Break-figure migration (Builder v3 ④, alarm-driven)", () => {
  it("rewrites {source:'break'} placements into minted Break figure docs on the alarm", async () => {
    // Intent (owner decision 2026-07-07): a Break is a real choreo-local figure.
    //   Legacy break placements are MIGRATED — the alarm mints a Break figure doc
    //   per break (registry row + placement edge + DO seed, owned by the routine's
    //   owner) FIRST, then rewrites the routine's placements under the migration
    //   actor. Idempotent: a second alarm finds no breaks.
    const { name, stub } = freshDoc("routine");
    await stub.seedDoc({
      id: name,
      title: "Break Legacy",
      dance: "waltz",
      ownerId: "user_bl",
      sections: [
        {
          id: "s1",
          name: "Side",
          placements: [
            { id: "p1", figureRef: "fig_keep", sortKey: "a0", deletedAt: null },
            { id: "p2", source: "break", beats: 4, sortKey: "a1", deletedAt: null },
          ],
          deletedAt: null,
        },
      ],
      annotations: [],
      schemaVersion: 5,
      deletedAt: null,
    });
    await stub.setMetadata({ doName: name, ownerId: "user_bl" });

    await stub.runAlarmForTest();

    const doc = (await stub.getSnapshot()) as unknown as {
      sections: Array<{
        placements: Array<{ id: string; figureRef?: string; source?: string; beats?: number }>;
      }>;
    };
    const p2 = doc.sections[0]?.placements.find((p) => p.id === "p2");
    expect(p2?.source).toBeUndefined(); // no longer a special break entry
    expect(p2?.beats).toBeUndefined();
    expect(p2?.figureRef).toBeTruthy(); // re-pointed at the minted Break figure
    const breakRef = p2?.figureRef as string;
    expect(breakRef).not.toBe("fig_keep");

    // The minted figure: registry row owned by the routine owner + placement edge.
    const row = await env.DB.prepare(
      "SELECT ownerId, type, title FROM document_registry WHERE docRef = ?",
    )
      .bind(breakRef)
      .first<{ ownerId: string; type: string; title: string | null }>();
    expect(row?.ownerId).toBe("user_bl");
    expect(row?.type).toBe("account-figure");
    const edge = await env.DB.prepare(
      "SELECT 1 AS x FROM placement_edge WHERE routineRef = ? AND figureRef = ?",
    )
      .bind(name, breakRef)
      .first();
    expect(edge).toBeTruthy();

    // The Break figure doc itself: a bar-spanning empty timeline (counts = beats).
    const figStub = docs.get(docs.idFromName(breakRef));
    const fig = (await figStub.getFigureSnapshot()) as unknown as {
      name: string;
      counts?: number;
    };
    expect(fig.name).toBe("Break");
    expect(fig.counts).toBe(4);

    // Idempotent: a second alarm changes nothing further.
    await stub.runAlarmForTest();
    const again = (await stub.getSnapshot()) as unknown as typeof doc;
    expect(again.sections[0]?.placements.find((p) => p.id === "p2")?.figureRef).toBe(breakRef);
  });
});
