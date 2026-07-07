import { describe, expect, it } from "vitest";
import { buildFigureDoc, readFigure } from "./doc-figure";
import type { Attribute, FigureDoc } from "./doc-types";
import { isSeededAttributeId, reconcileSeededFigure } from "./seed-reconcile";

// ─────────────────────────────────────────────────────────────────────────
// D30 ⟳ (owner decision 2026-07-07): the SEED is authoritative for seeded
// content. Re-running the seeder reconciles an existing global figure doc to
// the current bundle: seeded attributes (deterministic `fig-`/`wdsf-` ids)
// are updated/added/tombstoned to match the seed, while user/admin-ADDED
// attributes (client ULIDs) are preserved — so existing choreos are enhanced
// by corrections, never broken. Single-writer: the reconcile runs only inside
// the figure's own DO, so its deterministic ids can't race across replicas.
// ─────────────────────────────────────────────────────────────────────────

const seededAttr = (id: string, value: string, count = 1): Attribute => ({
  id,
  kind: "footwork",
  count,
  role: "leader",
  value,
  deletedAt: null,
});

const baseFigure = (attributes: Attribute[]): FigureDoc => ({
  id: "global:waltz:test-fig",
  scope: "global",
  ownerId: "app",
  figureType: "test-fig",
  dance: "waltz",
  name: "Test Figure",
  source: "library",
  counts: 3,
  attributes,
  schemaVersion: 5,
  deletedAt: null,
});

describe("isSeededAttributeId", () => {
  it("matches only the seeder's deterministic id prefixes", () => {
    expect(isSeededAttributeId("fig-natural-turn-waltz-leader-s1-dir")).toBe(true);
    expect(isSeededAttributeId("wdsf-natural-turn-waltz-s1")).toBe(true);
    // Client-generated ULIDs (user-added attributes) are never seed-owned.
    expect(isSeededAttributeId("01J9SQ9WTSCGGCVJK4VDAD2D")).toBe(false);
  });
});

describe("reconcileSeededFigure — the seed is authoritative for seeded content", () => {
  it("updates a seeded attribute whose value the seed corrected", () => {
    const doc = buildFigureDoc(baseFigure([seededAttr("fig-test-s1-foot", "HT")]));
    const { doc: after, changed } = reconcileSeededFigure(doc, {
      name: "Test Figure",
      counts: 3,
      attributes: [seededAttr("fig-test-s1-foot", "H flat")],
    });
    expect(changed).toBe(true);
    expect(readFigure(after).attributes).toEqual([
      expect.objectContaining({ id: "fig-test-s1-foot", value: "H flat" }),
    ]);
  });

  it("adds newly-seeded attributes and tombstones seeded ones the seed dropped", () => {
    const doc = buildFigureDoc(baseFigure([seededAttr("fig-test-s1-foot", "HT")]));
    const { doc: after } = reconcileSeededFigure(
      doc,
      {
        name: "Test Figure",
        counts: 3,
        attributes: [seededAttr("fig-test-s2-foot", "TH", 2)],
      },
      { now: 1234 },
    );
    const all = readFigure(after, { includeDeleted: true }).attributes;
    expect(all.find((a) => a.id === "fig-test-s2-foot")).toMatchObject({ value: "TH" });
    // Soft-deleted, never removed (the cardinal tombstone rule).
    expect(all.find((a) => a.id === "fig-test-s1-foot")?.deletedAt).toBe(1234);
  });

  it("preserves user-added (ULID) attributes untouched", () => {
    const user: Attribute = {
      id: "01J9SQUSERATTRIBUTE000000",
      kind: "sway",
      count: 1,
      role: "leader",
      value: "to_L",
      deletedAt: null,
    };
    const doc = buildFigureDoc(baseFigure([seededAttr("fig-test-s1-foot", "HT"), user]));
    const { doc: after } = reconcileSeededFigure(doc, {
      name: "Test Figure",
      counts: 3,
      attributes: [seededAttr("fig-test-s1-foot", "H flat")],
    });
    expect(readFigure(after).attributes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: user.id, value: "to_L" })]),
    );
  });

  it("restores a seeded attribute an admin tombstoned (seed wins for seeded ids)", () => {
    const doc = buildFigureDoc(
      baseFigure([{ ...seededAttr("fig-test-s1-foot", "HT"), deletedAt: 99 }]),
    );
    const { doc: after } = reconcileSeededFigure(doc, {
      name: "Test Figure",
      counts: 3,
      attributes: [seededAttr("fig-test-s1-foot", "HT")],
    });
    expect(readFigure(after).attributes).toEqual([
      expect.objectContaining({ id: "fig-test-s1-foot", deletedAt: null }),
    ]);
  });

  it("updates the doc-level name / counts / alignments from the seed", () => {
    const doc = buildFigureDoc(baseFigure([seededAttr("fig-test-s1-foot", "HT")]));
    const { doc: after } = reconcileSeededFigure(doc, {
      name: "Renamed Figure",
      counts: 6,
      entryAlignment: { qualifier: "facing", direction: "DW" },
      attributes: [seededAttr("fig-test-s1-foot", "HT")],
    });
    const read = readFigure(after);
    expect(read.name).toBe("Renamed Figure");
    expect(read.counts).toBe(6);
    expect(read.entryAlignment).toEqual({ qualifier: "facing", direction: "DW" });
  });

  it("is idempotent: a doc already matching the seed reports changed:false", () => {
    const doc = buildFigureDoc(baseFigure([seededAttr("fig-test-s1-foot", "HT")]));
    const seed = {
      name: "Test Figure",
      counts: 3,
      attributes: [seededAttr("fig-test-s1-foot", "HT")],
    };
    const first = reconcileSeededFigure(doc, seed);
    expect(first.changed).toBe(false);
    expect(first.doc).toBe(doc); // no empty change appended
  });
});
