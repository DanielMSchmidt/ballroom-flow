# Sync, liveness & offline

*How documents move between clients and Durable Objects, and how the app behaves on bad or
absent networks. The user-facing semantics are in
[`docs/concepts/collaboration.md`](../concepts/collaboration.md) § Live editing / § Offline;
this doc is the machinery.*

## The read/edit split (role-aware hybrid)

Goal: live collaboration without a per-document WebSocket fan-out on the dominant read path.

- **One REST snapshot** (`GET /api/routines/:id/snapshot` — routine + its figures + variant
  bases) hydrates the screen, kept fresh by light polling + refetch-on-focus.
- **Viewers open zero WebSockets** (snapshot only).
- **Editors/owners/commenters open one live routine WS immediately** (a collaborator's
  section/placement/annotation edits converge live), but **figures render from the
  snapshot** — a figure's own WS opens only when its step editor opens or it's edited.
- A variant's **base** stays snapshot/poll-fresh (admin catalog edits are rare).

*(Rejected alternative, recorded because it will look tempting again: "read-by-default for
everyone, upgrade to a socket on first edit". It broke live convergence for a passive
co-editor — someone with edit rights watching a partner edit never received the edits live.)*

## The wire

- Endpoint: `/api/docs/:id/connect`, Hibernatable WebSockets, one connection per document.
- **Protocol version is negotiated at the handshake**: the client offers the
  `ballroom.sync.v1` subprotocol (alongside the `ballroom.auth` token carrier) and the worker
  echoes it — an incompatible future wire is detected at connect, not from malformed frames.
- **Frames:** server→client BINARY frames carry a 1-byte type tag (`SYNC_FRAME_SNAPSHOT` /
  `SYNC_FRAME_CHANGE`, in `packages/contract`); client→server BINARY frames are raw Automerge
  change bytes (asymmetric, deliberate). TEXT frames are reserved for control markers
  (`SYNC_CAUGHT_UP`, ping/pong).
- **Connect catch-up is ONE snapshot frame** (an `A.save` blob the client loads and
  **merges** into its local doc — so a reconnecting client keeps unacked local edits), never
  a per-change history replay: the wire stays bounded as documents age.
- **Reconnect resend:** after merging the snapshot, the client diffs what the server lacks
  and re-sends it (idempotent server-side). A change sent into a dying socket is never
  silently lost.
- A broadcast send failure **closes** that socket (dedicated close code) so the client
  warm-reconnects to a fresh snapshot rather than silently diverging.

## Heartbeat — zombie-socket detection

A half-open socket (TCP up, nothing delivered — e.g. a rebooted access point;
`navigator.onLine` still true) would otherwise impersonate "live" until the OS TCP timeout.

- The client sends a TEXT `SYNC_PING` after an idle interval (any inbound frame counts as
  life; default 25 s ping / 5 s pong deadline).
- The DO answers `SYNC_PONG` via `setWebSocketAutoResponse` — answered at the **runtime**
  level, never invoking the message handler and **never waking a hibernating DO** (the
  hibernation economics are untouched).
- A missed deadline ⇒ the client drops the socket into the normal warm-reconnect machinery.
  The "live" lie is bounded to ~30 s; a false-positive drop on a slow link costs one
  reconnect, never data.
- Skew-safe in both directions: an old worker ignores TEXT frames (no pong → warm reconnect,
  i.e. today's behavior); a new worker's pong to an old client is just ignored.

## REST resilience

Every REST call runs under a 15 s timeout (a black-holed request surfaces as an error, not an
infinite spinner). **GETs** (idempotent) transparently retry transient failures — network
throw, timeout, 502/503/504 — twice with jittered backoff; **mutations never retry** (a
re-sent POST that did reach the server is a double-write); retries are skipped while the
browser reports offline. Query-level retry is status-aware: 4xx product refusals fail fast.
Sentry hears only the final failure.

## Offline editing (as built)

CRDT edits to documents this browser has **already opened** work offline and replay on
reconnect. The line: *existing-doc CRDT edits offline; document-minting and REST-backed
actions live-gated* (see [`docs/concepts/collaboration.md`](../concepts/collaboration.md)
§ Offline for the product framing).

Mechanism:

1. **Local persistence behind the store's `DocConnection`** (`store/doc-storage.ts`):
   `{ bytes, pendingCount }` per docRef in IndexedDB. On open, a connection hydrates from
   IndexedDB **before** the network, then merges the server snapshot as usual. Writes are
   immediate for an undelivered change (reload-imminent durability), debounced on the live
   path. A **non-hydrated doc is never persisted** (a fast open→close must not clobber the
   good copy with an empty doc). No IndexedDB ⇒ online-only, gracefully.
2. **Replay = the reconnect resend, generalized from seconds to days.** Merge the server
   snapshot, diff, re-send what the server lacks — idempotent. `pendingCount` is advisory
   display state only; replay correctness never depends on it.
3. **The edit gate has four states:** `live` (socket up + caught up — never granted from
   local bytes alone), **`local`** (hydrated but unreachable — editable, visibly unsynced),
   `connecting`, and read-only. The store gates mutations on `live ∨ local`.
4. **Offline detection is belt-and-braces** (browsers under-signal): the `offline` event
   proactively drops sockets; a zombie-live socket is dropped at send time so an edit never
   vanishes as "delivered"; offline handshake failures never count toward the terminal
   give-up and retry with capped spacing; the heartbeat (above) covers the case no browser
   signal sees.
5. **Truth-telling UX:** a pending chip ("N changes saved on this device…") whenever
   undelivered changes exist; on terminal rejection (access revoked while offline) the
   content stays readable under a `role=alert` danger notice, and the screen is never
   unmounted while it holds pending changes. **Silent loss is the one forbidden outcome.**

**Offline app open:** launching the installed PWA with no network lands on the real choreo
list, not a spinner — the auth seam fails open to the last-known signed-in identity cached
on-device (every server boundary still enforces auth; a resolved signed-out verdict clears
the cache), and the choreo-list/`me` reads serve their last-good response from an on-device
cache **only when the failure happened offline** (an online server error always rethrows).

Long-offline clients ride the same machinery: locally persisted bytes migrate through the
schema ladder on hydrate; version skew is handled below.

## Version skew (rollout)

Worker + SPA deploy atomically, so the only cross-version peer is a **tab still running the
old bundle**. Each surface has an explicit mechanism:

- **Stale-tab reload, two layers** (`apps/web/src/main.tsx`): the SW-driven fast path
  (`lib/sw-update.ts` — re-checks `sw.js` on a 5-min timer / became-visible / back-online
  with a burst throttle, reloads when an updated service worker *takes control* — immediately
  while hidden or pre-interaction, else on the next visibility change, never mid-interaction)
  plus the **build-id fallback** (`lib/stale-bundle.ts` — commit SHA baked into both halves,
  compared against `/api/health` when a tab becomes visible; SW nudge first; reload-loop
  guard).
- **Sync wire:** version negotiated at the handshake (above).
- **Storage:** the DO persistence layout carries its own generation stamp
  ([`architecture.md`](architecture.md) § Persistence).
- **REST stays unversioned by decision:** the SPA is the only consumer and deploys with the
  worker; introduce `/api/v2/*` only if an independently-released client ever appears.

## Flicker & referential stability

The store returns **referentially stable** reads: each doc materializes once per Automerge
version (heads-keyed), unchanged subtrees keep their object identity (`store/reconcile.ts`),
reads latch to the live store once hydrated (never reverting to a staler snapshot on a
transient reconnect), and the figure editor waits for the figure's own live doc before
rendering. Together these stop open editors flickering on unrelated sync frames and prevent
stale-snapshot swaps from resetting in-flight edits — any new read path must preserve these
properties.
