// Minimal deep-link router (#179, pulled forward by #191). The app had only a
// useState nav seam, so a routine was lost on refresh and URLs like
// /routines/:id or /invite/:token couldn't be opened — which also made the E2E
// journeys (they navigate by URL) impossible. This is a tiny pushState router:
// no dependency, just the subset of routes v1 needs. A fuller router can replace
// it later behind the same `useRoute`/`navigate` surface.
import { useSyncExternalStore } from "react";

/** The parsed current route. */
export type Route =
  | { name: "home" }
  | { name: "routine"; id: string }
  | { name: "invite"; token: string };

/** Parse a pathname into a Route. Unknown paths fall back to home. */
export function parsePath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  const routine = path.match(/^\/routines\/([^/]+)$/);
  if (routine?.[1]) return { name: "routine", id: decodeURIComponent(routine[1]) };
  const invite = path.match(/^\/invite\/([^/]+)$/);
  if (invite?.[1]) return { name: "invite", token: decodeURIComponent(invite[1]) };
  return { name: "home" };
}

/** Build the path for a Route (the inverse of parsePath). */
export function pathFor(route: Route): string {
  switch (route.name) {
    case "routine":
      return `/routines/${encodeURIComponent(route.id)}`;
    case "invite":
      return `/invite/${encodeURIComponent(route.token)}`;
    default:
      return "/";
  }
}

/** Navigate to a path (pushState) and notify subscribers without a full reload. */
export function navigate(path: string): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname !== path) {
    window.history.pushState(null, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function getSnapshot(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

/** Reactive current route — re-renders on back/forward and `navigate`. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getSnapshot, () => "/");
  return parsePath(pathname);
}
