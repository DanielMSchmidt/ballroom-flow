// WEP-0002 (phase 4) — the account `DocConnection` seam.
//
// The per-user ACCOUNT doc (`account:<userId>`) is the CRDT home for the library
// BOOKMARK set (`libraryFigureRefs`) and the user's OWN figureType family notes.
// This store opens it through the SAME `DocConnection` machinery as a routine doc
// (per WEP-0002 "Write-path inversion"), so:
//
//  • SELF reads live from the doc — the Library bookmark set and the user's own
//    family notes come from here, instantly and offline (no /api/figures/mine
//    dependency for WHICH refs; `/mine` still supplies figure metadata, merged in
//    the component). About-others reads (co-member family notes, the Journal's
//    account arm) stay on REST, unchanged.
//  • WRITES ride the §11.2 offline machinery: bookmark add/remove and family-note
//    author/delete apply through the seam onto the account connection, so they
//    persist locally + replay on reconnect and WORK OFFLINE once the doc is
//    hydrated. Components call the store — never Automerge/RPC directly.
//
// The doc is opened LAZILY (D10 — no eager socket per session) when a surface
// that needs it mounts (Library screen / family-note compose / Journal authoring),
// via the `useAccount` hook below.
//
// Mirrors store/routine.ts (the routine `DocConnection`): heads-memoized reads
// via `reconcile` for referential stability, a fresh token per connection-open
// (#189), and the shared IndexedDB persistence for offline (§11.2). It is simpler
// than the routine store — a single doc, and the current user always OWNS their
// own account doc, so there is no membership/role resolution.
import * as A from "@automerge/automerge";
import {
  type AccountDoc,
  type Annotation,
  type AnnotationKind,
  addFamilyNote,
  addLibraryRef,
  CURRENT_SCHEMA_VERSION,
  type DanceId,
  type Role,
  readAccount,
  removeLibraryRef,
  softDeleteAccountAnnotation,
} from "@weavesteps/domain";
import { ensureWasm } from "./automerge-init";
import {
  connectUrl,
  DocConnection,
  type HeartbeatPolicy,
  type ReconnectPolicy,
  type SocketFactory,
  type SyncState,
  type TokenProvider,
} from "./doc-connection";
import { type DocStorage, defaultDocStorage } from "./doc-storage";
import { e2eHeartbeat, e2eZombifiableSocketFactory } from "./e2e-socket";
import { reconcile } from "./reconcile";

/** The synthetic docRef / DO name of a user's account doc (worker: db/family-notes.ts). */
export function accountDocRef(userId: string): string {
  return `account:${userId}`;
}

/**
 * The user's OWN family note as the store reads it from the account doc — the
 * self-read counterpart to `store/family-notes.ts`'s `FamilyNote` (which is the
 * about-others REST shape). Flattens the doc annotation's single `figureType`
 * anchor into the fields the compose/list surfaces use.
 */
export interface OwnFamilyNote {
  id: string;
  kind: AnnotationKind;
  text: string;
  figureType: string;
  danceScope: DanceId | "all";
  count?: number;
  role?: Role;
}

/** The reactive account seam a component consumes: read + mutate, nothing else. */
export interface AccountStore {
  /** The library bookmark set (figureRefs) — the source of truth for WHICH refs
   *  are bookmarked (component merges `/api/figures/mine` for metadata). */
  readLibraryRefs(): string[];
  /** The user's OWN figureType family notes (tombstones dropped). */
  readOwnFamilyNotes(): OwnFamilyNote[];
  /** Bookmark a figure into the library (instant + offline). Idempotent. */
  addBookmark(figureRef: string): void;
  /** Un-bookmark a figure. Idempotent. */
  removeBookmark(figureRef: string): void;
  /** Author a figureType family note (works offline once hydrated). */
  createFamilyNote(input: {
    figureType: string;
    danceScope: DanceId | "all";
    kind: AnnotationKind;
    text: string;
    count?: number;
    role?: Role;
  }): void;
  /** Soft-delete one of the user's family notes (tombstone, never a hard removal). */
  deleteFamilyNote(noteId: string): void;
  /** Subscribe to any advance (local or synced edit); returns an unsubscribe fn. */
  subscribe(fn: () => void): () => void;
  /** The connection's sync lifecycle (for a "syncing…"/"local" indicator). */
  syncState(): SyncState;
  /** §11.2: this client's changes not yet handed to a live socket (drives the
   *  truth-telling "N changes waiting to sync" indicator). */
  pendingSyncCount(): number;
  /** Tear down the connection (socket + listeners + persistence timer). */
  close(): void;
}

/** Injectable wiring so the seam is testable without a live worker (mirrors OpenOptions). */
export interface OpenAccountOptions {
  /** Base URL of the worker (default: same-origin). */
  baseUrl?: string;
  /** WebSocket factory (default: the global WebSocket, e2e-wrapped). */
  openSocket?: SocketFactory;
  /** Per-tab Automerge actor id, so per-user undo/authorship is stable (#70). */
  actor?: string;
  /** The current user's id, stamped as `authorId` on family notes they author. */
  currentUserId?: string;
  /** Resolve a fresh Clerk token at each connection-open (#189). */
  getToken?: TokenProvider;
  /** Auto-reconnect policy (default: the DocConnection capped backoff). */
  reconnect?: ReconnectPolicy;
  /** Zombie-socket heartbeat (WEP-0006; default the DocConnection policy). */
  heartbeat?: HeartbeatPolicy | false;
  /** Schedule/cancel a delayed callback — injected for tests. */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Offline persistence (§11.2): the app-wide IndexedDB store by default; `null`
   *  disables it (and with it the editable-offline "local" state — jsdom, tests). */
  storage?: DocStorage | null;
}

// In an E2E build the factory is wrapped by the zombie seam (WEP-0006 ship gate);
// in every real build `e2eZombifiableSocketFactory` is a pass-through.
const defaultSocketFactory: SocketFactory = e2eZombifiableSocketFactory(
  (url, protocols) => new WebSocket(url, protocols),
);

/** A valid Automerge actor id (even-length hex string), unique per tab (#70). */
function randomActorId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** An empty account doc to seed a fresh connection; the DO replays real state. */
function emptyAccount(userId: string): AccountDoc {
  return {
    id: accountDocRef(userId),
    ownerId: userId,
    annotations: [],
    libraryFigureRefs: [],
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deletedAt: null,
  };
}

/** Flatten a doc annotation's single `figureType` anchor into an OwnFamilyNote.
 *  Returns null for a non-figureType annotation (shouldn't occur in an account
 *  doc, but keeps the read total). */
function toOwnFamilyNote(a: Annotation): OwnFamilyNote | null {
  const anchor = a.anchors[0];
  if (anchor?.type !== "figureType") return null;
  return {
    id: a.id,
    kind: a.kind,
    text: a.text,
    figureType: anchor.figureType,
    danceScope: anchor.danceScope,
    ...(anchor.count != null ? { count: anchor.count } : {}),
    ...(anchor.role != null ? { role: anchor.role } : {}),
  };
}

/**
 * Open the current user's account doc: connect to its DO (`account:<userId>`,
 * owner-only) and return the reactive store. The first connect seeds the doc
 * server-side (worker `ensureAccountDoc` on the connect route), so we just open
 * it and it hydrates.
 */
export async function openAccount(
  userId: string,
  opts: OpenAccountOptions = {},
): Promise<AccountStore> {
  // Initialize the Automerge WASM before the first A.* call (mirrors openRoutine).
  await ensureWasm();
  const baseUrl =
    opts.baseUrl ?? (typeof location !== "undefined" ? location.origin : "http://localhost");
  const openSocket = opts.openSocket ?? defaultSocketFactory;
  // A STABLE per-tab Automerge actor id (#70) so authorship/undo is per-user.
  const actor = opts.actor ?? randomActorId();
  const currentUserId = opts.currentUserId ?? userId;
  const getToken = opts.getToken;
  const reconnect = opts.reconnect;
  const heartbeat = opts.heartbeat ?? e2eHeartbeat();
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h) => clearTimeout(h));
  // §11.2: shared IndexedDB persistence, keyed by the account docRef.
  const storage = opts.storage === undefined ? defaultDocStorage() : opts.storage;
  const docRef = accountDocRef(userId);

  // Start from a TRULY empty doc (A.init) — on connect the DO sends ONE snapshot
  // frame which DocConnection A.loads + A.merges, so the client ends up with the
  // identical doc (a clean superset of the server's state — same rationale as
  // openRoutine).
  const conn = new DocConnection<AccountDoc>(
    A.init<AccountDoc>(actor),
    connectUrl(baseUrl, docRef),
    openSocket,
    { getToken, reconnect, heartbeat, schedule, cancel, storage, storageKey: docRef },
  );

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const fn of listeners) fn();
  };
  conn.onAdvance(notify);

  // Heads-memoized read of the account doc (referential stability, §A). An
  // as-yet-unsynced doc is still the empty A.init, so materialize widened + fall
  // back to the empty sentinel; reconcile keeps unchanged subtrees identity-stable
  // so a note-add doesn't churn the library-refs array (and vice-versa).
  let jsCache: { key: string; value: AccountDoc } | null = null;
  const readAccountSafe = (): AccountDoc => {
    const doc = conn.current();
    const key = A.getHeads(doc).join("/");
    if (jsCache && jsCache.key === key) return jsCache.value;
    const raw: Partial<AccountDoc> = A.toJS(doc);
    let value: AccountDoc;
    if (!Array.isArray(raw.annotations) || !raw.ownerId) {
      value = emptyAccount(userId); // not yet synced — the empty sentinel
    } else {
      // readAccount drops tombstones + defaults libraryFigureRefs; reconcile then
      // keeps identity for the subtrees that didn't change.
      value = reconcile(jsCache?.value, readAccount(doc));
    }
    jsCache = { key, value };
    return value;
  };

  // Derived own-notes memo: reuse the SAME array when the (reconcile-stable)
  // annotations subtree didn't change, so an unrelated re-render doesn't churn.
  let ownNotesCache: { annotations: Annotation[]; value: OwnFamilyNote[] } | null = null;

  const store: AccountStore = {
    readLibraryRefs: () => readAccountSafe().libraryFigureRefs ?? [],

    readOwnFamilyNotes: () => {
      // Derived-list referential stability: memoize against the (reconcile-stable)
      // annotations array so an unrelated re-render hands back the SAME array.
      const annotations = readAccountSafe().annotations;
      if (ownNotesCache && ownNotesCache.annotations === annotations) return ownNotesCache.value;
      const value: OwnFamilyNote[] = [];
      for (const a of annotations) {
        const note = toOwnFamilyNote(a);
        if (note) value.push(note);
      }
      ownNotesCache = { annotations, value };
      return value;
    },

    addBookmark: (figureRef) => {
      // Apply through the seam onto the account connection so it rides §11.2
      // offline machinery. `change` uses A.change on the current doc, so the edit
      // is instant + local even before the socket is live (hydrated).
      conn.commit(addLibraryRef(conn.current(), figureRef));
    },

    removeBookmark: (figureRef) => {
      conn.commit(removeLibraryRef(conn.current(), figureRef));
    },

    createFamilyNote: (input) => {
      conn.commit(addFamilyNote(conn.current(), { authorId: currentUserId, ...input }));
    },

    deleteFamilyNote: (noteId) => {
      conn.commit(softDeleteAccountAnnotation(conn.current(), noteId));
    },

    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    syncState: () => conn.state(),
    pendingSyncCount: () => conn.pendingSyncCount(),

    close: () => {
      listeners.clear();
      conn.close();
    },
  };

  return store;
}
