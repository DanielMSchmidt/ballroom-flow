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
import { useMe } from "../store/me";
import { useCreateRoutine, useRoutines } from "../store/routines";
import { Button, Spinner } from "../ui";
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
  const { getToken } = useAppAuth();

  const items = routinesQ.data?.routines ?? [];
  const ownedCount = items.filter((r) => r.role === "owner").length;
  const plan = me.data?.plan ?? "free";

  if (openRoutineId) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          ← All routines
        </Button>
        {routinesQ.isLoading ? (
          // Resolve the viewer's role from their list BEFORE opening, so a
          // shared routine never flashes editor affordances during the load.
          <div className="flex items-center gap-2 p-6 text-ink-faint" role="status">
            <Spinner /> <span className="text-2xs">Loading…</span>
          </div>
        ) : (
          <Assemble
            routineId={openRoutineId}
            role={roleForOpen(items, openRoutineId)}
            getToken={() => getToken()}
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
