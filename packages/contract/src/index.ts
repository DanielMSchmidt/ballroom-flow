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
  attributes: z.array(zAttribute).default([]),
  /** Set when this figure is a copy-on-write COPY of a shared base (US-035): a
   *  FROZEN snapshot carrying its own `attributes`; `baseFigureRef` is provenance
   *  only — no live overlay (§5.2). Omitted for a fresh custom figure. */
  baseFigureRef: z.string().min(1).optional(),
});
export type CreateFigure = z.infer<typeof zCreateFigure>;

/**
 * Save-to-library request (T5 / US-034 reuse). Promotes a GLOBAL-catalog figure
 * into the caller's personal library as a FROZEN account-figure copy (PLAN §5.2):
 * the client identifies the catalog figure by its cross-dance identity
 * `(dance, figureType, name)`; the SERVER resolves it from the bundled catalog,
 * stamps ownerId from the verified JWT sub, mints the copy's figureRef, and
 * records `baseFigureRef = globalFigureRef(dance, figureType)` as provenance. The
 * promotion is idempotent on `(owner, baseFigureRef)` — re-saving is a no-op.
 */
export const zSaveToLibrary = z.object({
  dance: z.enum(DANCE_IDS),
  figureType: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(80),
});
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
