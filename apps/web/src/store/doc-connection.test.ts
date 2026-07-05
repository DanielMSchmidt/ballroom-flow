import * as A from "@automerge/automerge";
import { SYNC_CAUGHT_UP, SYNC_FRAME_SNAPSHOT } from "@weavesteps/contract";
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
  private msg: ((ev: { data: unknown }) => void) | null = null;
  private opened: (() => void) | null = null;
  private closed: (() => void) | null = null;
  sent: Uint8Array[] = [];
  addEventListener(type: string, fn: (ev: { data: unknown }) => void): void {
    if (type === "message") this.msg = fn;
    else if (type === "open") this.opened = fn as unknown as () => void;
    else if (type === "close") this.closed = fn as unknown as () => void;
  }
  send(data: ArrayBufferView | ArrayBuffer): void {
    this.sent.push(new Uint8Array(data as ArrayBuffer));
  }
  close(): void {
    this.closed?.();
  }
  fireOpen(): void {
    this.opened?.();
  }
  fireClose(): void {
    this.closed?.();
  }
  fireCaughtUp(): void {
    this.msg?.({ data: SYNC_CAUGHT_UP });
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
