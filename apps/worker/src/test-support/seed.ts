// ─────────────────────────────────────────────────────────────────────────
// seedDb(...) — seed an isolated per-suite D1 (PLAN §10.3: "Per-suite isolated
// D1 + applyD1Migrations(); seedDb(...) for D1 + seeded Automerge docs").
//
// HOW IT FITS THE HARNESS:
//   • The vitest config reads ./migrations at config time and exposes them as
//     `env.TEST_MIGRATIONS`. A suite calls `applyMigrations(env)` in beforeAll
//     to get a freshly-migrated D1 (see DEVELOPMENT.md). The migrations dir is
//     empty until M2 — `applyD1Migrations` is a no-op for [] today, which is why
//     the seed/insert SQL only runs inside SKIPPED test bodies for now.
//   • `seedDb` then inserts the D1 INDEX rows (users, memberships, document
//     registry, invites — the §2.7 tables). It does NOT write CRDT content:
//     canonical doc state lives in each DO's SQLite (seed that via the DO stub).
//
// The D1 table/column names below mirror PLAN §2.7 / the §9 ER diagram. When M2
// lands the Drizzle schema, implementers can swap these raw inserts for typed
// Drizzle inserts; the shape is the contract.
// ─────────────────────────────────────────────────────────────────────────
import { env } from "cloudflare:test";

export type MembershipRole = "viewer" | "commenter" | "editor";
export type DocType = "routine" | "global-figure" | "account-figure" | "account";

export interface SeedUser {
  id: string; // Clerk sub
  displayName: string;
  identityColor: string;
  plan: "free" | "pro";
}

export interface SeedDoc {
  docRef: string;
  type: DocType;
  ownerId: string;
  doName: string;
  figureType?: string | null;
  dance?: string | null;
  title?: string | null;
  forkedFromRef?: string | null;
  updatedAt?: number;
}

export interface SeedMembership {
  id: string;
  docRef: string;
  userId: string;
  role: MembershipRole;
}

export interface SeedInvite {
  id: string;
  docRef: string;
  role: MembershipRole;
  expiresAt: number;
  redeemedAt?: number | null;
}

/** A thin FigureTypeNoteIndex row (US-041) — the content stays in the account doc. */
export interface SeedFamilyNote {
  noteId: string;
  accountDocRef: string;
  authorId: string;
  figureType: string;
  danceScope: string; // a DanceId or 'all'
}

/** A routine→figure reference edge (cascade access, migration 0006). */
export interface SeedPlacementEdge {
  routineRef: string;
  figureRef: string;
}

/** A routine-scoped Journal index row (T6, migration 0009). */
export interface SeedJournalEntry {
  entryId: string;
  routineRef: string;
  authorId: string;
  kind: "lesson" | "practice";
  text: string;
  anchors?: unknown[];
  createdAt?: number;
  deletedAt?: number | null;
}

export interface SeedSpec {
  users?: SeedUser[];
  docs?: SeedDoc[];
  memberships?: SeedMembership[];
  invites?: SeedInvite[];
  familyNotes?: SeedFamilyNote[];
  placementEdges?: SeedPlacementEdge[];
  journalEntries?: SeedJournalEntry[];
}

/**
 * Apply the per-suite migrations. Call once in a suite `beforeAll`.
 *
 * D1 is SHARED across the whole worker test run (isolatedStorage:false), so
 * every suite migrates the SAME database. We run the migration SQL DIRECTLY
 * (idempotent `CREATE … IF NOT EXISTS`) rather than via `applyD1Migrations`,
 * whose `d1_migrations` bookkeeping RACES under shared storage and can make a
 * suite skip its CREATEs (→ "no such table"). Running the statements directly is
 * order-independent and self-contained. (#203 — the real fix behind #173; do not
 * reintroduce the bookkeeping or an error-swallow that masks a missing schema.)
 */
export async function applyMigrations(): Promise<void> {
  for (const migration of env.TEST_MIGRATIONS) {
    for (const query of migration.queries) {
      if (query.trim()) await env.DB.prepare(query).run();
    }
  }
}

/**
 * Insert D1 index rows for a test. Returns the spec for convenience. Each insert
 * targets the §2.7 tables; columns mirror the §9 ER diagram. Idempotent inserts
 * are the caller's concern (use a unique suite-scoped id space).
 */
export async function seedDb(spec: SeedSpec): Promise<SeedSpec> {
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];

  for (const u of spec.users ?? []) {
    // INSERT OR IGNORE: D1 is shared across the whole worker run (isolatedStorage
    // is false — DO/SQLite teardown gotcha), so the same fixed actor id (e.g.
    // "u_ed") is seeded by several suites/tests. Re-seeding one identity is a
    // harmless no-op. Docs/memberships below stay strict — they're keyed by the
    // per-test unique docRef, so a collision there is a real isolation bug.
    stmts.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO users (id, displayName, identityColor, plan) VALUES (?, ?, ?, ?)",
      ).bind(u.id, u.displayName, u.identityColor, u.plan),
    );
  }
  for (const d of spec.docs ?? []) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO document_registry (docRef, type, ownerId, doName, figureType, dance, title, forkedFromRef, updatedAt, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
      ).bind(
        d.docRef,
        d.type,
        d.ownerId,
        d.doName,
        d.figureType ?? null,
        d.dance ?? null,
        d.title ?? null,
        d.forkedFromRef ?? null,
        d.updatedAt ?? now,
      ),
    );
  }
  for (const m of spec.memberships ?? []) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO membership (id, docRef, userId, role, createdAt, deletedAt) VALUES (?, ?, ?, ?, ?, NULL)",
      ).bind(m.id, m.docRef, m.userId, m.role, now),
    );
  }
  for (const i of spec.invites ?? []) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO invite (id, docRef, role, expiresAt, redeemedAt) VALUES (?, ?, ?, ?, ?)",
      ).bind(i.id, i.docRef, i.role, i.expiresAt, i.redeemedAt ?? null),
    );
  }
  for (const n of spec.familyNotes ?? []) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO figure_type_note_index (noteId, accountDocRef, authorId, figureType, danceScope, updatedAt, deletedAt) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      ).bind(n.noteId, n.accountDocRef, n.authorId, n.figureType, n.danceScope, now),
    );
  }
  for (const e of spec.placementEdges ?? []) {
    stmts.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO placement_edge (routineRef, figureRef) VALUES (?, ?)",
      ).bind(e.routineRef, e.figureRef),
    );
  }
  for (const j of spec.journalEntries ?? []) {
    stmts.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO journal_entry (entryId, routineRef, authorId, kind, text, anchors, createdAt, updatedAt, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        j.entryId,
        j.routineRef,
        j.authorId,
        j.kind,
        j.text,
        JSON.stringify(j.anchors ?? []),
        j.createdAt ?? now,
        now,
        j.deletedAt ?? null,
      ),
    );
  }

  if (stmts.length > 0) await env.DB.batch(stmts);
  return spec;
}

/** Look up a user's role on a doc directly from D1 (mirrors the DO's role check). */
export async function roleFor(docRef: string, userId: string): Promise<MembershipRole | null> {
  const row = await env.DB.prepare(
    "SELECT role FROM membership WHERE docRef = ? AND userId = ? AND deletedAt IS NULL",
  )
    .bind(docRef, userId)
    .first<{ role: MembershipRole }>();
  return row?.role ?? null;
}
