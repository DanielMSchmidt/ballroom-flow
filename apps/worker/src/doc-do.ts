// US-014 — Per-document SQLite-backed Durable Object hosting an Automerge doc.
//
// PLAN §6 / D23: one DO per document (routine + figure docs). The DO holds the
// Automerge doc in memory and persists INCREMENTAL changes to its own SQLite —
// never a full rewrite per edit (SPIKE-FINDINGS sharp-edge #2). After eviction a
// fresh DO instance rehydrates the same doc by replaying the persisted changes
// (S1). D1 stays a pure index; canonical CRDT content lives here in DO SQLite.
//
// Scope note (US-014): this lands the persistence/rehydration core + per-document
// topology. Live WebSocket sync (US-015) and the alarm compaction / D1 projection
// (US-016) build on this DO but are separate stories — their methods are not
// implemented here yet.

import { DurableObject } from "cloudflare:workers";
import * as A from "@automerge/automerge";
import { SYNC_CAUGHT_UP } from "@ballroom/contract";
import {
  addAnnotation,
  addSection,
  buildDoc,
  buildRoutineDoc,
  can,
  type EffectiveRole,
  type RoutineDoc,
  readRoutine,
} from "@ballroom/domain";
import { authenticateToken } from "./auth";
import { resolveEffectiveRole } from "./db/membership";
import type { Env } from "./index";

/** Per-connection socket attachment (survives hibernation). */
interface SocketAttachment {
  /** Stable per-connection Automerge actor id (hex). */
  actor: string;
  /** The connection's resolved per-document role (US-021); gates socket writes. */
  role: EffectiveRole;
}

/** A high-level mutation request the DO knows how to apply to a routine doc. */
export type DocOp =
  | ({ op: "addSection"; name: string } & Record<string, unknown>)
  | ({ op: "addAnnotation"; text: string } & Record<string, unknown>);

/**
 * Compact once the incremental change log grows past this many rows. Bounds both
 * the log size and the US-015 replay-on-connect cost (which scans the whole log
 * on every WS connect) for a write-heavy doc that never sets metadata.
 */
const COMPACT_THRESHOLD = 64;

/** Order-independent equality of two Automerge head sets (same logical state). */
function headsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return [...a].sort().every((h, i) => h === sortedB[i]);
}

/**
 * A fresh per-connection Automerge actor id. Actor ids MUST be hex strings, so
 * we render 16 random bytes as hex (not a UUID with dashes, which Automerge
 * rejects).
 */
function newActorId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The empty routine shape a freshly-created routine DO starts from. Identity
 * fields (id/ownerId/title/dance) are placeholders until `setMetadata` (US-016)
 * or a create flow sets them; US-014 only needs a well-formed, mutable doc whose
 * sections list can grow. `schemaVersion` matches the domain CURRENT version.
 */
function emptyRoutine(): RoutineDoc {
  return {
    id: "",
    title: "",
    dance: "waltz",
    ownerId: "",
    sections: [],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  };
}

export class DocDO extends DurableObject<Env> {
  /** In-memory Automerge doc; `null` until first load/cold-load from SQLite. */
  private doc: A.Doc<RoutineDoc> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    // Append-only change log: each row is one Automerge change (incremental
    // bytes), replayed in `seq` order to rebuild the doc.
    sql.exec(
      "CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)",
    );
    // Compaction snapshot (US-016): a single saved-doc blob the alarm writes to
    // bound the change log. `getDoc` loads it then replays only later changes.
    sql.exec(
      "CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 0), data BLOB NOT NULL)",
    );
    // D1-projected metadata (US-016 AC-2): the thin index fields the alarm pushes
    // to the D1 document_registry. Single row keyed at id=0.
    sql.exec(
      "CREATE TABLE IF NOT EXISTS doc_meta (id INTEGER PRIMARY KEY CHECK (id = 0), doName TEXT, docRef TEXT, type TEXT, ownerId TEXT, title TEXT, dance TEXT, figureType TEXT)",
    );
  }

  /**
   * Resolve the in-memory doc, cold-loading from SQLite when this instance has
   * no doc yet (fresh DO or post-eviction). If SQLite is empty this is a
   * never-before-used document, so we seed the empty routine and persist its
   * creation changes — making the cold-load path self-contained.
   */
  private getDoc(): A.Doc<RoutineDoc> {
    if (this.doc) return this.doc;

    const sql = this.ctx.storage.sql;
    const snapRows = sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM snapshot WHERE id = 0")
      .toArray();
    const changeRows = sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM changes ORDER BY seq ASC")
      .toArray();

    if (snapRows.length === 0 && changeRows.length === 0) {
      // First touch: seed an empty routine and persist its creation changes so a
      // later cold-load rebuilds the identical doc from SQLite alone.
      const seeded = buildRoutineDoc(emptyRoutine());
      this.persist(A.getAllChanges(seeded));
      this.doc = seeded;
      return seeded;
    }

    // Start from the compacted snapshot (if the alarm has run), then replay any
    // incremental changes recorded after it. Without a snapshot, replay all
    // changes from an empty doc (the US-014 path).
    let doc =
      snapRows[0] !== undefined
        ? A.load<RoutineDoc>(new Uint8Array(snapRows[0].data))
        : A.init<RoutineDoc>();
    if (changeRows.length > 0) {
      const changes = changeRows.map((r) => new Uint8Array(r.data) as A.Change);
      [doc] = A.applyChanges(doc, changes);
    }
    this.doc = doc;
    return doc;
  }

  /**
   * Append one or more raw change blobs to the SQLite change log. An Automerge
   * `Change` is an opaque branded `Uint8Array`, hence the casts below.
   */
  private persist(changes: A.Change[]): void {
    for (const change of changes) {
      // Store the raw bytes; Cloudflare's SQLite accepts an ArrayBuffer BLOB.
      const buf = (change as Uint8Array).buffer.slice(
        (change as Uint8Array).byteOffset,
        (change as Uint8Array).byteOffset + (change as Uint8Array).byteLength,
      );
      this.ctx.storage.sql.exec("INSERT INTO changes (data) VALUES (?)", buf);
    }
  }

  /**
   * Seed a never-before-used document's INITIAL content durably, server-side, at
   * create (#201/#109). The worker calls this from POST /api/routines & /figures
   * after the D1 projection, so the doc's title/dance (routine) or name/etc.
   * (figure) is DO-PERSISTED the instant the doc exists — instead of a client
   * write that can be lost on a reload right after create. NO-CLOBBER: if the DO
   * already has any persisted content, this is a no-op (never overwrites a real
   * doc). Seeding here also means a later connect finds real content and never
   * auto-materializes the empty-routine placeholder (#109).
   */
  async seedDoc(content: Record<string, unknown>): Promise<void> {
    if (this.doc) return;
    const sql = this.ctx.storage.sql;
    const hasSnap = sql.exec("SELECT 1 FROM snapshot WHERE id = 0 LIMIT 1").toArray().length > 0;
    const hasChanges = sql.exec("SELECT 1 FROM changes LIMIT 1").toArray().length > 0;
    if (hasSnap || hasChanges) return; // already a real doc — don't clobber
    const seeded = buildDoc(content) as A.Doc<RoutineDoc>;
    this.persist(A.getAllChanges(seeded));
    this.doc = seeded;
  }

  /**
   * Apply a high-level op to the doc, persist EVERY change the op produced, and
   * return the op's representative change bytes. We persist
   * `A.getChanges(before, after)` — the full set of changes since the pre-op
   * doc — rather than only the last local change. This removes the latent
   * one-change-per-op constraint: an op that does more than one `A.change`
   * (none today, but US-017+ may) would otherwise drop its earlier changes from
   * the SQLite log, diverging the cold-loaded doc from in-memory (data loss).
   * Each change is still its own row, so persistence stays incremental — never
   * a full-doc rewrite. (US-015 will diff with the same `getChanges` for the
   * sync wire.)
   */
  async applyChange(op: DocOp): Promise<Uint8Array> {
    const before = this.getDoc();
    const after = this.applyOp(before, op);
    const changes = A.getChanges(before, after);
    this.doc = after;
    if (changes.length === 0) {
      // A no-op mutation produced no change; keep state and return empty bytes.
      return new Uint8Array();
    }
    this.persist(changes);
    await this.maybeScheduleCompaction();
    // An RPC edit also propagates to any live WebSocket clients of this doc.
    this.broadcast(changes, null);
    // One op is one change today; return the last change's bytes as the op's
    // representative payload. The FULL set is what's persisted (and, in US-015,
    // synced) — so a future multi-change op loses nothing.
    return changes[changes.length - 1] as Uint8Array;
  }

  /**
   * Apply raw Automerge change bytes from a peer (US-015 sync). Idempotent: a
   * duplicate change leaves the doc's heads unchanged, so we persist + broadcast
   * only when the change actually advances the doc (CRDT idempotence on the
   * wire). Returns true when the change was new.
   */
  async applyRawChange(change: Uint8Array): Promise<boolean> {
    return this.ingestChange(change, null);
  }

  /**
   * Apply one incoming change to the in-memory doc; persist + relay it only if
   * it advanced the doc (new change). `from` is the socket the change arrived on
   * (excluded from the broadcast); null for RPC/relay-to-all.
   */
  private async ingestChange(change: Uint8Array, from: WebSocket | null): Promise<boolean> {
    const before = this.getDoc();
    const beforeHeads = A.getHeads(before);
    const [after] = A.applyChanges(before, [change as A.Change]);
    this.doc = after;
    // Heads unchanged ⇒ the change was already present (duplicate) ⇒ no-op.
    if (headsEqual(beforeHeads, A.getHeads(after))) return false;
    this.persist([change as A.Change]);
    await this.maybeScheduleCompaction();
    this.broadcast([change as A.Change], from);
    return true;
  }

  /** Map a high-level op onto a domain mutation. Unknown ops are a no-op change. */
  private applyOp(doc: A.Doc<RoutineDoc>, op: DocOp): A.Doc<RoutineDoc> {
    switch (op.op) {
      case "addSection":
        return addSection(doc, { name: String(op.name) });
      case "addAnnotation":
        return addAnnotation(doc, {
          authorId: "tester",
          kind: "note",
          text: String(op.text),
          anchors: [{ type: "figure", figureRef: "f1" }],
        });
      default:
        return doc;
    }
  }

  /** Resolve and return the current doc as a plain POJO (tombstones dropped). */
  async getSnapshot(): Promise<RoutineDoc> {
    return readRoutine(this.getDoc());
  }

  // ── US-015: live WebSocket sync (custom Automerge change-sync, D13) ─────────

  /**
   * WebSocket entrypoint. Upgrades the request to a Hibernatable WebSocket the
   * runtime owns (so the DO can hibernate while idle and wake on a message
   * WITHOUT dropping state — state lives in SQLite). On connect we replay the
   * full change log to the new client so it catches up, then it exchanges
   * incremental changes via `webSocketMessage`.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    // The Worker route forwards the doc's name (the idFromName key) — the DO
    // can't recover it from `ctx.id` (US-016). Remember it so the alarm can
    // project the D1 registry row keyed by doName even if `setMetadata` is never
    // called for a connect-only doc.
    // SECURITY (#133/#134): `x-doc-name` is the DO's identity (its idFromName
    // key), set ONLY by the trusted Worker connect route — the DO can't recover
    // it from `ctx.id`. `rememberDoName` persists it once (COALESCE), so a later
    // request can't overwrite an established doc's identity; we authorize against
    // THIS name. (A forged x-doc-name only ever targets the DO you already
    // addressed via idFromName, so it can't cross-authorize another document.)
    const doName = request.headers.get("x-doc-name");
    if (doName) this.rememberDoName(doName);

    // US-021 — FAIL-CLOSED per-document permission boundary (PLAN §5.1/§6).
    // A token is REQUIRED and verified BEFORE any role lookup (AC-1 fail-closed):
    //   • missing/invalid/expired token → 401 (never reaches the role check)
    //   • valid token, non-member       → 403 (per-doc, routine AND figure; AC-3)
    // The owner is elevated even without a membership row (#168). The resolved
    // role rides on the socket attachment so webSocketMessage can gate writes.
    const user = await authenticateToken(request.headers.get("Authorization"), this.env);
    if (!user) return new Response("unauthenticated", { status: 401 });
    if (!doName) return new Response("missing doc name", { status: 400 });
    const role = await resolveEffectiveRole(this.env.DB, doName, user.sub);
    if (!role) return new Response("forbidden", { status: 403 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Per-connection attachment (#107/#70): a stable Automerge actor id so any
    // DO-side mutation on behalf of this connection is attributed to it (never
    // the DO's own actor, which would break per-user undo), plus the connection's
    // resolved role so webSocketMessage can refuse a read-only socket's writes.
    // Survives hibernation via the socket attachment.
    const attachment: SocketAttachment = { actor: newActorId(), role };
    server.serializeAttachment(attachment);

    // Accept as a Hibernatable WebSocket (handlers are DO methods, so they
    // survive hibernation — unlike addEventListener closures).
    this.ctx.acceptWebSocket(server);

    // Catch the new client up with the full current state (all changes so far),
    // then signal catch-up-complete (#202) so the client knows the doc is
    // HYDRATED — not merely socket-open — and may safely begin editing. The
    // marker is a TEXT frame, distinct from the binary change frames above.
    const snapshot = A.getAllChanges(this.getDoc());
    for (const change of snapshot) server.send(change as Uint8Array);
    server.send(SYNC_CAUGHT_UP);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A change arrived from a connected client. Binary frames are raw Automerge
   * change bytes; apply (idempotently) and relay to the OTHER clients so all
   * connections converge.
   *
   * US-021 + US-039 permission boundary: writes are gated by the connection's
   * role. An editor/owner (`canEdit`) may make any change. A COMMENTER
   * (`canAnnotate`, not `canEdit`) may make a change that touches ONLY annotations
   * — classified by EFFECT (#117), not by a client-declared label, so a commenter
   * can't smuggle a structural edit through by mislabelling the frame. A viewer is
   * read-only. This is defence in depth: the connection was already authorized at
   * upgrade, but the role still bounds what it may DO.
   *
   * Frames are still untrusted: a malformed frame (not valid Automerge change
   * bytes) must NOT crash the handler — we DROP it (Automerge `applyChanges`
   * throws "Invalid magic bytes" on garbage).
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message === "string") return; // sync frames are binary; ignore text
    const role = this.socketRole(ws);
    if (!role) return; // no/garbled attachment → read-only
    const bytes = new Uint8Array(message);
    const allowed =
      can(role, "canEdit") || (can(role, "canAnnotate") && this.touchesOnlyAnnotations(bytes));
    if (!allowed) return;
    try {
      await this.ingestChange(bytes, ws);
    } catch {
      // Malformed/unapplyable frame — drop it; other clients + the doc are
      // unaffected. (Automerge `applyChanges` throws on garbage bytes.)
    }
  }

  /**
   * Classify a change by EFFECT (US-039/#117): does applying it to the current
   * doc change anything OTHER than `annotations`? Used to admit a commenter's
   * annotation while refusing a structural edit, without trusting any
   * client-supplied label. An unapplyable (malformed) frame is not an annotation.
   * Compares with tombstones INCLUDED so a structural soft-delete still counts as
   * structural.
   */
  private touchesOnlyAnnotations(change: Uint8Array): boolean {
    const before = this.getDoc();
    let after: A.Doc<RoutineDoc>;
    try {
      // Clone first: A.applyChanges may free its input handle; the live doc must
      // stay valid for the subsequent real ingest.
      [after] = A.applyChanges(A.clone(before), [change as A.Change]);
    } catch {
      return false;
    }
    const nonAnnotation = (doc: A.Doc<RoutineDoc>): string =>
      JSON.stringify({ ...readRoutine(doc, { includeDeleted: true }), annotations: [] });
    return nonAnnotation(before) === nonAnnotation(after);
  }

  /** The connection's resolved role from its socket attachment, or null. */
  private socketRole(ws: WebSocket): EffectiveRole | null {
    try {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      return att?.role ?? null;
    } catch {
      return null; // no/garbled attachment (e.g. a never-accepted socket) → read-only
    }
  }

  /**
   * Persist the document's DO name (the idFromName key) into doc_meta if not
   * already recorded, so the alarm's D1 projection is keyed correctly. Upsert
   * only sets `doName`; `setMetadata` fills the rest of the index fields.
   */
  private rememberDoName(doName: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO doc_meta (id, doName, type) VALUES (0, ?, 'routine')
       ON CONFLICT(id) DO UPDATE SET doName = COALESCE(doc_meta.doName, excluded.doName)`,
      doName,
    );
  }

  /** A client disconnected — close the server side cleanly. */
  async webSocketClose(ws: WebSocket, code: number, _reason: string): Promise<void> {
    try {
      ws.close(code);
    } catch {
      // already closing/closed — nothing to do.
    }
  }

  /**
   * Relay change bytes to every connected client except `from` (the socket the
   * change arrived on). Uses the Hibernation API's `getWebSockets()` so it works
   * even after the DO has hibernated and woken.
   */
  private broadcast(changes: A.Change[], from: WebSocket | null): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    for (const change of changes) {
      const bytes = change as Uint8Array;
      for (const ws of sockets) {
        if (ws === from) continue;
        try {
          ws.send(bytes);
        } catch {
          // a closing socket can't receive — skip it.
        }
      }
    }
  }

  /**
   * Test-only: drop the in-memory doc and rebuild it from SQLite, simulating a
   * post-eviction cold instance. vitest-pool-workers keeps a DO warm between RPC
   * calls, so without this the AC-2 rehydration path (`getDoc`'s SQLite replay)
   * is never exercised by a test. Production eviction does the same thing for
   * free — a fresh instance starts with `doc === null`.
   */
  async reloadForTest(): Promise<void> {
    this.doc = null;
    this.getDoc();
  }

  /**
   * Test-only: number of rows in the SQLite change log. Lets a test assert
   * persistence is genuinely incremental (one row per change) rather than a
   * full-doc rewrite, without reaching into the DO's protected storage handle.
   */
  async debugChangeRowCount(): Promise<number> {
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM changes").one().n;
  }

  /**
   * Test-only: build a valid, lineage-compatible change for `op` against the
   * CURRENT doc WITHOUT applying or persisting it. Lets a test feed a real change
   * through `webSocketMessage` to prove the US-021 socket-write role gate (a
   * viewer's frame is dropped; the same bytes from an editor apply).
   */
  async buildChangeForTest(op: DocOp): Promise<Uint8Array> {
    // Clone first: applyOp goes through A.change, which INVALIDATES its input
    // handle — applying it to the live `this.doc` would free the DO's doc
    // (Automerge outdated-doc edge). The clone shares history, so the resulting
    // change still applies cleanly onto this.doc and advances it.
    const base = A.clone(this.getDoc());
    const after = this.applyOp(base, op);
    return (A.getChanges(base, after)[0] ?? new Uint8Array()) as Uint8Array;
  }

  // ── US-016: DO alarm — compaction + D1 index projection + invite expiry ─────

  /**
   * Set the thin index metadata the alarm projects to D1 (title/dance/owner/
   * figureType + the doName/docRef keys). Stored in DO SQLite so it survives
   * eviction; the alarm reads it. `doName` is the document's DO name (the
   * idFromName key) — the DO can't recover it from `ctx.id`, so the caller
   * supplies it. Schedules the alarm so the projection happens off the request
   * path (D24/§6.2).
   */
  async setMetadata(meta: Record<string, unknown>): Promise<void> {
    const str = (k: string): string | null => (meta[k] == null ? null : String(meta[k]));
    this.ctx.storage.sql.exec(
      `INSERT INTO doc_meta (id, doName, docRef, type, ownerId, title, dance, figureType)
       VALUES (0, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         doName = COALESCE(excluded.doName, doc_meta.doName),
         docRef = COALESCE(excluded.docRef, doc_meta.docRef),
         type = COALESCE(excluded.type, doc_meta.type),
         ownerId = COALESCE(excluded.ownerId, doc_meta.ownerId),
         title = excluded.title,
         dance = excluded.dance,
         figureType = excluded.figureType`,
      str("doName"),
      str("docRef"),
      str("type") ?? "routine",
      str("ownerId"),
      str("title"),
      str("dance"),
      str("figureType"),
    );
    // Project off the request path on the next alarm tick.
    await this.ctx.storage.setAlarm(Date.now());
  }

  /**
   * DO alarm: runs compaction + D1 index projection + invite expiry OFF the
   * request/sync path (D24). The runtime invokes this; tests drive it via
   * `runAlarmForTest`.
   */
  async alarm(): Promise<void> {
    // The three steps are INDEPENDENT and best-effort: a failure in one (e.g. a
    // transient D1 error during projection) must not abort the others or surface
    // as an unhandled alarm rejection — that would silently drop compaction and
    // invite expiry (a doc vanishes from search; expired invites stay redeemable),
    // with zero observability. Isolate + log each; never throw out of the alarm.
    try {
      this.compact();
    } catch (err) {
      console.error("doc-do alarm: compaction failed", err);
    }
    try {
      await this.projectToD1();
    } catch (err) {
      console.error("doc-do alarm: D1 index projection failed", err);
    }
    try {
      await this.expireInvites();
    } catch (err) {
      console.error("doc-do alarm: invite expiry failed", err);
    }
  }

  /** Test hook: run the alarm body synchronously (no real timer). */
  async runAlarmForTest(): Promise<void> {
    await this.alarm();
  }

  /**
   * Schedule a compaction alarm once the change log grows past the threshold —
   * so a write-heavy doc that never sets metadata still gets compacted (Staff
   * review #125: edits must trigger compaction, not just `setMetadata`). The
   * alarm is COALESCED: we only arm one if none is already pending, so a burst
   * of edits schedules a single tick, not one per edit.
   */
  private async maybeScheduleCompaction(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM changes")
      .one().n;
    if (rows < COMPACT_THRESHOLD) return;
    const pending = await this.ctx.storage.getAlarm();
    if (pending !== null) return; // an alarm is already scheduled — coalesce.
    await this.ctx.storage.setAlarm(Date.now());
  }

  /**
   * Compact the persisted history: fold the current doc into a single saved-doc
   * snapshot and clear the incremental change log. Bounds the log (and the
   * replay-on-connect cost) without losing state — `getDoc` loads the snapshot
   * then replays only changes recorded after it.
   */
  private compact(): void {
    const doc = this.getDoc();
    const saved = A.save(doc);
    const buf = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength);
    const sql = this.ctx.storage.sql;
    sql.exec(
      "INSERT INTO snapshot (id, data) VALUES (0, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      buf,
    );
    sql.exec("DELETE FROM changes");
  }

  /**
   * Project the thin index row to the D1 document_registry (AC-2) keyed by
   * doName (#50 — one row per document, scoped by the DO's name so forks sharing
   * nested ids never collide). No CRDT content is written — list/search read
   * this, never the doc.
   */
  private async projectToD1(): Promise<void> {
    const meta = this.ctx.storage.sql
      .exec<{
        doName: string | null;
        docRef: string | null;
        type: string | null;
        ownerId: string | null;
        title: string | null;
        dance: string | null;
        figureType: string | null;
      }>(
        "SELECT doName, docRef, type, ownerId, title, dance, figureType FROM doc_meta WHERE id = 0",
      )
      .toArray()[0];
    if (!meta?.doName) return; // nothing to project until metadata is set

    const docRef = meta.docRef ?? meta.doName;
    await this.env.DB.prepare(
      `INSERT INTO document_registry (docRef, type, ownerId, doName, figureType, dance, title, forkedFromRef, updatedAt, deletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
       ON CONFLICT(doName) DO UPDATE SET
         type = excluded.type, ownerId = excluded.ownerId, figureType = excluded.figureType,
         dance = excluded.dance, title = excluded.title, updatedAt = excluded.updatedAt`,
    )
      .bind(
        docRef,
        meta.type ?? "routine",
        meta.ownerId ?? "",
        meta.doName,
        meta.figureType,
        meta.dance,
        meta.title,
        Date.now(),
      )
      .run();
  }

  /**
   * Expire due membership invites (AC-3): mark THIS document's open invites whose
   * `expiresAt` is past as redeemed (no longer redeemable).
   *
   * SCOPED to this doc's invites (#127): a per-document DO must reap only its OWN
   * invite rows — sweeping the whole table would be a layering violation (one
   * doc's alarm mutating another doc's rows) and O(docs) redundant full-table
   * scans. We key by the DO's own document id (its docRef / doName). Correctness
   * never depends on this sweep — `redeemInvite` independently rejects an expired
   * invite — so if this doc has no identity yet (metadata unset), it has no
   * invites to reap; skip.
   */
  private async expireInvites(): Promise<void> {
    const meta = this.ctx.storage.sql
      .exec<{
        docRef: string | null;
        doName: string | null;
      }>("SELECT docRef, doName FROM doc_meta WHERE id = 0")
      .toArray()[0];
    const docRef = meta?.docRef ?? meta?.doName;
    if (!docRef) return; // no identity yet → no invites belong to this doc
    const now = Date.now();
    await this.env.DB.prepare(
      "UPDATE invite SET redeemedAt = ? WHERE docRef = ? AND redeemedAt IS NULL AND expiresAt < ?",
    )
      .bind(now, docRef, now)
      .run();
  }

  /** Test hook: total bytes currently persisted (snapshot + change log) — for
   *  compaction assertions (after the alarm folds changes into a snapshot, the
   *  change log is cleared, so this does not grow unbounded with edit count). */
  async debugPersistedSize(): Promise<number> {
    const sql = this.ctx.storage.sql;
    const changeBytes = sql
      .exec<{ n: number | null }>("SELECT SUM(LENGTH(data)) AS n FROM changes")
      .one().n;
    const snapBytes = sql
      .exec<{ n: number | null }>("SELECT SUM(LENGTH(data)) AS n FROM snapshot")
      .one().n;
    return (changeBytes ?? 0) + (snapBytes ?? 0);
  }
}
