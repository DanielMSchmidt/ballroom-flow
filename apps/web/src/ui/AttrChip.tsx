import { cx } from "./cx";
import { ATTRIBUTE_KINDS, type AttributeKind, kindVar } from "./tokens";

export interface AttrChipProps {
  /** Attribute kind id — drives the fill color via kindVar. An unknown
   *  (user-defined) kind falls back to the `color` prop. */
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
 * AttrChip — the small attribute chip in the reading grid (frame 1.6). A solid
 * fill in the attribute kind's base color with white text. Used both as a
 * merged "step chip" (direction + footwork, e.g. `fwd·HT`) and as a single
 * kind value chip (e.g. Rise `comm`, Position `Closed`, Turn `¼R`). Color is
 * driven by the kind registry (kindVar) — a user-defined kind passes an
 * explicit `color`. Always pairs color with its text label (#5).
 */
export function AttrChip({ kind, label, color, dimmed, className }: AttrChipProps) {
  const background = isStandardKind(kind) ? kindVar(kind) : (color ?? "var(--bf-ink-secondary)");

  return (
    <span
      className={cx(
        "inline-flex items-center justify-center font-bold leading-none text-ink-inverse",
        "rounded-[5px] px-1 py-0.5 text-2xs",
        className,
      )}
      style={{ background, opacity: dimmed ? 0.5 : undefined }}
    >
      {label}
    </span>
  );
}
