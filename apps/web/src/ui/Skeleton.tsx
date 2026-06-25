import { cx } from "./cx";

export interface SkeletonProps {
  /** Tailwind width/height utilities or arbitrary values via className. */
  className?: string;
  /** Shape. `text` = a rounded bar; `block` = a card-ish rectangle. */
  variant?: "text" | "block" | "circle";
}

/**
 * Skeleton — placeholder for content loading (DESIGN-PRINCIPLES #18,
 * #21). The pulse is motion-gated (#9) and the element is hidden from
 * AT (a sibling live region / status text carries the loading state).
 */
export function Skeleton({ className, variant = "text" }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "block bg-surface-sunken",
        variant === "text" && "h-3 rounded-sm",
        variant === "block" && "h-16 rounded-lg",
        variant === "circle" && "rounded-round",
        className,
      )}
      style={{ animation: "bf-skeleton 1.4s var(--bf-ease-in-out) infinite" }}
    />
  );
}

/** SkeletonRow — a list-row-shaped skeleton for progressive loads (#21). */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-default bg-surface px-3.5 py-3">
      <Skeleton variant="circle" className="size-10 shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="w-1/2" />
        <Skeleton className="w-1/3" />
      </div>
    </div>
  );
}
