// WEP-0002 (phase 4) — docs/system/architecture.md § D1 — the index & projections
// — the React hook seam over the account `DocConnection`.
//
// `useAccount()` opens the current user's account doc (`account:<userId>`)
// LAZILY (D10 — no eager socket per session): the connection is created on the
// first render of a surface that calls this hook (the Library screen, family-note
// compose, or the Journal authoring surface), and torn down when the last such
// surface unmounts. It exposes referentially-stable reactive selectors for the
// library bookmark set and the user's own family notes (via `useSyncExternalStore`
// against the store's `subscribe`), plus the store's mutators — so components read
// SELF data from the CRDT doc (instant + offline) and write through the seam.
//
// Components consume this and `store/account.ts` ONLY — never Automerge/RPC
// directly (the architecture boundary, §3).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAppAuth } from "../auth/app-auth";
import { type AccountStore, openAccount } from "./account";
import type { SyncState } from "./doc-connection";
import { useMe } from "./me";

/** A no-op store used while the account doc is not yet open (signed-out, or the
 *  current user's id hasn't resolved). Reads empty; mutations are dropped — the
 *  surfaces that mutate only render for a signed-in user with a resolved id. */
const IDLE_STORE: AccountStore = {
  readLibraryRefs: () => EMPTY_REFS,
  readOwnFamilyNotes: () => EMPTY_NOTES,
  readOwnPredicateNotes: () => EMPTY_PREDICATE_NOTES,
  addBookmark: () => {},
  removeBookmark: () => {},
  createFamilyNote: () => {},
  createPredicateNote: () => {},
  deleteFamilyNote: () => {},
  subscribe: () => () => {},
  syncState: () => "connecting",
  pendingSyncCount: () => 0,
  close: () => {},
};
// Stable empty results so an idle render never churns consumer deps.
const EMPTY_REFS: string[] = [];
const EMPTY_NOTES: ReturnType<AccountStore["readOwnFamilyNotes"]> = [];
const EMPTY_PREDICATE_NOTES: ReturnType<AccountStore["readOwnPredicateNotes"]> = [];

/**
 * Open (lazily) + subscribe to the current user's account store. Returns the
 * store plus its reactive sync state. The connection is opened once the user's
 * id is known and closed on unmount — a surface that never renders never opens a
 * socket (D10).
 */
export function useAccount(): { store: AccountStore; syncState: SyncState; isOpen: boolean } {
  const { getToken, isSignedIn } = useAppAuth();
  const me = useMe();
  const userId = isSignedIn ? me.data?.sub : undefined;

  // Keep the latest `getToken` in a ref so the open-effect doesn't depend on its
  // identity: it's read fresh at each (re)connect-open inside the connection, but
  // a new function identity per render must NOT re-open (and thrash) the socket —
  // the connection is re-opened only on a genuine user change.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // Hold the opened store in state so a render after it resolves picks it up.
  const [store, setStore] = useState<AccountStore>(IDLE_STORE);

  useEffect(() => {
    if (!userId) {
      setStore(IDLE_STORE);
      return;
    }
    let cancelled = false;
    let opened: AccountStore | null = null;
    void openAccount(userId, {
      currentUserId: userId,
      getToken: () => getTokenRef.current(),
    }).then((s) => {
      if (cancelled) {
        s.close();
        return;
      }
      opened = s;
      setStore(s);
    });
    return () => {
      cancelled = true;
      opened?.close();
      setStore(IDLE_STORE);
    };
  }, [userId]);

  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  const serverState = (): SyncState => "connecting";
  const syncState = useSyncExternalStore(subscribe, () => store.syncState(), serverState);

  // `isOpen` = a real account connection exists (not the idle placeholder), so a
  // caller can prefer the seam write and fall back to REST only when it's idle.
  return { store, syncState, isOpen: store !== IDLE_STORE };
}

/** The library bookmark set as a reactive, referentially-stable array (self-read
 *  from the account doc). WHICH refs are bookmarked — a component merges
 *  `/api/figures/mine` for the figure metadata. */
export function useLibraryRefs(store: AccountStore): string[] {
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  return useSyncExternalStore(
    subscribe,
    () => store.readLibraryRefs(),
    () => EMPTY_REFS,
  );
}

/** The current user's OWN family notes as a reactive, referentially-stable list. */
export function useOwnFamilyNotes(
  store: AccountStore,
): ReturnType<AccountStore["readOwnFamilyNotes"]> {
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  return useSyncExternalStore(
    subscribe,
    () => store.readOwnFamilyNotes(),
    () => EMPTY_NOTES,
  );
}

/** The current user's OWN predicate notes as a reactive, referentially-stable list. */
export function useOwnPredicateNotes(
  store: AccountStore,
): ReturnType<AccountStore["readOwnPredicateNotes"]> {
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  return useSyncExternalStore(
    subscribe,
    () => store.readOwnPredicateNotes(),
    () => EMPTY_PREDICATE_NOTES,
  );
}
