// US-023 — invite redemption screen (/invite/:token). Redeems the invite once on
// mount, then deep-links into the joined routine. A bad/expired/already-used
// invite shows a calm error instead of a dead end.
import { useEffect, useRef } from "react";
import { navigate } from "../lib/router";
import { useRedeemInvite } from "../store/invites";
import { Card } from "../ui";

export function InviteRedeem({ token }: { token: string }): React.JSX.Element {
  const redeem = useRedeemInvite();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // redeem exactly once (single-use)
    started.current = true;
    redeem.mutate(token, {
      onSuccess: (res) => navigate(`/routines/${res.docRef}`),
    });
  }, [token, redeem]);

  if (redeem.isError) {
    return (
      <Card>
        <p className="text-sm font-bold text-ink">This invite can’t be opened</p>
        <p className="mt-1 text-2xs text-ink-muted">
          The link may be invalid, expired, or already used. Ask for a fresh invite.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm font-bold text-ink">Joining…</p>
      <p className="mt-1 text-2xs text-ink-muted">Adding this routine to your list.</p>
    </Card>
  );
}
