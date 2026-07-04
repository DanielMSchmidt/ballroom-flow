// apps/worker/src/sample.ts
// US-045 — seed the app-owned READ-ONLY "Golden Waltz Basic" template (the
// start-from-template source). Uses deterministic/stable ids (stableMinter) so
// the seed is fully idempotent across cold starts: the same ids are produced on
// every invocation, and seedDoc + ON CONFLICT DO NOTHING guard against clobbering.
// Distinct from the onboarding gift (starter.ts) which FORKS this template.
import { buildGoldenWaltzBasic, CURRENT_SCHEMA_VERSION } from "@ballroom/domain";
import { drizzle } from "drizzle-orm/d1";
import { createFigureRows } from "./db/figures";
import { linkPlacement } from "./db/placement-edge";
import { documentRegistry, membership } from "./db/schema";
import type { Env } from "./index";

export const APP_OWNER = "app";

/**
 * A counter-based id minter whose sequence restarts at 0 on each call.
 * Passing the same `prefix` always produces the same sequence of ids, making
 * the app template seed deterministic across cold starts.
 */
function stableMinter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}_${++n}`;
}

/**
 * Seed the app-owned Golden Waltz Basic template; returns the routine's stable
 * id.  Idempotent: seedDoc is no-clobber; D1 inserts use ON CONFLICT DO NOTHING.
 * Callers can capture the return value to get the stable template id without
 * hardcoding it (the minter controls which call-position becomes the routine id).
 */
export async function seedSampleRoutine(env: Env): Promise<string> {
  const { routine, figures, missing } = buildGoldenWaltzBasic(APP_OWNER, stableMinter("tpl_gw"));
  if (missing.length) {
    console.warn("app template: figures missing from library", { missing });
  }

  // Seed the figure DOs + D1 rows FIRST so the routine's placement edges and
  // cascade-access resolution work when the forker connects to the figures.
  for (const figure of figures) {
    await createFigureRows(env.DB, {
      figureRef: figure.id,
      ownerId: APP_OWNER,
      name: figure.name,
      dance: figure.dance,
      figureType: figure.figureType,
    });
    await env.DOC_DO.get(env.DOC_DO.idFromName(figure.id)).seedDoc(
      figure as unknown as Record<string, unknown>,
    );
    await linkPlacement(env.DB, routine.id, figure.id);
  }

  // Registry row + owner membership for "app". ON CONFLICT DO NOTHING so a
  // concurrent cold-start re-run is a safe no-op.
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

  // Seed the routine DO with the full CRDT content (no-clobber). `templateOf`
  // is stamped on the doc so a CRDT reader can detect template provenance (D1
  // still flags templates by ownerId='app'; this keeps the doc self-describing).
  await env.DOC_DO.get(env.DOC_DO.idFromName(routine.id)).seedDoc({
    ...routine,
    ownerId: APP_OWNER,
    templateOf: routine.id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deletedAt: null,
  } as unknown as Record<string, unknown>);

  return routine.id;
}
