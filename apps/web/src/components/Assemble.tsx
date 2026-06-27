// US-018 — Open & view a routine (the Assemble screen). PLAN §4.3, §6.2.
//
// Opens a routine through the store seam (the ONLY way a component reaches
// Automerge/the worker — CLAUDE.md §3, enforced by the store boundary test) and
// renders its sections in order with placement cards (figure name, scope badge,
// attribute summary, alignment chips). Reads are reactive: a synced edit from
// another client re-renders without reload (US-018 AC-2). An offline data state
// is shown honestly rather than presenting stale content as live (AC-3).
//
// Editing is gated by the `role`/capability table: editors manage sections
// (US-026) and placements (US-027), notate a figure's steps (US-028) and its
// alignment (US-031) via the step sheet, and add figures from the library picker
// (US-027/US-032); viewers/commenters see it all read-only.

import {
  type Alignment,
  type Attribute,
  can,
  type DanceId,
  type FigureDoc,
  libraryFiguresForDance,
  type Placement,
  type Section,
} from "@ballroom/domain";
import { type FormEvent, useCallback, useEffect, useReducer, useState } from "react";
import type { TokenProvider } from "../store/doc-connection";
import { createFamilyNote, type FamilyNote, loadFamilyNotes } from "../store/family-notes";
import { openRoutine, type ResolvedPlacement, type RoutineStore } from "../store/routine";
import {
  Badge,
  Button,
  Card,
  Chip,
  IconButton,
  Input,
  OfflineState,
  Select,
  ShareIcon,
  Sheet,
  Spinner,
  useToast,
} from "../ui";
import { AnnotationPanel } from "./AnnotationPanel";
import { FamilyNotes } from "./FamilyNotes";
import { FigureTimeline } from "./FigureTimeline";
import { RoutineReadingView } from "./RoutineReadingView";
import { Share } from "./Share";

/** Per-document membership role (NOT an ARIA role). */
export type MembershipRole = "editor" | "commenter" | "viewer";

export interface AssembleProps {
  /** The routine document id to open. */
  routineId: string;
  /** This member's role on the doc (gates editing — US-026+; view is open to all). */
  role: MembershipRole;
  /** The viewer's user id — stamps authored annotations + gates author-only reply delete (US-039). */
  currentUserId?: string;
  /** Optional connection override; otherwise derived from the store's sync state. */
  connection?: "live" | "offline";
  /** Injectable store for tests; production opens one via `openRoutine(routineId)`. */
  store?: RoutineStore;
  /** Resolve a fresh auth token per connection-open (#189); the screen wires Clerk. */
  getToken?: TokenProvider;
  /** Fork this routine ("make it your own", US-037). When set, a copy action shows. */
  onFork?: () => void;
  /** A fork is in flight (disables the action + shows a spinner). */
  forking?: boolean;
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
  currentUserId: string | undefined,
  onCopyOnWrite?: (variantRef: string) => void,
): RoutineStore | null {
  const [store, setStore] = useState<RoutineStore | null>(injected ?? null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (injected || !enabled) return;
    let live: RoutineStore | null = null;
    let cancelled = false;
    openRoutine(routineId, { getToken, currentUserId, onCopyOnWrite }).then((opened) => {
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
  }, [routineId, injected, enabled, getToken, currentUserId, onCopyOnWrite]);

  // Re-render whenever the (current) store advances.
  useEffect(() => store?.subscribe(bump), [store]);

  return store;
}

export function Assemble({
  routineId,
  role,
  currentUserId,
  connection,
  store: injected,
  getToken,
  onFork,
  forking,
}: AssembleProps) {
  const offlineProp = connection === "offline";
  // The figureRef whose step timeline is open in the notation sheet (US-028), or null.
  const [notating, setNotating] = useState<string | null>(null);
  // Toast shown when a COW fork happens (US-035): "Copied as your variant".
  const [copiedToast, setCopiedToast] = useState(false);
  // Stable COW callback: re-points notating to the new variant id so the open
  // sheet follows it, and surfaces the "Copied as your variant" status.
  // useCallback with [] is correct — the setX fns from useState are always stable.
  const onCopyOnWrite = useCallback((variantRef: string) => {
    setCopiedToast(true);
    setNotating(variantRef);
  }, []);
  const store = useRoutineStore(
    routineId,
    injected,
    !offlineProp,
    getToken,
    currentUserId,
    onCopyOnWrite,
  );
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
  // "read" lays the whole routine out as a read-only timeline (the payoff view).
  const [mode, setMode] = useState<"edit" | "read">("edit");
  const [pendingDeletePlacement, setPendingDeletePlacement] = useState<{
    sectionId: string;
    placement: Placement;
  } | null>(null);
  const toast = useToast();

  // Family notes (US-040/041) come from the worker (co-member visibility gate),
  // not the routine doc — load them for this routine + reload after authoring one.
  // No-ops without a token (tests / open boundary) → an empty list.
  const [familyNotes, setFamilyNotes] = useState<FamilyNote[]>([]);
  const reloadFamilyNotes = useCallback(async () => {
    if (!getToken) return;
    try {
      setFamilyNotes(await loadFamilyNotes(routineId, await getToken()));
    } catch {
      // Surfacing family notes is best-effort; a failure must not block authoring.
    }
  }, [routineId, getToken]);
  useEffect(() => {
    void reloadFamilyNotes();
  }, [reloadFamilyNotes]);

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
  // The figure whose step timeline is open — re-read live each render so a
  // collaborator's synced attribute edit flows into the open editor (US-018 AC-2).
  const notatingFigure =
    notating !== null
      ? (store.readPlacements().find((rp) => rp.figure?.id === notating)?.figure ?? null)
      : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">{routine.title || "Untitled routine"}</h1>
          {/* Fork lineage as provenance (US-037 AC-3) — surfaced, not pulled-from. */}
          {routine.forkedFromRef && <Badge tone="neutral">Forked copy</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {syncing && (
            <span className="flex items-center gap-1 text-2xs text-ink-faint" role="status">
              <Spinner /> Syncing…
            </span>
          )}
          {/* Per-user undo/redo (US-038): inverts only THIS actor's last change
              (US-010); B's concurrent edit survives. Editor-only. */}
          {canEdit && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  store.undo();
                  toast.show("Undone");
                }}
              >
                Undo
              </Button>
              <Button variant="ghost" size="sm" onClick={() => store.redo()}>
                Redo
              </Button>
            </>
          )}
          {/* Choreo fork (US-037): any member may "make it your own" — the server
              clones it into a new owned, frozen routine. */}
          {onFork && (
            <Button variant="secondary" size="sm" loading={forking} onClick={onFork}>
              Make a copy
            </Button>
          )}
          {/* Read-only timeline payoff view ⇄ the editable list (US-018 reading). */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode(mode === "edit" ? "read" : "edit")}
          >
            {mode === "edit" ? "Reading view" : "List view"}
          </Button>
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

      {/* COW toast: "Copied as your variant" — shown when a non-owned figure edit
          triggers copy-on-write (US-035). role="status" is the E2E observable hook.
          Cleared when the notation Sheet closes. */}
      {copiedToast && (
        <p role="status" className="text-2xs text-accent">
          Copied as your variant
        </p>
      )}

      {/* Share screen: roster + roles, remove (confirmed), invite link (US-024). */}
      <Sheet open={shareOpen} onClose={() => setShareOpen(false)} title="Share this routine">
        <Share docRef={routineId} viewerRole={role} />
      </Sheet>

      {mode === "read" ? (
        <RoutineReadingView routine={routine} placements={store.readPlacements()} />
      ) : (
        <>
          {/* The live section list. data-testid is a stable hook the two-client
          convergence E2E (US-015) asserts on (no role/name ambiguity). */}
          <div data-testid="section-list" className="flex flex-col gap-4">
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
                            onOpen={() => {
                              const f = figureByPlacement.get(placement.id);
                              if (f) setNotating(f.id);
                            }}
                            onDelete={() =>
                              setPendingDeletePlacement({ sectionId: section.id, placement })
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {canEdit && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setAddingFigureTo(section.id)}
                    >
                      Add figure
                    </Button>
                  )}
                </section>
              ))
            )}
          </div>

          {canEdit && <AddSection onAdd={(name) => store.addSection(name)} />}
        </>
      )}

      {/* Add a figure: mints a fresh owned custom figure + a placement (US-027). */}
      <Sheet
        open={addingFigureTo !== null}
        onClose={() => setAddingFigureTo(null)}
        title="Add a figure"
      >
        <AddFigurePicker
          dance={routine.dance as DanceId}
          onAdd={(name, figureType) => {
            if (addingFigureTo) store.addPlacement(addingFigureTo, name, figureType);
            setAddingFigureTo(null);
          }}
        />
      </Sheet>

      {/* Notate a figure (US-028 hero flow): open the figure's step timeline. The
          editor writes to the figure's OWN doc via the store; a viewer sees it
          read-only. Re-reads live so a collaborator's edit flows in. */}
      <Sheet
        open={notating !== null}
        onClose={() => {
          setNotating(null);
          setCopiedToast(false);
        }}
        title={`Steps · ${notatingFigure?.name ?? "Figure"}`}
      >
        {notatingFigure && (
          <div className="flex flex-col gap-4">
            <FigureTimeline
              role={canEdit ? role : "viewer"}
              dance={routine.dance as DanceId}
              attributes={notatingFigure.attributes}
              figureScope={notatingFigure.scope === "global" ? "global" : "owned"}
              onForkIntoVariant={() =>
                store.setFigureAttributes(notatingFigure.id, notatingFigure.attributes)
              }
              onChange={(next) => store.setFigureAttributes(notatingFigure.id, next)}
            />
            {canEdit && (
              <AlignmentEditor
                figure={notatingFigure}
                onSet={(edge, alignment) =>
                  store.setFigureAlignment(notatingFigure.id, edge, alignment)
                }
              />
            )}
            {/* Annotations on this figure (US-039/042): notes/lessons/practice +
                replies, gated by role. Commenter+ may add; viewer is read-only. */}
            <AnnotationPanel
              role={role}
              currentUserId={currentUserId}
              annotations={store
                .readAnnotations()
                .filter((a) =>
                  a.anchors.some(
                    (an) =>
                      (an.type === "figure" || an.type === "point") &&
                      an.figureRef === notatingFigure.id,
                  ),
                )}
              composeAnchor={{ type: "figure", figureRef: notatingFigure.id }}
              figureLabels={{ [notatingFigure.id]: notatingFigure.name }}
              onCreate={({ kind, text }) =>
                store.createAnnotation({
                  kind,
                  text,
                  anchors: [{ type: "figure", figureRef: notatingFigure.id }],
                })
              }
              onReply={(annotationId, text) => store.addReply(annotationId, text)}
              onDeleteReply={(annotationId, replyId) => store.deleteReply(annotationId, replyId)}
            />
            {/* Figure-family notes (US-040/041): "every Feather" notes from this
                routine's members, surfaced on the matching figure; commenter+ may
                author one (server-mediated, co-membership-gated). */}
            <FamilyNotes
              figureType={notatingFigure.figureType}
              dance={routine.dance as DanceId}
              notes={familyNotes}
              canAnnotate={can(role, "canAnnotate")}
              onCreate={async (input) => {
                if (!getToken) return;
                await createFamilyNote(input, await getToken());
                await reloadFamilyNotes();
              }}
            />
          </div>
        )}
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
  onOpen,
  onDelete,
}: {
  placement: Placement;
  figure: FigureDoc | null;
  canEdit?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onMove?: (direction: "up" | "down") => void;
  onOpen?: () => void;
  onDelete?: () => void;
}) {
  const label = figure?.name ?? "Unknown figure";
  return (
    <Card>
      <div className="flex items-center gap-2">
        <span className="font-medium">{label}</span>
        {figure ? <ScopeTag figure={figure} /> : null}
        <div className="ml-auto flex items-center gap-1">
          {/* Open the figure's step timeline — editors notate, others view (US-028). */}
          {figure && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${canEdit ? "Edit" : "View"} steps: ${label}`}
              onClick={onOpen}
            >
              Steps
            </Button>
          )}
          {canEdit && (
            <>
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
            </>
          )}
        </div>
      </div>
      {figure ? (
        <p className="mt-1 text-2xs text-ink-faint">{attributeSummary(figure.attributes)}</p>
      ) : null}
      <AlignmentChips placement={placement} figure={figure} />
    </Card>
  );
}

/**
 * The "Add a figure" picker (US-027 + US-032): browse the dance's library
 * presets (filterable) and tap one to place it with its canonical name +
 * figureType, OR create your own custom figure by name. A preset carries the
 * catalog's figureType (cross-routine identity); a custom omits it.
 */
function AddFigurePicker({
  dance,
  onAdd,
}: {
  dance: DanceId;
  onAdd: (name: string, figureType?: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const q = filter.trim().toLowerCase();
  const presets = libraryFiguresForDance(dance).filter(
    (f) => q === "" || f.name.toLowerCase().includes(q),
  );
  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Filter figures"
        placeholder="Search the library…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {presets.length === 0 ? (
        <p className="text-2xs text-ink-faint">No library figures match — create your own below.</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" aria-label="Library figures">
          {presets.map((f) => (
            <li key={f.figureType}>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => onAdd(f.name, f.figureType)}
              >
                {f.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-2 border-t border-line pt-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const next = name.trim();
          if (!next) return;
          onAdd(next, undefined);
          setName("");
        }}
      >
        <Input
          label="Figure name"
          placeholder="…or create your own"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>
          Add custom
        </Button>
      </form>
    </div>
  );
}

const ALIGNMENT_QUALIFIERS: Alignment["qualifier"][] = ["facing", "backing", "pointing"];
const ALIGNMENT_DIRECTIONS: Alignment["direction"][] = [
  "LOD",
  "ALOD",
  "wall",
  "centre",
  "DW",
  "DC",
  "DW_against",
  "DC_against",
];

/** Edit a figure's entry/exit alignment (US-031): no floor/side model, just the
 *  facing-direction the figure starts and ends on. Editor-only. */
function AlignmentEditor({
  figure,
  onSet,
}: {
  figure: FigureDoc;
  onSet: (edge: "entry" | "exit", alignment: Alignment | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <h3 className="text-sm font-bold text-ink">Alignment</h3>
      <AlignmentEdge
        label="Entry"
        current={figure.entryAlignment ?? null}
        onChange={onSet}
        edge="entry"
      />
      <AlignmentEdge
        label="Exit"
        current={figure.exitAlignment ?? null}
        onChange={onSet}
        edge="exit"
      />
    </div>
  );
}

/** One edge (entry/exit) of the alignment editor: qualifier + direction selects. */
function AlignmentEdge({
  label,
  edge,
  current,
  onChange,
}: {
  label: string;
  edge: "entry" | "exit";
  current: Alignment | null;
  onChange: (edge: "entry" | "exit", alignment: Alignment | null) => void;
}) {
  const qualifier = current?.qualifier ?? "facing";
  const direction = current?.direction ?? "";
  return (
    <fieldset aria-label={`${label} alignment`} className="flex items-end gap-2">
      <Select
        label={`${label} facing`}
        value={qualifier}
        options={ALIGNMENT_QUALIFIERS.map((q) => ({ value: q, label: q }))}
        onChange={(e) =>
          onChange(edge, {
            qualifier: e.target.value as Alignment["qualifier"],
            direction: (direction || "LOD") as Alignment["direction"],
          })
        }
      />
      <Select
        label={`${label} direction`}
        value={direction}
        options={[
          { value: "", label: "— not set" },
          ...ALIGNMENT_DIRECTIONS.map((d) => ({ value: d, label: d })),
        ]}
        onChange={(e) => {
          const d = e.target.value;
          onChange(edge, d ? { qualifier, direction: d as Alignment["direction"] } : null);
        }}
      />
    </fieldset>
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
