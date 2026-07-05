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
  barsForFigure,
  can,
  countLabel,
  DANCES,
  type DanceId,
  type FigureDoc,
  figureMatchesLibraryOrigin,
  libraryFiguresForDance,
  type Placement,
  type RegistryKind,
  type Section,
} from "@weavesteps/domain";
import { type FormEvent, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { pickMessages, useMessages } from "../i18n";
import { assembleMessages } from "../i18n/messages/assemble";
import { timelineMessages } from "../i18n/messages/timeline";
import { buildMemberColorMap, type ColorableMember } from "../lib/identity-colors";
import { listAccountKinds } from "../store/custom-kinds";
import type { TokenProvider } from "../store/doc-connection";
import { createFamilyNote, type FamilyNote, loadFamilyNotes } from "../store/family-notes";
import { useMe } from "../store/me";
import type { FigureLoadStatus, ResolvedPlacement, RoutineStore } from "../store/routine";
import { openRoutineView } from "../store/routine-view";
import { useMembers } from "../store/share";
import { useFirstVisitTour } from "../tour/useFirstVisitTour";
import {
  AttrChip,
  Button,
  Card,
  ChevronDownIcon,
  ChevronRightIcon,
  Chip,
  CountPill,
  cx,
  EditIcon,
  FullScreen,
  IconButton,
  Input,
  kindVar,
  OfflineState,
  ScreenHeader,
  SegmentedToggle,
  ShareIcon,
  Sheet,
  Skeleton,
  Spinner,
  Stepper,
  useToast,
} from "../ui";
import { AddKindPicker } from "./AddKindPicker";
import { AnnotationPanel } from "./AnnotationPanel";
import { FamilyNotes } from "./FamilyNotes";
import { FigureTimeline } from "./FigureTimeline";
import { Lanes } from "./Lanes";
import { RoutineReadingView } from "./RoutineReadingView";
import { cellValue, isOffBeatCount, usedColumns } from "./reading-columns";
import { useStoredRoleView } from "./reading-columns-role";
import { supportsSlowQuick, useStoredTimingView } from "./reading-timing";
import { filterByRoleView, type RoleView } from "./role-view";
import { Share } from "./Share";

/** Per-document membership role (NOT an ARIA role). */
export type MembershipRole = "editor" | "commenter" | "viewer";

/**
 * Build the routine's `userId → identity colour` map for avatars + note dots.
 * Members who chose a colour keep it; profile-less members get a default that's
 * distinct from the others in the choreo (US-039). The current user's OWN colour
 * (from `useMe`) is authoritative — it can be set before the members roster
 * reflects it — so fold it in over their roster row.
 */
function resolveMemberColors(
  members: { userId: string; identityColor?: string }[] | undefined,
  currentUserId: string | undefined,
  currentUserColor: string | undefined,
): Record<string, string> {
  const list: ColorableMember[] = (members ?? []).map((m) => ({
    userId: m.userId,
    identityColor: m.identityColor,
  }));
  if (currentUserId) {
    const mine = list.find((m) => m.userId === currentUserId);
    if (mine) mine.identityColor = currentUserColor ?? mine.identityColor;
    else list.push({ userId: currentUserId, identityColor: currentUserColor });
  }
  return buildMemberColorMap(list);
}

/**
 * Build the routine's `userId → display name` map for the reading view's
 * comment avatars (Builder v2 pairs each identity colour with the author's
 * initial — #5). The current user's own name (useMe) overrides their roster row
 * for the same freshness reason as the colour map above.
 */
function resolveMemberNames(
  members: { userId: string; displayName?: string }[] | undefined,
  currentUserId: string | undefined,
  currentUserName: string | undefined,
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const m of members ?? []) {
    if (m.displayName) names[m.userId] = m.displayName;
  }
  if (currentUserId && currentUserName) names[currentUserId] = currentUserName;
  return names;
}

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
  /**
   * Which lens the screen opens in (design: `assembleEdit`). Opening an existing
   * routine lands on the clean reading programme ("read"); a freshly created one
   * lands straight in the section/figure builder ("edit"). Defaults to "edit" so
   * direct unit renders keep exercising the editing affordances; ChoreoFlow (the
   * production caller) passes "read" on open and "edit" on create.
   */
  initialMode?: "edit" | "read";
  /**
   * The caller's library bookmark set (⟳v5, PLAN §4.2/§5.2): figureRefs already
   * "added to my library". Drives the placement-card / figure-editor "add to my
   * library" ↔ "in your library" affordance for a choreo-local ACCOUNT figure.
   * Omitted → the affordance hides (e.g. offline, or a test that doesn't wire it).
   */
  bookmarkedFigureRefs?: ReadonlySet<string>;
  /** Bookmark a figure into the caller's library (a REFERENCE, never a copy). */
  onAddToLibrary?: (figureRef: string) => Promise<{ alreadySaved: boolean }>;
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
  initialMode = "edit",
  bookmarkedFigureRefs,
  onAddToLibrary,
}: AssembleProps) {
  const offlineProp = connection === "offline";
  const t = useMessages(assembleMessages);
  // The header's L·F role lens shares the reading/timeline "Steps for" copy
  // (Leader/Follower stay untranslated by glossary convention).
  const roleT = useMessages(timelineMessages);
  // The figureRef whose step timeline is open in the notation sheet (US-028), or null.
  const [notating, setNotating] = useState<string | null>(null);
  // Toast shown when editing a global figure spawns a variant (⟳v5): "Made this
  // figure yours".
  const [copiedToast, setCopiedToast] = useState(false);
  // Stable variant-spawn callback: re-points notating to the new variant id so the
  // open sheet follows it, and surfaces the "Made this figure yours" status.
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
  // Also require the doc to be HYDRATED: "live" (the DO's catch-up has arrived) or
  // "local" (§11.2 — hydrated from local persistence while disconnected; edits
  // persist on-device and replay on reconnect). Editing an as-yet-unhydrated
  // (empty A.init) doc would push onto a missing `sections` list and be lost on
  // merge, so we wait for real content from either source.
  const syncStateNow = store?.syncState();
  const canEdit = can(role, "canEdit") && (syncStateNow === "live" || syncStateNow === "local");
  // Sharing (invite/remove) is an editor/owner capability — gated on the SHARED
  // table (principle #26); the worker still enforces it server-side (US-024).
  const canShare = can(role, "canInvite");
  const [shareOpen, setShareOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Section | null>(null);
  // The "add a figure" target: which section, and (for insert-between) the
  // placement the new figure lands BEFORE. `beforePlacementId` omitted → append.
  const [addingFigureTo, setAddingFigureTo] = useState<{
    sectionId: string;
    beforePlacementId?: string;
  } | null>(null);
  // Custom-kind sheet (US-043) + Lanes view (US-044) — local to the notation panel.
  // (`notating` itself is declared above, alongside the copy-on-write handler.)
  const [addKindOpen, setAddKindOpen] = useState(false);
  const [lanesOpen, setLanesOpen] = useState(false);
  // "read" lays the whole routine out as the clean read-only programme (frame
  // 1.6); "edit" is the section/figure builder (frames 1.7–1.9). Opening lands
  // on the lens chosen by the caller (`initialMode`): read on open, edit on create.
  const [mode, setMode] = useState<"edit" | "read">(initialMode);
  // The anchor whose thread is open from the reading view (T8 QUAL-2 fix).
  // When set, the thread sheet shows the AnnotationPanel for that step's anchor.
  const [threadAnchor, setThreadAnchor] = useState<{
    figureRef: string;
    /** Omitted for a WHOLE-FIGURE thread (US-004a); present for a per-step thread. */
    count?: number;
  } | null>(null);
  // The Leader/Follower lens for the reading view — persisted across routines.
  const [roleView, setRoleView] = useStoredRoleView();
  // The counts ⇄ slow/quick timing lens (persisted). Offered only for the dances
  // that read in S/Q (Tango, Foxtrot, Quickstep) — see `slowQuickEligible` below,
  // derived once `routine` is read.
  const [timingView, setTimingView] = useStoredTimingView();
  // Stable handler identities for the memoized reading view (FigureReadout is
  // React.memo'd): an inline closure here would re-bust every row's props on
  // each background sync re-render. useState setters are stable, so [] is right.
  const openFigureFromReading = useCallback((figureId: string) => setNotating(figureId), []);
  const openThreadFromReading = useCallback(
    (anchor: { figureRef: string; count?: number }) => setThreadAnchor(anchor),
    [],
  );
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

  // "Add to my library" (⟳v5, PLAN §4.2/§5.2): bookmark a placed/notated ACCOUNT
  // figure. Wraps the caller's mutation with the same toast contract as the
  // global-library "↟ save" card (FigureLibrary.tsx) — "Added"/"Already in your
  // library" on success, a danger toast on failure; never throws into the caller.
  const handleAddToLibrary = useCallback(
    async (figureRef: string) => {
      if (!onAddToLibrary) return;
      try {
        const res = await onAddToLibrary(figureRef);
        toast.show(res.alreadySaved ? t.alreadyInLibrary : t.addedToLibrary, {
          tone: res.alreadySaved ? "neutral" : "success",
        });
      } catch {
        toast.show(t.addToLibraryFailed, { tone: "danger" });
      }
    },
    [onAddToLibrary, toast, t],
  );

  // Identity colour map for reading-view inline dots (T9b): build from the
  // members query + the current user's own identity so dots use real colours.
  // React Query caches the request; calling it here (for reading view) and in
  // ThreadSheetContents (for the thread panel) costs zero extra network hops.
  const me = useMe();
  const membersQ = useMembers(routineId);
  // First-visit tour: the reading programme's lenses + share + quick note.
  // Held until the store is HYDRATED ("live"), not merely open — `store !== null`
  // flips before catch-up, so on a slow connection the tour opened over a
  // still-loading screen and the content reflowed under its highlight. The
  // subscribe(bump) effect re-renders on sync-state advances, so this predicate
  // re-evaluates the moment hydration lands. Only in read mode.
  useFirstVisitTour("assemble", mode === "read" && !offlineProp && store?.syncState() === "live");
  const memberColorMap = useMemo(
    () => resolveMemberColors(membersQ.data?.members, currentUserId, me.data?.identityColor),
    [membersQ.data, me.data, currentUserId],
  );
  const memberNameMap = useMemo(
    () => resolveMemberNames(membersQ.data?.members, currentUserId, me.data?.displayName),
    [membersQ.data, me.data, currentUserId],
  );

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

  // Offline editing (§11.2): changes not yet handed to the server. While merely
  // disconnected ("local") they show as the slate pending chip; when the
  // connection is TERMINALLY rejected ("closed" — access revoked / doc gone)
  // with pending changes, the content stays readable with the danger alert
  // (the Q-NEW-2 rule: rejected offline edits are surfaced, never dropped).
  const pendingSync = store?.pendingSyncCount?.() ?? 0;
  const terminallyClosed = store?.syncState() === "closed";
  const offline = offlineProp || (terminallyClosed && pendingSync === 0);
  if (offline) return <OfflineState />;
  if (!store) {
    return (
      <div className="flex items-center gap-2 p-6 text-ink-faint" role="status">
        <Spinner /> <span className="text-2xs">{t.connecting}</span>
      </div>
    );
  }

  const routine = store.readRoutine();
  // The S/Q lens is only meaningful (and only shown) for Tango/Foxtrot/Quickstep;
  // every other dance always reads in numeric counts even if `bb_timing` is stale.
  const slowQuickEligible = supportsSlowQuick(routine.dance as DanceId);
  const effectiveTimingView = slowQuickEligible ? timingView : "counts";
  const resolvedByPlacement = new Map<string, ResolvedPlacement>(
    store.readPlacements().map((rp: ResolvedPlacement) => [rp.placement.id, rp]),
  );
  const syncing = store.syncState() === "connecting";
  // The placement whose step timeline is open — re-read live each render so a
  // collaborator's synced attribute edit flows into the open editor (US-018 AC-2).
  // We read the whole ResolvedPlacement (not just the figure) so we can tell
  // whether its content is served by the figure's OWN hydrated live doc
  // (`fromLiveDoc`) or is still the read-only snapshot fallback. Match on the
  // placement's figureRef too, so the open sheet still resolves during the brief
  // window where the figure has no content yet (loading) and after a COW re-point.
  const notatingRP =
    notating !== null
      ? (store
          .readPlacements()
          .find((rp) => rp.figure?.id === notating || rp.placement.figureRef === notating) ?? null)
      : null;
  const notatingFigure = notatingRP?.figure ?? null;
  // "Load on open, then live without flicker" (C/E): in editable mode the editor
  // waits for the figure's own live doc rather than rendering — then swapping out —
  // stale snapshot content. A viewer reads the snapshot directly, and an injected
  // test store leaves `fromLiveDoc` undefined; both are treated as ready.
  const notatingFigureReady =
    notatingFigure !== null && (!editable || notatingRP?.fromLiveDoc !== false);

  const modeLabel = mode === "read" ? t.modeReading : t.modeEditing;
  return (
    <div className="flex flex-col">
      {/* Compact per-screen header (frame 1.6/1.7): ‹ back · title · mode ·
          ✎ toggle (+ ↗ Share in reading). Undo/Redo/Make-a-copy live below in
          the editing toolbar — the reading lens stays the clean programme. */}
      <ScreenHeader
        title={routine.title || t.untitledChoreo}
        // Fork lineage as provenance (US-037 AC-3) — surfaced, not pulled-from.
        subtitle={routine.forkedFromRef ? t.forkedSubtitle(modeLabel) : modeLabel}
        onBack={onBack}
        backLabel={t.allChoreos}
        actions={
          <>
            {/* Compact L·F role lens (design 1.23): the Leader/Follower toggle
                moved into the header so the chips row could replace the old
                STEPS FOR row — no net extra chrome. Reading lens only; the
                abbreviated segments keep their full accessible names.
                Remembered per device (bb_role), across choreos. */}
            {mode === "read" && (
              <span data-tour="role-toggle">
                <SegmentedToggle
                  ariaLabel={roleT.stepsFor}
                  tone="muted"
                  value={roleView}
                  onChange={setRoleView}
                  options={[
                    { value: "leader", label: "L", ariaLabel: roleT.leader },
                    { value: "follower", label: "F", ariaLabel: roleT.follower },
                  ]}
                />
              </span>
            )}
            {/* Counts ⇄ Slow/Quick timing lens (Tango/Foxtrot/Quickstep only).
                Sits beside the L·F lens; reading view only. Remembered per device
                (bb_timing), across choreos. */}
            {mode === "read" && slowQuickEligible && (
              <span data-tour="timing-toggle">
                <SegmentedToggle
                  ariaLabel={roleT.timingLens}
                  tone="muted"
                  value={effectiveTimingView}
                  onChange={setTimingView}
                  options={[
                    { value: "counts", label: "123", ariaLabel: roleT.countsLens },
                    { value: "slowquick", label: "SQ", ariaLabel: roleT.slowQuickLens },
                  ]}
                />
              </span>
            )}
            {/* Read ⇄ edit lens toggle. In editing the ✎ is active/filled; in
                reading it's plain. Labels stay "Reading view"/"List view" so the
                action names survive across the redesign. */}
            <IconButton
              label={mode === "edit" ? t.readingView : t.listView}
              variant={mode === "edit" ? "filled" : "plain"}
              data-tour="lens-toggle"
              onClick={() => setMode(mode === "edit" ? "read" : "edit")}
            >
              <EditIcon size={16} />
            </IconButton>
            {/* Share (↗) — on the reading programme in the design (frame 1.6);
                also kept on the editing header so an editor can share without
                first switching lenses (US-024). */}
            {canShare && (
              <IconButton label={t.share} data-tour="share" onClick={() => setShareOpen(true)}>
                <ShareIcon size={16} />
              </IconButton>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-3 p-4">
        {/* §11.2 unsyncable alert (design 1.24 pin 2): the reconnect was
            TERMINALLY rejected while offline edits were pending — say so
            unmissably and keep the local content readable (read-only). */}
        {terminallyClosed && pendingSync > 0 && (
          <div
            role="alert"
            data-testid="unsynced-changes"
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-2xs font-semibold"
            style={{
              background: "var(--bf-danger-tint)",
              borderColor: "var(--bf-danger-border)",
              color: "var(--bf-danger-ink)",
            }}
          >
            <span aria-hidden="true">!</span>
            {t.unsyncedChanges(pendingSync)}
          </div>
        )}
        {/* §11.2 pending chip (design 1.24 pin 1): offline edits saved on this
            device, visible until they sync — slate (offline family), never
            danger. Purely count-driven: any undelivered change shows it, and the
            caught-up reset clears it (incl. through the reconnect replay). */}
        {!terminallyClosed && pendingSync > 0 && (
          <div
            role="status"
            data-testid="pending-sync"
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-2xs font-semibold"
            style={{
              background: "var(--bf-offline-tint)",
              borderColor: "var(--bf-offline)",
              color: "var(--bf-offline-ink)",
            }}
          >
            <span aria-hidden="true">⌁</span>
            {t.offlinePending(pendingSync)}
          </div>
        )}
        {/* Editing-only toolbar: undo/redo (editor) + make-a-copy (any member). */}
        {mode === "edit" && (onFork || canEdit || syncing) && (
          <div className="flex items-center gap-2">
            {syncing && (
              <span className="flex items-center gap-1 text-2xs text-ink-faint" role="status">
                <Spinner /> {t.syncing}
              </span>
            )}
            {/* Per-user undo/redo (US-038): inverts only THIS actor's last change
                (US-010); B's concurrent edit survives. Editor-only. */}
            {canEdit && (
              <>
                {/* D7: glyph glyphs ↶/↷ (design 1.21) with aria-label for accessible name. */}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t.undo}
                  onClick={() => {
                    // Undo always proceeds (CRDT merges). When another actor had
                    // built on the reverted change, soften the toast — advisory
                    // only, no modal, no refusal (US-038 AC-3, PLAN §5.4).
                    const supersededByOthers = store.undo()?.supersededByOthers ?? false;
                    if (supersededByOthers) {
                      toast.show(t.undoneSupersededToast, {
                        tone: "warning",
                      });
                    } else {
                      toast.show(t.undoneToast);
                    }
                  }}
                >
                  <span aria-hidden="true">↶</span> {t.undo}
                </Button>
                <Button variant="ghost" size="sm" aria-label={t.redo} onClick={() => store.redo()}>
                  <span aria-hidden="true">↷</span> {t.redo}
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
                {t.makeACopy}
              </Button>
            )}
          </div>
        )}

        {/* Variant toast: "Made this figure yours" — shown when editing a GLOBAL
            (catalog) figure spawns a live overlay variant (⟳v5, §5.2). role="status"
            is the E2E observable hook. Cleared when the notation Sheet closes. */}
        {copiedToast && (
          <p role="status" className="text-2xs text-accent">
            {t.madeFigureYours}
          </p>
        )}

        {/* Share screen: roster + roles, remove (confirmed), invite link (US-024).
            T9b: wire routineName + onFork so the design's subtitle + Fork CTA show. */}
        <Sheet open={shareOpen} onClose={() => setShareOpen(false)} title={t.shareSheetTitle}>
          <Share
            docRef={routineId}
            viewerRole={role}
            routineName={routine.title || t.untitledChoreo}
            onFork={onFork}
          />
        </Sheet>

        {mode === "read" ? (
          <>
            {/* D5: "Make it mine" fork banner (design 1.19).
                Shown to read-only viewers (canEdit=false) who have a fork path (onFork set).
                Gives the Golden Waltz sample viewer a visible fork CTA. */}
            {onFork && !canEdit && (
              <div
                className="flex items-center gap-3 rounded-lg border p-3"
                style={{
                  background: "var(--bf-scope-custom-tint)",
                  borderColor: "var(--bf-scope-custom-border)",
                }}
              >
                <p className="flex-1 text-xs" style={{ color: "var(--bf-scope-custom-ink)" }}>
                  {t.readOnlyBanner}
                </p>
                <Button variant="primary" size="sm" loading={forking} onClick={onFork}>
                  {t.makeItMine}
                </Button>
              </div>
            )}
            <RoutineReadingView
              routine={routine}
              placements={store.readPlacements()}
              annotations={store.readAnnotations()}
              canComment={can(role, "canAnnotate")}
              memberColors={memberColorMap}
              memberNames={memberNameMap}
              customKinds={store.customKinds()}
              roleView={roleView}
              timingView={effectiveTimingView}
              onOpenFigure={openFigureFromReading}
              onOpenThread={openThreadFromReading}
            />
            {/* Quick-note FAB (Builder v2): a floating "✎ note" pill on the
                reading programme that jumps straight into a note on the first
                figure — the fastest "write down what the coach just said" path.
                Commenters+ only; hidden while the routine is still empty. */}
            {can(role, "canAnnotate") &&
              (() => {
                const firstFigureRef = routine.sections
                  .flatMap((s) => s.placements)
                  .find((pl) => pl.source !== "break")?.figureRef;
                if (!firstFigureRef) return null;
                return (
                  <button
                    type="button"
                    data-testid="quick-note-fab"
                    data-tour="quick-note"
                    onClick={() => setThreadAnchor({ figureRef: firstFigureRef })}
                    className="fixed right-4 inline-flex min-h-[var(--bf-touch-target)] items-center gap-[7px] rounded-pill bg-surface-inverse px-[17px] py-[13px] text-xs font-bold text-ink-inverse"
                    style={{
                      bottom: "calc(var(--bf-touch-target) + env(safe-area-inset-bottom) + 1.5rem)",
                      boxShadow: "var(--bf-shadow-toast)",
                      zIndex: "var(--bf-z-nav)",
                    }}
                  >
                    <span aria-hidden="true">✎</span> {t.quickNote}
                  </button>
                );
              })()}
          </>
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
                        {section.placements.map((placement, pIndex) => {
                          const placementFigure =
                            resolvedByPlacement.get(placement.id)?.figure ?? null;
                          const card =
                            placement.source === "break" ? (
                              <BreakCard
                                beats={
                                  placement.beats ?? DANCES[routine.dance as DanceId].beatsPerBar
                                }
                                canEdit={canEdit}
                                onChangeBeats={(next) =>
                                  store.setBreakBeats(section.id, placement.id, next)
                                }
                                onDelete={() =>
                                  setPendingDeletePlacement({ sectionId: section.id, placement })
                                }
                              />
                            ) : (
                              <PlacementCard
                                placement={placement}
                                figure={placementFigure}
                                dance={routine.dance as DanceId}
                                roleView={roleView}
                                status={resolvedByPlacement.get(placement.id)?.status ?? "loading"}
                                canEdit={canEdit}
                                isFirst={pIndex === 0}
                                isLast={pIndex === section.placements.length - 1}
                                onMove={(dir) => store.movePlacement(section.id, placement.id, dir)}
                                onRetry={() =>
                                  placement.figureRef && store.retryFigure(placement.figureRef)
                                }
                                onOpen={() => {
                                  if (placementFigure) setNotating(placementFigure.id);
                                }}
                                onDelete={() =>
                                  setPendingDeletePlacement({ sectionId: section.id, placement })
                                }
                                isBookmarked={
                                  placementFigure != null &&
                                  (bookmarkedFigureRefs?.has(placementFigure.id) ?? false)
                                }
                                onAddToLibrary={
                                  // Only offer "add to my library" for a figure that is
                                  // NOT (still) part of the global pool: a from-scratch
                                  // custom, or a catalog figure placed then edited into a
                                  // diverged variant. An account figure whose resolved
                                  // content still matches the catalog is effectively the
                                  // pool figure — no bookmark affordance (matches the
                                  // "custom" badge predicate, §2.5.1 #19).
                                  canEdit &&
                                  onAddToLibrary &&
                                  placementFigure &&
                                  placementFigure.scope === "account" &&
                                  !figureMatchesLibraryOrigin(placementFigure)
                                    ? () => void handleAddToLibrary(placementFigure.id)
                                    : undefined
                                }
                              />
                            );
                          return (
                            <div key={placement.id} className="flex flex-col gap-[7px]">
                              {/* Insert-between spot (editor): drop a figure BEFORE this one,
                                  so the sequence can grow anywhere, not just at its end. */}
                              {canEdit && pIndex > 0 && (
                                <InsertSpot
                                  onClick={() =>
                                    setAddingFigureTo({
                                      sectionId: section.id,
                                      beforePlacementId: placement.id,
                                    })
                                  }
                                />
                              )}
                              {card}
                            </div>
                          );
                        })}
                        {canEdit && (
                          <div className="flex gap-2">
                            {/* Equal-width add affordances (frame 1.7): figure + break
                                share the row evenly, so neither reads as primary. */}
                            <DashedAddButton
                              className="flex-1"
                              label={t.addFigure}
                              tone="figure"
                              onClick={() => setAddingFigureTo({ sectionId: section.id })}
                            />
                            <DashedAddButton
                              className="flex-1"
                              label={t.addBreak}
                              tone="break"
                              onClick={() => store.addBreak(section.id)}
                            />
                          </div>
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

      {/* Thread panel (T8 QUAL-2 fix): opens the annotation thread for a
          specific step anchor from the reading view. Uses a child component so
          the identity data hooks (useMe/useMembers) are only mounted when open. */}
      <Sheet
        open={threadAnchor !== null}
        onClose={() => setThreadAnchor(null)}
        title={t.threadSheetTitle}
      >
        {threadAnchor && (
          <ThreadSheetContents
            routineId={routineId}
            anchor={threadAnchor}
            annotations={store.readAnnotations()}
            placements={store.readPlacements()}
            role={role}
            currentUserId={currentUserId}
            onCreate={({ kind, text }) =>
              store.createAnnotation({
                kind,
                text,
                anchors: [
                  threadAnchor.count == null
                    ? { type: "figure", figureRef: threadAnchor.figureRef }
                    : {
                        type: "point",
                        figureRef: threadAnchor.figureRef,
                        count: threadAnchor.count,
                      },
                ],
              })
            }
            onReply={(annotationId, text) => store.addReply(annotationId, text)}
            onDeleteReply={(annotationId, replyId) => store.deleteReply(annotationId, replyId)}
          />
        )}
      </Sheet>

      {/* Add a figure: mints a fresh owned custom figure + a placement (US-027). */}
      <Sheet
        open={addingFigureTo !== null}
        onClose={() => setAddingFigureTo(null)}
        title={t.addFigureSheetTitle}
      >
        <AddFigurePicker
          dance={routine.dance as DanceId}
          onAdd={(name, figureType, bars) => {
            if (addingFigureTo)
              store.addPlacement(
                addingFigureTo.sectionId,
                name,
                figureType,
                bars,
                addingFigureTo.beforePlacementId,
              );
            setAddingFigureTo(null);
          }}
        />
      </Sheet>

      {/* Notate a figure (US-028 hero flow, frames 1.11/1.12): a FULL-SCREEN editor
          (‹ back), not a modal-within-modal. The editor writes to the figure's OWN
          doc via the store and auto-saves — there is no figure-level Save; the
          safety net is the header Undo/Redo, which (§5.4, "undo follows the surface
          being edited") targets THIS figure's own doc via store.undoFigure, so a
          mis-tap in the step grid is recoverable. A viewer sees it read-only.
          Re-reads live so a collaborator's edit flows in. */}
      <FullScreen
        open={notating !== null}
        onClose={() => {
          setNotating(null);
          setLanesOpen(false);
          setAddKindOpen(false);
          setCopiedToast(false);
        }}
        title={t.stepsTitle(notatingFigure?.name ?? t.figureFallback)}
        backLabel={t.back}
        actions={
          // Figure-scoped undo/redo (§5.4): editor-only, and disabled until the
          // figure's own live doc has hydrated (the same "load on open" gate the
          // body uses — an edit/undo must never land pre-replay). Same primitives
          // + "Undone" toast contract (incl. the soft superseded variant) as the
          // Assemble editing toolbar's routine-level undo/redo.
          canEdit ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t.undo}
                disabled={!notatingFigureReady}
                onClick={() => {
                  const ref = notatingFigure?.id ?? notating;
                  if (!ref) return;
                  const supersededByOthers = store.undoFigure(ref)?.supersededByOthers ?? false;
                  if (supersededByOthers) {
                    toast.show(t.undoneSupersededToast, { tone: "warning" });
                  } else {
                    toast.show(t.undoneToast);
                  }
                }}
              >
                <span aria-hidden="true">↶</span> {t.undo}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t.redo}
                disabled={!notatingFigureReady}
                onClick={() => {
                  const ref = notatingFigure?.id ?? notating;
                  if (ref) store.redoFigure(ref);
                }}
              >
                <span aria-hidden="true">↷</span> {t.redo}
              </Button>
            </>
          ) : undefined
        }
      >
        {notating !== null && !notatingFigureReady && (
          // Load on open (C/E): wait for the figure's own live doc before showing
          // the timeline, so we never render then swap out stale snapshot content.
          <div className="flex items-center gap-2 p-4 text-ink-faint" role="status">
            <Spinner /> <span className="text-2xs">{t.loadingFigure}</span>
          </div>
        )}
        {notatingFigure && notatingFigureReady && (
          <div className="flex flex-col gap-4 p-4">
            {/* D6: alignment header summary (frame 1.20 pin 1) — "facing DW → backing LOD"
                chips above the timeline when either entry or exit alignment is set. */}
            {(notatingFigure.entryAlignment || notatingFigure.exitAlignment) && (
              <div className="flex items-center gap-2">
                {notatingFigure.entryAlignment && (
                  <Chip tone="accent" asStatic>
                    {t.qualifierLabel[notatingFigure.entryAlignment.qualifier]}{" "}
                    {t.directionLabel[notatingFigure.entryAlignment.direction]}
                  </Chip>
                )}
                {notatingFigure.entryAlignment && notatingFigure.exitAlignment && (
                  <span aria-hidden="true" className="text-xs text-ink-faint">
                    →
                  </span>
                )}
                {notatingFigure.exitAlignment && (
                  <Chip tone="accent" asStatic>
                    {t.qualifierLabel[notatingFigure.exitAlignment.qualifier]}{" "}
                    {t.directionLabel[notatingFigure.exitAlignment.direction]}
                  </Chip>
                )}
              </div>
            )}
            <FigureTimeline
              role={canEdit ? role : "viewer"}
              dance={routine.dance as DanceId}
              attributes={notatingFigure.attributes}
              bars={notatingFigure.bars}
              onBarsChange={(next) => store.setFigureBars(notatingFigure.id, next)}
              roleView={roleView}
              onRoleViewChange={setRoleView}
              scopeLabel={routine.title || notatingFigure.name}
              customKinds={store.customKinds()}
              figureScope={notatingFigure.scope === "global" ? "global" : "owned"}
              onForkIntoVariant={() =>
                store.setFigureAttributes(notatingFigure.id, notatingFigure.attributes)
              }
              onChange={(next) => store.setFigureAttributes(notatingFigure.id, next)}
              isBookmarked={
                notatingFigure.scope === "account" &&
                (bookmarkedFigureRefs?.has(notatingFigure.id) ?? false)
              }
              onAddToLibrary={
                // Diverged/custom account figures only — not a pool figure that still
                // matches the catalog (see the placement-card note above, §2.5.1 #19).
                canEdit &&
                onAddToLibrary &&
                notatingFigure.scope === "account" &&
                !figureMatchesLibraryOrigin(notatingFigure)
                  ? () => void handleAddToLibrary(notatingFigure.id)
                  : undefined
              }
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
                    {t.addKind}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setLanesOpen((prev) => !prev)}>
                  {t.lanes}
                </Button>
              </div>
              {lanesOpen && (
                <Lanes
                  kind={store.customKinds()[0]?.kind ?? "footwork"}
                  role={canEdit ? role : "viewer"}
                  counts={8}
                  attributes={notatingFigure.attributes}
                  roleView={roleView}
                  onRoleViewChange={setRoleView}
                  customKinds={store.customKinds()}
                  onChange={(next) => store.setFigureAttributes(notatingFigure.id, next)}
                />
              )}
            </div>
          </div>
        )}
      </FullScreen>

      {/* Add an attribute kind (frame 1.15 + US-043): a picker over the standard
          + custom kinds with a "＋ new attribute type" route to the builder
          (frame 1.16). Editor-only; a created kind persists in the routine doc
          and across routines via accountKinds (US-043 AC-2).
          NOTE: rendered AFTER the notation Sheet on purpose — both use the same
          overlay z-index, so DOM source order decides stacking; this Sheet must
          stay below the notation Sheet here to layer on top of it when open. */}
      <AddKindPicker
        open={addKindOpen}
        onClose={() => setAddKindOpen(false)}
        dance={routine.dance as DanceId}
        customKinds={store.customKinds()}
        onSelectKind={() => setAddKindOpen(false)}
        onCreate={(k) => store.createCustomKind(k)}
      />

      {/* Placement delete confirm (principle #28); soft-delete tombstone. */}
      <Sheet
        open={pendingDeletePlacement !== null}
        onClose={() => setPendingDeletePlacement(null)}
        title={t.removeFigureTitle}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-secondary">{t.removeFigureBody}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingDeletePlacement(null)}>
              {t.cancel}
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
              {t.removeFigure}
            </Button>
          </div>
        </div>
      </Sheet>

      {/* Destructive actions confirm (principle #28); soft-delete tombstone. */}
      <Sheet
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t.deleteSectionTitle}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-secondary">
            {t.deleteSectionBody(pendingDelete?.name ?? "")}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete) store.deleteSection(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              {t.deleteSection}
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
  // Resolve the catalog per call (locale can change at runtime); callers render
  // inside a component that subscribes via useMessages, so a switch re-renders.
  const t = pickMessages(assembleMessages);
  if (collapsed) {
    // Count figures only — a break isn't a figure (US-004a).
    const n = section.placements.filter((p) => p.source !== "break").length;
    return t.figCount(n);
  }
  const beatsPerBar = DANCES[dance].beatsPerBar;
  let bars = 0;
  for (const pl of section.placements) {
    if (pl.source === "break") {
      // A break contributes its bar span to the section count (US-004a).
      bars += Math.max(1, Math.round((pl.beats ?? beatsPerBar) / beatsPerBar));
      continue;
    }
    const fig = resolved.get(pl.id)?.figure;
    if (!fig) continue;
    // Mirror the routine-card projection (worker doc-do.ts §2.7): a figure's bar
    // span is its AUTHORED `bars` when set, else the phrase span of its steps
    // (`barsForFigure`). The old code summed only `barsForFigure` and skipped any
    // figure with no notated steps — so a section of freshly-placed figures (which
    // carry an authored `bars` but empty `attributes` until notated) read "0 bars".
    const counts = fig.attributes.filter((a) => a.deletedAt == null).map((a) => a.count);
    bars +=
      typeof fig.bars === "number" && fig.bars >= 1
        ? Math.floor(fig.bars)
        : barsForFigure(counts, dance);
  }
  return t.barCount(bars);
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
  const t = useMessages(assembleMessages);
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
          label={t.sectionNameLabel}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Button type="submit" variant="primary" size="sm">
          {t.save}
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
        aria-label={collapsed ? t.expandSection(section.name) : t.collapseSection(section.name)}
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
          <IconButton label={t.renameNamed(section.name)} onClick={() => setRenaming(true)}>
            ✎
          </IconButton>
          <IconButton
            label={t.moveUpNamed(section.name)}
            disabled={isFirst}
            onClick={() => onMove("up")}
          >
            ↑
          </IconButton>
          <IconButton
            label={t.moveDownNamed(section.name)}
            disabled={isLast}
            onClick={() => onMove("down")}
          >
            ↓
          </IconButton>
          <IconButton label={t.deleteNamed(section.name)} onClick={onDelete}>
            ✕
          </IconButton>
        </div>
      )}
    </div>
  );
}

/** A dashed green "＋ add figure / add section" affordance (frame 1.7). The
 *  figure variant uses the lighter dashed green; the section variant the bolder.
 *  `className` lets callers size it (e.g. `flex-1` for the equal figure/break row). */
function DashedAddButton({
  label,
  tone,
  onClick,
  className,
}: {
  label: string;
  tone: "figure" | "section" | "break";
  onClick: () => void;
  className?: string;
}) {
  // A break reads muted (it's a wait, not a figure); figure/section keep the green.
  const isBreak = tone === "break";
  const borderColor = isBreak
    ? "var(--bf-border-strong)"
    : tone === "figure"
      ? "var(--bf-section-dash)"
      : "var(--bf-section-meta)";
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cx(
        "flex w-full items-center justify-center gap-1.5 rounded-[9px] border-[1.5px] border-dashed py-2 text-2xs font-bold",
        className,
      )}
      style={{
        borderColor,
        color: isBreak ? "var(--bf-ink-muted)" : "var(--bf-section-action)",
      }}
    >
      <span aria-hidden="true">{isBreak ? "❚❚" : "＋"}</span>
      {label}
    </button>
  );
}

/** A slim insert-between affordance (US-027): a hairline with a centered ＋ that
 *  sits in the gap BETWEEN two placements, so a figure can be dropped mid-sequence
 *  rather than only appended. Reads quiet until tapped so it never competes with
 *  the placement cards. */
function InsertSpot({ onClick }: { onClick: () => void }) {
  const t = useMessages(assembleMessages);
  return (
    <button
      type="button"
      aria-label={t.insertFigureHere}
      onClick={onClick}
      className="group flex w-full items-center gap-2 py-0.5 text-ink-faint"
    >
      <span
        aria-hidden="true"
        className="h-px flex-1 border-t border-dashed"
        style={{ borderColor: "var(--bf-section-dash)" }}
      />
      <span
        aria-hidden="true"
        className="flex size-[18px] flex-none items-center justify-center rounded-full border border-dashed text-2xs font-bold leading-none"
        style={{ borderColor: "var(--bf-section-dash)", color: "var(--bf-section-action)" }}
      >
        ＋
      </span>
      <span
        aria-hidden="true"
        className="h-px flex-1 border-t border-dashed"
        style={{ borderColor: "var(--bf-section-dash)" }}
      />
    </button>
  );
}

/** A break/wait card in the editing view (US-004a): a muted card with a −/＋
 *  stepper (min 1 beat). It occupies beats but has no figure or steps. */
function BreakCard({
  beats,
  canEdit,
  onChangeBeats,
  onDelete,
}: {
  beats: number;
  canEdit: boolean;
  onChangeBeats: (next: number) => void;
  onDelete: () => void;
}) {
  const t = useMessages(assembleMessages);
  return (
    <div
      data-testid="break-card"
      className="flex items-center gap-2 rounded-[10px] border border-dashed px-3 py-2"
      style={{ borderColor: "var(--bf-border-strong)", background: "var(--bf-surface-sunken)" }}
    >
      <span aria-hidden="true" className="text-2xs font-bold text-ink-muted">
        ❚❚
      </span>
      <span className="flex-1 text-2xs font-bold uppercase tracking-wider text-ink-muted">
        {t.breakLabel}
      </span>
      {canEdit ? (
        <div className="flex items-center gap-2">
          <IconButton
            label={t.fewerBeats}
            onClick={() => onChangeBeats(beats - 1)}
            disabled={beats <= 1}
          >
            <span aria-hidden="true">−</span>
          </IconButton>
          <span className="min-w-[52px] text-center text-2xs font-bold tabular-nums text-ink">
            {t.beatCount(beats)}
          </span>
          <IconButton label={t.moreBeats} onClick={() => onChangeBeats(beats + 1)}>
            <span aria-hidden="true">＋</span>
          </IconButton>
          <IconButton label={t.removeBreak} onClick={onDelete}>
            <span aria-hidden="true">×</span>
          </IconButton>
        </div>
      ) : (
        <span className="text-2xs font-bold tabular-nums text-ink-muted">{t.beatCount(beats)}</span>
      )}
    </div>
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
  const t = useMessages(assembleMessages);
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
          toast.show(t.addedSection(next));
          setName("");
          setOpen(false);
        }}
      >
        <p
          className="mb-2 text-2xs font-bold uppercase tracking-wide"
          style={{ color: "var(--bf-section-label)" }}
        >
          {t.nameThisSection}
        </p>
        <Input
          label={t.sectionNameLabel}
          placeholder={t.sectionNamePlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <p
          className="my-2 text-[13px]"
          style={{ color: "var(--bf-section-caption)", fontFamily: "var(--bf-font-note)" }}
        >
          {t.sectionNameCaption}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>
            {t.addSection}
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
        <p className="text-sm font-bold text-ink-secondary">{t.noSectionsYet}</p>
        <p
          className="max-w-[16rem] text-sm text-ink-muted"
          style={{ fontFamily: "var(--bf-font-note)" }}
        >
          {t.emptyStateHint}
        </p>
        <Button
          variant="primary"
          size="sm"
          aria-label={t.addSection}
          onClick={() => setOpen(true)}
          leadingIcon={<span aria-hidden="true">＋</span>}
        >
          {t.addSectionDashed}
        </Button>
      </div>
    );
  }

  return (
    <DashedAddButton label={t.addSectionDashed} tone="section" onClick={() => setOpen(true)} />
  );
}

/** The editing empty state (frame 1.8). For a viewer (no edit rights) it's just
 *  the honest "No sections yet" line; an editor gets the add-section affordance. */
function EmptyState({ canEdit, onAdd }: { canEdit: boolean; onAdd: (name: string) => void }) {
  const t = useMessages(assembleMessages);
  if (!canEdit) {
    return <p className="py-12 text-center text-sm text-ink-muted">{t.noSectionsYetViewer}</p>;
  }
  return <AddSection variant="empty" onAdd={onAdd} />;
}

/** One placement → a card (frame 1.7): scope dot + figure name + count pill +
 *  (custom) pill + drag handle; editors get reorder/remove + alignment chips. */
function PlacementCard({
  placement,
  figure,
  dance,
  roleView,
  status = figure ? "live" : "loading",
  canEdit = false,
  isFirst = false,
  isLast = false,
  onMove,
  onOpen,
  onDelete,
  onRetry,
  isBookmarked = false,
  onAddToLibrary,
}: {
  placement: Placement;
  figure: FigureDoc | null;
  /** The routine's dance — drives which attribute columns apply (Tango omits rise). */
  dance: DanceId;
  /** The current L·F lens (shared with the header + reading view) — the attribute
   *  summary shows this role's steps so it matches what the editor is working on. */
  roleView: RoleView;
  status?: FigureLoadStatus;
  canEdit?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onMove?: (direction: "up" | "down") => void;
  onOpen?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
  /** Whether this (account) figure is already in the caller's library (⟳v5, §4.2/§5.2). */
  isBookmarked?: boolean;
  /** Bookmark this figure into the caller's library — offered for a choreo-local
   *  ACCOUNT figure only (a global/catalog reference isn't "yours" to bookmark
   *  from here — that's the Library screen's "↟ save" card). */
  onAddToLibrary?: () => void;
}) {
  const t = useMessages(assembleMessages);
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
            {t.figureUnavailable}
          </p>
        </Card>
      );
    }
    if (status === "error") {
      return (
        <Card>
          <div className="flex items-center gap-2">
            <span className="text-2xs text-ink-faint" role="status">
              {t.figureLoadFailed}
            </span>
            {onRetry && (
              <Button variant="ghost" size="sm" className="ml-auto" onClick={onRetry}>
                {t.retry}
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
            {t.loadingFigure}
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
          <span className="bf-sr-only">{t.scopeSr(isCustom)}</span>
        </span>
        {/* The name opens the figure's step timeline — editors notate, others view. */}
        <button
          type="button"
          aria-label={t.openSteps(canEdit, label)}
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
            {t.customPill}
          </span>
        )}
        {/* "Add to my library" ↔ "in your library" (⟳v5, §4.2/§5.2) — a choreo-local
            ACCOUNT figure only; a bookmark is a REFERENCE, never a copy. */}
        {figure.scope === "account" &&
          (isBookmarked ? (
            <span
              className="flex-none rounded-pill px-2 py-0.5 text-[9px] font-semibold"
              style={{
                background: "var(--bf-scope-global-tint)",
                color: "var(--bf-scope-global-ink)",
              }}
            >
              {t.inYourLibrary}
            </span>
          ) : (
            onAddToLibrary && (
              <button
                type="button"
                aria-label={t.addToLibraryAria(label)}
                onClick={onAddToLibrary}
                className="flex-none rounded-pill border px-2 py-0.5 text-[9px] font-semibold"
                style={{
                  borderColor: "var(--bf-scope-custom-border)",
                  color: "var(--bf-scope-custom-ink)",
                  background: "var(--bf-surface)",
                }}
              >
                <span aria-hidden="true">↟</span> {t.addToLibrary}
              </button>
            )
          ))}
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
              label={t.moveUpNamed(label)}
              disabled={isFirst}
              onClick={() => onMove?.("up")}
            >
              ↑
            </IconButton>
            <IconButton
              label={t.moveDownNamed(label)}
              disabled={isLast}
              onClick={() => onMove?.("down")}
            >
              ↓
            </IconButton>
            <IconButton label={t.removeNamed(label)} onClick={onDelete}>
              ✕
            </IconButton>
          </div>
        )}
      </div>
      {/* The figure's technique at a glance (US-018) — the same per-step chips the
          reading view shows, filtered to the current L·F lens. Tapping the strip
          opens the full-screen figure detail (step editor / read-only view), so an
          editor can jump straight from a placement to its notation. */}
      <button
        type="button"
        aria-label={t.openDetail(label)}
        onClick={onOpen}
        className="w-full text-left"
      >
        <PlacementAttributes figure={figure} dance={dance} roleView={roleView} />
      </button>
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
  onAdd: (name: string, figureType?: string, bars?: number) => void;
}) {
  const t = useMessages(assembleMessages);
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  // The new custom figure's authored length (PLAN §2.5) — chosen here on creation
  // and adjustable later in the editor header. Library picks keep their catalog
  // default (their charted steps), so the stepper applies to the custom form only.
  const [bars, setBars] = useState(2);
  const q = filter.trim().toLowerCase();
  const presets = libraryFiguresForDance(dance).filter(
    (f) => q === "" || f.name.toLowerCase().includes(q),
  );
  return (
    <div className="flex flex-col gap-3">
      <Input
        label={t.filterFigures}
        placeholder={t.searchLibraryPlaceholder}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {presets.length === 0 ? (
        <p className="text-2xs text-ink-faint">{t.noLibraryMatches}</p>
      ) : (
        <ul
          className="flex max-h-64 flex-col gap-1 overflow-y-auto"
          aria-label={t.libraryFiguresAria}
        >
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
          onAdd(next, undefined, bars);
          setName("");
        }}
      >
        <Input
          label={t.figureNameLabel}
          placeholder={t.createYourOwnPlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <span className="text-2xs font-bold uppercase tracking-wider text-ink-muted">
            {t.length}
          </span>
          <Stepper
            label={t.barsLabel}
            hideLabel
            unit={t.barsUnit}
            min={1}
            max={32}
            value={bars}
            onChange={setBars}
          />
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>
          {t.addCustom}
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
  const t = useMessages(assembleMessages);
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <h3 className="text-sm font-bold text-ink">{t.alignment}</h3>
      <AlignmentEdge
        label={t.entry}
        current={figure.entryAlignment ?? null}
        onChange={onSet}
        edge="entry"
      />
      <AlignmentEdge
        label={t.exit}
        current={figure.exitAlignment ?? null}
        onChange={onSet}
        edge="exit"
      />
    </div>
  );
}

/**
 * One edge (entry/exit) of the alignment editor: qualifier + direction chip rows
 * (design 1.20 — selected chip filled accent, others outlined).
 * Keeps the fieldset/aria-label structure for accessibility.
 */
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
  const t = useMessages(assembleMessages);
  const qualifier = current?.qualifier ?? "facing";
  const direction = current?.direction ?? "";
  return (
    <fieldset aria-label={t.edgeAlignmentAria(label)} className="flex flex-col gap-2">
      {/* QUALIFIER row */}
      <div>
        <div className="mb-1 text-2xs font-bold uppercase tracking-wide text-ink-faint">
          {t.qualifier}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALIGNMENT_QUALIFIERS.map((q) => (
            <Chip
              key={q}
              tone="accent"
              // Only show selected when a direction is also set (full alignment exists).
              selected={qualifier === q && direction !== ""}
              onClick={() =>
                onChange(edge, {
                  qualifier: q,
                  // Default to LOD if no direction yet (matches existing Select behaviour).
                  direction: (direction || "LOD") as Alignment["direction"],
                })
              }
            >
              {t.qualifierLabel[q]}
            </Chip>
          ))}
        </div>
      </div>
      {/* DIRECTION row */}
      <div>
        <div className="mb-1 text-2xs font-bold uppercase tracking-wide text-ink-faint">
          {t.direction}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="neutral" selected={direction === ""} onClick={() => onChange(edge, null)}>
            {t.notSet}
          </Chip>
          {ALIGNMENT_DIRECTIONS.map((d) => (
            <Chip
              key={d}
              tone="accent"
              selected={direction === d}
              onClick={() => onChange(edge, { qualifier, direction: d })}
            >
              {t.directionLabel[d]}
            </Chip>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

/**
 * A compact, read-only chip summary of a figure's steps for the edit-view
 * placement card (US-018) — the same per-count chips the reading view shows,
 * filtered to the current L·F lens so it matches the side the editor is working
 * on. Each beat/count sits on its OWN row (a small count-label gutter + that
 * count's value chips), so a multi-step figure reads as a tidy stacked list
 * rather than one crowded wrapping strip. An empty figure (placed but not yet
 * notated) falls back to the plain summary.
 */
function PlacementAttributes({
  figure,
  dance,
  roleView,
}: {
  figure: FigureDoc;
  dance: DanceId;
  roleView: RoleView;
}) {
  const t = pickMessages(assembleMessages);
  const forRole = filterByRoleView(
    figure.attributes.filter((a) => a.deletedAt == null),
    roleView,
  );
  if (forRole.length === 0) {
    return <p className="text-2xs text-ink-faint">{t.noAttributes}</p>;
  }
  const columns = usedColumns(forRole, dance);
  const counts = [...new Set(forRole.map((a) => a.count))].sort((a, b) => a - b);
  return (
    <div className="flex flex-col gap-[3px]">
      {counts.map((count) => {
        const here = forRole.filter((a) => a.count === count);
        const dimmed = isOffBeatCount(count);
        const chips = columns
          .map((col) => {
            const value = cellValue(here, col);
            return value ? (
              <AttrChip key={col.id} kind={col.kind} label={value} dimmed={dimmed} />
            ) : null;
          })
          .filter(Boolean);
        if (chips.length === 0) return null;
        return (
          // One row per beat/count: a fixed count-label gutter on the left, the
          // beat's chips wrapping to its right (frame 1.6 count-gutter layout).
          <div key={count} className="flex items-start gap-2">
            <span
              className={cx(
                "w-[18px] flex-none pt-[3px] text-right font-bold text-accent tabular-nums",
                dimmed ? "text-[10px]" : "text-[11px]",
              )}
            >
              {countLabel(count)}
            </span>
            <div className="flex flex-wrap gap-1">{chips}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Entry/exit + per-placement alignment as read-only chips (editing is US-031).
 * D6: shows qualifier + readable direction label, e.g. "entry facing diag wall".
 */
function AlignmentChips({ placement, figure }: { placement: Placement; figure: FigureDoc | null }) {
  const t = useMessages(assembleMessages);
  const chips: Array<{ key: string; label: string }> = [];
  if (figure?.entryAlignment) {
    const { qualifier, direction } = figure.entryAlignment;
    chips.push({
      key: "entry",
      label: t.entryChip(t.qualifierLabel[qualifier], t.directionLabel[direction]),
    });
  }
  if (figure?.exitAlignment) {
    const { qualifier, direction } = figure.exitAlignment;
    chips.push({
      key: "exit",
      label: t.exitChip(t.qualifierLabel[qualifier], t.directionLabel[direction]),
    });
  }
  if (placement.perPlacementAlignment) {
    const { qualifier, direction } = placement.perPlacementAlignment;
    chips.push({
      key: "here",
      label: t.hereChip(t.qualifierLabel[qualifier], t.directionLabel[direction]),
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {chips.map(({ key, label }) => (
        <Chip key={key} tone="neutral" asStatic>
          {label}
        </Chip>
      ))}
    </div>
  );
}

// ── T8 Thread Sheet (QUAL-2 fix) ──────────────────────────────────────────────

/**
 * The annotation thread panel that opens when a user taps an inline comment or
 * "+ add comment" in the reading view. Rendered only when the Sheet is open
 * (the Sheet's `if (!open) return null` ensures this component is unmounted
 * when closed). This lets the identity data hooks (useMe/useMembers) be called
 * safely without touching the rest of the Assemble render tree.
 *
 * Author colour data path: `useMembers(routineId)` → `Member.identityColor`
 * (T8 extended the members endpoint to LEFT JOIN users). Current user: `useMe`
 * → `Me.identityColor`.
 *
 * Gap documented: the `InlineComments` author dots in RoutineReadingView still
 * use the hash fallback (identityColor(authorId)). To fix those too would
 * require threading authorColorMap through RoutineReadingView → FigureReadout
 * → StepRow → InlineComments; deferred (dots in the panel use real colours).
 */
function ThreadSheetContents({
  routineId,
  anchor,
  annotations,
  placements,
  role,
  currentUserId,
  onCreate,
  onReply,
  onDeleteReply,
}: {
  routineId: string;
  anchor: { figureRef: string; count?: number };
  annotations: import("@weavesteps/domain").Annotation[];
  placements: ResolvedPlacement[];
  role: MembershipRole;
  currentUserId?: string;
  onCreate: (input: { kind: import("@weavesteps/domain").AnnotationKind; text: string }) => void;
  onReply: (annotationId: string, text: string) => void;
  onDeleteReply: (annotationId: string, replyId: string) => void;
}) {
  // Only called when the Sheet is open (component is mounted) — see note above.
  const t = useMessages(assembleMessages);
  const me = useMe();
  const membersQ = useMembers(routineId);

  // Author colours: chosen colours win, profile-less members get distinct
  // defaults (US-039) — so two logged-in-but-un-onboarded co-editors don't share
  // slot 1. Current user's own colour (useMe) is folded in authoritatively.
  const authorColorMap = resolveMemberColors(
    membersQ.data?.members,
    currentUserId,
    me.data?.identityColor,
  );
  // Author names from the members list (server resolves un-onboarded members'
  // names from their cached Clerk identity — see listMembers).
  const authorNameMap: Record<string, string> = {};
  for (const m of membersQ.data?.members ?? []) {
    if (m.displayName) authorNameMap[m.userId] = m.displayName;
  }
  // Current user's own name (useMe — real, and set before the roster reflects it).
  const currentUserName = me.data?.displayName;
  if (currentUserId && currentUserName) authorNameMap[currentUserId] = currentUserName;
  // The composer avatar uses the current user's resolved colour (a distinct
  // default when they haven't picked one).
  const currentUserColor = currentUserId ? authorColorMap[currentUserId] : undefined;

  // Thread title (frame 1.14 header): "Figure Name · step N" for a per-step
  // thread; the figure name + a "whole figure" subtitle for a figure-level one.
  const isWholeFigure = anchor.count == null;
  const figure = placements.find((p) => p.figure?.id === anchor.figureRef)?.figure;
  const figureName = figure?.name ?? anchor.figureRef;
  const threadTitle = isWholeFigure
    ? figureName
    : t.stepThreadTitle(figureName, anchor.count as number);
  const threadSubtitle = isWholeFigure ? t.wholeFigure : undefined;

  // A whole-figure thread keys on a `figure` anchor (no count); a per-step thread
  // on the exact `point` anchor (US-004a).
  const threadAnnotations = annotations.filter(
    (a) =>
      a.deletedAt == null &&
      a.anchors.some((an) =>
        isWholeFigure
          ? an.type === "figure" && an.figureRef === anchor.figureRef
          : an.type === "point" && an.figureRef === anchor.figureRef && an.count === anchor.count,
      ),
  );

  return (
    <AnnotationPanel
      role={role}
      currentUserId={currentUserId}
      annotations={threadAnnotations}
      composeAnchor={
        isWholeFigure
          ? { type: "figure", figureRef: anchor.figureRef }
          : { type: "point", figureRef: anchor.figureRef, count: anchor.count as number }
      }
      threadTitle={threadTitle}
      threadSubtitle={threadSubtitle}
      authorColorMap={authorColorMap}
      authorNameMap={authorNameMap}
      currentUserColor={currentUserColor}
      currentUserName={currentUserName}
      onCreate={onCreate}
      onReply={onReply}
      onDeleteReply={onDeleteReply}
    />
  );
}
