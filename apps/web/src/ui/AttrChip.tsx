import { cx } from "./cx";
import { ATTRIBUTE_KINDS, type AttributeKind, kindVar } from "./tokens";

export interface AttrChipProps {
  /** Attribute kind id — drives the tint/ink/border family via kindVar. An
   *  unknown (user-defined) kind falls back to the `color` prop. */
  kind: string;
  /** The rendered text. For a merged "step chip" the caller passes "fwd·HT". */
  label: string;
  /** Explicit color for a user-defined kind not in the standard palette. */
  color?: string;
  /** Off-beat / inactive rows — lowers opacity. */
  dimmed?: boolean;
  className?: string;
}

function isStandardKind(kind: string): kind is AttributeKind {
  return (ATTRIBUTE_KINDS as readonly string[]).includes(kind);
}

/**
 * AttrChip — the small attribute chip in the reading grid (Builder v2). A
 * kind-tinted surface with the kind's dark ink text and a 1px border in the
 * kind's base color — legible at 10px where the old solid-fill/white-text chip
 * was not. Used both as a merged "step chip" (direction + footwork, e.g.
 * `fwd·HT`) and as a single kind value chip (e.g. Rise `comm`, Turn `¼R`).
 * Colors are driven by the kind registry (kindVar); a user-defined kind passes
 * an explicit `color` which paints the border/ink over a neutral tint. Always
 * pairs color with its text label (#5).
 */
export function AttrChip({ kind, label, color, dimmed, className }: AttrChipProps) {
  const standard = isStandardKind(kind);
  const style = standard
    ? {
        background: kindVar(kind, "tint"),
        color: kindVar(kind, "ink"),
        borderColor: kindVar(kind, "border"),
      }
    : {
        background: "var(--bf-surface-sunken)",
        color: color ?? "var(--bf-ink-secondary)",
        borderColor: color ?? "var(--bf-border-strong)",
      };

  return (
    <span
      className={cx(
        "inline-flex items-center justify-center border font-bold leading-none",
        "rounded-[6px] px-[7px] py-[4px] text-2xs",
        className,
      )}
      style={{ ...style, opacity: dimmed ? 0.5 : undefined }}
    >
      {label}
    </span>
  );
}
