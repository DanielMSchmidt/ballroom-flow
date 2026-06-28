// US-013 — Migration ladder (schemaVersion envelope) (PLAN §2.1, §7, §10.2).
//
// Every document carries a `schemaVersion`. `migrate` walks an ORDERED ladder of
// per-version upgrade steps from the doc's version up to CURRENT_SCHEMA_VERSION,
// so an older doc (e.g. from a JSON import, US-048) is brought current one step
// at a time. Migrating a doc that's already current is a no-op.
//
// FORWARD-COMPATIBLE: a migration step transforms STRUCTURE only — it must never
// drop or rewrite unknown attribute *values* (an unknown value from a newer
// client survives the round-trip, §10.2; a value-touching step must itself be a
// US-012-style lenient transform). And it MUST NOT rewrite the immutable identity
// fields `figureType` or `dance` (tasks #91/#92): a figure copies both from its
// base at creation (US-008) and family-note matching (US-011) + visibility
// (US-041) depend on them being stable for life. The ladder enforces this — a
// step that changes either throws.
//
// There are no schema changes yet, so CURRENT is 1 and the ladder is empty — but
// the machinery is in place so a future v2 step plugs in with TWO localized edits
// in this file (add a `MIGRATIONS[1]` entry AND bump CURRENT_SCHEMA_VERSION = 2),
// with no caller changes.

/** The schema version every freshly-built document is tagged with. */
export const CURRENT_SCHEMA_VERSION = 2;

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
const MIGRATIONS: Record<number, MigrationStep> = {
  // v1 → v2 (2026-06-28 notation parity): the `step` attribute kind is renamed
  // to `footwork`. Retag every `kind:"step"` attribute → `footwork`, in both a
  // figure's own timeline and a variant overlay's additions. STRUCTURE-ONLY:
  // values are preserved verbatim (lossless — the read-side aliases handle the
  // legacy single tokens H/T), unknown values survive, and `figureType`/`dance`
  // are untouched (the ladder guard enforces that). Docs without `attributes`
  // (routine docs) pass through unchanged but for the version bump.
  1: (doc) => {
    const retag = (a: unknown): unknown =>
      a && typeof a === "object" && (a as { kind?: unknown }).kind === "step"
        ? { ...(a as object), kind: "footwork" }
        : a;
    // Only touch keys that already exist — NEVER spread back an absent key as
    // `undefined` (Automerge cannot store `undefined`; doing so corrupts routine
    // docs and broke template forks).
    const out: VersionedDoc = { ...doc };
    if (Array.isArray(doc.attributes)) out.attributes = doc.attributes.map(retag);
    if (doc.overlay && typeof doc.overlay === "object") {
      const ov = doc.overlay as { additions?: unknown };
      if (Array.isArray(ov.additions)) {
        out.overlay = { ...ov, additions: ov.additions.map(retag) };
      }
    }
    return out;
  },
};

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

  // A doc already at — or NEWER than — `target` skips the loop and is returned
  // unchanged: an older client must not hard-fail on a doc from a newer schema
  // (forward-compat, pairs with US-012 lenient read), and re-migrating a current
  // doc is a no-op.
  for (let version = startVersion; version < target; version++) {
    const step = ladder[version];
    if (!step) {
      throw new Error(`No migration step from schemaVersion ${version}`);
    }
    const before = IMMUTABLE_IDENTITY_FIELDS.map((f) => current[f]);
    current = { ...step(current), schemaVersion: version + 1 };
    assertIdentityUnchanged(current, before, version);
  }

  return current;
}

// Identity fields a figure copies at creation (US-008 copyOnWrite) and that
// family-note matching (US-011 `matchesFigureType`) + visibility (US-041) depend
// on: they are STABLE FOR LIFE. A migration must never rewrite them, or it would
// silently diverge existing variants/notes from their family (#91/#92).
const IMMUTABLE_IDENTITY_FIELDS = ["figureType", "dance"] as const;

/** Throw if a migration step changed any immutable identity field. */
function assertIdentityUnchanged(
  after: VersionedDoc,
  before: ReadonlyArray<unknown>,
  fromVersion: number,
): void {
  IMMUTABLE_IDENTITY_FIELDS.forEach((field, i) => {
    if (field in after && after[field] !== before[i]) {
      throw new Error(
        `Migration from v${fromVersion} rewrote ${field} (${String(before[i])} → ${String(
          after[field],
        )}); ${field} is immutable`,
      );
    }
  });
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
