import type { ReactNode } from "react";
import { useMessages } from "../i18n";
import { uiMessages } from "../i18n/messages/ui";
import { BuildStamp } from "./BuildStamp";
import { cx } from "./cx";
import { BrandMark } from "./icons";
import { LanguageToggle } from "./LanguageToggle";

export interface NavItem {
  value: string;
  label: string;
  /** Render the icon given its active state (so active can restyle). */
  icon: (active: boolean) => ReactNode;
}

export interface AppShellProps {
  nav: NavItem[];
  current: string;
  onNavigate: (value: string) => void;
  /** Optional header slot (rendered above content on desktop only). */
  children: ReactNode;
}

/**
 * AppShell — the app frame.
 * - Mobile (default): a centered phone-width column with a persistent
 *   bottom nav in the thumb zone (#1, #4); honors the iOS safe area.
 * - Desktop (lg+): the bottom nav becomes a left side rail and the
 *   content is an intentional centered max column — not a stretched
 *   mobile view (#2).
 * Nav is a labelled <nav> with aria-current on the active item;
 * every target is ≥44px (#3) and keyboard-operable (#7, #8).
 */
export function AppShell({ nav, current, onNavigate, children }: AppShellProps) {
  const t = useMessages(uiMessages);
  return (
    <div className="flex min-h-dvh flex-col bg-backdrop lg:flex-row">
      {/* Desktop side rail (lg+) */}
      <nav
        aria-label={t.navPrimaryLabel}
        className={cx(
          "hidden shrink-0 border-r border-border-subtle bg-surface-raised px-2 py-4",
          "lg:flex lg:w-56 lg:flex-col lg:gap-1",
        )}
      >
        <span className="mb-3 flex items-center gap-2.5 px-3 text-lg font-bold tracking-tight text-ink">
          <BrandMark size={26} className="shrink-0 text-accent" />
          Weave Steps
        </span>
        {nav.map((item) => {
          const active = item.value === current;
          return (
            <button
              key={item.value}
              type="button"
              data-tour={`nav-${item.value}`}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(item.value)}
              className={cx(
                "flex items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors",
                "min-h-[var(--bf-touch-target)]",
                active ? "bg-accent-tint text-accent-ink" : "text-ink-secondary",
              )}
              style={{ transitionDuration: "var(--bf-motion-fast)" }}
            >
              <span className={active ? "text-accent" : "text-ink-muted"}>{item.icon(active)}</span>
              {item.label}
            </button>
          );
        })}
        {/* Language shortcut pinned to the rail's bottom — the same live
            EN/DE switch Profile carries, always reachable on desktop. */}
        <div className="mt-auto px-3 pb-1">
          <LanguageToggle />
        </div>
      </nav>

      {/* Content column — centered + max width so desktop is intentional (#2) */}
      <div className="flex min-h-0 flex-1 flex-col">
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-0 lg:px-6 lg:py-6">
          {children}
          {/* Deployed commit SHA — a quiet version check at the foot of every
              app screen (renders nothing in dev/test/E2E). */}
          <div className="mt-6 px-4 pb-2 text-right lg:px-0">
            <BuildStamp />
          </div>
        </main>

        {/* Mobile bottom nav (hidden on lg+) */}
        <nav
          aria-label={t.navTabBarLabel}
          className={cx(
            "sticky bottom-0 flex border-t border-border-subtle bg-surface-raised lg:hidden",
          )}
          style={{ paddingBottom: "env(safe-area-inset-bottom)", zIndex: "var(--bf-z-nav)" }}
        >
          {nav.map((item) => {
            const active = item.value === current;
            return (
              <button
                key={item.value}
                type="button"
                data-tour={`nav-${item.value}`}
                aria-current={active ? "page" : undefined}
                onClick={() => onNavigate(item.value)}
                className={cx(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 py-2",
                  "min-h-[var(--bf-touch-target)]",
                  active ? "text-accent" : "text-ink-muted",
                )}
              >
                {item.icon(active)}
                <span className={cx("text-2xs", active ? "font-bold" : "font-semibold")}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
