// US-017 — the `store/` seam (PLAN §6.1/§6.2, D6).
//
// The ONLY thing components touch to read/edit a routine. It wraps Automerge +
// the WS sync (DocConnection) behind a typed, reactive interface: open a
// routine, fan out to its referenced figure docs, resolve variant overlays
// (US-006), expose reactive reads + mutations + per-actor undo (US-010).
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
  copyOnWrite,
  type FigureDoc,
  isReservedKind,
  LIBRARY_FIGURES,
  newId,
  type Placement,
  type RegistryKind,
  type RoutineDoc,
  readRoutine,
  redoLastChange,
  resolve,
  softDeleteAnnotation,
  softDeleteReply,
  softDeleteSection,
  undoLastChange,
} from "@ballroom/domain";
import { ApiError, apiGet, apiPost } from "../lib/rpc";
import {
  connectUrl,
  DocConnection,
  type ReconnectPolicy,
  type SocketFactory,
  type SyncState,
  type TokenProvider,
} from "./doc-connection";
import { overlayFromAttributes } from "./overlay-diff";

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

/** A placement with its figure resolved to effective attributes (base ⊕ overlay). */
export interface ResolvedPlacement {
  placement: Placement;
  /** The resolved figure when `status === "live"`, else null. */
  figure: FigureDoc | null;
  /** Where this placement's figure is in its load lifecycle (see FigureLoadStatus). */
  status: FigureLoadStatus;
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
   */
  addPlacement(sectionId: string, figureName: string, figureType?: string): void;
  /** Move a placement up/down WITHIN its section (US-027; reorder convergence #63). */
  movePlacement(sectionId: string, placementId: string, direction: "up" | "down"): void;
  /** Soft-delete a placement — tombstone, never a hard removal (US-027). */
  deletePlacement(sectionId: string, placementId: string): void;
  /**
   * Replace a figure doc's attribute timeline (US-028). The timeline editor emits
   * the figure's full next attribute set; this writes it to that figure's doc
   * (opening its connection if needed). NOTE: editing a non-owned figure should
   * fork via copy-on-write (US-008) — wired in the variant-editor story (#42); for
   * now this writes straight to the referenced figure doc.
   */
  setFigureAttributes(figureRef: string, attributes: Attribute[]): void;
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
  /** Per-actor history undo / redo (US-010). */
  undo(): void;
  redo(): void;
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

/** An empty routine doc to seed a fresh connection; the DO replays real state. */
function emptyRoutine(id: string): RoutineDoc {
  return {
    id,
    title: "",
    dance: "waltz",
    ownerId: "",
    sections: [],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  };
}

/**
 * Open a routine: connect to its DO, fan out to each referenced figure doc, and
 * return the reactive store. The figure connections load lazily as placements
 * reference them; overlays resolve on read.
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

  // Start from a TRULY empty doc (A.init) — the DO replays its full history
  // (getAllChanges, incl. the doc's creation) on connect, so the client builds
  // the identical doc by applying those changes. Seeding content here would
  // create a divergent root that can't cleanly load the DO's history.
  const routineConn = new DocConnection<RoutineDoc>(
    actor ? A.init<RoutineDoc>(actor) : A.init<RoutineDoc>(),
    connectUrl(baseUrl, routineId),
    openSocket,
    { getToken, reconnect, schedule, cancel },
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
        A.init<FigureDoc>(),
        connectUrl(baseUrl, figureRef),
        openSocket,
        { getToken, reconnect, schedule, cancel }, // a FRESH token at each (re)open (#189)
      );
      const c = conn;
      conn.onAdvance(() => {
        // Real content arrived (or merged in) → this figure is no longer loading:
        // clear any pending hydration timeout/escalation so it reads as `live`.
        if (readFigureDoc(c.current())) {
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
    const selfDoc = readFigureDoc(conn.current());
    // A variant whose own doc loaded but whose base is still loading: resolveFigure
    // returns null until the base arrives — that's still loading, not missing.
    if (selfDoc?.baseFigureRef) return "loading";
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

  /** Read the routine, tolerating an as-yet-unsynced (empty A.init) doc. */
  const readRoutineSafe = (): RoutineDoc => {
    const js = A.toJS(routineConn.current()) as Partial<RoutineDoc>;
    if (!Array.isArray(js.sections)) {
      // Not yet synced from the DO — return the empty sentinel, but preserve any
      // customKinds that have been locally embedded (e.g. via createCustomKind
      // called before the DO's catch-up replay arrives).
      const fallback = emptyRoutine(routineId);
      if (Array.isArray(js.customKinds)) fallback.customKinds = js.customKinds as RegistryKind[];
      return fallback;
    }
    return readRoutine(routineConn.current());
  };

  // M2: guard against duplicate orphan variants on rapid double-edits. A second
  // COW on the same figureRef before the first re-point lands would produce two
  // variant rows and orphan one. Cleared in both the success and error paths.
  const cowInFlight = new Set<string>();

  const store: RoutineStore = {
    readRoutine: readRoutineSafe,

    openFigure: (figureRef) => {
      // Open this figure's own live connection (lazy mode) so it converges while
      // its editor is open. Idempotent — figureConn caches; eager mode already
      // connected it. The onAdvance wiring re-renders as its content hydrates.
      if (pendingFigures.has(figureRef)) return;
      figureConn(figureRef);
      notify();
    },

    readPlacements: () => {
      const routine = readRoutineSafe();
      const out: ResolvedPlacement[] = [];
      for (const section of routine.sections) {
        for (const placement of section.placements) {
          const status = figureStatus(placement.figureRef);
          out.push({
            placement,
            figure: status === "live" ? resolveFigure(placement.figureRef) : null,
            status,
          });
        }
      }
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
        const i = draft.sections.findIndex((s) => s.id === sectionId);
        if (i < 0) return;
        const j = direction === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= draft.sections.length) return;
        // Re-insert a plain copy: an Automerge object can't be re-inserted after
        // removal, so move via a JSON copy. Single-client correct; robust
        // concurrent-reorder convergence is the (open) sortKey work, #63.
        const moved = JSON.parse(JSON.stringify(draft.sections[i]));
        draft.sections.splice(i, 1);
        draft.sections.splice(j, 0, moved);
      });
    },

    deleteSection: (sectionId) => {
      routineConn.commit(softDeleteSection(routineConn.current(), sectionId));
    },

    addPlacement: (sectionId, figureName, figureTypeArg) => {
      const figureRef = newId();
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
      // figureType is immutable once set (#91): the matched preset's canonical slug, else the
      // explicit arg, else a slug derived from the custom name.
      const figureType = preset?.figureType ?? figureTypeArg ?? (slugify(name) || figureRef);

      // Mark the figure pending BEFORE the placement appears, so the re-render
      // this change triggers shows the placement as loading without eagerly
      // opening (and racing the seed of) its not-yet-created DO.
      pendingFigures.add(figureRef);

      // Add the placement to the routine immediately (it only references figureRef).
      // `sections?` guards the not-yet-synced (empty A.init) doc edge.
      routineConn.change((draft) => {
        const section = draft.sections?.find((s) => s.id === sectionId);
        if (section) section.placements.push({ id: newId(), figureRef, deletedAt: null });
      });

      // A catalog pick carries the per-step timeline (US-032 + WDSF seed); a custom has none.
      const attributes = preset?.attributes ?? [];

      // Project the figure to D1 + an owner membership AND server-seed its CRDT
      // content durably (#187/#205): POST /api/figures now both projects the
      // registry/membership rows AND seeds the figure doc into its DO server-side,
      // so the figure's name/attributes are DO-persisted the instant it exists —
      // no racy client seed write that could be lost on an immediate reload. We
      // then just OPEN the figure connection so its (server-seeded) content
      // replays into the local store on catch-up.
      createFigure({ figureRef, name, dance, figureType, routineId, attributes })
        .then(() => {
          // Created server-side (DO seeded) → safe to open: the catch-up replay
          // now carries the seed, so the figure hydrates deterministically.
          pendingFigures.delete(figureRef);
          figureConn(figureRef);
          notify(); // re-render so resolveFigure now opens + reads the figure
        })
        .catch((err) => {
          // Create failed (auth/network/quota): stop gating so the placement
          // isn't a permanent skeleton — a later render falls back to the normal
          // lazy connect (and the figure simply reads empty if it truly doesn't
          // exist), rather than hanging on "loading" forever.
          pendingFigures.delete(figureRef);
          console.warn("figure create failed; placement will retry connecting lazily", err);
          notify();
        });
    },

    movePlacement: (sectionId, placementId, direction) => {
      routineConn.change((draft) => {
        const section = draft.sections.find((s) => s.id === sectionId);
        if (!section) return;
        const i = section.placements.findIndex((p) => p.id === placementId);
        if (i < 0) return;
        const j = direction === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= section.placements.length) return;
        // Re-insert a plain copy (an Automerge object can't be re-inserted after
        // removal). Single-client correct; concurrent-reorder fidelity is #63.
        const moved = JSON.parse(JSON.stringify(section.placements[i]));
        section.placements.splice(i, 1);
        section.placements.splice(j, 0, moved);
      });
    },

    deletePlacement: (sectionId, placementId) => {
      routineConn.change((draft) => {
        const section = draft.sections.find((s) => s.id === sectionId);
        const placement = section?.placements.find((p) => p.id === placementId);
        if (placement) placement.deletedAt = Date.now();
      });
    },

    setFigureAttributes: (figureRef, attributes) => {
      const figure = readFigureDoc(figureConn(figureRef).current());
      if (figure?.scope !== "global") {
        // Account figures edit IN PLACE — whether you own it, or it's a co-member's
        // figure you can edit via the routine cascade (the shared doc converges to
        // its owner, US-034). The DO permission boundary enforces your rights: an
        // editor's write is applied, a viewer's is dropped. Copy-on-write fires
        // ONLY for global (app-owned library) figures, which are non-editable.
        figureConn(figureRef).change((draft) => {
          draft.attributes = attributes;
        });
        return;
      }
      // Copy-on-write: editing a global (app-owned library) figure spawns an owned
      // variant, re-points the placement, and stores the edit as an overlay against
      // the live base (US-035 / US-008). The base is untouched.
      const base = figure;
      const loc = findPlacement(figureRef);
      if (!loc) return;
      const { variant, placement: rePointed } = copyOnWrite(loc.placement, base, currentUserId);
      // defensive: a global figure always yields a variant
      if (!variant) return;
      // M2: guard against duplicate orphan variants on rapid double-edits.
      if (cowInFlight.has(figureRef)) return;
      cowInFlight.add(figureRef);
      // 1) Project the variant (account-figure row + variant DO seeded w/ base ref).
      //    Only AFTER it succeeds do we write the overlay, re-point the placement,
      //    and toast — so a failed POST never leaves the placement pointing at a
      //    variant doc that was never created (consistent state; the edit drops).
      createFigure({
        figureRef: variant.id,
        name: variant.name,
        dance: variant.dance,
        figureType: variant.figureType,
        routineId,
        attributes: [],
        baseFigureRef: base.id,
      })
        .then(() => {
          const conn = figureConn(variant.id);
          // 2) Write the edit as an overlay against the live base — deferred until
          //    the variant DO's catch-up replay has been applied (#202 / C1). Without
          //    onceLive the overlay races the empty server seed: both writes are
          //    causally independent, so ~50% of the time the server's empty overlay
          //    wins and the user's edit is silently lost. With onceLive the client
          //    write lands causally AFTER the seed, so it always wins.
          const overlay = overlayFromAttributes(base.attributes, attributes);
          conn.onceLive(() => {
            conn.change((draft) => {
              draft.id = variant.id;
              draft.scope = "account";
              draft.ownerId = currentUserId;
              draft.source = "custom";
              draft.figureType = variant.figureType;
              draft.dance = variant.dance;
              draft.name = variant.name;
              draft.baseFigureRef = base.id;
              draft.overlay = overlay;
              draft.attributes = [];
              draft.schemaVersion = base.schemaVersion;
              draft.deletedAt = null;
            });
          });
          // 3) Re-point the placement in the routine doc — only on success.
          routineConn.change((draft) => {
            for (const section of draft.sections ?? []) {
              const p = section.placements?.find((pp) => pp.id === rePointed.id);
              if (p) p.figureRef = variant.id;
            }
          });
          // 4) Tell the screen to toast "copied as your variant".
          onCopyOnWrite?.(variant.id);
          cowInFlight.delete(figureRef); // M2: release the in-flight guard on success
        })
        .catch((err) => {
          // The variant POST failed (auth/network/quota): leave the placement on
          // the base figure (no re-point, no toast) — the edit is dropped rather
          // than corrupting state with a dangling variant reference.
          console.warn("copy-on-write failed; placement left on the base figure", err);
          cowInFlight.delete(figureRef); // M2: release the in-flight guard on failure too
        });
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
      const routineKinds = readRoutineSafe().customKinds ?? [];
      const bySlug = new Map<string, RegistryKind>();
      for (const k of accountKinds) bySlug.set(k.kind, k);
      for (const k of routineKinds) bySlug.set(k.kind, k); // routine-embedded wins
      return [...bySlug.values()].filter((k) => !isReservedKind(k.kind));
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

    undo: () => routineConn.commit(undoLastChange(routineConn.current(), actor ?? "local")),
    redo: () => routineConn.commit(redoLastChange(routineConn.current(), actor ?? "local")),

    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // The routine connection drives the indicator; figure connections are
    // secondary. "live" once the routine DO's catch-up replay has arrived.
    syncState: () => routineConn.state(),

    close: () => {
      for (const t of hydrationTimers.values()) cancel(t);
      hydrationTimers.clear();
      routineConn.close();
      for (const conn of figureConns.values()) conn.close();
    },
  };

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

  /** Resolve a placement's figure: a variant (baseFigureRef + overlay) resolves to base ⊕ overlay. */
  function resolveFigure(figureRef: string): FigureDoc | null {
    // A just-minted figure whose server-side create is still in flight: render it
    // as loading (null) WITHOUT opening its DO — opening now would race the seed
    // (see pendingFigures). The createFigure resolution opens it + re-renders.
    if (pendingFigures.has(figureRef)) return null;
    // Eager mode opens the figure's connection; lazy mode only uses one that's
    // ALREADY open (edited / openFigure'd), else falls back to the snapshot.
    const conn = eagerFigures ? figureConn(figureRef) : (figureConns.get(figureRef) ?? null);
    const figure = conn ? readFigureDoc(conn.current()) : null;
    if (!figure) {
      // No live content. In lazy mode fall back to the snapshot's resolved figure
      // (already base ⊕ overlay, server-side); in eager mode it's simply loading.
      return eagerFigures ? null : (figureContent?.(figureRef) ?? null);
    }
    if (figure.baseFigureRef && figure.overlay) {
      // A live variant: open its base too (even in lazy mode — only for an
      // actively-open variant) so it resolves live; until the base hydrates, fall
      // back to the snapshot's already-resolved copy rather than flashing empty.
      const base = readFigureDoc(figureConn(figure.baseFigureRef).current());
      if (base) {
        // resolve() returns the BASE's identity by contract (overlay.ts) — stamp
        // the variant's own identity back so re-points/edits target the variant doc.
        return {
          ...resolve(base, figure.overlay),
          id: figure.id,
          scope: figure.scope,
          ownerId: figure.ownerId,
          source: figure.source,
          baseFigureRef: figure.baseFigureRef,
        };
      }
      return eagerFigures ? null : (figureContent?.(figureRef) ?? figure);
    }
    return figure;
  }

  return store;
}

// ── small helpers kept local to the seam ───────────────────────────────────

/** Materialize a figure doc, returning null until it has real content. */
function readFigureDoc(doc: A.Doc<FigureDoc>): FigureDoc | null {
  const js = A.toJS(doc) as FigureDoc;
  return js.figureType ? js : null;
}

/** A safe figureType slug from a user name (a new custom figure's stable type). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
