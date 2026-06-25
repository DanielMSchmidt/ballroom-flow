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
  type FigureDoc,
  type Placement,
  type RoutineDoc,
  readRoutine,
  redoLastChange,
  resolve,
  undoLastChange,
} from "@ballroom/domain";
import { connectUrl, DocConnection, type SocketFactory, type SyncState } from "./doc-connection";

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
  /** Rename a section (example mutation; the editor adds more). */
  renameSection(sectionId: string, name: string): void;
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

/** Injectable wiring so the seam is testable without a live worker. */
export interface OpenOptions {
  /** Base URL of the worker (default: same-origin). */
  baseUrl?: string;
  /** WebSocket factory (default: the global WebSocket). */
  openSocket?: SocketFactory;
  /** Per-tab Automerge actor id, so undo is per-user (US-010 / #70). */
  actor?: string;
}

const defaultSocketFactory: SocketFactory = (url) =>
  new WebSocket(url) as unknown as ReturnType<SocketFactory>;

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
  const actor = opts.actor;

  // Start from a TRULY empty doc (A.init) — the DO replays its full history
  // (getAllChanges, incl. the doc's creation) on connect, so the client builds
  // the identical doc by applying those changes. Seeding content here would
  // create a divergent root that can't cleanly load the DO's history.
  const routineConn = new DocConnection<RoutineDoc>(
    actor ? A.init<RoutineDoc>(actor) : A.init<RoutineDoc>(),
    connectUrl(baseUrl, routineId),
    openSocket,
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

    renameSection: (sectionId, name) => {
      routineConn.change((draft) => {
        const section = draft.sections.find((s) => s.id === sectionId);
        if (section) section.name = name;
      });
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

  /** Resolve a placement's figure: a variant (baseFigureRef + overlay) resolves to base ⊕ overlay. */
  function resolveFigure(figureRef: string): FigureDoc | null {
    const conn = figureConn(figureRef);
    const figure = readFigureDoc(conn.current());
    if (!figure) return null;
    if (figure.baseFigureRef && figure.overlay) {
      const base = readFigureDoc(figureConn(figure.baseFigureRef).current());
      if (base) return resolve(base, figure.overlay);
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
