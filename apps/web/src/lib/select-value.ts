import type { ChangeEvent } from "react";

/**
 * A typed `onChange` for a `<select>` whose option values are a known string union
 * `T`. The DOM types `e.target.value` as plain `string`, but the select only ever
 * renders options with `T` values, so narrowing to `T` is a sound DOM-boundary read.
 * This is the ONE place that assertion lives (CLAUDE.md §4) — call sites stay
 * cast-free:
 *
 *   onChange={onSelectValue(setRole)}   // setRole: (r: Member["role"]) => void
 */
export function onSelectValue<T extends string>(set: (value: T) => void) {
  return (e: ChangeEvent<HTMLSelectElement>) => set(e.target.value as T);
}
