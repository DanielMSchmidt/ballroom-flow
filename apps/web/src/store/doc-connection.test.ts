import * as A from "@automerge/automerge";
import { SYNC_CAUGHT_UP } from "@ballroom/contract";
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
  load(doc: A.Doc<unknown>): void {
    for (const c of A.getAllChanges(doc)) {
      const u = c as Uint8Array;
      this.msg?.({ data: u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) });
    }
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
