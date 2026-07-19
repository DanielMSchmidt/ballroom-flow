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
import type { RoutineListItem, SearchResult } from "@weavesteps/contract";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppAuth } from "../auth/app-auth";
import { useMessages } from "../i18n";
import { choreoMessages } from "../i18n/messages/choreo";
import { navigate } from "../lib/router";
import { useDocAccess } from "../store/access";
import { useMineFigures } from "../store/figures";
import { useMe } from "../store/me";
import { usePendingLocalChanges } from "../store/offline";
import {
  isQuotaError,
  useCreateRoutine,
  useDeleteRoutine,
  useForkRoutine,
  useRoutines,
} from "../store/routines";
import { search } from "../store/search";
import { forkTemplate, listTemplates } from "../store/templates";
import { useAccount, useLibraryRefs } from "../store/use-account";
import { AccessDenied, Button, Spinner, useToast } from "../ui";
import type { MembershipRole } from "./Assemble";
import { ChoreoList } from "./ChoreoList";

// Code-split the routine editor: Assemble is the ONLY screen that pulls the
// Automerge store (routine.ts → doc-connection.ts → @automerge/automerge), whose
// ~2.75 MB WASM + JS glue otherwise sit in the initial chunk even though they're
// needed only once a routine is OPEN. Lazy-loading it here (the sole render site)
// defers that payload off the first paint of the choreo list — the mobile-first
// win — and it loads on routine-open behind the Suspense fallback below. (The
// journal's routine-authoring path is the other Automerge entry point; it
// dynamic-imports routine-view for the same reason — see store/journal.ts.)
const Assemble = lazy(() => import("./Assemble").then((m) => ({ default: m.Assemble })));

/** Resolve the viewer's editing role for an open routine from their list. */
function roleForOpen(
  routines: { docRef: string; role: "owner" | MembershipRole }[],
  routineId: string,
): MembershipRole {
  const found = routines.find((r) => r.docRef === routineId);
  // owner → editor; a non-owner member keeps their role; not-yet-listed (fresh
  // create / deep link) opens optimistically as editor — the DO boundary gates.
  // The `!== "owner"` check narrows `role` to MembershipRole (no assertion).
  if (found && found.role !== "owner") return found.role;
  return "editor";
}

/** Debounce delay (ms) for the header search (US-046). */
const SEARCH_DEBOUNCE_MS = 300;

export function ChoreoFlow({ openRoutineId }: { openRoutineId?: string }): React.JSX.Element {
  const t = useMessages(choreoMessages);
  const routinesQ = useRoutines();
  const me = useMe();
  const create = useCreateRoutine();
  const fork = useForkRoutine();
  const del = useDeleteRoutine();
  const { getToken } = useAppAuth();
  const toast = useToast();
  // Access preflight (#178): for an OPEN routine, learn DENIED vs allowed before
  // opening the heavy WS store, so a non-member sees the calm access-denied state
  // rather than a connectivity-looking offline flash (DP #20).
  const access = useDocAccess(openRoutineId ?? "", { enabled: Boolean(openRoutineId) });
  // Offline editing (§11.2, Q-NEW-2): pending local changes this DEVICE holds
  // for the open routine. A denial must NOT unmount the screen over them — the
  // Assemble store surfaces them as the explicit unsyncable alert instead of
  // this component silently swapping to AccessDenied. Re-probed when the access
  // verdict changes (revocation lands exactly then).
  const pendingLocal = usePendingLocalChanges(openRoutineId ?? "", access.state);

  // The viewer's library bookmarks (⟳v5, §4.2/§5.2): fetched only when a routine
  // is open. `/api/figures/mine` supplies figure METADATA (title/type/dance/usage)
  // for the Add-figure picker; docs/system/architecture.md (account docs, WEP-0002)
  // makes the account doc the source of truth for WHICH refs are bookmarked, so
  // bookmark state is instant + offline.
  const mineQ = useMineFigures({ enabled: Boolean(openRoutineId) });
  // docs/system/architecture.md (account docs, WEP-0002): open the account doc
  // LAZILY (only when a routine is open — the "add to my library" surface lives
  // in Assemble) and read the bookmark set live.
  const account = useAccount();
  const libraryRefs = useLibraryRefs(account.store);
  // The figureRef set Assemble O(1)-tests for "already in my library" — the UNION
  // of the live account-doc refs (instant, incl. a just-added bookmark before the
  // alarm projects) and the /mine list (covers a signed-out/idle account store).
  const bookmarkedFigureRefs = useMemo(() => {
    const refs = new Set(libraryRefs);
    for (const f of mineQ.data ?? []) refs.add(f.docRef);
    return refs;
  }, [libraryRefs, mineQ.data]);
  // Bookmark through the seam (instant + offline; the worker alarm projects it to
  // library_entry for /mine). The account store is open only for a signed-in user
  // with a resolved id — a no-op otherwise (the affordance only renders then).
  // `alreadySaved` is derived from the live doc state (idempotent add) so the
  // toast reads correctly without a server round-trip.
  const onAddToLibrary = useCallback(
    async (figureRef: string): Promise<{ alreadySaved: boolean }> => {
      const alreadySaved = account.store.readLibraryRefs().includes(figureRef);
      account.store.addBookmark(figureRef);
      return { alreadySaved };
    },
    [account.store],
  );

  // US-045: template list (app-owned sample routines).
  const [templates, setTemplates] = useState<RoutineListItem[]>([]);
  // US-046: search results (empty until the user types).
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  // Debounce timer ref — cleared on each keystroke, fired after the delay.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A template-fork blocked by the server quota (402) — feeds the upsell, same
  // path as a create 402 (the ChoreoList upsell Sheet opens on `quotaBlocked`).
  const [forkQuotaBlocked, setForkQuotaBlocked] = useState(false);

  // Read/edit landing (design `assembleEdit`): opening an existing routine lands
  // on the clean reading programme; only a routine the user just *created* (blank
  // or from a template) opens straight in the builder. We remember the id of a
  // just-created routine so the open it triggers lands in "edit"; every other
  // open — list tap, deep link, refresh, fork ("make a copy") — lands in "read".
  // Cleared once consumed so re-opening that same routine later still reads first.
  const justCreatedRef = useRef<string | null>(null);
  const initialMode = justCreatedRef.current === openRoutineId ? "edit" : "read";
  useEffect(() => {
    // Clear the create-intent only on returning to the list — NOT on every open.
    // The open Assemble mounts lazily (after the access preflight resolves), so
    // clearing on the first post-navigate render would wipe the intent before
    // mount and the new routine would read first. Clearing on the way back to the
    // list means re-opening that same routine from the list still reads first.
    if (!openRoutineId) justCreatedRef.current = null;
  }, [openRoutineId]);

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
          // A template start is a routine you own to build on → land in edit.
          justCreatedRef.current = res.docRef;
          navigate(`/routines/${res.docRef}`);
        } catch (err) {
          // isQuotaError keeps the ApiError/status check behind the store seam
          // (§3) — components never import lib/rpc directly (routine-store.test).
          if (isQuotaError(err)) {
            setForkQuotaBlocked(true);
          } else {
            toast.show(t.toastTemplateFailed, { tone: "danger" });
          }
        }
      })();
    },
    [getToken, toast, t],
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
        {access.state === "denied" && pendingLocal === 0 ? (
          <AccessDenied
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate("/")}>
                {t.backToChoreos}
              </Button>
            }
          />
        ) : access.state === "checking" || routinesQ.isLoading ? (
          // Resolve access + the viewer's role BEFORE opening, so a shared routine
          // never flashes editor affordances (or an offline state) during the load.
          <div className="flex items-center gap-2 p-6 text-ink-faint" role="status">
            <Spinner /> <span className="text-2xs">{t.loading}</span>
          </div>
        ) : (
          // Suspense fallback covers the one-time async load of the lazy Assemble
          // chunk (+ the Automerge WASM it pulls) on routine-open — a brief spinner,
          // matching the access-checking state above, never a blank frame.
          <Suspense
            fallback={
              <div className="flex items-center gap-2 p-6 text-ink-faint" role="status">
                <Spinner /> <span className="text-2xs">{t.loading}</span>
              </div>
            }
          >
            <Assemble
              // Key per routine so each open is a fresh mount — the read/edit
              // landing (initialMode) is applied on mount, and switching routines
              // (e.g. fork → new copy) doesn't carry the previous lens over.
              key={openRoutineId}
              routineId={openRoutineId}
              role={roleForOpen(items, openRoutineId)}
              initialMode={initialMode}
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
              bookmarkedFigureRefs={bookmarkedFigureRefs}
              onAddToLibrary={onAddToLibrary}
              // The full library list feeds the Add-figure picker (⟳v5 §4.2: a
              // bookmark "can be placed into your other routines").
              libraryFigures={mineQ.data ?? []}
            />
          </Suspense>
        )}
      </div>
    );
  }

  return (
    <ChoreoList
      routines={items}
      loading={routinesQ.isLoading}
      ownedCount={ownedCount}
      plan={plan}
      cap={routineCap}
      quotaBlocked={quotaBlocked}
      creating={create.isPending}
      deleting={del.isPending}
      onCreate={(input) =>
        // A freshly-created routine isn't in the list yet — the creator owns it,
        // so deep-link to it; the list refetches in the background. A brand-new
        // routine lands straight in the builder (edit), not the reading view.
        create.mutate(input, {
          onSuccess: (res) => {
            justCreatedRef.current = res.docRef;
            navigate(`/routines/${res.docRef}`);
          },
          // Never silent (§11.2): the offline gate disables the affordance, but
          // a race (connectivity drops mid-flight) must still surface. A 402
          // already drives the quota upsell via `quotaBlocked`.
          onError: (err) => {
            if (!isQuotaError(err)) toast.show(t.toastCreateFailed, { tone: "danger" });
          },
        })
      }
      onOpen={(docRef) => navigate(`/routines/${docRef}`)}
      onFork={(docRef) =>
        // Fork from the list's ⋯ sheet → a NEW owned, frozen copy; deep-link to it
        // and confirm with a toast. A 402 means the routine cap is hit → drive the
        // SAME upsell path as a create/template-fork quota block.
        fork.mutate(docRef, {
          onSuccess: (res) => {
            toast.show(t.toastForked);
            navigate(`/routines/${res.docRef}`);
          },
          onError: (err) => {
            if (isQuotaError(err)) setForkQuotaBlocked(true);
            else toast.show(t.toastForkFailed, { tone: "danger" });
          },
        })
      }
      onDelete={(docRef) =>
        // Soft-delete from the ⋯ sheet → the list refetches and the card drops out.
        // Confirm a success, and never silently swallow a failure (e.g. a non-owner
        // race or a network blip) — surface it as a danger toast.
        del.mutate(docRef, {
          onSuccess: () => toast.show(t.toastDeleted),
          onError: () => toast.show(t.toastDeleteFailed, { tone: "danger" }),
        })
      }
      sample={sample}
      templates={templates}
      onStartFromTemplate={onStartFromTemplate}
      onSearch={onSearch}
      searchResults={searchResults}
    />
  );
}
