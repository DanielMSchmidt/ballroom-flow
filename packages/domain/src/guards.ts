// Honest narrowing helpers for `unknown` values (CLAUDE.md §4 — no casts).
//
// These are the sanctioned alternative to `as`-asserting around untyped data:
// each predicate performs the runtime check that MAKES its claim true, so the
// compiler-visible type never diverges from reality. Use them wherever a value
// arrives untyped (JSON, Automerge patch paths, storage rows, migration input)
// instead of asserting a shape.

/** A plain indexable object (arrays included — they index like objects too). */
export function isRecord(value: unknown): value is Record<string | number, unknown> {
  return value !== null && typeof value === "object";
}

/** A plain non-array object — use when spreading/iterating string keys. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The entity's string `id`, or undefined when it has none (not an object,
 *  no `id` key, or a non-string id). */
export function stringIdOf(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.id === "string") return value.id;
  return undefined;
}
