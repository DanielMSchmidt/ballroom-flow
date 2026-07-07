// Ops tool — raise (or clear) a user's owned-routine cap without payment.
//
// Sets `users.routineCapOverride`, the nullable per-user cap the quota seam
// (`routineCapFor`, apps/worker/src/db/admin.ts) reads BEFORE the plan default
// (free = FREE_ROUTINE_CAP = 3). A friend stays on the `free` plan but gets a
// higher owned-routine limit. This is the "granted via ops tooling until the
// admin UI lands" path referenced in migration 0014_admin.sql.
//
// The user must have signed in at least once (that's what creates their D1 row);
// this script refuses to invent a row for an email/id it can't find.
//
// USAGE (run from repo root or apps/worker — both work):
//   pnpm --filter worker grant-cap -- --email friend@example.com --cap 15
//   pnpm --filter worker grant-cap -- --id user_2abc... --cap 15 --env production
//   pnpm --filter worker grant-cap -- --email friend@example.com --clear
//   pnpm --filter worker grant-cap -- --email friend@example.com --show
//
// FLAGS:
//   --email <e>   target user by email (as stored in the users table)
//   --id <sub>    target user by Clerk user id (users.id / JWT `sub`)
//   --cap <n>     set routineCapOverride to integer n (n >= 0)
//   --clear       reset routineCapOverride to NULL (back to the plan default)
//   --show        just print the current row; make no change
//   --env <e>     staging | production  (DEFAULT: staging — prod needs opt-in)
//
// It always prints the row BEFORE and AFTER so you can see the change land.
import { execFileSync } from "node:child_process";

const DB_BY_ENV = {
  staging: "weave-steps-staging",
  production: "weave-steps-production",
};

function parseArgs(argv) {
  const args = { env: "staging" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clear") args.clear = true;
    else if (a === "--show") args.show = true;
    else if (a === "--email") args.email = argv[++i];
    else if (a === "--id") args.id = argv[++i];
    else if (a === "--cap") args.cap = argv[++i];
    else if (a === "--env") args.env = argv[++i];
    else die(`unknown flag: ${a}`);
  }
  return args;
}

function die(msg) {
  console.error(`grant-cap: ${msg}`);
  process.exit(1);
}

// D1 has no bound-parameter surface via `wrangler d1 execute`, so we build SQL
// text. Guard the two inputs that reach it: emails/ids are validated against a
// conservative charset and single quotes are doubled — belt and suspenders, but
// this is an ops tool typing real user identifiers.
function sqlString(value) {
  if (!/^[\w.@+-]+$/.test(value)) die(`refusing unsafe identifier: ${value}`);
  return `'${value.replace(/'/g, "''")}'`;
}

/** Run one SQL statement against the chosen remote D1 and return its rows. */
function d1(dbName, env, sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", dbName, "--env", env, "--remote", "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  // `--json` prints `[{ results: [...], success, meta }]`.
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

function whereClause(args) {
  if (args.email && args.id) die("pass only one of --email / --id");
  if (args.email) return `email = ${sqlString(args.email)}`;
  if (args.id) return `id = ${sqlString(args.id)}`;
  die("target a user with --email <e> or --id <sub>");
}

function fetchRow(dbName, env, where) {
  const rows = d1(
    dbName,
    env,
    `SELECT id, email, plan, routineCapOverride FROM users WHERE ${where};`,
  );
  return rows[0] ?? null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbName = DB_BY_ENV[args.env];
  if (!dbName) die(`--env must be staging | production (got: ${args.env})`);

  const where = whereClause(args);

  const before = fetchRow(dbName, args.env, where);
  if (!before) {
    die(
      `no user matched (${where}) in ${dbName}. ` +
        `They must sign in once before a row exists to grant against.`,
    );
  }
  console.log(`[${args.env}] before:`, before);

  if (args.show) return;

  let setExpr;
  if (args.clear) {
    setExpr = "routineCapOverride = NULL";
  } else if (args.cap !== undefined) {
    if (!/^\d+$/.test(args.cap)) die(`--cap must be a non-negative integer (got: ${args.cap})`);
    setExpr = `routineCapOverride = ${Number.parseInt(args.cap, 10)}`;
  } else {
    die("nothing to do: pass --cap <n>, --clear, or --show");
  }

  d1(dbName, args.env, `UPDATE users SET ${setExpr} WHERE ${where};`);
  const after = fetchRow(dbName, args.env, where);
  console.log(`[${args.env}] after: `, after);
  console.log("grant-cap: done.");
}

main();
