// Drizzle table definitions mirroring the D1 index (docs/system/architecture.md
// § D1 — the index & projections). D1 is a pure
// index/registry over the document graph — no CRDT content lives here.
//
// Tables land per-story as their migration does (migrations/*.sql is the source
// of truth for D1 shape; these Drizzle tables mirror it for typed access in
// routes). `users` is US-019; document_registry / membership / invite are
// projected/seeded via raw SQL today and get typed here as their stories land.
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Account identity captured at onboarding (US-019). `id` is the Clerk `sub`. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("displayName").notNull(),
  identityColor: text("identityColor").notNull(),
  plan: text("plan", { enum: ["free", "pro"] })
    .notNull()
    .default("free"),
  createdAt: integer("createdAt"),
  // D31 (⟳v5) admin seam (migration 0014). `isAdmin` gates in-app global-figure
  // editing (an admin resolves to `editor` on a global-figure doc) + the §11 admin
  // surfaces; `routineCapOverride` is a nullable per-user owned-routine cap an
  // admin can RAISE above the plan default, read by the quota seam (routineCapFor)
  // BEFORE the plan cap. Both default to "not elevated / no override".
  isAdmin: integer("isAdmin", { mode: "boolean" }).notNull().default(false),
  routineCapOverride: integer("routineCapOverride"),
});

export type UserRow = typeof users.$inferSelect;

/**
 * Cache of a user's human identity derived from their Clerk session-token claims
 * (migration 0013). Populated on GET /api/me so co-members can resolve a display
 * for a logged-in-but-not-onboarded user (who has no `users` row) instead of the
 * raw `user_…` id. `name` holds the resolved label: their Clerk NAME when the
 * token carries one, else their EMAIL (see `/api/me`). Keyed by Clerk `sub`. NOT
 * a substitute for `users` — writing here never implies onboarding.
 */
export const userNameCache = sqliteTable("user_name_cache", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  updatedAt: integer("updatedAt").notNull(),
});

export type UserNameCacheRow = typeof userNameCache.$inferSelect;

/** Per-document membership (US-020). Keyed per (docRef, userId); soft-delete. */
export const membership = sqliteTable("membership", {
  id: text("id").primaryKey(),
  docRef: text("docRef").notNull(),
  userId: text("userId").notNull(),
  role: text("role", { enum: ["viewer", "commenter", "editor"] }).notNull(),
  createdAt: integer("createdAt").notNull(),
  deletedAt: integer("deletedAt"),
});

export type MembershipRow = typeof membership.$inferSelect;

/**
 * The thin per-document index row (US-016 migration 0001), projected from the DO
 * on its alarm. Typed here so the permission boundary can resolve a doc's owner
 * (US-021 owner elevation) and US-025 can list/search without reading CRDT.
 */
export const documentRegistry = sqliteTable("document_registry", {
  docRef: text("docRef").primaryKey(),
  type: text("type").notNull(),
  ownerId: text("ownerId").notNull(),
  doName: text("doName").notNull(),
  figureType: text("figureType"),
  dance: text("dance"),
  title: text("title"),
  forkedFromRef: text("forkedFromRef"),
  /**
   * US-025 card projection (docs/system/architecture.md § D1 — the index &
   * projections). For a FIGURE row: the figure's own bar
   * count (`barsForFigure`, computed by the figure DO). For a ROUTINE row: Σ of
   * its referenced figures' `bars`. Nullable — eventually consistent (projected
   * on the DO alarm; absent until the first projection).
   */
  bars: integer("bars"),
  /** US-025 card projection: a ROUTINE row's non-deleted placement count (`0` →
   *  "no figures yet"). Null on figure/account rows. */
  figureCount: integer("figureCount"),
  updatedAt: integer("updatedAt").notNull(),
  deletedAt: integer("deletedAt"),
});

export type DocumentRegistryRow = typeof documentRegistry.$inferSelect;

/**
 * Per-document membership invite (US-023, migration 0001). The `id` IS the
 * shareable token — a high-entropy random (issued server-side); the redeemer
 * presents it in the redeem URL. role/docRef are read back from THIS row on
 * redeem (never from the token), so a redeemer can't forge or escalate the
 * grant. `redeemedAt` NULL = still open (single-use); the alarm sweeps expired
 * open ones (US-016). `expiresAt` is unix ms.
 */
export const invite = sqliteTable("invite", {
  id: text("id").primaryKey(),
  docRef: text("docRef").notNull(),
  role: text("role", { enum: ["viewer", "commenter", "editor"] }).notNull(),
  expiresAt: integer("expiresAt").notNull(),
  redeemedAt: integer("redeemedAt"),
});

export type InviteRow = typeof invite.$inferSelect;

/**
 * T6 — the cross-routine JournalEntry index (migration 0009). The routine DO's
 * alarm projects each lesson/practice annotation here so the Journal list reads
 * the user's accessible routines without fanning out to N routine DOs. Typed in
 * Drizzle only for the reset/seed path; the projection + read use raw SQL like
 * db/journal.ts (mirrors family-notes). Soft-delete via `deletedAt`.
 */
export const journalEntry = sqliteTable("journal_entry", {
  entryId: text("entryId").primaryKey(),
  routineRef: text("routineRef").notNull(),
  authorId: text("authorId").notNull(),
  kind: text("kind", { enum: ["lesson", "practice"] }).notNull(),
  text: text("text").notNull(),
  anchors: text("anchors").notNull().default("[]"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  deletedAt: integer("deletedAt"),
  // docs/ideas/annotation-media-embeds.md (plan discrepancy 3) — projected live
  // media counts so a Journal card renders its media chip without reading CRDT.
  imageCount: integer("imageCount").notNull().default(0),
  videoCount: integer("videoCount").notNull().default(0),
});

export type JournalEntryRow = typeof journalEntry.$inferSelect;

/**
 * docs/ideas/annotation-media-embeds.md — media_object (migration 0020) is the
 * upload-grant + caps counter for annotation media. D1 stays a pure index: the
 * row holds the granted byte size + accounting; the bytes live in R2, keyed by
 * media/<docRef>/<annotationId>/<mediaId> (the authz scope). Raw SQL (db/media.ts)
 * does the reads/writes, matching db/journal.ts; typed here for the reset path.
 */
export const mediaObject = sqliteTable("media_object", {
  objectKey: text("objectKey").primaryKey(),
  docRef: text("docRef").notNull(),
  annotationId: text("annotationId").notNull(),
  userId: text("userId").notNull(),
  bytes: integer("bytes").notNull(),
  uploadedBytes: integer("uploadedBytes").notNull().default(0),
  poster: integer("poster").notNull().default(0),
  createdAt: integer("createdAt").notNull(),
  deletedAt: integer("deletedAt"),
});

export type MediaObjectRow = typeof mediaObject.$inferSelect;

/**
 * §2.7 LibraryEntry (migration 0015, ⟳v5) — the per-user library BOOKMARK
 * projection ("add to my library" is a reference, never a copy, D28). Source of
 * truth is the user's account doc `libraryFigureRefs`; this table is its D1
 * projection for GET /api/figures/mine. `figureRef` is either an account-figure
 * docRef or a catalog `global:<dance>:<figureType>` ref — several users may hold
 * an entry for the SAME figureRef. PRIMARY KEY (userId, figureRef) covers both
 * "this user's bookmarks" and the per-(user,figureRef) idempotent upsert. Raw SQL
 * (db/library.ts) does the actual reads/writes, matching db/journal.ts/
 * db/family-notes.ts; typed here for the reset/seed path.
 */
export const libraryEntry = sqliteTable(
  "library_entry",
  {
    userId: text("userId").notNull(),
    figureRef: text("figureRef").notNull(),
    createdAt: integer("createdAt").notNull(),
    deletedAt: integer("deletedAt"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.figureRef] })],
);

export type LibraryEntryRow = typeof libraryEntry.$inferSelect;
