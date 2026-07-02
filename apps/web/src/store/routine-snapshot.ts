// Read-only snapshot model (the read/edit split — PLAN §6, extends D10).
//
// Opening a routine to *read* it (the common case) shouldn't cost one live
// WebSocket per routine + per figure. This model hydrates the whole routine + its
// figures from ONE REST read (`GET /api/routines/:id/snapshot`, figures already
// resolved server-side) and keeps it reasonably fresh with light polling +
// refetch-on-focus — NO WebSockets, no per-figure connections. It exposes the
// same read surface as the live store (`RoutineReadModel`), so a screen swaps
// the cheap snapshot in for reading and upgrades to the live `RoutineStore` only
// when the user actually edits. The live WS sync stays the edit path.
import {
  type Annotation,
  CURRENT_SCHEMA_VERSION,
  defaultFigureBars,
  type FigureDoc,
  isReservedKind,
  libraryFigureByRef,
  type RegistryKind,
  type RoutineDoc,
  resolveFigure as resolveVariantOverlay,
} from "@ballroom/domain";
import { apiGet } from "../lib/rpc";
import type { TokenProvider } from "./doc-connection";
import type { FigureLoadStatus, ResolvedPlacement, RoutineReadModel } from "./routine";

/** The shape returned by `GET /api/routines/:id/snapshot`. */
export interface RoutineSnapshot {
  routine: RoutineDoc;
  /** Referenced figures, keyed by figureRef. A variant carries only its OWNED beats
   *  (⟳v5) — the client resolves it against its base below. */
  figures: Record<string, FigureDoc>;
  /** Live BASES each variant resolves against (⟳v5, §5.2), keyed by baseFigureRef —
   *  fanned out server-side so the client can fill a variant's untouched beats.
   *  Optional for back-compat with an older worker that didn't send it. */
  bases?: Record<string, FigureDoc>;
}

/**
 * Resolve a snapshot figure to its effective content (⟳v5, §5.2). A VARIANT
 * (non-null `baseFigureRef`) resolves per-beat against its base — from the fanned-out
 * `bases`, another placed figure, or the bundled catalog fallback (always available
 * for a `global:` base). A standalone figure resolves to itself.
 */
function resolveSnapshotFigure(fig: FigureDoc, snap: RoutineSnapshot): FigureDoc {
  if (!fig.baseFigureRef) return fig;
  const liveBase = snap.bases?.[fig.baseFigureRef] ?? snap.figures[fig.baseFigureRef];
  if (liveBase) return resolveVariantOverlay(liveBase, fig);
  const cat = libraryFigureByRef(fig.baseFigureRef);
  if (cat) {
    return resolveVariantOverlay(
      {
        attributes: cat.attributes ?? [],
        ...(cat.entryAlignment ? { entryAlignment: cat.entryAlignment } : {}),
        ...(cat.exitAlignment ? { exitAlignment: cat.exitAlignment } : {}),
      },
      fig,
    );
  }
  return fig; // base unavailable → the variant's own (owned) beats
}

/**
 * A full FigureDoc synthesized from the bundled catalog for a `global:` ref (⟳v5,
 * §4.3) — so a live catalog reference renders PRE-FILLED even if the snapshot
 * hasn't caught it yet (a freshly-added placement before the next refetch). Null
 * for a non-catalog ref (a real account/custom figure loads from the snapshot).
 */
function catalogSnapshotFigure(ref: string): FigureDoc | null {
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
    bars: defaultFigureBars(attributes, cat.dance),
    attributes,
    ...(cat.entryAlignment ? { entryAlignment: cat.entryAlignment } : {}),
    ...(cat.exitAlignment ? { exitAlignment: cat.exitAlignment } : {}),
    schemaVersion: 1,
    deletedAt: null,
  };
}

/** A read model that can also be told to refetch now (e.g. after an edit upgrade). */
export interface RoutineSnapshotModel extends RoutineReadModel {
  /** Force an immediate refetch of the snapshot. */
  refetch(): void;
  /** The (already-resolved) figure for a ref, or null — the live store's lazy
   *  figure-content fallback in the read/edit hybrid. */
  figureFor(figureRef: string): FigureDoc | null;
}

export interface OpenSnapshotOptions {
  /** Base URL of the worker (default: same-origin). */
  baseUrl?: string;
  /** Fresh Clerk token per request (the snapshot endpoint is auth-gated). */
  getToken?: TokenProvider;
  /** The caller's account-wide custom kinds, merged into customKinds() (US-043). */
  accountKinds?: RegistryKind[];
  /** Fetch the snapshot (default: GET the snapshot endpoint). Injected for tests. */
  fetchSnapshot?: (routineId: string) => Promise<RoutineSnapshot>;
  /** Poll interval (ms) while open; 0 disables. Default 20000 (light freshness). */
  pollMs?: number;
  /** Schedule a repeating timer (default: setInterval) — injected for tests. */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** Cancel a repeating timer (default: clearInterval) — injected for tests. */
  cancel?: (handle: ReturnType<typeof setInterval>) => void;
  /** Register a refetch-on-focus hook; returns an unsubscribe. Default: window
   *  focus + document visibility listeners. Pass a no-op in tests/SSR. */
  onFocusRefetch?: (refetch: () => void) => () => void;
}

import type { SyncState } from "./doc-connection";

/** An empty routine placeholder shown until the first snapshot arrives. */
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

/** Default focus/visibility refetch: refetch when the tab regains focus. */
function defaultFocusRefetch(refetch: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const onFocus = () => refetch();
  const onVisible = () => {
    if (document.visibilityState === "visible") refetch();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/**
 * Open a routine in READ-ONLY snapshot mode: one REST hydrate + light polling,
 * zero WebSockets. Returns immediately (syncState "connecting" until the first
 * snapshot lands), mirroring the live store's lifecycle so the screen's loading
 * indicator works unchanged.
 */
export function openRoutineSnapshot(
  routineId: string,
  opts: OpenSnapshotOptions = {},
): RoutineSnapshotModel {
  const baseUrl =
    opts.baseUrl ?? (typeof location !== "undefined" ? location.origin : "http://localhost");
  const getToken = opts.getToken;
  const accountKinds = [...(opts.accountKinds ?? [])];
  const pollMs = opts.pollMs ?? 20_000;
  const schedule = opts.schedule ?? ((fn, ms) => setInterval(fn, ms));
  const cancel = opts.cancel ?? ((h) => clearInterval(h));
  const onFocusRefetch = opts.onFocusRefetch ?? defaultFocusRefetch;
  const fetchSnapshot: (id: string) => Promise<RoutineSnapshot> =
    opts.fetchSnapshot ??
    (async (id) => {
      const token = getToken ? await getToken() : null;
      return apiGet<RoutineSnapshot>(
        `${baseUrl}/api/routines/${encodeURIComponent(id)}/snapshot`,
        token,
      );
    });

  let snapshot: RoutineSnapshot | null = null;
  let state: SyncState = "connecting";
  let closed = false;
  let inFlight = false;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const fn of listeners) fn();
  };

  const load = (): void => {
    if (closed || inFlight) return; // one request at a time; refetch coalesces
    inFlight = true;
    void fetchSnapshot(routineId)
      .then((data) => {
        if (closed) return;
        snapshot = data;
        state = "live";
        notify();
      })
      .catch(() => {
        // Keep the last good snapshot (stale-but-usable). Only surface "closed"
        // (offline) if we never loaded one — otherwise reads keep working.
        if (closed) return;
        if (!snapshot) state = "closed";
        notify();
      })
      .finally(() => {
        inFlight = false;
      });
  };

  // First hydrate + light polling + refetch-on-focus.
  load();
  const timer = pollMs > 0 ? schedule(load, pollMs) : null;
  const unsubscribeFocus = onFocusRefetch(load);

  const currentRoutine = (): RoutineDoc => snapshot?.routine ?? emptyRoutine(routineId);

  // Referential stability (A): the snapshot object is replaced wholesale on each
  // poll/refetch (`load`), so reuse the prior placements array while it's the same
  // snapshot — an unchanged snapshot then hands consumers a STABLE array identity
  // instead of a fresh one on every read.
  let placementsCache: { snapshot: RoutineSnapshot | null; value: ResolvedPlacement[] } | null =
    null;

  const model: RoutineSnapshotModel = {
    readRoutine: currentRoutine,
    readPlacements: () => {
      if (placementsCache && placementsCache.snapshot === snapshot) return placementsCache.value;
      const routine = currentRoutine();
      const snap = snapshot;
      const figures = snap?.figures ?? {};
      const out: ResolvedPlacement[] = [];
      for (const section of routine.sections) {
        for (const placement of section.placements) {
          // A break has no figure to resolve — it's read structurally (US-004a).
          if (placement.source === "break" || !placement.figureRef) continue;
          const raw = figures[placement.figureRef] ?? null;
          // ⟳v5: a variant carries only its owned beats — resolve it per-beat against
          // its live base (fanned-out `bases` / bundled catalog fallback). A catalog
          // reference points directly at the global doc (present in `figures`), so it
          // resolves to itself. A ref absent from the snapshot that IS a `global:`
          // catalog ref still renders from the bundle (pre-filled, §4.3).
          const figure = raw
            ? resolveSnapshotFigure(raw, snap as RoutineSnapshot)
            : (catalogSnapshotFigure(placement.figureRef) ?? null);
          // present → live; absent → genuinely missing (deleted / no access). Before
          // the first snapshot lands the whole view reads "connecting" (syncState).
          const status: FigureLoadStatus = figure ? "live" : snap ? "missing" : "loading";
          // A REST snapshot figure is NEVER served by its own live doc — the editor
          // gates on this to wait for the live figure connection ("load on open").
          out.push({ placement, figure, status, fromLiveDoc: false });
        }
      }
      placementsCache = { snapshot, value: out };
      return out;
    },
    readAnnotations: () => currentRoutine().annotations,
    customKinds: () => {
      const routineKinds = currentRoutine().customKinds ?? [];
      const bySlug = new Map<string, RegistryKind>();
      for (const k of accountKinds) bySlug.set(k.kind, k);
      for (const k of routineKinds) bySlug.set(k.kind, k); // routine-embedded wins
      return [...bySlug.values()].filter((k) => !isReservedKind(k.kind));
    },
    syncState: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // The RAW figure (a variant still carries only its owned beats) OR a fanned-out
    // BASE — the live store's lazy `figureContent` fallback uses this both for a
    // placed figure and to resolve its base (⟳v5). The live store does its own
    // overlay resolution, so this must NOT pre-resolve.
    figureFor: (figureRef) => snapshot?.figures[figureRef] ?? snapshot?.bases?.[figureRef] ?? null,
    refetch: load,
    close: () => {
      closed = true;
      if (timer != null) cancel(timer);
      unsubscribeFocus();
      listeners.clear();
    },
  };

  return model;
}

// Re-exported for callers that only need the annotation type alongside the model.
export type { Annotation };
