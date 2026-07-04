import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { TEST_JWT_PUBLIC_KEY_PEM } from "./src/test-support/test-keys";

const here = path.dirname(fileURLToPath(import.meta.url));

// Worker / DO / D1 layer — runs in real `workerd` via vitest-pool-workers
// (PLAN.md §10.3). Two sharp edges from the M0.5 spike are baked in here:
//
//  1. `isolatedStorage: false` — SQLite-backed Durable Objects break
//     vitest-pool-workers' isolated-storage teardown (it asserts on the
//     `.sqlite` file and chokes on the `-shm`/`-wal` sidecars). With isolated
//     storage off, storage is NOT reset between tests, so:
//  2. Each test MUST use a UNIQUE Durable Object id / name. Derive ids from
//     the test name or a ULID — never share a DO id across tests, or state
//     leaks. (See docs/DEVELOPMENT.md "Per-test DO-id convention".)
//
// Per-suite isolated D1: migrations under ./migrations are read at config time
// and exposed to tests as the `TEST_MIGRATIONS` binding. A test (owned by the
// test engineer) calls `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` in a
// beforeAll to get a freshly-migrated D1 per suite. Empty until M2 adds
// migrations — `readD1Migrations` returns [] for an empty dir, which is fine.
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, "migrations"));
  // The REAL wrangler.toml, bound as a string so the US-049 config test can
  // assert Smart Placement / envs / the AE binding against what actually deploys.
  const wranglerToml = await readFile(path.join(here, "wrangler.toml"), "utf8");

  return {
    test: {
      include: ["src/**/*.test.ts"],
      poolOptions: {
        workers: {
          isolatedStorage: false,
          miniflare: {
            // Surfaced to tests via `import { env } from "cloudflare:test"`.
            // CLERK_JWT_KEY is the FIXED test public PEM (test-keys.ts) so the
            // worker under test (`SELF`) verifies our minted tokens networklessly
            // — it reads this STATIC binding, not a runtime env mutation. This is
            // the deferred M3 positive-auth wiring (CLAUDE.md / TEST-MAP.md).
            bindings: {
              TEST_MIGRATIONS: migrations,
              CLERK_JWT_KEY: TEST_JWT_PUBLIC_KEY_PEM,
              WRANGLER_TOML: wranglerToml,
            },
          },
          wrangler: { configPath: "./wrangler.toml" },
        },
      },
      coverage: {
        provider: "istanbul" as const,
        include: ["src/**/*.ts"],
        exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/test-support/**"],
        // PLAN.md §10.3 targets worker/DO ≥ 90%. ARMED at the current measured
        // floor so coverage can't silently regress; ratchet UP toward 90 as the
        // DO/route branches get covered. (The All-files number is depressed by
        // test-seed.ts — the E2E-only fixture route exercised by Playwright, not
        // vitest — which is a constant drag, not a regression risk.) A drop below
        // these fails CI.
        thresholds: {
          lines: 88,
          functions: 85,
          branches: 66,
          statements: 84,
        },
      },
    },
  };
});
