import { describe, expect, it } from "vitest";
import {
  FEATHER_FOXTROT,
  importDomain,
  makeAttribute,
  makePlacement,
  makeSection,
  SAMPLE_ROUTINE,
} from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-005 — Routine + figure document schemas [M1, system/developer]
// PLAN §2.2–2.6, §10.2: typed Automerge doc builders/readers; soft-delete is a
// mergeable deletedAt flip (never a hard removal).
//
// Product `doc-routine.ts` / `doc-figure.ts` (M1 §9 1.5) don't exist yet → the
// bodies dynamic-import them and feed the POJO fixtures (factories/sample). The
// helpers under test take/return in-memory Automerge docs.
// ─────────────────────────────────────────────────────────────────────────

describe("US-005 Routine + figure document schemas", () => {
  it("builds a routine doc with sections → ordered placements + annotations", async () => {
    // Intent: a routine Automerge doc round-trips the logical shape.
    // Arrange: SAMPLE_ROUTINE POJO. Act: buildRoutineDoc then readRoutine.
    // Assert: section order + placement.figureRef order preserved; annotations array present.
    // Covers AC-1 (sections → ordered placements + routine annotations).
    const { buildRoutineDoc, readRoutine } = await importDomain();
    const doc = buildRoutineDoc(SAMPLE_ROUTINE);
    const read = readRoutine(doc);
    expect(read.sections.map((s) => s.name)).toEqual(["Intro", "Body"]);
    expect(read.sections[0]?.placements.map((p) => p.figureRef)).toEqual([
      FEATHER_FOXTROT.id,
      "fig_threestep_foxtrot",
    ]);
    expect(Array.isArray(read.annotations)).toBe(true);
  });

  it("builds a figure doc carrying scope/figureType/dance/attributes/schemaVersion", async () => {
    // Intent: a figure Automerge doc round-trips its metadata + timeline.
    // Arrange: FEATHER_FOXTROT POJO. Act: buildFigureDoc then readFigure.
    // Assert: scope/figureType/dance/name preserved; attributes {id,kind,count,value} preserved.
    // Covers AC-2 (figure doc fields + attributes).
    const { buildFigureDoc, readFigure } = await importDomain();
    const read = readFigure(buildFigureDoc(FEATHER_FOXTROT));
    expect(read).toMatchObject({
      scope: "global",
      figureType: "feather",
      dance: "foxtrot",
      schemaVersion: 1,
    });
    expect(read.attributes.map((a) => a.count)).toEqual([1, 2, 3]);
  });

  it("soft-deletes via a mergeable deletedAt flip, never a hard removal", async () => {
    // Intent: removal is a tombstone the CRDT + overlay model both need (§2.1).
    // Arrange: a routine doc with one section. Act: softDeleteSection(id).
    // Assert: the section still EXISTS in the doc but reads as deleted (deletedAt set);
    //   a default read (excludeDeleted) omits it.
    // Covers AC-3 (soft-delete flip) + AC-4 (reads reflect the tombstone).
    const { buildRoutineDoc, softDeleteSection, readRoutine } = await importDomain();
    const section = makeSection({
      id: "sec_x",
      placements: [makePlacement(FEATHER_FOXTROT.id)],
    });
    let doc = buildRoutineDoc({ ...SAMPLE_ROUTINE, sections: [section] });
    doc = softDeleteSection(doc, "sec_x");
    expect(readRoutine(doc, { includeDeleted: true }).sections[0]?.deletedAt).toBeTruthy();
    expect(readRoutine(doc).sections).toHaveLength(0);
  });

  it("flips an attribute soft-delete on a figure doc", async () => {
    // Intent: attribute removal is also a tombstone (re-tap clears, US-028).
    // Arrange: a figure doc with one attribute. Act: softDeleteAttribute.
    // Assert: attribute reads as deleted; default read omits it.
    // Covers AC-3 at the attribute grain.
    const { buildFigureDoc, softDeleteAttribute, readFigure } = await importDomain();
    const fig = { ...FEATHER_FOXTROT, attributes: [makeAttribute({ id: "a1", count: 1 })] };
    let doc = buildFigureDoc(fig);
    doc = softDeleteAttribute(doc, "a1");
    expect(readFigure(doc).attributes).toHaveLength(0);
  });

  // ── Extra edge cases (in the spirit of US-005, beyond the listed ACs) ──

  it("round-trips a figure's baseFigureRef + legacy overlay field", async () => {
    // Intent: a figure's `baseFigureRef` provenance survives the Automerge
    // build/read round-trip, and the LEGACY `overlay` field (retained only for
    // old persisted docs — no longer resolved, §2.5.1 #14) round-trips
    // structurally so a pre-reconciliation doc still reads back intact.
    const { buildFigureDoc, readFigure } = await importDomain();
    const variant = {
      ...FEATHER_FOXTROT,
      id: "fig_variant",
      scope: "account" as const,
      ownerId: "user_x",
      source: "custom" as const,
      attributes: [],
      baseFigureRef: FEATHER_FOXTROT.id,
      overlay: {
        overrides: { a_ff_2: "TH" },
        tombstones: ["a_ff_3"],
        additions: [makeAttribute({ id: "a_add", kind: "sway", count: 2, value: "to_L" })],
        rename: "My Feather",
      },
    };
    const read = readFigure(buildFigureDoc(variant));
    expect(read.baseFigureRef).toBe(FEATHER_FOXTROT.id);
    expect(read.overlay?.overrides).toEqual({ a_ff_2: "TH" });
    expect(read.overlay?.tombstones).toEqual(["a_ff_3"]);
    expect(read.overlay?.additions.map((a) => a.id)).toEqual(["a_add"]);
    expect(read.overlay?.rename).toBe("My Feather");
  });

  it("soft-deletes a single placement, leaving siblings live", async () => {
    // Intent: tombstones filter at the placement grain too — deleting one
    // placement must not drop the section or its other placements.
    const { buildRoutineDoc, readRoutine } = await importDomain();
    const section = makeSection({
      id: "sec_p",
      placements: [
        makePlacement(FEATHER_FOXTROT.id, { id: "p_keep" }),
        makePlacement(FEATHER_FOXTROT.id, { id: "p_drop", deletedAt: Date.now() }),
      ],
    });
    const doc = buildRoutineDoc({ ...SAMPLE_ROUTINE, sections: [section] });
    const read = readRoutine(doc);
    expect(read.sections[0]?.placements.map((p) => p.id)).toEqual(["p_keep"]);
    expect(readRoutine(doc, { includeDeleted: true }).sections[0]?.placements).toHaveLength(2);
  });

  it("does not mutate the input fixture when building a doc", async () => {
    // Intent: buildRoutineDoc must not adopt or mutate the (frozen) POJO.
    const { buildRoutineDoc, softDeleteSection } = await importDomain();
    const section = makeSection({ id: "sec_imm", placements: [] });
    const input = { ...SAMPLE_ROUTINE, sections: [section] };
    const doc = buildRoutineDoc(input);
    softDeleteSection(doc, "sec_imm");
    // The original POJO is untouched by the soft-delete on the Automerge doc.
    expect(input.sections[0]?.deletedAt).toBeFalsy();
  });
});
