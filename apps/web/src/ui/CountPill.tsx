import { cx } from "./cx";

export interface CountPillProps {
  /** Already-formatted count tokens, e.g. ["1","&","2","&","3","a"]. */
  counts: string[];
  className?: string;
}

/** On-beat counts are the bare numerals 1–8; everything else (`&`, `a`, `e`,
 *  `i`, …) is an off-beat sub-beat token rendered dimmed (#5). The float→label
 *  conversion lives in packages/domain — this is the presentational seam only. */
function isOffBeat(token: string): boolean {
  return !/^[1-8]$/.test(token);
}

/**
 * CountPill — renders a figure's count tokens inline on a light-blue pill
 * (frame 1.6: `1 2 3`, `1 & 2 & 3 a`, `1 & 2`). On-beat numerals use the
 * studio-blue ink; off-beat sub-beat tokens are dimmed to a muted slate so the
 * beat reads at a glance without relying on color alone. Inconsolata 700.
 */
export function CountPill({ counts, className }: CountPillProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md bg-accent-tint px-1.5 py-0.5",
        "text-2xs font-bold tabular-nums text-accent",
        className,
      )}
    >
      {counts.map((token, i) => {
        const offBeat = isOffBeat(token);
        return (
          <span
            // Count tokens repeat (e.g. two "&"); index keeps the key stable.
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens are a positional sequence, not entities
            key={i}
            data-offbeat={offBeat ? "true" : undefined}
            style={offBeat ? { color: "var(--bf-offbeat-ink)" } : undefined}
          >
            {token}
          </span>
        );
      })}
    </span>
  );
}
