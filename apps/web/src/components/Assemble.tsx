// US-018 — Open & view a routine (the Assemble screen). PLAN §4.3, §6.2.
//
// Opens a routine through the store seam (the ONLY way a component reaches
// Automerge/the worker — CLAUDE.md §3, enforced by the store boundary test) and
// renders its sections in order with placement cards (figure name, scope badge,
// attribute summary, alignment chips). Reads are reactive: a synced edit from
// another client re-renders without reload (US-018 AC-2). An offline data state
// is shown honestly rather than presenting stale content as live (AC-3).
//
// US-018 is read-only viewing; section/placement EDITING is US-026/US-027 (those
// describes stay skipped), so no editor controls render here yet — the `role`
// prop is accepted for when they land.

import type { Attribute, FigureDoc, Placement } from "@ballroom/domain";
import { useEffect, useReducer, useState } from "react";
import { openRoutine, type ResolvedPlacement, type RoutineStore } from "../store/routine";
import { Badge, Card, Chip, OfflineState, Spinner } from "../ui";

/** Per-document membership role (NOT an ARIA role). */
export type MembershipRole = "editor" | "commenter" | "viewer";

export interface AssembleProps {
  /** The routine document id to open. */
  routineId: string;
  /** This member's role on the doc (gates editing — US-026+; view is open to all). */
  role: MembershipRole;
  /** Optional connection override; otherwise derived from the store's sync state. */
  connection?: "live" | "offline";
  /** Injectable store for tests; production opens one via `openRoutine(routineId)`. */
  store?: RoutineStore;
}

/**
 * Open (or adopt) a routine store and re-render on every synced/local change.
 * Returns `null` while a real connection is still opening. Skips opening when
 * `enabled` is false (e.g. known-offline — don't connect to show stale data).
 */
function useRoutineStore(
  routineId: string,
  injected: RoutineStore | undefined,
  enabled: boolean,
): RoutineStore | null {
  const [store, setStore] = useState<RoutineStore | null>(injected ?? null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (injected || !enabled) return;
    let live: RoutineStore | null = null;
    let cancelled = false;
    openRoutine(routineId).then((opened) => {
      if (cancelled) {
        opened.close();
        return;
      }
      live = opened;
      setStore(opened);
    });
    return () => {
      cancelled = true;
      live?.close();
    };
  }, [routineId, injected, enabled]);

  // Re-render whenever the (current) store advances.
  useEffect(() => store?.subscribe(bump), [store]);

  return store;
}

export function Assemble({ routineId, role: _role, connection, store: injected }: AssembleProps) {
  const offlineProp = connection === "offline";
  const store = useRoutineStore(routineId, injected, !offlineProp);

  const offline = offlineProp || store?.syncState() === "closed";
  if (offline) return <OfflineState />;
  if (!store) {
    return (
      <div className="flex items-center gap-2 p-6 text-ink-faint" role="status">
        <Spinner /> <span className="text-2xs">Connecting…</span>
      </div>
    );
  }

  const routine = store.readRoutine();
  const figureByPlacement = new Map<string, FigureDoc | null>(
    store.readPlacements().map((rp: ResolvedPlacement) => [rp.placement.id, rp.figure]),
  );
  const syncing = store.syncState() === "connecting";

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{routine.title || "Untitled routine"}</h1>
        {syncing && (
          <span className="flex items-center gap-1 text-2xs text-ink-faint" role="status">
            <Spinner /> Syncing…
          </span>
        )}
      </header>

      {routine.sections.length === 0 ? (
        <p className="text-2xs text-ink-faint">This routine has no sections yet.</p>
      ) : (
        routine.sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-2">
            <h2 className="text-sm font-bold">{section.name}</h2>
            {section.placements.length === 0 ? (
              <p className="text-2xs text-ink-faint">No figures placed in this section.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {section.placements.map((placement) => (
                  <li key={placement.id}>
                    <PlacementCard
                      placement={placement}
                      figure={figureByPlacement.get(placement.id) ?? null}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}

/** One placement → a card: figure name, scope badge, attribute summary, alignment chips. */
function PlacementCard({ placement, figure }: { placement: Placement; figure: FigureDoc | null }) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <span className="font-medium">{figure?.name ?? "Unknown figure"}</span>
        {figure ? <ScopeTag figure={figure} /> : null}
      </div>
      {figure ? (
        <p className="mt-1 text-2xs text-ink-faint">{attributeSummary(figure.attributes)}</p>
      ) : null}
      <AlignmentChips placement={placement} figure={figure} />
    </Card>
  );
}

/** Variant / custom / library tag from the figure's scope + lineage. */
function ScopeTag({ figure }: { figure: FigureDoc }) {
  if (figure.scope === "account") {
    return <Badge tone="accent">{figure.baseFigureRef ? "Variant" : "Custom"}</Badge>;
  }
  return <Badge tone="neutral">Library</Badge>;
}

/** A short human summary of the figure's (live) attributes. */
function attributeSummary(attributes: Attribute[]): string {
  const live = attributes.filter((a) => a.deletedAt == null);
  if (live.length === 0) return "No attributes";
  const kinds = [...new Set(live.map((a) => a.kind))];
  return `${live.length} attribute${live.length === 1 ? "" : "s"} · ${kinds.join(", ")}`;
}

/** Entry/exit + per-placement alignment as chips (read-only here; editing is US-031). */
function AlignmentChips({ placement, figure }: { placement: Placement; figure: FigureDoc | null }) {
  const chips: string[] = [];
  if (figure?.entryAlignment) chips.push(`entry ${figure.entryAlignment.direction}`);
  if (figure?.exitAlignment) chips.push(`exit ${figure.exitAlignment.direction}`);
  if (placement.perPlacementAlignment) {
    chips.push(`here ${placement.perPlacementAlignment.direction}`);
  }
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {chips.map((label) => (
        <Chip key={label} tone="neutral">
          {label}
        </Chip>
      ))}
    </div>
  );
}
