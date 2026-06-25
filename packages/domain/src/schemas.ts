// US-012 — Zod schemas: lenient read / strict write (PLAN §3, D7, §10.2).
//
// One vocabulary, two postures (D7 "forward-compatible reads, strict writes"):
//   • READ is LENIENT — a future/unknown value survives (no data loss); aliases
//     normalize (CBP→CBMP). This keeps old clients reading new data.
//   • WRITE is STRICT — a value written to a KNOWN enum kind must be in that
//     kind's registry enum, and (when a dance meter is given) the count must fall
//     within the dance's counted phrase. This stops bad data entering a doc.
//
// Both are DERIVED from the merged ATTRIBUTE_REGISTRY (US-003) + DANCES (US-002),
// so adding a registry value or a dance automatically widens what writes accept —
// the schema is data, not a hand-maintained enum.
import { z } from "zod";
import { DANCES, type DanceId } from "./dances";
import type { Attribute, Role } from "./doc-types";
import { ATTRIBUTE_REGISTRY, normalizeValue } from "./vocabulary";

/** The structural shape shared by read + write (value validity differs). */
const baseAttribute = z.object({
  id: z.string(),
  kind: z.string(),
  count: z.number(),
  role: z.enum(["leader", "follower"]).nullish(),
  value: z.unknown(),
  deletedAt: z.number().nullish(),
});

/** Normalize an attribute's value through the read-side aliases (CBP→CBMP). */
function withNormalizedValue<T extends { kind: string; value: unknown }>(attr: T): T {
  if (typeof attr.value === "string") {
    return { ...attr, value: normalizeValue(attr.kind, attr.value) };
  }
  return attr;
}

/** Coerce the parsed structural object into the domain Attribute shape. */
function toAttribute(parsed: z.infer<typeof baseAttribute>): Attribute {
  return {
    id: parsed.id,
    kind: parsed.kind,
    count: parsed.count,
    role: (parsed.role ?? null) as Role,
    value: parsed.value,
    deletedAt: parsed.deletedAt ?? null,
  };
}

/**
 * Lenient READ parse: validate the structural shape, normalize aliases, and pass
 * the value through unchanged even if it is not a known registry value (forward
 * compatibility — an unknown value must survive a round-trip, never be dropped).
 */
export function parseAttributeRead(input: unknown): Attribute {
  const parsed = baseAttribute.parse(input);
  return toAttribute(withNormalizedValue(parsed));
}

/**
 * Strict WRITE parse: structural shape + value/timing validity.
 *   • For a known ENUM kind, the (normalized) value must be in the kind's enum.
 *     Unknown kinds (user-defined, not yet in this registry copy) and non-enum
 *     kinds are not value-restricted here.
 *   • When `ctx.dance` is given, `count` must fall within the dance's counted
 *     phrase (1 ≤ count < phraseBeats+1) — a count beyond the phrase is invalid.
 *
 * UNIFORM ERROR CONTRACT: every failure — structural, invalid value, or
 * out-of-range count — is raised as a single **`ZodError`** (via `superRefine`),
 * so a caller can `catch` one type and read `error.issues`. Each domain-rule
 * issue carries a stable `params.code` (`"unknown_value"` | `"count_out_of_range"`)
 * plus the raw offending data (kind/value/count, allowedValues/phraseBeats) so
 * consumers (US-029 editor, the worker write route) format their own message
 * from structured fields instead of regexing dev strings. The field set is
 * intentionally minimal — more can be added compatibly when US-029 lands.
 */
export function parseAttributeWrite(input: unknown, ctx?: { dance?: DanceId }): Attribute {
  const schema = baseAttribute
    .transform((attr) => withNormalizedValue(attr))
    .superRefine((attr, refineCtx) => {
      // Value must be a known registry value for a known enum kind.
      const kind = ATTRIBUTE_REGISTRY[attr.kind];
      if (kind?.valueType === "enum" && kind.values) {
        if (typeof attr.value !== "string" || !kind.values.includes(attr.value)) {
          refineCtx.addIssue({
            code: "custom",
            path: ["value"],
            message: `Invalid value ${JSON.stringify(attr.value)} for kind "${attr.kind}"`,
            params: {
              code: "unknown_value",
              kind: attr.kind,
              value: attr.value,
              allowedValues: kind.values,
            },
          });
        }
      }

      // Timing must fall within the dance's counted phrase, when a meter is given.
      if (ctx?.dance) {
        const { phraseBeats } = DANCES[ctx.dance];
        if (attr.count < 1 || attr.count >= phraseBeats + 1) {
          refineCtx.addIssue({
            code: "custom",
            path: ["count"],
            message: `Count ${attr.count} is outside the ${ctx.dance} phrase (1..${phraseBeats})`,
            params: {
              code: "count_out_of_range",
              dance: ctx.dance,
              count: attr.count,
              phraseBeats,
            },
          });
        }
      }
    });

  return toAttribute(schema.parse(input));
}
