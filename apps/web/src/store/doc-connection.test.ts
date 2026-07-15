import * as A from "@automerge/automerge";
import { SYNC_CAUGHT_UP, SYNC_FRAME_SNAPSHOT, SYNC_PING, SYNC_PONG } from "@weavesteps/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocConnection, type SocketLike } from "./doc-connection";

// ─────────────────────────────────────────────────────────────────────────
// DocConnection auto-reconnect (the "had to reload to see my figure" fix).
// A dropped socket re-opens after a backoff so a figure/routine self-heals on
// a sleep/wake, network blip, or DO eviction. A handshake that never opens
// (missing doc / revoked access / server down) retries a bounded number of
// times, then goes terminally "closed" so the store can confirm missing-vs-error
// via the access preflight.
// ─────────────────────────────────────────────────────────────────────────

/** A fake socket the test drives: open/close/message all fire on demand. */
class FakeSocket implements SocketLike {
  binaryType = "blob";
  // Every listener is stored under the widest registered shape ((ev) => void);
  // open/close listeners take no parameter, so firing them with a dummy event
  // is invisible to them — this keeps addEventListener's overloads honest.
  private msg: ((ev: { data: unknown }) => void) | null = null;
  private opened: ((ev: { data: unknown }) => void) | null = null;
  private closed: ((ev: { data: unknown }) => void) | null = null;
  sent: Uint8Array[] = [];
  /** TEXT frames sent by the client (docs/system/sync-and-offline.md § Heartbeat pings). */
  sentText: string[] = [];
  addEventListener(type: string, fn: ((ev: { data: unknown }) => void) | (() => void)): void {
    if (type === "message") this.msg = fn;
    else if (type === "open") this.opened = fn;
    else if (type === "close") this.closed = fn;
  }
  send(data: string | ArrayBufferView | ArrayBuffer): void {
    if (typeof data === "string") {
      this.sentText.push(data);
      return;
    }
    this.sent.push(
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  close(): void {
    this.closed?.({ data: undefined });
  }
  fireOpen(): void {
    this.opened?.({ data: undefined });
  }
  fireClose(): void {
    this.closed?.({ data: undefined });
  }
  fireCaughtUp(): void {
    this.msg?.({ data: SYNC_CAUGHT_UP });
  }
  /** Deliver the DO's heartbeat pong (docs/system/sync-and-offline.md § Heartbeat). */
  firePong(): void {
    this.msg?.({ data: SYNC_PONG });
  }
  /** Deliver the DO's on-connect catch-up: ONE tagged SNAPSHOT frame (D10). */
  fireSnapshot(doc: A.Doc<unknown>): void {
    const saved = A.save(doc);
    const frame = new Uint8Array(saved.byteLength + 1);
    frame[0] = SYNC_FRAME_SNAPSHOT;
    frame.set(saved, 1);
    this.msg?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) });
  }
}

/** Index into the recorded sockets, asserting the one we expect exists. */
function sock(sockets: FakeSocket[], i: number): FakeSocket {
  const s = sockets[i];
  if (!s) throw new Error(`socket #${i} was not created`);
  return s;
}

/** A factory that records every socket it hands out (latest = last). */
function recordingFactory(): { factory: (url: string) => SocketLike; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    factory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DocConnection reconnect", () => {
  it("reconnects after a WARM drop and re-hydrates (no reload needed)", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
    });

    // First connection opens + hydrates → live.
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireCaughtUp();
    expect(conn.state()).toBe("live");

    // The socket drops (sleep/wake/blip). It was open before → transient: the
    // connection goes back to "connecting" and a reconnect is scheduled.
    sock(sockets, 0).fireClose();
    expect(conn.state()).toBe("connecting");
    expect(sockets).toHaveLength(1);

    // After the backoff, a fresh socket opens and re-hydrates → live again.
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sock(sockets, 1).fireOpen();
    sock(sockets, 1).fireCaughtUp();
    expect(conn.state()).toBe("live");
    conn.close();
  });

  it("gives up terminally after maxColdAttempts COLD failures (handshake never opens)", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 3 },
    });

    // Each socket closes WITHOUT ever opening (a rejected handshake). It retries
    // up to the cold cap, then goes terminally "closed".
    sock(sockets, 0).fireClose(); // cold failure #1 → reconnect scheduled
    expect(conn.state()).toBe("connecting");
    vi.advanceTimersByTime(1000);
    sock(sockets, 1).fireClose(); // cold failure #2 → reconnect scheduled
    expect(conn.state()).toBe("connecting");
    vi.advanceTimersByTime(1000);
    sock(sockets, 2).fireClose(); // cold failure #3 → hits the cap → terminal
    expect(conn.state()).toBe("closed");

    // No further reconnect is scheduled once it has given up.
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(3);
    conn.close();
  });

  it("reconnectNow() recovers from a terminal give-up", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 1 },
    });
    sock(sockets, 0).fireClose(); // one cold failure → cap of 1 → terminal
    expect(conn.state()).toBe("closed");

    conn.reconnectNow();
    expect(sockets).toHaveLength(2); // a fresh socket opened immediately
    sock(sockets, 1).fireOpen();
    sock(sockets, 1).fireCaughtUp();
    expect(conn.state()).toBe("live");
    conn.close();
  });

  it("does not reconnect after the owner calls close()", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [1000] },
    });
    sock(sockets, 0).fireOpen();
    conn.close();
    expect(conn.state()).toBe("closed");
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1); // disposed → never reconnects
  });

  it("delays:[] disables reconnect (a close is immediately terminal)", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [] },
    });
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireClose();
    expect(conn.state()).toBe("closed");
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
    conn.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// docs/system/sync-and-offline.md § Heartbeat — zombie-socket detection. A half-open socket (TCP thinks
// it's up, nothing is delivered, navigator.onLine stays true — the practice-
// room dead spot) is detected by an idle PING that must be answered within a
// deadline; a miss drops the socket into the normal warm-reconnect machinery
// instead of waiting minutes for the browser's own close event.
// ─────────────────────────────────────────────────────────────────────────
describe("DocConnection heartbeat (WEP-0006 zombie-socket detection)", () => {
  const HB = { intervalMs: 1000, deadlineMs: 500 };
  const pings = (s: FakeSocket): number => s.sentText.filter((t) => t === SYNC_PING).length;

  it("pings after an idle interval and keeps the socket when the pong arrives", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [1000] },
      heartbeat: HB,
    });
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireCaughtUp();
    expect(pings(sock(sockets, 0))).toBe(0); // no ping before the idle interval

    vi.advanceTimersByTime(1000);
    expect(pings(sock(sockets, 0))).toBe(1);
    sock(sockets, 0).firePong(); // answered within the deadline

    vi.advanceTimersByTime(600); // past where the deadline would have fired
    expect(conn.state()).toBe("live");
    expect(sockets).toHaveLength(1); // the healthy socket was kept
    conn.close();
  });

  it("any inbound frame counts as liveness — a busy connection is never pinged", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [1000] },
      heartbeat: HB,
    });
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireCaughtUp();

    // 600ms in, ANY inbound frame arrives → the idle clock restarts.
    vi.advanceTimersByTime(600);
    sock(sockets, 0).firePong(); // unsolicited inbound traffic = proof of life
    vi.advanceTimersByTime(600); // 1200ms since open, only 600ms since traffic
    expect(pings(sock(sockets, 0))).toBe(0);

    vi.advanceTimersByTime(400); // now a full idle interval since the last frame
    expect(pings(sock(sockets, 0))).toBe(1);
    conn.close();
  });

  it("drops a zombie on a missed pong deadline and warm-reconnects to live", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
      heartbeat: HB,
    });
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireCaughtUp();
    expect(conn.state()).toBe("live");

    // The socket goes zombie: the ping is sent but NOTHING ever answers.
    vi.advanceTimersByTime(1000);
    expect(pings(sock(sockets, 0))).toBe(1);
    vi.advanceTimersByTime(500); // deadline missed → the zombie is dropped
    expect(conn.state()).toBe("connecting"); // honest: not live anymore

    // The warm-reconnect machinery takes over: fresh socket after the backoff,
    // and a re-hydration brings it back to live.
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sock(sockets, 1).fireOpen();
    sock(sockets, 1).fireCaughtUp();
    expect(conn.state()).toBe("live");
    conn.close();
  });

  it("with §11.2 persistence a zombie drop lands in editable 'local', and the gap edit replays on reconnect", async () => {
    interface List {
      items: string[];
      [k: string]: unknown;
    }
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    const map = new Map<string, import("./doc-storage").PersistedDoc>();
    const storage: import("./doc-storage").DocStorage = {
      load: (key) => Promise.resolve(map.get(key) ?? null),
      save: (key, value) => {
        map.set(key, value);
        return Promise.resolve();
      },
    };
    const { factory, sockets } = recordingFactory();
    // ONE server doc for both snapshots (a fresh A.from with the same actor id
    // would be a different doc with colliding seqs — not how a real DO behaves).
    const server = A.from<List>({ items: ["base"] }, "bbbb0000bbbb0000");
    const conn = new DocConnection<List>(A.init<List>("cccc0000cccc0000"), "ws://x/d", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
      heartbeat: HB,
      storage,
      storageKey: "doc-hb",
    });
    await flush();
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireSnapshot(server);
    sock(sockets, 0).fireCaughtUp();
    expect(conn.state()).toBe("live");

    // Zombie: ping unanswered → dropped; hydrated + persisted → editable "local".
    vi.advanceTimersByTime(1500);
    expect(conn.state()).toBe("local");
    conn.change((d) => {
      d.items.push("edited-in-the-gap");
    });
    expect(conn.pendingSyncCount()).toBe(1);

    // Reconnect: the edit made against the zombie window is resent (#161 diff).
    vi.advanceTimersByTime(1000);
    sock(sockets, 1).fireOpen();
    sock(sockets, 1).fireSnapshot(server);
    expect(sock(sockets, 1).sent.length).toBeGreaterThanOrEqual(1);
    sock(sockets, 1).fireCaughtUp();
    expect(conn.state()).toBe("live");
    expect(conn.pendingSyncCount()).toBe(0);
    conn.close();
  });

  it("heartbeat: false disables the probe entirely", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [1000] },
      heartbeat: false,
    });
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireCaughtUp();
    vi.advanceTimersByTime(120_000);
    expect(sock(sockets, 0).sentText).toHaveLength(0);
    expect(conn.state()).toBe("live");
    expect(sockets).toHaveLength(1);
    conn.close();
  });

  it("close() cancels the heartbeat timers", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [1000] },
      heartbeat: HB,
    });
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireCaughtUp();
    conn.close();
    vi.advanceTimersByTime(10_000);
    expect(sock(sockets, 0).sentText).toHaveLength(0); // no ping after dispose
    expect(sockets).toHaveLength(1); // and no zombie-drop reconnect either
  });
});

// ─────────────────────────────────────────────────────────────────────────
// D10 sync hardening (2026-07-02): the catch-up is ONE snapshot frame the client
// MERGES (not replaces), and the client RESENDS its unacked local changes on
// reconnect (#161 — a change sent into a dying socket must not be silently lost).
// ─────────────────────────────────────────────────────────────────────────
describe("DocConnection snapshot catch-up + reconnect resend", () => {
  interface List {
    items: string[];
    // `A.from<T>` requires T extends Record<string, unknown>.
    [k: string]: unknown;
  }
  const CLIENT_ACTOR = "cccc0000cccc0000";
  const SERVER_ACTOR = "bbbb0000bbbb0000";

  it("MERGES the catch-up snapshot into the local doc (an unsynced local edit survives)", () => {
    const { factory, sockets } = recordingFactory();
    // Both sides descend from a common seed (the DO's initial doc), then diverge —
    // the client made a local edit the server hasn't seen, and vice versa.
    const seed = A.from<List>({ items: [] }, "aaaa0000aaaa0000");
    const local = A.change(A.clone(seed, { actor: CLIENT_ACTOR }), (d) => {
      d.items.push("local");
    });
    const conn = new DocConnection<List>(local, "ws://x/docs/d/connect", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
    });
    sock(sockets, 0).fireOpen();
    // The server's snapshot carries a DIFFERENT edit the client hasn't seen.
    const server = A.change(A.clone(seed, { actor: SERVER_ACTOR }), (d) => {
      d.items.push("server");
    });
    sock(sockets, 0).fireSnapshot(server);
    sock(sockets, 0).fireCaughtUp();
    expect(conn.state()).toBe("live");
    // Both edits survive — a merge, not a replace (a replay-replace would drop "local").
    const merged = conn.materialized();
    expect(merged.items).toContain("local");
    expect(merged.items).toContain("server");
    conn.close();
  });

  it("resends an unacked local change after a WARM drop (a change lost into a dying socket, #161)", () => {
    const { factory, sockets } = recordingFactory();
    // The server's persisted state (kept in its OWN handle — the connection never
    // mutates it): a doc with one "base" change. The client starts already synced
    // with it (its initial doc is an independent clone), so the first catch-up has
    // nothing to resend.
    const serverView = A.change(A.from<List>({ items: [] }, SERVER_ACTOR), (d) => {
      d.items.push("base");
    });
    const conn = new DocConnection<List>(
      A.clone(serverView, { actor: CLIENT_ACTOR }),
      "ws://x/docs/d/connect",
      factory,
      { reconnect: { delays: [1000], maxColdAttempts: 4 } },
    );
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireSnapshot(serverView); // server already has "base"
    sock(sockets, 0).fireCaughtUp();
    expect(sock(sockets, 0).sent).toHaveLength(0); // nothing to resend on first catch-up

    // A local edit is made and sent into socket 0 — which then dies BEFORE the
    // change reached the wire (the silent-loss #161 guards). The server never got it.
    conn.change((d) => {
      d.items.push("unacked");
    });
    expect(sock(sockets, 0).sent).toHaveLength(1); // sent into the (doomed) socket
    sock(sockets, 0).fireClose(); // warm drop → auto-reconnect
    expect(conn.state()).toBe("connecting");

    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sock(sockets, 1).fireOpen();
    // The server's snapshot STILL lacks "unacked" (it never arrived) — the client
    // must diff and RESEND it on the fresh socket.
    sock(sockets, 1).fireSnapshot(serverView);
    expect(sock(sockets, 1).sent).toHaveLength(1);
    sock(sockets, 1).fireCaughtUp();
    expect(conn.state()).toBe("live");
    conn.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Offline editing (docs/system/sync-and-offline.md § Offline editing): local persistence behind the connection seam.
// With a DocStorage configured, the connection hydrates from persisted bytes
// BEFORE the network (state "local" — editable, visibly unsynced), persists
// every advance, survives a "reload" (a fresh connection over the same
// storage), and REPLAYS the offline changes through the existing #161 resend
// on reconnect. While the browser is offline, failed handshakes do NOT count
// toward the terminal give-up (they carry no revoked/missing signal).
// ─────────────────────────────────────────────────────────────────────────
describe("DocConnection offline persistence (PLAN §11.2)", () => {
  interface List {
    items: string[];
    [k: string]: unknown;
  }
  const CLIENT_ACTOR = "cccc0000cccc0000";
  const SERVER_ACTOR = "bbbb0000bbbb0000";

  /** Flush pending microtasks (storage promises resolve independent of fake timers). */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  /** An in-memory DocStorage fake (jsdom has no IndexedDB; the real adapter is
   *  exercised by the offline-editing E2E journey in a real browser). */
  const memoryStorage = (): {
    storage: import("./doc-storage").DocStorage;
    map: Map<string, import("./doc-storage").PersistedDoc>;
  } => {
    const map = new Map<string, import("./doc-storage").PersistedDoc>();
    return {
      map,
      storage: {
        load: (key) => Promise.resolve(map.get(key) ?? null),
        save: (key, value) => {
          map.set(key, value);
          return Promise.resolve();
        },
      },
    };
  };

  it("hydrates from persisted bytes BEFORE the network and goes 'local' (editable offline)", async () => {
    const { factory, sockets } = recordingFactory();
    const { storage, map } = memoryStorage();
    // A previous session persisted a doc with one item and no pending changes.
    const persisted = A.change(A.from<List>({ items: [] }, SERVER_ACTOR), (d) => {
      d.items.push("persisted");
    });
    map.set("doc-1", { bytes: A.save(persisted), pendingCount: 0 });

    const conn = new DocConnection<List>(A.init<List>(CLIENT_ACTOR), "ws://x/d", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
      storage,
      storageKey: "doc-1",
    });
    await flush();
    // Hydrated locally, network never opened → editable "local", content readable.
    expect(conn.state()).toBe("local");
    expect(conn.materialized().items).toContain("persisted");

    // An offline edit applies to the local doc and is counted as pending.
    conn.change((d) => {
      d.items.push("offline-edit");
    });
    expect(conn.materialized().items).toContain("offline-edit");
    expect(conn.pendingSyncCount()).toBe(1);
    conn.close();
    expect(sockets.length).toBeGreaterThanOrEqual(1); // it did try the network
  });

  it("persists offline edits; a fresh connection (reload) rehydrates them and RESENDS on reconnect", async () => {
    const { storage } = memoryStorage();
    const server = A.from<List>({ items: [] }, SERVER_ACTOR);
    // Session 1: hydrates from the server (the UI only enables editing on a
    // hydrated doc), then the connection DROPS and an offline edit is made.
    const s1 = recordingFactory();
    const conn1 = new DocConnection<List>(A.init<List>(CLIENT_ACTOR), "ws://x/d", s1.factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
      storage,
      storageKey: "doc-2",
    });
    await flush();
    sock(s1.sockets, 0).fireOpen();
    sock(s1.sockets, 0).fireSnapshot(server);
    sock(s1.sockets, 0).fireCaughtUp();
    sock(s1.sockets, 0).fireClose(); // offline: warm drop → editable "local"
    expect(conn1.state()).toBe("local");
    conn1.change((d) => {
      d.items = ["offline-edit"];
    });
    await flush(); // not-live persists are immediate (no debounce to miss on reload)
    conn1.close();

    // Session 2 (the "reload"): rehydrates the edit from storage → "local".
    const s2 = recordingFactory();
    const conn2 = new DocConnection<List>(A.init<List>(CLIENT_ACTOR), "ws://x/d", s2.factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
      storage,
      storageKey: "doc-2",
    });
    await flush();
    expect(conn2.state()).toBe("local");
    expect(conn2.materialized().items).toContain("offline-edit");
    expect(conn2.pendingSyncCount()).toBe(1);

    // Reconnect: the server's snapshot STILL lacks the offline edit → it is
    // resent (the #161 diff generalized across the reload), then caught-up →
    // live, pending resolves to zero.
    sock(s2.sockets, 0).fireOpen();
    sock(s2.sockets, 0).fireSnapshot(server);
    expect(sock(s2.sockets, 0).sent.length).toBeGreaterThanOrEqual(1);
    sock(s2.sockets, 0).fireCaughtUp();
    expect(conn2.state()).toBe("live");
    expect(conn2.pendingSyncCount()).toBe(0);
    conn2.close();
  });

  it("a WARM drop with persistence stays 'local' (editable), not 'connecting'", async () => {
    const { factory, sockets } = recordingFactory();
    const { storage } = memoryStorage();
    const conn = new DocConnection<List>(A.init<List>(CLIENT_ACTOR), "ws://x/d", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
      storage,
      storageKey: "doc-3",
    });
    await flush();
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireSnapshot(A.from<List>({ items: ["base"] }, SERVER_ACTOR));
    sock(sockets, 0).fireCaughtUp();
    expect(conn.state()).toBe("live");

    // The socket drops (offline). Hydrated + persisted → the doc STAYS editable.
    sock(sockets, 0).fireClose();
    expect(conn.state()).toBe("local");
    conn.change((d) => {
      d.items.push("edited-during-drop");
    });
    expect(conn.pendingSyncCount()).toBe(1);
    conn.close();
  });

  it("cold failures while the browser is OFFLINE never reach the terminal give-up", async () => {
    const { factory, sockets } = recordingFactory();
    const { storage, map } = memoryStorage();
    const persisted = A.change(A.from<List>({ items: [] }, SERVER_ACTOR), (d) => {
      d.items.push("persisted");
    });
    map.set("doc-4", { bytes: A.save(persisted), pendingCount: 1 });
    let online = false;
    const conn = new DocConnection<List>(A.init<List>(CLIENT_ACTOR), "ws://x/d", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 2 },
      storage,
      storageKey: "doc-4",
      isOnline: () => online,
    });
    await flush();
    expect(conn.state()).toBe("local");
    expect(conn.pendingSyncCount()).toBe(1); // restored across the reload

    // WAY more cold closes than the cap — offline, so none of them count.
    for (let i = 0; i < 5; i++) {
      sock(sockets, i).fireClose();
      expect(conn.state()).toBe("local");
      vi.advanceTimersByTime(1000);
    }
    expect(sockets.length).toBeGreaterThan(2); // still retrying, never gave up

    // Back online, the rejections are REAL (revoked/missing): they count, and the
    // connection goes terminally closed — with the pending count still visible so
    // the store can surface the unsyncable edits (never silent loss, Q-NEW-2).
    online = true;
    sock(sockets, 5).fireClose();
    vi.advanceTimersByTime(1000);
    sock(sockets, 6).fireClose();
    expect(conn.state()).toBe("closed");
    expect(conn.pendingSyncCount()).toBe(1);
    conn.close();
  });

  it("the browser 'offline' event proactively drops a live socket → 'local' (no zombie sync)", async () => {
    // Intent (§11.2): when the browser knows it's offline, the established
    //   socket is a zombie — the connection must not keep reading "live" (and
    //   silently feeding sends into a dead pipe). Closing it on the event flips
    //   to the honest editable "local" state immediately.
    const { factory, sockets } = recordingFactory();
    const { storage } = memoryStorage();
    const conn = new DocConnection<List>(A.init<List>(CLIENT_ACTOR), "ws://x/d", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
      storage,
      storageKey: "doc-5",
      isOnline: () => false, // by the time the event fires, navigator agrees
    });
    await flush();
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireSnapshot(A.from<List>({ items: ["base"] }, SERVER_ACTOR));
    sock(sockets, 0).fireCaughtUp();
    expect(conn.state()).toBe("live");

    window.dispatchEvent(new Event("offline"));
    expect(conn.state()).toBe("local");
    conn.close();
  });

  it("an edit made on a ZOMBIE-live socket (browser offline, no close yet) counts as pending", async () => {
    // Intent (§11.2): some browsers neither sever an established socket nor fire
    //   the 'offline' event when connectivity drops — navigator.onLine is the
    //   only signal. An edit made in that window must not vanish into the dead
    //   pipe as "delivered": the connection probes isOnline() at send time,
    //   drops the zombie, and the edit lands as a pending local change.
    const { factory, sockets } = recordingFactory();
    const { storage } = memoryStorage();
    const conn = new DocConnection<List>(A.init<List>(CLIENT_ACTOR), "ws://x/d", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
      storage,
      storageKey: "doc-6",
      isOnline: () => false, // the browser knows; the socket hasn't noticed
    });
    await flush();
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireSnapshot(A.from<List>({ items: ["base"] }, SERVER_ACTOR));
    sock(sockets, 0).fireCaughtUp();
    expect(conn.state()).toBe("live"); // zombie: still reads live

    conn.change((d) => {
      d.items.push("offline-edit");
    });
    expect(conn.pendingSyncCount()).toBe(1); // NOT swallowed as delivered
    expect(sock(sockets, 0).sent).toHaveLength(0); // never fed to the dead pipe
    expect(conn.state()).toBe("local"); // the zombie was dropped → editable local
    conn.close();
  });

  it("a connection disposed BEFORE hydration never clobbers the persisted copy", async () => {
    // Intent (§11.2, the 9edab0a projection-clobber class): React strict/dev
    //   double-mount (or any fast open→close) disposes a connection whose local
    //   hydrate hasn't resolved. Its doc is still the empty A.init — the final
    //   close() persist must NOT overwrite the good saved bytes with that.
    const { factory } = recordingFactory();
    const { storage, map } = memoryStorage();
    const good = A.change(A.from<List>({ items: [] }, SERVER_ACTOR), (d) => {
      d.items.push("survives");
    });
    map.set("doc-7", { bytes: A.save(good), pendingCount: 1 });

    // Gate the load so close() runs strictly before hydration resolves.
    let releaseLoad: (() => void) | undefined;
    const gated: import("./doc-storage").DocStorage = {
      load: (key) =>
        new Promise((resolve) => {
          releaseLoad = () => resolve(map.get(key) ?? null);
        }),
      save: storage.save,
    };
    const conn = new DocConnection<List>(A.init<List>(CLIENT_ACTOR), "ws://x/d", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
      storage: gated,
      storageKey: "doc-7",
    });
    conn.close(); // disposed pre-hydration (the strict-mode first mount)
    releaseLoad?.();
    await flush();

    // The good copy survives, and a fresh connection rehydrates it intact.
    const s2 = recordingFactory();
    const conn2 = new DocConnection<List>(A.init<List>(CLIENT_ACTOR), "ws://x/d", s2.factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
      storage,
      storageKey: "doc-7",
    });
    await flush();
    expect(conn2.state()).toBe("local");
    expect(conn2.materialized().items).toContain("survives");
    expect(conn2.pendingSyncCount()).toBe(1);
    conn2.close();
  });

  it("without storage, behavior is unchanged (warm drop → 'connecting')", () => {
    const { factory, sockets } = recordingFactory();
    const conn = new DocConnection(A.init(), "ws://x/d", factory, {
      reconnect: { delays: [1000], maxColdAttempts: 4 },
    });
    sock(sockets, 0).fireOpen();
    sock(sockets, 0).fireCaughtUp();
    sock(sockets, 0).fireClose();
    expect(conn.state()).toBe("connecting");
    conn.close();
  });
});

describe("connectUrl", () => {
  it("targets the /api/docs/:id/connect worker route (ws scheme, id encoded)", async () => {
    const { connectUrl } = await import("./doc-connection");
    // Under `/api/` like every other worker endpoint — the SPA and worker share
    // one origin, and the root `/docs/*` namespace stays free for future pages.
    expect(connectUrl("https://weavesteps.com", "rt_01")).toBe(
      "wss://weavesteps.com/api/docs/rt_01/connect",
    );
    expect(connectUrl("http://localhost:8787/", "a/b")).toBe(
      "ws://localhost:8787/api/docs/a%2Fb/connect",
    );
  });
});
