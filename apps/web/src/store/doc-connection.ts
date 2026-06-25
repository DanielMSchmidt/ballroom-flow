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

/** Minimal structural view of a WebSocket (so tests can inject a fake). */
export interface SocketLike {
  binaryType: string;
  send(data: ArrayBufferView | ArrayBuffer): void;
  close(): void;
  addEventListener(type: "message", fn: (ev: { data: unknown }) => void): void;
  addEventListener(type: "open" | "close", fn: () => void): void;
}

/** Opens a socket to a URL. Production: `(url) => new WebSocket(url)`. */
export type SocketFactory = (url: string) => SocketLike;

/** Where the worker serves the per-document sync socket. */
export function connectUrl(base: string, docId: string): string {
  const wsBase = base.replace(/^http/, "ws").replace(/\/$/, "");
  return `${wsBase}/docs/${encodeURIComponent(docId)}/connect`;
}

/**
 * A live connection to one document's DO. Owns the in-memory Automerge doc and
 * notifies a listener whenever it advances (from a local edit or a peer frame).
 */
/** Where one document's connection is in its lifecycle (drives the UI indicator). */
export type SyncState = "connecting" | "live" | "closed";

export class DocConnection<T> {
  private doc: A.Doc<T>;
  private socket: SocketLike;
  private onChange: (() => void) | null = null;
  private syncState: SyncState = "connecting";

  constructor(initial: A.Doc<T>, url: string, openSocket: SocketFactory) {
    this.doc = initial;
    this.socket = openSocket(url);
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("message", (ev) => this.receive(ev.data));
    // Track lifecycle so the store can surface connecting/live/closed (US-018
    // "syncing…" indicator). The DO replays the full log on open → "live".
    this.socket.addEventListener("open", () => this.setState("live"));
    this.socket.addEventListener("close", () => this.setState("closed"));
  }

  /** The current immutable doc. */
  current(): A.Doc<T> {
    return this.doc;
  }

  /** This connection's sync lifecycle state. */
  state(): SyncState {
    return this.syncState;
  }

  private setState(next: SyncState): void {
    if (this.syncState === next) return;
    this.syncState = next;
    this.onChange?.(); // a state change re-renders the indicator
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
    try {
      this.socket.send(change);
    } catch {
      // Socket not open / closing — the DO replays state on reconnect.
    }
  }

  close(): void {
    this.socket.close();
  }
}
