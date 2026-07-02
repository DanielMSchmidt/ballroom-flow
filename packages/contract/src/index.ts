// @ballroom/contract — Zod request/response schemas shared by web + worker.
// (Dependency direction: contract → domain; web/worker → contract.)
import { DANCE_IDS } from "@ballroom/domain";
import { z } from "zod";

/**
 * Create-routine request (US-025). This is the doc-name validation HOME (#79):
 * the title is trimmed, non-empty, and length-capped, and the dance is one of
 * the five v1 dances. Both the web form and the worker route validate against
 * this ONE schema so client and server never drift.
 */
export const zCreateRoutine = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give your routine a name")
    .max(80, "Keep the name under 80 characters"),
  dance: z.enum(DANCE_IDS),
});
export type CreateRoutine = z.infer<typeof zCreateRoutine>;

/** One row of the Choreo list (US-025). Projected from D1 — no CRDT content. */
export const zRoutineListItem = z.object({
  docRef: z.string(),
  title: z.string(),
  dance: z.enum(DANCE_IDS),
  /** The viewer's role on this routine ("owner" for ones they own). */
  role: z.enum(["owner", "editor", "commenter", "viewer"]),
  /** Last-projected update time (unix ms); ~create time for a fresh routine. */
  updatedAt: z.number(),
  /**
   * Total bar count across the routine's non-deleted placements (US-025 card,
   * frame 1.1 "<dance> · <N bars> · <date>") — Σ of each referenced figure's
   * projected per-figure `bars` (PLAN §2.5/§2.7). Projected from D1 by the routine
   * DO's alarm; OPTIONAL because it is eventually consistent — it may lag a figure
   * edit until the routine re-projects, and is absent until the first projection.
   */
  bars: z.number().optional(),
  /**
   * Number of NON-deleted placements in the routine (US-025 card): `0` renders
   * "no figures yet". Projected with `bars`; optional/eventually-consistent.
   */
  figureCount: z.number().optional(),
  /**
   * Title of the routine this one was forked from (frame 1.3 lineage line),
   * resolved from `forkedFromRef` against the D1 registry on read. Absent for a
   * non-fork (or when the origin's registry row is gone).
   */
  forkedFromTitle: z.string().optional(),
});
export type RoutineListItem = z.infer<typeof zRoutineListItem>;

export const zRoutineList = z.object({ routines: z.array(zRoutineListItem) });
export type RoutineList = z.infer<typeof zRoutineList>;

export const zAttribute = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  count: z.number(),
  role: z.enum(["leader", "follower"]).nullish(),
  value: z.unknown(),
  deletedAt: z.number().nullish(),
});

/** A figure's per-figure alignment (mirrors the domain `Alignment`): which way the
 *  couple faces, from the leader's perspective. Carried on entry/exit so a charted
 *  catalog figure seeds with "where it started / where it ended". */
export const zAlignment = z.object({
  qualifier: z.enum(["facing", "backing", "pointing"]),
  direction: z.enum(["LOD", "ALOD", "wall", "centre", "DW", "DC", "DW_against", "DC_against"]),
});

/**
 * Create-figure request (#187). The client mints the figureRef (ULID) + the
 * metadata; the SERVER stamps ownerId from the verified JWT sub. Projecting the
 * registry row + owner membership at create is what lets the fail-closed DO
 * boundary (US-021) owner-resolve a freshly-minted figure. `figureType` is the
 * figure's immutable kind (#91); for a fresh custom figure it's a name slug.
 */
export const zCreateFigure = z.object({
  figureRef: z.string().min(1),
  name: z.string().trim().min(1, "Give the figure a name").max(80, "Keep the name under 80 chars"),
  dance: z.enum(DANCE_IDS),
  figureType: z.string().trim().min(1),
  /** The routine this figure is being added to — records the placement edge so
   *  the routine's co-members get read access to the figure (cascade, 2026-06-27). */
  routineId: z.string().min(1),
  /** The figure's authored length in musical bars (PLAN §2.5). Chosen on creation
   *  (stepper) and drives the editor grid. Optional/legacy: the DO falls back to
   *  ⌈whole-beat steps ÷ beatsPerBar⌉ (`resolveFigureBars`) when absent. */
  bars: z.number().int().min(1).optional(),
  attributes: z.array(zAttribute).default([]),
  /** Figure-level entry/exit alignment (per-figure, leader's perspective) seeded
   *  from the catalog chart, where charted. Optional — most figures carry none. */
  entryAlignment: zAlignment.optional(),
  exitAlignment: zAlignment.optional(),
  /** Set when this figure is a copy-on-write COPY of a shared base (US-035): a
   *  FROZEN snapshot carrying its own `attributes`; `baseFigureRef` is provenance
   *  only — no live overlay (§5.2). Omitted for a fresh custom figure. */
  baseFigureRef: z.string().min(1).optional(),
});
export type CreateFigure = z.infer<typeof zCreateFigure>;

/**
 * Save-to-library request (T5 / US-034 reuse; ⟳v5 — "add to my library" is a
 * BOOKMARK, never a copy, PLAN §4.2/§5.2/D28). The v5 shape is direct: the client
 * names the figureRef to bookmark (an account-figure docRef, or a catalog
 * `global:<dance>:<figureType>` ref minted client-side via `globalFigureRef`).
 *
 * The legacy `(dance, figureType, name)` triple is accepted for BACK-COMPAT with
 * the existing global-library "↟ save" card (FigureLibrary.tsx), which still
 * identifies a catalog figure by its cross-dance identity rather than minting the
 * ref itself: the SERVER resolves it from the bundled catalog and bookmarks
 * `globalFigureRef(dance, figureType)` — still no copy. Both shapes are
 * idempotent per-caller: re-saving the same figureRef is a no-op
 * (`alreadySaved: true`).
 */
export const zSaveToLibrary = z.union([
  z.object({ figureRef: z.string().min(1) }),
  z.object({
    dance: z.enum(DANCE_IDS),
    figureType: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(80),
  }),
]);
export type SaveToLibrary = z.infer<typeof zSaveToLibrary>;

/**
 * Issue-invite request (US-023). An editor/owner mints a shareable link granting
 * a chosen role. `role` is one of the three STORED membership roles — never
 * "owner" (ownership isn't transferable by link). The granted role is read back
 * from D1 on redeem, never from the token, so a redeemer can't escalate it.
 */
export const zIssueInvite = z.object({
  role: z.enum(["viewer", "commenter", "editor"]),
});
export type IssueInvite = z.infer<typeof zIssueInvite>;

/**
 * WS sync marker (#202): a TEXT frame the DO sends to a client once it has
 * finished replaying the document's full change log on connect (the initial
 * catch-up). Receiving it means the client's doc is HYDRATED (caught up), as
 * distinct from the socket merely being OPEN — so the UI can gate editing on a
 * truly-synced doc rather than writing into a not-yet-replayed one. It rides as
 * a text frame, inherently distinct from the binary Automerge change frames.
 * (A minimal precursor to the fully typed WS envelope, #117.)
 */
export const SYNC_CAUGHT_UP = "ballroom:sync:caught-up";

/**
 * Sync wire — server→client BINARY frame envelope (D10 "sync hardening",
 * 2026-07-02). Every binary frame the DO sends a client carries a 1-byte TYPE
 * PREFIX so the two binary payloads stay distinguishable on the wire:
 *
 *   • {@link SYNC_FRAME_SNAPSHOT} — the WHOLE document as one `A.save(doc)` blob.
 *     Sent ONCE on (re)connect as the catch-up: the client `A.load`s it and
 *     `A.merge`s it into its local doc (so a reconnecting client with local
 *     unacked edits loses nothing). This replaces the old per-change history
 *     replay (`getAllChanges` → one frame per change), which was UNBOUNDED on the
 *     wire as a doc aged (compaction bounds SQLite, not the replay).
 *   • {@link SYNC_FRAME_CHANGE} — one incremental Automerge change, as the DO
 *     broadcasts live edits after connect. The client strips the tag and applies.
 *
 * ASYMMETRY (deliberate, documented): only SERVER→CLIENT frames are prefixed.
 * CLIENT→SERVER frames stay RAW Automerge change bytes (no tag) — the DO's
 * `webSocketMessage` reads them unprefixed. This keeps the client's send path and
 * the resend-on-reconnect path (which forward raw `A.getChanges` bytes) untouched,
 * and the two directions never share a decoder, so there is no ambiguity.
 *
 * DEPLOYMENT-COMPAT WINDOW (accepted, not versioned): this is a HARD protocol
 * cutover. A browser running the OLD client bundle against a NEW worker sees
 * tagged frames and drops them (an old client `A.applyChanges`-es `[tag,…]` →
 * "Invalid magic bytes"); a NEW client against an OLD worker sees raw change
 * frames whose first byte (Automerge magic `0x85`) is an unknown tag and drops
 * them. Either way the affected tab fails to hydrate until it RELOADS onto the
 * matching bundle (Cloudflare deploys worker + web assets together, and the DO
 * restarts with new code, so the mismatch only spans open tabs during a rollout).
 * Auto-reconnect can't bridge it — a reload can. Acceptable at this stage; revisit
 * with a WS-subprotocol version (`ballroom.sync.v2`) if a zero-downtime rollout is
 * ever required.
 */
export const SYNC_FRAME_SNAPSHOT = 0x01;
export const SYNC_FRAME_CHANGE = 0x02;

/**
 * WS close code the DO uses when a broadcast `send` to a socket FAILS (D10
 * broadcast-resync): rather than swallow the error and leave that client
 * silently diverged (missing the change until it happens to reconnect), the DO
 * CLOSES the socket. The client treats any close AFTER it had opened as a
 * transient "warm drop" and auto-reconnects, pulling a fresh {@link
 * SYNC_FRAME_SNAPSHOT} catch-up — so the missed change is recovered. In the
 * app-private 4xxx range so it never collides with a protocol close code.
 */
export const SYNC_RESYNC_CLOSE_CODE = 4001;

/** A merged-registry attribute kind (US-003/US-043), shared shape. */
export const zRegistryKind = z.object({
  kind: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1),
  cardinality: z.enum(["single", "multi"]),
  valueType: z.string().min(1),
  values: z.array(z.string()).optional(),
  freeText: z.boolean().optional(),
  appliesToDances: z.array(z.enum(DANCE_IDS)).optional(),
  // Registry-derived info-sheet + Profile affordances (T5): one-line prose,
  // per-value definitions, role-awareness (L/F), and the required-slot marker.
  description: z.string().optional(),
  valueDefs: z.record(z.string(), z.string()).optional(),
  roleAware: z.boolean().optional(),
  required: z.boolean().optional(),
  builtin: z.boolean(),
});
export type RegistryKindDto = z.infer<typeof zRegistryKind>;

/** One search hit (US-046) — projected from D1, no CRDT content. */
export const zSearchResult = z.object({
  docRef: z.string(),
  type: z.enum(["routine", "global-figure", "account-figure"]),
  title: z.string(),
  dance: z.enum(DANCE_IDS).nullable(),
});
export type SearchResult = z.infer<typeof zSearchResult>;
export const zSearchResults = z.object({ results: z.array(zSearchResult) });
export type SearchResults = z.infer<typeof zSearchResults>;

/** Templates list (US-045) — app-owned routines flagged templateOf. */
export const zTemplateList = z.object({ templates: z.array(zRoutineListItem) });
export type TemplateList = z.infer<typeof zTemplateList>;

/** Account custom-kinds response (US-043) — the caller's account-wide custom attribute kinds. */
export const zAccountCustomKinds = z.object({ kinds: z.array(zRegistryKind) });
export type AccountCustomKinds = z.infer<typeof zAccountCustomKinds>;

/**
 * T6 — A journal entry's link anchor as the `GET /api/journal` read returns it.
 * It mirrors the domain `Anchor` union (point / figure / figureType) but carries
 * a server-RESOLVED `label` (the figure name resolved at projection time) so the
 * client renders a "Natural Turn · step 2" chip with NO extra refetch (T6 §3).
 * Fields are optional because the three anchor shapes carry different keys.
 */
export const zJournalAnchor = z.object({
  type: z.enum(["point", "figure", "figureType"]),
  figureRef: z.string().optional(),
  count: z.number().optional(),
  figureType: z.string().optional(),
  danceScope: z.string().optional(),
  /** Pre-resolved display label for the link chip (server-side, no client refetch). */
  label: z.string().optional(),
});
export type JournalAnchor = z.infer<typeof zJournalAnchor>;

/**
 * T6 — One cross-routine Journal entry (PLAN §2.6/§2.7/§4.6). The UNION of a
 * routine-scoped lesson/practice annotation (projected to `journal_entry`) and
 * an account-scoped figureType lesson/practice note (`figure_type_note_index`).
 * `source` distinguishes the two homes; `routineRef` is the owning doc (a routine
 * doc, or the author's `account:<id>` for account entries).
 */
export const zJournalEntry = z.object({
  id: z.string(),
  routineRef: z.string(),
  authorId: z.string(),
  kind: z.enum(["lesson", "practice"]),
  text: z.string(),
  anchors: z.array(zJournalAnchor),
  createdAt: z.number(),
  displayName: z.string().nullable(),
  identityColor: z.string().nullable(),
  source: z.enum(["routine", "account"]),
});
export const zJournalList = z.object({ entries: z.array(zJournalEntry) });
export type JournalEntry = z.infer<typeof zJournalEntry>;
export type JournalList = z.infer<typeof zJournalList>;
