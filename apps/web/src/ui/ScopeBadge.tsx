import { cx } from "./cx";
import { BranchIcon, CustomIcon, GlobeIcon } from "./icons";
import type { FigureScope } from "./tokens";

export interface ScopeBadgeProps {
  scope: FigureScope;
  /**
   * Variant lineage / provenance line, e.g. "Open Telemark" — shown as
   * "based on <lineage>" for a variant (DESIGN-PRINCIPLES #12). Ignored
   * for global/custom.
   */
  lineage?: string;
  /** Compact form: icon + short word only (for dense rows). */
  compact?: boolean;
  className?: string;
}

interface ScopeMeta {
  word: string;
  Icon: typeof GlobeIcon;
  bg: string;
  fg: string;
  bd: string;
}

// Each scope = a distinct, consistent treatment carried by WORD + ICON
// + COLOR together — color is never the only signal (#5, #11).
const META: Record<FigureScope, ScopeMeta> = {
  global: {
    word: "Library",
    Icon: GlobeIcon,
    bg: "var(--bf-scope-global-tint)",
    fg: "var(--bf-scope-global-ink)",
    bd: "var(--bf-scope-global-border)",
  },
  variant: {
    word: "Variant",
    Icon: BranchIcon,
    bg: "var(--bf-scope-variant-tint)",
    fg: "var(--bf-scope-variant-ink)",
    bd: "var(--bf-scope-variant-border)",
  },
  custom: {
    word: "Custom",
    Icon: CustomIcon,
    bg: "var(--bf-scope-custom-tint)",
    fg: "var(--bf-scope-custom-ink)",
    bd: "var(--bf-scope-custom-border)",
  },
};

/**
 * ScopeBadge — encodes the three figure scopes (global library /
 * account variant / routine-scoped custom) with a consistent
 * text + icon + color treatment everywhere a figure appears
 * (DESIGN-PRINCIPLES #11). For a variant it can also render the base
 * lineage ("based on …", #12).
 */
export function ScopeBadge({ scope, lineage, compact, className }: ScopeBadgeProps) {
  const m = META[scope];
  const { Icon } = m;
  const showLineage = !compact && scope === "variant" && Boolean(lineage);

  // Meaning is carried by visible text (the scope word, plus the lineage
  // line when shown) — no aria-label needed (#5). An sr-only " figure"
  // gives screen readers context without changing the visual.
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-bold leading-none",
        className,
      )}
      style={{ background: m.bg, color: m.fg, borderColor: m.bd }}
    >
      <span aria-hidden="true" className="inline-flex">
        <Icon size={12} />
      </span>
      <span>{m.word}</span>
      <span className="bf-sr-only"> figure</span>
      {showLineage && <span className="font-medium opacity-80"> · based on {lineage}</span>}
    </span>
  );
}
