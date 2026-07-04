// US-012 — Zod schemas: lenient read / strict write (PLAN §3, D7, §10.2).
//
// One vocabulary, two postures (D7 "forward-compatible reads, strict writes"):
//   • READ is LENIENT — a future/unknown value survives (no data loss); aliases
//     normalize (the split diagonal diag_forward/diag_back → diagonal). This
//     keeps old clients reading new data.
//   • WRITE is STRICT — a value written to a KNOWN enum kind must be in that
//     kind's registry enum, and (when a dance meter is given) the count must be a
//     valid timing position: ≥ 1 and on the 1/8-note grid. This stops bad data
//     entering a doc.
//
// Both are DERIVED from the merged ATTRIBUTE_REGISTRY (US-003) + DANCES (US-002),
// so adding a registry value or a dance automatically widens what writes accept —
// the schema is data, not a hand-maintained enum.
import { z } from "zod";
import type { DanceId } from "./dances";
import type { Attribute, Role } from "./doc-types";
import { isOnEighthGrid } from "./timing";
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

/** Normalize an attribute's value through the read-side aliases (diag_*→diagonal). */
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
 *   • When `ctx.dance` is given, `count` must be a VALID TIMING POSITION:
 *     `count ≥ 1` AND on the 1/8-note grid (the e/&/a/i subdivisions, US-004).
 *     It may EXCEED `phraseBeats` — figures span multiple phrases (§2.5 "modulo
 *     the counted phrase"; `countToPhrase` wraps counts ≥ phraseBeats into later
 *     phrases, `barsForFigure` computes multi-phrase spans). So the "meter's valid
 *     range" governs the sub-beat grid + positivity, NOT an absolute phrase cap.
 *
 * UNIFORM ERROR CONTRACT: every failure — structural, invalid value, or invalid
 * timing — is raised as a single **`ZodError`** (via `superRefine`), so a caller
 * can `catch` one type and read `error.issues`. Each domain-rule issue carries a
 * stable `params.code` (`"unknown_value"` | `"count_below_one"` | `"count_off_grid"`)
 * plus the raw offending data (kind/value/allowedValues, count) so consumers
 * (US-029 editor, the worker write route) format their own message from
 * structured fields instead of regexing dev strings. The field set is
 * intentionally minimal — more can be added compatibly when US-029 lands.
 */
export function parseAttributeWrite(input: unknown, ctx?: { dance?: DanceId }): Attribute {
  const schema = baseAttribute
    .transform((attr) => withNormalizedValue(attr))
    .superRefine((attr, refineCtx) => {
      // Value must be a known registry value for a known CLOSED enum kind. A
      // free-text kind (step, §3/#83) treats `values` as suggestions, so any
      // string passes — only its non-string/empty shape would be invalid.
      const kind = ATTRIBUTE_REGISTRY[attr.kind];
      if (kind?.valueType === "enum" && kind.values && !kind.freeText) {
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

      // Dance gate: a kind whose `appliesToDances` EXCLUDES this figure's dance is
      // rejected (e.g. `rise` omits Tango, §3/§10.2). Only checked when the dance is
      // known — the DO seed route and the store seam both supply it, so this closes
      // the WRITE-path gap the reading view only HID before (T9a). A kind with no
      // `appliesToDances` applies to every dance and is never gated here.
      if (ctx?.dance && kind?.appliesToDances && !kind.appliesToDances.includes(ctx.dance)) {
        refineCtx.addIssue({
          code: "custom",
          path: ["kind"],
          message: `Kind "${attr.kind}" does not apply to ${ctx.dance}`,
          params: {
            code: "dance_not_applicable",
            kind: attr.kind,
            dance: ctx.dance,
            appliesToDances: kind.appliesToDances,
          },
        });
      }

      // Timing: a valid position is ≥ 1 and on the 1/8 grid. Counts MAY exceed
      // phraseBeats (multi-phrase figures wrap, §2.5/US-004) — no phrase cap.
      if (ctx?.dance) {
        if (attr.count < 1) {
          refineCtx.addIssue({
            code: "custom",
            path: ["count"],
            message: `Count ${attr.count} is below the first beat (must be ≥ 1)`,
            params: { code: "count_below_one", dance: ctx.dance, count: attr.count },
          });
        } else if (!isOnEighthGrid(attr.count)) {
          refineCtx.addIssue({
            code: "custom",
            path: ["count"],
            message: `Count ${attr.count} is off the 1/8-note grid`,
            params: { code: "count_off_grid", dance: ctx.dance, count: attr.count },
          });
        }
      }
    });

  return toAttribute(schema.parse(input));
}
