import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["spike/**/*.test.ts"],
    poolOptions: {
      workers: {
        // SQLite-backed DOs + isolated storage trip a teardown bug (vitest-pool-workers
        // chokes on SQLite -shm/-wal sidecars). Disable it; tests use unique DO names.
        isolatedStorage: false,
        wrangler: { configPath: "./wrangler.spike.toml" },
      },
    },
  },
});
