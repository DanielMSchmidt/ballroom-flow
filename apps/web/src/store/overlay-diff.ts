// Pure helper for the store seam: convert a figure timeline editor's full next
// attribute set (the RESOLVED timeline after an edit) into an Overlay of
// divergences against a base figure, so a variant stores only what it changed
// and non-overridden base edits still flow up via resolve() (US-006/US-036).
import type { Attribute, Overlay } from "@ballroom/domain";

/** True when an attribute is present (not soft-deleted). */
function live(a: Attribute): boolean {
  return a.deletedAt == null;
}

/**
 * Compute the Overlay that, applied to `baseAttrs` via domain `resolve`, yields
 * `nextAttrs`. Mirrors resolve(): overrides re-value a base attribute by id;
 * tombstones drop a base attribute; additions are variant-only attributes.
 */
export function overlayFromAttributes(baseAttrs: Attribute[], nextAttrs: Attribute[]): Overlay {
  const baseById = new Map(baseAttrs.map((a) => [a.id, a]));
  const nextLive = nextAttrs.filter(live);
  const nextIds = new Set(nextLive.map((a) => a.id));

  const overrides: Record<string, unknown> = {};
  const additions: Attribute[] = [];
  for (const a of nextLive) {
    const baseAttr = baseById.get(a.id);
    if (!baseAttr) {
      additions.push(a);
    } else if (!Object.is(baseAttr.value, a.value) && baseAttr.value !== a.value) {
      // Only `value` is diffed: re-timing or re-roling is modeled as tombstone+add
      // (the editor mints a new attribute id), matching domain resolve()'s contract.
      overrides[a.id] = a.value;
    }
  }

  const tombstones = baseAttrs.filter((a) => !nextIds.has(a.id)).map((a) => a.id);
  return { overrides, tombstones, additions };
}
