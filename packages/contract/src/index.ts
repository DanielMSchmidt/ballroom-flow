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
});
export type CreateFigure = z.infer<typeof zCreateFigure>;

/**
 * A figure's scope as surfaced to the library UI (US-032/033, PLAN §2.2):
 * `global` = app-owned canonical library figure; `variant` = an account figure
 * with a baseFigureRef (overlay over a base); `custom` = an account figure the
 * user authored from scratch (no base). The variant-vs-custom distinction is by
 * `baseFigureRef` presence, NOT `source` (#56) — a copy-on-write variant also
 * carries source="custom", so the badge must key off the base link.
 */
export const zFigureScope = z.enum(["global", "variant", "custom"]);
export type FigureScopeName = z.infer<typeof zFigureScope>;

/**
 * One figure row in the library (US-032/033). Projected from the D1 registry +
 * FigureType catalog — never a CRDT scan. The global list omits `usedInCount`
 * and `baseName`; the "mine" list carries `usedInCount` ("used in N routines",
 * US-033 AC-2) and, for a variant, `baseName` (lineage, DESIGN-PRINCIPLES #12).
 */
export const zFigureListItem = z.object({
  docRef: z.string(),
  name: z.string(),
  figureType: z.string(),
  dance: z.enum(DANCE_IDS),
  scope: zFigureScope,
  /** A variant's base figure display name, for the "based on …" lineage (#56). */
  baseName: z.string().nullish(),
  /** "used in N routines" (US-033 AC-2). Omitted on the global list. */
  usedInCount: z.number().int().nonnegative().nullish(),
});
export type FigureListItem = z.infer<typeof zFigureListItem>;

export const zFigureList = z.object({ figures: z.array(zFigureListItem) });
export type FigureList = z.infer<typeof zFigureList>;

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
