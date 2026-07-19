#!/usr/bin/env node
// explain-query.mjs — run EXPLAIN QUERY PLAN for an arbitrary SQL statement
// against the REAL D1 schema (all apps/worker/migrations/*.sql applied in
// order to a throwaway in-memory SQLite DB). Lets you check "does this query
// hit an index?" without a running worker or any Cloudflare state.
//
// Read-only against the repo: only reads migration files; the DB is :memory:.
// D1 is SQLite, so sqlite's planner output here matches what D1 executes.
// NB: uses node:sqlite (Node >=22, prints an ExperimentalWarning — harmless).
//
// Usage:
//   node .claude/skills/ballroom-flow-diagnostics-and-tooling/scripts/explain-query.mjs \
//     "SELECT * FROM membership WHERE docRef = ?"
//   node ...explain-query.mjs --tables          # list tables + indexes instead
//
// Exit 0 = plan contains no full-table SCAN; exit 1 = SCAN found (printed);
// exit 2 = usage / SQL error.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// scripts/ -> skill dir -> .claude/skills -> .claude -> repo root
const root = path.resolve(here, "../../../..");
const migrationsDir = path.join(root, "apps/worker/migrations");

const db = new DatabaseSync(":memory:");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const f of files) {
  db.exec(readFileSync(path.join(migrationsDir, f), "utf8"));
}

const arg = process.argv.slice(2).join(" ").trim();
if (!arg) {
  console.error('usage: explain-query.mjs "<SQL with ? placeholders>" | --tables');
  process.exit(2);
}

if (arg === "--tables") {
  const rows = db
    .prepare(
      "SELECT type, name, tbl_name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, type DESC, name",
    )
    .all();
  for (const r of rows) console.log(`${r.type.padEnd(6)} ${r.tbl_name.padEnd(24)} ${r.name}`);
  process.exit(0);
}

let plan;
try {
  plan = db.prepare(`EXPLAIN QUERY PLAN ${arg}`).all();
} catch (err) {
  console.error(`SQL error: ${err.message}`);
  process.exit(2);
}

let scan = false;
console.log(`EXPLAIN QUERY PLAN (schema: ${files.length} migrations applied)`);
for (const row of plan) {
  const flag = /\bSCAN\b/.test(row.detail) ? "  ✗ SCAN" : "  ✓";
  if (/\bSCAN\b/.test(row.detail)) scan = true;
  console.log(`${flag}  ${row.detail}`);
}
if (scan) {
  console.log(
    "\nFAIL: full-table SCAN — every D1 list/registry/membership/quota query must use an index (docs/system/architecture.md § Global constraints).",
  );
  process.exit(1);
}
console.log("\nOK: every access path uses an index or PK search.");
