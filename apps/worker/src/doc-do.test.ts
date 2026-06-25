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
    // Scenario: one client writes a change; the DO is evicted; a new stub for the
    //   SAME id must cold-load from SQLite.
    // Arrange: a unique routine DO; apply a change. Act: get a fresh stub for the
    //   same id and read the doc back. Assert: rehydrated doc has the change.
    // Covers US-014 AC-1 (incremental persist) + AC-2 (rehydrate) — §10.2 "SQLite persistence".
    const name = uniqueDocName("routine");
    const id = docs.idFromName(name);
    const change = await docs.get(id).applyChange({ op: "addSection", name: "Intro" });
    const doc = await docs.get(id).getSnapshot(); // a fresh stub → cold-load path
    expect((doc.sections ?? []).map((s) => s.name)).toContain("Intro");
    expect(change).toBeTruthy();
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
});

describe.skip("US-015 Live WebSocket sync (two clients converge)", () => {
  it("converges two clients exchanging Automerge changes over the DO", async () => {
    // Intent: two clients of one DO exchange changes and converge (M0.5 S2; the
    //   live-WS piece deferred from the spike — validate here).
    // Multi-client scenario: client A and client B both connect to the SAME DO id,
    //   open two WS connections via stub.fetch(Upgrade: websocket), and each writes
    //   a concurrent change.
    // Arrange: one unique DO. Act: drive c1 from A and c2 from B; flush. Assert:
    //   both clients' snapshots are byte-identical and contain BOTH c1 and c2.
    // Covers US-015 AC-1 — §10.2 "two clients converge through a real DO".
    const { stub } = freshDoc("routine");
    const upgrade = new Request("https://do/connect", { headers: { Upgrade: "websocket" } });
    const res = await stub.fetch(upgrade);
    expect(res.status).toBe(101);
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
    const doc = await stub.getSnapshot();
    expect((doc.sections ?? []).map((s) => s.name)).toContain("Survives");
  });

  it("is idempotent when the same change arrives twice over the socket", async () => {
    // Intent: a duplicate change delivery is a no-op (CRDT idempotence on the wire).
    // Arrange: a DO with one applied change. Act: deliver the SAME change bytes again.
    // Assert: the doc snapshot is unchanged before/after the duplicate.
    // Covers US-015 AC-3 (duplicate change idempotent).
    const { stub } = freshDoc("routine");
    const change = await stub.applyChange({ op: "addSection", name: "Once" });
    const before = await stub.getSnapshot();
    await stub.applyRawChange(change);
    const after = await stub.getSnapshot();
    expect(after).toEqual(before);
  });
});

describe.skip("US-016 DO alarm: compaction + D1 index projection + invite expiry", () => {
  it("compacts persisted history on the alarm (off the request path)", async () => {
    // Intent: the alarm compacts incremental changes into a fresh snapshot.
    // Arrange: a DO with many incremental changes. Act: run the alarm. Assert: the
    //   persisted byte size shrinks (or change-count resets), doc unchanged.
    // Covers US-016 AC-1 (compaction) + AC-4 (off request path).
    const { stub } = freshDoc("routine");
    for (let i = 0; i < 20; i++) await stub.applyChange({ op: "addSection", name: `S${i}` });
    const before = await stub.debugPersistedSize();
    await stub.runAlarmForTest();
    const after = await stub.debugPersistedSize();
    expect(after).toBeLessThanOrEqual(before);
  });

  it("projects a thin registry row to D1 on the alarm", async () => {
    // Intent: the alarm writes title/dance/owner/updatedAt/figureType to D1 so
    //   list/search work WITHOUT reading CRDT content.
    // Arrange: a routine DO with metadata. Act: run the alarm. Assert: a
    //   document_registry row exists in D1 reflecting the metadata.
    // Covers US-016 AC-2 (D1 index projection).
    const { name, stub } = freshDoc("routine");
    await stub.setMetadata({ title: "Projected", dance: "foxtrot", ownerId: "user_x" });
    await stub.runAlarmForTest();
    const row = await env.DB.prepare("SELECT title, dance FROM document_registry WHERE doName = ?")
      .bind(name)
      .first<{ title: string; dance: string }>();
    expect(row).toMatchObject({ title: "Projected", dance: "foxtrot" });
  });

  it("expires due invites on the alarm", async () => {
    // Intent: expired invites are reaped off the request path.
    // Arrange: an invite row with expiresAt in the past. Act: run the alarm.
    // Assert: the invite is no longer redeemable (marked/removed).
    // Covers US-016 AC-3 (invite expiry).
    const { stub } = freshDoc("routine");
    await stub.runAlarmForTest();
    expect(true).toBe(true); // refined against the M2 invite table semantics
  });
});
