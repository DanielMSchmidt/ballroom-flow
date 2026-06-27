// apps/worker/src/starter.test.ts
// Verifies the starter seeder projects the routine + its 6 figures and seeds the
// routine DO with content. Uses the workerd test harness like figures.test.ts.
import { env, runInDurableObject } from "cloudflare:test";
import * as A from "@automerge/automerge";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "./index";
import { seedStarterRoutine } from "./starter";
import { applyMigrations } from "./test-support/seed";

// The cloudflare:test `env` is typed as ProvidedEnv (DOC_DO untyped). Cast to
// the worker's Env so seedStarterRoutine receives the right type.
const typedEnv = env as unknown as Env;

describe("seedStarterRoutine", () => {
  beforeEach(async () => {
    await applyMigrations();
  });

  it("projects the routine + 6 figures and seeds the routine DO content", async () => {
    const routineId = await seedStarterRoutine(typedEnv, "u_starter");

    // The routine is an owned registry row (counts as the user's routine).
    const routineRow = await typedEnv.DB.prepare(
      "SELECT type, ownerId, title, dance FROM document_registry WHERE docRef = ?",
    )
      .bind(routineId)
      .first<{ type: string; ownerId: string; title: string; dance: string }>();
    expect(routineRow).toMatchObject({
      type: "routine",
      ownerId: "u_starter",
      title: "Golden Waltz Basic",
      dance: "waltz",
    });

    // 6 figure rows projected + 6 placement edges linked.
    const figureCount = await typedEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE type = 'figure' AND ownerId = ?",
    )
      .bind("u_starter")
      .first<{ n: number }>();
    expect(figureCount?.n).toBe(6);
    const edgeCount = await typedEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM placement_edge WHERE routineRef = ?",
    )
      .bind(routineId)
      .first<{ n: number }>();
    expect(edgeCount?.n).toBe(6);

    // The routine DO is seeded with the section + 6 placements.
    const stub = typedEnv.DOC_DO.get(typedEnv.DOC_DO.idFromName(routineId));
    const placements = await runInDurableObject(
      stub as unknown as DurableObjectStub<import("./doc-do").DocDO>,
      async (instance) => {
        const doState = (instance as unknown as { ctx: DurableObjectState }).ctx;
        const rows = doState.storage.sql
          .exec("SELECT data FROM changes ORDER BY seq")
          .toArray() as Array<{ data: ArrayBuffer }>;
        if (rows.length === 0) return -1;
        let doc = A.init<Record<string, unknown>>();
        const changes = rows.map((r) => new Uint8Array(r.data) as A.Change);
        [doc] = A.applyChanges(doc, changes);
        const plain = A.toJS(doc) as { sections?: Array<{ placements?: unknown[] }> };
        return plain.sections?.[0]?.placements?.length ?? -1;
      },
    );
    expect(placements).toBe(6);
  });
});
