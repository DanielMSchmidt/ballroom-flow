// apps/worker/src/starter.test.ts
// Task 6: seedStarterRoutine now FORKS the app-owned Golden Waltz template
// rather than building per-user figure rows.  The gift routine is owned by the
// user and carries forkedFromRef + the template's sections/placements (figures
// remain app-owned — the fork reuses their refs, so they are readable by all).
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

  it("gifts the user a fork of the app-owned Golden Waltz template", async () => {
    const routineId = await seedStarterRoutine(typedEnv, "u_starter2");

    // The routine is an owned registry row under the USER (not "app").
    const routineRow = await typedEnv.DB.prepare(
      "SELECT type, ownerId, title, dance, forkedFromRef FROM document_registry WHERE docRef = ?",
    )
      .bind(routineId)
      .first<{
        type: string;
        ownerId: string;
        title: string;
        dance: string;
        forkedFromRef: string | null;
      }>();
    expect(routineRow).toMatchObject({
      type: "routine",
      ownerId: "u_starter2",
      title: "Golden Waltz Basic",
      dance: "waltz",
    });
    // The gift is a fork: forkedFromRef points at the app template.
    expect(routineRow?.forkedFromRef).not.toBeNull();
    expect(routineRow?.forkedFromRef).not.toBe(routineId);

    // Figures are NOT per-user anymore — they are app-owned (shared global).
    // The user should have 0 figure rows under their own ownerId.
    const userFigureCount = await typedEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE type = 'figure' AND ownerId = ?",
    )
      .bind("u_starter2")
      .first<{ n: number }>();
    expect(userFigureCount?.n).toBe(0);

    // App-owned figures were seeded by the template seed (6 waltz figures).
    const appFigureCount = await typedEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE type = 'figure' AND ownerId = 'app'",
    )
      .bind()
      .first<{ n: number }>();
    expect(appFigureCount?.n).toBeGreaterThanOrEqual(6);

    // The fork's DO is seeded with the section + 6 placements.
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

  it("onboarding still succeeds even if the gift is a fork (idempotent)", async () => {
    // Calling twice is safe — seedSampleRoutine is idempotent, and a second fork
    // just creates another routine row for the user.
    const id1 = await seedStarterRoutine(typedEnv, "u_starter3");
    const id2 = await seedStarterRoutine(typedEnv, "u_starter3");
    // Both return valid ids; second call is a second fork (not a crash/throw).
    expect(typeof id1).toBe("string");
    expect(typeof id2).toBe("string");
  });
});
