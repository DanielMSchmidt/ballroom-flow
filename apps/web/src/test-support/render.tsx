// ─────────────────────────────────────────────────────────────────────────
// Component-layer render helper (PLAN §10.3: component layer = jsdom + Testing
// Library + vitest-axe). Wraps a UI under test in the providers a screen needs
// (TanStack Query for the REST list surface; room for a store/ provider) and
// re-exports Testing Library + an axe convenience.
//
// IMPORTANT — does NOT import any product screen/component. Screens are built in
// parallel by the frontend agent and DON'T EXIST YET; component test bodies
// dynamic-import them behind `it.skip`. This helper only provides the harness.
// ─────────────────────────────────────────────────────────────────────────
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, type RenderResult, render } from "@testing-library/react";
import type { AxeResults } from "axe-core";
import type { ReactElement, ReactNode } from "react";
import { axe } from "vitest-axe";
import { ToastProvider } from "../ui";

/** A QueryClient tuned for tests: no retries, no caching surprises. */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderUiOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
}

/** Render a UI element wrapped in the app providers. */
export function renderUi(ui: ReactElement, opts: RenderUiOptions = {}): RenderResult {
  const queryClient = opts.queryClient ?? makeTestQueryClient();
  function Providers({ children }: { children: ReactNode }) {
    // Mirror the app root (App.tsx wraps ToastProvider) so any toast-using screen
    // (Assemble undo, Share) renders in isolation without each test re-wrapping it.
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Providers, ...opts });
}

/** Run axe over a container and return the results (assert with toHaveNoViolations). */
export async function axeCheck(container: HTMLElement): Promise<AxeResults> {
  return axe(container) as Promise<AxeResults>;
}

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
