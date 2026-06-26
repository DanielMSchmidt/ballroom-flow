// US-025 — the Choreo flow: wires the store (list + create) to the ChoreoList
// and switches between the list and a single routine's Assemble screen.
//
// Navigation is a MINIMAL state seam, not a router dependency (YAGNI): a selected
// routine lives in local state — null shows the list, set shows Assemble with a
// back action. A real deep-linkable router is a later concern.
import { useState } from "react";
import { useMe } from "../store/me";
import { useCreateRoutine, useRoutines } from "../store/routines";
import { Button } from "../ui";
import { Assemble, type MembershipRole } from "./Assemble";
import { ChoreoList } from "./ChoreoList";

export function ChoreoFlow() {
  const routinesQ = useRoutines();
  const me = useMe();
  const create = useCreateRoutine();
  const [open, setOpen] = useState<{ id: string; role: MembershipRole } | null>(null);

  const items = routinesQ.data?.routines ?? [];
  const ownedCount = items.filter((r) => r.role === "owner").length;
  const plan = me.data?.plan ?? "free";

  /** Open a routine: the owner edits (owner → editor); others get their role. */
  const openRoutine = (docRef: string): void => {
    const found = items.find((r) => r.docRef === docRef);
    const role: MembershipRole = found && found.role !== "owner" ? found.role : "editor";
    setOpen({ id: docRef, role });
  };

  if (open) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
          ← All routines
        </Button>
        <Assemble routineId={open.id} role={open.role} />
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
        // so open it as an editor; the list refetches in the background.
        create.mutate(input, { onSuccess: (res) => setOpen({ id: res.docRef, role: "editor" }) })
      }
      onOpen={openRoutine}
    />
  );
}
