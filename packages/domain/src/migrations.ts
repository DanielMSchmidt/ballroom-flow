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
// CURRENT is 6 (v1→v2: step→footwork retag; v2→v3: strip legacy `overlay` key;
// v3→v4: backfill section/placement `sortKey`; v4→v5: legacy `bars` → `counts`;
// v5→v6: lift a figure's `counts` to cover its step span, §2.5.2). A future step
// adds TWO localized edits here (add a `MIGRATIONS[n]` entry AND bump
// CURRENT_SCHEMA_VERSION), with no caller changes.
//
// WIRED (2026-07-02, v5 milestone step 1, PLAN §7): the DO load path
// (`apps/worker/src/doc-do.ts` `loadPersisted`) runs this ladder on every
// persisted doc via {@link migrateDraft} below and PERSISTS the upgrade as a
// normal (migration-actor-attributed) change, so an older doc is brought
// current in storage — not just lenient-read-shimmed on the way out. Every
// fresh-doc call site stamps `CURRENT_SCHEMA_VERSION` (never a literal `1`).

import { DANCES, isDanceId } from "./dances";
import { isPlainRecord } from "./guards";
import { sequentialKeys } from "./order";

/** The schema version every freshly-built document is tagged with. */
export const CURRENT_SCHEMA_VERSION = 6;

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
 * doc to v`n+1`. A new step adds the next `MIGRATIONS[n]` here (see the file header).
 */
const MIGRATIONS: Record<number, MigrationStep> = {
  // v1 → v2 (2026-06-28 notation parity): the `step` attribute kind is renamed
  // to `footwork`. Retag every `kind:"step"` attribute → `footwork` in a
  // figure's own timeline. STRUCTURE-ONLY: values are preserved verbatim
  // (lossless — the read-side aliases handle the legacy single tokens H/T),
  // unknown values survive, and `figureType`/`dance` are untouched (the ladder
  // guard enforces that). Docs without `attributes` (routine docs) pass through
  // unchanged but for the version bump.
  1: (doc) => {
    const retag = (a: unknown): unknown =>
      isPlainRecord(a) && a.kind === "step" ? { ...a, kind: "footwork" } : a;
    // Only touch keys that already exist — NEVER spread back an absent key as
    // `undefined` (Automerge cannot store `undefined`; doing so corrupts routine
    // docs and broke template forks).
    const out: VersionedDoc = { ...doc };
    if (Array.isArray(doc.attributes)) out.attributes = doc.attributes.map(retag);
    return out;
  },

  // v2 → v3 (2026-06-30 overlay removal): the `Overlay` interface and the
  // `overlay?` field on `FigureDoc` are retired. Strip any stray `overlay` key
  // that a pre-removal doc carries so it does not linger in persisted documents.
  // CRITICAL: never assign `undefined` — Automerge cannot store it. Build a new
  // object WITHOUT the key rather than setting it to undefined.
  2: (doc) => {
    if (!("overlay" in doc)) return doc;
    const { overlay: _dropped, ...rest } = doc;
    return rest;
  },

  // v3 → v4 (#63 same-section reorder convergence): assign a fractional-index
  // `sortKey` to every section and to every placement within each section, IN
  // THEIR CURRENT ARRAY ORDER, so reorder becomes a per-field update that
  // converges under concurrency (PLAN §5.3). Deterministic — every replica that
  // migrates the same persisted bytes assigns identical keys, so the backfill
  // itself converges. STRUCTURE-ONLY: only ADD `sortKey` (never rewrite an
  // existing one), never write `undefined` back (Automerge can't store it — so a
  // doc without `sections`/`placements` passes through untouched), and the
  // immutable identity fields are not touched. Figure/account docs (no
  // `sections`) get the version bump alone.
  3: (doc) => {
    if (!Array.isArray(doc.sections)) return { ...doc };
    const sectionKeys = sequentialKeys(doc.sections.length);
    const sections = doc.sections.map((section, i) => {
      if (!isPlainRecord(section)) return section;
      const out: Record<string, unknown> = { ...section };
      const placements: unknown = section.placements;
      if (Array.isArray(placements)) {
        const placementKeys = sequentialKeys(placements.length);
        out.placements = placements.map((p: unknown, j) => {
          if (!isPlainRecord(p) || "sortKey" in p) return p;
          return { ...p, sortKey: placementKeys[j] };
        });
      }
      if (!("sortKey" in section)) out.sortKey = sectionKeys[i];
      return out;
    });
    return { ...doc, sections };
  },

  // v4 → v5 (Builder v3 ①, owner decision 2026-07-07): counts-based figure
  // length. A figure doc's authored `bars` becomes `counts = bars × the dance's
  // beatsPerBar`, and the legacy `bars` key is dropped — `bars` is DERIVED from
  // counts everywhere after this (⌈counts / beatsPerBar⌉, figure-grid.ts).
  // DETERMINISTIC (the meter comes from the doc's own immutable `dance`);
  // STRUCTURE-ONLY otherwise; a doc without `bars` (routine/account docs, or a
  // figure authored counts-first by a newer client) passes through unchanged —
  // except that a figure carrying BOTH keeps its authored `counts` and only
  // drops the stale `bars` (never double-converts).
  4: (doc) => {
    if (typeof doc.bars !== "number") return { ...doc };
    const { bars, ...rest } = doc;
    if (typeof doc.counts === "number") return rest; // counts wins
    const dance = isDanceId(doc.dance) ? doc.dance : undefined;
    const meter = dance ? DANCES[dance] : undefined;
    if (!meter) return { ...doc }; // not a figure doc we can meter — leave as-is
    // Clamp to the authored 1–64 ceiling the create schema + LENGTH stepper both
    // enforce (§2.5.2) — a legacy figure with an out-of-range `bars` must not
    // migrate to a counts value the rest of the system treats as impossible.
    const counts = Math.min(64, Math.max(1, Math.floor(bars)) * meter.beatsPerBar);
    return { ...rest, counts };
  },

  // v5 → v6 (figure-length invariant, 2026-07-14): a figure's authored `counts`
  // must cover its step SPAN — the highest whole beat any live step occupies.
  // The pre-fix default computed length as the NUMBER of distinct steps, which
  // undershoots whenever a figure holds a Slow (2 beats, 1 count → a gap): the
  // Foxtrot Feather Step "SQQ" steps on counts 1, 3, 4 but was seeded counts:3,
  // so its count-4 step fell off the grid (§2.5.2). Lift a too-short `counts` to
  // its span so every existing production figure — and the choreos referencing
  // it — renders every step. STRUCTURE-ONLY, DETERMINISTIC (the span comes from
  // the doc's own attributes); a doc with no numeric `counts` (routine/account
  // docs, or a figure whose length derives live from its base) and a figure
  // already long enough pass through with the version bump alone. The span floor
  // wins over the §2.5.2 1–64 ceiling — an orphaned step is worse than an
  // over-long figure (real seed spans are far under 64).
  5: (doc) => {
    if (typeof doc.counts !== "number" || !Array.isArray(doc.attributes)) return { ...doc };
    let span = 0;
    for (const a of doc.attributes) {
      if (!isPlainRecord(a) || a.deletedAt != null) continue;
      if (typeof a.count === "number") span = Math.max(span, Math.floor(a.count));
    }
    if (span <= doc.counts) return { ...doc };
    return { ...doc, counts: span };
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
  if (!isPlainRecord(doc)) {
    throw new Error("cannot migrate a non-object document");
  }
  const startVersion = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 1;
  // Normalizing the envelope up front (untagged ⇒ v1) is what keeps this
  // cast-free: `{ ...doc, schemaVersion }` IS a VersionedDoc by construction.
  let current: VersionedDoc = { ...doc, schemaVersion: startVersion };

  // A doc already at — or NEWER than — `target` skips the loop and is returned
  // value-unchanged (as the normalized shallow copy above): an older client
  // must not hard-fail on a doc from a newer schema
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

/**
 * A live, mutable document — a caller passes an Automerge DRAFT (the object
 * inside an `A.change` callback), not a detached plain object. Kept as a
 * structural type (no `@automerge/automerge` import here) — a draft behaves
 * like a plain object for reads/writes/deletes, which is all this file needs.
 * The envelope is NOT required statically: a pre-envelope doc has no
 * `schemaVersion` at runtime and is treated as v1 (same leniency as
 * {@link runLadder}), so demanding it in the type would just force casts at
 * every call site that migrates an untyped draft.
 */
type MutableVersionedDoc = Record<string, unknown>;

/**
 * Bring an Automerge DRAFT up to `CURRENT_SCHEMA_VERSION`, mutating it in
 * place — the DO load path's counterpart to {@link migrate} (which returns a
 * new plain object; a draft must instead be WRITTEN TO inside its `A.change`
 * transaction so the upgrade is captured as a real, persistable change).
 *
 * `migrate` (the pure ladder over a plain object) stays the single source of
 * truth for WHAT a migration does; this function only decides HOW to replay
 * that onto a live draft: read the draft as a detached snapshot (a draft
 * enumerates/serializes like a plain object — see `proxies.js`'s `ownKeys`/
 * `getOwnPropertyDescriptor` traps — so a JSON round-trip is a safe, cheap
 * materialize), run the ladder once, then write back only the top-level keys
 * that actually changed (plus delete any key the ladder dropped, e.g. the
 * v2→v3 `overlay` strip) — never touching keys the ladder left alone, so an
 * untouched sub-tree keeps its Automerge object identity.
 *
 * A doc already at or above `CURRENT_SCHEMA_VERSION` is left COMPLETELY
 * untouched (no field writes) — the caller can therefore tell "nothing to do"
 * apart from "migrated" by checking whether the enclosing `A.change` produced
 * any changes at all (PLAN §7: no empty change, no version downgrade).
 *
 * DETERMINISM (PLAN §5.3): `migrate` is pure and the v3→v4 sortKey backfill
 * assigns keys from array order alone, so two callers who migrate the same
 * starting doc bytes compute byte-identical `after` values — the ladder's
 * existing convergence guarantee carries over unchanged; this function adds
 * no non-determinism of its own (no randomness, no wall-clock reads).
 */
export function migrateDraft(draft: MutableVersionedDoc): void {
  const from = typeof draft.schemaVersion === "number" ? draft.schemaVersion : 1;
  if (from >= CURRENT_SCHEMA_VERSION) return; // already current — untouched.

  const parsed: unknown = JSON.parse(JSON.stringify(draft));
  if (!isPlainRecord(parsed)) return; // unreachable: a draft serializes to an object
  const before = parsed;
  const after = migrate(before);

  // Drop any key the ladder removed (e.g. the v2→v3 `overlay` strip). NEVER
  // assign `undefined` — Automerge cannot store it — so a removed key is
  // deleted, not nulled out.
  for (const key of Object.keys(before)) {
    if (!(key in after)) delete draft[key];
  }
  // Write back only keys whose value actually changed, so an untouched
  // sub-tree (the common case for most docs — most steps are no-ops on most
  // shapes) keeps its existing Automerge object identity/history.
  for (const key of Object.keys(after)) {
    if (key === "schemaVersion") continue; // set once, below.
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      draft[key] = after[key];
    }
  }
  draft.schemaVersion = after.schemaVersion;
}
