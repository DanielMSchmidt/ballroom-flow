// US-020 — per-document capability model (PLAN §5.1).
//
// PURE role → capability mapping, shared by every layer that gates on a viewer's
// per-document role: the worker REST surface, the DO sync boundary (US-021), and
// the web UI (which disables affordances per role, principle #26). Keeping it
// here (one table, no I/O) means "what can this role do" has a single source of
// truth — the worker/DO/web never re-encode it.
//
// The three STORED membership roles are viewer/commenter/editor. `owner` is not a
// stored role — it's derived from the document's ownerId — so it's modelled as an
// effective role (editor + delete-the-document) the caller resolves before asking.

/** A stored per-document membership role (the `membership.role` column). */
export type MembershipRole = "viewer" | "commenter" | "editor";

/** The role a capability check runs against — a stored role or the doc owner. */
export type EffectiveRole = MembershipRole | "owner";

/** What a role may do on a document. Color/affordance gating reads these. */
export interface Capabilities {
  /** See the document's content. */
  canRead: boolean;
  /** Add annotations/comments (not structural edits). */
  canAnnotate: boolean;
  /** Edit structure + attributes (the choreography itself). */
  canEdit: boolean;
  /** Invite or remove members. */
  canInvite: boolean;
  /** Delete the whole document (owner only). */
  canDelete: boolean;
}

export type Capability = keyof Capabilities;

const NONE: Capabilities = {
  canRead: false,
  canAnnotate: false,
  canEdit: false,
  canInvite: false,
  canDelete: false,
};

// The capability table. Each role is a strict superset of the one below it,
// except `delete`, which only the owner has.
const CAPABILITIES: Record<EffectiveRole, Capabilities> = {
  viewer: { ...NONE, canRead: true },
  commenter: { ...NONE, canRead: true, canAnnotate: true },
  editor: { ...NONE, canRead: true, canAnnotate: true, canEdit: true, canInvite: true },
  owner: { canRead: true, canAnnotate: true, canEdit: true, canInvite: true, canDelete: true },
};

/** The full capability set for a role (owner = editor + delete). */
export function capabilitiesFor(role: EffectiveRole): Capabilities {
  return CAPABILITIES[role];
}

/** Whether `role` may perform `action` (the single gate the layers call). */
export function can(role: EffectiveRole, action: Capability): boolean {
  return CAPABILITIES[role][action];
}
