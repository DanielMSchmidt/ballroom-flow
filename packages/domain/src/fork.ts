// US-007 — Choreo fork (clone) (PLAN §2.4, §5.2, D12).
//
// The FROZEN fork path. "Make it your own" produces an independent, owned copy
// of a routine's ARRANGEMENT with provenance, and crucially NO pull mechanism: a
// later edit to the origin never appears in the clone (D12 / Q-FORK-UX).
//
// Copy-on-write (US-008) is the figure analogue: editing a figure that lives
// outside the choreo produces a FROZEN, choreo-owned copy — a snapshot of the
// source's attributes at copy time, with `baseFigureRef` kept as provenance
// only. There is NO live overlay and NO flow-up (the earlier live-overlay model
// is retired, §5.2 / §2.5.1 #14–18).
//
// What is and isn't copied (PLAN §5.2 — "Automerge `clone` of the routine doc"):
//   • the routine doc is `A.clone`d → an independent doc that retains the origin's
//     change history (AC-1 "retaining shared history") but never pulls future
//     origin edits — that is the freeze;
//   • only the identity fields change (fresh `id`, `ownerId`, `forkedFromRef`);
//     nested sections/placements KEEP their ids — a choreo fork is an
//     identity-preserving clone of the arrangement. (Re-minting nested ids is the
//     figure copy-on-write concern, US-008, not this.)
//   • `forkedFromRef` records lineage and is PROVENANCE-ONLY (nothing reads it to
//     pull changes);
//   • placements keep their `figureRef`s verbatim — the clone still references
//     the same library figure docs (those diverge later via copy-on-write,
//     US-008), so a fork freezes the arrangement, not the figures.
import * as A from "@automerge/automerge";
import type { FigureDoc, Placement, RoutineDoc } from "./doc-types";
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
