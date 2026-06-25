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
import { addSection, buildRoutineDoc, type RoutineDoc, readRoutine } from "@ballroom/domain";
import type { Env } from "./index";

/** A high-level mutation request the DO knows how to apply to a routine doc. */
export type DocOp = { op: "addSection"; name: string } & Record<string, unknown>;

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
    // Create the append-only change log once. Each row is one Automerge change
    // (incremental bytes), replayed in `seq` order to rebuild the doc.
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)",
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

    const rows = this.ctx.storage.sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM changes ORDER BY seq ASC")
      .toArray();

    if (rows.length === 0) {
      // First touch: seed an empty routine and persist its creation changes so a
      // later cold-load rebuilds the identical doc from SQLite alone.
      const seeded = buildRoutineDoc(emptyRoutine());
      this.persist(A.getAllChanges(seeded));
      this.doc = seeded;
      return seeded;
    }

    let doc = A.init<RoutineDoc>();
    const changes = rows.map((r) => new Uint8Array(r.data) as A.Change);
    [doc] = A.applyChanges(doc, changes);
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
  private ingestChange(change: Uint8Array, from: WebSocket | null): boolean {
    const before = this.getDoc();
    const beforeHeads = A.getHeads(before);
    const [after] = A.applyChanges(before, [change as A.Change]);
    this.doc = after;
    // Heads unchanged ⇒ the change was already present (duplicate) ⇒ no-op.
    if (headsEqual(beforeHeads, A.getHeads(after))) return false;
    this.persist([change as A.Change]);
    this.broadcast([change as A.Change], from);
    return true;
  }

  /** Map a high-level op onto a domain mutation. Unknown ops are a no-op change. */
  private applyOp(doc: A.Doc<RoutineDoc>, op: DocOp): A.Doc<RoutineDoc> {
    switch (op.op) {
      case "addSection":
        return addSection(doc, { name: String(op.name) });
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
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Per-connection Automerge actor id (#107/#70). Client-authored changes
    // already carry the client's own actor; we still tag the SERVER socket with
    // a stable per-connection actor so any DO-side mutation on behalf of this
    // connection is attributed to it, never the DO's own actor (which would
    // break per-user undo). Survives hibernation via the socket attachment.
    server.serializeAttachment({ actor: newActorId() });

    // Accept as a Hibernatable WebSocket (handlers are DO methods, so they
    // survive hibernation — unlike addEventListener closures).
    this.ctx.acceptWebSocket(server);

    // Catch the new client up with the full current state (all changes so far).
    const snapshot = A.getAllChanges(this.getDoc());
    for (const change of snapshot) server.send(change as Uint8Array);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A change arrived from a connected client. Binary frames are raw Automerge
   * change bytes; apply (idempotently) and relay to the OTHER clients so all
   * connections converge.
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message === "string") return; // sync frames are binary; ignore text
    this.ingestChange(new Uint8Array(message), ws);
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
}
