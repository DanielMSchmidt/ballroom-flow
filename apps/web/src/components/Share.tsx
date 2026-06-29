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
import { useMe } from "../store/me";
import {
  type IssuedInvite,
  type Member,
  useIssueInvite,
  useMembers,
  useRemoveMember,
} from "../store/share";
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  IDENTITY_COLORS,
  ScreenHeader,
  Select,
  Sheet,
  Spinner,
  useToast,
} from "../ui";

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

/** A stable identity colour (one of the six IDENTITY_COLORS slots) for a user,
 *  so each avatar reads consistently — the roster carries no stored colour. */
function avatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return IDENTITY_COLORS[h % IDENTITY_COLORS.length] ?? IDENTITY_COLORS[0];
}

/** Round identity avatar (initial on the member's identity colour). Decorative —
 *  the name is rendered alongside, so the avatar is hidden from assistive tech. */
function Avatar({ label, userId }: { label: string; userId: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-ink-inverse"
      style={{ backgroundColor: avatarColor(userId) }}
    >
      {(label.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

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
  /** The current viewer (rendered as the "you" row at the top of the roster). */
  viewer?: { userId: string; displayName?: string };
  /** The routine's title (shown as the header subtitle). */
  routineName?: string;
  /** Member roster still loading. */
  loading?: boolean;
  /** Navigate back (renders the header's ‹ control when provided). */
  onBack?: () => void;
  /** Remove a member (only rendered for a role that can manage membership). */
  onRemove?: (userId: string) => void;
  /** Issue an invite link for a role; resolves to the created invite. */
  onIssueInvite?: (role: Member["role"]) => void;
  /** Fork the routine into a frozen, independent copy (DP #15 escape hatch). */
  onFork?: () => void;
  /** The last-issued invite link (so it can be shown + copied), if any. */
  issuedInvite?: IssuedInvite | null;
  /** An invite is being issued. */
  issuing?: boolean;
  /** A fork is in flight. */
  forking?: boolean;
}

/** Build the shareable URL for an invite token (the deep-link the invitee opens). */
function inviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/invite/${encodeURIComponent(token)}`;
}

export function ShareView({
  viewerRole,
  members,
  viewer,
  routineName,
  loading,
  onBack,
  onRemove,
  onIssueInvite,
  onFork,
  issuedInvite,
  issuing,
  forking,
}: ShareViewProps) {
  const canManage = can(viewerRole, "canInvite");
  const [inviteRole, setInviteRole] = useState<Member["role"]>("viewer");
  const [pendingRemove, setPendingRemove] = useState<Member | null>(null);
  const toast = useToast();

  const youLabel = viewer?.displayName?.trim() || viewer?.userId || "You";

  return (
    <section aria-label="Share this routine" className="flex flex-col gap-4">
      <ScreenHeader
        title="Share"
        subtitle={routineName}
        onBack={onBack}
        className="border-b-0 px-0"
      />

      {/* Member roster + roles (US-024 AC-1). */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-ink">People with access</h2>
        {/* The current viewer, surfaced first as the "you" row (frame 4.2). */}
        {viewer && (
          <div className="flex min-h-[44px] items-center gap-3 rounded-md border border-line px-3 py-2">
            <Avatar label={youLabel} userId={viewer.userId} />
            <span className="font-medium text-ink">{youLabel}</span>
            <span className="ml-auto text-2xs font-medium text-ink-muted">you · {viewerRole}</span>
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-ink-faint" role="status">
            <Spinner /> <span className="text-2xs">Loading members…</span>
          </div>
        ) : members.length === 0 && !viewer ? (
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
                <Avatar label={m.userId} userId={m.userId} />
                <span className="flex min-w-0 flex-col">
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
      <Card className="border-info bg-info-tint">
        <p className="text-2xs text-info-ink">
          <span className="font-medium">Heads up:</span> editing a shared figure changes it for
          every routine that uses it. To branch off on your own, fork the routine — you'll get a
          frozen, independent copy. To change it in just one place, make a variant instead.
        </p>
      </Card>

      {/* Fork — a frozen, independent copy (DP #15 escape hatch; frame 4.2 CTA). */}
      {onFork && (
        <Button
          variant="primary"
          fullWidth
          loading={forking}
          leadingIcon={<span aria-hidden="true">⑂</span>}
          onClick={() => onFork()}
        >
          Fork — make it your own
        </Button>
      )}

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

/** Wire the Share screen to the store (roster + remove + invite) for a routine.
 *  `routineName` / `onBack` / `onFork` are optional hooks the host screen passes
 *  through (the fork flow lives outside this seam — frame 4.2 CTA). */
export function Share({
  docRef,
  viewerRole,
  routineName,
  onBack,
  onFork,
}: {
  docRef: string;
  viewerRole: EffectiveRole;
  routineName?: string;
  onBack?: () => void;
  onFork?: () => void;
}) {
  const me = useMe();
  const membersQ = useMembers(docRef);
  const remove = useRemoveMember(docRef);
  const issue = useIssueInvite(docRef);
  const viewer = me.data?.sub
    ? { userId: me.data.sub, displayName: me.data.displayName }
    : undefined;

  return (
    <ShareView
      viewerRole={viewerRole}
      viewer={viewer}
      routineName={routineName}
      members={membersQ.data?.members ?? []}
      loading={membersQ.isLoading}
      onBack={onBack}
      onRemove={(userId) => remove.mutate(userId)}
      onIssueInvite={(role) => issue.mutate({ role })}
      onFork={onFork}
      issuedInvite={issue.data ?? null}
      issuing={issue.isPending}
    />
  );
}
