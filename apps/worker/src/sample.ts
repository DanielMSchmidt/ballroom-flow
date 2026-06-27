// apps/worker/src/sample.ts
// US-045 — seed the app-owned READ-ONLY sample routine (a start-from-template
// source). Projects the shared SAMPLE_ROUTINE fixture + its figures with
// ownerId "app"; idempotent (seedDoc is no-clobber; registry inserts use ON
// CONFLICT DO NOTHING). Distinct from the onboarding gift (starter.ts), which
// FORKS this template into an owned copy.
import { SAMPLE_FIGURE_LIBRARY, SAMPLE_ROUTINE } from "@ballroom/domain/fixtures";
import { drizzle } from "drizzle-orm/d1";
import { createFigureRows } from "./db/figures";
import { linkPlacement } from "./db/placement-edge";
import { documentRegistry, membership } from "./db/schema";
import type { Env } from "./index";

export const APP_OWNER = "app";

/** Seed the app-owned sample routine; returns the routine's id. Idempotent. */
export async function seedSampleRoutine(env: Env): Promise<string> {
  const routine = SAMPLE_ROUTINE;

  // Seed the figures that appear in the routine (figures first so the routine's
  // placement edges + cascade access resolve). createFigureRows is upsert-safe.
  const figureIds = new Set(routine.sections.flatMap((s) => s.placements.map((p) => p.figureRef)));
  for (const id of figureIds) {
    const fig = SAMPLE_FIGURE_LIBRARY[id];
    if (!fig) continue;
    await createFigureRows(env.DB, {
      figureRef: fig.id,
      ownerId: APP_OWNER,
      name: fig.name,
      dance: fig.dance,
      figureType: fig.figureType,
    });
    await env.DOC_DO.get(env.DOC_DO.idFromName(fig.id)).seedDoc(
      fig as unknown as Record<string, unknown>,
    );
    await linkPlacement(env.DB, routine.id, fig.id);
  }

  // Seed the routine registry row + an owner membership for "app".
  // Uses ON CONFLICT DO NOTHING so a re-run (e.g. across cold starts that both
  // see sampleSeeded=false from module reset) is harmless.
  const now = Date.now();
  const d = drizzle(env.DB);
  await d.batch([
    d
      .insert(documentRegistry)
      .values({
        docRef: routine.id,
        type: "routine",
        ownerId: APP_OWNER,
        doName: routine.id,
        title: routine.title,
        dance: routine.dance,
        updatedAt: now,
      })
      .onConflictDoNothing(),
    d
      .insert(membership)
      .values({
        id: `mem_${APP_OWNER}_${routine.id}`,
        docRef: routine.id,
        userId: APP_OWNER,
        role: "editor",
        createdAt: now,
      })
      .onConflictDoNothing(),
  ]);

  // Seed the routine's CRDT content (no-clobber; templateOf marks it as a
  // start-from-template source per SAMPLE_ROUTINE fixture).
  await env.DOC_DO.get(env.DOC_DO.idFromName(routine.id)).seedDoc({
    ...routine,
    ownerId: APP_OWNER,
    schemaVersion: 1,
    deletedAt: null,
  } as unknown as Record<string, unknown>);

  return routine.id;
}
