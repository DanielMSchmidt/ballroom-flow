/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  // The deploy's git SHA, baked in by deploy.yml; unset in dev/test/E2E builds.
  // Compared against /api/health's buildId by lib/stale-bundle.ts.
  readonly VITE_BUILD_ID?: string;
  // Sentry DSN for the WEB half of US-049 (lib/ops.ts), baked in by deploy.yml.
  // Unset in dev/test/E2E builds → client error reporting is a silent no-op.
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
