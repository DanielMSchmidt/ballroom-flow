// Fork, variants & overlay resolution (PLAN §2.4, §5.2, D12 ⟳v5).
//
// ⟳v5 (2026-07-02): figures are LIVE wherever referenced. The only automatic
// divergence is editing a GLOBAL (catalog) figure as a non-admin, which spawns a
// VARIANT — an account figure whose `baseFigureRef` is a LIVE link. A variant
// carries only the beats it OWNS; everything else resolves live from its base
// (`resolveFigure`, per-beat ownership — §2.5.1 #14–18), so catalog improvements
// keep flowing into a variant's untouched beats while its re-choreographed beats
// stay exactly as authored (the Passing Tumble Turn scenario, §5.2).
//
// A choreo fork ("make it your own") stays independent of its ORIGIN: the new
// routine is seeded from the origin's current state and every referenced ACCOUNT
// figure is copied for the forker (`copyFigureForFork` — a variant is copied AS a
// variant, so catalog flow-in continues); global refs stay live.
//
// The pre-v5 FROZEN copy path (`copyOnWrite`) is retained for reading legacy
// data and for the transition period, but new divergence goes through
// `spawnVariant`/`variantAttributesForEdit`.
import * as A from "@automerge/automerge";
import type { Attribute, FigureDoc, Placement, RoutineDoc } from "./doc-types";
import { newId } from "./ids";

/**
 * Clone a routine into a new, owned, frozen copy with lineage.
 *
 * @param doc    the origin routine Automerge doc.
 * @param byUser the id of the user who now owns the clone.
 * @returns a fresh, independent routine doc (new id, `forkedFromRef` = origin
 *   id, `ownerId` = byUser). Editing the origin afterwards does not affect the
 *   clone, and editing the clone does not affect the origin (`A.clone` yields an
 *   independent document).
 */
export function cloneRoutine(doc: A.Doc<RoutineDoc>, opts: { byUser: string }): A.Doc<RoutineDoc> {
  const originId = doc.id;
  const cloned = A.clone(doc);
  return A.change(cloned, (draft) => {
    draft.id = newId();
    draft.ownerId = opts.byUser;
    draft.forkedFromRef = originId; // provenance only — no pull
    // templateOf is not inherited — a clone is an owned routine, not a template.
    draft.templateOf = null;
  });
}

/**
 * True when `byUser` may edit `figure` in place (no copy-on-write needed): the
 * figure is account-scoped AND owned by them. Global-library figures are
 * app-owned and never editable in place, so they always trigger COW (§5.2).
 */
function ownsFigure(figure: FigureDoc, byUser: string): boolean {
  return figure.scope === "account" && figure.ownerId === byUser;
}

/**
 * Copy-on-write = freeze-on-edit-from-outside (PLAN §2.4, §5.2, Q-COW-TRIGGER).
 * Editing a figure you don't own (a global-library figure, or someone else's
 * shared one) silently spawns an account-scoped copy you own — a new figure doc
 * that is a FROZEN SNAPSHOT of the source's attributes at copy time, with
 * `baseFigureRef` = the source kept as PROVENANCE ONLY — and re-points the
 * placement at the copy. The copy carries its OWN attributes (a deep-ish clone of
 * the source's); there is no live overlay and no flow-up, so later edits to the
 * source never reach the copy, and edits to the copy never touch the source. The
 * shared base is never mutated (no disturbance to others). Editing a figure you
 * ALREADY own edits in place (no copy), so the change flows to all your routines
 * that reference it (US-034).
 *
 * @returns `{ variant, placement }` — `variant` is the new owned figure doc (the
 *   frozen copy), or `null` when the user already owns the figure (edit-in-place
 *   signal); the returned `placement` is re-pointed to the copy (or the original
 *   unchanged when no COW happened). Pure: the inputs are never mutated.
 */
export function copyOnWrite(
  placement: Placement,
  sharedFigure: FigureDoc,
  byUser: string,
): { variant: FigureDoc | null; placement: Placement } {
  // Editing your own figure edits in place — no copy, placement unchanged.
  if (ownsFigure(sharedFigure, byUser)) {
    return { variant: null, placement };
  }

  const variant: FigureDoc = {
    ...sharedFigure,
    id: newId(),
    scope: "account",
    ownerId: byUser,
    source: "custom",
    // A frozen snapshot: the copy owns a deep-ish clone of the source's
    // attributes at copy time. No overlay — later source edits never flow up.
    attributes: sharedFigure.attributes.map((a) => ({ ...a })),
    baseFigureRef: sharedFigure.id, // provenance only — not resolved live
    deletedAt: null,
  };

  return { variant, placement: { ...placement, figureRef: variant.id } };
}

// ─────────────────────────────────────────────────────────────────────────
// ⟳v5 — live overlay variants (PLAN §5.2, §2.5.1 #14–18, Q-OVERLAY-GRAIN).
// ─────────────────────────────────────────────────────────────────────────

/** Attribute meaning key — the same content comparison the "custom" badge uses
 *  (§2.5.1 #20): kind|count|role|value, ignoring `id` and `deletedAt`. */
const attrMeaning = (a: Attribute): string =>
  `${a.kind}|${a.count}|${a.role ?? ""}|${JSON.stringify(a.value)}`;

/** The whole beat a count belongs to: beat b covers counts in [b, b+1),
 *  including the sub-beat slots e/&/a (§2.5.1 #15). */
const beatOf = (count: number): number => Math.floor(count);

/**
 * The whole beats a variant OWNS (§2.5.1 #15): every beat it carries ANY
 * attribute on — live OR tombstoned, either role. A tombstoned attribute still
 * claims its beat, which is how "delete a base-provided value" is representable
 * (copy-down + tombstone, #16).
 */
export function ownedBeats(variant: Pick<FigureDoc, "attributes">): Set<number> {
  return new Set(variant.attributes.map((a) => beatOf(a.count)));
}

/**
 * Resolve a VARIANT against its live base — per-beat ownership (§2.5.1 #14–15):
 * an owned beat reads WHOLLY from the variant; an unowned beat reads WHOLLY from
 * the live base. New base values on unowned beats appear automatically; base
 * values on owned beats never leak in. `bars` falls back to the base when the
 * variant hasn't authored its own (§2.5.2). Pure — operates on plain snapshots;
 * tombstone dropping stays the reader's concern.
 *
 * A standalone figure (no `baseFigureRef`, or no base at hand) is its own
 * resolution — callers may pass it straight through.
 */
export function resolveFigure(
  base: Pick<FigureDoc, "attributes" | "counts" | "bars">,
  variant: FigureDoc,
): FigureDoc {
  const owned = ownedBeats(variant);
  const attributes = [
    ...variant.attributes,
    ...base.attributes.filter((a) => !owned.has(beatOf(a.count))),
  ].sort((x, y) => x.count - y.count);
  return {
    ...variant,
    attributes,
    ...(variant.counts == null && variant.bars == null
      ? {
          ...(base.counts != null ? { counts: base.counts } : {}),
          ...(base.bars != null ? { bars: base.bars } : {}),
        }
      : {}),
  };
}

/**
 * Compute a variant's OWNED attribute set from a full-timeline edit (§2.5.1
 * #15–16). The editor operates on the RESOLVED timeline and hands back the whole
 * intended content (`edited`); this keeps, per beat:
 *   • nothing, when the beat's live content still equals the base's (unowned —
 *     it keeps resolving live, so future base improvements arrive);
 *   • the edited beat's attributes verbatim, when they differ (the beat becomes
 *     owned — copy-down is implicit, since `edited` carries the beat's full
 *     intended content);
 *   • TOMBSTONED copies of the base's attributes, when the edit cleared the
 *     beat entirely (an empty owned beat is otherwise unrepresentable — #16).
 * Beats the base doesn't chart keep the edited content too (a variant may extend
 * past its base). Pure.
 */
export function variantAttributesForEdit(
  base: Pick<FigureDoc, "attributes">,
  edited: Attribute[],
  opts?: { now?: number },
): Attribute[] {
  const now = opts?.now ?? Date.now();
  const liveBase = base.attributes.filter((a) => a.deletedAt == null);
  const liveEdited = edited.filter((a) => a.deletedAt == null);
  const beats = new Set<number>([
    ...liveBase.map((a) => beatOf(a.count)),
    ...liveEdited.map((a) => beatOf(a.count)),
  ]);
  const out: Attribute[] = [];
  for (const beat of beats) {
    const baseAtBeat = liveBase.filter((a) => beatOf(a.count) === beat);
    const editedAtBeat = liveEdited.filter((a) => beatOf(a.count) === beat);
    const baseKeys = baseAtBeat.map(attrMeaning).sort();
    const editedKeys = editedAtBeat.map(attrMeaning).sort();
    const same =
      baseKeys.length === editedKeys.length && baseKeys.every((k, i) => k === editedKeys[i]);
    if (same) continue; // unowned — keeps resolving live from the base
    if (editedAtBeat.length > 0) {
      out.push(...editedAtBeat.map((a) => ({ ...a })));
    } else {
      // Cleared beat: own it with tombstoned copy-downs so it reads empty.
      out.push(...baseAtBeat.map((a) => ({ ...a, id: newId(), deletedAt: now })));
    }
  }
  return out.sort((x, y) => x.count - y.count);
}

/**
 * ⟳v5 variant spawn (PLAN §5.2): a non-admin editing a GLOBAL figure gets a live
 * overlay variant — a new account figure owning ONLY the edited beats (nothing,
 * when `editedAttributes` is omitted), with `baseFigureRef` as a LIVE link — and
 * the placement re-points to it. The base is never mutated (§2.5.1 #17). `bars`
 * is NOT copied: it resolves live from the base until the variant authors its
 * own (§2.5.2).
 */
export function spawnVariant(
  placement: Placement,
  globalFigure: FigureDoc,
  byUser: string,
  editedAttributes?: Attribute[],
  opts?: { now?: number },
): { variant: FigureDoc; placement: Placement } {
  const variant: FigureDoc = {
    id: newId(),
    scope: "account",
    ownerId: byUser,
    figureType: globalFigure.figureType,
    dance: globalFigure.dance,
    name: globalFigure.name,
    source: "custom",
    attributes: editedAttributes
      ? variantAttributesForEdit(globalFigure, editedAttributes, opts)
      : [],
    baseFigureRef: globalFigure.id, // LIVE link — unowned beats resolve from it
    schemaVersion: globalFigure.schemaVersion,
    deletedAt: null,
  };
  return { variant, placement: { ...placement, figureRef: variant.id } };
}

/**
 * ⟳v5 fork-copy (PLAN §2.4): copy an ACCOUNT figure for a choreo fork. The fork
 * must be independent of its ORIGIN's later edits, so the forker gets their own
 * doc — but a variant is copied AS A VARIANT (same `baseFigureRef`, same owned
 * beats), so catalog flow-in continues; a from-scratch custom is copied plain.
 * Global (catalog) references are NOT copied — the fork keeps them live.
 */
export function copyFigureForFork(figure: FigureDoc, byUser: string): FigureDoc {
  return {
    ...figure,
    id: newId(),
    scope: "account",
    ownerId: byUser,
    attributes: figure.attributes.map((a) => ({ ...a })),
    deletedAt: null,
  };
}
