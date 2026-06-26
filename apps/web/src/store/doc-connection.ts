// US-017 — client side of the US-015 sync protocol (one Automerge doc per DO).
//
// A `DocConnection` holds an in-memory Automerge doc for ONE document and keeps
// it in sync with that document's Durable Object over the WebSocket the worker
// exposes at `/docs/:id/connect` (US-017 Phase 1). It speaks the same raw-binary
// change protocol the DO speaks (US-015): incoming binary frames are Automerge
// changes to apply; local edits are sent as change bytes. Malformed frames are
// dropped (the wire is untrusted until US-021), mirroring the DO's own guard.
//
// The WebSocket factory is injectable so the seam is testable without a live
// server (jsdom has no WS server); production passes the global `WebSocket`.
import * as A from "@automerge/automerge";
import { SYNC_CAUGHT_UP } from "@ballroom/contract";

/** Minimal structural view of a WebSocket (so tests can inject a fake). */
export interface SocketLike {
  binaryType: string;
  send(data: ArrayBufferView | ArrayBuffer): void;
  close(): void;
  addEventListener(type: "message", fn: (ev: { data: unknown }) => void): void;
  addEventListener(type: "open" | "close", fn: () => void): void;
}

/** Opens a socket to a URL, optionally offering WS subprotocols (the auth token
 *  rides here, #189). Production: `(url, protocols) => new WebSocket(url, protocols)`. */
export type SocketFactory = (url: string, protocols?: string[]) => SocketLike;

/** Resolve a fresh auth token for ONE connection-open (#189). null = no token. */
export type TokenProvider = () => Promise<string | null>;

/** The WS subprotocol that carries the bearer token (the worker route reads it). */
export const AUTH_SUBPROTOCOL = "ballroom.auth";

/** Where the worker serves the per-document sync socket. */
export function connectUrl(base: string, docId: string): string {
  const wsBase = base.replace(/^http/, "ws").replace(/\/$/, "");
  return `${wsBase}/docs/${encodeURIComponent(docId)}/connect`;
}

/**
 * A live connection to one document's DO. Owns the in-memory Automerge doc and
 * notifies a listener whenever it advances (from a local edit or a peer frame).
 */
/**
 * Where one document's connection is in its lifecycle (drives the UI indicator
 * and the edit gate). "connecting" = socket opening OR open-but-not-yet-hydrated;
 * "live" = the DO's full catch-up replay has been APPLIED (hydrated, safe to
 * edit, #202); "closed" = socket closed/offline.
 */
export type SyncState = "connecting" | "live" | "closed";

export class DocConnection<T> {
  private doc: A.Doc<T>;
  private socket: SocketLike | null = null;
  private onChange: (() => void) | null = null;
  private syncState: SyncState = "connecting";
  private closed = false;
  // Outgoing changes produced before the socket is open (e.g. while the #189
  // token resolves, or during the CONNECTING window) are buffered here and
  // flushed once it opens — otherwise a brand-new doc's seed change (a figure's
  // name/attributes) is silently dropped and never reaches its DO, so it's lost
  // on the next reload. (A precursor to full reconnect resend, #161.)
  private pendingSends: Uint8Array[] = [];

  /**
   * `getToken` (#189): when provided, a FRESH token is fetched at THIS
   * connection's open and offered as the `ballroom.auth` WS subprotocol, so the
   * fail-closed DO boundary (US-021) authenticates it. Resolving per-open (not
   * once for the whole session) means a lazily-opened figure conn gets a current
   * token, not a stale cached one. Mid-session re-auth of an open socket is #161.
   * Without `getToken` the socket opens immediately (tests / open-boundary).
   */
  constructor(initial: A.Doc<T>, url: string, openSocket: SocketFactory, getToken?: TokenProvider) {
    this.doc = initial;
    if (getToken) {
      void getToken().then((token) => {
        if (this.closed) return; // closed before the token resolved
        const protocols = token ? [AUTH_SUBPROTOCOL, token] : undefined;
        this.attach(openSocket(url, protocols));
      });
    } else {
      this.attach(openSocket(url));
    }
  }

  /** Wire up a freshly-opened socket. */
  private attach(socket: SocketLike): void {
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (ev) => this.receive(ev.data));
    // On open, flush any changes buffered while connecting — but do NOT go
    // "live" yet. "live" means HYDRATED (the DO's full catch-up replay has been
    // applied), signalled by the SYNC_CAUGHT_UP marker in receive() (#202), so
    // the UI never enables editing on a not-yet-replayed doc. Until then the
    // state stays "connecting" (US-018 "syncing…").
    socket.addEventListener("open", () => this.flush());
    socket.addEventListener("close", () => this.setState("closed"));
  }

  /** The current immutable doc. */
  current(): A.Doc<T> {
    return this.doc;
  }

  /** This connection's sync lifecycle state. */
  state(): SyncState {
    return this.syncState;
  }

  private liveWaiters: Array<() => void> = [];

  private setState(next: SyncState): void {
    if (this.syncState === next) return;
    this.syncState = next;
    if (next === "live") {
      const waiters = this.liveWaiters;
      this.liveWaiters = [];
      for (const fn of waiters) fn();
    }
    this.onChange?.(); // a state change re-renders the indicator
  }

  /**
   * Run `fn` once this connection is HYDRATED ("live") — immediately if it
   * already is. Used to defer a brand-new doc's SEED write until the DO's
   * catch-up has been applied, so we never write into a not-yet-hydrated doc
   * (which would race/merge-clobber or be lost before its first sync) (#202).
   */
  onceLive(fn: () => void): void {
    if (this.syncState === "live") fn();
    else this.liveWaiters.push(fn);
  }

  /** Subscribe to advances of this doc (replaces any prior listener). */
  onAdvance(fn: () => void): void {
    this.onChange = fn;
  }

  /**
   * Apply a local mutation, send the resulting change bytes to the DO, and
   * notify the listener. Returns the new doc.
   */
  change(fn: (draft: T) => void): A.Doc<T> {
    const before = this.doc;
    const after = A.change(before, fn);
    this.doc = after;
    for (const c of A.getChanges(before, after)) this.send(c as Uint8Array);
    this.onChange?.();
    return after;
  }

  /** Replace the doc (e.g. after an undo/redo computed elsewhere) + sync the delta. */
  commit(next: A.Doc<T>): void {
    const before = this.doc;
    this.doc = next;
    for (const c of A.getChanges(before, next)) this.send(c as Uint8Array);
    this.onChange?.();
  }

  /** Apply a raw incoming change frame from a peer. Drops malformed frames. */
  private receive(data: unknown): void {
    // The DO's catch-up-complete marker (a TEXT frame): the full replay has been
    // applied, so this connection is HYDRATED → go "live" (#202).
    if (data === SYNC_CAUGHT_UP) {
      this.setState("live");
      return;
    }
    if (!(data instanceof ArrayBuffer)) return; // sync frames are binary
    try {
      const [next] = A.applyChanges(this.doc, [new Uint8Array(data) as A.Change]);
      // Heads unchanged ⇒ duplicate/no-op; skip the notify.
      if (A.getHeads(next).join() === A.getHeads(this.doc).join()) return;
      this.doc = next;
      this.onChange?.();
    } catch {
      // Malformed frame (not a valid Automerge change) — drop it.
    }
  }

  private send(change: Uint8Array): void {
    if (this.socket) {
      try {
        this.socket.send(change);
        return;
      } catch {
        // Socket attached but not open yet (CONNECTING) — fall through to buffer.
      }
    }
    // Not attached (token still resolving) or not open — buffer for the flush on
    // "open" so a brand-new doc's changes aren't lost before its first sync.
    this.pendingSends.push(change);
  }

  /** Send everything buffered while the socket was connecting, in order. */
  private flush(): void {
    if (!this.socket || this.pendingSends.length === 0) return;
    const queued = this.pendingSends;
    this.pendingSends = [];
    for (const change of queued) {
      try {
        this.socket.send(change);
      } catch {
        // Still not writable — re-buffer the rest and wait for the next open.
        this.pendingSends.push(change);
      }
    }
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }
}
