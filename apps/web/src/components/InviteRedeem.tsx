// US-023 — invite redemption screen (/invite/:token). Redeems the invite once on
// mount, then deep-links into the joined routine. A bad/expired/already-used
// invite shows a calm error instead of a dead end.
//
// US-022 × US-023: if the invite was an EDITOR link but the server downgraded it
// to commenter (the redeemer is at their routine-edit limit on the free plan), we
// DON'T silently drop them into a read-only routine — we show a notice explaining
// what happened, and let them continue with an explicit tap.
import { useEffect, useRef, useState } from "react";
import { navigate } from "../lib/router";
import { type RedeemResult, useRedeemInvite } from "../store/invites";
import { Button, Card } from "../ui";

export function InviteRedeem({ token }: { token: string }): React.JSX.Element {
  const redeem = useRedeemInvite();
  const started = useRef(false);
  const [downgraded, setDowngraded] = useState<RedeemResult | null>(null);

  useEffect(() => {
    if (started.current) return; // redeem exactly once (single-use)
    started.current = true;
    redeem.mutate(token, {
      onSuccess: (res) => {
        // Editor link capped to commenter → pause on a notice instead of opening
        // straight into a read-only routine they expected to edit.
        if (res.downgraded) setDowngraded(res);
        else navigate(`/routines/${res.docRef}`);
      },
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

  if (downgraded) {
    return (
      <Card>
        <p className="text-sm font-bold text-ink">Joined as a commenter</p>
        <p className="mt-1 text-2xs text-ink-muted">
          You’re at your limit of routines you can edit on the free plan, so you’ve joined this
          routine as a commenter — you can read and comment, but not edit it. Upgrade to edit more
          routines.
        </p>
        <div className="mt-3">
          <Button onClick={() => navigate(`/routines/${downgraded.docRef}`)}>Open routine</Button>
        </div>
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
