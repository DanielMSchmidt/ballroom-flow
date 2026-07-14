---
title: WS heartbeat — detect half-open ("zombie") sync sockets
wep: 0006
owning-areas: [web, worker, contract]
status: implemented
authors: ["@danielmschmidt"]
approver: owner
created: 2026-07-13
last-updated: 2026-07-13
see-also: ["PLAN §8 D10 (sync wire)", "PLAN §11.2 (offline editing)", "PLAN §7 Connectivity"]
replaces: null
superseded-by: null
---

# WEP-0006: WS heartbeat — detect half-open ("zombie") sync sockets

## Summary

The per-document sync socket gains an application-level heartbeat: the client sends a
tiny TEXT ping while the connection is idle, and the Durable Object answers it with a
runtime-level **auto-response pong** (`setWebSocketAutoResponse`) that works even while
the DO **hibernates — the DO is never woken**. A socket that misses its pong deadline is
declared a zombie: the client drops it and rides the existing warm-reconnect machinery
(backoff → fresh snapshot catch-up → #161 resend), so a silently dead connection heals
in seconds instead of whenever the browser's TCP stack happens to notice.

What becomes true that isn't today: the `live` indicator can no longer lie for minutes on
a connection the network has silently killed, and live convergence resumes within one
heartbeat window instead of at the OS's mercy.

## Motivation

Today a half-open socket — TCP believes the connection is up, but nothing is actually
delivered — is detected only by two heuristics that both miss the common case:

- the `offline` event / `navigator.onLine` probe (§11.2 zombie guard in `sendLocal`),
  which only fires when the **browser itself** knows it's offline;
- the browser's own `close` event, which on a half-open TCP connection can take tens of
  seconds to minutes (OS keepalive territory).

### Goals

- Bound the time a dead-but-open socket can impersonate a live one to
  `intervalMs + deadlineMs` (default 25 s + 5 s).
- Zero Durable Object wake-ups and zero DO compute for heartbeats (hibernation economics
  of D23/D10 unchanged).
- No new client-visible states, no change to the edit gate, no change to replay
  correctness (which never depended on liveness detection — #161).
- Wire-compatible with a skewed old peer in both directions.

### Non-Goals

- Server-side detection of dead clients (the DO's economics don't suffer from a dead
  client socket; the runtime reaps them).
- Latency measurement / RTT telemetry over the ping.
- Changing the reconnect policy itself (backoff, cold caps — untouched).
- A general typed TEXT-frame envelope (#117 stays future work).

## Proposal

**Named scenario — the practice-room dead spot.** A coach's tablet is on studio Wi-Fi
when the access point reboots. The interface stays associated, so `navigator.onLine`
stays `true` and no `offline` event ever fires; the established WebSocket becomes a
half-open zombie. Today: the coach keeps editing — sends vanish into the dead pipe while
the UI reads **live** and `pendingCount` stays 0 (the socket "accepted" every send); the
partner's edits stop arriving with no indication; this persists until the OS finally
times out the TCP connection (often minutes). The edits themselves are eventually
recovered — the next real reconnect's snapshot diff resends them (#161) — but live
collaboration is silently broken and the status indicator is lying the whole time.

With this WEP: after ≤25 s of idle the client pings; no pong within 5 s ⇒ the client
drops the socket exactly the way the §11.2 zombie guard does (null the handle so the
eventual stale close event is ignored, then drive `onSocketClosed()`), which flips the
UI to the honest `connecting`/`local` state and arms the warm-reconnect backoff. When
the AP is back, the reconnect hydrates a fresh snapshot and resends the locally-ahead
delta. The lie is bounded at ~30 s, and recovery is automatic.

**Risks / mitigations:**

- *A slow-but-alive connection gets dropped* (pong later than deadline): the drop is a
  warm drop — reconnect is immediate-ish (1 s first delay) and merges/resends losslessly,
  so the cost is a reconnect, never data. Any inbound frame (not just the pong) counts as
  proof of life, so a busy connection is never pinged at all.
- *Battery/radio*: one tiny TEXT frame per 25 s per open doc socket, only while a doc is
  open and idle. The read path (D10) already keeps viewer socket counts at 0–1.
- *Old worker during rollout skew*: `webSocketMessage` already ignores TEXT frames, so a
  new client pinging an old DO simply gets no pong and warm-reconnects — onto the same
  old DO, repeatedly, until the stale-bundle nudge reloads the tab. Accepted: skew spans
  only tabs open across a deploy (atomic worker+SPA deploy, §7), the loop is cheap
  (1 doc-socket reconnect per ~30 s), and behavior degrades to today's status quo, not
  below it.

## Design Details

- **Contract** (`packages/contract`): two TEXT markers in the style of
  `SYNC_CAUGHT_UP` — `SYNC_PING = "ballroom:sync:ping"` (client→server) and
  `SYNC_PONG = "ballroom:sync:pong"` (server→client). The D10 asymmetry note is
  amended: client→server frames are raw Automerge change bytes **or the ping TEXT
  marker**; TEXT vs BINARY keeps the decoders unambiguous, and the DO's TEXT-ignore
  guard means the ping is safe against any server version that has ever shipped.
- **Worker** (`apps/worker/src/doc-do.ts`): one line in the constructor —
  `this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(SYNC_PING, SYNC_PONG))`.
  The runtime answers pings for **all** accepted sockets of the DO without invoking
  `webSocketMessage` and **without waking a hibernating DO** (the platform feature is
  designed for exactly this). No permission surface: the pong echoes a constant to an
  already-authenticated socket; a pre-upgrade or role-revoked socket is closed by the
  existing machinery regardless.
- **Web** (`apps/web/src/store/doc-connection.ts`): a heartbeat owned by
  `DocConnection`, injectable-timer-driven like the reconnect machinery:
  - armed on socket `open`; every `intervalMs` of **idle** (any inbound frame re-arms
    the idle timer and clears the pong deadline) it sends `SYNC_PING` and arms a
    `deadlineMs` timer;
  - deadline fires ⇒ zombie: null the socket handle (the eventual real `close` event is
    already stale-guarded), `close()` it best-effort, and call `onSocketClosed()` — the
    warm-drop path (state → `local`/`connecting`, backoff reconnect, snapshot+resend on
    re-open). No new states, no edit-gate change.
  - `SocketLike.send` widens to accept `string` (the ping frame); `receive()` treats
    `SYNC_PONG` as pure liveness.
  - Options: `heartbeat?: { intervalMs; deadlineMs } | false` (default 25 000 / 5 000;
    `false` for online-only unit tests that advance timers far). The E2E build shortens
    the numbers so every journey continuously exercises real ping→pong delivery.
- **No storage, D1, schema, or permission changes.** No migration: the feature is
  per-connection and stateless.

## Test Plan

TDD, unskip-first order (all written and failing before implementation):

- **Worker/DO** (`apps/worker/src/doc-do.test.ts`): the DO registers the ping→pong
  auto-response pair (asserted via a debug hook reading
  `ctx.getWebSocketAutoResponse()` — vitest-pool-workers cannot drive a full WS
  delivery cycle, SPIKE sharp-edge #3; real delivery is owned by the E2E layer, where
  the shortened heartbeat makes every journey exercise it continuously).
- **Web store** (`apps/web/src/store/doc-connection.test.ts`, fake timers): ping sent
  after `intervalMs` idle; any inbound frame counts as life and defers the ping; a pong
  within the deadline keeps the socket; a missed deadline drops the socket and schedules
  the warm reconnect (fresh socket after backoff, re-hydrates to `live`); with §11.2
  persistence the drop lands in `local` and an edit made in the gap replays on
  reconnect; `heartbeat: false` sends no pings; `close()` cancels all heartbeat timers.
- **E2E** — the ship gate below.

Coverage: `apps/web` has no armed threshold; the new `doc-connection.ts` branches are
fully unit-covered. Worker coverage impact is one constructor line + one debug hook.

## Ship Gate

`apps/web/e2e/zombie-socket.spec.ts` (@smoke, chromium): open a routine live → an
E2E-only socket seam turns the live socket into a zombie (sends swallowed, no events
delivered, **no close event** — `navigator.onLine` stays true, exactly the practice-room
dead spot) → an edit made against the zombie → within the (E2E-shortened) heartbeat
window the client detects the dead socket, reconnects, and the edit is durably synced
(visible after a reload). Green on the implementing PR before this WEP is marked
`implemented`; PLAN §8 D10 + §7 and TEST-MAP updated in the same change.

## Drawbacks

- A second liveness mechanism beside the `navigator.onLine` guards — more timers in
  `DocConnection` (mitigated: same injectable-timer pattern, fully unit-tested).
- Idle traffic: one TEXT frame per open doc socket per 25 s (radio cost on mobile;
  bounded by D10's socket-count design).
- The E2E seam adds a small amount of E2E-only code to the socket factory path.
- A false-positive drop on a very slow link costs a reconnect cycle (never data).

## Alternatives

- **Status quo (browser close event + `navigator.onLine` guards).** Fails the
  practice-room dead spot outright: `onLine` stays true, the close event is minutes
  away. This gap was called out when §11.2 shipped; this WEP closes it.
- **WebSocket protocol-level ping/pong (RFC 6455 control frames).** Browsers do not
  expose protocol pings to JavaScript in either direction — a client can neither send
  one nor observe one. Dead on arrival client-side.
- **Server-initiated heartbeat (DO pings clients).** Requires the DO to run a timer —
  an alarm or interval that wakes it every cycle for every idle document, destroying
  the Hibernatable-WebSockets economics (D23) that keep thousands of idle doc DOs
  free. Client-initiated + runtime auto-response costs zero DO compute.
- **Reusing an existing frame as the probe (e.g. re-sending SYNC_CAUGHT_UP or an empty
  change).** Overloads frames that have meanings and handlers on both ends;
  `setWebSocketAutoResponse` takes a dedicated request/response string pair, which is
  the platform primitive built for this. A binary probe is not supported by the
  auto-response API at all.
- **Counting on TanStack Query polling / REST health checks to infer liveness.** The
  REST path and the WS path fail independently (a dead AP kills both, but a dead DO
  socket with a healthy edge does not affect REST); inferring one from the other
  produces both false positives and false negatives against the named scenario.
