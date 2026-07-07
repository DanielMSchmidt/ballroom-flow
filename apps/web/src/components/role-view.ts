// Shared role-lens + value-display helpers used by both the figure timeline
// (FigureTimeline) and the Lanes view, so the two surfaces stay consistent and
// the logic isn't duplicated.
import type { Attribute } from "@weavesteps/domain";
import { type AttributeKind, isAttributeKind } from "../ui";

/** The leader/follower view lens. */
export type RoleView = "leader" | "follower";

/** Visible in a lens when both-role (role=null, always) or the selected role. */
export const filterByRoleView = (attrs: Attribute[], view: RoleView): Attribute[] =>
  attrs.filter((a) => a.role == null || a.role === view);

/** The other side of a leader/follower toggle. */
export const flipped = (v: RoleView): RoleView => (v === "leader" ? "follower" : "leader");

/** Capitalize a role for display ("leader" → "Leader"). */
export const roleLabel = (v: RoleView): string => v.charAt(0).toUpperCase() + v.slice(1);

/** Tint a value chip by its attribute kind when that kind has a token color. */
export const chipTone = (kind: string): AttributeKind | "neutral" =>
  isAttributeKind(kind) ? kind : "neutral";

/** A displayable label for an attribute value (string, or a joined set). */
export const displayValue = (value: unknown): string =>
  Array.isArray(value) ? value.map(String).join(", ") : String(value);
