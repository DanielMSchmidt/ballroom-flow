// Offline editing (PLAN §11.2) — the local persistence seam behind DocConnection.
//
// A `DocStorage` remembers one Automerge doc per docRef so an offline edit
// survives a reload: `bytes` is the `A.save` blob (it embeds the local changes),
// `pendingCount` is how many of this client's changes the server hasn't been
// handed yet (drives the truth-telling "N changes waiting to sync" UI — the
// actual replay never depends on it; reconnect re-diffs against the server's
// snapshot, #161). Persistence is strictly BEST-EFFORT: every failure path
// degrades to online-only behavior, never to a broken screen.
//
// Production uses the IndexedDB adapter below (raw IndexedDB — no new
// dependency, per the repo's dependency rule); unit tests inject an in-memory
// fake (jsdom has no IndexedDB — the adapter itself is exercised by the
// offline-editing E2E journey in a real browser).

/** One persisted doc: the `A.save` blob + the not-yet-delivered change count. */
export interface PersistedDoc {
  bytes: Uint8Array;
  pendingCount: number;
}

/** Async key-value persistence for docs, keyed by docRef. Best-effort. */
export interface DocStorage {
  load(key: string): Promise<PersistedDoc | null>;
  save(key: string, value: PersistedDoc): Promise<void>;
}

const DB_NAME = "weavesteps-docs";
const STORE = "docs";

/** Open (once) the IndexedDB database backing the doc store. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

/**
 * The production DocStorage: raw IndexedDB, one object store, structured-clone
 * values. Returns `null` where IndexedDB is unavailable (jsdom, very old
 * browsers, some private-browsing modes) — the connection then simply runs
 * online-only, exactly as before this seam existed.
 */
export function openIndexedDbDocStorage(): DocStorage | null {
  if (typeof indexedDB === "undefined") return null;
  // One DB handle per adapter, opened lazily on first use and reused.
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    dbPromise ??= openDb();
    return dbPromise;
  };
  return {
    async load(key: string): Promise<PersistedDoc | null> {
      try {
        const d = await db();
        return await new Promise((resolve) => {
          const req = d.transaction(STORE, "readonly").objectStore(STORE).get(key);
          req.onsuccess = () => {
            const v = req.result as PersistedDoc | undefined;
            // Validate the shape defensively — a corrupt/foreign row reads as absent.
            resolve(v && v.bytes instanceof Uint8Array ? v : null);
          };
          req.onerror = () => resolve(null);
        });
      } catch {
        return null; // best-effort: unreadable storage = no local copy
      }
    },
    async save(key: string, value: PersistedDoc): Promise<void> {
      try {
        const d = await db();
        await new Promise<void>((resolve) => {
          const tx = d.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve(); // best-effort: a failed write is dropped
          tx.onabort = () => resolve();
        });
      } catch {
        // best-effort: persistence must never break the editing path
      }
    },
  };
}

// The app-wide singleton (all DocConnections share one DB). Memoized so every
// openRoutine call reuses the same handle instead of re-opening per store.
let defaultStorage: DocStorage | null | undefined;

/** The default production storage, or null where IndexedDB is unavailable. */
export function defaultDocStorage(): DocStorage | null {
  if (defaultStorage === undefined) defaultStorage = openIndexedDbDocStorage();
  return defaultStorage;
}
