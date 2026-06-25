// US-013 — Migration ladder (schemaVersion envelope) (PLAN §2.1, §7, §10.2).
//
// Every document carries a `schemaVersion`. `migrate` walks an ORDERED ladder of
// per-version upgrade steps from the doc's version up to CURRENT_SCHEMA_VERSION,
// so an older doc (e.g. from a JSON import, US-048) is brought current one step
// at a time. Migrating a doc that's already current is a no-op.
//
// FORWARD-COMPATIBLE: a migration step transforms STRUCTURE only — it must never
// drop or rewrite unknown attribute *values* (an unknown value from a newer
// client survives the round-trip, §10.2). And it MUST NOT rewrite `figureType`,
// which is an immutable identity field (tasks #91/#92): a figure's family is
// stable for life, and variants/notes (US-011) rely on it never changing.
//
// There are no schema changes yet, so CURRENT is 1 and the ladder is empty — but
// the machinery is in place so a future v2 step plugs in by adding one entry to
// MIGRATIONS, with no caller changes.

/** The schema version every freshly-built document is tagged with. */
export const CURRENT_SCHEMA_VERSION = 1;

/** A document envelope: an opaque record that at least carries a schemaVersion. */
type VersionedDoc = { schemaVersion: number } & Record<string, unknown>;

/**
 * One upgrade step. Keyed by the version it migrates FROM; returns the doc shaped
 * for version `from + 1`. Steps must be pure, must preserve unknown values, and
 * must never touch `figureType` (immutable identity — see file header).
 */
type MigrationStep = (doc: VersionedDoc) => VersionedDoc;

/**
 * The ordered ladder, keyed by source version. `MIGRATIONS[n]` upgrades a v`n`
 * doc to v`n+1`. Empty today (no schema change since v1); add `1: (doc) => …`
 * here when v2 lands.
 */
const MIGRATIONS: Record<number, MigrationStep> = {};

/**
 * Run a `ladder` over `doc` up to `target`, applying each step in version order.
 * The core of `migrate`, factored out so the ladder mechanism + the figureType
 * guard are testable with a synthetic ladder (production has no v2 step yet).
 *
 * Guards the figureType-immutability invariant: if any step changed `figureType`,
 * that's a migration bug — throw rather than silently corrupt a figure's family
 * identity. An untagged doc is treated as v1 (the earliest version).
 *
 * @internal exported for tests; callers use {@link migrate}.
 */
export function runLadder(
  doc: unknown,
  ladder: Record<number, MigrationStep>,
  target: number,
): VersionedDoc {
  const input = doc as VersionedDoc;
  let current: VersionedDoc = input;
  const startVersion = typeof input.schemaVersion === "number" ? input.schemaVersion : 1;

  for (let version = startVersion; version < target; version++) {
    const step = ladder[version];
    if (!step) {
      throw new Error(`No migration step from schemaVersion ${version}`);
    }
    const originalFigureType = current.figureType;
    current = { ...step(current), schemaVersion: version + 1 };
    if ("figureType" in current && current.figureType !== originalFigureType) {
      throw new Error(
        `Migration from v${version} rewrote figureType (${String(originalFigureType)} → ${String(
          current.figureType,
        )}); figureType is immutable`,
      );
    }
  }

  return current;
}

/**
 * Bring `doc` up to `CURRENT_SCHEMA_VERSION` by applying each ladder step in
 * order from its current version. A doc already at current is returned
 * unchanged. An untagged doc is treated as v1.
 */
export function migrate(doc: unknown): VersionedDoc {
  return runLadder(doc, MIGRATIONS, CURRENT_SCHEMA_VERSION);
}

/** Re-exported so tests can build a synthetic ladder. @internal */
export type { MigrationStep };
