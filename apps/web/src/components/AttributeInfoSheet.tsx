// The attribute explainer (Builder v2, review U2 — was a bottom sheet): a
// plain-language reference for ONE attribute kind, now a FULL PAGE so long value
// glossaries read like a reference, not a cramped sheet. Header: ‹ back + a
// colour swatch + the kind title + "attribute explainer" subtitle. Body: a prose
// description (the Caveat note voice) + a VALUES glossary (chip + definition) +
// a "Used in N steps" footer. Footer: an optional ‹ prev / next › pager that
// walks the sibling kinds (wired by the caller). Registry-derived: the values
// come from the merged registry, so it works for custom kinds too (no prose).
//
// Read-only reference, NOT an editor — but a value chip is tappable to jump to
// "every step that uses it" (onSelectValue), matching the frame's footer hint.
import type { RegistryKind } from "@ballroom/domain";
import { useMessages } from "../i18n";
import { attributesMessages } from "../i18n/messages/attributes";
import { cx, FullScreen } from "../ui";
import { ATTRIBUTE_KINDS, type AttributeKind, kindVar } from "../ui/tokens";
import { glossFor } from "./attribute-info";

export interface AttributeInfoSheetProps {
  open: boolean;
  onClose?: () => void;
  /** The kind to describe (from the merged registry — standard or custom). */
  kind: RegistryKind;
  /** Additional kinds to describe in the same sheet. The merged "Step" slot holds
   *  two kinds (direction + footwork), so tapping it opens ONE sheet describing
   *  both — each kind rendered as its own labelled section. */
  extraKinds?: RegistryKind[];
  /** Override the sheet title (e.g. "Step" for the merged direction+footwork
   *  slot). Defaults to the primary kind's label. */
  title?: string;
  /** How many steps in the current figure/choreo use this kind. */
  usageCount: number;
  /** The choreo/figure name for the "across …" footer (optional). */
  scopeLabel?: string;
  /** Tapping a value chip jumps to every step that uses it (optional). */
  onSelectValue?: (value: string) => void;
  /** Optional ‹ prev / next › pager across sibling kinds (Builder v2 footer).
   *  Both handlers + labels must be provided for the pager bar to render. */
  pager?: {
    prevLabel: string;
    nextLabel: string;
    /** e.g. "2 of 5" */
    positionLabel: string;
    onPrev: () => void;
    onNext: () => void;
  };
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
  extraKinds = [],
  title,
  usageCount,
  scopeLabel,
  onSelectValue,
  pager,
}: AttributeInfoSheetProps) {
  const t = useMessages(attributesMessages);
  const gloss = glossFor(kind.kind);
  const accent = kindColor(kind);
  // One or more kinds (the merged Step slot holds direction + footwork). A single
  // kind renders without a per-kind heading (the page title IS its label); a
  // combined slot labels each section so the two kinds read apart.
  const kinds = [kind, ...extraKinds];
  const multi = kinds.length > 1;

  return (
    <FullScreen
      open={open}
      onClose={onClose}
      title={title ?? kind.label}
      subtitle={t.explainerSubtitle}
      backLabel={t.backToSpot}
    >
      <div className="flex flex-col gap-4 p-4">
        {/* Header row: colour swatch + subtitle (the title is the page's h2). */}
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-4 flex-none rounded-[5px]"
            style={{ background: accent }}
          />
          {gloss?.subtitle && <span className="text-2xs text-ink-muted">{gloss.subtitle}</span>}
        </div>

        {kinds.map((k) => (
          <KindDetail key={k.kind} kind={k} showHeading={multi} onSelectValue={onSelectValue} />
        ))}

        {/* Footer: "Used in N steps across <choreo>." */}
        <p
          className={cx("rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted")}
          style={{ fontFamily: "var(--bf-font-note)" }}
        >
          {t.usedIn(usageCount, scopeLabel)}
          {onSelectValue ? ` ${t.tapValueHint}` : ""}
        </p>
      </div>

      {/* ‹ prev / next › pager across sibling kinds (Builder v2 footer bar). */}
      {pager && (
        <div
          className="sticky bottom-0 flex items-center gap-2 border-t border-border-subtle bg-surface-raised px-4 py-[10px]"
          style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={pager.onPrev}
            className="inline-flex min-h-[var(--bf-touch-target)] items-center rounded-[9px] border-[1.5px] border-accent-border px-[13px] text-xs font-bold text-accent"
          >
            <span aria-hidden="true">‹ </span>
            {pager.prevLabel}
          </button>
          <span className="flex-1 text-center text-[9px] font-semibold text-ink-faint">
            {pager.positionLabel}
          </span>
          <button
            type="button"
            onClick={pager.onNext}
            className="inline-flex min-h-[var(--bf-touch-target)] items-center rounded-[9px] border-[1.5px] border-accent-border px-[13px] text-xs font-bold text-accent"
          >
            {pager.nextLabel}
            <span aria-hidden="true"> ›</span>
          </button>
        </div>
      )}
    </FullScreen>
  );
}

/** One kind's block: an optional label heading (for the combined Step slot), its
 *  plain-language description, and a VALUES glossary (chip + definition). All
 *  registry-derived, so a custom kind with no prose gracefully shows just values. */
function KindDetail({
  kind,
  showHeading,
  onSelectValue,
}: {
  kind: RegistryKind;
  showHeading: boolean;
  onSelectValue?: (value: string) => void;
}) {
  const t = useMessages(attributesMessages);
  const values = kind.values ?? [];
  const accent = kindColor(kind);
  const description = kind.description;
  const valueDefs = kind.valueDefs;
  return (
    <div className="flex flex-col gap-2">
      {/* When two kinds share the sheet (the Step slot), name each with its swatch. */}
      {showHeading && (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3 flex-none rounded-[4px]"
            style={{ background: accent }}
          />
          <h3 className="text-sm font-bold text-ink">{kind.label}</h3>
        </div>
      )}

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
      <h4 className="text-2xs font-bold uppercase tracking-wide text-ink-muted">
        {t.valuesHeading}
      </h4>
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
                  aria-label={t.seeStepsUsing(value)}
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
  );
}
