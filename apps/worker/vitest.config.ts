import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { TEST_JWT_PUBLIC_KEY_PEM } from "./src/test-support/test-keys";

const here = path.dirname(fileURLToPath(import.meta.url));

// Worker / DO / D1 layer — runs in real `workerd` via vitest-pool-workers
// (docs/system/testing.md). The M0.5-spike sharp edge still governs how tests
// are written here:
//
//  • Each test MUST use a UNIQUE Durable Object id / name. Derive ids from
//    the test name or a ULID — never share a DO id across tests, or state
//    leaks. (See docs/DEVELOPMENT.md "Per-test DO-id convention".)
//
// vitest-pool-workers 4.x reworked storage isolation to be automatic and
// per-test-file, and removed the `isolatedStorage` option (previously set to
// `false` because SQLite-backed DO teardown choked on the `-shm`/`-wal`
// sidecars — that crash no longer occurs). The unique-DO-id convention above is
// what keeps tests independent regardless of the isolation mode, so it stays
// mandatory.
//
// Per-suite isolated D1: migrations under ./migrations are read at config time
// and exposed to tests as the `TEST_MIGRATIONS` binding. A test (owned by the
// test engineer) calls `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` in a
// beforeAll to get a freshly-migrated D1 per suite. Empty until M2 adds
// migrations — `readD1Migrations` returns [] for an empty dir, which is fine.
//
// vitest-pool-workers 4.x note: the pool ships as a Vite *plugin*
// (`cloudflareTest(...)`) rather than the old `defineWorkersConfig` +
// `test.poolOptions.workers` shape. The plugin takes exactly what used to live
// under `poolOptions.workers`; everything else stays plain `defineConfig`.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, "migrations"));
  // The REAL wrangler.toml, bound as a string so the US-049 config test can
  // assert Smart Placement / envs / the AE binding against what actually deploys.
  const wranglerToml = await readFile(path.join(here, "wrangler.toml"), "utf8");

  return {
    plugins: [
      cloudflareTest({
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
            // The unit tests exercise the same boundary as the E2E wrangler run
            // (wrangler.toml [env.e2e] — the fixed CLERK_JWT_KEY above mirrors it),
            // so bind E2E_TEST_ROUTES=1 here too. It gates the E2E-only seams —
            // the DO's `resetForTest()` wipe guard (doc-do.ts) and the `/api/test/*`
            // route mount (index.ts) — which the DO/reset tests drive directly.
            E2E_TEST_ROUTES: "1",
          },
        },
        wrangler: { configPath: "./wrangler.toml" },
      }),
    ],
    test: {
      include: ["src/**/*.test.ts"],
      // Every worker test boots real workerd + a SQLite-backed DO + D1; some also
      // trigger DO-heavy work (onboarding seeds the starter routine, forks copy
      // figures). Under CI contention the collect/boot phase alone can take
      // minutes, so the vitest 5s default flakes real-but-slow tests (me-profile
      // onboarding, and the templates/fork tests that already carry an inline
      // `, 15_000`). Give the whole suite justified headroom — a genuinely hung
      // test still fails, just later — instead of scattering per-test bumps.
      testTimeout: 15_000,
      // beforeAll runs applyMigrations (+ seed) against the shared D1; give hooks
      // more room again since they gate an entire suite.
      hookTimeout: 30_000,
      coverage: {
        provider: "istanbul" as const,
        include: ["src/**/*.ts"],
        exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/test-support/**"],
        // docs/system/testing.md targets worker/DO ≥ 90%. ARMED at the current measured
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
