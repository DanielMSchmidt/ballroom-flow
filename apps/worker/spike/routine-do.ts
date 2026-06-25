// THROWAWAY SPIKE (M0.5) — proves the automerge-on-Cloudflare foundation.
// Not production code. See docs/spike/SPIKE-FINDINGS.md.
//
// A SQLite-backed Durable Object that hosts one Automerge document and persists
// it in the DO's own SQLite. To prove persistence robustly the spike loads the
// doc from SQLite on every op (production would keep it in memory + append an
// incremental change log — noted in findings).

import { DurableObject } from "cloudflare:workers";
import * as A from "@automerge/automerge";

export type SpikeEnv = Record<string, never>;

// The shape we actually care about: a routine doc (sections -> figures) or a
// figure doc (attributes). Kept loose for the spike.
type SpikeDoc = {
  kind?: "routine" | "figure";
  sections?: { id: string; name: string }[];
  attributes?: { id: string; kind: string; count: number; value: string }[];
};

export class RoutineDO extends DurableObject<SpikeEnv> {
  private sql: SqlStorage;
  // Permission stub: in production this is a D1 membership lookup keyed on the
  // verified Clerk sub. Here we seed an allow-list to exercise the boundary.
  private members = new Map<string, "editor" | "viewer">();

  constructor(ctx: DurableObjectState, env: SpikeEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS doc (id INTEGER PRIMARY KEY, snapshot BLOB NOT NULL)",
    );
    this.members.set("editor-user", "editor");
    this.members.set("viewer-user", "viewer");
  }

  private load(): A.Doc<SpikeDoc> {
    const rows = [...this.sql.exec<{ snapshot: ArrayBuffer }>("SELECT snapshot FROM doc WHERE id = 0")];
    if (rows.length > 0) return A.load<SpikeDoc>(new Uint8Array(rows[0].snapshot));
    return A.init<SpikeDoc>();
  }

  private save(doc: A.Doc<SpikeDoc>): void {
    const bytes = A.save(doc); // Uint8Array
    // SqlStorage BLOB binding accepts ArrayBuffer.
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    this.sql.exec("INSERT OR REPLACE INTO doc (id, snapshot) VALUES (0, ?)", buf);
  }

  private assertEditor(userId: string): void {
    if (this.members.get(userId) !== "editor") {
      throw new Error(`permission-denied: ${userId} is not an editor`);
    }
  }

  // --- RPC surface (the "network adapter" would carry these as Automerge sync
  //     messages; here we expose typed ops to keep the spike focused). ---

  async addSection(userId: string, id: string, name: string): Promise<SpikeDoc> {
    this.assertEditor(userId);
    let doc = this.load();
    doc = A.change(doc, (d) => {
      d.kind = "routine";
      d.sections ??= [];
      d.sections.push({ id, name });
    });
    this.save(doc);
    return structuredCloneDoc(doc);
  }

  async addAttribute(userId: string, id: string, kind: string, count: number, value: string): Promise<SpikeDoc> {
    this.assertEditor(userId);
    let doc = this.load();
    doc = A.change(doc, (d) => {
      d.kind = "figure";
      d.attributes ??= [];
      d.attributes.push({ id, kind, count, value });
    });
    this.save(doc);
    return structuredCloneDoc(doc);
  }

  // Exchange raw Automerge bytes — this is what a real sync connection moves.
  async exportBinary(): Promise<ArrayBuffer> {
    const bytes = A.save(this.load());
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async mergeBinary(userId: string, incoming: ArrayBuffer): Promise<SpikeDoc> {
    this.assertEditor(userId);
    const local = this.load();
    const remote = A.load<SpikeDoc>(new Uint8Array(incoming));
    const merged = A.merge(local, remote);
    this.save(merged);
    return structuredCloneDoc(merged);
  }

  async getState(): Promise<SpikeDoc> {
    return structuredCloneDoc(this.load());
  }
}

// Automerge docs are frozen proxies; return a plain clone over the RPC boundary.
function structuredCloneDoc(doc: A.Doc<SpikeDoc>): SpikeDoc {
  return JSON.parse(JSON.stringify(doc)) as SpikeDoc;
}
