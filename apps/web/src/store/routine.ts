// US-017 — the `store/` seam (PLAN §6.1/§6.2, D6).
//
// The ONLY thing components touch to read/edit a routine. It wraps Automerge +
// the WS sync (DocConnection) behind a typed, reactive interface: open a
// routine, fan out to its referenced figure docs (each carries its own
// attributes), expose reactive reads + mutations + per-actor undo (US-010).
// Components never import @automerge/automerge or the RPC client directly — an
// architecture-boundary test enforces that (see routine-store.test.ts).
import * as A from "@automerge/automerge";
import {
  type Alignment,
  type Anchor,
  type Annotation,
  type AnnotationKind,
  type Attribute,
  addAnnotation,
  addReply,
  addSection,
  CURRENT_SCHEMA_VERSION,
  DANCES,
  defaultFigureCounts,
  ensureSortKeys,
  type FigureDoc,
  globalFigureRef,
  isReservedKind,
  keyBetween,
  keyForMove,
  kindAppliesToDance,
  LIBRARY_FIGURES,
  libraryFigureByRef,
  newId,
  type Placement,
  type RegistryKind,
  type RoutineDoc,
  readRoutine,
  redoLastChange,
  resolveFigure as resolveVariantOverlay,
  softDeleteAnnotation,
  softDeleteReply,
  softDeleteSection,
  sortByOrder,
  spawnVariant,
  undoLastChange,
  variantAttributesForEdit,
  wasSupersededByOthers,
} from "@weavesteps/domain";
import { ApiError, apiGet, apiPost } from "../lib/rpc";
import {
  connectUrl,
  DocConnection,
  type ReconnectPolicy,
  type SocketFactory,
  type SyncState,
  type TokenProvider,
} from "./doc-connection";
import { type DocStorage, defaultDocStorage } from "./doc-storage";
import { reconcile } from "./reconcile";

/**
 * Load status of a placement's figure (each figure is its own Automerge doc on
 * its own connection, loaded lazily). Distinguishing these is what stops a
 * just-added or still-hydrating figure from reading as the alarming "Unknown
 * figure" — the UI shows a skeleton for the transient states and an honest
 * unavailable/retry affordance only for the genuine failures.
 *
 * - `pending` — just added; its server-side create (POST /api/figures) is in flight.
 * - `loading` — exists; its per-doc connection is hydrating (or reconnecting).
 * - `live`    — hydrated; `figure` carries its resolved content.
 * - `missing` — genuinely unavailable: deleted, or the viewer lacks access
 *               (confirmed via the `/api/docs/:id/access` registry preflight).
 * - `error`   — the connection couldn't hydrate (timed out / gave up) but the
 *               figure IS accessible — a transient failure the user can retry.
 */
export type FigureLoadStatus = "pending" | "loading" | "live" | "missing" | "error";

/**
 * Outcome of an `undo()` through the seam (US-038). Undo ALWAYS proceeds (the
 * inverse is a normal change that merges — no hard refusal); this just reports
 * what happened so the UI can soften the toast.
 */
export interface UndoResult {
  /** Whether a change was actually reverted (false = the actor had nothing to undo). */
  undone: boolean;
  /**
   * Advisory soft hint (US-038 AC-3): another actor had BUILT ON (causally
   * depended on) the reverted change. Always false when `undone` is false.
   */
  supersededByOthers: boolean;
}

/** A placement with its figure resolved to effective attributes (its own attributes). */
export interface ResolvedPlacement {
  placement: Placement;
  /** The resolved figure when `status === "live"`, else null. */
  figure: FigureDoc | null;
  /** Where this placement's figure is in its load lifecycle (see FigureLoadStatus). */
  status: FigureLoadStatus;
  /**
   * True when `figure` is served by the figure's OWN hydrated live connection
   * (the authoritative, live-syncing doc), false when it's the read-only REST
   * snapshot fallback (lazy mode, own connection not hydrated yet). The figure
   * editor gates on this so it waits for the live doc ("load on open") instead of
   * rendering — then swapping out — stale snapshot content, which is what caused
   * the visible flicker / reset of in-flight edits. `undefined` from stores that
   * don't distinguish (an injected test store) is treated as ready.
   */
  fromLiveDoc?: boolean;
}

/**
 * The READ-ONLY surface of a routine — the subset a component needs to *render*
 * (never edit). Both the live WebSocket store and the lightweight HTTP snapshot
 * model satisfy it, so a read-only screen can consume either (the read/edit
 * split: open the cheap snapshot to read, upgrade to the live store to edit). A
 * full `RoutineStore` is structurally a `RoutineReadModel`.
 */
export interface RoutineReadModel {
  /** Placements across all sections, each with its resolved figure. */
  readPlacements(): ResolvedPlacement[];
  /** The materialized routine doc (tombstones dropped). */
  readRoutine(): RoutineDoc;
  /** Routine-scoped annotations (US-039), tombstones dropped. */
  readAnnotations(): Annotation[];
  /** All visible custom attribute kinds (US-043). */
  customKinds(): RegistryKind[];
  /** Subscribe to any change (refreshed snapshot, or synced/local edit). */
  subscribe(fn: () => void): () => void;
  /** Lifecycle, for a "syncing…"/"loading…" indicator (US-018). */
  syncState(): SyncState;
  /**
   * Offline editing (PLAN §11.2): how many of this client's changes (routine +
   * figure docs) have not been handed to a live socket yet — drives the
   * truth-telling "N changes waiting to sync" indicator and the unsyncable-edits
   * notice. Optional: absent on models with no local persistence (the read-only
   * snapshot, injected test stores) — read as 0.
   */
  pendingSyncCount?(): number;
  /** Tear down (poll timer + listeners, or document connections). */
  close(): void;
}

/** The reactive seam a component consumes. Read, mutate, undo — nothing else. */
export interface RoutineStore extends RoutineReadModel {
  /** Placements across all sections, each with its resolved figure. */
  readPlacements(): ResolvedPlacement[];
  /** The materialized routine doc (tombstones dropped). */
  readRoutine(): RoutineDoc;
  /**
   * Open a figure's OWN live connection on demand (read/edit split): in lazy
   * figure mode the timeline renders figures from the routine snapshot with no
   * per-figure WebSocket — opening a figure's step editor calls this so THAT
   * figure converges live (its notation/edits sync) while it's open. A no-op when
   * the figure is already connected (or in eager mode, where all figures connect).
   */
  openFigure(figureRef: string): void;
  /** Add a new user-named section to the end of the routine (US-026). */
  addSection(name: string): void;
  /** Rename a section (US-026). */
  renameSection(sectionId: string, name: string): void;
  /** Move a section one step up/down in order (US-026; reorder convergence #63). */
  moveSection(sectionId: string, direction: "up" | "down"): void;
  /** Soft-delete a section — sets its tombstone, never a hard removal (US-026). */
  deleteSection(sectionId: string): void;
  /**
   * Add a figure to a section (US-027): mints a fresh OWNED custom figure doc
   * (the user then edits its timeline, US-028) and appends a placement
   * referencing it. A library pick (US-032) passes the catalog's canonical
   * `figureType`; a custom figure omits it and the store slugs one from the name.
   * `bars` is the figure's authored length chosen in the create flow (PLAN §2.5);
   * omitted → the store derives ⌈whole-beat steps ÷ beatsPerBar⌉ from the seeded
   * attributes (a catalog figure's charted steps, or 1 for a fresh custom).
   * `beforePlacementId` inserts the new figure immediately BEFORE that placement
   * (US-027 insert-between); omitted/null appends to the end of the section.
   */
  addPlacement(
    sectionId: string,
    figureName: string,
    figureType?: string,
    bars?: number,
    beforePlacementId?: string | null,
  ): void;
  /** Move a placement up/down WITHIN its section (US-027; reorder convergence #63). */
  movePlacement(sectionId: string, placementId: string, direction: "up" | "down"): void;
  /** Soft-delete a placement — tombstone, never a hard removal (US-027). */
  deletePlacement(sectionId: string, placementId: string): void;
  /**
   * Append a BREAK/WAIT entry to a section (US-004a): a placement that occupies
   * beats but has no figure. Defaults to one bar of the routine's dance (3 Waltz /
   * 4 others). It advances the reading view's continuous beat counter.
   * `beforePlacementId` inserts the break immediately BEFORE that placement
   * (US-027 insert-between); omitted/null appends to the end of the section.
   */
  addBreak(sectionId: string, beforePlacementId?: string | null): void;
  /** Set a break's whole-beat duration (US-004a); clamped to a minimum of 1. */
  setBreakBeats(sectionId: string, placementId: string, beats: number): void;
  /**
   * Replace a figure doc's attribute timeline (US-028). The timeline editor emits
   * the figure's full next attribute set; this writes it to that figure's doc
   * (opening its connection if needed). NOTE: editing a non-owned figure should
   * fork via copy-on-write (US-008) — wired in the variant-editor story (#42); for
   * now this writes straight to the referenced figure doc.
   */
  setFigureAttributes(figureRef: string, attributes: Attribute[]): void;
  /**
   * Set a figure's authored length in COUNTS (beats — Builder v3 ①). Drives the
   * editor grid (every count → e/&/a slot); bar displays derive ⌈counts ÷
   * beatsPerBar⌉. Like {@link setFigureAttributes}, editing a global (app-owned
   * library) figure forks an owned variant first (US-035); an owned/account
   * figure changes in place. Clamped to 1–64.
   */
  setFigureCounts(figureRef: string, counts: number): void;
  /** Set (or clear, with null) a figure's entry/exit alignment (US-031). */
  setFigureAlignment(figureRef: string, edge: "entry" | "exit", alignment: Alignment | null): void;
  /** Routine-scoped annotations (US-039), tombstones dropped. */
  readAnnotations(): Annotation[];
  /**
   * Create a note/lesson/practice anchored to a point or figure (US-039),
   * stamped with the open user's id. Synced to all members via the routine doc.
   */
  createAnnotation(input: {
    kind: AnnotationKind;
    text: string;
    anchors: Anchor[];
    tags?: string[];
  }): void;
  /** Append a reply to an annotation's thread (US-039). */
  addReply(annotationId: string, text: string): void;
  /** Soft-delete an annotation (US-039). */
  deleteAnnotation(annotationId: string): void;
  /** Soft-delete a reply — author-only is enforced in the UI (US-039). */
  deleteReply(annotationId: string, replyId: string): void;
  /**
   * Create a user-defined attribute kind (US-043). Embeds it into the routine
   * doc (CRDT — co-editors/forks get it), adds it to the in-memory account set,
   * and persists it account-wide via REST (best-effort, fire-and-forget). Ignored
   * for reserved/builtin slugs (`isReservedKind`).
   */
  createCustomKind(kind: RegistryKind): void;
  /**
   * All visible custom attribute kinds: account set ∪ routine-embedded, de-duped
   * by `kind` slug (routine-embedded wins on conflict), builtins excluded (US-043).
   */
  customKinds(): RegistryKind[];
  /**
   * Force a figure's connection to reconnect after it surfaced as `error`/`missing`
   * — the user-facing "retry" affordance, so a figure that failed to load recovers
   * without a full page reload.
   */
  retryFigure(figureRef: string): void;
  /**
   * Per-actor history undo (US-010/US-038). Always proceeds (CRDT merges);
   * returns whether a change was reverted and the advisory "superseded by
   * others" soft hint (US-038 AC-3) so the caller can pick the toast copy.
   */
  undo(): UndoResult;
  /** Per-actor history redo (US-010). */
  redo(): void;
  /**
   * Figure-scoped undo/redo — "undo follows the surface being edited" (§5.4).
   * In the Assemble view `undo()` targets the ROUTINE doc; inside the figure
   * editor these target THAT FIGURE's own doc, so a mis-tap in the step grid is
   * recoverable — the figure editor's auto-save contract ("no Save button — an
   * undo exists") is only honest if figure edits are actually undoable there.
   *
   * Mirrors the routine path exactly: `undoLastChange`/`redoLastChange` against
   * this client's per-tab actor on the figure's `DocConnection`, committed so the
   * inverse SYNCS. A graceful no-op (`{ undone: false }`) when the figure has no
   * own connection — a catalog live-reference (⟳v5 §4.3: the user owns no changes
   * on it; a first edit spawns a variant) or a figure not yet opened/hydrated.
   */
  undoFigure(figureRef: string): UndoResult;
  /** Figure-scoped redo — the inverse-of-the-inverse on the figure's doc (§5.4). */
  redoFigure(figureRef: string): void;
  /** Subscribe to any change (local or synced); returns an unsubscribe fn. */
  subscribe(fn: () => void): () => void;
  /** The routine connection's sync lifecycle, for a "syncing…" indicator (US-018). */
  syncState(): SyncState;
  /** Tear down all document connections. */
  close(): void;
}

/** Project a freshly-minted figure server-side (#187) before opening its DO. */
export type CreateFigureFn = (figure: {
  figureRef: string;
  name: string;
  dance: string;
  figureType: string;
  /** The routine it's added to — records the cascade edge (co-members can read it). */
  routineId: string;
  attributes: Attribute[];
  /** The figure's authored length in counts (Builder v3 ①) — chosen on create. */
  counts?: number;
  /** Figure-level entry/exit alignment seeded from the catalog chart, where charted. */
  entryAlignment?: Alignment;
  exitAlignment?: Alignment;
  /** When set, the new figure is a COW variant of this base (US-035). */
  baseFigureRef?: string;
}) => Promise<void>;

/** Injectable wiring so the seam is testable without a live worker. */
export interface OpenOptions {
  /** Base URL of the worker (default: same-origin). */
  baseUrl?: string;
  /** WebSocket factory (default: the global WebSocket). */
  openSocket?: SocketFactory;
  /** Per-tab Automerge actor id, so undo is per-user (US-010 / #70). */
  actor?: string;
  /** The open user's id, stamped as `authorId` on annotations they create (US-039). */
  currentUserId?: string;
  /**
   * Eagerly open a live WebSocket for EVERY referenced figure on read (default
   * true — the original behavior). Set false for the read/edit hybrid: figures
   * render from `figureContent` (the routine snapshot) with NO per-figure socket,
   * and a figure's own connection opens only when it's edited or `openFigure`d.
   * This is what removes the per-figure socket fan-out for the common read path.
   */
  eagerFigures?: boolean;
  /**
   * Figure-content fallback used in lazy mode (`eagerFigures: false`) for figures
   * whose own connection isn't open: returns the already-resolved figure (the
   * facade wires this to the snapshot's `figureFor`). Ignored in eager mode.
   */
  figureContent?: (figureRef: string) => FigureDoc | null;
  /** Project a new figure to D1 before opening it (default: POST /api/figures). */
  createFigure?: CreateFigureFn;
  /** Resolve a fresh Clerk token at each connection-open (#189), attached to the
   *  WS connect as a subprotocol so the fail-closed DO boundary authenticates it.
   *  The screen wires this to Clerk's `getToken`; omit it (tests / open boundary). */
  getToken?: TokenProvider;
  /**
   * The caller's account-wide custom kinds (fetched by the screen via
   * `listAccountKinds`; tests pass directly). Seeded into the in-memory account
   * set so `customKinds()` includes them without a `createCustomKind` call
   * (US-043). Defaults to [].
   */
  accountKinds?: RegistryKind[];
  /**
   * Persist a newly-created custom kind account-wide. Default: POST
   * /api/account/custom-kinds with a fresh Clerk token (mirrors `createFigure`).
   * Tests pass a `vi.fn()` to avoid real network calls. Called best-effort —
   * fire-and-forget, errors swallowed so the UI never throws (US-043).
   */
  saveCustomKind?: (kind: RegistryKind) => void | Promise<void>;
  /** Called when an edit triggered copy-on-write (US-035), so the screen can
   *  toast "copied as your variant". Receives the new variant's id. */
  onCopyOnWrite?: (variantRef: string) => void;
  /**
   * Auto-reconnect policy for every doc connection (routine + figures). A dropped
   * socket re-opens after this backoff so a blank figure self-heals without a
   * page reload. Defaults to the DocConnection capped-backoff policy; pass
   * `{ delays: [] }` to disable (tests that don't exercise reconnect).
   */
  reconnect?: ReconnectPolicy;
  /**
   * How long (ms) to wait for a figure connection to hydrate before surfacing it
   * as `error` (retryable), so a figure never hangs on a skeleton forever. 0
   * disables the timeout (the default — the production screen sets a real value;
   * tests opt in with a small value + fake timers).
   */
  hydrationTimeoutMs?: number;
  /**
   * Registry-backed access preflight used to tell `missing` (deleted / no access)
   * from `error` (accessible but failed to load) once a figure connection gives
   * up. Resolves true when the figure is accessible, false when denied (a 403
   * from `/api/docs/:id/access`). Default: GET that endpoint with a fresh token.
   */
  checkAccess?: (figureRef: string) => Promise<boolean>;
  /** Schedule a delayed callback (default: global setTimeout) — injected for tests. */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel a scheduled callback (default: global clearTimeout) — injected for tests. */
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
  /**
   * Offline editing (PLAN §11.2): local persistence for the routine + figure
   * docs, keyed by docRef. Defaults to the app-wide IndexedDB store; `null`
   * disables persistence (and with it the editable-offline "local" state) —
   * jsdom tests get that automatically since IndexedDB is absent there.
   */
  storage?: DocStorage | null;
}

const defaultSocketFactory: SocketFactory = (url, protocols) =>
  new WebSocket(url, protocols) as unknown as ReturnType<SocketFactory>;

/** A valid Automerge actor id (even-length hex string), unique per tab (#70). */
function randomActorId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/**
 * The sortKey for a new placement inserted immediately BEFORE `beforePlacementId`
 * (insert-between, US-027), or appended when it's null/omitted/unknown. Assumes
 * `ensureSortKeys` has already backfilled any legacy keyless list, so every item
 * carries a key. The anchor's predecessor may be a tombstone — a midpoint against
 * it still lands the new item just before the visible anchor, order preserved.
 */
function insertSortKey(
  placements: { id: string; sortKey?: string; deletedAt?: number | null }[],
  beforePlacementId?: string | null,
): string {
  const ordered = sortByOrder(placements);
  const lastKey = ordered[ordered.length - 1]?.sortKey ?? null;
  if (beforePlacementId == null) return keyBetween(lastKey, null);
  const idx = ordered.findIndex((p) => p.id === beforePlacementId);
  if (idx < 0) return keyBetween(lastKey, null); // unknown anchor → append
  const prevKey = ordered[idx - 1]?.sortKey ?? null;
  const anchorKey = ordered[idx]?.sortKey ?? null;
  return keyBetween(prevKey, anchorKey);
}

/** An empty routine doc to seed a fresh connection; the DO replays real state. */
function emptyRoutine(id: string): RoutineDoc {
  return {
    id,
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
 * Open a routine: connect to its DO, fan out to each referenced figure doc, and
 * return the reactive store. The figure connections load lazily as placements
 * reference them; each figure carries its own attributes (no overlay resolution).
 */
export async function openRoutine(
  routineId: string,
  opts: OpenOptions = {},
): Promise<RoutineStore> {
  const baseUrl =
    opts.baseUrl ?? (typeof location !== "undefined" ? location.origin : "http://localhost");
  const openSocket = opts.openSocket ?? defaultSocketFactory;
  // A STABLE per-tab Automerge actor id (#70): the same actor must (a) author this
  // client's changes and (b) be the one undo/redo target, or undoLastChange finds
  // nothing. Default one when the caller omits it (the screen does), so per-user
  // undo works out of the box — and two tabs/users get distinct actors.
  const actor = opts.actor ?? randomActorId();
  const currentUserId = opts.currentUserId ?? "";
  const getToken: TokenProvider | undefined = opts.getToken;
  const onCopyOnWrite = opts.onCopyOnWrite;
  // Read/edit hybrid (#95): in lazy figure mode the timeline renders figures from
  // the snapshot (figureContent) with no per-figure socket; a figure connects only
  // on edit / openFigure. Eager (default) keeps the original connect-every-figure path.
  const eagerFigures = opts.eagerFigures ?? true;
  const figureContent = opts.figureContent;
  // Figure-load robustness (#94): reconnect, a hydration timeout, and a registry
  // access preflight, so a figure whose own connection IS open resolves to an
  // honest loading / missing / error status rather than a blank "unknown figure".
  const reconnect = opts.reconnect;
  const hydrationTimeoutMs = opts.hydrationTimeoutMs ?? 0;
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h) => clearTimeout(h));
  // Registry-backed access preflight: GET /api/docs/:id/access mirrors the WS
  // connect authorization (resolveEffectiveRole, incl. the routine→figure
  // cascade), so a 403 means the figure is genuinely missing/denied — a browser
  // WS can't read that off a 1006 close, so we ask REST (FE-2 / #178).
  const checkAccess: (figureRef: string) => Promise<boolean> =
    opts.checkAccess ??
    (async (figureRef) => {
      const token = getToken ? await getToken() : null;
      try {
        await apiGet<unknown>(`${baseUrl}/api/docs/${encodeURIComponent(figureRef)}/access`, token);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) return false;
        throw err; // network / 5xx — unknown, not a denial: surfaces as retryable error
      }
    });
  // Default figure projection: POST /api/figures (authenticated with a fresh
  // token) so the fail-closed DO boundary can owner-resolve the new figure (#187).
  const createFigure: CreateFigureFn =
    opts.createFigure ??
    (async (figure) => {
      const token = getToken ? await getToken() : null;
      await apiPost<unknown>("/api/figures", token, figure);
    });

  // Account-wide custom kinds: seeded from opts; grow as createCustomKind is called.
  let accountKinds: RegistryKind[] = [...(opts.accountKinds ?? [])];
  // Default: POST /api/account/custom-kinds with a fresh token (mirrors createFigure).
  const saveCustomKind: (k: RegistryKind) => void | Promise<void> =
    opts.saveCustomKind ??
    (async (k) => {
      const token = getToken ? await getToken() : null;
      await apiPost<unknown>("/api/account/custom-kinds", token, k);
    });

  // Start from a TRULY empty doc (A.init) — on connect the DO sends ONE snapshot
  // frame (the whole doc as an `A.save` blob, D10) which DocConnection `A.load`s
  // and MERGES into this empty doc, so the client ends up with the identical doc.
  // Seeding content here would create a divergent root; A.init keeps the merge a
  // clean superset of the server's state.
  // Offline editing (§11.2): the shared local persistence, keyed per docRef.
  // Explicit null disables; undefined picks the app-wide IndexedDB store.
  const storage = opts.storage === undefined ? defaultDocStorage() : opts.storage;

  const routineConn = new DocConnection<RoutineDoc>(
    actor ? A.init<RoutineDoc>(actor) : A.init<RoutineDoc>(),
    connectUrl(baseUrl, routineId),
    openSocket,
    { getToken, reconnect, schedule, cancel, storage, storageKey: routineId },
  );

  // Figures the client just minted (addPlacement) but whose server-side create
  // (POST /api/figures → seedDoc) hasn't resolved yet. A render must NOT open
  // their DO connection while they're pending: connecting before the seed is
  // persisted gets an empty catch-up, and since seedDoc doesn't broadcast, the
  // seed never arrives — the figure stays null until a reload. We hold off until
  // createFigure resolves, then open (the catch-up then includes the seed).
  const pendingFigures = new Set<string>();

  // Per-figure load bookkeeping (drives FigureLoadStatus, separate from the
  // connection's own sync state):
  //  • hydrationTimers — the in-flight "still loading?" timer per figure.
  //  • hydrationTimedOut — figures whose timer fired before they hydrated → error.
  //  • accessResult — the registry preflight verdict, so a connection that gave
  //    up resolves to `missing` (denied) vs `error` (accessible but failed).
  const hydrationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const hydrationTimedOut = new Set<string>();
  const accessResult = new Map<string, "accessible" | "denied">();
  const accessInFlight = new Set<string>();

  /** Cancel and forget a figure's hydration timer (it loaded, or we're retrying). */
  const clearHydrationTimer = (figureRef: string): void => {
    const t = hydrationTimers.get(figureRef);
    if (t != null) {
      cancel(t);
      hydrationTimers.delete(figureRef);
    }
  };

  /** Arm the "still hydrating?" timer: if it fires before content arrives and the
   *  doc hasn't caught up, escalate to a retryable `error` so it's never a forever
   *  skeleton. No-op when the timeout is disabled (hydrationTimeoutMs ≤ 0). */
  const startHydrationTimer = (figureRef: string): void => {
    if (hydrationTimeoutMs <= 0) return;
    clearHydrationTimer(figureRef);
    hydrationTimers.set(
      figureRef,
      schedule(() => {
        hydrationTimers.delete(figureRef);
        const conn = figureConns.get(figureRef);
        if (!conn) return;
        if (resolveFigure(figureRef)) return; // hydrated in time — nothing to do
        if (conn.state() === "live") return; // caught up but empty → handled as missing
        hydrationTimedOut.add(figureRef);
        notify();
      }, hydrationTimeoutMs),
    );
  };

  /** Kick off the registry access preflight ONCE for a figure whose connection
   *  gave up, so we can tell `missing` (denied) from `error` (accessible). */
  const requestAccessCheck = (figureRef: string): void => {
    if (accessResult.has(figureRef) || accessInFlight.has(figureRef)) return;
    accessInFlight.add(figureRef);
    Promise.resolve(checkAccess(figureRef))
      .then((ok) => {
        accessResult.set(figureRef, ok ? "accessible" : "denied");
      })
      .catch(() => {
        // Unknown (network/5xx) — leave unset so it reads as a retryable error.
      })
      .finally(() => {
        accessInFlight.delete(figureRef);
        notify();
      });
  };

  // One connection per referenced figure doc, opened on demand and cached.
  const figureConns = new Map<string, DocConnection<FigureDoc>>();
  const figureConn = (figureRef: string): DocConnection<FigureDoc> => {
    let conn = figureConns.get(figureRef);
    if (!conn) {
      conn = new DocConnection<FigureDoc>(
        // Seed with the SAME per-tab actor as the routine conn (#70): the figure
        // editor writes this client's step/attribute/bars edits through this
        // connection, and figure-scoped undo (`undoFigure`, §5.4) targets that
        // actor's last change on THIS doc. An anonymous `A.init()` would author
        // figure edits under a random actor, so `undoLastChange(doc, actor)` would
        // find nothing to revert — the auto-save "an undo exists" contract would be
        // a lie. DocConnection.mergeSnapshot preserves this actor across sync.
        A.init<FigureDoc>(actor),
        connectUrl(baseUrl, figureRef),
        openSocket,
        // A FRESH token at each (re)open (#189); persisted per figureRef (§11.2).
        { getToken, reconnect, schedule, cancel, storage, storageKey: figureRef },
      );
      const c = conn;
      conn.onAdvance(() => {
        // Real content arrived (or merged in) → this figure is no longer loading:
        // clear any pending hydration timeout/escalation so it reads as `live`.
        if (readFigureDoc(c)) {
          clearHydrationTimer(figureRef);
          hydrationTimedOut.delete(figureRef);
        }
        notify();
      });
      figureConns.set(figureRef, conn);
      startHydrationTimer(figureRef);
    }
    return conn;
  };

  /** The load status of a placement's figure (see FigureLoadStatus). */
  const figureStatus = (figureRef: string): FigureLoadStatus => {
    // A just-minted figure whose server-side create is still in flight.
    if (pendingFigures.has(figureRef)) return "pending";
    if (resolveFigure(figureRef)) return "live"; // resolved content (live conn, or snapshot in lazy)
    // No content. Inspect a per-figure connection only if one is (or, in eager
    // mode, should be) open — in LAZY mode we must NOT open a socket here, or the
    // read path would re-grow the per-figure fan-out the hybrid removes.
    const conn = eagerFigures ? figureConn(figureRef) : figureConns.get(figureRef);
    if (!conn) {
      // Lazy mode, figure not connected: it renders from the routine snapshot. No
      // snapshot content yet → still loading (the snapshot read model is what
      // surfaces a genuine 'missing' for the read-only path).
      return "loading";
    }
    const state = conn.state();
    if (state === "live") return "missing"; // caught up, yet no content → gone/empty
    if (state === "closed") {
      // The connection gave up. Ask the registry whether it's denied vs accessible.
      const verdict = accessResult.get(figureRef);
      if (verdict === "denied") return "missing";
      if (verdict === "accessible") return "error";
      requestAccessCheck(figureRef);
      // While the preflight is in flight, keep showing a skeleton; once it (or a
      // missing checker) resolves we settle on missing/error.
      return accessInFlight.has(figureRef) ? "loading" : "error";
    }
    // connecting / reconnecting
    return hydrationTimedOut.has(figureRef) ? "error" : "loading";
  };

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const fn of listeners) fn();
  };
  routineConn.onAdvance(notify);

  /**
   * Read the routine, tolerating an as-yet-unsynced (empty A.init) doc.
   *
   * MEMOIZED by the routine doc's Automerge heads (A): an unchanged routine
   * returns the SAME object across the many reads a single render makes, and
   * across renders driven by an unrelated (figure) sync frame — so the routine's
   * identity, and every placement/annotation object derived from it, stays stable.
   * That referential stability is what stops the editor re-rendering/flickering.
   */
  let routineJsCache: { key: string; value: RoutineDoc } | null = null;
  const readRoutineSafe = (): RoutineDoc => {
    const doc = routineConn.current();
    const key = A.getHeads(doc).join("/");
    if (routineJsCache && routineJsCache.key === key) return routineJsCache.value;
    const js = A.toJS(doc) as Partial<RoutineDoc>;
    let value: RoutineDoc;
    if (!Array.isArray(js.sections)) {
      // Not yet synced from the DO — return the empty sentinel, but preserve any
      // customKinds that have been locally embedded (e.g. via createCustomKind
      // called before the DO's catch-up replay arrives).
      const fallback = emptyRoutine(routineId);
      if (Array.isArray(js.customKinds)) fallback.customKinds = js.customKinds as RegistryKind[];
      value = fallback;
    } else {
      // Structural sharing (reconcile): when the doc DID change, every subtree
      // that didn't keeps its previous identity — so appending one annotation
      // leaves `sections` (and every placement in it) reference-equal, the
      // readPlacements stability guard holds, and only the annotation surfaces
      // re-render. See store/reconcile.ts.
      value = reconcile(routineJsCache?.value, readRoutine(doc));
    }
    routineJsCache = { key, value };
    return value;
  };

  // M2: guard against duplicate orphan variants on rapid double-edits. A second
  // COW on the same figureRef before the first re-point lands would produce two
  // variant rows and orphan one. Cleared in both the success and error paths.
  const cowInFlight = new Set<string>();

  // Referential stability for readPlacements (A): return the SAME array when
  // nothing observable changed (same placements, figures, statuses, live-ness), so
  // an unrelated sync frame doesn't hand consumers a new array identity and churn
  // their effect/memo deps. Safe because the placement objects (from the memoized
  // routine) and figure objects (from each connection's memoized `materialized()`)
  // are themselves reference-stable while unchanged.
  let placementsCache: ResolvedPlacement[] | null = null;
  const sameResolvedPlacements = (a: ResolvedPlacement[], b: ResolvedPlacement[]): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] as ResolvedPlacement;
      const y = b[i] as ResolvedPlacement;
      if (
        x.placement !== y.placement ||
        x.figure !== y.figure ||
        x.status !== y.status ||
        x.fromLiveDoc !== y.fromLiveDoc
      ) {
        return false;
      }
    }
    return true;
  };

  /**
   * Whether a figure's content is served by its OWN hydrated live connection (vs
   * the read-only snapshot fallback in lazy mode). Mirrors resolveFigure's
   * connection lookup; drives ResolvedPlacement.fromLiveDoc → the editor's "load
   * on open" gate (E). Cheap: `materialized()` is heads-memoized.
   */
  const figureFromLiveDoc = (figureRef: string): boolean => {
    if (pendingFigures.has(figureRef)) return false;
    // A catalog live-reference (⟳v5, §4.3) is ALWAYS editor-ready: its content is
    // definitionally available (bundled catalog / snapshot base — §6.2 keeps it
    // poll-fresh, not live), and any user edit spawns a VARIANT rather than
    // writing to this doc — so there is no own-doc hydration to wait for. Without
    // this, opening the editor on a catalog figure in an environment whose global
    // docs aren't seeded (or whose connect is still catching up) hangs the "load
    // on open" gate forever.
    if (libraryFigureByRef(figureRef)) return true;
    const conn = eagerFigures ? figureConn(figureRef) : figureConns.get(figureRef);
    return conn ? readFigureDoc(conn) !== null : false;
  };

  // Referential stability (A) for the derived custom-kinds list — see customKinds().
  let customKindsCache: {
    routineKinds: RegistryKind[] | undefined;
    accountKinds: RegistryKind[];
    value: RegistryKind[];
  } | null = null;

  const store: RoutineStore = {
    readRoutine: readRoutineSafe,

    openFigure: (figureRef) => {
      // Open this figure's own live connection (lazy mode) so it converges while
      // its editor is open. Idempotent — figureConn caches; eager mode already
      // connected it. The onAdvance wiring re-renders as its content hydrates.
      if (pendingFigures.has(figureRef)) return;
      // A catalog live-reference needs NO own connection (⟳v5, §6.2): its content
      // comes from the bundled catalog / snapshot, admin edits arrive on the next
      // poll, and a user edit spawns a variant (which then opens ITS connection).
      // Opening one anyway would 403 wherever the global docs aren't seeded and
      // churn the reconnect/backoff machinery for nothing.
      if (libraryFigureByRef(figureRef)) return;
      figureConn(figureRef);
      notify();
    },

    readPlacements: () => {
      const routine = readRoutineSafe();
      const out: ResolvedPlacement[] = [];
      for (const section of routine.sections) {
        for (const placement of section.placements) {
          // A break has no figure to resolve — it's read structurally from the
          // routine doc (readRoutine), not through the figure-resolution seam.
          if (placement.source === "break" || !placement.figureRef) continue;
          const status = figureStatus(placement.figureRef);
          out.push({
            placement,
            figure: status === "live" ? resolveFigure(placement.figureRef) : null,
            status,
            fromLiveDoc: figureFromLiveDoc(placement.figureRef),
          });
        }
      }
      // Referential stability (A): reuse the prior array when nothing changed.
      if (placementsCache && sameResolvedPlacements(placementsCache, out)) return placementsCache;
      placementsCache = out;
      return out;
    },

    addSection: (name) => {
      routineConn.commit(addSection(routineConn.current(), { name }));
    },

    renameSection: (sectionId, name) => {
      routineConn.change((draft) => {
        const section = draft.sections.find((s) => s.id === sectionId);
        if (section) section.name = name;
      });
    },

    moveSection: (sectionId, direction) => {
      routineConn.change((draft) => {
        // Reorder via sortKey (#63, §5.3): set the moved section's `sortKey`
        // between its new neighbours — NO splice, NO JSON copy, the object is
        // never deleted. Concurrent reorders then converge by Automerge's
        // per-field merge, and a concurrent edit to the moved section survives.
        ensureSortKeys(draft.sections); // backfill a legacy keyless doc in place
        const sorted = sortByOrder(draft.sections);
        const from = sorted.findIndex((s) => s.id === sectionId);
        if (from < 0) return;
        const to = direction === "up" ? from - 1 : from + 1;
        const key = keyForMove(sorted, from, to);
        if (key == null) return;
        const moved = draft.sections.find((s) => s.id === sectionId);
        if (moved) moved.sortKey = key;
      });
    },

    deleteSection: (sectionId) => {
      routineConn.commit(softDeleteSection(routineConn.current(), sectionId));
    },

    addPlacement: (sectionId, figureName, figureTypeArg, countsArg, beforePlacementId) => {
      const name = figureName.trim() || "New figure";
      const dance = readRoutineSafe().dance;
      // Resolve the catalog preset this placement seeds from. An explicit pick supplies the
      // canonical figureType → match on (figureType, name). A *typed* name (no figureType) is
      // matched by name alone: the catalog figureType is hyphenated and a name-slug can't
      // reproduce it for multi-word figures, so a typed "Reverse Turn" would otherwise miss
      // its catalog entry and land as a blank custom. Only a name with no catalog match is
      // truly custom.
      const preset =
        figureTypeArg != null
          ? LIBRARY_FIGURES.find(
              (f) => f.dance === dance && f.figureType === figureTypeArg && f.name === name,
            )
          : LIBRARY_FIGURES.find((f) => f.dance === dance && f.name === name);

      /** Append/insert a placement referencing `figureRef` (shared by both paths). */
      const placeRef = (figureRef: string): void => {
        // `sections?` guards the not-yet-synced (empty A.init) doc edge.
        routineConn.change((draft) => {
          const section = draft.sections?.find((s) => s.id === sectionId);
          if (section) {
            // Insert before the anchor (insert-between) or append (#63). Backfill any
            // legacy keyless placements first so the new key sorts correctly.
            ensureSortKeys(section.placements);
            section.placements.push({
              id: newId(),
              figureRef,
              sortKey: insertSortKey(section.placements, beforePlacementId),
              deletedAt: null,
            });
          }
        });
      };

      // ⟳v5 (§4.3): a CATALOG pick places a LIVE REFERENCE to the global figure doc
      // — no POST /api/figures, no account copy, no seeding. The placement points at
      // `globalFigureRef(dance, figureType)`; it renders from the (admin-seeded)
      // global doc, falling back to the bundled catalog content by construction
      // (pre-filled). A non-admin's first edit spawns a variant (editFigure below).
      if (preset) {
        placeRef(globalFigureRef(dance, preset.figureType));
        notify(); // re-render so the live reference resolves + renders
        return;
      }

      // Only a name with NO catalog match mints a true CUSTOM (empty, choreo-local)
      // figure doc — projected + server-seeded like before (#187/#205).
      const figureRef = newId();
      // figureType is immutable once set (#91): the explicit arg, else a slug from the name.
      const figureType = figureTypeArg ?? (slugify(name) || figureRef);
      // Mark the figure pending BEFORE the placement appears, so the re-render this
      // change triggers shows the placement as loading without eagerly opening (and
      // racing the seed of) its not-yet-created DO.
      pendingFigures.add(figureRef);
      placeRef(figureRef);

      // A fresh custom carries no charted timeline; its authored length defaults to
      // the create flow's chosen `counts`, else a bar's worth of beats.
      const counts = countsArg ?? DANCES[dance].beatsPerBar;

      // Project the figure to D1 + an owner membership AND server-seed its CRDT
      // content durably (#187/#205): POST /api/figures both projects the registry/
      // membership rows AND seeds the figure doc into its DO server-side, so the
      // figure name is DO-persisted the instant it exists — no racy client seed
      // write that could be lost on an immediate reload. We then just OPEN the
      // figure connection so its (server-seeded) content replays on catch-up.
      createFigure({ figureRef, name, dance, figureType, routineId, attributes: [], counts })
        .then(() => {
          // Created server-side (DO seeded) → safe to open: the catch-up replay
          // now carries the seed, so the figure hydrates deterministically.
          pendingFigures.delete(figureRef);
          figureConn(figureRef);
          notify(); // re-render so resolveFigure now opens + reads the figure
        })
        .catch((err) => {
          // Create failed (auth/network/quota): stop gating so the placement isn't a
          // permanent skeleton — a later render falls back to the normal lazy
          // connect (and the figure simply reads empty if it truly doesn't exist),
          // rather than hanging on "loading" forever.
          pendingFigures.delete(figureRef);
          console.warn("figure create failed; placement will retry connecting lazily", err);
          notify();
        });
    },

    movePlacement: (sectionId, placementId, direction) => {
      routineConn.change((draft) => {
        const section = draft.sections.find((s) => s.id === sectionId);
        if (!section) return;
        // Reorder via sortKey (#63, §5.3): a per-field update on the moved
        // placement — no splice, no JSON copy, the object is never deleted, so a
        // concurrent edit to it survives and two concurrent reorders converge.
        ensureSortKeys(section.placements); // backfill a legacy keyless doc in place
        const sorted = sortByOrder(section.placements);
        const from = sorted.findIndex((p) => p.id === placementId);
        if (from < 0) return;
        const to = direction === "up" ? from - 1 : from + 1;
        const key = keyForMove(sorted, from, to);
        if (key == null) return;
        const moved = section.placements.find((p) => p.id === placementId);
        if (moved) moved.sortKey = key;
      });
    },

    deletePlacement: (sectionId, placementId) => {
      routineConn.change((draft) => {
        const section = draft.sections.find((s) => s.id === sectionId);
        const placement = section?.placements.find((p) => p.id === placementId);
        if (placement) placement.deletedAt = Date.now();
      });
    },

    addBreak: (sectionId, beforePlacementId) => {
      // Default a break to one bar of the routine's dance (3 Waltz / 4 others).
      const beats = DANCES[readRoutineSafe().dance].beatsPerBar;
      routineConn.change((draft) => {
        const section = draft.sections?.find((s) => s.id === sectionId);
        if (!section) return;
        // Insert before the anchor (insert-between) or append (#63), mirroring
        // addPlacement. A break carries NO figureRef (Automerge can't store
        // undefined — we simply omit the field).
        ensureSortKeys(section.placements);
        section.placements.push({
          id: newId(),
          source: "break",
          beats,
          sortKey: insertSortKey(section.placements, beforePlacementId),
          deletedAt: null,
        });
      });
    },

    setBreakBeats: (sectionId, placementId, beats) => {
      const next = Math.max(1, Math.round(beats));
      routineConn.change((draft) => {
        const section = draft.sections.find((s) => s.id === sectionId);
        const placement = section?.placements.find((p) => p.id === placementId);
        if (placement?.source === "break") placement.beats = next;
      });
    },

    setFigureAttributes: (figureRef, rawAttributes) => {
      const figure = readFigureDoc(figureConn(figureRef));
      // Dance gate (write path): drop any attribute whose kind does not apply to
      // this figure's dance — e.g. a `rise` value can never land on a Tango figure
      // (§3/§10.2). This mirrors the domain `parseAttributeWrite` rejection at the
      // DO seed boundary, so the rule holds whether an attribute set arrives through
      // the store seam (in-place / copy-on-write below) or the worker route. The
      // reading view already HID inapplicable columns; this stops the bad value at
      // the source instead of relying on every reader to defend.
      const attributes = rawAttributes.filter((a) => kindAppliesToDance(a.kind, figure?.dance));
      editFigure(figureRef, { attributes });
    },

    setFigureCounts: (figureRef, rawCounts) => {
      editFigure(figureRef, { counts: Math.min(64, Math.max(1, Math.round(rawCounts))) });
    },

    setFigureAlignment: (figureRef, edge, alignment) => {
      // Entry/exit alignment lives on the figure doc (US-031). Clearing deletes
      // the key (Automerge can't store undefined).
      const key = edge === "entry" ? "entryAlignment" : "exitAlignment";
      figureConn(figureRef).change((draft) => {
        if (alignment) draft[key] = alignment;
        else delete draft[key];
      });
    },

    readAnnotations: () => readRoutineSafe().annotations,

    createAnnotation: (input) => {
      // Annotations live in the routine doc → they sync to all members for free
      // (US-039 AC-3). The "annotation"-intent envelope that lets a commenter
      // write this while refusing their structural edits lands in Task 4 (#117).
      routineConn.commit(
        addAnnotation(routineConn.current(), { authorId: currentUserId, ...input }),
      );
    },

    addReply: (annotationId, text) => {
      routineConn.commit(
        addReply(routineConn.current(), annotationId, { authorId: currentUserId, text }),
      );
    },

    deleteAnnotation: (annotationId) => {
      routineConn.commit(softDeleteAnnotation(routineConn.current(), annotationId));
    },

    deleteReply: (annotationId, replyId) => {
      routineConn.commit(softDeleteReply(routineConn.current(), annotationId, replyId));
    },

    createCustomKind: (kind) => {
      // Ignore reserved/builtin slugs — they can't be overridden by user kinds.
      if (isReservedKind(kind.kind)) return;
      // (a) Embed into the routine doc (CRDT — all co-editors and forks receive it).
      routineConn.change((draft) => {
        if (!draft.customKinds) draft.customKinds = [];
        if (!draft.customKinds.some((k) => k.kind === kind.kind)) draft.customKinds.push(kind);
      });
      // (b) Add to the in-memory account set (available across routines this session).
      if (!accountKinds.some((k) => k.kind === kind.kind)) {
        accountKinds = [...accountKinds, kind];
      }
      // (c) Persist account-wide — best-effort, never block the UI on the network.
      void Promise.resolve(saveCustomKind(kind)).catch(() => {});
      // No explicit notify(): routineConn.change above already fired onAdvance →
      // notify, and the kind is visible immediately via the routine-embedded copy
      // (the in-memory account set is updated synchronously before that re-render).
    },

    customKinds: () => {
      // Referential stability (A): both inputs are identity-stable while
      // unchanged (the routine list via reconcile, the account list because
      // createCustomKind replaces the array), so reuse the derived array and
      // hand consumers the SAME reference across unrelated re-renders.
      const routineKindsRaw = readRoutineSafe().customKinds;
      if (
        customKindsCache &&
        customKindsCache.routineKinds === routineKindsRaw &&
        customKindsCache.accountKinds === accountKinds
      ) {
        return customKindsCache.value;
      }
      const routineKinds = routineKindsRaw ?? [];
      const bySlug = new Map<string, RegistryKind>();
      for (const k of accountKinds) bySlug.set(k.kind, k);
      for (const k of routineKinds) bySlug.set(k.kind, k); // routine-embedded wins
      const value = [...bySlug.values()].filter((k) => !isReservedKind(k.kind));
      customKindsCache = { routineKinds: routineKindsRaw, accountKinds, value };
      return value;
    },

    retryFigure: (figureRef) => {
      // Clear the prior failure verdict + timeout, force an immediate reconnect,
      // and re-arm the hydration timer so a failed figure recovers in place.
      hydrationTimedOut.delete(figureRef);
      accessResult.delete(figureRef);
      figureConns.get(figureRef)?.reconnectNow();
      startHydrationTimer(figureRef);
      notify();
    },

    undo: () => {
      const actorId = actor ?? "local";
      const before = routineConn.current();
      // Peek the soft hint on the PRE-undo doc (the undo itself adds a change
      // that would otherwise perturb the dependency graph). Undo still always
      // proceeds — this is advisory only (US-038 AC-3, PLAN §5.4).
      const superseded = wasSupersededByOthers(before, actorId);
      const after = undoLastChange(before, actorId);
      // undoLastChange returns the SAME doc reference on a no-op (nothing to undo).
      const undone = after !== before;
      routineConn.commit(after);
      return { undone, supersededByOthers: undone && superseded };
    },
    redo: () => routineConn.commit(redoLastChange(routineConn.current(), actor ?? "local")),

    undoFigure: (figureRef) => {
      const neutral: UndoResult = { undone: false, supersededByOthers: false };
      // ⟳v5 (§4.3/§5.2): a catalog live-reference has NO own connection and the
      // user owns no changes on it — a user edit spawns a VARIANT rather than
      // writing this doc — so figure-undo on it is a graceful no-op, not an error.
      if (libraryFigureByRef(figureRef)) return neutral;
      const conn = figureConns.get(figureRef);
      // No own connection yet (not opened/edited/hydrated) → nothing this actor
      // can undo on the figure. (Lazy mode never opens a figure conn on a read.)
      if (!conn) return neutral;
      const actorId = actor ?? "local";
      const before = conn.current();
      // Peek the soft "superseded" hint on the PRE-undo doc (US-038 AC-3, §5.4) —
      // the undo itself adds a change that would perturb the dependency graph.
      // Undo still always proceeds; this is advisory only. Mirrors the routine path.
      const superseded = wasSupersededByOthers(before, actorId);
      const after = undoLastChange(before, actorId);
      // undoLastChange returns the SAME doc reference on a no-op (nothing to undo).
      const undone = after !== before;
      conn.commit(after); // committed so the inverse SYNCS on the figure's socket
      return { undone, supersededByOthers: undone && superseded };
    },
    redoFigure: (figureRef) => {
      if (libraryFigureByRef(figureRef)) return; // catalog ref: no own doc to redo
      const conn = figureConns.get(figureRef);
      if (!conn) return;
      conn.commit(redoLastChange(conn.current(), actor ?? "local"));
    },

    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // The routine connection drives the indicator; figure connections are
    // secondary. "live" once the routine DO's catch-up replay has arrived.
    syncState: () => routineConn.state(),

    // §11.2: undelivered local changes across the routine + every figure doc.
    pendingSyncCount: () => {
      let n = routineConn.pendingSyncCount();
      for (const conn of figureConns.values()) n += conn.pendingSyncCount();
      return n;
    },

    close: () => {
      for (const t of hydrationTimers.values()) cancel(t);
      hydrationTimers.clear();
      routineConn.close();
      for (const conn of figureConns.values()) conn.close();
    },
  };

  /**
   * Apply a partial edit (attributes and/or bars) to a figure doc (⟳v5, §5.2).
   *
   *  • A GLOBAL (catalog) figure spawns a live overlay VARIANT (`spawnVariant`):
   *    a new account figure owning ONLY the edited beats, `baseFigureRef` a LIVE
   *    link — the placement re-points and the screen toasts "made this figure
   *    yours". The base is never mutated (§2.5.1 #17).
   *  • An ACCOUNT figure edits IN PLACE (yours, or a co-member's via the routine
   *    cascade — the shared doc converges, US-034). When it is itself a VARIANT and
   *    its base is at hand, the attribute write goes through `variantAttributesForEdit`
   *    so an edit that REVERTS a beat to the base's content releases ownership of
   *    that beat (§2.5.1 #15–16); otherwise a whole-array write (bars-only, a
   *    from-scratch custom, or the base unavailable).
   *
   * Shared by `setFigureAttributes` and `setFigureBars`.
   */
  function editFigure(
    figureRef: string,
    patch: { attributes?: Attribute[]; counts?: number },
  ): void {
    const figure = readFigureDoc(figureConn(figureRef));

    // ⟳v5 variant-on-edit of a GLOBAL figure (non-admin). The DO boundary rejects a
    // non-admin's direct write regardless; the client realizes the edit as a variant.
    if (figure?.scope === "global") {
      spawnVariantForEdit(figureRef, figure, patch);
      return;
    }

    const conn = figureConn(figureRef);
    // A variant's base (when this account figure IS a variant and we can resolve it)
    // — used to re-diff the edited timeline so reverting a beat releases ownership.
    const base =
      patch.attributes !== undefined && figure?.baseFigureRef
        ? resolveBaseContent(figure.baseFigureRef)
        : null;
    conn.change((draft) => {
      if (patch.attributes !== undefined) {
        draft.attributes = base
          ? variantAttributesForEdit(base, patch.attributes)
          : patch.attributes;
      }
      if (patch.counts !== undefined) draft.counts = patch.counts;
    });
  }

  /**
   * Spawn a live overlay variant for a non-admin editing a GLOBAL figure (§5.2).
   * The variant owns ONLY the edited beats (`spawnVariant` → `variantAttributesForEdit`);
   * `bars`/alignment resolve live from the base until the variant authors its own
   * (§2.5.2), so they are forwarded only when the user actually patched `bars`.
   */
  function spawnVariantForEdit(
    figureRef: string,
    base: FigureDoc,
    patch: { attributes?: Attribute[]; counts?: number },
  ): void {
    const loc = findPlacement(figureRef);
    if (!loc) return;
    // Guard against duplicate orphan variants on rapid double-edits (a 2nd spawn
    // before the first re-point lands would orphan a variant). Cleared on both paths.
    if (cowInFlight.has(figureRef)) return;
    cowInFlight.add(figureRef);

    // The editor operates on the RESOLVED timeline (a global figure is standalone,
    // so that's its own attributes); spawnVariant diffs it against the base to keep
    // only the owned (changed) beats.
    const editedAttributes = patch.attributes ?? base.attributes;
    const { variant, placement: rePointed } = spawnVariant(
      loc.placement,
      base,
      currentUserId,
      editedAttributes,
    );

    // 1) Project the variant (account-figure row + DO seeded with the LIVE base
    //    ref). Only AFTER it succeeds do we write content, re-point, and toast — so
    //    a failed POST never leaves the placement pointing at an uncreated doc.
    createFigure({
      figureRef: variant.id,
      name: variant.name,
      dance: variant.dance,
      figureType: variant.figureType,
      routineId,
      attributes: variant.attributes, // ⟳v5: ONLY the owned beats, not a full copy
      // length/alignment are NOT copied — they resolve live from the base (§2.5.2)
      // until the variant authors its own; forward `counts` only if the user set it.
      ...(patch.counts != null ? { counts: patch.counts } : {}),
      baseFigureRef: variant.baseFigureRef ?? base.id,
    })
      .then(() => {
        const conn = figureConn(variant.id);
        // 2) Write the variant's content onto its DO — deferred until the DO's
        //    catch-up replay has been applied (#202 / C1), so the client write lands
        //    causally AFTER the server seed and always wins (no silent edit loss).
        conn.onceLive(() => {
          conn.change((draft) => {
            draft.id = variant.id;
            draft.scope = "account";
            draft.ownerId = currentUserId;
            draft.source = "custom";
            draft.figureType = variant.figureType;
            draft.dance = variant.dance;
            draft.name = variant.name;
            draft.baseFigureRef = variant.baseFigureRef ?? base.id; // LIVE link
            draft.attributes = variant.attributes; // owned beats only
            if (patch.counts != null) draft.counts = patch.counts;
            draft.schemaVersion = base.schemaVersion;
            draft.deletedAt = null;
          });
        });
        // 3) Re-point the placement to the variant — only on success.
        routineConn.change((draft) => {
          for (const section of draft.sections ?? []) {
            const p = section.placements?.find((pp) => pp.id === rePointed.id);
            if (p) p.figureRef = variant.id;
          }
        });
        // 4) Tell the screen to toast "made this figure yours".
        onCopyOnWrite?.(variant.id);
        cowInFlight.delete(figureRef);
      })
      .catch((err) => {
        // The variant POST failed (auth/network/quota): leave the placement on the
        // base figure (no re-point, no toast) — the edit drops rather than corrupting
        // state with a dangling variant reference.
        console.warn("variant spawn failed; placement left on the base figure", err);
        cowInFlight.delete(figureRef);
      });
  }

  /** Find the (live) placement and its section id that references `figureRef`. */
  function findPlacement(figureRef: string): { sectionId: string; placement: Placement } | null {
    const routine = readRoutineSafe();
    for (const section of routine.sections) {
      for (const placement of section.placements) {
        if (placement.deletedAt != null) continue; // never re-point a tombstoned placement
        if (placement.figureRef === figureRef) return { sectionId: section.id, placement };
      }
    }
    return null;
  }

  /**
   * The live/snapshot/bundle content a base ref resolves to, for `resolveVariantOverlay`
   * (⟳v5, §5.2). A variant fills its untouched beats from this. Order: an OPEN live
   * base connection → the routine snapshot (`figureContent`) → the bundled catalog
   * (always available for a `global:` base). Returns null when no source has it.
   */
  const resolveBaseContent = (
    baseRef: string,
  ): Pick<FigureDoc, "attributes" | "bars" | "entryAlignment" | "exitAlignment"> | null => {
    const conn = figureConns.get(baseRef);
    const live = conn ? readFigureDoc(conn) : null;
    if (live) return live;
    const snap = figureContent?.(baseRef);
    if (snap) return snap;
    const cat = libraryFigureByRef(baseRef);
    if (cat) {
      return {
        attributes: cat.attributes ?? [],
        ...(cat.entryAlignment ? { entryAlignment: cat.entryAlignment } : {}),
        ...(cat.exitAlignment ? { exitAlignment: cat.exitAlignment } : {}),
      };
    }
    return null;
  };

  /**
   * A full FigureDoc synthesized from the bundled catalog for a `global:` ref — so a
   * live catalog reference (⟳v5, §4.3) renders PRE-FILLED by construction, even
   * before its (admin-seeded) DO hydrates or appears in the snapshot. Returns null
   * for a non-catalog ref (a real account/custom figure loads from its own doc).
   */
  const catalogFigureFor = (ref: string): FigureDoc | null => {
    const cat = libraryFigureByRef(ref);
    if (!cat) return null;
    const attributes = (cat.attributes ?? []).map((a) => ({ ...a }));
    return {
      id: ref,
      scope: "global",
      ownerId: "app",
      figureType: cat.figureType,
      dance: cat.dance,
      name: cat.name,
      source: "library",
      counts: defaultFigureCounts(attributes),
      attributes,
      ...(cat.entryAlignment ? { entryAlignment: cat.entryAlignment } : {}),
      ...(cat.exitAlignment ? { exitAlignment: cat.exitAlignment } : {}),
      schemaVersion: 1,
      deletedAt: null,
    };
  };

  /**
   * Resolve a placement's figure to its effective content (⟳v5, §5.2). A VARIANT
   * (non-null `baseFigureRef`) resolves per-beat against its live base
   * (`resolveVariantOverlay`): owned beats read from the variant, untouched beats
   * live from the base. A standalone figure — a catalog reference, a from-scratch
   * custom, or a legacy full copy that owns all its beats — resolves to itself.
   */
  function resolveFigure(figureRef: string): FigureDoc | null {
    // A just-minted figure whose server-side create is still in flight: render it
    // as loading (null) WITHOUT opening its DO — opening now would race the seed
    // (see pendingFigures). The createFigure resolution opens it + re-renders.
    if (pendingFigures.has(figureRef)) return null;
    // Eager mode opens the figure's connection; lazy mode only uses one that's
    // ALREADY open (edited / openFigure'd), else falls back to the snapshot; a
    // `global:` catalog reference falls back to the bundled catalog (pre-filled).
    const conn = eagerFigures ? figureConn(figureRef) : (figureConns.get(figureRef) ?? null);
    const live = conn ? readFigureDoc(conn) : null;
    const figure = live ?? figureContent?.(figureRef) ?? catalogFigureFor(figureRef);
    if (!figure) return null; // truly loading / missing
    // Resolve a variant against its live base; a standalone figure is its own content.
    if (figure.baseFigureRef) {
      const base = resolveBaseContent(figure.baseFigureRef);
      if (base) return resolveVariantOverlay(base, figure);
    }
    return figure;
  }

  return store;
}

// ── small helpers kept local to the seam ───────────────────────────────────

/** Materialize a figure doc, returning null until it has real content. Reads via
 *  the connection's heads-memoized `materialized()` so an unchanged figure keeps a
 *  STABLE object identity across renders (referential stability — stops the editor
 *  re-rendering/flickering on sync frames that didn't touch this figure). */
function readFigureDoc(conn: DocConnection<FigureDoc>): FigureDoc | null {
  const js = conn.materialized();
  return js.figureType ? js : null;
}

/** A safe figureType slug from a user name (a new custom figure's stable type). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
