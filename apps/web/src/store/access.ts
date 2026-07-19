// store/ seam (#178, FE-2). The browser-readable access preflight that lets the
// UI distinguish DENIED from offline before opening the heavy WS store. A browser
// WebSocket can't read the WS handshake's 401/403 (it only sees an abnormal 1006
// close, which looks like a transient disconnect), so a calm access-denied state
// is driven by this REST check. The fail-closed DO sync boundary (US-021) is still
// the real gate — this only informs which empty state to render.
import { useQuery } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { ApiError, apiGet } from "../lib/rpc";

/**
 * The viewer's access to a document: still checking, allowed (+role), denied —
 * or UNKNOWN (the check itself failed: offline / 5xx). Unknown is NOT a denial:
 * the screen proceeds optimistically (offline editing, §11.2, needs the locally
 * persisted doc to open with no network) and the fail-closed DO boundary stays
 * the real gate.
 */
export type DocAccess =
  | { state: "checking" }
  | { state: "allowed"; role: "owner" | "editor" | "commenter" | "viewer" }
  | { state: "denied" }
  | { state: "unknown" };

interface AccessResponse {
  role: "owner" | "editor" | "commenter" | "viewer";
}

/**
 * Resolve the viewer's access to `docRef`. A 403 is a NORMAL outcome (not a thrown
 * query error) — it means "denied", which the screen renders as the calm denied
 * state; only unexpected failures reject. Other failures (offline, 5xx) leave the
 * WS path to surface the offline state, so we don't pre-empt it as "denied".
 */
export function useDocAccess(docRef: string, opts: { enabled?: boolean } = {}): DocAccess {
  const { getToken } = useAppAuth();
  const enabled = opts.enabled ?? true;
  const q = useQuery({
    queryKey: ["access", docRef],
    enabled,
    // §11.2 offline app open: run the attempt even when react-query believes
    // the browser is offline — the failure resolves to "unknown" below, which
    // is what lets an offline launch reach the locally persisted doc instead
    // of pausing on "checking" forever.
    networkMode: "always",
    queryFn: async (): Promise<DocAccess> => {
      try {
        const { role } = await apiGet<AccessResponse>(
          `/api/docs/${encodeURIComponent(docRef)}/access`,
          await getToken(),
        );
        return { state: "allowed", role };
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) return { state: "denied" };
        throw err; // 401 / offline / 5xx — not a denial; let it surface elsewhere
      }
    },
    retry: false,
  });
  // A failed check (offline / 5xx) resolves to "unknown" rather than spinning on
  // "checking" forever — an offline reload must reach the locally-persisted doc
  // (§11.2). Never "denied": denial requires the server's explicit 403.
  if (q.isError) return { state: "unknown" };
  return q.data ?? { state: "checking" };
}
