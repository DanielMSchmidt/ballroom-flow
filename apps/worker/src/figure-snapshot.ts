import type { FigureDoc } from "@weavesteps/domain";
import type { DocDO } from "./doc-do";

/**
 * Read a figure DO's snapshot across the RPC boundary, degrading a failed read to
 * `null` (the caller renders the figure missing) rather than aborting the request.
 *
 * Why the wrapper: the DO stub's `Rpc.Result<FigureDoc>` collapses to `never` because
 * `Attribute.value` is deliberately typed `unknown` (D7 forward-compat — an unknown
 * value must survive a round-trip) and Cloudflare's `Serializable<T>` can't prove
 * `unknown` is structured-cloneable, though at runtime it always is. Declaring the
 * true return type ONCE here recovers `FigureDoc | null` for every call site with no
 * per-call cast — the return value is a subtype of the declared type, so it widens
 * cleanly without an assertion. Shared by the snapshot fan-out (index.ts) and the
 * fork copy-out (fork.ts) so neither re-asserts the shape.
 */
export function readFigureSnapshot(stub: DurableObjectStub<DocDO>): Promise<FigureDoc | null> {
  return stub.getFigureSnapshot().catch(() => null);
}
