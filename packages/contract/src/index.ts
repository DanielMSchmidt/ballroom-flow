// @ballroom/contract — Zod request/response schemas shared by web + worker.
// (Dependency direction: contract → domain; web/worker → contract.)
import { DANCE_IDS } from "@ballroom/domain";
import { z } from "zod";

/**
 * Create-routine request (US-025). This is the doc-name validation HOME (#79):
 * the title is trimmed, non-empty, and length-capped, and the dance is one of
 * the five v1 dances. Both the web form and the worker route validate against
 * this ONE schema so client and server never drift.
 */
export const zCreateRoutine = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give your routine a name")
    .max(80, "Keep the name under 80 characters"),
  dance: z.enum(DANCE_IDS),
});
export type CreateRoutine = z.infer<typeof zCreateRoutine>;

/** One row of the Choreo list (US-025). Projected from D1 — no CRDT content. */
export const zRoutineListItem = z.object({
  docRef: z.string(),
  title: z.string(),
  dance: z.enum(DANCE_IDS),
  /** The viewer's role on this routine ("owner" for ones they own). */
  role: z.enum(["owner", "editor", "commenter", "viewer"]),
  /** Last-projected update time (unix ms); ~create time for a fresh routine. */
  updatedAt: z.number(),
});
export type RoutineListItem = z.infer<typeof zRoutineListItem>;

export const zRoutineList = z.object({ routines: z.array(zRoutineListItem) });
export type RoutineList = z.infer<typeof zRoutineList>;
