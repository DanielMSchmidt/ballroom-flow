// attribute-predicate-anchors — predicate notes, server-mediated through the store seam.
//
// A predicate note is authored against an attribute condition (kind + value + optional role)
// and a scope (this choreo / this dance / every dance); the worker owns it and surfaces
// co-members' dance-/all-scoped notes on a shared routine (the co-membership gate lives
// server-side). Components reach this ONLY through the store — never lib/rpc directly.
import type { Anchor, AnnotationKind } from "@weavesteps/domain";
import { apiGet } from "../lib/rpc";
import type { OwnPredicateNote } from "./account";

/** A predicate note as the worker returns it (content + an attributePredicate anchor to
 *  match via matchPredicate). */
export interface PredicateNote {
  id: string;
  authorId: string;
  kind: AnnotationKind;
  text: string;
  attrKind: string;
  attrValue: string;
  role?: "leader" | "follower";
  scope: string;
  anchors: Anchor[];
  /** The note's timestamp — orders notes newest-first in the reading-view margin. The
   *  viewer's OWN notes read it live from the account doc's createdAt; co-members' notes
   *  get it from the REST projection's updatedAt. */
  createdAt?: number;
}

/** Load the predicate notes visible on `routineId` (members' dance-/all-scoped notes). */
export async function loadPredicateNotes(
  routineId: string,
  token: string | null,
  baseUrl = "",
): Promise<PredicateNote[]> {
  const { notes } = await apiGet<{ notes: PredicateNote[] }>(
    `${baseUrl}/api/routines/${routineId}/predicate-notes`,
    token,
  );
  return notes;
}

/** Shape an OwnPredicateNote (the account-doc self-read) as a PredicateNote for the merge. */
function ownToPredicateNote(n: OwnPredicateNote): PredicateNote {
  return {
    id: n.id,
    authorId: n.authorId,
    kind: n.kind,
    text: n.text,
    attrKind: n.attrKind,
    attrValue: n.attrValue,
    scope: n.scope,
    anchors: [
      {
        type: "attributePredicate",
        kind: n.attrKind,
        value: n.attrValue,
        scope: n.scope,
        ...(n.role ? { role: n.role } : {}),
        ...(n.scope === "routine" && n.routineRef ? { routineRef: n.routineRef } : {}),
      },
    ],
    createdAt: n.createdAt,
    ...(n.role ? { role: n.role } : {}),
  };
}

/** Does an own note apply to this routine (its dance / 'all' / a matching 'routine' ref)? */
function ownNoteApplies(n: OwnPredicateNote, routineId: string, dance: string): boolean {
  if (n.scope === "all") return true;
  if (n.scope === "routine") return n.routineRef === routineId;
  return n.scope === dance;
}

/**
 * Merge the user's OWN live predicate notes (self-read, offline-capable) into the co-member
 * REST rows for `routineId`, deduped by id with the REST row winning (it carries the joined
 * author fields). Own notes are filtered to those applying to this routine (scope 'all', the
 * routine's dance, or scope 'routine' with this routineRef). PURE.
 */
export function mergePredicateNotes(
  coMember: PredicateNote[],
  own: OwnPredicateNote[],
  currentUserId: string | undefined,
  routineId: string,
  dance: string,
): PredicateNote[] {
  if (!currentUserId || own.length === 0) return coMember;
  const seen = new Set(coMember.map((n) => n.id));
  const merged = [...coMember];
  for (const n of own) {
    if (seen.has(n.id)) continue;
    if (!ownNoteApplies(n, routineId, dance)) continue;
    merged.push(ownToPredicateNote(n));
  }
  return merged;
}
