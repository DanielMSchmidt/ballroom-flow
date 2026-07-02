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
  type FigureDoc,
  isReservedKind,
  type RegistryKind,
  type RoutineDoc,
} from "@ballroom/domain";
import { apiGet } from "../lib/rpc";
import type { TokenProvider } from "./doc-connection";
import type { FigureLoadStatus, ResolvedPlacement, RoutineReadModel } from "./routine";

/** The shape returned by `GET /api/routines/:id/snapshot`. */
export interface RoutineSnapshot {
  routine: RoutineDoc;
  /** Referenced figures, keyed by figureRef, variant overlays already resolved. */
  figures: Record<string, FigureDoc>;
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
      const figures = snapshot?.figures ?? {};
      const out: ResolvedPlacement[] = [];
      for (const section of routine.sections) {
        for (const placement of section.placements) {
          // A break has no figure to resolve — it's read structurally (US-004a).
          if (placement.source === "break" || !placement.figureRef) continue;
          const figure = figures[placement.figureRef] ?? null;
          // The snapshot resolves every referenced figure server-side: present →
          // live; absent → genuinely missing (deleted / no access). Before the
          // first snapshot lands the whole view reads "connecting" (syncState).
          const status: FigureLoadStatus = figure ? "live" : snapshot ? "missing" : "loading";
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
    figureFor: (figureRef) => snapshot?.figures[figureRef] ?? null,
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
