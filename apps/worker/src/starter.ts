// apps/worker/src/starter.ts
// US-055 — seed the default "Golden Waltz Basic" starter routine for a user.
// Materializes the routine + its figures via the pure domain builder, then
// projects + server-seeds them with the same primitives the /api/figures and
// /api/routines routes use. Figures are projected + DO-seeded FIRST (so the
// routine's references + cascade edges resolve), then the routine. `seedDoc` is
// no-clobber, so a re-run on the same ids is safe.
import { buildGoldenWaltzBasic, newId } from "@ballroom/domain";
import { createFigureRows } from "./db/figures";
import { linkPlacement } from "./db/placement-edge";
import { createOwnedRoutine } from "./db/routines";
import type { Env } from "./index";

/** Seed the starter routine for `userId`; returns the new routine's id. */
export async function seedStarterRoutine(env: Env, userId: string): Promise<string> {
  const { routine, figures } = buildGoldenWaltzBasic(userId, newId);

  for (const figure of figures) {
    await createFigureRows(env.DB, {
      figureRef: figure.id,
      ownerId: userId,
      name: figure.name,
      dance: figure.dance,
      figureType: figure.figureType,
    });
    await env.DOC_DO.get(env.DOC_DO.idFromName(figure.id)).seedDoc(
      figure as unknown as Record<string, unknown>,
    );
    await linkPlacement(env.DB, routine.id, figure.id);
  }

  await createOwnedRoutine(env.DB, {
    docRef: routine.id,
    ownerId: userId,
    title: routine.title,
    dance: routine.dance,
  });
  await env.DOC_DO.get(env.DOC_DO.idFromName(routine.id)).seedDoc(
    routine as unknown as Record<string, unknown>,
  );

  return routine.id;
}
