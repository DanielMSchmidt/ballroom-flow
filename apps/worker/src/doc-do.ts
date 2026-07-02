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
import {
  SYNC_CAUGHT_UP,
  SYNC_FRAME_CHANGE,
  SYNC_FRAME_SNAPSHOT,
  SYNC_RESYNC_CLOSE_CODE,
} from "@ballroom/contract";
import {
  type Anchor,
  type AnnotationKind,
  addAnnotation,
  addReply,
  addSection,
  barsForFigure,
  buildDoc,
  buildRoutineDoc,
  CURRENT_SCHEMA_VERSION,
  can,
  DANCES,
  type DanceId,
  type EffectiveRole,
  type FigureDoc,
  migrateDraft,
  type RoutineDoc,
  readFigure,
  readRoutine,
  softDeleteAnnotation,
} from "@ballroom/domain";
import { authenticateToken } from "./auth";
import { type JournalEntryProjection, projectJournalEntries } from "./db/journal";
import { resolveEffectiveRole } from "./db/membership";
import type { Env } from "./index";

/** Per-connection socket attachment (survives hibernation). */
interface SocketAttachment {
  /** Stable per-connection Automerge actor id (hex). */
  actor: string;
  /** The connection's resolved per-document role (US-021); gates socket writes. */
  role: EffectiveRole;
  /** The authenticated user (Clerk sub) — annotation authorship + role refresh
   *  (§5.1 boundary hardening, 2026-07-02). Absent only on pre-upgrade sockets. */
  sub?: string;
}

/** A high-level mutation request the DO knows how to apply to a routine doc. */
export type DocOp =
  | ({ op: "addSection"; name: string } & Record<string, unknown>)
  | ({ op: "addAnnotation"; text: string } & Record<string, unknown>)
  | ({ op: "addReply"; annotationId: string; text: string } & Record<string, unknown>)
  | ({ op: "deleteAnnotation"; id: string } & Record<string, unknown>);

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
 * Frame a server→client BINARY payload with its 1-byte type tag (D10 wire
 * envelope). `tag` is SYNC_FRAME_SNAPSHOT (whole-doc `A.save` blob) or
 * SYNC_FRAME_CHANGE (one incremental change); the client strips byte 0 and
 * routes on it. Only server→client frames are tagged — client→server changes
 * stay raw (see @ballroom/contract's SYNC_FRAME_* doc for the asymmetry).
 */
function frame(tag: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.byteLength + 1);
  out[0] = tag;
  out.set(payload, 1);
  return out;
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
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deletedAt: null,
  };
}

/**
 * The Automerge actor id every migration change is attributed to (v5 milestone
 * step 1, PLAN §7). Fixed and non-random — NEVER a real per-connection actor
 * (`newActorId()` above) — so per-user undo (`packages/domain/src/undo.ts`
 * `changesByActor`, which filters strictly by exact actor id) can never select
 * it as an undo target: a user's undo after a migrated load reverts their own
 * edit, not the schema upgrade. 32 hex chars (16 bytes), matching the shape
 * Automerge requires for an actor id.
 */
const MIGRATION_ACTOR = `${"0".repeat(31)}1`;

/** The Automerge change message stamped on every migration change (PLAN §7). */
const MIGRATION_MESSAGE = "ballroom:migrate";

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

    const persisted = this.loadPersisted();
    if (persisted) {
      this.doc = persisted;
      return persisted;
    }

    // First touch with nothing persisted: auto-materialize an empty routine and
    // persist its creation changes so a later cold-load rebuilds it from SQLite.
    // NB: only callers that need a doc to MUTATE (applyChange/webSocketMessage)
    // go through here. The connect catch-up deliberately does NOT — see fetch() —
    // so a connect-before-seed never persists this placeholder and blocks seedDoc.
    const seeded = buildRoutineDoc(emptyRoutine());
    this.persist(A.getAllChanges(seeded));
    this.doc = seeded;
    return seeded;
  }

  /**
   * Load the doc from SQLite, or `null` if this DO has never been seeded (no
   * snapshot and no changes). Unlike {@link getDoc} this NEVER auto-materializes
   * a placeholder — so the connect catch-up can read a not-yet-seeded doc without
   * persisting an empty routine that would (a) trip seedDoc's no-clobber and
   * (b) push a bogus empty routine to the client.
   */
  private loadPersisted(): A.Doc<RoutineDoc> | null {
    const sql = this.ctx.storage.sql;
    const snapRows = sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM snapshot WHERE id = 0")
      .toArray();
    const changeRows = sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM changes ORDER BY seq ASC")
      .toArray();
    if (snapRows.length === 0 && changeRows.length === 0) return null;

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
    return this.migrateOnLoad(doc);
  }

  /**
   * v5 milestone step 1 (PLAN §7): "the ladder runs on the DO load path, and
   * fresh docs are stamped `CURRENT_SCHEMA_VERSION`". Every persisted doc
   * passes through `loadPersisted` (directly, or via `getDoc`), so this is the
   * single choke-point that brings an older doc current and PERSISTS the
   * upgrade as a normal change — not a lenient-read shim that re-derives the
   * same fix-up on every load. A doc already at/above CURRENT is returned
   * UNTOUCHED: no clone, no `A.change`, no empty change, no version downgrade
   * (an untagged doc is treated as v1, mirroring `runLadder`).
   *
   * The change is attributed to the fixed {@link MIGRATION_ACTOR} (never a real
   * per-connection actor), so per-user undo can never select it. We then clone
   * BACK to a fresh (random) actor for the doc this instance keeps using — the
   * migration actor must brand only this one change, not every future
   * server-driven mutation (`applyOp`) this DO instance happens to make.
   *
   * Determinism (PLAN §5.3): `migrateDraft` delegates to the pure `migrate`
   * ladder — the same bytes in always produce the same migrated shape out — so
   * two DO instances that independently migrate the same persisted state
   * compute the identical upgrade; the sortKey backfill's convergence guarantee
   * carries over unchanged.
   */
  private migrateOnLoad(doc: A.Doc<RoutineDoc>): A.Doc<RoutineDoc> {
    // `doc.schemaVersion` is untyped-optional at RUNTIME (a pre-envelope doc, or
    // any doc a bug seeded without one) even though `RoutineDoc` declares it
    // required — mirrors `runLadder`'s "an untagged doc is treated as v1".
    const version: unknown = doc.schemaVersion;
    if (typeof version === "number" && version >= CURRENT_SCHEMA_VERSION) return doc;

    const migrating = A.clone(doc, { actor: MIGRATION_ACTOR });
    const migrated = A.change(migrating, { message: MIGRATION_MESSAGE }, (draft) => {
      migrateDraft(draft as unknown as { schemaVersion: number } & Record<string, unknown>);
    });
    const changes = A.getChanges(doc, migrated);
    if (changes.length === 0) return doc; // migrateDraft found nothing to do.
    this.persist(changes);
    const fresh = A.clone(migrated); // fresh actor for this instance's future changes.
    // CRITICAL: the instance itself must ADOPT the migrated doc. loadPersisted is
    // also called by read paths (getFigureSnapshot, the HTTP snapshot fan-out)
    // while `this.doc` may already be set from an earlier seed/edit — leaving it
    // pre-migration would diverge memory from SQLite: a client that then builds a
    // change on snapshot-derived state (whose deps include the migration change)
    // gets silently QUEUED against the stale in-memory doc, and its edit is
    // dropped until the DO evicts. Assigning is monotonically safe: every
    // ingested change is persisted immediately, so `this.doc`'s state is always
    // a prefix of what SQLite replays — the migrated doc is strictly ahead.
    this.doc = fresh;
    return fresh;
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
    // Push the seed to any client already connected (e.g. a collaborator who
    // opened this doc's DO before the create route seeded it): without this, that
    // socket got an empty catch-up and would never see the content until it
    // reconnects (a reload). Mirrors the applyChange broadcast; a no-op when no
    // sockets are connected.
    this.broadcast(A.getAllChanges(seeded), null);
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
    // Arm the journal projection only when the op touched annotations, so an
    // annotation edit projects promptly WITHOUT a structural-edit burst spuriously
    // arming the alarm (and compacting the log out from under the structural tests).
    if (op.op === "addAnnotation" || op.op === "deleteAnnotation") {
      await this.maybeScheduleProjection();
    }
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
    // Detect whether this change touches `annotations` via Automerge's patch
    // stream — O(patches), NOT a full-doc JSON serialization. This keeps the
    // US-015 hot sync path cheap: a structural-only change pays nothing extra and
    // never arms the journal-projection alarm.
    let touchedAnnotations = false;
    const [after] = A.applyChanges(before, [change as A.Change], {
      patchCallback: (patches) => {
        if (touchedAnnotations) return;
        for (const p of patches) {
          if (p.path[0] === "annotations") {
            touchedAnnotations = true;
            return;
          }
        }
      },
    });
    this.doc = after;
    // Heads unchanged ⇒ the change was already present (duplicate) ⇒ no-op.
    if (headsEqual(beforeHeads, A.getHeads(after))) return false;
    this.persist([change as A.Change]);
    await this.maybeScheduleCompaction();
    // Project the journal promptly only when this change touched annotations
    // (the live WS path for lesson/practice authoring). See applyChange's gate.
    if (touchedAnnotations) await this.maybeScheduleProjection();
    this.broadcast([change as A.Change], from);
    return true;
  }

  /** Map a high-level op onto a domain mutation. Unknown ops are a no-op change. */
  private applyOp(doc: A.Doc<RoutineDoc>, op: DocOp): A.Doc<RoutineDoc> {
    switch (op.op) {
      case "addSection":
        return addSection(doc, { name: String(op.name) });
      case "addAnnotation": {
        // Defaults preserve the original behaviour (a `note` on `f1`); callers
        // (tests, the journal-projection path) may pass kind/authorId/anchors to
        // author a lesson/practice anchored to a real figure.
        const kind: AnnotationKind =
          op.kind === "lesson" || op.kind === "practice" ? op.kind : "note";
        return addAnnotation(doc, {
          authorId: typeof op.authorId === "string" ? op.authorId : "tester",
          kind,
          text: String(op.text),
          anchors: Array.isArray(op.anchors)
            ? (op.anchors as Anchor[])
            : [{ type: "figure", figureRef: "f1" }],
        });
      }
      case "addReply":
        return addReply(doc, String(op.annotationId), {
          authorId: typeof op.authorId === "string" ? op.authorId : "tester",
          text: String(op.text),
        });
      case "deleteAnnotation":
        return softDeleteAnnotation(doc, String(op.id));
      default:
        return doc;
    }
  }

  /** Resolve and return the current doc as a plain POJO (tombstones dropped). */
  async getSnapshot(): Promise<RoutineDoc> {
    return readRoutine(this.getDoc());
  }

  /**
   * Read this doc as a FIGURE snapshot (tombstoned attributes dropped) for the
   * read-only HTTP snapshot path (the read/edit split): a single REST read hydrates
   * a routine + its figures with NO per-figure WebSocket. Figure-shaped read —
   * `getSnapshot` assumes a routine (it materializes `sections`).
   *
   * Uses `loadPersisted` (not `getDoc`) so a read NEVER auto-materializes +
   * persists an empty placeholder: a not-yet-seeded figure returns null and the
   * caller renders it as missing.
   */
  async getFigureSnapshot(): Promise<FigureDoc | null> {
    const doc = this.loadPersisted();
    if (!doc) return null;
    return readFigure(doc as unknown as A.Doc<FigureDoc>);
  }

  // ── US-015: live WebSocket sync (custom Automerge change-sync, D13) ─────────

  /**
   * WebSocket entrypoint. Upgrades the request to a Hibernatable WebSocket the
   * runtime owns (so the DO can hibernate while idle and wake on a message
   * WITHOUT dropping state — state lives in SQLite). On connect we send the new
   * client ONE snapshot frame (the whole doc as an `A.save` blob — D10, bounded
   * on the wire), then it exchanges incremental changes via `webSocketMessage`.
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
    const attachment: SocketAttachment = { actor: newActorId(), role, sub: user.sub };
    server.serializeAttachment(attachment);

    // Accept as a Hibernatable WebSocket (handlers are DO methods, so they
    // survive hibernation — unlike addEventListener closures).
    this.ctx.acceptWebSocket(server);

    // Catch the new client up with ONE snapshot frame — the whole doc as an
    // `A.save` blob (D10 sync hardening, 2026-07-02) — then signal catch-up-
    // complete (#202) so the client knows the doc is HYDRATED (not merely
    // socket-open) and may safely begin editing. This replaces the old per-change
    // history replay (`getAllChanges` → one frame per change), which grew
    // UNBOUNDED on the wire as a doc aged — compaction bounds the SQLite log, not
    // the replay. The client `A.load`s the blob and `A.merge`s it into its local
    // doc, so a RECONNECTING client with unacked local edits keeps them (and then
    // resends the changes the server is missing — client side, #161). The marker
    // is a TEXT frame, distinct from the tagged binary snapshot/change frames.
    //
    // IMPORTANT: read via loadPersisted(), NOT getDoc() — a connect to a
    // not-yet-seeded doc must NOT auto-materialize + persist an empty-routine
    // placeholder. Doing so used to no-clobber a subsequent seedDoc, so a
    // collaborator who connected before the create's seed left the doc empty
    // forever. Here an unseeded doc sends NO snapshot (just SYNC_CAUGHT_UP); when
    // seedDoc runs it broadcasts the seed to this already-connected socket.
    const current = this.doc ?? this.loadPersisted();
    if (current) {
      this.doc = current;
      server.send(frame(SYNC_FRAME_SNAPSHOT, A.save(current)));
    }
    server.send(SYNC_CAUGHT_UP);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A change arrived from a connected client. Client→server binary frames are
   * RAW Automerge change bytes — NOT tagged (only server→client frames carry the
   * D10 1-byte envelope; see @ballroom/contract SYNC_FRAME_* for the asymmetry).
   * We apply (idempotently) and relay to the OTHER clients so all connections
   * converge. A reconnecting client's resend of its unacked changes (#161) also
   * arrives here as raw frames; the idempotence guard makes re-delivery a no-op.
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
    const att = this.socketAttachment(ws);
    const role = att?.role ?? null;
    if (!role) return; // no/garbled attachment → read-only
    const bytes = new Uint8Array(message);
    const allowed =
      can(role, "canEdit") ||
      (can(role, "canAnnotate") && this.commenterChangeAllowed(bytes, att?.sub));
    if (!allowed) return;
    try {
      await this.ingestChange(bytes, ws);
    } catch {
      // Malformed/unapplyable frame — drop it; other clients + the doc are
      // unaffected. (Automerge `applyChanges` throws on garbage bytes.)
    }
  }

  /**
   * Classify a commenter's change by EFFECT (US-039/#117 + §5.1 boundary
   * hardening, 2026-07-02): the change must (1) touch ONLY `annotations` — no
   * structural edit smuggled through a mislabelled frame — and (2) respect
   * AUTHORSHIP against the socket's verified identity (`sub`), never the
   * client-controlled `authorId` alone:
   *   • a created annotation (and any reply) must be authored by `sub`;
   *   • another author's annotation may only GAIN replies authored by `sub` —
   *     its own fields (text, tombstone, anchors…) are untouchable;
   *   • a reply may be edited/tombstoned only by its own author (§4.0
   *     "reply delete = author-only"); hard removals never pass (soft-delete only).
   * An unapplyable (malformed) frame is not an annotation. Comparisons include
   * tombstones so a structural soft-delete still counts as structural.
   */
  private commenterChangeAllowed(change: Uint8Array, sub: string | undefined): boolean {
    if (!sub) return false; // pre-upgrade attachment (no identity) → fail closed
    const before = this.getDoc();
    let after: A.Doc<RoutineDoc>;
    try {
      // Clone first: A.applyChanges may free its input handle; the live doc must
      // stay valid for the subsequent real ingest.
      [after] = A.applyChanges(A.clone(before), [change as A.Change]);
    } catch {
      return false;
    }
    const b = readRoutine(before, { includeDeleted: true });
    const a = readRoutine(after, { includeDeleted: true });
    // (1) Structure untouched.
    if (JSON.stringify({ ...b, annotations: [] }) !== JSON.stringify({ ...a, annotations: [] })) {
      return false;
    }
    // (2) Annotation authorship.
    const prevById = new Map(b.annotations.map((x) => [x.id, x]));
    for (const ann of a.annotations) {
      const prev = prevById.get(ann.id);
      prevById.delete(ann.id);
      if (!prev) {
        // Created: the annotation and everything in it must be sub's.
        if (ann.authorId !== sub) return false;
        if (ann.replies.some((r) => r.authorId !== sub)) return false;
        continue;
      }
      if (JSON.stringify(prev) === JSON.stringify(ann)) continue; // untouched
      // Non-reply fields may change only on the commenter's OWN annotation.
      const sansReplies = (x: typeof ann): string => JSON.stringify({ ...x, replies: [] });
      if (sansReplies(prev) !== sansReplies(ann) && prev.authorId !== sub) return false;
      // Reply diff: created replies must be sub's; edits/tombstones only on own.
      const prevReplies = new Map(prev.replies.map((r) => [r.id, r]));
      for (const r of ann.replies) {
        const pr = prevReplies.get(r.id);
        prevReplies.delete(r.id);
        if (!pr) {
          if (r.authorId !== sub) return false;
        } else if (JSON.stringify(pr) !== JSON.stringify(r) && pr.authorId !== sub) {
          return false;
        }
      }
      if (prevReplies.size > 0) return false; // hard-removed a reply
    }
    if (prevById.size > 0) return false; // hard-removed an annotation
    return true;
  }

  /**
   * Re-resolve every connected socket's role from D1 (§5.1 boundary hardening,
   * 2026-07-02 — S1): a membership removal or downgrade must reach OPEN sockets,
   * not just future connects. The member routes call this after any membership
   * write. A user who no longer resolves is CLOSED (1008 — the client's access
   * preflight then reports denied, not offline); a changed role is re-attached
   * so the very next webSocketMessage enforces it. A socket with no verified
   * identity (pre-upgrade attachment) is closed too — fail closed; the client
   * reconnects with a fresh token.
   */
  async refreshConnectedRoles(): Promise<void> {
    const doName = this.ctx.storage.sql
      .exec<{ doName: string | null }>("SELECT doName FROM doc_meta WHERE id = 0")
      .toArray()[0]?.doName;
    if (!doName) return; // never connected → nothing attached
    for (const ws of this.ctx.getWebSockets()) {
      let att: SocketAttachment | null = null;
      try {
        att = ws.deserializeAttachment() as SocketAttachment | null;
      } catch {
        // fall through to fail-closed close below
      }
      if (!att?.sub) {
        try {
          ws.close(1008, "access revoked");
        } catch {
          // already closing/closed
        }
        continue;
      }
      const role = await resolveEffectiveRole(this.env.DB, doName, att.sub);
      if (!role) {
        try {
          ws.close(1008, "access revoked");
        } catch {
          // already closing/closed
        }
        continue;
      }
      if (role !== att.role) ws.serializeAttachment({ ...att, role });
    }
  }

  /** The connection's attachment (role + verified identity), or null. */
  private socketAttachment(ws: WebSocket): SocketAttachment | null {
    try {
      return (ws.deserializeAttachment() as SocketAttachment | null) ?? null;
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
    // No `type` guess here (2026-07-02 review): this runs for FIGURE docs too,
    // and a hardcoded 'routine' used to poison the projection. Identity fields
    // are derived from the doc itself at projection time (projectToD1).
    this.ctx.storage.sql.exec(
      `INSERT INTO doc_meta (id, doName) VALUES (0, ?)
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
   * even after the DO has hibernated and woken. Each change goes out as a tagged
   * SYNC_FRAME_CHANGE frame (D10 wire envelope) so the client can tell it from
   * the on-connect snapshot frame.
   *
   * BROADCAST-RESYNC (D10, 2026-07-02): a per-socket `send` failure is NOT
   * swallowed — a swallowed failure leaves that client silently DIVERGED (it
   * never sees this change until it happens to reconnect). Instead we CLOSE that
   * socket with SYNC_RESYNC_CLOSE_CODE; the client treats a close after it had
   * opened as a transient warm drop and auto-reconnects, pulling a fresh snapshot
   * catch-up that includes the change it missed. We collect the failed sockets
   * and close them AFTER the send loop so closing one never perturbs delivery to
   * the others.
   */
  private broadcast(changes: A.Change[], from: WebSocket | null): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const failed = new Set<WebSocket>();
    for (const change of changes) {
      const bytes = frame(SYNC_FRAME_CHANGE, change as Uint8Array);
      for (const ws of sockets) {
        if (ws === from || failed.has(ws)) continue;
        try {
          ws.send(bytes);
        } catch {
          // This socket couldn't receive the change → it's now behind. Mark it
          // for a resync-close so it reconnects and re-catches-up (below).
          failed.add(ws);
        }
      }
    }
    for (const ws of failed) {
      try {
        ws.close(SYNC_RESYNC_CLOSE_CODE, "resync");
      } catch {
        // already closing/closed — the client will reconnect regardless.
      }
    }
  }

  /**
   * Test-only: the exact BINARY catch-up frames a connect would send this client,
   * in order (see `fetch`). Post-D10 this is EXACTLY ONE tagged SYNC_FRAME_SNAPSHOT
   * frame for a seeded doc (never a per-change replay), or none for an unseeded
   * doc — so a test can assert the frame COUNT and that `A.load` of the snapshot
   * payload equals the doc, deterministically, WITHOUT driving a full WS delivery
   * cycle (which vitest-pool-workers can't — SPIKE-FINDINGS sharp-edge #3).
   */
  async catchUpFramesForTest(): Promise<Uint8Array[]> {
    const current = this.doc ?? this.loadPersisted();
    if (!current) return [];
    return [frame(SYNC_FRAME_SNAPSHOT, A.save(current))];
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
      await this.projectJournalToD1();
    } catch (err) {
      console.error("doc-do alarm: journal projection failed", err);
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
   * Arm a near-term alarm on ANY advancing change so a single lesson/practice
   * annotation is projected to the `journal_entry` index promptly — not only once
   * the change log passes COMPACT_THRESHOLD (64) or `setMetadata` runs (T6 §3).
   * COALESCED: a burst of edits schedules one tick, not one per edit. The alarm
   * body re-projects both the registry and the journal, so this is the timely
   * trigger for the cross-routine Journal read (eventually consistent).
   */
  private async maybeScheduleProjection(): Promise<void> {
    const pending = await this.ctx.storage.getAlarm();
    if (pending !== null) return; // coalesce a burst into one tick
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
    if (!meta?.doName) return; // nothing to project until a connect/seed names us

    // Identity comes from the DOC FIRST (2026-07-02 review, C2): production
    // never calls setMetadata, so a meta-only projection used to upsert
    // ownerId="" / type='routine' / title=NULL over the eager-created registry
    // row — the owner lost delete rights, the routine dropped out of quota, and
    // figure docs were re-typed as routines. Every seeded doc carries its own
    // id/ownerId/title|name/dance (+ figureType for figures), and reading the
    // doc also means a CRDT title rename actually projects. doc_meta remains an
    // explicit override (tests, special cases).
    const d = this.getDoc() as unknown as {
      id?: unknown;
      scope?: unknown;
      ownerId?: unknown;
      title?: unknown;
      name?: unknown;
      dance?: unknown;
      figureType?: unknown;
    };
    const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
    const docRef = meta.docRef ?? str(d.id) ?? meta.doName;
    const docFigureType = meta.figureType ?? str(d.figureType);
    // `type` is CONFIDENT when meta declares it, or the doc's shape shows it
    // (figures carry figureType; routines carry a title). An empty/never-seeded
    // doc yields a guess that must never overwrite an existing row's type.
    const typeKnown = meta.type != null || docFigureType != null || str(d.title) != null;
    const type =
      meta.type ??
      (docFigureType ? (d.scope === "global" ? "global-figure" : "account-figure") : "routine");
    const ownerId = meta.ownerId ?? str(d.ownerId);
    const title = meta.title ?? str(d.title) ?? str(d.name);
    const dance = meta.dance ?? str(d.dance);
    // US-025 card counts (bars/figureCount). forkedFromRef is left untouched here:
    // it's set by the eager create (createOwnedRoutine) and the alarm must never
    // clobber it — hence NULL on insert and absent from the ON CONFLICT update.
    const { bars, figureCount } = await this.computeCardCounts(type, dance);
    // The upsert is NON-DESTRUCTIVE: identity fields only overwrite when this
    // projection actually knows them — an unknown value keeps the eager-created
    // row's value instead of blanking it.
    await this.env.DB.prepare(
      `INSERT INTO document_registry (docRef, type, ownerId, doName, figureType, dance, title, forkedFromRef, bars, figureCount, updatedAt, deletedAt)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, NULL)
       ON CONFLICT(doName) DO UPDATE SET
         type = CASE WHEN ?11 THEN excluded.type ELSE document_registry.type END,
         ownerId = CASE WHEN excluded.ownerId != '' THEN excluded.ownerId ELSE document_registry.ownerId END,
         figureType = COALESCE(excluded.figureType, document_registry.figureType),
         dance = COALESCE(excluded.dance, document_registry.dance),
         title = COALESCE(excluded.title, document_registry.title),
         bars = excluded.bars, figureCount = excluded.figureCount, updatedAt = excluded.updatedAt`,
    )
      .bind(
        docRef,
        type,
        ownerId ?? "",
        meta.doName,
        docFigureType,
        dance,
        title,
        bars,
        figureCount,
        Date.now(),
        typeKnown ? 1 : 0,
      )
      .run();
  }

  /**
   * Compute the US-025 card-projection counts for THIS document (PLAN §2.5/§2.7):
   *  • routine → figureCount = its NON-deleted placement count; bars = Σ over those
   *    placements of each referenced figure's projected per-figure `bars`.
   *  • figure  → bars = this figure's authored `bars` field when set, else the
   *    phrase span of its non-deleted attribute counts (`barsForFigure`, the MAX
   *    count across BOTH roles → the longer role's span); figureCount = null.
   *  • account → { null, null }.
   *
   * Per-document DO layering (memory: per-document-do-layering): a routine reads the
   * SHARED `document_registry` index to sum its figures' precomputed bars (mirroring
   * `resolveFigureNames`) — it NEVER loads another doc or drives a figure DO. A
   * figure computes its bars from its OWN attributes. Eventually consistent: a
   * routine's `bars` may lag a figure edit until the routine re-projects, and a
   * not-yet-projected figure contributes 0 until its own alarm runs (#126).
   */
  private async computeCardCounts(
    type: string,
    dance: string | null,
  ): Promise<{ bars: number | null; figureCount: number | null }> {
    const doc = this.loadPersisted();
    if (!doc) return { bars: null, figureCount: null };

    if (type === "routine") {
      const routine = readRoutine(doc); // tombstones dropped → live placements only
      const beatsPerBar = DANCES[(routine.dance ?? "waltz") as DanceId].beatsPerBar;
      const placementRefs: string[] = [];
      let breakBars = 0; // a break contributes bars but isn't a figure (US-004a)
      let figureCount = 0;
      for (const section of routine.sections) {
        for (const placement of section.placements) {
          if (placement.source === "break") {
            breakBars += Math.max(1, Math.round((placement.beats ?? beatsPerBar) / beatsPerBar));
          } else if (placement.figureRef) {
            placementRefs.push(placement.figureRef);
            figureCount += 1;
          }
        }
      }
      const barsByRef = await this.resolveFigureBars([...new Set(placementRefs)]);
      // Sum PER PLACEMENT (a figure placed twice counts its bars twice), then add
      // break beats — the section/routine bar-count includes break bars (US-004a).
      const bars =
        placementRefs.reduce((sum, ref) => sum + (barsByRef.get(ref) ?? 0), 0) + breakBars;
      return { bars, figureCount };
    }

    if (type === "global-figure" || type === "account-figure") {
      // Defensive: a figure-typed DO whose content was never seeded as a FigureDoc
      // (e.g. an auto-materialized empty-routine placeholder from a stray getDoc)
      // has no `attributes` — treat it as an empty (1-bar) figure rather than
      // letting readFigure throw and abort the whole projection.
      const figure = A.toJS(doc) as Partial<FigureDoc>;
      const figureDance = (figure.dance ?? dance ?? "waltz") as DanceId;
      const counts = (figure.attributes ?? [])
        .filter((a) => a.deletedAt == null)
        .map((a) => a.count);
      // The figure's card bar count (PLAN §2.5): the explicit authored `bars` when
      // set, else the phrase span its steps occupy (`barsForFigure`) — a legacy
      // figure with no authored length still gets an honest span-based estimate.
      const bars =
        typeof figure.bars === "number" && figure.bars >= 1
          ? Math.floor(figure.bars)
          : barsForFigure(counts, figureDance);
      return { bars, figureCount: null };
    }

    return { bars: null, figureCount: null }; // account / unknown — no card counts
  }

  /**
   * Read referenced figures' projected per-figure `bars` from the SHARED registry
   * index (mirrors {@link resolveFigureNames}): reads the index, never another DO's
   * doc. A figure with no projected `bars` yet is simply absent from the map.
   */
  private async resolveFigureBars(refs: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (refs.length === 0) return out;
    const ph = refs.map(() => "?").join(",");
    const res = await this.env.DB.prepare(
      `SELECT docRef, bars FROM document_registry WHERE docRef IN (${ph})`,
    )
      .bind(...refs)
      .all<{ docRef: string; bars: number | null }>();
    for (const r of res.results ?? []) if (r.bars != null) out.set(r.docRef, r.bars);
    return out;
  }

  /**
   * T6 — project THIS routine's lesson/practice annotations to the cross-routine
   * `journal_entry` index (PLAN §2.6/§2.7/§6). Mirrors `projectToD1`: D1 stays a
   * pure index; the routine doc (DO SQLite) is the source of truth.
   *
   * Scope (memory: per-document DO layering): touches only THIS routine's own
   * `journal_entry` rows. Figure/account DOs short-circuit (`type !== 'routine'`).
   * It DOES read the shared `document_registry` index to resolve a placement's
   * figure NAME for the chip label — reading the index, never another DO's doc.
   *
   * Reads annotations with tombstones INCLUDED so a soft-deleted annotation flips
   * its row's `deletedAt` (idempotent: the next projection won't resurrect it).
   */
  private async projectJournalToD1(): Promise<void> {
    const meta = this.ctx.storage.sql
      .exec<{ doName: string | null; docRef: string | null; type: string | null }>(
        "SELECT doName, docRef, type FROM doc_meta WHERE id = 0",
      )
      .toArray()[0];
    // Only routine docs own routine-scoped journal entries.
    if (!meta?.doName || (meta.type ?? "routine") !== "routine") return;
    const docRef = meta.docRef ?? meta.doName;

    const doc = this.loadPersisted();
    if (!doc) return;
    const routine = readRoutine(doc, { includeDeleted: true });
    const journalAnnotations = routine.annotations.filter(
      (a) => a.kind === "lesson" || a.kind === "practice",
    );
    if (journalAnnotations.length === 0) return;

    // Resolve figure names for point/figure anchors from the registry (one query).
    const figureRefs = new Set<string>();
    for (const a of journalAnnotations) {
      for (const an of a.anchors) {
        if (an.type === "point" || an.type === "figure") figureRefs.add(an.figureRef);
      }
    }
    const names = await this.resolveFigureNames([...figureRefs]);

    const rows: JournalEntryProjection[] = journalAnnotations.map((a) => ({
      entryId: a.id,
      authorId: a.authorId,
      kind: a.kind,
      text: a.text,
      anchors: JSON.stringify(a.anchors.map((an) => this.labelAnchor(an, names))),
      createdAt: a.createdAt,
      deletedAt: a.deletedAt ?? null,
    }));
    await projectJournalEntries(this.env.DB, docRef, rows);
  }

  /** Look up figure display names (document_registry.title) for the given refs. */
  private async resolveFigureNames(refs: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (refs.length === 0) return out;
    const ph = refs.map(() => "?").join(",");
    const res = await this.env.DB.prepare(
      `SELECT docRef, title FROM document_registry WHERE docRef IN (${ph})`,
    )
      .bind(...refs)
      .all<{ docRef: string; title: string | null }>();
    for (const r of res.results ?? []) if (r.title) out.set(r.docRef, r.title);
    return out;
  }

  /** Attach a resolved chip `label` to an anchor (T6 §3 — no client refetch). */
  private labelAnchor(anchor: Anchor, names: Map<string, string>): Record<string, unknown> {
    if (anchor.type === "point") {
      const name = names.get(anchor.figureRef) ?? "this figure";
      return { ...anchor, label: `${name} · step ${anchor.count + 1}` };
    }
    if (anchor.type === "figure") {
      return { ...anchor, label: names.get(anchor.figureRef) ?? "this figure" };
    }
    // figureType: humanize without a registry lookup (data is self-contained).
    const titleCase = (s: string): string =>
      s
        .replace(/[_-]+/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    const family = titleCase(anchor.figureType);
    const scope =
      anchor.danceScope === "all" ? "all dances" : `all ${titleCase(anchor.danceScope)}`;
    return { ...anchor, label: `all ${family}s · ${scope}` };
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
