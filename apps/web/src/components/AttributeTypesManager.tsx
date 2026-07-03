// Frame 1.17 — Profile · Attribute types manager. A section under the Profile
// identity area that lists the controlled vocabulary: the standard (locked) kinds
// and any custom (choreo-scoped) kinds, each with a colour dot, its cardinality,
// and a scope label. A "＋ new type" affordance opens the custom-type builder
// (the shared AddKindSheet, frame 1.16).
//
// Registry-driven: standard rows come from ATTRIBUTE_REGISTRY; custom rows from
// the passed-in account/choreo kinds. Each row surfaces the registry data — the
// colour dot, cardinality, an "L/F" badge for a role-aware kind (`roleAware`),
// a "required" marker for a core slot (`required`), and the scope label. A
// custom kind that carries `roleAware`/`required` gets the same affordances.
import type { RegistryKind } from "@ballroom/domain";
import { useState } from "react";
import { useLocalizedRegistry, useMessages } from "../i18n";
import { attributesMessages } from "../i18n/messages/attributes";
import { Button, PlusIcon } from "../ui";
import { ATTRIBUTE_KINDS, type AttributeKind, kindVar } from "../ui/tokens";
import { AddKindSheet } from "./AddKindSheet";

export interface AttributeTypesManagerProps {
  /** Custom (choreo-scoped) kinds the account can see; standard kinds are added. */
  customKinds?: RegistryKind[];
  /** Persist a newly-built custom kind (the builder's onCreate). */
  onCreateKind?: (kind: RegistryKind) => void;
}

function isStandardKind(kind: string): kind is AttributeKind {
  return (ATTRIBUTE_KINDS as readonly string[]).includes(kind);
}
function dotColor(kind: RegistryKind): string {
  return isStandardKind(kind.kind) ? kindVar(kind.kind) : kind.color;
}

export function AttributeTypesManager({
  customKinds = [],
  onCreateKind,
}: AttributeTypesManagerProps) {
  const t = useMessages(attributesMessages);
  const [building, setBuilding] = useState(false);
  // Standard kinds first (locked), then the custom (choreo-scoped) ones.
  const standard = Object.values(useLocalizedRegistry());
  const rows: { kind: RegistryKind; custom: boolean }[] = [
    ...standard.map((kind) => ({ kind, custom: false })),
    ...customKinds.map((kind) => ({ kind, custom: true })),
  ];

  return (
    <section className="flex flex-col gap-3 border-t border-border-subtle pt-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xs font-bold uppercase tracking-wide text-ink-muted">
          {t.attributeTypes}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<PlusIcon size={12} />}
          onClick={() => setBuilding(true)}
        >
          {t.newType}
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map(({ kind, custom }) => (
          <li
            key={`${custom ? "custom" : "std"}-${kind.kind}`}
            className="flex items-center gap-3 rounded-[10px] border-[1.5px] px-3 py-2.5"
            style={{
              background: custom ? "var(--bf-scope-custom-tint)" : "var(--bf-surface)",
              borderColor: custom ? "var(--bf-scope-custom-border)" : "var(--bf-border-subtle)",
            }}
          >
            <span
              aria-hidden="true"
              className="size-3.5 flex-none rounded-[4px]"
              style={{ background: dotColor(kind) }}
            />
            <span
              className="min-w-0 flex-1 truncate text-[13px] font-bold"
              style={{ color: custom ? "var(--bf-scope-custom-ink)" : "var(--bf-ink)" }}
            >
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
            <span className="flex-none text-2xs text-ink-muted">{kind.cardinality}</span>
            <span aria-hidden="true" className="flex-none text-ink-faint">
              ·
            </span>
            <span
              className="flex-none text-2xs font-semibold"
              style={{ color: custom ? "var(--bf-scope-custom-ink)" : "var(--bf-ink-faint)" }}
            >
              {custom ? t.scopeThisChoreo : t.scopeStandard}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-2xs italic text-ink-faint" style={{ fontFamily: "var(--bf-font-note)" }}>
        {t.typesExplainer}
      </p>

      {/* The custom-type builder (frame 1.16). */}
      <AddKindSheet
        open={building}
        onClose={() => setBuilding(false)}
        onCreate={(k) => {
          onCreateKind?.(k);
          setBuilding(false);
        }}
      />
    </section>
  );
}
