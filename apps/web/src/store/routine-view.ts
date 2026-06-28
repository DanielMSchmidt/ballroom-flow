// Read/edit split facade (PLAN §6, extends D10).
//
// The behaviour the user feels: opening a routine costs a single REST read and
// ZERO WebSockets — reading is the common case. The live per-document WS sync
// (the edit path) is opened LAZILY, only when the user actually edits. Because
// the UI already gates edit affordances by role, a viewer never triggers an
// upgrade (stays on the cheap snapshot forever); an editor upgrades on their
// first edit and stays live for the rest of the session (editing is bursty —
// thrashing the socket per action would be worse).
//
// This facade implements the full `RoutineStore` surface so screens consume it
// unchanged: reads delegate to the snapshot until the live store is hydrated,
// then to the live store; every mutator first ensures the live store is open and
// defers the actual write until it has hydrated (so an edit never lands on a
// not-yet-replayed doc — the same hazard the store guards internally).
import type { Alignment, Anchor, AnnotationKind, Attribute, RegistryKind } from "@ballroom/domain";
import type { SyncState } from "./doc-connection";
import {
  openRoutine as defaultOpenRoutine,
  type OpenOptions,
  type ResolvedPlacement,
  type RoutineStore,
} from "./routine";
import {
  openRoutineSnapshot as defaultOpenSnapshot,
  type OpenSnapshotOptions,
  type RoutineSnapshotModel,
} from "./routine-snapshot";

export interface OpenViewOptions extends OpenOptions {
  /** Snapshot-path knobs (poll interval, injected fetch/timers — see openRoutineSnapshot). */
  snapshot?: Pick<
    OpenSnapshotOptions,
    "pollMs" | "fetchSnapshot" | "schedule" | "cancel" | "onFocusRefetch"
  >;
  /** Injected for tests: open the live WS store (default: openRoutine). */
  openLive?: (routineId: string, opts: OpenOptions) => Promise<RoutineStore>;
  /** Injected for tests: open the read-only snapshot model (default: openRoutineSnapshot). */
  openSnapshot?: (routineId: string, opts: OpenSnapshotOptions) => RoutineSnapshotModel;
}

/**
 * Open a routine read-first: a snapshot now, the live store on first edit.
 * Returns a `RoutineStore` facade (so the screen is agnostic to which is active).
 */
export function openRoutineView(routineId: string, opts: OpenViewOptions = {}): RoutineStore {
  const openLive = opts.openLive ?? defaultOpenRoutine;
  const openSnapshot = opts.openSnapshot ?? defaultOpenSnapshot;

  const snapshot = openSnapshot(routineId, {
    baseUrl: opts.baseUrl,
    getToken: opts.getToken,
    accountKinds: opts.accountKinds,
    ...opts.snapshot,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const fn of listeners) fn();
  };
  const unsubSnapshot = snapshot.subscribe(notify);

  let live: RoutineStore | null = null;
  let livePromise: Promise<RoutineStore> | null = null;
  let closed = false;

  /** Reads come from the live store ONLY once it's hydrated; otherwise the snapshot. */
  const readSource = (): RoutineStore | RoutineSnapshotModel =>
    live && live.syncState() === "live" ? live : snapshot;

  /** Open the live WS store once (idempotent), wiring its changes into our listeners. */
  const ensureLive = (): Promise<RoutineStore> => {
    if (livePromise) return livePromise;
    livePromise = openLive(routineId, opts).then((s) => {
      if (closed) {
        s.close();
        return s;
      }
      live = s;
      s.subscribe(notify);
      notify(); // syncState now reflects the (connecting) live store
      return s;
    });
    return livePromise;
  };

  /** Run `fn` once the live store is hydrated — so an edit never lands pre-replay. */
  const whenLive = (s: RoutineStore, fn: () => void): void => {
    if (s.syncState() === "live") {
      fn();
      return;
    }
    const unsub = s.subscribe(() => {
      if (s.syncState() === "live") {
        unsub();
        fn();
      }
    });
  };

  /** Build a mutator that upgrades to live, then applies once hydrated. */
  const deferred =
    <A extends unknown[]>(pick: (s: RoutineStore) => (...a: A) => void) =>
    (...args: A): void => {
      void ensureLive().then((s) => whenLive(s, () => pick(s)(...args)));
    };

  return {
    // ── reads (snapshot until live is hydrated, then live) ──────────────────
    readPlacements: (): ResolvedPlacement[] => readSource().readPlacements(),
    readRoutine: () => readSource().readRoutine(),
    readAnnotations: () => readSource().readAnnotations(),
    customKinds: (): RegistryKind[] => readSource().customKinds(),
    syncState: (): SyncState => (live ? live.syncState() : snapshot.syncState()),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close: () => {
      closed = true;
      unsubSnapshot();
      listeners.clear();
      snapshot.close();
      live?.close();
    },

    // ── mutators (lazy upgrade to the live WS store, applied once hydrated) ──
    addSection: deferred((s) => s.addSection),
    renameSection: deferred((s) => s.renameSection),
    moveSection: deferred((s) => s.moveSection),
    deleteSection: deferred((s) => s.deleteSection),
    addPlacement: deferred((s) => s.addPlacement),
    movePlacement: deferred((s) => s.movePlacement),
    deletePlacement: deferred((s) => s.deletePlacement),
    setFigureAttributes: deferred((s) => s.setFigureAttributes),
    setFigureAlignment: deferred(
      (s) => s.setFigureAlignment as (...a: [string, "entry" | "exit", Alignment | null]) => void,
    ),
    createAnnotation: deferred(
      (s) =>
        s.createAnnotation as (
          ...a: [{ kind: AnnotationKind; text: string; anchors: Anchor[]; tags?: string[] }]
        ) => void,
    ),
    addReply: deferred((s) => s.addReply),
    deleteAnnotation: deferred((s) => s.deleteAnnotation),
    deleteReply: deferred((s) => s.deleteReply),
    createCustomKind: deferred((s) => s.createCustomKind as (...a: [RegistryKind]) => void),
    undo: deferred((s) => s.undo),
    redo: deferred((s) => s.redo),
  };
}

// Keep the attribute type referenced for the deferred setFigureAttributes signature.
export type { Attribute };
