// US-007 — Choreo fork (clone) (PLAN §2.4, §5.2, D12).
//
// The FROZEN fork path — the deliberate contrast to US-006's live overlay
// inheritance. "Make it your own" produces an independent, owned copy of a
// routine's ARRANGEMENT with provenance, and crucially NO pull mechanism: a
// later edit to the origin never appears in the clone (D12 / Q-FORK-UX). This is
// the opposite of a figure variant, where non-overridden base edits flow up
// live (`resolve`, US-006).
//
// What is and isn't copied (PLAN §5.2 — "Automerge `clone` of the routine doc"):
//   • the routine doc is `A.clone`d → an independent doc that retains the origin's
//     change history (AC-1 "retaining shared history") but never pulls future
//     origin edits — that is the freeze;
//   • only the identity fields change (fresh `id`, `ownerId`, `forkedFromRef`);
//     nested sections/placements KEEP their ids — a choreo fork is an
//     identity-preserving clone of the arrangement. (Re-minting nested ids is the
//     figure-variant / copy-on-write concern, US-008, not this.)
//   • `forkedFromRef` records lineage and is PROVENANCE-ONLY (nothing reads it to
//     pull changes);
//   • placements keep their `figureRef`s verbatim — the clone still references
//     the same live library figure docs (those diverge later via copy-on-write,
//     US-008), so a fork freezes the arrangement, not the figures.
import * as A from "@automerge/automerge";
import type { FigureDoc, Overlay, Placement, RoutineDoc } from "./doc-types";
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
 * Copy-on-write = auto-variant (PLAN §2.4, §5.2, Q-COW-TRIGGER). Editing a
 * figure you don't own (a global-library figure, or someone else's shared one)
 * silently spawns an account-scoped variant you own — a new figure doc with
 * `baseFigureRef` = the shared figure + an EMPTY overlay (it diverges nothing
 * yet; the edit that triggered this is applied afterward) — and re-points the
 * placement at the variant. The shared base is never mutated (no disturbance to
 * others). Editing a figure you ALREADY own edits in place (no variant), so the
 * change flows to all your routines that reference it (US-034).
 *
 * One rule covers "copy all info," "info flows up" (the variant resolves live
 * against its base, US-006), and "don't disturb others."
 *
 * @returns `{ variant, placement }` — `variant` is the new owned figure doc, or
 *   `null` when the user already owns the figure (edit-in-place signal); the
 *   returned `placement` is re-pointed to the variant (or the original unchanged
 *   when no COW happened). Pure: the inputs are never mutated.
 */
export function copyOnWrite(
  placement: Placement,
  sharedFigure: FigureDoc,
  byUser: string,
): { variant: FigureDoc | null; placement: Placement } {
  // Editing your own figure edits in place — no variant, placement unchanged.
  if (ownsFigure(sharedFigure, byUser)) {
    return { variant: null, placement };
  }

  const emptyOverlay: Overlay = { overrides: {}, tombstones: [], additions: [] };
  const variant: FigureDoc = {
    ...sharedFigure,
    id: newId(),
    scope: "account",
    ownerId: byUser,
    source: "custom",
    // A variant stores no base attributes — only its overlay against the base.
    attributes: [],
    baseFigureRef: sharedFigure.id,
    overlay: emptyOverlay,
    deletedAt: null,
  };

  return { variant, placement: { ...placement, figureRef: variant.id } };
}
