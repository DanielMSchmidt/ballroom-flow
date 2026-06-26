// US-024 — the Share screen: who can see a routine, in what role, plus an invite
// link to add more people. PLAN §4.7 / §5.
//
// Presentational ShareView (the §3 seam: data + handlers as props) is wrapped by
// Share, which wires the store (member roster + remove + issue-invite) and the
// viewer's own role. Membership management (remove / invite) is gated on the
// SHARED capability table (can(role,"canInvite")) so the UI and the server agree
// (principle #26) — the worker still enforces it (a client bypass is refused 403).
import { can, type EffectiveRole } from "@ballroom/domain";
import { useState } from "react";
import {
  type IssuedInvite,
  type Member,
  useIssueInvite,
  useMembers,
  useRemoveMember,
} from "../store/share";
import { Badge, type BadgeTone, Button, Card, Select, Sheet, Spinner, useToast } from "../ui";

/** Human label + one-line explanation for each role (the role microcopy, DP #15). */
const ROLE_INFO: Record<
  Member["role"] | "owner",
  { label: string; blurb: string; tone: BadgeTone }
> = {
  owner: { label: "Owner", blurb: "Full control, including sharing.", tone: "accent" },
  editor: { label: "Editor", blurb: "Can edit structure, figures, and timing.", tone: "accent" },
  commenter: { label: "Commenter", blurb: "Can add annotations, but not edit.", tone: "neutral" },
  viewer: { label: "Viewer", blurb: "Can view the routine, read-only.", tone: "neutral" },
};

const INVITE_ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer — can view" },
  { value: "commenter", label: "Commenter — can annotate" },
  { value: "editor", label: "Editor — can edit" },
] as const;

export interface ShareViewProps {
  /** The viewer's own role on this routine (gates the manage affordances). */
  viewerRole: EffectiveRole;
  /** The current member roster (each with their role). */
  members: Member[];
  /** Member roster still loading. */
  loading?: boolean;
  /** Remove a member (only rendered for a role that can manage membership). */
  onRemove?: (userId: string) => void;
  /** Issue an invite link for a role; resolves to the created invite. */
  onIssueInvite?: (role: Member["role"]) => void;
  /** The last-issued invite link (so it can be shown + copied), if any. */
  issuedInvite?: IssuedInvite | null;
  /** An invite is being issued. */
  issuing?: boolean;
}

/** Build the shareable URL for an invite token (the deep-link the invitee opens). */
function inviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/invite/${encodeURIComponent(token)}`;
}

export function ShareView({
  viewerRole,
  members,
  loading,
  onRemove,
  onIssueInvite,
  issuedInvite,
  issuing,
}: ShareViewProps) {
  const canManage = can(viewerRole, "canInvite");
  const [inviteRole, setInviteRole] = useState<Member["role"]>("viewer");
  const [pendingRemove, setPendingRemove] = useState<Member | null>(null);
  const toast = useToast();

  return (
    <section aria-label="Share this routine" className="flex flex-col gap-4">
      {/* Member roster + roles (US-024 AC-1). */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-ink">People with access</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-ink-faint" role="status">
            <Spinner /> <span className="text-2xs">Loading members…</span>
          </div>
        ) : members.length === 0 ? (
          <p className="text-2xs text-ink-faint">
            Just you so far. Invite someone with a link below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex min-h-[44px] items-center gap-3 rounded-md border border-line px-3 py-2"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-ink">{m.userId}</span>
                  <span className="text-2xs text-ink-muted">{ROLE_INFO[m.role].blurb}</span>
                </span>
                <Badge tone={ROLE_INFO[m.role].tone} className="ml-auto">
                  {ROLE_INFO[m.role].label}
                </Badge>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${m.userId}`}
                    onClick={() => setPendingRemove(m)}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invite by link (US-023 reused) — manage-capable roles only. */}
      {canManage && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-ink">Invite with a link</h2>
          <div className="flex items-end gap-2">
            <Select
              label="Role"
              options={INVITE_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Member["role"])}
            />
            <Button variant="primary" loading={issuing} onClick={() => onIssueInvite?.(inviteRole)}>
              Create link
            </Button>
          </div>
          {issuedInvite && (
            <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
              <code className="flex-1 truncate text-2xs text-ink-secondary">
                {inviteUrl(issuedInvite.token)}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(inviteUrl(issuedInvite.token));
                  toast.show("Invite link copied", { tone: "success" });
                }}
              >
                Copy
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Shared-edit microcopy (DP #15): make the CRDT-shared-figure consequence
          explicit, so an editor knows a figure edit ripples to every routine. */}
      <Card>
        <p className="text-2xs text-ink-secondary">
          <span className="font-medium text-ink">Heads up:</span> editing a shared figure changes it
          for every routine that uses it. To change it in just one place, make a variant instead.
        </p>
      </Card>

      {/* Remove confirm (principle #28: confirm a destructive action). */}
      <Sheet
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        title="Remove this person?"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-secondary">
            {pendingRemove?.userId} will lose access to this routine. You can invite them again with
            a new link.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingRemove) onRemove?.(pendingRemove.userId);
                setPendingRemove(null);
              }}
            >
              Remove access
            </Button>
          </div>
        </div>
      </Sheet>
    </section>
  );
}

/** Wire the Share screen to the store (roster + remove + invite) for a routine. */
export function Share({ docRef, viewerRole }: { docRef: string; viewerRole: EffectiveRole }) {
  const membersQ = useMembers(docRef);
  const remove = useRemoveMember(docRef);
  const issue = useIssueInvite(docRef);

  return (
    <ShareView
      viewerRole={viewerRole}
      members={membersQ.data?.members ?? []}
      loading={membersQ.isLoading}
      onRemove={(userId) => remove.mutate(userId)}
      onIssueInvite={(role) => issue.mutate({ role })}
      issuedInvite={issue.data ?? null}
      issuing={issue.isPending}
    />
  );
}
