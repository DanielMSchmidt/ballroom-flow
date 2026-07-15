// US-040 / US-041 — figure-family notes, server-mediated through the store seam.
//
// A family note is authored against a figure family + dance scope (this dance, or
// "all"); the worker owns it (authorId from the JWT) and surfaces co-members'
// notes on a shared routine (the co-membership gate lives server-side). Components
// reach this ONLY through the store — never lib/rpc directly (the boundary test).
import type { Anchor, AnnotationKind } from "@weavesteps/domain";
import { apiGet, apiPost } from "../lib/rpc";

/** A family note as the worker returns it (content + a figureType anchor to match).
 *  A TIMED note (WEP-0004) additionally carries the count it pins to and the
 *  side it narrows to; absent = the untimed v1 whole-figure note. */
export interface FamilyNote {
  id: string;
  authorId: string;
  kind: AnnotationKind;
  text: string;
  figureType: string;
  danceScope: string;
  count?: number;
  role?: "leader" | "follower";
  anchors: Anchor[];
  /** The note's timestamp, used to order notes newest-first in the reading-view
   *  notes margin. The viewer's OWN notes read it live from the account doc's
   *  `createdAt`; co-members' notes get it from the REST projection's `updatedAt`
   *  (the v1 index tracks no separate created time). Optional only for forward
   *  compatibility with an older worker that omits it. */
  createdAt?: number;
}

/** Load the family notes visible on `routineId` (members' notes for its dance). */
export async function loadFamilyNotes(
  routineId: string,
  token: string | null,
  baseUrl = "",
): Promise<FamilyNote[]> {
  const { notes } = await apiGet<{ notes: FamilyNote[] }>(
    `${baseUrl}/api/routines/${routineId}/family-notes`,
    token,
  );
  return notes;
}

/** Author a figure-family note (US-040; WEP-0004 adds the optional timed
 *  fields — the worker rejects count/role with danceScope "all"). Returns the
 *  created note. */
export async function createFamilyNote(
  input: {
    figureType: string;
    danceScope: string;
    kind: AnnotationKind;
    text: string;
    count?: number;
    role?: "leader" | "follower";
  },
  token: string | null,
  baseUrl = "",
): Promise<FamilyNote> {
  return apiPost<FamilyNote>(`${baseUrl}/api/account/family-notes`, token, input);
}
