import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppAuthProvider } from "./auth/app-auth";
import { isE2E } from "./lib/e2e-auth";
import { initErrorReporting, reportError } from "./lib/ops";
import { shouldRetryQuery } from "./lib/rpc";
import { initStaleBundleReload } from "./lib/stale-bundle";
import { ErrorBoundary, ErrorFallback } from "./ui";
// driver.js base styles for the first-visit UI tours; themed to the --bf-*
// tokens by the `.bf-tour` overrides in styles/index.css. CSS stays imported
// only at the app root (components are CSS-import-free — DESIGN-SYSTEM §7).
import "driver.js/dist/driver.css";
import "./styles/index.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// US-049 (web half): last-resort client error reporting — uncaught exceptions
// and unhandled rejections go to Sentry (no-op without VITE_SENTRY_DSN). Wired
// before anything renders so even a boot crash reports.
initErrorReporting();

// Stale-bundle reload nudge: when this (deployed) tab becomes visible after a
// newer deploy, reload it onto the current bundle — the mechanism the sync-wire
// and REST compat stories rely on. No-op in dev/test/E2E (no VITE_BUILD_ID).
initStaleBundleReload();

// Deterministic E2E (#191): disable animations so journeys never race a sheet/
// modal enter-animation (see the `.bf-e2e` rule in styles/index.css). Folds to
// dead code in real builds, where `isE2E()` is a compile-time `false`.
if (isE2E()) document.documentElement.classList.add("bf-e2e");

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");
const root = createRoot(rootEl);
// Status-aware query retry (spotty-network hardening, 2026-07-13): the library
// default re-fires 401/402/403 product refusals three times before surfacing
// them. Refusals fail fast; ambiguous failures keep a bounded retry.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetryQuery } },
});

if (!isE2E() && !publishableKey) {
  // Graceful first-run state when Clerk isn't configured yet. (An E2E build needs
  // no publishable key — it uses the injected test session; see lib/e2e-auth.ts.)
  root.render(
    <div style={{ font: "16px system-ui", padding: 24 }}>
      <h1>Weave Steps</h1>
      <p>
        Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>apps/web/.env.local</code> to enable
        sign-in. See <code>PROVISIONING.md</code>.
      </p>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <ErrorBoundary
        onError={(error) => reportError(error, { key: `render:${error.message}` })}
        fallback={(_error, reset) => (
          <div style={{ padding: 24 }}>
            <ErrorFallback reset={reset} />
          </div>
        )}
      >
        <AppAuthProvider publishableKey={publishableKey ?? ""}>
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </AppAuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}
