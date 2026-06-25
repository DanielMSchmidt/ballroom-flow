// US-005 — shared Automerge plumbing for the document builders/readers.
//
// Core `@automerge/automerge` (no automerge-repo — the M0.5 spike showed core +
// a thin sync is enough; SPIKE-FINDINGS §4). `from()` seeds a doc from a POJO;
// `change()` mutates inside a transaction; `save`/`load` round-trip bytes. The
// readers materialize a plain, mutable deep copy (Automerge docs are frozen) and
// drop tombstoned entities unless asked to include them.
import * as A from "@automerge/automerge";
import type { ReadOptions } from "./doc-types";

/**
 * Recursively drop `undefined`-valued keys. Automerge cannot store `undefined`
 * (it throws "Cannot assign undefined value …"); our logical shapes carry
 * optional fields that are often `undefined` (e.g. an absent `entryAlignment`).
 * Stripping them mirrors JSON semantics: an absent optional simply isn't set,
 * and reads return `undefined` for it just the same. `null` is preserved (a
 * tombstone like `deletedAt: null` is a meaningful CRDT value).
 */
function stripUndefined<V>(value: V): V {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as V;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as V;
  }
  return value;
}

/** Build an in-memory Automerge doc from a plain logical shape. */
export function buildDoc<T extends Record<string, unknown>>(initial: T): A.Doc<T> {
  // Deep-clone (so a frozen fixture is never adopted by reference) and drop
  // undefined-valued optionals, which Automerge refuses to store.
  return A.from(stripUndefined(structuredClone(initial)));
}

/** A plain, mutable, detached copy of an Automerge doc's current value. */
export function materialize<T>(doc: A.Doc<T>): T {
  // `A.toJS` already returns a fully detached, non-frozen, deeply-mutable POJO
  // (verified: mutating it does not touch the doc), so no extra clone is needed.
  return A.toJS(doc) as T;
}

/** True when an entity is soft-deleted (a truthy `deletedAt` tombstone). */
export function isDeleted(entity: { deletedAt?: number | null }): boolean {
  return entity.deletedAt != null;
}

/** Keep only live entities unless the read opts in to tombstones. */
export function filterDeleted<E extends { deletedAt?: number | null }>(
  entities: E[],
  opts?: ReadOptions,
): E[] {
  if (opts?.includeDeleted) return entities;
  return entities.filter((e) => !isDeleted(e));
}

/** Apply a mutation transaction to a doc, returning the new immutable doc. */
export function mutate<T>(doc: A.Doc<T>, fn: (draft: T) => void): A.Doc<T> {
  return A.change(doc, fn);
}
