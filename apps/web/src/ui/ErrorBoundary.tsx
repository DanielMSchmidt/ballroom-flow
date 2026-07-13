import { Component, type ErrorInfo, type ReactNode } from "react";
import { useMessages } from "../i18n";
import { uiMessages } from "../i18n/messages/ui";
import { Button } from "./Button";
import { cx } from "./cx";
import { WarningIcon } from "./icons";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Render the fallback when a descendant throws during render. `reset` clears
   * the boundary's error state so the subtree remounts (a "Try again" affordance).
   */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** Reported to the error reporter (Sentry) — wired by {@link AppErrorBoundary}. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * ErrorBoundary — the last line of defence against a render-time throw taking the
 * whole SPA to a blank white screen. React unmounts a subtree that throws during
 * render; without a boundary the user is left with nothing and no recovery beyond
 * a manual reload (and, for an offline-editing PWA, possibly unsynced local work
 * behind that blank screen). This catches the throw, reports it, and shows a calm,
 * recoverable state instead. Pure class component — hooks can't catch render errors.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}

/**
 * The app's default error fallback — a centered, localized danger state with a
 * "Try again" (remount the subtree) and a "Reload the app" (hard reload onto the
 * cached shell). Self-contained: it reads the i18n store directly (no provider
 * needed) so it renders even when a screen below it has crashed.
 */
export function ErrorFallback({
  reset,
  className,
}: {
  reset: () => void;
  className?: string;
}): React.JSX.Element {
  const t = useMessages(uiMessages);
  return (
    <div
      role="alert"
      className={cx(
        "mx-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center",
        className,
      )}
      style={{
        background: "var(--bf-surface-raised)",
        borderColor: "var(--bf-border-strong)",
        color: "var(--bf-ink)",
      }}
    >
      <span aria-hidden="true" style={{ color: "var(--bf-danger)" }}>
        <WarningIcon size={28} />
      </span>
      <h2 className="text-sm font-bold">{t.errorTitle}</h2>
      <p className="text-2xs" style={{ color: "var(--bf-ink-secondary)" }}>
        {t.errorDescription}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="secondary" onClick={reset}>
          {t.errorRetry}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            window.location.reload();
          }}
        >
          {t.errorReload}
        </Button>
      </div>
    </div>
  );
}
