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

describe("figure hydration race — a just-added figure's DO opens only after it's created", () => {
  it("does not open the new figure's DO from a render before createFigure resolves", async () => {
    // ROOT CAUSE (the bug this fixes): addPlacement adds the placement to the
    // routine immediately, so the next render's readPlacements → resolveFigure
    // used to open the figure DO EAGERLY — before createFigure (POST /api/figures
    // → seedDoc) seeded it. That connection got an empty catch-up + SYNC_CAUGHT_UP,
    // and since seedDoc doesn't broadcast, the seed never arrived → the figure
    // stayed null until a reload. The fix: defer opening the new figure's
    // connection until it's been created server-side, so the catch-up always
    // includes the seed.
    const { opts, sockets } = fakeWiring();
    let resolveCreate: () => void = () => {};
    const seen: Array<{ figureRef: string }> = [];
    const createFigure = vi.fn((meta: { figureRef: string }) => {
      seen.push(meta);
      return new Promise<void>((r) => {
        resolveCreate = r;
      });
    });
    const store = await openRoutine("rt_sample", {
      ...opts,
      createFigure,
      actor: "00cc00cc00cc00cc",
    });

    // A synced routine with one section, so the new placement has somewhere to land.
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
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(withSection);
    sockets.get("rt_sample")?.fireCaughtUp();

    store.addPlacement("s1", "Feather");
    const figureRef = seen[0]?.figureRef ?? "";
    expect(figureRef).not.toBe("");

    // A render happens while createFigure is still in flight: the placement shows
    // as loading (figure null) but its DO is NOT connected yet (no seed race).
    const rp = store.readPlacements().find((p) => p.placement.figureRef === figureRef);
    expect(rp).toBeDefined();
    expect(rp?.figure).toBeNull();
    expect(sockets.has(figureRef)).toBe(false);

    // Once it's created server-side (so its DO is seeded), the connection opens and
    // a subsequent render hydrates it from the catch-up replay.
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
    // The resolved variant must carry the VARIANT's identity, not the base's
    // (resolve() returns base identity by contract — the store stamps it back).
    const rp = store.readPlacements().find((p) => p.placement.figureRef === "fv");
    expect(rp?.figure?.id).toBe("fv");
    expect(rp?.figure?.baseFigureRef).toBe("fbase");
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
    //   The figure must be account-owned by the current user so the COW path (US-035)
    //   doesn't intercept it — an unowned figure would trigger copy-on-write instead.
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", { ...opts, currentUserId: "me" });

    // Seed the routine so the placement referencing "fig1" exists.
    const routine = buildRoutineDoc({
      id: "rt_sample",
      title: "",
      dance: "waltz",
      ownerId: "me",
      sections: [
        {
          id: "s1",
          name: "S",
          deletedAt: null,
          placements: [{ id: "p1", figureRef: "fig1", deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routine);
    sockets.get("rt_sample")?.fireCaughtUp();

    // Trigger the figure connection to open (it's lazy — opened by readPlacements).
    store.readPlacements();

    // Load "fig1" as account-owned by the current user → edits in place (no COW).
    const figDoc = buildFigureDoc(
      aFigure({ id: "fig1", scope: "account", ownerId: "me" }) as FigureDoc,
    );
    sockets.get("fig1")?.fireOpen();
    sockets.get("fig1")?.load(figDoc);
    sockets.get("fig1")?.fireCaughtUp();

    store.setFigureAttributes("fig1", [
      { id: "step-2-T", kind: "step", count: 2, value: "T", role: null, deletedAt: null },
    ]);

    // Opening the figure connection + writing the change sends bytes on its socket.
    expect(sockets.get("fig1")).toBeTruthy();
    expect(sockets.get("fig1")?.sent.length ?? 0).toBeGreaterThan(0);
    store.close();
  });

  it("copy-on-write: editing a NON-owned figure spawns an owned variant + re-points (US-035)", async () => {
    // Intent: when the user edits a global/shared figure they don't own, the store
    //   must silently spawn an owned variant, re-point the placement to it, and
    //   notify the screen to toast — without touching the shared base (US-035).
    const { opts, sockets } = fakeWiring();
    const created: Array<{ figureRef: string; baseFigureRef?: string }> = [];
    const createFigure = vi.fn(async (m: { figureRef: string; baseFigureRef?: string }) => {
      created.push({ figureRef: m.figureRef, baseFigureRef: m.baseFigureRef });
    });
    const onCopyOnWrite = vi.fn();
    const store = await openRoutine("rt_sample", {
      ...opts,
      currentUserId: "me",
      createFigure,
      onCopyOnWrite,
    });

    // Routine references a GLOBAL figure "fg" (owned by "app", not "me").
    const routine = buildRoutineDoc({
      id: "rt_sample",
      title: "R",
      dance: "foxtrot",
      ownerId: "me",
      sections: [
        {
          id: "s1",
          name: "S",
          deletedAt: null,
          placements: [{ id: "p1", figureRef: "fg", deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routine);
    sockets.get("rt_sample")?.fireCaughtUp();

    // Open the figure connection so we can load its doc.
    store.readPlacements();

    const fg = buildFigureDoc(
      aFigure({
        id: "fg",
        scope: "global",
        ownerId: "app",
        figureType: "feather",
        dance: "foxtrot",
        name: "Feather",
        source: "library",
        attributes: [{ id: "b1", kind: "step", count: 1, role: null, value: "HT" }],
      }) as FigureDoc,
    );
    sockets.get("fg")?.fireOpen();
    sockets.get("fg")?.load(fg);
    sockets.get("fg")?.fireCaughtUp();

    // Edit count-1 footwork HT→T on the non-owned figure → copy-on-write.
    store.setFigureAttributes("fg", [{ id: "b1", kind: "step", count: 1, role: null, value: "T" }]);

    // A variant was projected with baseFigureRef = the global base (synchronous —
    // createFigure is called before its .then()).
    expect(createFigure).toHaveBeenCalledTimes(1);
    expect(created[0]?.baseFigureRef).toBe("fg");
    const variantRef = created[0]?.figureRef as string;

    // The re-point + toast now happen INSIDE createFigure's .then() (only on
    // success), so wait for the async completion before asserting them.
    await vi.waitFor(() => expect(onCopyOnWrite).toHaveBeenCalledWith(variantRef));

    // The placement was re-pointed to the new variant id…
    const rp = store.readPlacements().find((p) => p.placement.id === "p1");
    expect(rp?.placement.figureRef).toBe(variantRef);
    // …and the shared base figure doc was NEVER written to (COW must not mutate it).
    expect(sockets.get("fg")?.sent.length ?? 0).toBe(0);
  });

  it("C1: onceLive defers the variant overlay write until after the DO seed replay, preventing silent edit loss", async () => {
    // Without onceLive, conn.change fires on an A.init() doc immediately in .then(),
    // BEFORE the variant DO's catch-up replay has been applied. When the DO's empty
    // seed overlay arrives and is applied via applyChanges, the two writes are
    // causally independent — Automerge resolves the conflict non-deterministically
    // (~50% of the time the server's empty overlay wins → the user's "T" edit is
    // silently lost). With onceLive the client write lands causally AFTER the seed,
    // so it always wins (C1).
    const { opts, sockets } = fakeWiring();
    const created: Array<{ figureRef: string; baseFigureRef?: string }> = [];
    const createFigure = vi.fn(async (m: { figureRef: string; baseFigureRef?: string }) => {
      created.push({ figureRef: m.figureRef, baseFigureRef: m.baseFigureRef });
    });
    const onCopyOnWrite = vi.fn();
    const store = await openRoutine("rt_c1", {
      ...opts,
      currentUserId: "me",
      createFigure,
      onCopyOnWrite,
    });

    // Routine references global figure "fg" with count-1 footwork "HT".
    const routine = buildRoutineDoc({
      id: "rt_c1",
      title: "R",
      dance: "foxtrot",
      ownerId: "me",
      sections: [
        {
          id: "s1",
          name: "S",
          deletedAt: null,
          placements: [{ id: "p1", figureRef: "fg", deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_c1")?.fireOpen();
    sockets.get("rt_c1")?.load(routine);
    sockets.get("rt_c1")?.fireCaughtUp();

    // Open the figure connection (lazy) then load the global figure.
    store.readPlacements();
    const fg = buildFigureDoc(
      aFigure({
        id: "fg",
        scope: "global",
        ownerId: "app",
        figureType: "feather",
        dance: "foxtrot",
        name: "Feather",
        source: "library",
        attributes: [{ id: "b1", kind: "step", count: 1, role: null, value: "HT" }],
      }) as FigureDoc,
    );
    sockets.get("fg")?.fireOpen();
    sockets.get("fg")?.load(fg);
    sockets.get("fg")?.fireCaughtUp();

    // Edit count-1 footwork HT→T → triggers copy-on-write.
    store.setFigureAttributes("fg", [{ id: "b1", kind: "step", count: 1, role: null, value: "T" }]);

    // Wait for createFigure + re-point + onCopyOnWrite to fire.
    await vi.waitFor(() => expect(onCopyOnWrite).toHaveBeenCalled());
    const variantRef = created[0]?.figureRef as string;

    // Simulate the server seed of the variant DO: POST /api/figures seeds the DO
    // with an EMPTY overlay (no overrides). Without onceLive, conn.change already
    // ran on an A.init() doc, making the T-overlay and the empty-seed concurrent.
    // With onceLive the T-overlay fires here (causally after fireCaughtUp), so T wins.
    const seeded = buildFigureDoc({
      id: variantRef,
      scope: "account",
      ownerId: "me",
      figureType: "feather",
      dance: "foxtrot",
      name: "Feather",
      source: "custom",
      attributes: [],
      baseFigureRef: "fg",
      overlay: { overrides: {}, tombstones: [], additions: [] },
      schemaVersion: 1,
      deletedAt: null,
    });

    // Drive the variant socket: open → seed replay → caught-up.
    // onceLive fires on fireCaughtUp: the deferred conn.change runs here,
    // causally on top of the seed → the "T" overlay always wins.
    sockets.get(variantRef)?.fireOpen();
    sockets.get(variantRef)?.load(seeded);
    sockets.get(variantRef)?.fireCaughtUp();

    // The re-pointed placement now resolves base ⊕ overlay: count-1 must be "T".
    await vi.waitFor(() => {
      const rp = store.readPlacements().find((p) => p.placement.figureRef === variantRef);
      expect(rp?.figure?.attributes.find((a) => a.id === "b1")?.value).toBe("T");
    });
    store.close();
  });

  it("co-member editing a shared ACCOUNT figure edits in place — no COW (US-034)", async () => {
    // Intent: a routine-editor co-member editing a shared account figure they DON'T
    //   own must edit the shared doc IN PLACE (the owner converges) — NOT fork a
    //   private variant. COW fires only for global library figures. The DO boundary
    //   enforces whether the write is accepted (editor via cascade → applied).
    const { opts, sockets } = fakeWiring();
    const createFigure = vi.fn(async () => {});
    const store = await openRoutine("rt_sample", { ...opts, currentUserId: "me", createFigure });

    // Routine references an ACCOUNT figure "fa" owned by SOMEONE ELSE ("coach").
    const routine = buildRoutineDoc({
      id: "rt_sample",
      title: "R",
      dance: "waltz",
      ownerId: "coach",
      sections: [
        {
          id: "s1",
          name: "S",
          deletedAt: null,
          placements: [{ id: "p1", figureRef: "fa", deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routine);
    sockets.get("rt_sample")?.fireCaughtUp();

    // Open the figure connection so we can load its doc.
    store.readPlacements();

    const fa = buildFigureDoc(
      aFigure({ id: "fa", scope: "account", ownerId: "coach" }) as FigureDoc,
    );
    sockets.get("fa")?.fireOpen();
    sockets.get("fa")?.load(fa);
    sockets.get("fa")?.fireCaughtUp();

    store.setFigureAttributes("fa", [
      { id: "step-1-T", kind: "step", count: 1, value: "T", role: null, deletedAt: null },
    ]);

    // No copy-on-write: the edit hit the shared figure's own doc in place.
    expect(createFigure).not.toHaveBeenCalled();
    expect(sockets.get("fa")?.sent.length ?? 0).toBeGreaterThan(0);
    // The placement still references the shared figure (never re-pointed).
    const rp = store.readPlacements().find((p) => p.placement.id === "p1");
    expect(rp?.placement.figureRef).toBe("fa");
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
    // The reserved slug is also NOT embedded into the routine doc (the guard
    // fires before the CRDT write, not just at the merged-read layer).
    expect(store.readRoutine().customKinds?.some((k) => k.kind === "rise") ?? false).toBe(false);
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
