import { describe, expect, it, vi } from "vitest";
import { renderUi, screen, userEvent } from "../test-support/render";
import { ErrorBoundary, ErrorFallback } from "./ErrorBoundary";

function Boom({ crash }: { crash: boolean }): React.JSX.Element {
  if (crash) throw new Error("kaboom");
  return <div>all good</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    renderUi(
      <ErrorBoundary fallback={(_e, reset) => <ErrorFallback reset={reset} />}>
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("catches a render throw, reports it, and shows the recoverable fallback", () => {
    const onError = vi.fn();
    // React logs the caught error to console.error — silence it for a clean run.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderUi(
      <ErrorBoundary onError={onError} fallback={(_e, reset) => <ErrorFallback reset={reset} />}>
        <Boom crash={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe("kaboom");
    spy.mockRestore();
  });

  it("reset() clears the error so the subtree can remount", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let crash = true;
    function Toggler(): React.JSX.Element {
      return <Boom crash={crash} />;
    }
    renderUi(
      <ErrorBoundary fallback={(_e, reset) => <ErrorFallback reset={reset} />}>
        <Toggler />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // The underlying condition is fixed, then the user hits "Try again".
    crash = false;
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("all good")).toBeInTheDocument();
    spy.mockRestore();
  });
});
