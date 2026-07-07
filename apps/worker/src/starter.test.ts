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

// Headroom over vitest's 5s default, NOT a blind bump (same rationale as the web
// suite's load-tolerance timeout, 29d5cbd): the first seedStarterRoutine call in a
// fresh D1 also builds the app-owned Golden Waltz TEMPLATE — 6 figure Automerge
// docs + the routine doc — before forking it. The WDSF technique-book re-chart
// grew that template's embedded catalog payload from 190 to 267 attribute rows
// (+41%) and its attribute value bytes from ~0.9 KB to ~2.8 KB (3.2×, the verbatim
// rotation/head prose), which under istanbul coverage instrumentation pushed the
// build+fork just past 5s on CI (observed 5.0–5.4s). A genuinely stuck seed still
// fails, just later.
const STARTER_SEED_TIMEOUT_MS = 15_000;

describe("seedStarterRoutine", () => {
  beforeEach(async () => {
    await applyMigrations();
  });

  it("gifts the user a fork of the app-owned Golden Waltz template", {
    timeout: STARTER_SEED_TIMEOUT_MS,
  }, async () => {
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

    // Figures are NOT per-user anymore — the gift is a FORK of the app template,
    // so its placements reference the app-owned figures. The user should own 0
    // figure rows. (Figure rows are typed `account-figure` post-FE-3 taxonomy.)
    const userFigureCount = await typedEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE type = 'account-figure' AND ownerId = ?",
    )
      .bind("u_starter2")
      .first<{ n: number }>();
    expect(userFigureCount?.n).toBe(0);

    // App-owned figures were seeded by the template seed (6 waltz figures).
    const appFigureCount = await typedEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE type = 'account-figure' AND ownerId = 'app'",
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

  it("onboarding still succeeds even if the gift is a fork (idempotent)", {
    timeout: STARTER_SEED_TIMEOUT_MS,
  }, async () => {
    // Calling twice is safe — seedSampleRoutine is idempotent, and a second fork
    // just creates another routine row for the user.
    const id1 = await seedStarterRoutine(typedEnv, "u_starter3");
    const id2 = await seedStarterRoutine(typedEnv, "u_starter3");
    // Both return valid ids; second call is a second fork (not a crash/throw).
    expect(typeof id1).toBe("string");
    expect(typeof id2).toBe("string");
  });
});
