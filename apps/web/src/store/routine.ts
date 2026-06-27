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
  LIBRARY_FIGURES,
  newId,
  type Placement,
  type RoutineDoc,
  readRoutine,
  redoLastChange,
  resolve,
  softDeleteAnnotation,
  softDeleteReply,
  softDeleteSection,
  undoLastChange,
} from "@ballroom/domain";
import { apiPost } from "../lib/rpc";
import {
  connectUrl,
  DocConnection,
  type SocketFactory,
  type SyncState,
  type TokenProvider,
} from "./doc-connection";
import { overlayFromAttributes } from "./overlay-diff";

/** A placement with its figure resolved to effective attributes (base ⊕ overlay). */
export interface ResolvedPlacement {
  placement: Placement;
  figure: FigureDoc | null;
}

/** The reactive seam a component consumes. Read, mutate, undo — nothing else. */
export interface RoutineStore {
  /** Placements across all sections, each with its resolved figure. */
  readPlacements(): ResolvedPlacement[];
  /** The materialized routine doc (tombstones dropped). */
  readRoutine(): RoutineDoc;
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
  /** Project a new figure to D1 before opening it (default: POST /api/figures). */
  createFigure?: CreateFigureFn;
  /** Resolve a fresh Clerk token at each connection-open (#189), attached to the
   *  WS connect as a subprotocol so the fail-closed DO boundary authenticates it.
   *  The screen wires this to Clerk's `getToken`; omit it (tests / open boundary). */
  getToken?: TokenProvider;
  /** Called when an edit triggered copy-on-write (US-035), so the screen can
   *  toast "copied as your variant". Receives the new variant's id. */
  onCopyOnWrite?: (variantRef: string) => void;
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
  // Default figure projection: POST /api/figures (authenticated with a fresh
  // token) so the fail-closed DO boundary can owner-resolve the new figure (#187).
  const createFigure: CreateFigureFn =
    opts.createFigure ??
    (async (figure) => {
      const token = getToken ? await getToken() : null;
      await apiPost<unknown>("/api/figures", token, figure);
    });

  // Start from a TRULY empty doc (A.init) — the DO replays its full history
  // (getAllChanges, incl. the doc's creation) on connect, so the client builds
  // the identical doc by applying those changes. Seeding content here would
  // create a divergent root that can't cleanly load the DO's history.
  const routineConn = new DocConnection<RoutineDoc>(
    actor ? A.init<RoutineDoc>(actor) : A.init<RoutineDoc>(),
    connectUrl(baseUrl, routineId),
    openSocket,
    getToken,
  );

  // One connection per referenced figure doc, opened on demand and cached.
  const figureConns = new Map<string, DocConnection<FigureDoc>>();
  const figureConn = (figureRef: string): DocConnection<FigureDoc> => {
    let conn = figureConns.get(figureRef);
    if (!conn) {
      conn = new DocConnection<FigureDoc>(
        A.init<FigureDoc>(),
        connectUrl(baseUrl, figureRef),
        openSocket,
        getToken, // a FRESH token at THIS (lazy) figure conn's open (#189)
      );
      conn.onAdvance(() => notify());
      figureConns.set(figureRef, conn);
    }
    return conn;
  };

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const fn of listeners) fn();
  };
  routineConn.onAdvance(notify);

  /** Read the routine, tolerating an as-yet-unsynced (empty A.init) doc. */
  const readRoutineSafe = (): RoutineDoc => {
    const js = A.toJS(routineConn.current()) as Partial<RoutineDoc>;
    if (!Array.isArray(js.sections)) return emptyRoutine(routineId); // not synced yet
    return readRoutine(routineConn.current());
  };

  const store: RoutineStore = {
    readRoutine: readRoutineSafe,

    readPlacements: () => {
      const routine = readRoutineSafe();
      const out: ResolvedPlacement[] = [];
      for (const section of routine.sections) {
        for (const placement of section.placements) {
          out.push({ placement, figure: resolveFigure(placement.figureRef) });
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
      // A library pick supplies the catalog's canonical figureType (cross-routine
      // identity); a custom figure slugs one from the name. Immutable once set (#91).
      const figureType = figureTypeArg ?? (slugify(name) || figureRef);
      const dance = readRoutineSafe().dance;

      // Add the placement to the routine immediately (it only references figureRef).
      // `sections?` guards the not-yet-synced (empty A.init) doc edge.
      routineConn.change((draft) => {
        const section = draft.sections?.find((s) => s.id === sectionId);
        if (section) section.placements.push({ id: newId(), figureRef, deletedAt: null });
      });

      // A library pick carries the catalog's per-step timeline (US-032 + WDSF seed);
      // a custom figure has none. Match on (dance, figureType, name) — the picked
      // identity. A few figureType slugs are shared by different figures (e.g.
      // foxtrot "reverse-turn"), so we also match on name to be precise.
      const preset = LIBRARY_FIGURES.find(
        (f) => f.dance === dance && f.figureType === figureType && f.name === name,
      );
      const attributes = preset?.attributes ?? [];

      // Project the figure to D1 + an owner membership AND server-seed its CRDT
      // content durably (#187/#205): POST /api/figures now both projects the
      // registry/membership rows AND seeds the figure doc into its DO server-side,
      // so the figure's name/attributes are DO-persisted the instant it exists —
      // no racy client seed write that could be lost on an immediate reload. We
      // then just OPEN the figure connection so its (server-seeded) content
      // replays into the local store on catch-up.
      createFigure({ figureRef, name, dance, figureType, routineId, attributes }).then(() => {
        figureConn(figureRef);
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
      const owned = isOwnedFigure(figureRef);
      if (owned) {
        // Edit in place — flows to every routine referencing this owned figure (US-034).
        figureConn(figureRef).change((draft) => {
          draft.attributes = attributes;
        });
        return;
      }
      // Copy-on-write: editing a non-owned (global/other's) figure spawns an
      // owned variant, re-points the placement, and stores the edit as an
      // overlay against the live base (US-035 / US-008). The base is untouched.
      const base = readFigureDoc(figureConn(figureRef).current());
      if (!base) return;
      const loc = findPlacement(figureRef);
      if (!loc) return;
      const { variant, placement: rePointed } = copyOnWrite(loc.placement, base, currentUserId);
      if (!variant) {
        // Defensive: copyOnWrite says we own it after all — edit in place.
        figureConn(figureRef).change((draft) => {
          draft.attributes = attributes;
        });
        return;
      }
      // 1) Project the variant (account-figure row + variant DO seeded w/ base ref).
      createFigure({
        figureRef: variant.id,
        name: variant.name,
        dance: variant.dance,
        figureType: variant.figureType,
        routineId,
        attributes: [],
        baseFigureRef: base.id,
      }).then(() => {
        const conn = figureConn(variant.id);
        // 2) Write the edit as an overlay against the live base.
        const overlay = overlayFromAttributes(base.attributes, attributes);
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
      // 3) Re-point the placement in the routine doc (immediate; sync-safe).
      routineConn.change((draft) => {
        for (const section of draft.sections ?? []) {
          const p = section.placements?.find((pp) => pp.id === rePointed.id);
          if (p) p.figureRef = variant.id;
        }
      });
      onCopyOnWrite?.(variant.id);
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
      routineConn.close();
      for (const conn of figureConns.values()) conn.close();
    },
  };

  /** True when the figure at `figureRef` is account-scoped AND owned by the open user. */
  function isOwnedFigure(figureRef: string): boolean {
    const f = readFigureDoc(figureConn(figureRef).current());
    return !!f && f.scope === "account" && f.ownerId === currentUserId;
  }

  /** Find the placement (and its section id) that references `figureRef`. */
  function findPlacement(figureRef: string): { sectionId: string; placement: Placement } | null {
    const routine = readRoutineSafe();
    for (const section of routine.sections) {
      for (const placement of section.placements) {
        if (placement.figureRef === figureRef) return { sectionId: section.id, placement };
      }
    }
    return null;
  }

  /** Resolve a placement's figure: a variant (baseFigureRef + overlay) resolves to base ⊕ overlay. */
  function resolveFigure(figureRef: string): FigureDoc | null {
    const conn = figureConn(figureRef);
    const figure = readFigureDoc(conn.current());
    if (!figure) return null;
    if (figure.baseFigureRef && figure.overlay) {
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
