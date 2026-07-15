// US-001 — ULID id generation (docs/system/architecture.md § Global constraints, D15).
//
// Every entity id in the document graph is a client-generated ULID: a 26-char
// Crockford-base32 string whose 48-bit time prefix makes ids sort
// lexicographically by creation order, while the 80-bit random suffix keeps two
// offline clients from colliding in practice. No server round-trip is required.
//
// We use `monotonicFactory` (not the bare `ulid`) so that ids minted within the
// same millisecond still increase strictly: the factory increments the random
// component instead of re-rolling it, preserving lexicographic ordering even in
// a tight loop. A single module-level factory backs `newId` so all ids from
// this process share one monotonic sequence.
import { monotonicFactory } from "ulidx";

const nextUlid = monotonicFactory();

/** Mint a new client-generated, monotonically-sortable ULID. */
export function newId(): string {
  return nextUlid();
}
