import { useMessages } from "../i18n";
import { uiMessages } from "../i18n/messages/ui";
import { cx } from "./cx";
import { CustomIcon, GlobeIcon } from "./icons";
import type { FigureScope } from "./tokens";

export interface ScopeBadgeProps {
  scope: FigureScope;
  /** Compact form: icon only, no word label (for dense trailing slots). */
  compact?: boolean;
  className?: string;
}

interface ScopeMeta {
  Icon: typeof GlobeIcon;
  bg: string;
  fg: string;
  bd: string;
}

// Each scope = a distinct, consistent treatment carried by WORD + ICON
// + COLOR together — color is never the only signal (#5, #11). The word
// itself is localized (uiMessages) and resolved in the component.
const META: Record<FigureScope, ScopeMeta> = {
  library: {
    Icon: GlobeIcon,
    bg: "var(--bf-scope-global-tint)",
    fg: "var(--bf-scope-global-ink)",
    bd: "var(--bf-scope-global-border)",
  },
  custom: {
    Icon: CustomIcon,
    bg: "var(--bf-scope-custom-tint)",
    fg: "var(--bf-scope-custom-ink)",
    bd: "var(--bf-scope-custom-border)",
  },
};

/**
 * ScopeBadge — encodes the two figure scopes (library / custom) by content
 * divergence (docs/concepts/figures.md § The custom badge): a figure whose
 * attributes still match the catalog
 * reads "Library"; one that has diverged reads "Custom". Each scope is a
 * consistent text + icon + color treatment (DESIGN-PRINCIPLES #11).
 */
export function ScopeBadge({ scope, compact, className }: ScopeBadgeProps) {
  const t = useMessages(uiMessages);
  const m = META[scope];
  const { Icon } = m;
  const word = scope === "library" ? t.scopeLibrary : t.scopeCustom;

  // Meaning is carried by visible text (the scope word) — no aria-label needed
  // (#5). In compact (icon-only) mode the scope word moves to sr-only so AT
  // users still get the label. An sr-only " figure" gives screen readers context.
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
      {compact ? (
        <span className="bf-sr-only">
          {word}
          {t.scopeFigureSuffix}
        </span>
      ) : (
        <>
          <span>{word}</span>
          <span className="bf-sr-only">{t.scopeFigureSuffix}</span>
        </>
      )}
    </span>
  );
}
