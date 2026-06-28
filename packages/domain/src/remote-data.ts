// Three-state async result (the "RemoteData" pattern). A reference loaded over
// the network has THREE states, not two: we either don't know yet (pending),
// know it succeeded (success), or know it failed (error). Collapsing "don't know
// yet" into a failure/empty state is the root cause of spurious "unknown figure"
// flashes — so the seam models all three explicitly and lets callers branch.

export type RemoteData<T> =
  | { status: "pending" }
  | { status: "success"; value: T }
  | { status: "error"; error: unknown };

export const remotePending = <T>(): RemoteData<T> => ({ status: "pending" });
export const remoteSuccess = <T>(value: T): RemoteData<T> => ({ status: "success", value });
export const remoteError = <T>(error: unknown): RemoteData<T> => ({ status: "error", error });

/** Minimal slice of a TanStack Query result needed to derive `RemoteData`. */
export interface QueryStateLike<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
}

/**
 * Map a query result into `RemoteData`. Order matters: `data` is checked FIRST,
 * so when a query is configured with `placeholderData: keepPreviousData`, the
 * previous value is retained during a refetch and we stay in `success` instead
 * of flashing back to `pending`. This is what stops a re-load from briefly
 * re-rendering downstream references as unresolved.
 */
export function fromQueryState<T>(query: QueryStateLike<T>): RemoteData<T> {
  if (query.data !== undefined) return remoteSuccess(query.data);
  if (query.isError) return remoteError(query.error);
  return remotePending();
}
