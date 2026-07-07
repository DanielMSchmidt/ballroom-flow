// D30 ⟳ (owner decision 2026-07-07): the SEED is authoritative for seeded content.
//
// Global figure docs are imported once from the bundled catalog and then LIVE as
// real Automerge docs. When the catalog is refined (e.g. the WDSF technique-book
// re-chart), re-running the seeder must carry those corrections into the already-
// imported docs — WITHOUT breaking anything users built on top:
//
//   • Seeded attributes carry the seeder's DETERMINISTIC ids (`fig-…` from
//     buildWdsfAttributes' authored path, `wdsf-…` from the scaffold path), so the
//     seed can own exactly its own rows: update them in place, add new ones, and
//     TOMBSTONE (never remove) the ones the seed no longer carries.
//   • User/admin-ADDED attributes are client-generated ULIDs — never touched.
//   • Variants are separate account docs resolved per-beat against the base
//     (§5.2): their owned beats are theirs, their unowned beats pick the refreshed
//     base up automatically. Plain placements are live references and simply
//     render the corrected content.
//
// SINGLE-WRITER: this runs only inside the figure's own Durable Object (one DO per
// doc), so upserting by deterministic id cannot race across replicas — two
// concurrent reconciles would otherwise both insert "new" list items with the
// same id. Do not call it from any other seam.
import * as A from "@automerge/automerge";
import type { Alignment, Attribute, FigureDoc } from "./doc-types";

/** The seeder's deterministic id prefixes — the rows the seed OWNS. */
export function isSeededAttributeId(id: string): boolean {
  return /^(fig|wdsf)-/.test(id);
}

export interface SeedFigureContent {
  name: string;
  /** The authored beat length (§2.5.2 counts model — bars derive from it). */
  counts?: number;
  entryAlignment?: Alignment;
  exitAlignment?: Alignment;
  attributes: readonly Attribute[];
}

/** The per-attribute fields the seed owns (id is the key; deletedAt is handled
 *  separately so a reconcile can also resurrect a tombstoned seeded row). */
const ATTR_FIELDS = ["kind", "count", "role", "value"] as const;

/** Copy one seed-owned field from a source attribute onto a live row. The generic
 *  key `K` lets TS prove `source[field]` and `row[field]` are the SAME type, so the
 *  field-wise assignment needs no cast/any (CLAUDE.md §4) — the correlated-union
 *  write that a `{field, value}` record can't express. */
function copyAttrField<K extends keyof Attribute>(
  row: Attribute,
  source: Attribute,
  field: K,
): void {
  row[field] = source[field];
}

function sameAlignment(a: Alignment | undefined, b: Alignment | undefined): boolean {
  if (!a || !b) return a === b;
  return a.qualifier === b.qualifier && a.direction === b.direction;
}

/**
 * Reconcile an imported global figure doc to the current seed content. Returns
 * the updated doc and whether anything changed; a doc already matching the seed
 * is returned as-is (no empty change is appended). `opts.now` stamps the
 * tombstones of seeded attributes the seed dropped (pass a fixed value in tests).
 */
export function reconcileSeededFigure(
  doc: A.Doc<FigureDoc>,
  seed: SeedFigureContent,
  opts?: { now?: number },
): { doc: A.Doc<FigureDoc>; changed: boolean } {
  const now = opts?.now ?? Date.now();
  const seedById = new Map(seed.attributes.map((a) => [a.id, a]));

  // Plan the mutations against the CURRENT doc first: an empty plan means we
  // return the doc untouched instead of appending an empty Automerge change.
  const existingById = new Map<string, { index: number; attr: Attribute }>();
  doc.attributes.forEach((attr, index) => {
    existingById.set(attr.id, { index, attr });
  });

  const updates: Array<{ index: number; field: (typeof ATTR_FIELDS)[number]; source: Attribute }> =
    [];
  const resurrect: number[] = [];
  const additions: Attribute[] = [];
  const tombstone: number[] = [];

  for (const sa of seed.attributes) {
    const found = existingById.get(sa.id);
    if (!found) {
      additions.push(sa);
      continue;
    }
    for (const field of ATTR_FIELDS) {
      const want = sa[field] ?? null;
      const have = found.attr[field] ?? null;
      if (want !== have) updates.push({ index: found.index, field, source: sa });
    }
    if (found.attr.deletedAt != null) resurrect.push(found.index);
  }
  for (const [id, { index, attr }] of existingById) {
    if (isSeededAttributeId(id) && !seedById.has(id) && attr.deletedAt == null) {
      tombstone.push(index);
    }
  }

  const nameChanged = doc.name !== seed.name;
  const countsChanged = seed.counts !== undefined && doc.counts !== seed.counts;
  const entryChanged =
    seed.entryAlignment !== undefined && !sameAlignment(doc.entryAlignment, seed.entryAlignment);
  const exitChanged =
    seed.exitAlignment !== undefined && !sameAlignment(doc.exitAlignment, seed.exitAlignment);

  const changed =
    updates.length > 0 ||
    resurrect.length > 0 ||
    additions.length > 0 ||
    tombstone.length > 0 ||
    nameChanged ||
    countsChanged ||
    entryChanged ||
    exitChanged;
  if (!changed) return { doc, changed: false };

  const next = A.change(doc, "seed: reconcile to the current catalog", (d) => {
    if (nameChanged) d.name = seed.name;
    if (countsChanged && seed.counts !== undefined) d.counts = seed.counts;
    if (entryChanged && seed.entryAlignment) d.entryAlignment = { ...seed.entryAlignment };
    if (exitChanged && seed.exitAlignment) d.exitAlignment = { ...seed.exitAlignment };
    for (const u of updates) {
      const row = d.attributes[u.index];
      if (!row) continue;
      copyAttrField(row, u.source, u.field);
    }
    for (const index of resurrect) {
      const row = d.attributes[index];
      if (row) row.deletedAt = null;
    }
    for (const index of tombstone) {
      const row = d.attributes[index];
      if (row) row.deletedAt = now; // soft-delete only — never hard removal
    }
    for (const sa of additions) {
      d.attributes.push({ ...sa, deletedAt: sa.deletedAt ?? null });
    }
  });
  return { doc: next, changed: true };
}
