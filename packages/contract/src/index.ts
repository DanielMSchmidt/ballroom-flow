// @weavesteps/contract — Zod request/response schemas shared by web + worker.
// (Dependency direction: contract → domain; web/worker → contract.)
import { DANCE_IDS } from "@weavesteps/domain";
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
   * projected per-figure `bars` (docs/concepts/notation.md § Figure length,
   * docs/system/architecture.md § D1 — the index & projections). Projected from D1 by the routine
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
  /** The figure's authored length in COUNTS (beats, 1–64 — Builder v3 ①). Chosen
   *  on creation (stepper) and drives the editor grid; every bar display derives
   *  ⌈counts / beatsPerBar⌉. Optional: the DO falls back to the whole-beat default. */
  counts: z.number().int().min(1).max(64).optional(),
  /** LEGACY pre-v5 length in whole bars — accepted for old clients; new writes
   *  send `counts`. */
  bars: z.number().int().min(1).optional(),
  // A real figure has ≤64 beats × a handful of kinds × 2 roles; the cap is a
  // defensive storage-growth bound (an authenticated caller can otherwise persist
  // an arbitrarily large timeline into the figure DO), well above any genuine use.
  attributes: z.array(zAttribute).max(2000).default([]),
  /** Set when this figure is a v5 VARIANT of a base (⟳v5, §5.2): its `attributes`
   *  are ONLY the OWNED beats and `baseFigureRef` is a LIVE link the CLIENT resolves
   *  the untouched beats against. Omitted for a fresh custom figure. (A pre-v5 frozen
   *  copy carrying its own full attributes still validates — it owns every beat.) */
  baseFigureRef: z.string().min(1).optional(),
});
export type CreateFigure = z.infer<typeof zCreateFigure>;

/**
 * Save-to-library request (T5 / US-034 reuse; ⟳v5 — "add to my library" is a
 * BOOKMARK, never a copy, docs/concepts/figures.md § The library screen, § Variants, D28). The v5 shape is direct: the client
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
 * Account profile write (US-019 onboarding / US-053 profile edit): displayName
 * (trimmed, non-empty) + identity colour (a 3–8 digit hex). Shared by POST
 * /api/onboarding and PATCH /api/profile — both write the same columns, so both
 * parse this schema instead of hand-narrowing an untrusted `as {…}` body.
 */
export const zProfileBody = z.object({
  displayName: z.string().trim().min(1).max(80, "Keep the name under 80 characters"),
  identityColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{3,8}$/),
});
export type ProfileBody = z.infer<typeof zProfileBody>;

/** A bare `{ figureRef }` request body (e.g. unbookmark, DELETE /api/library). */
export const zFigureRefBody = z.object({ figureRef: z.string().min(1) });
export type FigureRefBody = z.infer<typeof zFigureRefBody>;

/**
 * Account-scoped figure-family note write (T6): a lesson/practice/note attached
 * to a figureType within a dance scope. Replaces a hand-narrowed untrusted body.
 */
export const zFamilyNoteBody = z
  .object({
    kind: z.enum(["note", "lesson", "practice"]),
    text: z.string().trim().min(1).max(4000, "Keep the note under 4000 characters"),
    figureType: z.string().trim().min(1).max(120),
    // A figureType note scopes to one dance or the whole family ("all", docs/concepts/annotations.md § Anchors).
    // Constrained to that set so a garbage scope — which would silently never match
    // any routine's dance in the journal join — can't be persisted as dead data.
    danceScope: z.enum([...DANCE_IDS, "all"]),
    // WEP-0004 (docs/concepts/annotations.md § Anchors): a TIMED family note — pin to one count (the timing grid starts
    // at 1) and optionally one side. Additive; absent = the v1 whole-figure note.
    count: z.number().positive().optional(),
    role: z.enum(["leader", "follower"]).nullish(),
  })
  .superRefine((body, ctx) => {
    // Counts don't align across dances — a timed/roled note needs a concrete dance.
    if (body.danceScope === "all" && (body.count != null || body.role != null)) {
      ctx.addIssue({
        code: "custom",
        message: "a timed figure-family note cannot span all dances",
      });
    }
  });
export type FamilyNoteBody = z.infer<typeof zFamilyNoteBody>;

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
 * DEPLOYMENT-COMPAT WINDOW: a protocol change here is a HARD cutover on the
 * wire — e.g. when the 1-byte tag landed, an OLD client against a NEW worker
 * dropped tagged frames ("Invalid magic bytes") and a NEW client against an OLD
 * worker dropped raw ones; the affected tab fails to hydrate until it RELOADS
 * onto the matching bundle (Cloudflare deploys worker + web assets together, and
 * the DO restarts with new code, so the mismatch only spans open tabs during a
 * rollout — and the stale-bundle reload nudge, `apps/web/src/lib/stale-bundle.ts`,
 * reloads those tabs when they next become visible). What makes the NEXT cutover
 * manageable is that the version is now NEGOTIATED, not guessed: the client
 * offers {@link SYNC_SUBPROTOCOL_V1} in its WS subprotocol list and the worker
 * echoes it (see below), so a `ballroom.sync.v2` server can detect a v1 client —
 * and vice versa — at the handshake instead of from malformed frames.
 */
export const SYNC_FRAME_SNAPSHOT = 0x01;
export const SYNC_FRAME_CHANGE = 0x02;

/**
 * The sync-wire VERSION subprotocol. The client offers it (alongside the
 * `ballroom.auth` token carrier) when opening `/api/docs/:id/connect`; the
 * worker selects+echoes it when offered, falling back to echoing
 * `ballroom.auth` for a pre-v1 client that doesn't offer it. It changes
 * nothing about today's wire — its whole job is to make the sync protocol
 * version DETECTABLE at the handshake, so a future `ballroom.sync.v2` can be
 * negotiated (or at least diagnosed) instead of hard-cut. Bump the suffix in
 * lockstep with any incompatible change to the frame envelope above.
 */
export const SYNC_SUBPROTOCOL_V1 = "ballroom.sync.v1";

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

/**
 * WS heartbeat (WEP-0006; docs/system/sync-and-offline.md § Heartbeat): the client sends {@link SYNC_PING} as a TEXT frame
 * while the connection is idle; the DO answers {@link SYNC_PONG} via a
 * runtime-level auto-response (`setWebSocketAutoResponse`) that never wakes a
 * hibernating DO and never reaches `webSocketMessage`. A missed pong deadline
 * means the socket is a half-open ZOMBIE (TCP thinks it's up, nothing is
 * delivered — e.g. an access-point reboot that never flips `navigator.onLine`);
 * the client drops it into the normal warm-reconnect machinery instead of
 * waiting minutes for the OS to notice. TEXT frames keep the D10 asymmetry
 * unambiguous (client→server BINARY stays raw Automerge change bytes), and an
 * old worker simply ignores the ping (its `webSocketMessage` drops TEXT), so
 * the probe is skew-safe in both directions.
 */
export const SYNC_PING = "ballroom:sync:ping";
export const SYNC_PONG = "ballroom:sync:pong";

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
  /** WEP-0004 (docs/concepts/annotations.md § Anchors): the side a timed figureType note narrows to (absent = both). */
  role: z.enum(["leader", "follower"]).nullish(),
  /** Pre-resolved display label for the link chip (server-side, no client refetch). */
  label: z.string().optional(),
});
export type JournalAnchor = z.infer<typeof zJournalAnchor>;

/**
 * T6 — One cross-routine Journal entry (docs/concepts/annotations.md § Anchors,
 * § The Journal, docs/system/architecture.md § D1 — the index & projections). The UNION of a
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

/**
 * E2E fixtures seed body (POST /api/test/seed — mounted ONLY under
 * E2E_TEST_ROUTES). Runtime-validated at the route so a malformed seed fails
 * LOUDLY at seed time instead of silently corrupting a journey's fixtures
 * (the honest replacement for the old `as SeedBody` cast; CLAUDE.md §4).
 */
export const zSeedBody = z.object({
  users: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.string(),
        identityColor: z.string(),
        plan: z.enum(["free", "pro"]).optional(),
        /** D31 admin seam — lets an E2E journey stand up an admin (global-figure editor). */
        isAdmin: z.boolean().optional(),
        routineCapOverride: z.number().nullish(),
      }),
    )
    .optional(),
  seedGlobalFigures: z.boolean().optional(),
  docs: z
    .array(
      z.object({
        docRef: z.string(),
        type: z.string(),
        ownerId: z.string(),
        doName: z.string().optional(),
        title: z.string().nullish(),
        dance: z.string().nullish(),
        figureType: z.string().nullish(),
        sections: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              placements: z.array(z.object({ id: z.string(), figureRef: z.string() })),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  memberships: z
    .array(
      z.object({
        id: z.string().optional(),
        docRef: z.string(),
        userId: z.string(),
        role: z.enum(["viewer", "commenter", "editor"]),
      }),
    )
    .optional(),
  invites: z
    .array(
      z.object({
        id: z.string(),
        docRef: z.string(),
        role: z.enum(["viewer", "commenter", "editor"]),
        expiresAt: z.number(),
        redeemedAt: z.number().nullish(),
      }),
    )
    .optional(),
  figures: z
    .array(
      z.object({
        docRef: z.string(),
        scope: z.enum(["global", "account"]),
        ownerId: z.string(),
        name: z.string(),
        dance: z.string(),
        figureType: z.string(),
        attributes: z.array(zAttribute).optional(),
      }),
    )
    .optional(),
  placementEdges: z.array(z.object({ routineRef: z.string(), figureRef: z.string() })).optional(),
  journalEntries: z
    .array(
      z.object({
        entryId: z.string(),
        routineRef: z.string(),
        authorId: z.string(),
        kind: z.enum(["lesson", "practice"]),
        text: z.string(),
        anchors: z.array(z.unknown()).optional(),
        createdAt: z.number().optional(),
        deletedAt: z.number().nullish(),
      }),
    )
    .optional(),
});
export type SeedBody = z.infer<typeof zSeedBody>;

/** Title-case a figureType/dance slug for a chip label ("natural_turn" → "Natural Turn"). */
function humanizeSlug(slug: string): string {
  return slug
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The resolved chip label for a figureType journal anchor: "all Whisks · all
 * Waltz" / "· all dances"; a TIMED note (WEP-0004) appends its pinned count
 * ("· count 3"). Shared here so the worker's D1 projection read and the web's
 * live account-doc read (WEP-0002 read-your-writes) compose the IDENTICAL
 * label — two independent composers would drift.
 */
export function figureTypeAnchorLabel(
  figureType: string,
  danceScope: string,
  count?: number | null,
): string {
  const family = `all ${humanizeSlug(figureType)}s`;
  const scope = danceScope === "all" ? "all dances" : `all ${humanizeSlug(danceScope)}`;
  return count != null ? `${family} · ${scope} · count ${count}` : `${family} · ${scope}`;
}
