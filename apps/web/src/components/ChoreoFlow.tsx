// US-025 — the Choreo flow: wires the store (list + create) to the ChoreoList
// and switches between the list and a single routine's Assemble screen.
//
// Navigation is deep-linkable (#179): the open routine lives in the URL
// (/routines/:id), so it survives a refresh and can be linked to. The viewer's
// role for an open routine is resolved from their list (owner → editor); a
// freshly-created or not-yet-listed routine opens optimistically as editor and
// the server boundary stays the real gate.
import { useAppAuth } from "../auth/app-auth";
import { navigate } from "../lib/router";
import { useDocAccess } from "../store/access";
import { useMe } from "../store/me";
import { isQuotaError, useCreateRoutine, useForkRoutine, useRoutines } from "../store/routines";
import { AccessDenied, Button, Spinner } from "../ui";
import { Assemble, type MembershipRole } from "./Assemble";
import { ChoreoList } from "./ChoreoList";

/** Resolve the viewer's editing role for an open routine from their list. */
function roleForOpen(
  routines: { docRef: string; role: string }[],
  routineId: string,
): MembershipRole {
  const found = routines.find((r) => r.docRef === routineId);
  // owner → editor; a non-owner member keeps their role; not-yet-listed (fresh
  // create / deep link) opens optimistically as editor — the DO boundary gates.
  if (found && found.role !== "owner") return found.role as MembershipRole;
  return "editor";
}

export function ChoreoFlow({ openRoutineId }: { openRoutineId?: string }): React.JSX.Element {
  const routinesQ = useRoutines();
  const me = useMe();
  const create = useCreateRoutine();
  const fork = useForkRoutine();
  const { getToken } = useAppAuth();
  // Access preflight (#178): for an OPEN routine, learn DENIED vs allowed before
  // opening the heavy WS store, so a non-member sees the calm access-denied state
  // rather than a connectivity-looking offline flash (DP #20).
  const access = useDocAccess(openRoutineId ?? "", { enabled: Boolean(openRoutineId) });

  const items = routinesQ.data?.routines ?? [];
  const ownedCount = items.filter((r) => r.role === "owner").length;
  const plan = me.data?.plan ?? "free";
  // The free-plan cap comes from the server (/api/me), never a 2nd hardcoded
  // constant (#176); the POST /api/routines 402 enforces the same value.
  const routineCap = me.data?.routineCap;
  // A create blocked by the server quota (402) — surface the upsell even if the
  // instant gate was bypassed (e.g. another tab consumed the last slot).
  const quotaBlocked = isQuotaError(create.error);

  if (openRoutineId) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          ← All routines
        </Button>
        {access.state === "denied" ? (
          <AccessDenied
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate("/")}>
                Back to your routines
              </Button>
            }
          />
        ) : access.state === "checking" || routinesQ.isLoading ? (
          // Resolve access + the viewer's role BEFORE opening, so a shared routine
          // never flashes editor affordances (or an offline state) during the load.
          <div className="flex items-center gap-2 p-6 text-ink-faint" role="status">
            <Spinner /> <span className="text-2xs">Loading…</span>
          </div>
        ) : (
          <Assemble
            routineId={openRoutineId}
            role={roleForOpen(items, openRoutineId)}
            currentUserId={me.data?.sub}
            getToken={() => getToken()}
            forking={fork.isPending}
            onFork={() =>
              // Fork → a new owned, frozen copy; deep-link to it once created.
              fork.mutate(openRoutineId, {
                onSuccess: (res) => navigate(`/routines/${res.docRef}`),
              })
            }
          />
        )}
      </div>
    );
  }

  return (
    <ChoreoList
      routines={items}
      ownedCount={ownedCount}
      plan={plan}
      cap={routineCap}
      quotaBlocked={quotaBlocked}
      creating={create.isPending}
      onCreate={(input) =>
        // A freshly-created routine isn't in the list yet — the creator owns it,
        // so deep-link to it; the list refetches in the background.
        create.mutate(input, { onSuccess: (res) => navigate(`/routines/${res.docRef}`) })
      }
      onOpen={(docRef) => navigate(`/routines/${docRef}`)}
    />
  );
}
