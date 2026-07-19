import type { ChangeEvent } from "react";

/**
 * A typed `onChange` for a `<select>` whose option values are a known string union
 * `T`. The DOM types `e.target.value` as plain `string`; `values` (the same list
 * the options render from) narrows it back to `T` with a real membership check —
 * a sound DOM-boundary read, no assertion. Call sites stay cast-free:
 *
 *   onChange={onSelectValue(ROLES, setRole)}   // setRole: (r: Member["role"]) => void
 */
export function onSelectValue<T extends string>(values: readonly T[], set: (value: T) => void) {
  return (e: ChangeEvent<HTMLSelectElement>) => {
    const picked = values.find((v) => v === e.target.value);
    // Unreachable in practice — the select only renders options with `values`.
    if (picked !== undefined) set(picked);
  };
}
