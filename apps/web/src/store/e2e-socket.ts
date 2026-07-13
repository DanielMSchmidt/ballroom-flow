// E2E-only zombie-socket seam (WEP-0006). NEVER active in a real build: every
// entry point is gated on `isE2E()` (the compile-time `VITE_E2E` flag), so in
// dev/staging/prod this module folds to pass-throughs and dead code.
//
// A real half-open socket — TCP thinks it's up, nothing is delivered, no close
// event, `navigator.onLine` still true — cannot be produced from Playwright
// (`context.setOffline` flips `navigator.onLine`, which the §11.2 machinery
// already handles). So the E2E build wraps every WebSocket the store opens in a
// thin proxy that a journey can flip into EXACTLY that zombie state via
// `window.__weaveZombifySockets()`: sends are swallowed, inbound events are
// suppressed, and no close ever fires. The heartbeat (shortened below so the
// journey resolves in seconds) is then the ONLY thing that can notice — which
// is precisely what the ship-gate journey asserts.

import { isE2E } from "../lib/e2e-auth";
import type { HeartbeatPolicy, SocketFactory, SocketLike } from "./doc-connection";

declare global {
  interface Window {
    /** Turn every CURRENTLY-OPEN store socket into a zombie; returns how many. */
    __weaveZombifySockets?: () => number;
  }
}

type MessageListener = (ev: { data: unknown }) => void;

/** A pass-through socket that can be flipped into a half-open zombie. */
class ZombifiableSocket implements SocketLike {
  private zombie = false;
  private readonly listeners: Record<"message" | "open" | "close", MessageListener[]> = {
    message: [],
    open: [],
    close: [],
  };

  constructor(private readonly real: SocketLike) {
    real.addEventListener("message", (ev) => this.emit("message", ev));
    real.addEventListener("open", () => this.emit("open", { data: undefined }));
    real.addEventListener("close", () => this.emit("close", { data: undefined }));
  }

  get binaryType(): string {
    return this.real.binaryType;
  }
  set binaryType(v: string) {
    this.real.binaryType = v;
  }

  addEventListener(type: "message" | "open" | "close", fn: MessageListener): void {
    this.listeners[type].push(fn);
  }

  send(data: string | ArrayBufferView | ArrayBuffer): void {
    if (this.zombie) return; // swallowed by the dead pipe
    this.real.send(data);
  }

  close(): void {
    if (this.zombie) return; // a dead pipe's close handshake never completes
    this.real.close();
  }

  /** Become a half-open zombie: nothing in, nothing out, no close event. */
  zombify(): void {
    this.zombie = true;
  }

  private emit(type: "message" | "open" | "close", ev: { data: unknown }): void {
    if (this.zombie) return; // inbound traffic vanishes into the dead pipe too
    for (const fn of this.listeners[type]) fn(ev);
  }
}

/** Sockets alive in this tab (zombified ones are dropped from the set). */
const liveSockets = new Set<ZombifiableSocket>();

function zombifyAll(): number {
  let n = 0;
  for (const s of liveSockets) {
    s.zombify();
    liveSockets.delete(s);
    n += 1;
  }
  return n;
}

/**
 * Wrap a SocketFactory with the zombie seam. Outside an E2E build this returns
 * the factory untouched (and installs nothing on `window`).
 */
export function e2eZombifiableSocketFactory(base: SocketFactory): SocketFactory {
  if (!isE2E()) return base;
  if (typeof window !== "undefined") window.__weaveZombifySockets = zombifyAll;
  return (url, protocols) => {
    const wrapped = new ZombifiableSocket(base(url, protocols));
    liveSockets.add(wrapped);
    // A socket that closes for real is done — no need to keep it zombifiable.
    wrapped.addEventListener("close", () => liveSockets.delete(wrapped));
    return wrapped;
  };
}

/**
 * The E2E heartbeat: same code path as production, shortened so (a) the
 * zombie-socket journey resolves in seconds and (b) EVERY journey continuously
 * exercises real ping→pong delivery against the real worker — a broken
 * auto-response would drop healthy sockets and fail the whole suite loudly.
 * `undefined` outside E2E, letting the DocConnection default apply.
 */
export function e2eHeartbeat(): HeartbeatPolicy | undefined {
  return isE2E() ? { intervalMs: 1500, deadlineMs: 750 } : undefined;
}
