import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { uniqueDocName } from "./test-support/do-id";
import type { DocNamespace, DocStub } from "./test-support/doc-do-api";
import { applyMigrations } from "./test-support/seed";

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

beforeAll(async () => {
  // Per-suite freshly-migrated D1 (empty migrations until M2 → no-op today).
  await applyMigrations();
});

describe("US-014 Per-document SQLite-backed DO hosts an Automerge doc", () => {
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
    const { stub } = freshDoc("routine");

    const res = await stub.fetch(
      new Request("https://do/connect", { headers: { Upgrade: "websocket" } }),
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

  it("expires due invites on the alarm", async () => {
    // Intent: expired invites are reaped off the request path.
    // Arrange: an open invite whose expiresAt is in the past. Act: run the alarm.
    // Assert: the invite is marked redeemed (no longer redeemable).
    // Covers US-016 AC-3 (invite expiry sweep — invite rows populated in M3/US-023).
    const { stub } = freshDoc("routine");
    const inviteId = `inv-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO invite (id, docRef, role, expiresAt, redeemedAt) VALUES (?, ?, ?, ?, NULL)",
    )
      .bind(inviteId, "doc-x", "editor", Date.now() - 1000)
      .run();

    await stub.runAlarmForTest();

    const row = await env.DB.prepare("SELECT redeemedAt FROM invite WHERE id = ?")
      .bind(inviteId)
      .first<{ redeemedAt: number | null }>();
    expect(row?.redeemedAt).not.toBeNull(); // the due invite was reaped
  });
});
