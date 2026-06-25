// M0.5 spike — exercises the SQLite-backed Durable Object hosting an Automerge
// doc, against the REAL workerd + DO + SQLite runtime via vitest-pool-workers.
import { env, runInDurableObject } from "cloudflare:test";
import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import type { RoutineDO } from "./routine-do";

// biome-ignore lint: spike test types
const NS = () => (env as any).ROUTINE_DO as DurableObjectNamespace<RoutineDO>;
const EDITOR = "editor-user";
const VIEWER = "viewer-user";

function stub(name: string) {
  return NS().get(NS().idFromName(name));
}

describe("S1 — storage adapter (DO SQLite) + rehydration", () => {
  it("persists Automerge state to DO SQLite and reads it back", async () => {
    const s = stub("s1-routine");
    await s.addSection(EDITOR, "sec-1", "Long Side");
    await s.addSection(EDITOR, "sec-2", "Corner");

    // Read back through a fresh load-from-SQL path.
    const state = await s.getState();
    expect(state.sections?.map((x) => x.name)).toEqual(["Long Side", "Corner"]);

    // White-box: confirm the bytes are actually in the DO's SQLite, and that a
    // load() purely from storage (the cold-start path) reconstructs the doc.
    await runInDurableObject(s, async (_instance, ctx) => {
      const rows = [...ctx.storage.sql.exec("SELECT snapshot FROM doc WHERE id = 0")];
      expect(rows.length).toBe(1);
      const snapshot = rows[0].snapshot as ArrayBuffer;
      const reloaded = A.load<{ sections: { name: string }[] }>(new Uint8Array(snapshot));
      expect(reloaded.sections.map((x) => x.name)).toEqual(["Long Side", "Corner"]);
    });
  });
});

describe("S2 — two clients converge through the DO", () => {
  it("merges concurrent edits from two clients", async () => {
    const s = stub("s2-routine");
    await s.addSection(EDITOR, "base", "Base");

    // Two clients each pull the current doc, edit concurrently (offline), push.
    const snapshot = new Uint8Array(await s.exportBinary());
    let client1 = A.load<{ sections: { id: string; name: string }[] }>(snapshot);
    let client2 = A.load<{ sections: { id: string; name: string }[] }>(snapshot);

    client1 = A.change(client1, (d) => d.sections.push({ id: "c1", name: "FromClient1" }));
    client2 = A.change(client2, (d) => d.sections.push({ id: "c2", name: "FromClient2" }));

    const buf1 = A.save(client1);
    const buf2 = A.save(client2);
    await s.mergeBinary(EDITOR, buf1.buffer.slice(buf1.byteOffset, buf1.byteOffset + buf1.byteLength));
    await s.mergeBinary(EDITOR, buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength));

    const state = await s.getState();
    const names = state.sections?.map((x) => x.name).sort();
    expect(names).toEqual(["Base", "FromClient1", "FromClient2"]); // both survived
  });
});

describe("S3 — permission boundary", () => {
  it("rejects a viewer and a non-member, accepts an editor", async () => {
    const s = stub("s3-routine");
    await expect(s.addSection(VIEWER, "x", "nope")).rejects.toThrow(/permission-denied/);
    await expect(s.addSection("stranger", "x", "nope")).rejects.toThrow(/permission-denied/);
    await s.addSection(EDITOR, "ok", "yes"); // editor succeeds
    const state = await s.getState();
    expect(state.sections?.map((x) => x.name)).toEqual(["yes"]);
  });
});

describe("S4 — partition convergence + idempotence (Automerge core)", () => {
  it("diverged replicas converge after exchanging changes, regardless of order", () => {
    type Doc = { items: string[] };
    let base = A.change(A.init<Doc>(), (d) => {
      d.items = ["root"];
    });
    let a = A.clone(base);
    let b = A.clone(base);
    a = A.change(a, (d) => d.items.push("a1"));
    b = A.change(b, (d) => d.items.push("b1"));

    const aThenB = A.merge(A.clone(a), b);
    const bThenA = A.merge(A.clone(b), a);
    expect([...aThenB.items].sort()).toEqual(["a1", "b1", "root"]);
    // commutative: same result whichever order we merge
    expect([...aThenB.items].sort()).toEqual([...bThenA.items].sort());

    // idempotent: merging the same change twice changes nothing
    const once = A.merge(A.clone(a), b);
    const twice = A.merge(once, b);
    expect([...twice.items].sort()).toEqual([...once.items].sort());
  });
});

describe("S5 — multi-doc references + variant overlay (the figure graph)", () => {
  it("a routine DO references a separate figure DO; a variant inherits base additions", async () => {
    // Two independent documents in two independent DOs.
    const figure = stub("figure-feather-foxtrot");
    await figure.addAttribute(EDITOR, "a1", "step", 1, "RF fwd");
    await figure.addAttribute(EDITOR, "a2", "sway", 2, "to_R");

    const routine = stub("routine-1");
    // The routine references the figure by name/id (placement).
    await routine.addSection(EDITOR, "sec", "Opening:figure-feather-foxtrot");

    const figState = await figure.getState();
    expect(figState.attributes?.length).toBe(2);
    const routState = await routine.getState();
    expect(routState.sections?.[0].name).toContain("figure-feather-foxtrot");

    // Variant overlay resolution (pure domain logic the spike validates on real
    // persisted base data): base attrs - tombstones + overrides + additions.
    type Attr = { id: string; kind: string; count: number; value: string };
    const base = (figState.attributes ?? []) as Attr[];
    const overlay = {
      tombstones: new Set<string>(["a2"]), // variant drops the sway
      overrides: new Map<string, Partial<Attr>>([["a1", { value: "LF fwd" }]]),
      additions: [{ id: "v1", kind: "turn", count: 1, value: "quarter_R" }] as Attr[],
    };
    const resolve = (b: Attr[]) => [
      ...b.filter((x) => !overlay.tombstones.has(x.id)).map((x) => ({ ...x, ...overlay.overrides.get(x.id) })),
      ...overlay.additions,
    ];

    const before = resolve(base);
    expect(before.map((x) => x.id).sort()).toEqual(["a1", "v1"]); // a2 dropped
    expect(before.find((x) => x.id === "a1")?.value).toBe("LF fwd"); // override wins

    // Base gets a NEW attribute later → it must FLOW UP into the variant.
    await figure.addAttribute(EDITOR, "a3", "rise", 3, "up");
    const baseAfter = ((await figure.getState()).attributes ?? []) as Attr[];
    const after = resolve(baseAfter);
    expect(after.map((x) => x.id).sort()).toEqual(["a1", "a3", "v1"]); // a3 flowed up
  });
});
