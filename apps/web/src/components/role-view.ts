import type { Attribute } from "@ballroom/domain";

/** Visible in a lens when both-role (role=null, always) or the selected role. */
export const filterByRoleView = (attrs: Attribute[], view: "leader" | "follower"): Attribute[] =>
  attrs.filter((a) => a.role == null || a.role === view);
