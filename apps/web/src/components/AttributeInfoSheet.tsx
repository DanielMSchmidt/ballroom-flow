// Frame 1.13 — Attribute info sheet: a plain-language reference for ONE attribute
// kind. Header: a colour swatch + the kind title + a short subtitle. Body: a prose
// description (the Caveat note voice) + a VALUES glossary (chip + definition) +
// a "Used in N steps" footer. Registry-derived: the values come from the merged
// registry, so it works for custom kinds too (which simply have no prose).
//
// Read-only reference, NOT an editor — but a value chip is tappable to jump to
// "every step that uses it" (onSelectValue), matching the frame's footer hint.
import type { RegistryKind } from "@ballroom/domain";
import { cx, Sheet } from "../ui";
import { ATTRIBUTE_KINDS, type AttributeKind, kindVar } from "../ui/tokens";
import { glossFor } from "./attribute-info";

export interface AttributeInfoSheetProps {
  open: boolean;
  onClose?: () => void;
  /** The kind to describe (from the merged registry — standard or custom). */
  kind: RegistryKind;
  /** How many steps in the current figure/choreo use this kind. */
  usageCount: number;
  /** The choreo/figure name for the "across …" footer (optional). */
  scopeLabel?: string;
  /** Tapping a value chip jumps to every step that uses it (optional). */
  onSelectValue?: (value: string) => void;
}

function isStandardKind(kind: string): kind is AttributeKind {
  return (ATTRIBUTE_KINDS as readonly string[]).includes(kind);
}

/** The kind's accent colour — a token for a standard kind, the stored hex else. */
function kindColor(kind: RegistryKind): string {
  return isStandardKind(kind.kind) ? kindVar(kind.kind) : kind.color;
}
function kindTint(kind: RegistryKind): string {
  return isStandardKind(kind.kind) ? kindVar(kind.kind, "tint") : kind.color;
}

export function AttributeInfoSheet({
  open,
  onClose = () => {},
  kind,
  usageCount,
  scopeLabel,
  onSelectValue,
}: AttributeInfoSheetProps) {
  const gloss = glossFor(kind.kind);
  const values = kind.values ?? [];
  const accent = kindColor(kind);
  // Prose + per-value definitions are registry-derived (T5), so a CUSTOM kind
  // carrying a `description`/`valueDefs` gets the same treatment; one with none
  // gracefully falls back to just the value list.
  const description = kind.description;
  const valueDefs = kind.valueDefs;

  return (
    <Sheet open={open} onClose={onClose} title={kind.label}>
      <div className="flex flex-col gap-4">
        {/* Header row: colour swatch + subtitle (the title is the Sheet's h2). */}
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-4 flex-none rounded-[5px]"
            style={{ background: accent }}
          />
          {gloss?.subtitle && <span className="text-2xs text-ink-muted">{gloss.subtitle}</span>}
        </div>

        {/* Plain-language description in the note voice (Caveat) — registry-derived. */}
        {description && (
          <p
            className="text-base leading-snug text-ink-secondary"
            style={{ fontFamily: "var(--bf-font-note)" }}
          >
            {description}
          </p>
        )}

        {/* VALUES glossary: a chip (tinted to the kind) + its definition. */}
        <div className="flex flex-col gap-2">
          <h3 className="text-2xs font-bold uppercase tracking-wide text-ink-muted">Values</h3>
          <ul className="flex flex-col gap-2">
            {values.map((value) => {
              const def = valueDefs?.[value];
              const chip = (
                <span
                  className="inline-flex min-w-9 flex-none items-center justify-center rounded-[5px] border px-1.5 py-0.5 text-2xs font-bold text-ink"
                  style={{ background: kindTint(kind), borderColor: accent }}
                >
                  {value}
                </span>
              );
              return (
                <li key={value} className="flex items-baseline gap-2">
                  {onSelectValue ? (
                    <button
                      type="button"
                      aria-label={`See steps using ${value}`}
                      onClick={() => onSelectValue(value)}
                      className="flex-none cursor-pointer"
                    >
                      {chip}
                    </button>
                  ) : (
                    chip
                  )}
                  {def && <span className="text-sm text-ink-secondary">{def}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Footer: "Used in N steps across <choreo>." */}
        <p
          className={cx("rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted")}
          style={{ fontFamily: "var(--bf-font-note)" }}
        >
          Used in {usageCount} step{usageCount === 1 ? "" : "s"}
          {scopeLabel ? ` across ${scopeLabel}` : ""}.
          {onSelectValue ? " Tap a value to see every step that uses it." : ""}
        </p>
      </div>
    </Sheet>
  );
}
