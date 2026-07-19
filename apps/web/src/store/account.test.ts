// WEP-0002 (phase 4) — docs/system/architecture.md § D1 — the index & projections
// — the account `DocConnection` seam.
//
// The per-user account doc (`account:<userId>`) hosts the library BOOKMARK set
// (`libraryFigureRefs`) and the user's OWN figureType family notes. This store
// opens it through the SAME `DocConnection` machinery as a routine doc, so SELF
// reads come from the CRDT doc (instant + offline) and edits ride the §11.2
// offline machinery. Components touch ONLY this store (never Automerge/RPC).
//
// Like routine-store.test.ts these drive a FAKE socket (jsdom has no WS server)
// and feed it the frames a DO would replay, exercising the seam's load, reactive
// reads, mutations, and the "local" offline edit-gate for real.
import * as A from "@automerge/automerge";
import { SYNC_CAUGHT_UP, SYNC_FRAME_SNAPSHOT } from "@weavesteps/contract";
import type { AccountDoc } from "@weavesteps/domain";
import { buildAccountDoc } from "@weavesteps/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { type OpenAccountOptions, openAccount } from "./account";
import type { SocketLike } from "./doc-connection";
import type { DocStorage, PersistedDoc } from "./doc-storage";

/** A fake socket the test pushes DO frames into (same shape as the routine test). */
class FakeSocket implements SocketLike {
  binaryType = "blob";
  // Every listener is stored under the widest registered shape ((ev) => void);
  // open/close listeners take no parameter, so firing them with a dummy event is
  // invisible to them — this keeps addEventListener's overloads honest with no cast.
  private msg: ((ev: { data: unknown }) => void) | null = null;
  private open: ((ev: { data: unknown }) => void) | null = null;
  private closed: ((ev: { data: unknown }) => void) | null = null;
  sent: Uint8Array[] = [];
  addEventListener(type: string, fn: ((ev: { data: unknown }) => void) | (() => void)): void {
    if (type === "message") this.msg = fn;
    else if (type === "open") this.open = fn;
    else if (type === "close") this.closed = fn;
  }
  send(data: string | Uint8Array): void {
    if (typeof data === "string") return; // heartbeat ping — ignored here
    this.sent.push(data);
  }
  close(): void {
    this.closed?.({ data: undefined });
  }
  fireOpen(): void {
    this.open?.({ data: undefined });
  }
  fireCaughtUp(): void {
    this.msg?.({ data: SYNC_CAUGHT_UP });
  }
  /** Deliver the DO's on-connect catch-up: ONE tagged SNAPSHOT frame (D10). */
  load(doc: A.Doc<unknown>): void {
    const saved = A.save(doc);
    const frame = new Uint8Array(saved.byteLength + 1);
    frame[0] = SYNC_FRAME_SNAPSHOT;
    frame.set(saved, 1);
    this.msg?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) });
  }
}

/** OpenAccountOptions whose socket factory hands back a FakeSocket per docId. */
function fakeWiring(): { opts: OpenAccountOptions; socket: () => FakeSocket } {
  let s: FakeSocket | null = null;
  const opts: OpenAccountOptions = {
    baseUrl: "http://test",
    // No heartbeat/reconnect noise; a single fake socket is enough for the seam.
    reconnect: { delays: [] },
    heartbeat: false,
    openSocket: () => {
      s = new FakeSocket();
      return s;
    },
  };
  return {
    opts,
    socket: () => {
      if (!s) throw new Error("socket not opened yet");
      return s;
    },
  };
}

const emptyAccount = (userId: string): A.Doc<AccountDoc> =>
  buildAccountDoc({
    id: `account:${userId}`,
    ownerId: userId,
    annotations: [],
    libraryFigureRefs: [],
    schemaVersion: 1,
    deletedAt: null,
  });

/** An in-memory DocStorage for the offline tests (jsdom has no IndexedDB). */
function memStorage(): DocStorage & { map: Map<string, PersistedDoc> } {
  const map = new Map<string, PersistedDoc>();
  return {
    map,
    async load(key) {
      return map.get(key) ?? null;
    },
    async save(key, value) {
      map.set(key, value);
    },
  };
}

const goOffline = (): void => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
};
const goOnline = (): void => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
};

beforeEach(() => {
  goOnline();
});

describe("openAccount — self reads from the account doc (WEP-0002)", () => {
  it("opens account:<userId> and hydrates library refs + own family notes from the DO catch-up", async () => {
    const { opts, socket } = fakeWiring();
    const store = await openAccount("user-1", opts);
    socket().fireOpen();

    // The DO replays the whole account doc: two bookmarks + one family note.
    const seed = buildAccountDoc({
      id: "account:user-1",
      ownerId: "user-1",
      annotations: [
        {
          id: "note-1",
          authorId: "user-1",
          kind: "lesson",
          text: "keep the head left",
          tags: [],
          anchors: [{ type: "figureType", figureType: "feather", danceScope: "all" }],
          replies: [],
          createdAt: 1,
          deletedAt: null,
        },
      ],
      libraryFigureRefs: ["global:waltz:natural_turn", "fig-abc"],
      schemaVersion: 1,
      deletedAt: null,
    });
    socket().load(seed);
    socket().fireCaughtUp();

    expect(store.syncState()).toBe("live");
    expect(store.readLibraryRefs()).toEqual(["global:waltz:natural_turn", "fig-abc"]);
    const notes = store.readOwnFamilyNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe("keep the head left");
    expect(notes[0]?.figureType).toBe("feather");
    store.close();
  });

  it("readLibraryRefs is referentially stable across reads when nothing changed (no refetch churn)", async () => {
    const { opts, socket } = fakeWiring();
    const store = await openAccount("user-1", opts);
    socket().fireOpen();
    socket().load(emptyAccount("user-1"));
    socket().fireCaughtUp();

    const a = store.readLibraryRefs();
    const b = store.readLibraryRefs();
    expect(a).toBe(b); // same reference — a re-render doesn't churn deps
    store.close();
  });
});

describe("openAccount — bookmark writes through the seam (WEP-0002)", () => {
  it("addBookmark is INSTANT (visible before any server round-trip) and idempotent", async () => {
    const { opts, socket } = fakeWiring();
    const store = await openAccount("user-1", opts);
    socket().fireOpen();
    socket().load(emptyAccount("user-1"));
    socket().fireCaughtUp();

    store.addBookmark("fig-1");
    // Instant local read — no /api/figures/mine dependency.
    expect(store.readLibraryRefs()).toContain("fig-1");

    store.addBookmark("fig-1"); // idempotent
    expect(store.readLibraryRefs().filter((r) => r === "fig-1")).toHaveLength(1);

    store.removeBookmark("fig-1");
    expect(store.readLibraryRefs()).not.toContain("fig-1");
    store.close();
  });
});

describe("openAccount — family-note authoring works OFFLINE in the local edit-gate (WEP-0002)", () => {
  it("authors + soft-deletes a family note while the connection is 'local' (hydrated, offline)", async () => {
    const storage = memStorage();
    // Pre-seed local persistence so the connection hydrates to "local" with no
    // server — exactly the offline compose scenario.
    const seed = buildAccountDoc({
      id: "account:user-1",
      ownerId: "user-1",
      annotations: [],
      libraryFigureRefs: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    storage.map.set("account:user-1", { bytes: A.save(seed), pendingCount: 0 });

    goOffline();
    const { opts, socket } = fakeWiring();
    const store = await openAccount("user-1", { ...opts, storage });
    // Give the async hydrate-from-storage a tick to resolve before we read/edit.
    await Promise.resolve();
    await Promise.resolve();

    expect(store.syncState()).toBe("local"); // hydrated locally, offline
    // The socket never opened; edits still apply and persist (they leave the
    // live-gated list — bookmarks + family notes work offline once hydrated).
    void socket; // socket is created but never fireOpen'd — offline

    store.createFamilyNote({
      figureType: "feather",
      danceScope: "all",
      kind: "lesson",
      text: "offline note",
    });
    const notes = store.readOwnFamilyNotes();
    expect(notes).toHaveLength(1);
    const created = notes[0];
    expect(created?.text).toBe("offline note");
    expect(store.pendingSyncCount?.()).toBeGreaterThan(0); // waiting to sync

    if (created) store.deleteFamilyNote(created.id);
    expect(store.readOwnFamilyNotes()).toHaveLength(0);
    store.close();
    goOnline();
  });
});
