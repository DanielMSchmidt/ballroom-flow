// US-025 — the Choreo flow: wires the store (list + create) to the ChoreoList
// and switches between the list and a single routine's Assemble screen.
//
// Navigation is deep-linkable (#179): the open routine lives in the URL
// (/routines/:id), so it survives a refresh and can be linked to. The viewer's
// role for an open routine is resolved from their list (owner → editor); a
// freshly-created or not-yet-listed routine opens optimistically as editor and
// the server boundary stays the real gate.
//
// US-045/US-046: on mount, fetch templates + wire header search + fork.
import type { RoutineListItem, SearchResult } from "@ballroom/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppAuth } from "../auth/app-auth";
import { navigate } from "../lib/router";
import { useDocAccess } from "../store/access";
import { useMe } from "../store/me";
import { isQuotaError, useCreateRoutine, useForkRoutine, useRoutines } from "../store/routines";
import { search } from "../store/search";
import { forkTemplate, listTemplates } from "../store/templates";
import { AccessDenied, Button, Spinner, useToast } from "../ui";
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

/** Debounce delay (ms) for the header search (US-046). */
const SEARCH_DEBOUNCE_MS = 300;

export function ChoreoFlow({ openRoutineId }: { openRoutineId?: string }): React.JSX.Element {
  const routinesQ = useRoutines();
  const me = useMe();
  const create = useCreateRoutine();
  const fork = useForkRoutine();
  const { getToken } = useAppAuth();
  const toast = useToast();
  // Access preflight (#178): for an OPEN routine, learn DENIED vs allowed before
  // opening the heavy WS store, so a non-member sees the calm access-denied state
  // rather than a connectivity-looking offline flash (DP #20).
  const access = useDocAccess(openRoutineId ?? "", { enabled: Boolean(openRoutineId) });

  // US-045: template list (app-owned sample routines).
  const [templates, setTemplates] = useState<RoutineListItem[]>([]);
  // US-046: search results (empty until the user types).
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  // Debounce timer ref — cleared on each keystroke, fired after the delay.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A template-fork blocked by the server quota (402) — feeds the upsell, same
  // path as a create 402 (the ChoreoList upsell Sheet opens on `quotaBlocked`).
  const [forkQuotaBlocked, setForkQuotaBlocked] = useState(false);

  // Fetch templates ONLY when the routine list has loaded and is empty — the
  // empty state is the only place the sample + start-from-template UI shows
  // (US-045). Gating this avoids triggering the server-side template seed
  // (`ensureSample`) on every home load, which is wasted work when the user
  // already has routines (and, under E2E, is re-done after each resetDb).
  const hasRoutines = (routinesQ.data?.routines.length ?? 0) > 0;
  useEffect(() => {
    if (routinesQ.isLoading || hasRoutines) return;
    let cancelled = false;
    void (async () => {
      const token = await getToken();
      const list = await listTemplates(token).catch(() => ({ templates: [] }));
      if (!cancelled) setTemplates(list.templates);
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, routinesQ.isLoading, hasRoutines]);

  // Clear a pending debounce on unmount so a route change mid-type doesn't fire
  // a stale search / setState after the component is gone.
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  // Debounced search handler (US-046).
  const onSearch = useCallback(
    (q: string) => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (!q.trim()) {
        setSearchResults([]);
        return;
      }
      searchTimer.current = setTimeout(() => {
        void (async () => {
          const token = await getToken();
          const res = await search(token, q).catch(() => ({ results: [] }));
          setSearchResults(res.results);
        })();
      }, SEARCH_DEBOUNCE_MS);
    },
    [getToken],
  );

  // Fork a template into a new owned routine and navigate there (US-045).
  // On a 402 the user is at their routine cap → drive the SAME upsell path as a
  // create-quota block; any other failure surfaces as a danger toast so the tap
  // is never silently swallowed.
  const onStartFromTemplate = useCallback(
    (docRef: string) => {
      void (async () => {
        try {
          const token = await getToken();
          const res = await forkTemplate(token, docRef);
          navigate(`/routines/${res.docRef}`);
        } catch (err) {
          // isQuotaError keeps the ApiError/status check behind the store seam
          // (§3) — components never import lib/rpc directly (routine-store.test).
          if (isQuotaError(err)) {
            setForkQuotaBlocked(true);
          } else {
            toast.show("Couldn't start from template. Please try again.", { tone: "danger" });
          }
        }
      })();
    },
    [getToken, toast],
  );

  const items = routinesQ.data?.routines ?? [];
  const ownedCount = items.filter((r) => r.role === "owner").length;
  const plan = me.data?.plan ?? "free";
  // The free-plan cap comes from the server (/api/me), never a 2nd hardcoded
  // constant (#176); the POST /api/routines 402 enforces the same value.
  const routineCap = me.data?.routineCap;
  // A create OR template-fork blocked by the server quota (402) — surface the
  // upsell even if the instant gate was bypassed (e.g. another tab consumed the
  // last slot).
  const quotaBlocked = isQuotaError(create.error) || forkQuotaBlocked;

  // US-045: the sample is the first template (app currently publishes one).
  const sample = templates[0];

  if (openRoutineId) {
    return (
      <div className="flex flex-col gap-3">
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
            onBack={() => navigate("/")}
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
      sample={sample}
      templates={templates}
      onStartFromTemplate={onStartFromTemplate}
      onSearch={onSearch}
      searchResults={searchResults}
    />
  );
}
