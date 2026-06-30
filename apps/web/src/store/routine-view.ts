// Read/edit split facade — role-aware hybrid (PLAN §6, extends D10).
//
// The cost we cut is the per-document WebSocket fan-out for the common READ path,
// WITHOUT giving up live collaboration (US-015):
//
//  • Viewers (read-only) open ZERO WebSockets — a single REST snapshot + light
//    polling + refetch-on-focus.
//  • Editors/owners/commenters open ONE live routine WS immediately (so a
//    collaborator's section/placement/annotation edits converge LIVE), but
//    figures still render from the snapshot — a figure's OWN socket opens only
//    when its step editor is opened (`openFigure`) or it's edited. This removes
//    the eager per-figure fan-out (the bulk of the sockets) for everyone.
//
// The facade implements the full `RoutineStore` surface so screens consume it
// unchanged. In editable mode reads come from the snapshot until the live store
// hydrates, then from the live store (which itself falls back to the snapshot for
// not-yet-opened figures). In read-only mode mutators + openFigure are no-ops
// (the UI never calls them for a viewer) and nothing live is ever opened.
import type { Alignment, Anchor, AnnotationKind, Attribute, RegistryKind } from "@ballroom/domain";
import type { SyncState } from "./doc-connection";
import {
  openRoutine as defaultOpenRoutine,
  type OpenOptions,
  type ResolvedPlacement,
  type RoutineStore,
  type UndoResult,
} from "./routine";
import {
  openRoutineSnapshot as defaultOpenSnapshot,
  type OpenSnapshotOptions,
  type RoutineSnapshotModel,
} from "./routine-snapshot";

export interface OpenViewOptions extends OpenOptions {
  /**
   * Whether the viewer can edit (editor/owner/commenter). True → open ONE live
   * routine WS for live convergence (figures stay lazy). False (default) → pure
   * read-only snapshot, zero WebSockets.
   */
  editable?: boolean;
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
 * Open a routine through the read/edit hybrid. Returns a `RoutineStore` facade so
 * the screen is agnostic to whether it's reading a snapshot or editing live.
 */
export function openRoutineView(routineId: string, opts: OpenViewOptions = {}): RoutineStore {
  const openLive = opts.openLive ?? defaultOpenRoutine;
  const openSnapshot = opts.openSnapshot ?? defaultOpenSnapshot;
  const editable = opts.editable ?? false;

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

  /** Open the live routine WS once (idempotent), in LAZY figure mode (figures come
   *  from the snapshot until opened/edited). Wires its changes into our listeners. */
  const ensureLive = (): Promise<RoutineStore> => {
    if (livePromise) return livePromise;
    livePromise = openLive(routineId, {
      baseUrl: opts.baseUrl,
      openSocket: opts.openSocket,
      actor: opts.actor,
      currentUserId: opts.currentUserId,
      createFigure: opts.createFigure,
      getToken: opts.getToken,
      accountKinds: opts.accountKinds,
      saveCustomKind: opts.saveCustomKind,
      onCopyOnWrite: opts.onCopyOnWrite,
      eagerFigures: false,
      figureContent: (ref) => snapshot.figureFor(ref),
      // Forward the figure-load-robustness knobs (#94) so an OPENED figure still
      // reconnects, times out → retryable error, and resolves missing-vs-error via
      // the access preflight — the hybrid only changes WHEN a figure connects.
      reconnect: opts.reconnect,
      hydrationTimeoutMs: opts.hydrationTimeoutMs,
      checkAccess: opts.checkAccess,
      schedule: opts.schedule,
      cancel: opts.cancel,
    }).then((s) => {
      if (closed) {
        s.close();
        return s;
      }
      live = s;
      s.subscribe(notify);
      notify();
      return s;
    });
    return livePromise;
  };

  // Editors go live immediately so a collaborator's edits converge without an
  // edit-first poke; viewers never open a socket.
  if (editable) void ensureLive();

  /** Reads come from the live store ONLY once it's hydrated; otherwise the snapshot. */
  const readSource = (): RoutineStore | RoutineSnapshotModel =>
    live && live.syncState() === "live" ? live : snapshot;

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

  /** A mutator that applies on the live store once hydrated; a no-op for viewers. */
  const editAction =
    <A extends unknown[]>(pick: (s: RoutineStore) => (...a: A) => void) =>
    (...args: A): void => {
      if (!editable) return; // viewers can't edit (UI gates this too)
      void ensureLive().then((s) => whenLive(s, () => pick(s)(...args)));
    };

  return {
    // ── reads (snapshot until live is hydrated, then live) ──────────────────
    readPlacements: (): ResolvedPlacement[] => readSource().readPlacements(),
    readRoutine: () => readSource().readRoutine(),
    readAnnotations: () => readSource().readAnnotations(),
    customKinds: (): RegistryKind[] => readSource().customKinds(),
    // Editors gate editing on the LIVE store's readiness (so canEdit never goes
    // true before the live doc is hydrated); reads still come from the snapshot
    // meanwhile (readSource). Viewers track the snapshot's lifecycle.
    syncState: (): SyncState =>
      editable ? (live ? live.syncState() : "connecting") : snapshot.syncState(),
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

    // Open a figure's own live connection while its editor is open (lazy figures).
    openFigure: (figureRef) => {
      if (!editable) return; // a viewer reads figure content from the snapshot
      void ensureLive().then((s) => s.openFigure(figureRef));
    },

    // Retry a figure that surfaced as error/missing: an editor re-opens its live
    // connection; a viewer just re-fetches the snapshot (its only figure source).
    retryFigure: (figureRef) => {
      if (editable) {
        void ensureLive().then((s) => s.retryFigure(figureRef));
      } else {
        snapshot.refetch();
      }
    },

    // ── mutators (apply on the live routine WS once hydrated) ────────────────
    addSection: editAction((s) => s.addSection),
    renameSection: editAction((s) => s.renameSection),
    moveSection: editAction((s) => s.moveSection),
    deleteSection: editAction((s) => s.deleteSection),
    addPlacement: editAction((s) => s.addPlacement),
    movePlacement: editAction((s) => s.movePlacement),
    deletePlacement: editAction((s) => s.deletePlacement),
    setFigureAttributes: editAction((s) => s.setFigureAttributes),
    setFigureAlignment: editAction(
      (s) => s.setFigureAlignment as (...a: [string, "entry" | "exit", Alignment | null]) => void,
    ),
    createAnnotation: editAction(
      (s) =>
        s.createAnnotation as (
          ...a: [{ kind: AnnotationKind; text: string; anchors: Anchor[]; tags?: string[] }]
        ) => void,
    ),
    addReply: editAction((s) => s.addReply),
    deleteAnnotation: editAction((s) => s.deleteAnnotation),
    deleteReply: editAction((s) => s.deleteReply),
    createCustomKind: editAction((s) => s.createCustomKind as (...a: [RegistryKind]) => void),
    // Undo returns the soft "superseded" hint synchronously (US-038 AC-3). The
    // editor toolbar only enables Undo once the live store is hydrated, so the
    // common path forwards to live.undo() and gets the real signal. If undo is
    // somehow invoked pre-hydration, we still defer the action but report the
    // neutral result (nothing reverted yet) rather than blocking.
    undo: (): UndoResult => {
      const neutral: UndoResult = { undone: false, supersededByOthers: false };
      if (!editable) return neutral;
      if (live && live.syncState() === "live") return live.undo();
      void ensureLive().then((s) => whenLive(s, () => s.undo()));
      return neutral;
    },
    redo: editAction((s) => s.redo),
  };
}

// Keep the attribute type referenced for the deferred setFigureAttributes signature.
export type { Attribute };
