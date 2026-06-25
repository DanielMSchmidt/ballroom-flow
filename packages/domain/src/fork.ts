// US-007 — Choreo fork (clone) (PLAN §2.4, §5.2, D12).
//
// The FROZEN fork path — the deliberate contrast to US-006's live overlay
// inheritance. "Make it your own" produces an independent, owned copy of a
// routine's ARRANGEMENT with provenance, and crucially NO pull mechanism: a
// later edit to the origin never appears in the clone (D12 / Q-FORK-UX). This is
// the opposite of a figure variant, where non-overridden base edits flow up
// live (`resolve`, US-006).
//
// What is and isn't copied:
//   • the routine doc's structure (sections → placements) is deep-copied into a
//     brand-new Automerge doc with a fresh id, so origin and clone never share
//     mutable state — the freeze is structural, not a snapshot-and-hope;
//   • `forkedFromRef` records lineage and is PROVENANCE-ONLY (nothing reads it to
//     pull changes);
//   • placements keep their `figureRef`s verbatim — the clone still references
//     the same live library figure docs (those diverge later via copy-on-write,
//     US-008), so a fork freezes the arrangement, not the figures.
import type * as A from "@automerge/automerge";
import { buildDoc, materialize } from "./doc-internal";
import type { RoutineDoc } from "./doc-types";
import { newId } from "./ids";

/**
 * Clone a routine into a new, owned, frozen copy with lineage.
 *
 * @param doc    the origin routine Automerge doc.
 * @param byUser the id of the user who now owns the clone.
 * @returns a fresh, independent routine doc (new id, `forkedFromRef` = origin
 *   id, `ownerId` = byUser). Editing the origin afterwards does not affect it.
 */
export function cloneRoutine(doc: A.Doc<RoutineDoc>, opts: { byUser: string }): A.Doc<RoutineDoc> {
  const origin = materialize(doc); // detached, mutable POJO of the origin's content

  const clone: RoutineDoc = {
    ...origin,
    id: newId(),
    ownerId: opts.byUser,
    forkedFromRef: origin.id, // provenance only — no pull
    // sections/placements (and their figureRefs) carry over verbatim; templateOf
    // is not inherited — a clone is an owned routine, not a template source.
    templateOf: null,
  };

  // buildDoc seeds a brand-new Automerge document from the deep-copied content,
  // so the clone shares no structure with the origin (the freeze is structural).
  return buildDoc(clone as unknown as Record<string, unknown>) as A.Doc<RoutineDoc>;
}
