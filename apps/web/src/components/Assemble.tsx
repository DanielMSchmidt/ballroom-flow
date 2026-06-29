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
  barsForFigure,
  can,
  countLabel,
  type DanceId,
  type FigureDoc,
  figureMatchesLibraryOrigin,
  libraryFiguresForDance,
  type Placement,
  type RegistryKind,
  type Section,
} from "@ballroom/domain";
import { type FormEvent, useCallback, useEffect, useReducer, useState } from "react";
import { listAccountKinds } from "../store/custom-kinds";
import type { TokenProvider } from "../store/doc-connection";
import { createFamilyNote, type FamilyNote, loadFamilyNotes } from "../store/family-notes";
import type { FigureLoadStatus, ResolvedPlacement, RoutineStore } from "../store/routine";
import { openRoutineView } from "../store/routine-view";
import {
  Button,
  Card,
  ChevronDownIcon,
  ChevronRightIcon,
  Chip,
  CountPill,
  EditIcon,
  IconButton,
  Input,
  kindVar,
  OfflineState,
  ScreenHeader,
  Select,
  ShareIcon,
  Sheet,
  Skeleton,
  Spinner,
  useToast,
} from "../ui";
import { AddKindSheet } from "./AddKindSheet";
import { AnnotationPanel } from "./AnnotationPanel";
import { FamilyNotes } from "./FamilyNotes";
import { FigureTimeline } from "./FigureTimeline";
import { Lanes } from "./Lanes";
import { RoutineReadingView } from "./RoutineReadingView";
import { useStoredRoleView } from "./reading-columns-role";
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
  /** Back out to the routine list (the ScreenHeader ‹ control). */
  onBack?: () => void;
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
  editable: boolean,
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
    const doOpen = async () => {
      // Fetch account-wide custom kinds for cross-routine reuse (US-043 AC-2).
      // Best-effort: a failure must never block the routine open.
      let accountKinds: RegistryKind[] = [];
      if (getToken) {
        try {
          const token = await getToken();
          accountKinds = await listAccountKinds(token);
        } catch {
          // Non-blocking; reload-persistence works via the routine-embedded copy.
        }
      }
      if (cancelled) return;
      // Read/edit split: open in read-only snapshot mode (one REST read, zero
      // WebSockets). The facade upgrades to the live WS store lazily, only when
      // the user actually edits — so reading a routine (the common case) never
      // opens a socket. A viewer never triggers the upgrade (the UI gates edits).
      const opened = openRoutineView(routineId, {
        editable,
        getToken,
        currentUserId,
        accountKinds,
        onCopyOnWrite,
        // Escalate a figure that hasn't hydrated within ~12s to a retryable error
        // (with a Retry affordance) so it's never a forever skeleton; reconnect +
        // the access preflight then settle it on live / error / missing.
        hydrationTimeoutMs: 12_000,
      });
      if (cancelled) {
        opened.close();
        return;
      }
      live = opened;
      setStore(opened);
    };
    void doOpen();
    return () => {
      cancelled = true;
      live?.close();
    };
  }, [routineId, injected, enabled, editable, getToken, currentUserId, onCopyOnWrite]);

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
  onBack,
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
  // Editable = can write to the routine doc (editor/owner edits, or commenter
  // annotations). Drives the read/edit split: editable opens ONE live routine WS
  // for live convergence; a pure viewer stays on the zero-socket snapshot.
  const editable = can(role, "canEdit") || can(role, "canAnnotate");
  const store = useRoutineStore(
    routineId,
    injected,
    !offlineProp,
    editable,
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
  // Custom-kind sheet (US-043) + Lanes view (US-044) — local to the notation panel.
  // (`notating` itself is declared above, alongside the copy-on-write handler.)
  const [addKindOpen, setAddKindOpen] = useState(false);
  const [lanesOpen, setLanesOpen] = useState(false);
  // "read" lays the whole routine out as the clean read-only programme (frame
  // 1.6); "edit" is the section/figure builder (frames 1.7–1.9).
  const [mode, setMode] = useState<"edit" | "read">("edit");
  // The Leader/Follower lens for the reading view — persisted across routines.
  const [roleView, setRoleView] = useStoredRoleView();
  // Which sections are collapsed in the editing view (frame 1.9: ▾/▸).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = useCallback((sectionId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);
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

  // Read/edit split: opening a figure's step editor connects THAT figure's own
  // live WS (lazy figures) so its notation converges while open; until then it
  // rendered from the routine snapshot. No-op for viewers / already-open figures.
  useEffect(() => {
    if (notating && store) store.openFigure(notating);
  }, [notating, store]);

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
  const resolvedByPlacement = new Map<string, ResolvedPlacement>(
    store.readPlacements().map((rp: ResolvedPlacement) => [rp.placement.id, rp]),
  );
  const syncing = store.syncState() === "connecting";
  // The figure whose step timeline is open — re-read live each render so a
  // collaborator's synced attribute edit flows into the open editor (US-018 AC-2).
  const notatingFigure =
    notating !== null
      ? (store.readPlacements().find((rp) => rp.figure?.id === notating)?.figure ?? null)
      : null;

  const modeLabel = mode === "read" ? "reading" : "editing";
  return (
    <div className="flex flex-col">
      {/* Compact per-screen header (frame 1.6/1.7): ‹ back · title · mode ·
          ✎ toggle (+ ↗ Share in reading). Undo/Redo/Make-a-copy live below in
          the editing toolbar — the reading lens stays the clean programme. */}
      <ScreenHeader
        title={routine.title || "Untitled routine"}
        // Fork lineage as provenance (US-037 AC-3) — surfaced, not pulled-from.
        subtitle={routine.forkedFromRef ? `${modeLabel} · forked copy` : modeLabel}
        onBack={onBack}
        backLabel="All routines"
        actions={
          <>
            {/* Read ⇄ edit lens toggle. In editing the ✎ is active/filled; in
                reading it's plain. Labels stay "Reading view"/"List view" so the
                action names survive across the redesign. */}
            <IconButton
              label={mode === "edit" ? "Reading view" : "List view"}
              variant={mode === "edit" ? "filled" : "plain"}
              onClick={() => setMode(mode === "edit" ? "read" : "edit")}
            >
              <EditIcon size={16} />
            </IconButton>
            {/* Share (↗) — on the reading programme in the design (frame 1.6);
                also kept on the editing header so an editor can share without
                first switching lenses (US-024). */}
            {canShare && (
              <IconButton label="Share" onClick={() => setShareOpen(true)}>
                <ShareIcon size={16} />
              </IconButton>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-3 p-4">
        {/* Editing-only toolbar: undo/redo (editor) + make-a-copy (any member). */}
        {mode === "edit" && (onFork || canEdit || syncing) && (
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
            {/* Choreo fork (US-037): any member may "make it your own" — the
                server clones it into a new owned, frozen routine. */}
            {onFork && (
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                loading={forking}
                onClick={onFork}
              >
                Make a copy
              </Button>
            )}
          </div>
        )}

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
          <RoutineReadingView
            routine={routine}
            placements={store.readPlacements()}
            annotations={store.readAnnotations()}
            canComment={can(role, "canAnnotate")}
            roleView={roleView}
            onRoleViewChange={setRoleView}
            onOpenFigure={(figureId) => setNotating(figureId)}
            onOpenThread={(figureId) => setNotating(figureId)}
          />
        ) : routine.sections.length === 0 ? (
          // Empty state (frame 1.8): a freshly created/forked-empty routine.
          <EmptyState canEdit={canEdit} onAdd={(name) => store.addSection(name)} />
        ) : (
          <>
            {/* The live section list. data-testid is a stable hook the two-client
            convergence E2E (US-015) asserts on (no role/name ambiguity). */}
            <div data-testid="section-list" className="flex flex-col gap-[9px]">
              {routine.sections.map((section, index) => {
                const isCollapsed = collapsed.has(section.id);
                return (
                  <section key={section.id} className="flex flex-col gap-[7px]">
                    <SectionHeader
                      section={section}
                      collapsed={isCollapsed}
                      meta={sectionMeta(
                        section,
                        resolvedByPlacement,
                        routine.dance as DanceId,
                        isCollapsed,
                      )}
                      canEdit={canEdit}
                      isFirst={index === 0}
                      isLast={index === routine.sections.length - 1}
                      onToggle={() => toggleCollapsed(section.id)}
                      onRename={(name) => store.renameSection(section.id, name)}
                      onMove={(dir) => store.moveSection(section.id, dir)}
                      onDelete={() => setPendingDelete(section)}
                    />
                    {!isCollapsed && (
                      <div className="ml-2 flex flex-col gap-[7px]">
                        {section.placements.map((placement, pIndex) => (
                          <PlacementCard
                            key={placement.id}
                            placement={placement}
                            figure={resolvedByPlacement.get(placement.id)?.figure ?? null}
                            status={resolvedByPlacement.get(placement.id)?.status ?? "loading"}
                            canEdit={canEdit}
                            isFirst={pIndex === 0}
                            isLast={pIndex === section.placements.length - 1}
                            onMove={(dir) => store.movePlacement(section.id, placement.id, dir)}
                            onRetry={() => store.retryFigure(placement.figureRef)}
                            onOpen={() => {
                              const f = resolvedByPlacement.get(placement.id)?.figure;
                              if (f) setNotating(f.id);
                            }}
                            onDelete={() =>
                              setPendingDeletePlacement({ sectionId: section.id, placement })
                            }
                          />
                        ))}
                        {canEdit && (
                          <DashedAddButton
                            label="add figure"
                            tone="figure"
                            onClick={() => setAddingFigureTo(section.id)}
                          />
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>

            {canEdit && <AddSection variant="inline" onAdd={(name) => store.addSection(name)} />}
          </>
        )}
      </div>

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
          setLanesOpen(false);
          setAddKindOpen(false);
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
              customKinds={store.customKinds()}
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
            {/* Custom kinds + Lanes (US-043/044): Add-kind (editor only) + a lane
                grid view for one attribute kind across all counts. */}
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              <div className="flex items-center gap-2">
                {canEdit && (
                  <Button variant="secondary" size="sm" onClick={() => setAddKindOpen(true)}>
                    Add kind
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setLanesOpen((prev) => !prev)}>
                  Lanes
                </Button>
              </div>
              {lanesOpen && (
                <Lanes
                  kind={store.customKinds()[0]?.kind ?? "footwork"}
                  role={canEdit ? role : "viewer"}
                  counts={8}
                  attributes={notatingFigure.attributes}
                  customKinds={store.customKinds()}
                  onChange={(next) => store.setFigureAttributes(notatingFigure.id, next)}
                />
              )}
            </div>
          </div>
        )}
      </Sheet>

      {/* Add a custom attribute kind (US-043): editor-only; persisted in the
          routine doc and across all routines via accountKinds (US-043 AC-2).
          NOTE: rendered AFTER the notation Sheet on purpose — both use the same
          overlay z-index, so DOM source order decides stacking; this Sheet must
          stay below the notation Sheet here to layer on top of it when open. */}
      <AddKindSheet
        open={addKindOpen}
        onClose={() => setAddKindOpen(false)}
        onCreate={(k) => store.createCustomKind(k)}
      />

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

/** The derived bar / figure count shown on a section header (frame 1.7/1.9):
 *  expanded sections show the derived bar count; collapsed ones show the figure
 *  count (the design's "3 figs"). Bars are summed from each figure's notation. */
function sectionMeta(
  section: Section,
  resolved: Map<string, ResolvedPlacement>,
  dance: DanceId,
  collapsed: boolean,
): string {
  if (collapsed) {
    const n = section.placements.length;
    return `${n} fig${n === 1 ? "" : "s"}`;
  }
  let bars = 0;
  for (const pl of section.placements) {
    const fig = resolved.get(pl.id)?.figure;
    if (!fig) continue;
    const counts = fig.attributes.filter((a) => a.deletedAt == null).map((a) => a.count);
    if (counts.length > 0) bars += barsForFigure(counts, dance);
  }
  return `${bars} bar${bars === 1 ? "" : "s"}`;
}

/** A section's green header (frames 1.7/1.9): ▾/▸ collapse toggle + name + green
 *  "N bars"/"N figs" meta. Editors also get rename (inline) / move / delete. */
function SectionHeader({
  section,
  collapsed,
  meta,
  canEdit,
  isFirst,
  isLast,
  onToggle,
  onRename,
  onMove,
  onDelete,
}: {
  section: Section;
  collapsed: boolean;
  meta: string;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section.name);

  if (renaming) {
    return (
      <form
        className="flex items-end gap-2 rounded-[9px] border-[1.5px] p-2"
        style={{ background: "var(--bf-section-tint)", borderColor: "var(--bf-section-meta)" }}
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
    <div
      className="flex items-center gap-2 rounded-[9px] border-[1.5px] px-[10px] py-2"
      style={{
        background: "var(--bf-section-tint)",
        borderColor: "var(--bf-section-meta)",
        opacity: collapsed ? 0.6 : undefined,
      }}
    >
      <button
        type="button"
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${section.name}`}
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span aria-hidden="true" className="flex-none" style={{ color: "var(--bf-section-label)" }}>
          {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
        </span>
        <h2 className="truncate text-[13px] font-bold" style={{ color: "var(--bf-section-ink)" }}>
          {section.name}
        </h2>
      </button>
      <span
        className="flex-none text-2xs font-semibold"
        style={{ color: "var(--bf-section-meta)" }}
      >
        {meta}
      </span>
      {canEdit && (
        <div className="-mr-1 flex flex-none items-center">
          <IconButton label={`Rename ${section.name}`} onClick={() => setRenaming(true)}>
            ✎
          </IconButton>
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
          <IconButton label={`Delete ${section.name}`} onClick={onDelete}>
            ✕
          </IconButton>
        </div>
      )}
    </div>
  );
}

/** A dashed green "＋ add figure / add section" affordance (frame 1.7). The
 *  figure variant uses the lighter dashed green; the section variant the bolder. */
function DashedAddButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: "figure" | "section";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 rounded-[9px] border-[1.5px] border-dashed py-2 text-2xs font-bold"
      style={{
        borderColor: tone === "figure" ? "var(--bf-section-dash)" : "var(--bf-section-meta)",
        color: "var(--bf-section-action)",
      }}
    >
      <span aria-hidden="true">＋</span>
      {label}
    </button>
  );
}

/** Add-section affordance (frames 1.8/1.9). The `empty` variant is the
 *  centered empty-state card; the `inline` variant is the dashed full-width
 *  button at the end of the list. Both expand into the green name panel. */
function AddSection({
  variant,
  onAdd,
}: {
  variant: "empty" | "inline";
  onAdd: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const toast = useToast();

  if (open) {
    return (
      <form
        className="rounded-[10px] border-[1.5px] p-3"
        style={{ background: "var(--bf-section-tint)", borderColor: "var(--bf-section-meta)" }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const next = name.trim();
          if (!next) return;
          onAdd(next);
          toast.show(`Added ${next}`);
          setName("");
          setOpen(false);
        }}
      >
        <p
          className="mb-2 text-2xs font-bold uppercase tracking-wide"
          style={{ color: "var(--bf-section-label)" }}
        >
          Name this section
        </p>
        <Input
          label="Section name"
          placeholder="e.g. 1st Long Side"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <p
          className="my-2 text-[13px]"
          style={{ color: "var(--bf-section-caption)", fontFamily: "var(--bf-font-note)" }}
        >
          e.g. 1st Long Side · Corner · Intro · Spin section — anything you like
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>
            Add section
          </Button>
        </div>
      </form>
    );
  }

  if (variant === "empty") {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-xl border-2 border-dashed text-2xl"
          style={{ borderColor: "var(--bf-section-dash)", color: "var(--bf-section-dash)" }}
        >
          ＋
        </span>
        <p className="text-sm font-bold text-ink-secondary">No sections yet</p>
        <p
          className="max-w-[16rem] text-sm text-ink-muted"
          style={{ fontFamily: "var(--bf-font-note)" }}
        >
          Add a section (e.g. "1st Long Side"), then drop figures into it.
        </p>
        <Button
          variant="primary"
          size="sm"
          aria-label="Add section"
          onClick={() => setOpen(true)}
          leadingIcon={<span aria-hidden="true">＋</span>}
        >
          add section
        </Button>
      </div>
    );
  }

  return <DashedAddButton label="add section" tone="section" onClick={() => setOpen(true)} />;
}

/** The editing empty state (frame 1.8). For a viewer (no edit rights) it's just
 *  the honest "No sections yet" line; an editor gets the add-section affordance. */
function EmptyState({ canEdit, onAdd }: { canEdit: boolean; onAdd: (name: string) => void }) {
  if (!canEdit) {
    return <p className="py-12 text-center text-sm text-ink-muted">No sections yet.</p>;
  }
  return <AddSection variant="empty" onAdd={onAdd} />;
}

/** One placement → a card (frame 1.7): scope dot + figure name + count pill +
 *  (custom) pill + drag handle; editors get reorder/remove + alignment chips. */
function PlacementCard({
  placement,
  figure,
  status = figure ? "live" : "loading",
  canEdit = false,
  isFirst = false,
  isLast = false,
  onMove,
  onOpen,
  onDelete,
  onRetry,
}: {
  placement: Placement;
  figure: FigureDoc | null;
  status?: FigureLoadStatus;
  canEdit?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onMove?: (direction: "up" | "down") => void;
  onOpen?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
}) {
  // A figure is its own doc on its own connection, loaded lazily. Distinguish the
  // transient states (just-added / still-hydrating) from genuine failures so a
  // figure never reads as the alarming "Unknown figure": show a skeleton while it
  // loads, an honest unavailable note if it's gone/forbidden, and a retry if it
  // merely failed to load.
  if (figure == null) {
    if (status === "missing") {
      return (
        <Card>
          <p className="text-2xs text-ink-faint" role="status">
            This figure is unavailable — it may have been removed, or you don’t have access.
          </p>
        </Card>
      );
    }
    if (status === "error") {
      return (
        <Card>
          <div className="flex items-center gap-2">
            <span className="text-2xs text-ink-faint" role="status">
              Couldn’t load this figure.
            </span>
            {onRetry && (
              <Button variant="ghost" size="sm" className="ml-auto" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        </Card>
      );
    }
    // pending / loading
    return (
      <Card>
        <div className="flex items-center gap-2" aria-busy="true">
          <Skeleton className="w-32" />
          <span className="sr-only" role="status">
            Loading figure…
          </span>
        </div>
      </Card>
    );
  }

  const label = figure.name;
  const isCustom = figure.scope === "account" && !figureMatchesLibraryOrigin(figure);
  const live = figure.attributes.filter((a) => a.deletedAt == null);
  const counts = [...new Set(live.map((a) => a.count))].sort((a, b) => a - b);
  return (
    <div
      className="flex flex-col gap-1 rounded-[10px] border-[1.5px] px-[11px] py-[9px]"
      style={{
        background: isCustom ? "var(--bf-scope-custom-tint)" : "var(--bf-surface)",
        borderColor: isCustom ? "var(--bf-scope-custom-border)" : "var(--bf-accent-border)",
      }}
    >
      <div className="flex items-center gap-2">
        {/* Scope dot — blue (library) / amber (custom). The scope word rides as
            sr-only text so the cue isn't color-only (#5). */}
        <span className="flex flex-none items-center">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ background: isCustom ? kindVar("footwork") : kindVar("direction") }}
          />
          <span className="bf-sr-only">{isCustom ? "Custom" : "Library"} figure</span>
        </span>
        {/* The name opens the figure's step timeline — editors notate, others view. */}
        <button
          type="button"
          aria-label={`${canEdit ? "Edit" : "View"} steps: ${label}`}
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-[13px] font-bold"
          style={{ color: isCustom ? "var(--bf-scope-custom-ink)" : "var(--bf-ink)" }}
        >
          {label}
        </button>
        {counts.length > 0 && <CountPill counts={counts.map((c) => countLabel(c))} />}
        {isCustom && (
          <span
            className="flex-none rounded-[5px] px-1.5 py-0.5 text-[8px] font-semibold"
            style={{
              background: "var(--bf-scope-custom-tint)",
              color: "var(--bf-scope-custom-ink)",
            }}
          >
            Custom
          </span>
        )}
        {/* Drag handle affordance (frame 1.7 ⠿). Reorder is the up/down controls. */}
        <span
          aria-hidden="true"
          className="flex-none text-sm"
          style={{ color: "var(--bf-border-strong)" }}
        >
          ⠿
        </span>
        {canEdit && (
          <div className="-mr-1 flex flex-none items-center">
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
            <IconButton label={`Remove ${label}`} onClick={onDelete}>
              ✕
            </IconButton>
          </div>
        )}
      </div>
      {/* A subtle attribute summary + entry/exit alignment chips (US-018/US-031). */}
      <p className="text-2xs text-ink-faint">{attributeSummary(figure.attributes)}</p>
      <AlignmentChips placement={placement} figure={figure} />
    </div>
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
            // figureType is NOT unique within a dance (figure families repeat it —
            // e.g. foxtrot's base + "incorporating Feather Finish" Reverse Turns),
            // so key on the (figureType, name) pair the library guarantees unique
            // (packages/domain library-data integrity test). Keying on figureType
            // alone collides and triggers React's duplicate-key warning.
            <li key={`${f.figureType}::${f.name}`}>
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
