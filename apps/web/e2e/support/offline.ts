import type { BrowserContext, WebSocketRoute } from "@playwright/test";

// The per-doc sync socket DocConnection opens (apps/web/src/store/doc-connection.ts):
//   `${wsBase}/api/docs/:id/connect`
const SYNC_WS = /\/api\/docs\/[^/]+\/connect(\?|$)/;

export interface OfflineControl {
  /** Drop the device offline (for the sync layer). */
  goOffline(): Promise<void>;
  /** Restore connectivity; the client reconnects on its own schedule. */
  goOnline(): Promise<void>;
}

/**
 * Cross-browser "device offline" control for a context's sync layer.
 *
 * Chromium (desktop + mobile-chrome): the faithful path — real
 * `context.setOffline`, so an offline reload is served by the SW precache and
 * `navigator.onLine` flips too.
 *
 * WebKit (mobile-safari): `context.setOffline(true)` followed by ANY navigation
 * throws "WebKit encountered an internal error" — a reproduced Playwright/WebKit
 * limitation (offline navigation is impossible there, even when a service worker
 * would serve the page wholly from cache). So we isolate ONLY the sync
 * WebSocket via `routeWebSocket`: offline drops the socket and refuses
 * reconnects, which is exactly what the CRDT-resend + IndexedDB-persistence +
 * convergence journey exercises. The reload then navigates over a live network
 * (WebKit-safe), yet the edit can still only have come from IndexedDB — the
 * server never received it while the socket was down — so the persistence claim
 * holds. `navigator.onLine` stays true, which this journey never asserts on (its
 * truth-telling is the WS-driven `pending-sync` indicator, not the onLine
 * banner). Tests that DO assert the SW serves the shell offline (offline app
 * launch, the offline banner) can't run on WebKit at all and stay excluded.
 *
 * Install BEFORE the context's first doc connection so that socket is routed
 * (proxied) and can be dropped later.
 */
export async function installOfflineControl(
  context: BrowserContext,
  isWebKit: boolean,
): Promise<OfflineControl> {
  if (!isWebKit) {
    return {
      goOffline: () => context.setOffline(true),
      goOnline: () => context.setOffline(false),
    };
  }

  let online = true;
  let active: WebSocketRoute | null = null;
  await context.routeWebSocket(SYNC_WS, (ws) => {
    if (!online) {
      // Refuse the connection — the client sees a closed socket and enters its
      // warm-reconnect/pending machinery, the WebKit stand-in for "no network".
      ws.close();
      return;
    }
    // Online: transparently proxy to the real worker (messages forwarded both
    // ways by default), so sync behaves exactly as a direct connection.
    active = ws;
    ws.connectToServer();
  });

  return {
    goOffline: async () => {
      online = false;
      active?.close();
      active = null;
    },
    goOnline: async () => {
      online = true;
    },
  };
}
