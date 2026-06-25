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
 * Throws (ZodError / Error) on any violation.
 */
export function parseAttributeWrite(input: unknown, ctx?: { dance?: DanceId }): Attribute {
  const parsed = withNormalizedValue(baseAttribute.parse(input));

  // Value must be a known registry value for a known enum kind.
  const kind = ATTRIBUTE_REGISTRY[parsed.kind];
  if (kind?.valueType === "enum" && kind.values) {
    if (typeof parsed.value !== "string" || !kind.values.includes(parsed.value)) {
      throw new Error(
        `Invalid value ${JSON.stringify(parsed.value)} for kind "${parsed.kind}" on write`,
      );
    }
  }

  // Timing must fall within the dance's counted phrase, when a meter is given.
  if (ctx?.dance) {
    const { phraseBeats } = DANCES[ctx.dance];
    if (parsed.count < 1 || parsed.count >= phraseBeats + 1) {
      throw new Error(
        `Count ${parsed.count} is outside the ${ctx.dance} phrase (1..${phraseBeats})`,
      );
    }
  }

  return toAttribute(parsed);
}
