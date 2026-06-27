import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as A from "@automerge/automerge";
import { SYNC_CAUGHT_UP } from "@ballroom/contract";
import type { FigureDoc, RegistryKind, RoutineDoc } from "@ballroom/domain";
import { buildFigureDoc, buildRoutineDoc } from "@ballroom/domain";
import { describe, expect, it, vi } from "vitest";
import { type OpenOptions, openRoutine } from "./routine";

// ─────────────────────────────────────────────────────────────────────────
// US-017 — store/ seam (multi-doc) [M2, system]
// PLAN §6.1/§6.2, D6, §10.2: the typed store seam wraps Automerge: opening a
// routine connects to the routine doc's DO then to each referenced figure
// doc's DO; resolves variant overlays client-side; exposes typed reactive reads
// + mutations + history-based undo. Components import ONLY from store/.
//
// The store wraps the WS sync via an injectable SocketFactory — these tests
// drive a FAKE socket (jsdom has no WS server) and feed it the change frames a
// DO would replay, so the seam's multi-doc load + overlay resolve + reactive
// reads/undo are exercised for real. (Live multi-doc sync over real DOs is the
// worker doc-do.test.ts + the #116 wrangler-dev smoke.)
// ─────────────────────────────────────────────────────────────────────────

/** A fake socket the test can push frames into (stands in for the DO). */
class FakeSocket {
  binaryType = "blob";
  private msg: ((ev: { data: unknown }) => void) | null = null;
  private open: (() => void) | null = null;
  private closed: (() => void) | null = null;
  sent: Uint8Array[] = [];
  addEventListener(type: string, fn: (ev: { data: unknown }) => void): void {
    if (type === "message") this.msg = fn;
    else if (type === "open") this.open = fn as () => void;
    else if (type === "close") this.closed = fn as () => void;
  }
  send(data: ArrayBufferView | ArrayBuffer): void {
    this.sent.push(new Uint8Array(data as ArrayBuffer));
  }
  close(): void {
    this.closed?.();
  }
  /** Signal the socket is open (the runtime fires this; the DO then replays). */
  fireOpen(): void {
    this.open?.();
  }
  /** Deliver the DO's catch-up-complete marker — the doc is now hydrated (#202). */
  fireCaughtUp(): void {
    this.msg?.({ data: SYNC_CAUGHT_UP });
  }
  /** Replay a doc's FULL history to the client (what the DO does on connect). */
  load(doc: A.Doc<unknown>): void {
    for (const c of A.getAllChanges(doc)) {
      const u = c as Uint8Array;
      this.msg?.({ data: u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) });
    }
  }
}

/** Build OpenOptions whose socket factory hands back a FakeSocket per docId. */
function fakeWiring(): { opts: OpenOptions; sockets: Map<string, FakeSocket> } {
  const sockets = new Map<string, FakeSocket>();
  const opts: OpenOptions = {
    baseUrl: "http://test",
    openSocket: (url) => {
      const id = decodeURIComponent(url.split("/docs/")[1]?.replace("/connect", "") ?? url);
      const s = new FakeSocket();
      sockets.set(id, s);
      return s as unknown as ReturnType<NonNullable<OpenOptions["openSocket"]>>;
    },
  };
  return { opts, sockets };
}

const aFigure = (over: Partial<FigureDoc>): RoutineDoc | FigureDoc =>
  ({
    id: "f",
    scope: "global",
    ownerId: "u",
    figureType: "natural_turn",
    dance: "waltz",
    name: "Natural Turn",
    source: "library",
    attributes: [],
    schemaVersion: 1,
    deletedAt: null,
    ...over,
  }) as FigureDoc;

describe("#189 store attaches the auth token to the connect", () => {
  it("calls getToken at the connection-open and rides it as the ballroom.auth subprotocol", async () => {
    const captured: Array<{ id: string; protocols?: string[] }> = [];
    const getToken = vi.fn(async () => "tok_123");
    const opts: OpenOptions = {
      baseUrl: "http://test",
      getToken,
      openSocket: (url, protocols) => {
        const id = decodeURIComponent(url.split("/docs/")[1]?.replace("/connect", "") ?? url);
        captured.push({ id, protocols });
        return new FakeSocket() as unknown as ReturnType<NonNullable<OpenOptions["openSocket"]>>;
      },
    };
    await openRoutine("rt_sample", opts);
    // The connect opens AFTER getToken resolves (per-connection-open, async).
    await Promise.resolve();
    await Promise.resolve();
    expect(getToken).toHaveBeenCalled();
    const routineOpen = captured.find((c) => c.id === "rt_sample");
    expect(routineOpen?.protocols).toEqual(["ballroom.auth", "tok_123"]);
  });

  it("opens WITHOUT a subprotocol when no getToken is wired (tests / open boundary)", async () => {
    const { opts, sockets } = fakeWiring();
    await openRoutine("rt_sample", opts);
    expect(sockets.has("rt_sample")).toBe(true); // opens synchronously, no token
  });
});

describe("#187 figure projection on addPlacement", () => {
  it("projects the new figure (createFigure) BEFORE opening its DO", async () => {
    // Intent: addPlacement must project the figure to D1 + an owner membership
    //   (createFigure) before opening its DO, so the fail-closed connect (US-021)
    //   owner-resolves it (101, not 403).
    const { opts, sockets } = fakeWiring();
    let resolveCreate: () => void = () => {};
    const seen: Array<{ figureRef: string; name: string; dance: string; figureType: string }> = [];
    const createFigure = vi.fn((meta: (typeof seen)[number]) => {
      seen.push(meta);
      return new Promise<void>((r) => {
        resolveCreate = r;
      });
    });
    const store = await openRoutine("rt_sample", { ...opts, createFigure });

    store.addPlacement("s1", "Feather");

    // Projected immediately with the figure metadata; its DO is NOT yet opened.
    expect(createFigure).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({ name: "Feather", dance: "waltz", figureType: "feather" });
    const figureRef = seen[0]?.figureRef ?? "";
    expect(sockets.has(figureRef)).toBe(false);

    // Once projected, the figure DO opens (it's now owner-resolvable server-side).
    resolveCreate();
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets.has(figureRef)).toBe(true);
  });
});

describe("#205 addPlacement forwards library figure attributes to createFigure", () => {
  it("forwards a library figure's attributes to createFigure on pick", async () => {
    const { opts } = fakeWiring();
    const seen: Array<{ figureType: string; attributes?: unknown[] }> = [];
    const createFigure = vi.fn((meta: (typeof seen)[number]) => {
      seen.push(meta);
      return Promise.resolve();
    });
    const store = await openRoutine("rt_sample", { ...opts, createFigure });
    // "natural-turn" in waltz is a WDSF-enriched figure carrying 6 attributes.
    // The default routine dance is "waltz" (from emptyRoutine), so this matches.
    store.addPlacement("s1", "Natural Turn", "natural-turn");

    expect(createFigure).toHaveBeenCalledTimes(1);
    expect(seen[0]?.figureType).toBe("natural-turn");
    expect((seen[0]?.attributes ?? []).length).toBe(6);
  });

  it("forwards an empty attributes list for a custom (non-catalog) figure", async () => {
    const { opts } = fakeWiring();
    const seen: Array<{ attributes?: unknown[] }> = [];
    const createFigure = vi.fn((meta: (typeof seen)[number]) => {
      seen.push(meta);
      return Promise.resolve();
    });
    const store = await openRoutine("rt_sample", { ...opts, createFigure });
    store.addPlacement("s1", "My Move"); // no figureType → custom
    expect((seen[0]?.attributes ?? []).length).toBe(0);
  });
});

describe("US-017 store/ seam (multi-doc)", () => {
  it("loads a routine doc + each referenced figure doc and resolves variant overlays", async () => {
    // Intent: opening a routine fans out to the routine DO + each referenced
    //   figure DO and resolves variant overlays client-side via resolve().
    // Covers US-017 AC-1 (connect routine + figure docs) + AC-2 (overlays resolve).
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", opts);
    expect(Array.isArray(store.readPlacements())).toBe(true);

    // Sync state starts "connecting" and STAYS "connecting" on socket-open —
    // it only flips to "live" once the DO's catch-up-complete marker arrives, i.e.
    // the doc is HYDRATED, not merely socket-open (#202). US-018 "syncing…" shows
    // until then; editing is gated on this honest "live".
    expect(store.syncState()).toBe("connecting");
    sockets.get("rt_sample")?.fireOpen();
    expect(store.syncState()).toBe("connecting");
    sockets.get("rt_sample")?.fireCaughtUp();
    expect(store.syncState()).toBe("live");

    // The routine DO replays a section with a placement referencing variant "fv".
    const routineFull = buildRoutineDoc({
      id: "rt_sample",
      title: "Sample",
      dance: "waltz",
      ownerId: "",
      sections: [
        {
          id: "s1",
          name: "Intro",
          deletedAt: null,
          placements: [{ id: "p1", figureRef: "fv", deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.load(routineFull);

    // Reading placements opens the variant figure's connection (the placement
    // references "fv"). Load the variant — once it reports a baseFigureRef, the
    // next read opens the base figure's connection, which we then load too.
    store.readPlacements();
    const varFull = buildFigureDoc(
      aFigure({
        id: "fv",
        name: "My Turn",
        scope: "account",
        baseFigureRef: "fbase",
        overlay: { overrides: { a1: "rise" }, tombstones: [], additions: [], rename: "My Turn" },
      }) as FigureDoc,
    );
    sockets.get("fv")?.load(varFull);

    // Reading again opens the base connection (fv now declares baseFigureRef).
    store.readPlacements();
    const baseFull = buildFigureDoc(
      aFigure({
        id: "fbase",
        attributes: [{ id: "a1", kind: "rise", count: 1, value: "NFR", deletedAt: null }],
      }) as FigureDoc,
    );
    sockets.get("fbase")?.load(baseFull);

    const resolved = store.readPlacements();
    expect(resolved).toHaveLength(1);
    // The variant resolved to base ⊕ overlay (US-006): the base attribute a1 is
    // present with the overlay's overridden value, and the variant rename applies.
    // (resolve keeps base identity + variant name — the hybrid-identity contract.)
    expect(resolved[0]?.figure?.attributes.find((x) => x.id === "a1")?.value).toBe("rise");
    expect(resolved[0]?.figure?.name).toBe("My Turn");
    store.close();
  });

  it("exposes typed reactive reads + mutations + history-based undo", async () => {
    // Intent: the seam is the only thing components touch — reads, mutations, undo.
    // Covers US-017 AC-3 (typed reactive reads + mutations + undo).
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", { ...opts, actor: "00aa00aa00aa00aa" });

    // The DO replays a routine with one section so we can rename it.
    const withSection = buildRoutineDoc({
      id: "rt_sample",
      title: "",
      dance: "waltz",
      ownerId: "",
      sections: [{ id: "s1", name: "Intro", placements: [], deletedAt: null }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.load(withSection);

    let fired = 0;
    const unsub = store.subscribe(() => {
      fired++;
    });
    expect(typeof store.undo).toBe("function");
    expect(typeof store.redo).toBe("function");

    // A mutation through the seam notifies subscribers + applies (reactive read).
    store.renameSection("s1", "Verse");
    expect(fired).toBe(1); // subscription fired on the mutation
    expect(store.readRoutine().sections.find((s) => s.id === "s1")?.name).toBe("Verse");

    // Undo is wired to the domain per-actor history (US-010) and notifies again.
    store.undo();
    expect(fired).toBe(2); // subscription fired on the undo
    // The undo no longer shows "Verse" — the seam reverted the user's last change.
    expect(store.readRoutine().sections.find((s) => s.id === "s1")?.name).not.toBe("Verse");

    unsub();
    store.renameSection("s1", "Ignored"); // unsubscribed → no more notifications
    expect(fired).toBe(2);
    store.close();
  });

  it("exposes annotation reads + mutations stamped with currentUserId (US-039)", async () => {
    // Intent: the seam reads + creates/replies/deletes routine annotations, each
    //   stamped with the open user's id. Annotations live in the routine doc, so
    //   they ride the existing sync — the seam just exposes the verbs.
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", {
      ...opts,
      currentUserId: "me",
      actor: "00bb00bb00bb00bb",
    });
    const seeded = buildRoutineDoc({
      id: "rt_sample",
      title: "",
      dance: "waltz",
      ownerId: "",
      sections: [{ id: "s1", name: "Intro", placements: [], deletedAt: null }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.load(seeded);

    store.createAnnotation({
      kind: "lesson",
      text: "rise earlier",
      anchors: [{ type: "figure", figureRef: "f1" }],
    });
    const created = store.readAnnotations();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: "lesson", text: "rise earlier", authorId: "me" });

    const id = created[0]?.id ?? "";
    store.addReply(id, "try counting it");
    expect(store.readAnnotations()[0]?.replies[0]).toMatchObject({
      text: "try counting it",
      authorId: "me",
    });

    const replyId = store.readAnnotations()[0]?.replies[0]?.id ?? "";
    store.deleteReply(id, replyId);
    expect(store.readAnnotations()[0]?.replies).toHaveLength(0);

    store.deleteAnnotation(id);
    expect(store.readAnnotations()).toHaveLength(0);
    store.close();
  });

  it("setFigureAttributes writes the timeline to the figure's own doc connection (US-028)", async () => {
    // Intent: the hero-flow mutation lands on the FIGURE doc (a separate DO), not
    //   the routine doc — and goes out as a change frame on that figure's socket.
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", opts);

    store.setFigureAttributes("fig1", [
      { id: "step-2-T", kind: "step", count: 2, value: "T", role: null, deletedAt: null },
    ]);

    // Opening the figure connection + writing the change sends bytes on its socket.
    expect(sockets.get("fig1")).toBeTruthy();
    expect(sockets.get("fig1")?.sent.length ?? 0).toBeGreaterThan(0);
    store.close();
  });
});

describe("US-043 createCustomKind (routine CRDT + account REST) + customKinds()", () => {
  const energy: RegistryKind = {
    kind: "energy",
    label: "Energy",
    color: "#c0563f",
    cardinality: "single",
    valueType: "enum",
    values: ["low", "high"],
    builtin: false,
  };

  it("embeds the kind into the routine doc, exposes it via customKinds(), and calls saveCustomKind", async () => {
    const { opts } = fakeWiring();
    const saveCustomKind = vi.fn();
    const store = await openRoutine("rt_sample", { ...opts, saveCustomKind });
    store.createCustomKind(energy);
    expect(store.customKinds().some((k) => k.kind === "energy")).toBe(true);
    expect(store.readRoutine().customKinds?.some((k) => k.kind === "energy")).toBe(true);
    expect(saveCustomKind).toHaveBeenCalledWith(energy);
    store.close();
  });

  it("ignores a reserved/builtin slug (isReservedKind)", async () => {
    const { opts } = fakeWiring();
    const saveCustomKind = vi.fn();
    const store = await openRoutine("rt_sample", { ...opts, saveCustomKind });
    store.createCustomKind({
      kind: "rise",
      label: "Hacked",
      color: "#000",
      cardinality: "single",
      valueType: "enum",
      values: [],
      builtin: false,
    });
    expect(store.customKinds().some((k) => k.kind === "rise")).toBe(false);
    expect(saveCustomKind).not.toHaveBeenCalled();
    store.close();
  });

  it("merges account-wide kinds into customKinds() even without a createCustomKind call", async () => {
    const { opts } = fakeWiring();
    const store = await openRoutine("rt_sample", { ...opts, accountKinds: [energy] });
    expect(store.customKinds().some((k) => k.kind === "energy")).toBe(true);
    // The kind is NOT embedded in the routine doc — it only comes from accountKinds.
    expect(store.readRoutine().customKinds?.some((k) => k.kind === "energy") ?? false).toBe(false);
    store.close();
  });
});

describe("US-017 architecture boundary (components import only from store/)", () => {
  it("no component imports @automerge/automerge or the RPC client directly", () => {
    // Intent: components must reach Automerge / the worker only THROUGH store/
    //   (D6, §6.1) — never import @automerge/automerge or lib/rpc directly. This
    //   scans the components tree and fails on any direct import, so the boundary
    //   is a real gate, not a comment. (A dependency-cruiser/Biome rule can
    //   subsume this later; the assertion is what matters.)
    // Covers US-017 AC-4.
    const componentsDir = join(__dirname, "..", "components");
    const offenders: string[] = [];
    const FORBIDDEN = /from\s+["'](@automerge\/automerge|\.\.?\/(?:\.\.\/)*lib\/rpc)["']/;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (FORBIDDEN.test(readFileSync(p, "utf8"))) offenders.push(p);
        }
      }
    };
    try {
      walk(componentsDir);
    } catch {
      // components dir may not exist yet (no product components) — vacuously clean.
    }
    expect(offenders).toEqual([]);
  });
});
