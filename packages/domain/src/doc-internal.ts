// US-005 — shared Automerge plumbing for the document builders/readers.
//
// Core `@automerge/automerge` (no automerge-repo — the M0.5 spike showed core +
// a thin sync is enough; SPIKE-FINDINGS §4). `from()` seeds a doc from a POJO;
// `change()` mutates inside a transaction; `save`/`load` round-trip bytes. The
// readers materialize a plain, mutable deep copy (Automerge docs are frozen) and
// drop tombstoned entities unless asked to include them.
import * as A from "@automerge/automerge";
import type { ReadOptions } from "./doc-types";
import { isPlainRecord } from "./guards";

/**
 * Recursively drop `undefined`-valued keys, IN PLACE. Automerge cannot store
 * `undefined` (it throws "Cannot assign undefined value …"); our logical shapes
 * carry optional fields that are often `undefined` (e.g. an absent `counts`).
 * Stripping them mirrors JSON semantics: an absent optional simply isn't set,
 * and reads return `undefined` for it just the same. `null` is preserved (a
 * tombstone like `deletedAt: null` is a meaningful CRDT value).
 *
 * Mutating a fresh clone (rather than rebuilding a copy) is what keeps this
 * honestly typed: deleting `undefined`-valued keys from a `T` leaves a `T`
 * (those keys are the optional ones), so no return-type claim is needed.
 */
function stripUndefinedInPlace(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) stripUndefinedInPlace(v);
    return;
  }
  if (isPlainRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) delete value[k];
      else stripUndefinedInPlace(v);
    }
  }
}

/** Build an in-memory Automerge doc from a plain logical shape. */
export function buildDoc<T extends Record<string, unknown>>(initial: T): A.Doc<T> {
  // Deep-clone (so a frozen fixture is never adopted by reference) and drop
  // undefined-valued optionals, which Automerge refuses to store. The doc-shape
  // aliases in doc-types.ts satisfy `A.from`'s Record constraint directly (they
  // are type aliases, not interfaces — see that file's header), so this needs
  // no casts anywhere.
  const seed = structuredClone(initial);
  stripUndefinedInPlace(seed);
  return A.from(seed);
}

/** A plain, mutable, detached copy of an Automerge doc's current value. */
export function materialize<T>(doc: A.Doc<T>): T {
  // `A.toJS` already returns a fully detached, non-frozen, deeply-mutable POJO
  // (verified: mutating it does not touch the doc), so no extra clone is needed.
  return A.toJS(doc);
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
