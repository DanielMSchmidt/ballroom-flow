// US-040 / US-041 — figure-family notes, server-mediated through the store seam.
//
// A family note is authored against a figure family + dance scope (this dance, or
// "all"); the worker owns it (authorId from the JWT) and surfaces co-members'
// notes on a shared routine (the co-membership gate lives server-side). Components
// reach this ONLY through the store — never lib/rpc directly (the boundary test).
import type { Anchor, AnnotationKind } from "@weavesteps/domain";
import { apiGet, apiPost } from "../lib/rpc";

/** A family note as the worker returns it (content + a figureType anchor to match). */
export interface FamilyNote {
  id: string;
  authorId: string;
  kind: AnnotationKind;
  text: string;
  figureType: string;
  danceScope: string;
  anchors: Anchor[];
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

/** Author a figure-family note (US-040). Returns the created note. */
export async function createFamilyNote(
  input: { figureType: string; danceScope: string; kind: AnnotationKind; text: string },
  token: string | null,
  baseUrl = "",
): Promise<FamilyNote> {
  return apiPost<FamilyNote>(`${baseUrl}/api/account/family-notes`, token, input);
}
