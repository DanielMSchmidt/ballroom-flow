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
