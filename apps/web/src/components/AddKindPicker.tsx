// Frame 1.15 — Add-attribute type picker. A sheet that lists the standard kinds
// (dance-scoped: Tango omits rise) and any custom kinds, each as a tappable row
// (colour dot + label + a registry-derived "L/F"/required/"multi"/"custom" hint
// + chevron), plus a dashed
// "＋ new attribute type" footer that opens the custom-type builder (frame 1.16).
//
// Registry-driven: the standard rows come from ATTRIBUTE_REGISTRY; custom rows
// from the passed-in kinds. Picking a kind hands it back via onSelectKind so the
// caller can open that kind's editor for the step.
import { type DanceId, mergeRegistry, type RegistryKind } from "@weavesteps/domain";
import { useState } from "react";
import { useLocalizedRegistry, useMessages } from "../i18n";
import { attributesMessages } from "../i18n/messages/attributes";
import { ChevronRightIcon, cx, PlusIcon, Sheet } from "../ui";
import { ATTRIBUTE_KINDS, type AttributeKind, kindVar } from "../ui/tokens";
import { AddKindSheet } from "./AddKindSheet";

export interface AddKindPickerProps {
  open: boolean;
  onClose?: () => void;
  /** Scope the standard kinds to a dance (Tango omits rise). */
  dance?: DanceId;
  /** Custom (choreo-scoped) kinds to list alongside the standard ones. */
  customKinds?: RegistryKind[];
  /** Hand back the chosen kind so the caller opens its editor for the step. */
  onSelectKind?: (kind: RegistryKind) => void;
  /** Persist a newly-built custom kind (forwarded from the builder). */
  onCreate?: (kind: RegistryKind) => void;
}

function isStandardKind(kind: string): kind is AttributeKind {
  return (ATTRIBUTE_KINDS as readonly string[]).includes(kind);
}
function dotColor(kind: RegistryKind): string {
  return isStandardKind(kind.kind) ? kindVar(kind.kind) : kind.color;
}

export function AddKindPicker({
  open,
  onClose = () => {},
  dance,
  customKinds = [],
  onSelectKind,
  onCreate,
}: AddKindPickerProps) {
  const t = useMessages(attributesMessages);
  const [building, setBuilding] = useState(false);

  // Dance-scoped, registry-merged list (custom kinds appear too).
  const kinds = Object.values(mergeRegistry(useLocalizedRegistry(), customKinds)).filter(
    (k) => !k.appliesToDances || dance === undefined || k.appliesToDances.includes(dance),
  );

  return (
    <Sheet open={open} onClose={onClose} title={t.addAttributeTitle}>
      <ul className="flex flex-col gap-2">
        {kinds.map((kind) => (
          <li key={kind.kind}>
            <button
              type="button"
              onClick={() => onSelectKind?.(kind)}
              className="flex w-full items-center gap-3 rounded-[10px] border border-border-subtle px-3 py-3 text-left"
            >
              <span
                aria-hidden="true"
                className="size-4 flex-none rounded-[5px]"
                style={{ background: dotColor(kind) }}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
                {kind.label}
                {kind.required && (
                  // role="img" gives the "*" glyph an accessible label ("required").
                  <span
                    role="img"
                    className="ml-0.5 align-super text-2xs text-ink-muted"
                    title={t.requiredKindTitle}
                    aria-label={t.requiredBadge}
                  >
                    *
                  </span>
                )}
              </span>
              {kind.roleAware && (
                <span
                  className="flex-none rounded-[5px] border border-border-subtle px-1.5 py-0.5 text-[9px] font-bold text-ink-muted"
                  title={t.roleAwareTitle}
                >
                  {t.roleAwareBadge}
                </span>
              )}
              {kind.cardinality === "multi" && (
                <span className="flex-none text-2xs text-ink-faint">{t.multiBadge}</span>
              )}
              {!kind.builtin && (
                <span
                  className="flex-none rounded-[5px] px-1.5 py-0.5 text-[8px] font-semibold"
                  style={{
                    background: "var(--bf-scope-custom-tint)",
                    color: "var(--bf-scope-custom-ink)",
                  }}
                >
                  {t.customBadge}
                </span>
              )}
              <span aria-hidden="true" className="flex-none text-ink-faint">
                <ChevronRightIcon size={14} />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* The dashed "＋ new attribute type" footer → the custom-type builder. */}
      <button
        type="button"
        onClick={() => setBuilding(true)}
        className={cx(
          "mt-3 flex w-full items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed",
          "border-border-strong py-3 text-2xs font-bold text-ink-muted",
        )}
      >
        <PlusIcon size={12} />
        {t.newAttributeType}
      </button>

      <AddKindSheet
        open={building}
        onClose={() => setBuilding(false)}
        onCreate={(k) => {
          onCreate?.(k);
          setBuilding(false);
          // Dismiss the picker too, so the (now-merged) kind is usable in the
          // editor underneath rather than hidden behind this overlay.
          onClose();
        }}
      />
    </Sheet>
  );
}
