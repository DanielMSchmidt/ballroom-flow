// ─────────────────────────────────────────────────────────────────────────
// Typed structural surface for the NOT-YET-BUILT per-document Durable Object
// (doc-do.ts, M2 §9). The DO's RPC/test-hook methods don't exist yet; typing
// them here lets the skipped DO suites compile WITHOUT `any` (Biome forbids it)
// and doubles as the M2 DO contract. RED→GREEN: implement these on the DO.
//
// Each method maps to a US-014/015/016 acceptance criterion. `*ForTest` /
// `debug*` are test-only hooks the DO exposes so a vitest-pool-workers test can
// drive the alarm / inspect persistence deterministically (no real timer).
// ─────────────────────────────────────────────────────────────────────────

export interface SectionSnapshot {
  name: string;
}
export interface DocSnapshot {
  sections?: SectionSnapshot[];
  [k: string]: unknown;
}

/** The DO's stub surface the tests call (a subset of the M2 doc-do RPC API). */
export interface DocStub {
  /** Apply a high-level mutation, returning the captured change bytes. */
  applyChange(op: Record<string, unknown>): Promise<Uint8Array>;
  /** Apply raw Automerge change bytes (used for the duplicate-delivery test). */
  applyRawChange(change: Uint8Array): Promise<void>;
  /** Resolve + return the current doc snapshot (POJO view). */
  getSnapshot(): Promise<DocSnapshot>;
  /** Figure-shaped read-only snapshot (read/edit split); null if never seeded. */
  getFigureSnapshot(): Promise<DocSnapshot | null>;
  /** Server-seed a never-before-used doc's initial content at create (#205); no-clobber. */
  seedDoc(content: Record<string, unknown>): Promise<void>;
  /** Set the D1-projected metadata (title/dance/owner/figureType). */
  setMetadata(meta: Record<string, unknown>): Promise<void>;
  /** Test hook: the exact BINARY catch-up frames a connect would send — post-D10,
   *  exactly one tagged snapshot frame for a seeded doc (or none if unseeded). */
  catchUpFramesForTest(): Promise<Uint8Array[]>;
  /** Test hook: drop the in-memory doc + re-run cold-load (simulates eviction). */
  reloadForTest(): Promise<void>;
  /** Test hook: number of rows in the SQLite change log (incremental-persist assertions). */
  debugChangeRowCount(): Promise<number>;
  /** Test hook: run the alarm body synchronously. */
  runAlarmForTest(): Promise<void>;
  /** Test hook: bytes currently persisted (for compaction assertions). */
  debugPersistedSize(): Promise<number>;
  /** HTTP/WS entrypoint (for the WS-upgrade convergence tests). */
  fetch(request: Request): Promise<Response>;
}

/** Structural DO namespace (avoids depending on the M2 binding's concrete type). */
export interface DocNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DocStub;
}
