import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * BuildStamp — the deployed commit SHA, shown small and grey at the foot of the
 * page so you can eyeball whether a tab is running the latest deploy.
 *
 * The SHA is baked in as `VITE_BUILD_ID` (deploy.yml → `github.sha`) — the same
 * value the stale-bundle checker and /api/health compare (lib/stale-bundle.ts).
 * Dev/test/E2E builds carry no build id, so this renders nothing there — the
 * hash is only meaningful for a real deploy.
 */
export function BuildStamp({ className }: { className?: string }): ReactNode {
  const buildId = import.meta.env.VITE_BUILD_ID;
  if (!buildId) return null;
  const short = buildId.slice(0, 7);
  return (
    <span
      className={cx("font-mono text-2xs text-ink-faint tabular-nums", className)}
      title={buildId}
    >
      {short}
    </span>
  );
}
