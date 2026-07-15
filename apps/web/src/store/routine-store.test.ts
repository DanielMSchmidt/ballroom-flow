import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as A from "@automerge/automerge";
import { SYNC_CAUGHT_UP, SYNC_FRAME_SNAPSHOT } from "@weavesteps/contract";
import type { Attribute, FigureDoc, RegistryKind, RoutineDoc } from "@weavesteps/domain";
import {
  buildFigureDoc,
  buildRoutineDoc,
  globalFigureRef,
  libraryFiguresForDance,
} from "@weavesteps/domain";
import { describe, expect, it, vi } from "vitest";
import { reportError } from "../lib/ops";
import { ApiError } from "../lib/rpc";
import type { SocketLike } from "./doc-connection";
import { type OpenOptions, openRoutine } from "./routine";

// The store reports bug-shaped variant-spawn failures to Sentry via lib/ops —
// stub it so the failure-surfacing test can assert the call without a real DSN.
vi.mock("../lib/ops", () => ({ reportError: vi.fn() }));

// ─────────────────────────────────────────────────────────────────────────
// US-017 — store/ seam (multi-doc) [M2, system]
// docs/system/architecture.md § Module boundaries / § The shape,
// docs/system/testing.md § Layer ownership: the typed store seam wraps Automerge: opening a
// routine connects to the routine doc's DO then to each referenced figure
// doc's DO; each figure carries its own attributes (frozen copies — no overlay);
// exposes typed reactive reads + mutations + history-based undo. Components import
// ONLY from store/.
//
// The store wraps the WS sync via an injectable SocketFactory — these tests
// drive a FAKE socket (jsdom has no WS server) and feed it the change frames a
// DO would replay, so the seam's multi-doc load + figure reads + reactive
// reads/undo are exercised for real. (Live multi-doc sync over real DOs is the
// worker doc-do.test.ts + the #116 wrangler-dev smoke.)
// ─────────────────────────────────────────────────────────────────────────

/** A fake socket the test can push frames into (stands in for the DO). */
class FakeSocket implements SocketLike {
  binaryType = "blob";
  // Every listener is stored under the widest registered shape ((ev) => void);
  // open/close listeners take no parameter, so firing them with a dummy event
  // is invisible to them — this keeps addEventListener's overloads honest.
  private msg: ((ev: { data: unknown }) => void) | null = null;
  private open: ((ev: { data: unknown }) => void) | null = null;
  private closed: ((ev: { data: unknown }) => void) | null = null;
  sent: Uint8Array[] = [];
  addEventListener(type: string, fn: ((ev: { data: unknown }) => void) | (() => void)): void {
    if (type === "message") this.msg = fn;
    else if (type === "open") this.open = fn;
    else if (type === "close") this.closed = fn;
  }
  send(data: string | ArrayBufferView | ArrayBuffer): void {
    if (typeof data === "string") return; // heartbeat ping (docs/concepts/annotations.md § Anchors) — ignored here
    this.sent.push(
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  close(): void {
    this.closed?.({ data: undefined });
  }
  /** Signal the socket is open (the runtime fires this; the DO then replays). */
  fireOpen(): void {
    this.open?.({ data: undefined });
  }
  /** Deliver the DO's catch-up-complete marker — the doc is now hydrated (#202). */
  fireCaughtUp(): void {
    this.msg?.({ data: SYNC_CAUGHT_UP });
  }
  /** Deliver the DO's on-connect catch-up: ONE tagged SNAPSHOT frame (the whole
   *  doc as an `A.save` blob), which the client `A.load`s + `A.merge`s (D10). */
  load(doc: A.Doc<unknown>): void {
    const saved = A.save(doc);
    const frame = new Uint8Array(saved.byteLength + 1);
    frame[0] = SYNC_FRAME_SNAPSHOT;
    frame.set(saved, 1);
    this.msg?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) });
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
      return s;
    },
  };
  return { opts, sockets };
}

const aFigure = (over: Partial<FigureDoc>): FigureDoc => ({
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
});

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
        return new FakeSocket();
      },
    };
    await openRoutine("rt_sample", opts);
    // The connect opens AFTER getToken resolves (per-connection-open, async).
    await Promise.resolve();
    await Promise.resolve();
    expect(getToken).toHaveBeenCalled();
    const routineOpen = captured.find((c) => c.id === "rt_sample");
    // The auth carrier + token, plus the sync-wire version offer (the worker
    // echoes ballroom.sync.v1 back, making the negotiated protocol detectable).
    expect(routineOpen?.protocols).toEqual(["ballroom.auth", "tok_123", "ballroom.sync.v1"]);
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

describe("⟳v5 addPlacement places a live catalog reference (no POST)", () => {
  // Open a routine already carrying an empty section "s1" so a placement lands on
  // it. Lazy figures (eagerFigures:false) so a live catalog reference resolves from
  // the BUNDLED catalog with no socket — the ⟳v5 pre-filled render (§4.3).
  async function openWithSection(
    createFigure?: OpenOptions["createFigure"],
  ): Promise<{ store: Awaited<ReturnType<typeof openRoutine>>; sockets: Map<string, FakeSocket> }> {
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", {
      ...opts,
      createFigure,
      currentUserId: "me",
      eagerFigures: false,
    });
    const routine = buildRoutineDoc({
      id: "rt_sample",
      title: "R",
      dance: "waltz",
      ownerId: "me",
      sections: [{ id: "s1", name: "Intro", placements: [], deletedAt: null }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routine);
    sockets.get("rt_sample")?.fireCaughtUp();
    return { store, sockets };
  }

  it("places a live global reference for a catalog pick — NO createFigure (§4.3)", async () => {
    const createFigure = vi.fn(async () => {});
    const { store } = await openWithSection(createFigure);
    store.addPlacement("s1", "Natural Turn", "natural-turn");
    // ⟳v5: a catalog pick places a LIVE reference to the global doc — no POST.
    expect(createFigure).not.toHaveBeenCalled();
    const ref = globalFigureRef("waltz", "natural-turn");
    const rp = store.readPlacements().find((p) => p.placement.figureRef === ref);
    expect(rp).toBeDefined();
    // It renders PRE-FILLED from the bundled catalog by construction: the charted
    // direction+footwork CORE is 6 counts × 2 roles × {direction, footwork} = 24.
    const attrs = rp?.figure?.attributes ?? [];
    expect(attrs.filter((a) => a.kind === "direction" || a.kind === "footwork")).toHaveLength(24);
  });

  it("fires onCreated for a custom mint — and never for a catalog pick (create-navigates)", async () => {
    // The Assemble screen opens the new figure's step editor immediately after a
    // CREATE (owner request 2026-07-08). The hook is addPlacement's onCreated
    // callback: it fires synchronously with the fresh custom figure's refs, and
    // NOT for a catalog pick (placing an already-charted figure is assembly, not
    // creation — no auto-navigation).
    const createFigure = vi.fn(async () => {});
    const { store } = await openWithSection(createFigure);

    const onCreated = vi.fn<(created: { figureRef: string; placementId: string }) => void>();
    store.addPlacement("s1", "My Glue Step", undefined, undefined, undefined, undefined, onCreated);
    expect(onCreated).toHaveBeenCalledTimes(1);
    const created = onCreated.mock.calls[0]?.[0];
    expect(created).toBeDefined();
    // The refs point at the real just-placed placement/figure pair.
    const rp = store.readPlacements().find((p) => p.placement.id === created?.placementId);
    expect(rp?.placement.figureRef).toBe(created?.figureRef);

    const preset = libraryFiguresForDance("waltz")[0];
    if (!preset) throw new Error("waltz catalog unexpectedly empty");
    const onCatalog = vi.fn();
    store.addPlacement(
      "s1",
      preset.name,
      preset.figureType,
      undefined,
      undefined,
      undefined,
      onCatalog,
    );
    expect(onCatalog).not.toHaveBeenCalled();
  });

  it("placeFigure appends a placement referencing an EXISTING figure — assembly, not creation", async () => {
    // ⟳v5 §4.2: a library bookmark "can be placed into your other routines".
    // Placing an existing (account) figure by ref must not POST /api/figures —
    // the doc already exists; the placement just points at it.
    const createFigure = vi.fn(async () => {});
    const { store } = await openWithSection(createFigure);
    store.placeFigure("s1", "fig_mine");
    expect(createFigure).not.toHaveBeenCalled();
    expect(store.readPlacements().find((p) => p.placement.figureRef === "fig_mine")).toBeDefined();
  });

  it("placeFigure inserts BEFORE an anchor via sortKey (insert-between parity with addPlacement)", async () => {
    const { store } = await openWithSection();
    store.placeFigure("s1", "fig_a");
    store.placeFigure("s1", "fig_b");
    const anchor = store.readPlacements().find((p) => p.placement.figureRef === "fig_b");
    if (!anchor) throw new Error("anchor placement missing");
    store.placeFigure("s1", "fig_between", anchor.placement.id);
    expect(store.readPlacements().map((p) => p.placement.figureRef)).toEqual([
      "fig_a",
      "fig_between",
      "fig_b",
    ]);
  });

  it("a catalog reference is EDITOR-READY with zero figure sockets (openFigure is a no-op)", async () => {
    // Regression (screenshots/e2e CI, 2026-07-02): opening the step editor on a
    // catalog live-reference used to open a WS to the global doc and gate the
    // editor on its hydration — in any environment whose global docs aren't
    // seeded, that connect 403s and the "load on open" gate hangs forever. A
    // catalog ref's content is definitionally available (bundled catalog /
    // snapshot base, §6.2 poll-fresh), and a user edit spawns a VARIANT anyway —
    // so the editor must be ready without any own-doc connection.
    const { store, sockets } = await openWithSection();
    store.addPlacement("s1", "Natural Turn", "natural-turn");
    const ref = globalFigureRef("waltz", "natural-turn");
    const socketsBefore = sockets.size;
    store.openFigure(ref); // must NOT open a socket for the catalog ref
    expect(sockets.size).toBe(socketsBefore);
    const rp = store.readPlacements().find((p) => p.placement.figureRef === ref);
    expect(rp?.status).toBe("live");
    expect(rp?.fromLiveDoc).toBe(true); // the editor's load-on-open gate releases
  });

  it("editing a catalog reference opens ONLY the variant socket — never the catalog global DO", async () => {
    // Connection frugality (companion to the COW-for-a-catalog-ref fix): editing a
    // placed catalog figure spawns a variant, and ONE socket is sufficient — the
    // variant's own DO. The catalog base needs no live connection (its content is
    // bundled; admin edits arrive via poll/snapshot, §6.2). The write path must
    // therefore resolve the figure's scope from the bundled catalog (`figureOwnDoc`),
    // NOT a bare `figureConn(ref)` read — the latter would open a doomed connection
    // to the unseeded global DO (immediate 403 + reconnect/backoff churn) on every
    // edit. This guards against reintroducing that second, redundant connection.
    const created: Array<{ figureRef: string }> = [];
    const createFigure = vi.fn(async (m: { figureRef: string }) => {
      created.push(m);
    });
    const onCopyOnWrite = vi.fn();
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", {
      ...opts,
      createFigure,
      onCopyOnWrite,
      currentUserId: "me",
      eagerFigures: false,
    });
    const routine = buildRoutineDoc({
      id: "rt_sample",
      title: "R",
      dance: "waltz",
      ownerId: "me",
      sections: [{ id: "s1", name: "Intro", placements: [], deletedAt: null }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routine);
    sockets.get("rt_sample")?.fireCaughtUp();

    store.addPlacement("s1", "Natural Turn", "natural-turn");
    const ref = globalFigureRef("waltz", "natural-turn");
    store.openFigure(ref);
    // Re-time it: quick-add a sub-beat presence step (the "&" between 5 and 6).
    const resolved = store.readPlacements().find((p) => p.placement.figureRef === ref)?.figure;
    store.setFigureAttributes(ref, [
      ...(resolved?.attributes ?? []),
      { id: "p55", kind: "direction", count: 5.5, role: null, value: null, deletedAt: null },
    ]);

    await vi.waitFor(() => expect(onCopyOnWrite).toHaveBeenCalled());
    const variantRef = created[0]?.figureRef ?? ""; // "" would fail the asserts below
    // The catalog global DO was NEVER connected…
    expect(sockets.has(ref)).toBe(false);
    // …exactly the routine + the spawned variant have sockets (one figure socket).
    expect([...sockets.keys()].sort()).toEqual(["rt_sample", variantRef].sort());
    store.close();
  });

  it("a TYPED name that collides with a catalog name still mints the user's OWN figure", async () => {
    // Owner decision 2026-07-11 (REVERSES the earlier name-alone catalog match):
    // the custom form always creates YOUR figure — typing "Natural Turn" must not
    // silently place the global catalog doc. Only an explicit preset pick (which
    // carries the canonical figureType) places a live global reference.
    const seen: Array<{ figureRef: string }> = [];
    const createFigure = vi.fn((meta: { figureRef: string }) => {
      seen.push(meta);
      return Promise.resolve();
    });
    const { store } = await openWithSection(createFigure);
    store.addPlacement("s1", "Natural Turn"); // typed, NO figureType
    expect(createFigure).toHaveBeenCalledTimes(1);
    const rp = store.readPlacements()[0];
    // The placement points at the freshly-minted account figure, not the catalog.
    expect(rp?.placement.figureRef).toBe(seen[0]?.figureRef);
    expect(rp?.placement.figureRef).not.toBe(globalFigureRef("waltz", "natural-turn"));
    expect(rp?.placement.figureRef?.startsWith("global:")).toBe(false);
  });

  it("mints a custom figure (POST, empty attributes) for a non-catalog name", async () => {
    const seen: Array<{ attributes?: unknown[]; figureRef: string }> = [];
    const createFigure = vi.fn((meta: { attributes?: unknown[]; figureRef: string }) => {
      seen.push(meta);
      return Promise.resolve();
    });
    const { store } = await openWithSection(createFigure);
    store.addPlacement("s1", "My Move"); // no catalog match → a choreo-local custom
    expect(createFigure).toHaveBeenCalledTimes(1);
    expect((seen[0]?.attributes ?? []).length).toBe(0);
    // A custom mints a ULID ref, NOT a global: reference.
    expect(seen[0]?.figureRef.startsWith("global:")).toBe(false);
  });
});

describe("US-017 store/ seam (multi-doc)", () => {
  it("loads a routine doc + each referenced figure doc, each carrying its own attributes", async () => {
    // Intent: opening a routine fans out to the routine DO + each referenced
    //   figure DO; a frozen copy carries its OWN attributes (no overlay, no base
    //   fan-out resolution — §5.2). `baseFigureRef` is provenance only.
    // Covers US-017 AC-1 (connect routine + figure docs) + AC-2 (figure content read).
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

    // The routine DO replays a section with a placement referencing the copy "fv".
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

    // Reading placements opens the copy figure's connection (the placement
    // references "fv"). Load it — a frozen copy carries its OWN attributes, with
    // `baseFigureRef` as provenance only (no base resolution).
    store.readPlacements();
    const varFull = buildFigureDoc(
      aFigure({
        id: "fv",
        name: "My Turn",
        scope: "account",
        baseFigureRef: "fbase",
        attributes: [{ id: "a1", kind: "rise", count: 1, value: "rise", deletedAt: null }],
      }),
    );
    sockets.get("fv")?.load(varFull);

    const resolved = store.readPlacements();
    expect(resolved).toHaveLength(1);
    // The copy resolves to its OWN attributes + name — no base fan-out.
    expect(resolved[0]?.figure?.attributes.find((x) => x.id === "a1")?.value).toBe("rise");
    expect(resolved[0]?.figure?.name).toBe("My Turn");
    // The copy keeps its own identity and its provenance ref.
    const rp = store.readPlacements().find((p) => p.placement.figureRef === "fv");
    expect(rp?.figure?.id).toBe("fv");
    expect(rp?.figure?.baseFigureRef).toBe("fbase");
    store.close();
  });

  it("flows a later catalog attribute-fill DOWN into a referencing placement (no re-entry, §5.2)", async () => {
    // The scenario the owner asked us to double-check: you write a choreo NOW
    // using standard (catalog) figures whose attributes are still sparse; LATER
    // those catalog figures are filled in with precise attributes. Because a
    // placement holds a LIVE reference to the global figure — never a copy — the
    // richer attributes flow down into the routine on the next read. You never
    // re-enter the choreo. This exercises that end-to-end through the store's
    // real read path (the pure-domain overlay is covered in fork.test.ts).
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", opts);
    const ref = globalFigureRef("waltz", "natural-turn");
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
          placements: [{ id: "p1", figureRef: ref, deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.load(routineFull);
    // First read opens the referenced (global) figure's connection.
    store.readPlacements();

    // The catalog figure starts SPARSE — a single charted step, no footwork yet.
    let base = buildFigureDoc(
      aFigure({
        id: ref,
        scope: "global",
        attributes: [
          { id: "s1", kind: "direction", count: 1, role: null, value: "forward", deletedAt: null },
        ],
      }),
    );
    sockets.get(ref)?.load(base);
    let rp = store.readPlacements().find((p) => p.placement.figureRef === ref);
    expect(rp?.figure?.attributes.filter((a) => a.deletedAt == null)).toHaveLength(1);

    // LATER: the official data lands — the global doc gains precise footwork +
    // a second step (a base edit on the same doc lineage → a clean merge).
    base = A.change(base, (d) => {
      d.attributes.push({
        id: "s2",
        kind: "footwork",
        count: 1,
        role: null,
        value: "HT",
        deletedAt: null,
      });
      d.attributes.push({
        id: "s3",
        kind: "direction",
        count: 2,
        role: null,
        value: "side",
        deletedAt: null,
      });
    });
    sockets.get(ref)?.load(base);

    rp = store.readPlacements().find((p) => p.placement.figureRef === ref);
    const live = rp?.figure?.attributes.filter((a) => a.deletedAt == null) ?? [];
    // The precise catalog attributes flowed DOWN into the placement automatically.
    expect(live).toHaveLength(3);
    expect(live.find((a) => a.id === "s2")?.value).toBe("HT");
    expect(live.find((a) => a.id === "s3")?.value).toBe("side");
    store.close();
  });

  it("readPlacements is referentially stable + marks a live figure fromLiveDoc (A/E)", async () => {
    // Identity caching (A): while nothing changes, readPlacements returns the SAME
    // array and the SAME figure object across reads (so an unrelated sync frame
    // doesn't churn the editor's props → the flicker root cause). fromLiveDoc (E)
    // is true when a figure is served by its OWN hydrated live doc.
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", opts);

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
          placements: [{ id: "p1", figureRef: "fg", deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.load(routineFull);

    // Eager mode: reading opens the figure's connection. Load + hydrate it.
    store.readPlacements();
    const figFull = buildFigureDoc(
      aFigure({
        id: "fg",
        scope: "account",
        name: "Turn",
        attributes: [{ id: "a1", kind: "rise", count: 1, value: "rise", deletedAt: null }],
      }),
    );
    sockets.get("fg")?.load(figFull);
    sockets.get("fg")?.fireCaughtUp();

    const first = store.readPlacements();
    expect(first[0]?.status).toBe("live");
    expect(first[0]?.fromLiveDoc).toBe(true); // served by its OWN live doc

    // Nothing changed → SAME array + SAME figure identity across reads (A).
    const second = store.readPlacements();
    expect(second).toBe(first);
    expect(second[0]?.figure).toBe(first[0]?.figure);
    store.close();
  });

  it("moveSection / movePlacement reorder via sortKey, not a splice (#63)", async () => {
    // Intent: reorder is a field update through the seam — the read order changes
    //   to reflect the new sortKey ordering. The seed has NO sortKeys, so this
    //   also exercises the legacy-doc backfill (ensureSortKeys) on first move.
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", opts);
    const doc = buildRoutineDoc({
      id: "rt_sample",
      title: "",
      dance: "waltz",
      ownerId: "",
      sections: [
        {
          id: "s1",
          name: "A",
          placements: [
            { id: "p1", figureRef: "f1", deletedAt: null },
            { id: "p2", figureRef: "f2", deletedAt: null },
            { id: "p3", figureRef: "f3", deletedAt: null },
          ],
          deletedAt: null,
        },
        { id: "s2", name: "B", placements: [], deletedAt: null },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.load(doc);

    // Initial array order (no sortKeys yet → array-order fallback).
    expect(store.readRoutine().sections.map((s) => s.id)).toEqual(["s1", "s2"]);

    // Move section s1 down → [s2, s1].
    store.moveSection("s1", "down");
    expect(store.readRoutine().sections.map((s) => s.id)).toEqual(["s2", "s1"]);

    // Move placement p1 down within s1 → [p2, p1, p3].
    store.movePlacement("s1", "p1", "down");
    const s1 = store.readRoutine().sections.find((s) => s.id === "s1");
    expect(s1?.placements.map((p) => p.id)).toEqual(["p2", "p1", "p3"]);

    // Move p3 up to the front → [p3, p2, p1].
    store.movePlacement("s1", "p3", "up");
    store.movePlacement("s1", "p3", "up");
    const after = store.readRoutine().sections.find((s) => s.id === "s1");
    expect(after?.placements.map((p) => p.id)).toEqual(["p3", "p2", "p1"]);
    store.close();
  });

  it("addPlacement / addBreak insert BEFORE an anchor via sortKey (US-027 insert-between)", async () => {
    // Intent: a new figure/break lands in the gap before the anchor placement,
    // not appended — the read order reflects the fractional-index insert (#63).
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", opts);
    const doc = buildRoutineDoc({
      id: "rt_sample",
      title: "",
      dance: "waltz",
      ownerId: "",
      sections: [
        {
          id: "s1",
          name: "A",
          placements: [
            { id: "p1", figureRef: "f1", deletedAt: null },
            { id: "p2", figureRef: "f2", deletedAt: null },
            { id: "p3", figureRef: "f3", deletedAt: null },
          ],
          deletedAt: null,
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.load(doc);

    const known = new Set(["p1", "p2", "p3"]);
    const placementsOf = (id: string) =>
      store.readRoutine().sections.find((s) => s.id === id)?.placements ?? [];
    const orderIds = () => placementsOf("s1").map((p) => (known.has(p.id) ? p.id : "NEW"));

    // Insert a figure BEFORE p2 → [p1, NEW, p2, p3].
    store.addPlacement("s1", "Hover", undefined, undefined, "p2");
    expect(orderIds()).toEqual(["p1", "NEW", "p2", "p3"]);

    // A break inserted before p1 goes to the front (the new figure adopts its id).
    const insertedFigureId = placementsOf("s1")[1]?.id;
    if (insertedFigureId) known.add(insertedFigureId);
    store.addBreak("s1", "p1");
    expect(orderIds()[0]).toBe("NEW");
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

  it("undo() returns a supersededByOthers signal when another actor built on my change (US-038 AC-3)", async () => {
    // Intent: the soft "superseded" hint flows through the seam. undo ALWAYS
    //   proceeds (CRDT merges, no refusal); undo() just REPORTS whether another
    //   actor causally built on the reverted change so the UI can soften the toast.
    const ACTOR_A = "00aa00aa00aa00aa";
    const ACTOR_B = "00bb00bb00bb00bb";
    const base: RoutineDoc = {
      id: "rt_sample",
      title: "",
      dance: "waltz",
      ownerId: "",
      sections: [{ id: "s1", name: "Intro", placements: [], deletedAt: null }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    // A authors the undo target; B merges A's change THEN edits → B depends on A.
    let aDoc = A.from(base, ACTOR_A);
    aDoc = A.change(aDoc, (d) => {
      const s = d.sections[0];
      if (s) s.name = "Verse";
    });
    let bDoc = A.merge(A.init<RoutineDoc>(), A.clone(aDoc));
    bDoc = A.change(A.clone(bDoc, { actor: ACTOR_B }), (d) => {
      d.sections.push({ id: "s2", name: "FromB", placements: [], deletedAt: null });
    });
    const merged = A.merge(A.merge(A.init<RoutineDoc>(), A.clone(aDoc)), A.clone(bDoc));

    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", { ...opts, actor: ACTOR_A });
    sockets.get("rt_sample")?.load(merged);

    const result = store.undo();
    expect(result.undone).toBe(true);
    expect(result.supersededByOthers).toBe(true);
    store.close();
  });

  it("undo() reports supersededByOthers:false when only I have edited (US-038 AC-3)", async () => {
    // Intent: with no other actor's dependent change, the hint stays quiet so the
    //   UI shows the plain "Undone" toast.
    const ACTOR_A = "00aa00aa00aa00aa";
    const base: RoutineDoc = {
      id: "rt_sample",
      title: "",
      dance: "waltz",
      ownerId: "",
      sections: [{ id: "s1", name: "Intro", placements: [], deletedAt: null }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    let aDoc = A.from(base, ACTOR_A);
    aDoc = A.change(aDoc, (d) => {
      const s = d.sections[0];
      if (s) s.name = "Verse";
    });

    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", { ...opts, actor: ACTOR_A });
    sockets.get("rt_sample")?.load(aDoc);

    const result = store.undo();
    expect(result.undone).toBe(true);
    expect(result.supersededByOthers).toBe(false);
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
    const figDoc = buildFigureDoc(aFigure({ id: "fig1", scope: "account", ownerId: "me" }));
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

  it("setFigureAttributes drops a kind that doesn't apply to the figure's dance (rise omits Tango, §3/§10.2)", async () => {
    // Intent: the store seam enforces the dance gate on the WRITE path — a `rise`
    //   value can never be persisted onto a Tango figure (T9a). A valid kind in the
    //   same batch still lands; only the inapplicable attribute is dropped.
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", { ...opts, currentUserId: "me" });

    const routine = buildRoutineDoc({
      id: "rt_sample",
      title: "",
      dance: "tango",
      ownerId: "me",
      sections: [
        {
          id: "s1",
          name: "S",
          deletedAt: null,
          placements: [{ id: "p1", figureRef: "figT", deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routine);
    sockets.get("rt_sample")?.fireCaughtUp();
    store.readPlacements();

    const figDoc = buildFigureDoc(
      aFigure({ id: "figT", scope: "account", ownerId: "me", dance: "tango" }),
    );
    sockets.get("figT")?.fireOpen();
    sockets.get("figT")?.load(figDoc);
    sockets.get("figT")?.fireCaughtUp();

    store.setFigureAttributes("figT", [
      { id: "rise-1", kind: "rise", count: 1, value: "up", role: null, deletedAt: null },
      { id: "pos-1", kind: "position", count: 1, value: "closed", role: null, deletedAt: null },
    ]);

    // The rise attribute was dropped; the (dance-applicable) position attribute persisted.
    const rp = store.readPlacements().find((p) => p.placement.id === "p1");
    const kinds = (rp?.figure?.attributes ?? []).map((a) => a.kind);
    expect(kinds).toContain("position");
    expect(kinds).not.toContain("rise");
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
      }),
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
    const variantRef = created[0]?.figureRef ?? ""; // "" would fail the asserts below

    // The re-point + toast now happen INSIDE createFigure's .then() (only on
    // success), so wait for the async completion before asserting them.
    await vi.waitFor(() => expect(onCopyOnWrite).toHaveBeenCalledWith(variantRef));

    // The placement was re-pointed to the new variant id…
    const rp = store.readPlacements().find((p) => p.placement.id === "p1");
    expect(rp?.placement.figureRef).toBe(variantRef);
    // …and the shared base figure doc was NEVER written to (COW must not mutate it).
    expect(sockets.get("fg")?.sent.length ?? 0).toBe(0);
  });

  it("exposes isForking while a variant spawn is in flight, cleared on completion (fork feedback)", async () => {
    // Intent: the implicit fork is async (POST → onceLive → re-point); the editor
    //   needs a reactive signal to show an inline "making this figure yours…"
    //   pending state so the user isn't confused that their click "did nothing".
    const { opts, sockets } = fakeWiring();
    const created: Array<{ figureRef: string }> = [];
    const createFigure = vi.fn(async (m: { figureRef: string }) => {
      created.push({ figureRef: m.figureRef });
    });
    const onCopyOnWrite = vi.fn();
    const notified = vi.fn();
    const store = await openRoutine("rt_sample", {
      ...opts,
      currentUserId: "me",
      createFigure,
      onCopyOnWrite,
    });
    store.subscribe(notified);

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
      }),
    );
    sockets.get("fg")?.fireOpen();
    sockets.get("fg")?.load(fg);
    sockets.get("fg")?.fireCaughtUp();

    expect(store.isForking?.("fg")).toBe(false);
    notified.mockClear();

    // The edit kicks off the fork — synchronously in flight, and it notified
    // subscribers so the editor re-renders into its pending state.
    store.setFigureAttributes("fg", [{ id: "b1", kind: "step", count: 1, role: null, value: "T" }]);
    expect(store.isForking?.("fg")).toBe(true);
    expect(notified).toHaveBeenCalled();

    const variantRef = created[0]?.figureRef ?? ""; // "" would fail the asserts below
    await vi.waitFor(() => expect(onCopyOnWrite).toHaveBeenCalledWith(variantRef));

    // Cleared once the variant is live + the placement is re-pointed.
    expect(store.isForking?.("fg")).toBe(false);
  });

  it("copy-on-write fires for a placed CATALOG reference whose global DO is NOT seeded (US-035)", async () => {
    // Intent (the bug this guards): a catalog figure placed via the Add-figure sheet
    //   is a LIVE REFERENCE to a `global:<dance>:<figureType>` doc (⟳v5, §4.3) that
    //   has NO seeded DO of its own — its content comes from the BUNDLED catalog.
    //   Editing it (e.g. quick-adding a sub-beat step to re-time the figure) must
    //   still spawn a variant. The earlier scope read looked ONLY at the (unhydrated,
    //   403-ing) live connection → it saw `null`, missed the `global` scope, and
    //   fell through to an in-place write the DO silently rejects: the "Step placed"
    //   toast fired but nothing persisted. `figureOwnDoc` resolves the bundled
    //   catalog first, so the global scope is detected and a variant is spawned.
    const ref = globalFigureRef("waltz", "running-spin-turn");
    const { opts, sockets } = fakeWiring();
    const created: Array<{ figureRef: string; baseFigureRef?: string; attributes?: Attribute[] }> =
      [];
    const createFigure = vi.fn(async (m: (typeof created)[number]) => {
      created.push(m);
    });
    const onCopyOnWrite = vi.fn();
    const store = await openRoutine("rt_cat", {
      ...opts,
      currentUserId: "me",
      createFigure,
      onCopyOnWrite,
    });

    // The routine references the CATALOG figure directly — no figure DO is seeded.
    const routine = buildRoutineDoc({
      id: "rt_cat",
      title: "R",
      dance: "waltz",
      ownerId: "me",
      sections: [
        {
          id: "s1",
          name: "S",
          deletedAt: null,
          placements: [{ id: "p1", figureRef: ref, deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_cat")?.fireOpen();
    sockets.get("rt_cat")?.load(routine);
    sockets.get("rt_cat")?.fireCaughtUp();
    store.readPlacements();
    store.openFigure(ref); // opening a catalog reference is a no-op (bundled content)

    // Re-time the figure: quick-add a presence step at the "&" between 5 and 6
    // (count 5.5) — the FigureTimeline sends the RESOLVED (catalog) timeline plus
    // the new presence attribute, exactly as its onCellTap quick-add does.
    const resolved = store.readPlacements().find((p) => p.placement.figureRef === ref)?.figure;
    expect(resolved?.scope).toBe("global"); // the editor sees it as a catalog figure
    const edited: Attribute[] = [
      ...(resolved?.attributes ?? []),
      { id: "p55", kind: "direction", count: 5.5, role: null, value: null, deletedAt: null },
    ];
    store.setFigureAttributes(ref, edited);

    // A variant is projected with the catalog ref as its LIVE base — NOT dropped.
    await vi.waitFor(() => expect(onCopyOnWrite).toHaveBeenCalled());
    expect(createFigure).toHaveBeenCalledTimes(1);
    expect(created[0]?.baseFigureRef).toBe(ref);
    // The variant OWNS the re-timed beat, carrying the new sub-beat presence (5.5).
    expect(created[0]?.attributes?.some((a) => a.count === 5.5)).toBe(true);
    // The placement re-points to the variant…
    const rp = store.readPlacements().find((p) => p.placement.id === "p1");
    expect(rp?.placement.figureRef).toBe(created[0]?.figureRef);
    // …and NOTHING was ever written to the (unseeded) global DO connection: the old
    // bug's silently-rejected in-place write must not happen.
    expect(sockets.get(ref)?.sent.length ?? 0).toBe(0);
    store.close();
  });

  it("surfaces a FAILED variant spawn (error callback + Sentry) instead of dropping it silently", async () => {
    // Intent (the reported bug's second half): when the variant POST fails, the
    //   store used to only `console.warn` and drop the edit — but FigureTimeline had
    //   already fired the optimistic "Step placed" toast, so the user saw success
    //   then a vanished step. The store must now (a) tell the screen via
    //   `onCopyOnWriteError` so it can toast the failure, and (b) report a bug-shaped
    //   failure (a 409 the DB shouldn't produce) to Sentry — while NEVER re-pointing
    //   the placement (no dangling variant) or firing the success callback.
    const ref = globalFigureRef("waltz", "running-spin-turn");
    const { opts, sockets } = fakeWiring();
    const createFigure = vi.fn(async () => {
      throw new ApiError(409, { error: "figure_ref_conflict" }, "POST /api/figures -> 409");
    });
    const onCopyOnWrite = vi.fn();
    const onCopyOnWriteError = vi.fn();
    const store = await openRoutine("rt_fail", {
      ...opts,
      currentUserId: "me",
      createFigure,
      onCopyOnWrite,
      onCopyOnWriteError,
    });
    const routine = buildRoutineDoc({
      id: "rt_fail",
      title: "R",
      dance: "waltz",
      ownerId: "me",
      sections: [
        {
          id: "s1",
          name: "S",
          deletedAt: null,
          placements: [{ id: "p1", figureRef: ref, deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    sockets.get("rt_fail")?.fireOpen();
    sockets.get("rt_fail")?.load(routine);
    sockets.get("rt_fail")?.fireCaughtUp();
    const resolved = store.readPlacements().find((p) => p.placement.figureRef === ref)?.figure;
    store.setFigureAttributes(ref, [
      ...(resolved?.attributes ?? []),
      { id: "p55", kind: "direction", count: 5.5, role: null, value: null, deletedAt: null },
    ]);

    // The screen is told (so it can toast) — classified as a bug, not a refusal.
    await vi.waitFor(() =>
      expect(onCopyOnWriteError).toHaveBeenCalledWith({ figureRef: ref, reason: "unexpected" }),
    );
    // …and the bug is reported to Sentry (deduped per figureRef).
    expect(vi.mocked(reportError)).toHaveBeenCalled();
    // It must NOT masquerade as success: no "made yours" callback, no re-point —
    // the placement stays on the base rather than pointing at an uncreated variant.
    expect(onCopyOnWrite).not.toHaveBeenCalled();
    const rp = store.readPlacements().find((p) => p.placement.id === "p1");
    expect(rp?.placement.figureRef).toBe(ref);
    store.close();
  });

  it("C1: onceLive defers the copy's attribute write until after the DO seed replay, preventing silent edit loss", async () => {
    // Without onceLive, conn.change fires on an A.init() doc immediately in .then(),
    // BEFORE the copy DO's catch-up replay has been applied. When the DO's seed
    // arrives and is applied via applyChanges, the two writes are causally
    // independent — Automerge resolves the conflict non-deterministically (~50% of
    // the time the server seed wins → the user's "T" edit is silently lost). With
    // onceLive the client write lands causally AFTER the seed, so it always wins (C1).
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
      }),
    );
    sockets.get("fg")?.fireOpen();
    sockets.get("fg")?.load(fg);
    sockets.get("fg")?.fireCaughtUp();

    // Edit count-1 footwork HT→T → triggers copy-on-write.
    store.setFigureAttributes("fg", [{ id: "b1", kind: "step", count: 1, role: null, value: "T" }]);

    // Wait for createFigure + re-point + onCopyOnWrite to fire.
    await vi.waitFor(() => expect(onCopyOnWrite).toHaveBeenCalled());
    const variantRef = created[0]?.figureRef ?? ""; // "" would fail the asserts below

    // Simulate the server seed of the copy DO: POST /api/figures seeds the DO as a
    // FROZEN copy carrying its OWN attributes (the forwarded edit — count-1 "T"),
    // with `baseFigureRef` as provenance only (no overlay). Without onceLive,
    // conn.change already ran on an A.init() doc, making the client write and the
    // seed concurrent. With onceLive the client write fires here (causally after
    // fireCaughtUp), so the "T" attribute always wins.
    const seeded = buildFigureDoc({
      id: variantRef,
      scope: "account",
      ownerId: "me",
      figureType: "feather",
      dance: "foxtrot",
      name: "Feather",
      source: "custom",
      attributes: [{ id: "b1", kind: "step", count: 1, role: null, value: "T" }],
      baseFigureRef: "fg",
      schemaVersion: 1,
      deletedAt: null,
    });

    // Drive the copy socket: open → seed replay → caught-up.
    // onceLive fires on fireCaughtUp: the deferred conn.change runs here,
    // causally on top of the seed → the "T" attribute always wins.
    sockets.get(variantRef)?.fireOpen();
    sockets.get(variantRef)?.load(seeded);
    sockets.get(variantRef)?.fireCaughtUp();

    // The re-pointed placement now reads the copy's OWN attributes: count-1 = "T".
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

    const fa = buildFigureDoc(aFigure({ id: "fa", scope: "account", ownerId: "coach" }));
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

describe("§5.4 figure-scoped undo/redo — 'undo follows the surface being edited'", () => {
  // The figure editor's auto-save contract ("no Save button — an undo exists") is
  // only honest if figure edits are undoable THERE. `undoFigure`/`redoFigure`
  // target the FIGURE's own doc (via its DocConnection), mirroring the routine
  // undo path (`undoLastChange`/`redoLastChange` against this tab's actor).

  const ACTOR_A = "00aa00aa00aa00aa";
  const ACTOR_B = "00bb00bb00bb00bb";
  const SEED_ACTOR = "00cc00cc00cc00cc"; // stands in for the server-side DO seed

  /** A routine (owned by "me") whose one section places `figureRef`. */
  const routineWith = (figureRef: string): A.Doc<RoutineDoc> =>
    buildRoutineDoc({
      id: "rt_sample",
      title: "R",
      dance: "waltz",
      ownerId: "me",
      sections: [
        {
          id: "s1",
          name: "S",
          deletedAt: null,
          placements: [{ id: "p1", figureRef, deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });

  const beat = (id: string, count: number, value: string): Attribute => ({
    id,
    kind: "step",
    count,
    value,
    role: null,
    deletedAt: null,
  });

  it("(a) undoFigure reverts the user's last figure edit and syncs the inverse on the FIGURE's socket", async () => {
    // Intent: the hero-flow safety net — a mis-tap in the step grid is recoverable,
    //   and the inverse rides the FIGURE doc's socket (not the routine's), §5.4.
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", {
      ...opts,
      currentUserId: "me",
      actor: ACTOR_A,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routineWith("fig1"));
    sockets.get("rt_sample")?.fireCaughtUp();
    store.readPlacements(); // opens the (lazy-in-eager-mode) figure connection

    // fig1 is account-owned by the current user → edits in place (no COW spawn).
    const figDoc = buildFigureDoc(
      aFigure({ id: "fig1", scope: "account", ownerId: "me", attributes: [] }),
    );
    sockets.get("fig1")?.fireOpen();
    sockets.get("fig1")?.load(figDoc);
    sockets.get("fig1")?.fireCaughtUp();

    store.setFigureAttributes("fig1", [beat("b-2-T", 2, "T")]);
    const before = store.readPlacements().find((p) => p.placement.figureRef === "fig1")?.figure;
    expect(before?.attributes.some((a) => a.value === "T" && a.deletedAt == null)).toBe(true);

    const sentBefore = sockets.get("fig1")?.sent.length ?? 0;
    const result = store.undoFigure("fig1");
    expect(result.undone).toBe(true);
    // The inverse SYNCED on the figure's own socket.
    expect(sockets.get("fig1")?.sent.length ?? 0).toBeGreaterThan(sentBefore);
    // …and the edit is reverted.
    const after = store.readPlacements().find((p) => p.placement.figureRef === "fig1")?.figure;
    expect(after?.attributes.some((a) => a.value === "T" && a.deletedAt == null)).toBe(false);
    store.close();
  });

  it("(b) routine undo() still targets the ROUTINE doc while a figure conn is open", async () => {
    // Intent: the two surfaces are independent — the routine toolbar's undo reverts
    //   a routine-doc edit even though a figure editor (its own doc) is also open.
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", {
      ...opts,
      currentUserId: "me",
      actor: ACTOR_A,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routineWith("fig1"));
    sockets.get("rt_sample")?.fireCaughtUp();
    store.readPlacements();
    const figDoc = buildFigureDoc(
      aFigure({ id: "fig1", scope: "account", ownerId: "me", attributes: [] }),
    );
    sockets.get("fig1")?.fireOpen();
    sockets.get("fig1")?.load(figDoc);
    sockets.get("fig1")?.fireCaughtUp();

    // One edit on EACH surface: a routine-doc rename and a figure-doc beat.
    store.renameSection("s1", "Verse");
    store.setFigureAttributes("fig1", [beat("b-1-T", 1, "T")]);

    // The ROUTINE undo reverts the section rename — the figure edit is untouched.
    const r = store.undo();
    expect(r.undone).toBe(true);
    expect(store.readRoutine().sections.find((s) => s.id === "s1")?.name).not.toBe("Verse");
    const fig = store.readPlacements().find((p) => p.placement.figureRef === "fig1")?.figure;
    expect(fig?.attributes.some((a) => a.value === "T" && a.deletedAt == null)).toBe(true);
    store.close();
  });

  it("(c) a peer's concurrent figure edit survives my figure-undo (US-038 AC-2 on the figure doc)", async () => {
    // Intent: per-actor undo on the figure doc inherits the domain guarantee —
    //   undoFigure reverts only MY beat; B's concurrent beat survives.
    const root = A.from(
      aFigure({ id: "fig1", scope: "account", ownerId: "me", attributes: [] }),
      SEED_ACTOR,
    );
    // A and B fork the same seed and each add a distinct beat — genuinely concurrent.
    const aDoc = A.change(A.clone(root, { actor: ACTOR_A }), (d) => {
      d.attributes.push(beat("beatA", 1, "A"));
    });
    const bDoc = A.change(A.clone(root, { actor: ACTOR_B }), (d) => {
      d.attributes.push(beat("beatB", 2, "B"));
    });
    const merged = A.merge(A.clone(aDoc), A.clone(bDoc));

    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", {
      ...opts,
      currentUserId: "me",
      actor: ACTOR_A,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routineWith("fig1"));
    sockets.get("rt_sample")?.fireCaughtUp();
    store.readPlacements();
    sockets.get("fig1")?.fireOpen();
    sockets.get("fig1")?.load(merged);
    sockets.get("fig1")?.fireCaughtUp();

    const result = store.undoFigure("fig1");
    expect(result.undone).toBe(true);
    const after = store.readPlacements().find((p) => p.placement.figureRef === "fig1")?.figure;
    // My beat is gone; the peer's concurrent beat survives.
    expect(after?.attributes.some((a) => a.value === "A" && a.deletedAt == null)).toBe(false);
    expect(after?.attributes.some((a) => a.value === "B" && a.deletedAt == null)).toBe(true);
    store.close();
  });

  it("(d) redoFigure restores the undone figure edit", async () => {
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", {
      ...opts,
      currentUserId: "me",
      actor: ACTOR_A,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routineWith("fig1"));
    sockets.get("rt_sample")?.fireCaughtUp();
    store.readPlacements();
    const figDoc = buildFigureDoc(
      aFigure({ id: "fig1", scope: "account", ownerId: "me", attributes: [] }),
    );
    sockets.get("fig1")?.fireOpen();
    sockets.get("fig1")?.load(figDoc);
    sockets.get("fig1")?.fireCaughtUp();

    store.setFigureAttributes("fig1", [beat("b-3-S", 3, "S")]);
    store.undoFigure("fig1");
    expect(
      store
        .readPlacements()
        .find((p) => p.placement.figureRef === "fig1")
        ?.figure?.attributes.some((a) => a.value === "S" && a.deletedAt == null),
    ).toBe(false);
    store.redoFigure("fig1");
    expect(
      store
        .readPlacements()
        .find((p) => p.placement.figureRef === "fig1")
        ?.figure?.attributes.some((a) => a.value === "S" && a.deletedAt == null),
    ).toBe(true);
    store.close();
  });

  it("(e) undoFigure on a catalog live-reference is a graceful no-op (⟳v5 §4.3)", async () => {
    // A catalog reference has no own connection and the user owns no changes on it
    //   (a user edit spawns a VARIANT) — figure-undo must be a quiet no-op, not throw.
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", {
      ...opts,
      currentUserId: "me",
      eagerFigures: false,
    });
    const ref = globalFigureRef("waltz", "natural-turn");
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routineWith(ref));
    sockets.get("rt_sample")?.fireCaughtUp();
    store.openFigure(ref); // no-op for a catalog ref: opens NO socket

    expect(store.undoFigure(ref)).toEqual({ undone: false, supersededByOthers: false });
    expect(() => store.redoFigure(ref)).not.toThrow();
    expect(sockets.has(ref)).toBe(false); // never opened a figure socket
    store.close();
  });

  it("(f) undoing a spawned variant's first owned-beat edit resolves it back to the base (§5.2)", async () => {
    // Intent (⟳v5): a fresh variant seeded server-side owns NOTHING; the user's first
    //   edit owns a beat. Undoing that edit leaves the variant owning nothing, so the
    //   beat resolves LIVE from the base again — correct per-beat-ownership behavior.
    const baseRef = globalFigureRef("waltz", "natural-turn");
    // The variant AS SEEDED server-side (SEED_ACTOR): identity + a LIVE base link,
    // owning no beats (untouched beats resolve live from the base, §2.5.2).
    const seeded = A.from(
      aFigure({
        id: "v1",
        scope: "account",
        ownerId: "me",
        figureType: "natural_turn",
        dance: "waltz",
        baseFigureRef: baseRef,
        attributes: [],
      }),
      SEED_ACTOR,
    );
    // The USER's FIRST edit: own count 1 with a leader direction that overrides the
    // base's (the catalog's leader count-1 direction is "forward"; owning the beat
    // hides ALL of the base's count-1 attributes — per-beat ownership, §2.5.1).
    const withEdit = A.change(A.clone(seeded, { actor: ACTOR_A }), (d) => {
      d.attributes.push({
        id: "own1",
        kind: "direction",
        count: 1,
        value: "side",
        role: "leader",
        deletedAt: null,
      });
    });
    const baseLeaderDir1 = (a: Attribute): boolean =>
      a.count === 1 && a.role === "leader" && a.kind === "direction" && a.value === "forward";

    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", {
      ...opts,
      currentUserId: "me",
      actor: ACTOR_A,
      eagerFigures: false,
    });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.load(routineWith("v1"));
    sockets.get("rt_sample")?.fireCaughtUp();
    store.openFigure("v1");
    sockets.get("v1")?.fireOpen();
    sockets.get("v1")?.load(withEdit);
    sockets.get("v1")?.fireCaughtUp();

    // Before undo: the variant OWNS beat 1 → resolved shows the user's own edit,
    // and the base's leader "forward" is hidden (the whole beat is variant-owned).
    const before = store.readPlacements().find((p) => p.placement.figureRef === "v1")?.figure;
    expect(before?.attributes.some((a) => a.id === "own1")).toBe(true);
    expect(before?.attributes.some(baseLeaderDir1)).toBe(false);

    const result = store.undoFigure("v1");
    expect(result.undone).toBe(true);

    // After undo the variant owns nothing at count 1 → it resolves LIVE from the
    // base (the bundled catalog Natural Turn): the user's edit is gone and the
    // base's own count-1 leader direction ("forward") shows through again.
    const after = store.readPlacements().find((p) => p.placement.figureRef === "v1")?.figure;
    expect(after?.attributes.some((a) => a.id === "own1")).toBe(false);
    expect(after?.attributes.some(baseLeaderDir1)).toBe(true);
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

describe("figure load status — loading vs missing vs error (the 'unknown figure' fix)", () => {
  /** A routine with one section + one placement referencing `figureRef`. */
  const routineWithFigure = (figureRef: string): A.Doc<RoutineDoc> =>
    buildRoutineDoc({
      id: "rt_status",
      title: "",
      dance: "waltz",
      ownerId: "",
      sections: [
        {
          id: "s1",
          name: "S",
          deletedAt: null,
          placements: [{ id: "p1", figureRef, deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });

  const statusOf = (store: Awaited<ReturnType<typeof openRoutine>>, figureRef: string) =>
    store.readPlacements().find((p) => p.placement.figureRef === figureRef)?.status;

  it("a figure whose connection gives up + is DENIED by the access preflight reads as 'missing'", async () => {
    const { opts, sockets } = fakeWiring();
    const checkAccess = vi.fn(async () => false); // 403 → denied/gone
    const store = await openRoutine("rt_status", {
      ...opts,
      checkAccess,
      reconnect: { delays: [1000], maxColdAttempts: 1 }, // one cold failure → terminal
    });
    sockets.get("rt_status")?.load(routineWithFigure("fgone"));

    // Reading opens the figure connection (lazy). Its handshake then fails cold.
    expect(statusOf(store, "fgone")).toBe("loading");
    sockets.get("fgone")?.close(); // closed before ever opening → cold → terminal

    // The preflight is consulted; once it resolves "denied", the figure is missing.
    await vi.waitFor(() => expect(statusOf(store, "fgone")).toBe("missing"));
    expect(checkAccess).toHaveBeenCalledWith("fgone");
    store.close();
  });

  it("a figure that times out hydrating reads as 'error' and retryFigure recovers it to 'live'", async () => {
    vi.useFakeTimers();
    try {
      const { opts, sockets } = fakeWiring();
      const store = await openRoutine("rt_status", {
        ...opts,
        hydrationTimeoutMs: 5000,
        // Keep reconnect from going terminal so the state stays "connecting".
        reconnect: { delays: [1000], maxColdAttempts: 99 },
      });
      sockets.get("rt_status")?.load(routineWithFigure("fslow"));

      // Opens the figure connection + arms the hydration timer; it never hydrates.
      expect(statusOf(store, "fslow")).toBe("loading");

      // The hydration timeout fires → escalates to a retryable error.
      vi.advanceTimersByTime(5000);
      expect(statusOf(store, "fslow")).toBe("error");

      // Retry forces a fresh connection; this time the figure hydrates → live.
      store.retryFigure("fslow");
      const figDoc = buildFigureDoc(aFigure({ id: "fslow", name: "Slow Turn" }));
      sockets.get("fslow")?.fireOpen();
      sockets.get("fslow")?.load(figDoc);
      sockets.get("fslow")?.fireCaughtUp();
      expect(statusOf(store, "fslow")).toBe("live");
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a connection that catches up with NO content reads as 'missing' (empty/nonexistent doc)", async () => {
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_status", opts);
    sockets.get("rt_status")?.load(routineWithFigure("fempty"));

    expect(statusOf(store, "fempty")).toBe("loading");
    // The figure DO replays an EMPTY history then signals caught-up: hydrated, but
    // there's no figure content → genuinely missing, not a perpetual skeleton.
    sockets.get("fempty")?.fireOpen();
    sockets.get("fempty")?.fireCaughtUp();
    expect(statusOf(store, "fempty")).toBe("missing");
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

describe("structural sharing — an annotation add must not churn structural identities", () => {
  it("keeps sections + the placements array reference-equal when only a note is added", async () => {
    // Intent: adding a note used to rematerialize the WHOLE routine with fresh
    //   object identities — every placement prop churned, the entire choreo
    //   re-rendered, and the reader lost their place. With reconcile-backed
    //   materialization, an annotation-only change leaves `sections` (and the
    //   readPlacements array) reference-equal — so only annotation surfaces see
    //   new props. Pins the store half of "only the note component updates".
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", { ...opts, currentUserId: "u1" });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.fireCaughtUp();
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
    store.readPlacements();
    sockets.get("fv")?.load(
      buildFigureDoc(
        aFigure({
          id: "fv",
          name: "My Turn",
          scope: "account",
          attributes: [{ id: "a1", kind: "rise", count: 1, value: "rise", deletedAt: null }],
        }),
      ),
    );

    const routineBefore = store.readRoutine();
    const placementsBefore = store.readPlacements();

    store.createAnnotation({
      kind: "note",
      text: "hold, don't rush",
      anchors: [{ type: "point", figureRef: "fv", count: 1 }],
    });

    const routineAfter = store.readRoutine();
    // The routine DID change (a note landed) …
    expect(routineAfter).not.toBe(routineBefore);
    expect(routineAfter.annotations).toHaveLength(1);
    expect(routineAfter.annotations[0]?.text).toBe("hold, don't rush");
    // … but every STRUCTURAL identity is preserved: same sections tree, same
    // placements array — nothing structural gets new props.
    expect(routineAfter.sections).toBe(routineBefore.sections);
    expect(store.readPlacements()).toBe(placementsBefore);
    store.close();
  });

  it("keeps prior annotation objects' identities when another note is added", async () => {
    const { opts, sockets } = fakeWiring();
    const store = await openRoutine("rt_sample", { ...opts, currentUserId: "u1" });
    sockets.get("rt_sample")?.fireOpen();
    sockets.get("rt_sample")?.fireCaughtUp();
    sockets.get("rt_sample")?.load(
      buildRoutineDoc({
        id: "rt_sample",
        title: "Sample",
        dance: "waltz",
        ownerId: "",
        sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [] }],
        annotations: [],
        schemaVersion: 1,
        deletedAt: null,
      }),
    );
    store.createAnnotation({ kind: "note", text: "first", anchors: [] });
    const first = store.readAnnotations()[0];
    store.createAnnotation({ kind: "note", text: "second", anchors: [] });
    const after = store.readAnnotations();
    expect(after).toHaveLength(2);
    // The untouched first note keeps its identity — its comment line can bail.
    expect(after.find((a) => a.text === "first")).toBe(first);
    store.close();
  });
});
