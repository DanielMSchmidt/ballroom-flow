// US-017 — client side of the US-015 sync protocol (one Automerge doc per DO).
//
// A `DocConnection` holds an in-memory Automerge doc for ONE document and keeps
// it in sync with that document's Durable Object over the WebSocket the worker
// exposes at `/docs/:id/connect` (US-017 Phase 1). It speaks the D10 sync wire
// (US-015 + 2026-07-02 hardening): server→client BINARY frames carry a 1-byte
// TYPE tag — a SYNC_FRAME_SNAPSHOT (the whole doc, `A.load`ed + `A.merge`d on
// (re)connect) or a SYNC_FRAME_CHANGE (one incremental change to apply). Local
// edits are sent as RAW change bytes (client→server frames are untagged — see
// @weavesteps/contract SYNC_FRAME_* for the asymmetry). On (re)connect, after
// merging the catch-up snapshot, the client RESENDS the local changes the server
// is missing (#161), so an edit made into a dying socket is never silently lost.
// Malformed frames are dropped (the wire is untrusted until US-021).
//
// The WebSocket factory is injectable so the seam is testable without a live
// server (jsdom has no WS server); production passes the global `WebSocket`.
import * as A from "@automerge/automerge";
import { SYNC_CAUGHT_UP, SYNC_FRAME_CHANGE, SYNC_FRAME_SNAPSHOT } from "@weavesteps/contract";
import { reconcile } from "./reconcile";

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
 * Auto-reconnect policy. A dropped socket re-opens after a backoff so a figure
 * (or the routine) self-heals on a sleep/wake, network blip, or DO eviction —
 * the gap that used to require a full page reload to recover a blank figure.
 */
export interface ReconnectPolicy {
  /**
   * Backoff delays (ms) per successive attempt; the last entry repeats for all
   * later attempts. An empty array disables reconnect entirely.
   */
  delays?: number[];
  /**
   * Max CONSECUTIVE cold failures (a socket that closed before it ever opened —
   * a rejected handshake: missing doc, revoked access, or server down) before we
   * give up and go terminally "closed". A connection that has opened at least
   * once treats later drops as transient and keeps retrying (capped backoff).
   */
  maxColdAttempts?: number;
}

/** Injectable timers so reconnect/backoff is deterministic under test. */
export interface DocConnectionOptions {
  /** Fresh-token provider attached as the `ballroom.auth` subprotocol (#189). */
  getToken?: TokenProvider;
  /** Auto-reconnect policy (default: a capped exponential backoff). */
  reconnect?: ReconnectPolicy;
  /** Schedule a delayed callback (default: global setTimeout). */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel a scheduled callback (default: global clearTimeout). */
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_RECONNECT: Required<ReconnectPolicy> = {
  delays: [1000, 2000, 5000, 10000],
  maxColdAttempts: 4,
};

/**
 * A live connection to one document's DO. Owns the in-memory Automerge doc and
 * notifies a listener whenever it advances (from a local edit or a peer frame).
 */
/**
 * Where one document's connection is in its lifecycle (drives the UI indicator
 * and the edit gate). "connecting" = socket opening, reconnecting, OR
 * open-but-not-yet-hydrated; "live" = the DO's full catch-up replay has been
 * APPLIED (hydrated, safe to edit, #202); "closed" = TERMINAL — either disposed
 * by the owner, or reconnect gave up after exhausting its cold attempts.
 */
export type SyncState = "connecting" | "live" | "closed";

export class DocConnection<T> {
  private doc: A.Doc<T>;
  private socket: SocketLike | null = null;
  private onChange: (() => void) | null = null;
  private syncState: SyncState = "connecting";
  /** Owner called close() — permanent; never reconnects again. */
  private disposed = false;
  /** This connection has opened a socket at least once (distinguishes cold vs warm). */
  private everOpened = false;
  /** Consecutive cold failures (closes with no intervening open) since the last open. */
  private coldFailures = 0;
  /** Reconnect attempt counter — indexes into the backoff delays. */
  private attempt = 0;
  /** Pending reconnect timer handle, so close()/reconnectNow() can cancel it. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Outgoing changes produced before the socket is open (e.g. while the #189
  // token resolves, during the CONNECTING window, or while reconnecting) are
  // buffered here and flushed once it opens — otherwise a brand-new doc's seed
  // change (a figure's name/attributes), or an edit made during a reconnect gap,
  // is silently dropped and never reaches its DO, so it's lost on the next
  // reload. This handles the socket-not-open case; the SNAPSHOT-diff resend on
  // (re)connect (#161) is the complementary belt-and-braces that recovers a
  // change which WAS sent into a socket that then died before it hit the wire.
  private pendingSends: Uint8Array[] = [];
  // Whether the current connection has received its catch-up SNAPSHOT frame yet.
  // Reset per socket (in `attach`); drives the reconnect-resend at SYNC_CAUGHT_UP
  // for the rare unseeded-server case (no snapshot ⇒ the server is missing ALL
  // our local changes). The seeded case resends from the snapshot diff directly.
  private snapshotSinceConnect = false;

  private readonly url: string;
  private readonly openSocket: SocketFactory;
  private readonly getToken?: TokenProvider;
  private readonly reconnectPolicy: Required<ReconnectPolicy>;
  private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly cancel: (handle: ReturnType<typeof setTimeout>) => void;

  /**
   * `getToken` (#189): when provided, a FRESH token is fetched at THIS
   * connection's open (and at every reconnect) and offered as the `ballroom.auth`
   * WS subprotocol, so the fail-closed DO boundary (US-021) authenticates it.
   * Resolving per-open (not once for the whole session) means a lazily-opened or
   * reconnected figure conn gets a current token, not a stale cached one. Without
   * `getToken` the socket opens immediately (tests / open-boundary).
   *
   * Accepts either a plain `TokenProvider` (back-compat) or a full options object.
   */
  constructor(
    initial: A.Doc<T>,
    url: string,
    openSocket: SocketFactory,
    optsOrToken?: TokenProvider | DocConnectionOptions,
  ) {
    this.doc = initial;
    this.url = url;
    this.openSocket = openSocket;
    const opts: DocConnectionOptions =
      typeof optsOrToken === "function" ? { getToken: optsOrToken } : (optsOrToken ?? {});
    this.getToken = opts.getToken;
    this.reconnectPolicy = {
      delays: opts.reconnect?.delays ?? DEFAULT_RECONNECT.delays,
      maxColdAttempts: opts.reconnect?.maxColdAttempts ?? DEFAULT_RECONNECT.maxColdAttempts,
    };
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h));
    this.connect();
  }

  /** Open (or re-open) the socket: fetch a fresh token, then attach. */
  private connect(): void {
    if (this.disposed) return;
    if (this.getToken) {
      void this.getToken().then((token) => {
        if (this.disposed) return; // disposed before the token resolved
        const protocols = token ? [AUTH_SUBPROTOCOL, token] : undefined;
        this.attach(this.openSocket(this.url, protocols));
      });
    } else {
      this.attach(this.openSocket(this.url));
    }
  }

  /** Wire up a freshly-opened socket. */
  private attach(socket: SocketLike): void {
    this.socket = socket;
    this.snapshotSinceConnect = false; // a new connection hasn't caught up yet
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (ev) => this.receive(ev.data));
    // On open, flush any changes buffered while connecting — but do NOT go
    // "live" yet. "live" means HYDRATED (the DO's full catch-up replay has been
    // applied), signalled by the SYNC_CAUGHT_UP marker in receive() (#202), so
    // the UI never enables editing on a not-yet-replayed doc. Until then the
    // state stays "connecting" (US-018 "syncing…").
    socket.addEventListener("open", () => {
      this.everOpened = true;
      this.coldFailures = 0; // a successful open clears the cold-failure streak
      this.flush();
    });
    socket.addEventListener("close", () => this.onSocketClosed());
  }

  /**
   * A socket closed. Decide whether to reconnect (transient) or give up (a
   * persistently rejected/unreachable connection), unless the owner disposed us.
   */
  private onSocketClosed(): void {
    if (this.disposed) {
      this.setState("closed");
      return;
    }
    this.socket = null; // so buffered sends queue cleanly until the next open
    const reconnectDisabled = this.reconnectPolicy.delays.length === 0;
    if (reconnectDisabled) {
      this.setState("closed");
      return;
    }
    if (this.everOpened) {
      // Warm drop (we'd connected before): a transient blip — keep retrying with
      // a capped backoff so the figure/routine self-heals without a reload.
      this.everOpened = false; // re-armed on the next successful open
      this.scheduleReconnect();
      return;
    }
    // Cold failure: the handshake never opened (missing doc, revoked access, or
    // server down). Retry a bounded number of times, then give up terminally —
    // the store then confirms missing-vs-error via the access preflight.
    this.coldFailures += 1;
    if (this.coldFailures >= this.reconnectPolicy.maxColdAttempts) {
      // Give up: terminally "closed" until a manual reconnectNow(). The store
      // then confirms missing-vs-error via the access preflight.
      this.setState("closed");
      return;
    }
    this.scheduleReconnect();
  }

  /** Arm the next reconnect after the policy's backoff for this attempt. */
  private scheduleReconnect(): void {
    this.setState("connecting"); // reconnecting reads as "connecting", not "closed"
    const { delays } = this.reconnectPolicy;
    const delay = delays[Math.min(this.attempt, delays.length - 1)] ?? 1000;
    this.attempt += 1;
    if (this.reconnectTimer != null) this.cancel(this.reconnectTimer);
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Force an immediate reconnect, clearing a terminal give-up. Used by the store's
   * "retry" affordance when a figure surfaced as errored/unavailable, so the user
   * can recover without reloading the page.
   */
  reconnectNow(): void {
    if (this.disposed) return;
    if (this.reconnectTimer != null) {
      this.cancel(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.attempt = 0;
    this.coldFailures = 0;
    this.connect();
  }

  /** The current immutable doc. */
  current(): A.Doc<T> {
    return this.doc;
  }

  /**
   * The current doc materialized to plain JS, MEMOIZED by the doc's Automerge
   * heads — an unchanged doc returns the SAME object reference across calls.
   *
   * Automerge docs are immutable and `getHeads` uniquely identifies a version, so
   * this is a safe identity cache. It's what gives the reactive `store/` seam
   * referential stability: an inbound sync frame that doesn't touch THIS doc no
   * longer produces a fresh `A.toJS` object, so React sees stable props and the
   * subtree stops re-rendering (the editor "flicker"/stutter root cause). Prefer
   * this over `A.toJS(conn.current())` on any hot read path.
   */
  materialized(): T {
    const key = A.getHeads(this.doc).join("/");
    const cached = this.jsCache;
    if (cached && cached.key === key) return cached.value;
    // Structural sharing (reconcile): when the doc DID change, keep the object
    // identity of every subtree that didn't — so a one-field change hands React
    // a snapshot where only the changed subtree (and its ancestors) is new, and
    // everything else bails out of re-render. See store/reconcile.ts.
    const value = reconcile(cached?.value, A.toJS(this.doc) as T);
    this.jsCache = { key, value };
    return value;
  }
  private jsCache: { key: string; value: T } | null = null;

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

  /**
   * Handle an incoming server→client frame. TEXT = the SYNC_CAUGHT_UP marker;
   * BINARY = a D10-tagged frame (byte 0 = type, rest = payload): a SNAPSHOT to
   * merge, or one CHANGE to apply. Malformed / unknown-tag frames are dropped.
   */
  private receive(data: unknown): void {
    // The DO's catch-up-complete marker (a TEXT frame): the catch-up is done, so
    // this connection is HYDRATED → go "live" (#202).
    if (data === SYNC_CAUGHT_UP) {
      // No snapshot arrived this connection ⇒ the server has NO state for this
      // doc (unseeded), so it is missing ALL our local changes — resend them.
      // (The seeded case already resent from the snapshot diff in `mergeSnapshot`.
      // On a fresh empty doc this is a no-op: getAllChanges is empty.)
      if (!this.snapshotSinceConnect) this.resendMissing(A.getAllChanges(this.doc));
      this.attempt = 0; // a clean hydration resets the backoff schedule
      this.setState("live");
      return;
    }
    if (!(data instanceof ArrayBuffer)) return; // sync frames are binary
    const framed = new Uint8Array(data);
    if (framed.byteLength === 0) return; // an empty frame carries no tag — drop
    const tag = framed[0];
    // `slice(1)` COPIES the payload off the tagged frame (a subarray view could
    // confuse the wasm loader, which reads the whole backing buffer).
    const payload = framed.slice(1);
    if (tag === SYNC_FRAME_SNAPSHOT) {
      this.mergeSnapshot(payload);
    } else if (tag === SYNC_FRAME_CHANGE) {
      this.applyChangeFrame(payload);
    }
    // else: an unknown tag (e.g. a raw change frame from an OLD server during a
    // rollout — its first byte is Automerge magic, not one of ours) → drop it.
  }

  /**
   * Apply the catch-up SNAPSHOT (#161 core): `A.load` the server's whole-doc blob
   * and `A.merge` it into our local doc, so a RECONNECTING client with unacked
   * local edits keeps them (merge is a union, not a replace) while gaining every
   * change the server advanced past us. Then compute the changes the SERVER is
   * missing — the local-ahead delta — and RESEND them, so an edit that was lost
   * into a dying socket (sent, but never reached the wire) is recovered. The
   * server's `ingestChange` is idempotent, so re-sending a change it already has
   * is a safe no-op.
   */
  private mergeSnapshot(saved: Uint8Array): void {
    this.snapshotSinceConnect = true;
    let serverDoc: A.Doc<T>;
    try {
      serverDoc = A.load<T>(saved);
    } catch {
      return; // malformed snapshot blob — drop it (the wire is untrusted)
    }
    const beforeHeads = A.getHeads(this.doc).join();
    // Merge the server's state INTO our doc — mutating `this.doc`'s handle in
    // place so it KEEPS this connection's Automerge actor id (critical: a fresh
    // `A.clone(this.doc)` would fork a NEW random actor and break per-actor undo).
    // We clone only `serverDoc` (merge freezes its second arg) so the original
    // `serverDoc` stays readable for the getChanges diff below.
    const merged = A.merge(this.doc, A.clone(serverDoc));
    // Changes present in `merged` but not in `serverDoc` = exactly our local
    // changes the server hasn't seen. (Safe: `merged` ⊇ `serverDoc`, so
    // getChanges never hits its "old has changes new lacks" crash.)
    const missing = A.getChanges(serverDoc, merged);
    this.doc = merged;
    if (A.getHeads(merged).join() !== beforeHeads) this.onChange?.();
    this.resendMissing(missing);
  }

  /** Apply one incremental CHANGE frame from a peer. Drops malformed frames. */
  private applyChangeFrame(change: Uint8Array): void {
    try {
      const [next] = A.applyChanges(this.doc, [change as A.Change]);
      // Heads unchanged ⇒ duplicate/no-op; skip the notify.
      if (A.getHeads(next).join() === A.getHeads(this.doc).join()) return;
      this.doc = next;
      this.onChange?.();
    } catch {
      // Malformed frame (not a valid Automerge change) — drop it.
    }
  }

  /** Send changes the server is missing (reconnect resend, #161). Routes through
   *  `send` so a not-yet-open socket buffers them for the flush on open. */
  private resendMissing(changes: A.Change[]): void {
    for (const c of changes) this.send(c as Uint8Array);
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
    // Not attached (token still resolving, or reconnecting) or not open — buffer
    // for the flush on "open" so a brand-new doc's changes, or an edit made
    // during a reconnect gap, aren't lost before the next sync.
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

  /**
   * Dispose this connection: stop reconnecting and close the socket. TERMINAL —
   * `disposed` is never cleared, so a later drop never reconnects.
   *
   * pendingSends on dispose: any changes still buffered here (never flushed to a
   * socket) are DROPPED — but this is not the silent-loss path #161 guards. close()
   * is a deliberate owner teardown (navigating away / disposing the store): the
   * in-memory doc these changes belong to is being discarded WITH them, so there
   * is nothing left to be inconsistent with. The loss path that matters — a change
   * dropped while the connection stays LIVE (a warm reconnect) — is covered by the
   * snapshot-diff resend on reconnect. We surface the count for observability
   * rather than swallowing it entirely.
   */
  close(): void {
    this.disposed = true;
    if (this.reconnectTimer != null) {
      this.cancel(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pendingSends.length > 0) {
      // Not an error — see the note above; logged so an unexpected drop is visible.
      console.debug(
        `DocConnection.close: dropping ${this.pendingSends.length} unflushed change(s)`,
      );
    }
    this.socket?.close();
  }
}
