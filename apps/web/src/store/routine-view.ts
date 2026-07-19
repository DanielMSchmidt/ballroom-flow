// Read/edit split facade — role-aware hybrid (docs/system/sync-and-offline.md § The read/edit split).
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
import type {
  Anchor,
  AnnotationKind,
  Attribute,
  MediaItem,
  RegistryKind,
} from "@weavesteps/domain";
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
      onCopyOnWriteError: opts.onCopyOnWriteError,
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

  /**
   * A store is EDITABLE when hydrated: "live" (the DO's catch-up applied) or
   * "local" (§11.2 — hydrated from local persistence while disconnected; edits
   * persist and replay on reconnect). "closed"/"connecting" are not editable.
   */
  const editableState = (s: RoutineStore): boolean => {
    const st = s.syncState();
    return st === "live" || st === "local";
  };

  /**
   * Reads come from the live store ONCE it has hydrated, and STAY there (E):
   * we latch on the first hydration and never flip back to the snapshot on a
   * later transient reconnect (live briefly "connecting"). Flipping back would
   * swap the whole routine/figure identity out from under an open editor and
   * revert its content to the (staler) REST snapshot — a visible flicker and a
   * reset of an in-flight edit. Until the first hydration, reads use the snapshot.
   * Hydration counts from EITHER source: the server catch-up ("live") or local
   * persistence ("local", §11.2 — the snapshot fetch fails offline anyway).
   */
  let liveHydratedOnce = false;
  const readSource = (): RoutineStore | RoutineSnapshotModel => {
    if (live && editableState(live)) liveHydratedOnce = true;
    return liveHydratedOnce && live ? live : snapshot;
  };

  /** Run `fn` once the live store is hydrated (live OR local, §11.2) — so an
   *  edit never lands on a pre-replay empty doc, but offline edits still apply. */
  const whenLive = (s: RoutineStore, fn: () => void): void => {
    if (editableState(s)) {
      fn();
      return;
    }
    const unsub = s.subscribe(() => {
      if (editableState(s)) {
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
    // §11.2: undelivered offline changes (routine + figures) — 0 until the live
    // store exists (viewers never edit, so they never have pending changes).
    pendingSyncCount: (): number => (live ? (live.pendingSyncCount?.() ?? 0) : 0),
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
    placeFigure: editAction((s) => s.placeFigure),
    movePlacement: editAction((s) => s.movePlacement),
    deletePlacement: editAction((s) => s.deletePlacement),
    addBreak: editAction((s) => s.addBreak),
    setBreakBeats: editAction((s) => s.setBreakBeats),
    setFigureAttributes: editAction((s) => s.setFigureAttributes),
    setFigureCounts: editAction((s) => s.setFigureCounts),
    renameFigure: editAction((s) => s.renameFigure),
    createAnnotation: editAction<
      [
        {
          kind: AnnotationKind;
          text: string;
          anchors: Anchor[];
          tags?: string[];
          media?: MediaItem[];
        },
      ]
    >((s) => s.createAnnotation),
    addReply: editAction((s) => s.addReply),
    deleteAnnotation: editAction((s) => s.deleteAnnotation),
    deleteReply: editAction((s) => s.deleteReply),
    // Media (docs/ideas/annotation-media-embeds.md): attach/remove are CRDT edits
    // (editActions like the rest); mint/upload are async server round-trips that
    // require the LIVE store (uploads are server-minting — the component gates
    // these behind syncState()==="live" too).
    attachMedia: editAction<[string, MediaItem]>((s) => s.attachMedia),
    removeMedia: editAction<[string, string]>((s) => s.removeMedia),
    mintMediaUpload: async (req) => {
      const s = await ensureLive();
      return s.mintMediaUpload(req);
    },
    uploadMedia: async (uploadUrl, blob, mimeType) => {
      const s = await ensureLive();
      return s.uploadMedia(uploadUrl, blob, mimeType);
    },
    createCustomKind: editAction<[RegistryKind]>((s) => s.createCustomKind),
    // Undo returns the soft "superseded" hint synchronously (US-038 AC-3). The
    // editor toolbar only enables Undo once the live store is hydrated, so the
    // common path forwards to live.undo() and gets the real signal. If undo is
    // somehow invoked pre-hydration, we still defer the action but report the
    // neutral result (nothing reverted yet) rather than blocking.
    undo: (): UndoResult => {
      const neutral: UndoResult = { undone: false, supersededByOthers: false };
      if (!editable) return neutral;
      if (live && editableState(live)) return live.undo();
      void ensureLive().then((s) => whenLive(s, () => s.undo()));
      return neutral;
    },
    redo: editAction((s) => s.redo),
    // Figure-scoped undo/redo (§5.4, "undo follows the surface being edited"):
    // same live-gating as `undo`/`redo` above — the editor only enables the figure
    // Undo once the live store is hydrated, so the common path forwards to
    // live.undoFigure() and gets the real superseded signal; a pre-hydration press
    // still defers the action and reports the neutral (nothing-reverted) result.
    undoFigure: (figureRef): UndoResult => {
      const neutral: UndoResult = { undone: false, supersededByOthers: false };
      if (!editable) return neutral;
      if (live && editableState(live)) return live.undoFigure(figureRef);
      void ensureLive().then((s) => whenLive(s, () => s.undoFigure(figureRef)));
      return neutral;
    },
    redoFigure: editAction((s) => s.redoFigure),
  };
}

// Keep the attribute type referenced for the deferred setFigureAttributes signature.
export type { Attribute };
