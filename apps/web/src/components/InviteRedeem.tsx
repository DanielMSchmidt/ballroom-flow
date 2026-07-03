// US-023 — invite redemption screen (/invite/:token). Redeems the invite once on
// mount, then deep-links into the joined routine. A bad/expired/already-used
// invite shows a calm error instead of a dead end — plus an explicit button back
// to the redeemer's own choreography overview so they're never stranded.
//
// US-022 × US-023: if the invite was an EDITOR link but the server downgraded it
// to commenter (the redeemer is at their routine-edit limit on the free plan), we
// DON'T silently drop them into a read-only routine — we show a notice explaining
// what happened, and let them continue with an explicit tap.
import { useEffect, useRef, useState } from "react";
import { useMessages } from "../i18n";
import { shareMessages } from "../i18n/messages/share";
import { navigate } from "../lib/router";
import { type RedeemResult, useRedeemInvite } from "../store/invites";
import { Button, Card } from "../ui";

export function InviteRedeem({ token }: { token: string }): React.JSX.Element {
  const t = useMessages(shareMessages);
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
    // Dead-end guard: a signed-in visitor whose invite is expired/invalid/used
    // shouldn't be stranded here. Offer an explicit way to their own
    // choreography overview (the routine list at `/`). A signed-out visitor only
    // reaches this card AFTER signing in (App routes them through SignInPrompt
    // first), so this same button is their post-sign-in path to the overview.
    return (
      <Card>
        <p className="text-sm font-bold text-ink">{t.redeemErrorTitle}</p>
        <p className="mt-1 text-2xs text-ink-muted">{t.redeemErrorBody}</p>
        <div className="mt-3">
          <Button onClick={() => navigate("/")}>{t.redeemGoToOverview}</Button>
        </div>
      </Card>
    );
  }

  if (downgraded) {
    return (
      <Card>
        <p className="text-sm font-bold text-ink">{t.redeemDowngradedTitle}</p>
        <p className="mt-1 text-2xs text-ink-muted">{t.redeemDowngradedBody}</p>
        <div className="mt-3">
          <Button onClick={() => navigate(`/routines/${downgraded.docRef}`)}>
            {t.redeemOpenChoreo}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm font-bold text-ink">{t.redeemJoiningTitle}</p>
      <p className="mt-1 text-2xs text-ink-muted">{t.redeemJoiningBody}</p>
    </Card>
  );
}
