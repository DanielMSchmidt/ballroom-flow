// Drizzle table definitions mirroring the D1 index (PLAN §2.7). D1 is a pure
// index/registry over the document graph — no CRDT content lives here.
//
// Tables land per-story as their migration does (migrations/*.sql is the source
// of truth for D1 shape; these Drizzle tables mirror it for typed access in
// routes). `users` is US-019; document_registry / membership / invite are
// projected/seeded via raw SQL today and get typed here as their stories land.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Account identity captured at onboarding (US-019). `id` is the Clerk `sub`. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("displayName").notNull(),
  identityColor: text("identityColor").notNull(),
  plan: text("plan", { enum: ["free", "pro"] })
    .notNull()
    .default("free"),
  createdAt: integer("createdAt"),
});

export type UserRow = typeof users.$inferSelect;

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
