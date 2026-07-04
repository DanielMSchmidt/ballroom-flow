import { cx } from "./cx";

export interface TabItem {
  value: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible label for the tablist. */
  label: string;
  className?: string;
}

/**
 * Tabs — segmented in-page filter (e.g. journal: all / lessons /
 * practice / by-figure). Implements the ARIA tabs pattern with
 * roving focus via arrow keys (#7, #8). Visual state is carried by
 * fill + weight, not color alone (#5).
 */
export function Tabs({ items, value, onChange, label, className }: TabsProps) {
  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + items.length) % items.length;
    const item = items[next];
    if (item) onChange(item.value);
  }

  return (
    <div role="tablist" aria-label={label} className={cx("flex flex-wrap gap-1.5", className)}>
      {items.map((item, idx) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={cx(
              "inline-flex items-center rounded-pill border px-3 text-xs font-semibold",
              "min-h-[var(--bf-touch-target)] transition-colors",
              active
                ? "bg-accent text-ink-inverse border-accent"
                : "bg-surface text-ink-secondary border-border-strong",
            )}
            style={{ transitionDuration: "var(--bf-motion-fast)" }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
