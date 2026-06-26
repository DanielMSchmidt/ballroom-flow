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

import {
  type Attribute,
  can,
  type FigureDoc,
  type Placement,
  type Section,
} from "@ballroom/domain";
import { type FormEvent, useEffect, useReducer, useState } from "react";
import type { TokenProvider } from "../store/doc-connection";
import { openRoutine, type ResolvedPlacement, type RoutineStore } from "../store/routine";
import {
  Badge,
  Button,
  Card,
  Chip,
  IconButton,
  Input,
  OfflineState,
  ShareIcon,
  Sheet,
  Spinner,
} from "../ui";
import { Share } from "./Share";

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
  /** Resolve a fresh auth token per connection-open (#189); the screen wires Clerk. */
  getToken?: TokenProvider;
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
  getToken: TokenProvider | undefined,
): RoutineStore | null {
  const [store, setStore] = useState<RoutineStore | null>(injected ?? null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (injected || !enabled) return;
    let live: RoutineStore | null = null;
    let cancelled = false;
    openRoutine(routineId, { getToken }).then((opened) => {
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
  }, [routineId, injected, enabled, getToken]);

  // Re-render whenever the (current) store advances.
  useEffect(() => store?.subscribe(bump), [store]);

  return store;
}

export function Assemble({
  routineId,
  role,
  connection,
  store: injected,
  getToken,
}: AssembleProps) {
  const offlineProp = connection === "offline";
  const store = useRoutineStore(routineId, injected, !offlineProp, getToken);
  // Section management is editor-only — gated on the SHARED capability table, not
  // an ad-hoc role check, so the UI and the DO boundary agree (#169, principle #26).
  // Also require the doc to be hydrated ("live" — the DO's catch-up has arrived):
  // editing an as-yet-unsynced (empty A.init) doc would push onto a missing
  // `sections` list and be lost on merge, so we wait for the seed to land.
  const canEdit = can(role, "canEdit") && store?.syncState() === "live";
  // Sharing (invite/remove) is an editor/owner capability — gated on the SHARED
  // table (principle #26); the worker still enforces it server-side (US-024).
  const canShare = can(role, "canInvite");
  const [shareOpen, setShareOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Section | null>(null);
  const [addingFigureTo, setAddingFigureTo] = useState<string | null>(null);
  const [pendingDeletePlacement, setPendingDeletePlacement] = useState<{
    sectionId: string;
    placement: Placement;
  } | null>(null);

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
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">{routine.title || "Untitled routine"}</h1>
        <div className="flex items-center gap-2">
          {syncing && (
            <span className="flex items-center gap-1 text-2xs text-ink-faint" role="status">
              <Spinner /> Syncing…
            </span>
          )}
          {canShare && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShareOpen(true)}
              leadingIcon={<ShareIcon size={16} />}
            >
              Share
            </Button>
          )}
        </div>
      </header>

      {/* Share screen: roster + roles, remove (confirmed), invite link (US-024). */}
      <Sheet open={shareOpen} onClose={() => setShareOpen(false)} title="Share this routine">
        <Share docRef={routineId} viewerRole={role} />
      </Sheet>

      {routine.sections.length === 0 ? (
        <p className="text-2xs text-ink-faint">This routine has no sections yet.</p>
      ) : (
        routine.sections.map((section, index) => (
          <section key={section.id} className="flex flex-col gap-2">
            <SectionHeader
              section={section}
              canEdit={canEdit}
              isFirst={index === 0}
              isLast={index === routine.sections.length - 1}
              onRename={(name) => store.renameSection(section.id, name)}
              onMove={(dir) => store.moveSection(section.id, dir)}
              onDelete={() => setPendingDelete(section)}
            />
            {section.placements.length === 0 ? (
              <p className="text-2xs text-ink-faint">No figures placed in this section.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {section.placements.map((placement, pIndex) => (
                  <li key={placement.id}>
                    <PlacementCard
                      placement={placement}
                      figure={figureByPlacement.get(placement.id) ?? null}
                      canEdit={canEdit}
                      isFirst={pIndex === 0}
                      isLast={pIndex === section.placements.length - 1}
                      onMove={(dir) => store.movePlacement(section.id, placement.id, dir)}
                      onDelete={() =>
                        setPendingDeletePlacement({ sectionId: section.id, placement })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <Button variant="secondary" size="sm" onClick={() => setAddingFigureTo(section.id)}>
                Add figure
              </Button>
            )}
          </section>
        ))
      )}

      {canEdit && <AddSection onAdd={(name) => store.addSection(name)} />}

      {/* Add a figure: mints a fresh owned custom figure + a placement (US-027). */}
      <Sheet
        open={addingFigureTo !== null}
        onClose={() => setAddingFigureTo(null)}
        title="Add a figure"
      >
        <AddFigureForm
          onAdd={(name) => {
            if (addingFigureTo) store.addPlacement(addingFigureTo, name);
            setAddingFigureTo(null);
          }}
        />
      </Sheet>

      {/* Placement delete confirm (principle #28); soft-delete tombstone. */}
      <Sheet
        open={pendingDeletePlacement !== null}
        onClose={() => setPendingDeletePlacement(null)}
        title="Remove figure?"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-secondary">
            This figure will be removed from the section. You can still recover it from history.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingDeletePlacement(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDeletePlacement) {
                  store.deletePlacement(
                    pendingDeletePlacement.sectionId,
                    pendingDeletePlacement.placement.id,
                  );
                }
                setPendingDeletePlacement(null);
              }}
            >
              Remove figure
            </Button>
          </div>
        </div>
      </Sheet>

      {/* Destructive actions confirm (principle #28); soft-delete tombstone. */}
      <Sheet
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete section?"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-secondary">
            "{pendingDelete?.name}" and its placements will be removed from this routine. You can
            still recover it from history.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete) store.deleteSection(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete section
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

/** A section's heading with editor management (rename inline, move up/down, delete). */
function SectionHeader({
  section,
  canEdit,
  isFirst,
  isLast,
  onRename,
  onMove,
  onDelete,
}: {
  section: Section;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section.name);

  if (renaming) {
    return (
      <form
        className="flex items-end gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const next = name.trim();
          if (next) onRename(next);
          setRenaming(false);
        }}
      >
        <Input
          label="Section name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Button type="submit" variant="primary" size="sm">
          Save
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-bold">{section.name}</h2>
      {canEdit && (
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Rename ${section.name}`}
            onClick={() => setRenaming(true)}
          >
            Rename
          </Button>
          <IconButton
            label={`Move ${section.name} up`}
            disabled={isFirst}
            onClick={() => onMove("up")}
          >
            ↑
          </IconButton>
          <IconButton
            label={`Move ${section.name} down`}
            disabled={isLast}
            onClick={() => onMove("down")}
          >
            ↓
          </IconButton>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete ${section.name}`}
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}

/** The add-section affordance: a button that reveals a name input. */
function AddSection({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add section
      </Button>
    );
  }
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const next = name.trim();
        if (!next) return;
        onAdd(next);
        setName("");
        setOpen(false);
      }}
    >
      <Input
        label="Section name"
        placeholder="e.g. Intro"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>
        Add
      </Button>
    </form>
  );
}

/** One placement → a card: figure name, scope badge, attribute summary, alignment chips. */
function PlacementCard({
  placement,
  figure,
  canEdit = false,
  isFirst = false,
  isLast = false,
  onMove,
  onDelete,
}: {
  placement: Placement;
  figure: FigureDoc | null;
  canEdit?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onMove?: (direction: "up" | "down") => void;
  onDelete?: () => void;
}) {
  const label = figure?.name ?? "Unknown figure";
  return (
    <Card>
      <div className="flex items-center gap-2">
        <span className="font-medium">{label}</span>
        {figure ? <ScopeTag figure={figure} /> : null}
        {canEdit && (
          <div className="ml-auto flex items-center gap-1">
            <IconButton
              label={`Move ${label} up`}
              disabled={isFirst}
              onClick={() => onMove?.("up")}
            >
              ↑
            </IconButton>
            <IconButton
              label={`Move ${label} down`}
              disabled={isLast}
              onClick={() => onMove?.("down")}
            >
              ↓
            </IconButton>
            <Button variant="ghost" size="sm" aria-label={`Remove ${label}`} onClick={onDelete}>
              Remove
            </Button>
          </div>
        )}
      </div>
      {figure ? (
        <p className="mt-1 text-2xs text-ink-faint">{attributeSummary(figure.attributes)}</p>
      ) : null}
      <AlignmentChips placement={placement} figure={figure} />
    </Card>
  );
}

/** The add-figure form inside the "Add a figure" sheet: a name → a new figure. */
function AddFigureForm({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const next = name.trim();
        if (!next) return;
        onAdd(next);
        setName("");
      }}
    >
      <Input
        label="Figure name"
        placeholder="e.g. Feather Step"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Button type="submit" variant="primary" disabled={!name.trim()}>
        Add
      </Button>
    </form>
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
