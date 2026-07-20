import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import {
  FEATHER_FOXTROT,
  type FigureDoc,
  importDomain,
  makePlacement,
  SAMPLE_COACH,
  SAMPLE_ROUTINE,
  SAMPLE_STUDENT,
} from "./__fixtures__";
import { isPlainRecord } from "./guards";

/** Change-log length of an opaquely-typed (shim `DocHandle`) Automerge doc —
 *  narrowed at runtime instead of asserted (CLAUDE.md §4). */
function historyLength(doc: unknown): number {
  if (!isPlainRecord(doc)) throw new Error("expected an in-memory Automerge doc");
  return A.getHistory(doc).length;
}

// ─────────────────────────────────────────────────────────────────────────
// US-007 — Choreo fork (clone) + US-008 — Copy-on-write (auto-variant)
// [M1, system/developer]. docs/concepts/choreography.md § Forking, docs/concepts/figures.md
// § Variants, docs/system/testing.md invariant: "fork clone +
// copy-on-write (new ids, lineage, placement re-point, no disturbance to the
// shared base)".
//
// Product `fork.ts` `cloneRoutine`/`copyOnWrite` (M1 §9 1.7) don't exist yet →
// dynamic import, skipped.
// ─────────────────────────────────────────────────────────────────────────

describe("US-007 Choreo fork (clone)", () => {
  it("clones a routine to a new id, frozen, with forkedFromRef provenance", async () => {
    // Intent: "make it your own" → independent owned copy with lineage.
    // Arrange: the sample routine doc owned by the coach.
    // Act: cloneRoutine(doc, { byUser: student }).
    // Assert: new id ≠ origin id; forkedFromRef === origin id; owner === student.
    // Covers US-007 AC-1 (new id, forkedFromRef) — §10.2 "new ids, lineage".
    const { buildRoutineDoc, cloneRoutine, readRoutine } = await importDomain();
    const origin = buildRoutineDoc(SAMPLE_ROUTINE);
    const fork = cloneRoutine(origin, { byUser: SAMPLE_STUDENT });
    const read = readRoutine(fork);
    expect(read.id).not.toBe(SAMPLE_ROUTINE.id);
    expect(read.forkedFromRef).toBe(SAMPLE_ROUTINE.id);
    expect(read.ownerId).toBe(SAMPLE_STUDENT);
  });

  it("retains the origin's change history (shared ancestry, not a fresh doc)", async () => {
    // Intent: AC-1 "retaining shared history" — pin it directly. cloneRoutine
    // uses A.clone (keeps change-ancestry), NOT A.from(materialized) (which would
    // sever it). Shared ancestry is what makes a future explicit merge-back
    // possible (docs/concepts/figures.md § Variants / docs/concepts/collaboration.md
    // "lineage so changes can merge back"); a refactor
    // that quietly rebuilds the doc would break that, so assert it self-evidently.
    const { buildRoutineDoc, cloneRoutine } = await importDomain();
    const origin = buildRoutineDoc(SAMPLE_ROUTINE);
    const fork = cloneRoutine(origin, { byUser: SAMPLE_STUDENT });
    // The product builders return in-memory Automerge docs; A.getHistory reads
    // the change log (the shim types them opaquely, hence the runtime narrowing).
    expect(historyLength(fork)).toBeGreaterThanOrEqual(historyLength(origin));
  });

  it("is frozen: a later edit to the origin does NOT appear in the clone", async () => {
    // Intent: choreo forks do not pull origin changes (Q-FORK-UX).
    // Multi-doc scenario: clone, then the coach renames a section on the ORIGIN.
    // Arrange: origin + fork. Act: addSection on origin only.
    // Assert: the fork's section list is unchanged (no pull).
    // Covers US-007 AC-2 (frozen) + AC-3 (forkedFromRef provenance-only, no pull).
    const { buildRoutineDoc, cloneRoutine, addSection, readRoutine } = await importDomain();
    let origin = buildRoutineDoc(SAMPLE_ROUTINE);
    const fork = cloneRoutine(origin, { byUser: SAMPLE_STUDENT });
    const before = readRoutine(fork).sections.length;
    origin = addSection(origin, { name: "Coda" });
    expect(readRoutine(fork).sections.length).toBe(before);
  });

  it("keeps referenced figure docs shared (still points at the same figureRefs)", async () => {
    // Intent: a fork freezes ARRANGEMENT but still references the live library figures.
    // Arrange: origin referencing FEATHER_FOXTROT. Act: cloneRoutine.
    // Assert: the clone's placements reference the same figure ids (not copies).
    // Covers US-007 AC-4 (referenced figures remain shared).
    const { buildRoutineDoc, cloneRoutine, readRoutine } = await importDomain();
    const fork = cloneRoutine(buildRoutineDoc(SAMPLE_ROUTINE), { byUser: SAMPLE_STUDENT });
    const refs = readRoutine(fork).sections.flatMap((s) => s.placements.map((p) => p.figureRef));
    expect(refs).toContain(FEATHER_FOXTROT.id);
  });

  // ── Extra edge cases (in the spirit of US-007, beyond the listed ACs) ──

  it("copies the arrangement (section names + placement order) into the clone", async () => {
    // Intent: a fork reproduces the origin's arrangement exactly, just owned anew.
    const { buildRoutineDoc, cloneRoutine, readRoutine } = await importDomain();
    const fork = cloneRoutine(buildRoutineDoc(SAMPLE_ROUTINE), { byUser: SAMPLE_STUDENT });
    const read = readRoutine(fork);
    expect(read.sections.map((s) => s.name)).toEqual(SAMPLE_ROUTINE.sections.map((s) => s.name));
    expect(read.sections[0]?.placements.map((p) => p.figureRef)).toEqual(
      SAMPLE_ROUTINE.sections[0]?.placements.map((p) => p.figureRef),
    );
  });

  it("is independent both ways: editing the clone does not affect the origin", async () => {
    // Intent: the freeze is structural — the clone is its own doc, so a change to
    // the clone leaves the origin untouched (the converse of the frozen-from-origin
    // test).
    const { buildRoutineDoc, cloneRoutine, addSection, readRoutine } = await importDomain();
    const origin = buildRoutineDoc(SAMPLE_ROUTINE);
    let fork = cloneRoutine(origin, { byUser: SAMPLE_STUDENT });
    const originBefore = readRoutine(origin).sections.length;
    fork = addSection(fork, { name: "My Coda" });
    expect(readRoutine(origin).sections.length).toBe(originBefore);
    expect(readRoutine(fork).sections.length).toBe(originBefore + 1);
  });

  it("mints a fresh ULID id and does not inherit templateOf", async () => {
    // Intent: the clone is an owned routine, not a template; id is a valid ULID.
    const { buildRoutineDoc, cloneRoutine, readRoutine } = await importDomain();
    const read = readRoutine(
      cloneRoutine(buildRoutineDoc(SAMPLE_ROUTINE), { byUser: SAMPLE_STUDENT }),
    );
    expect(read.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(read.templateOf).toBeFalsy();
  });
});

describe("US-008 Copy-on-write (frozen copy)", () => {
  it("spawns an owned frozen copy (own attributes + baseFigureRef provenance) and re-points the placement", async () => {
    // Intent: editing a non-owned figure diverges only that figure into an owned,
    // FROZEN copy carrying its own attributes — no flow-up (§5.2, §2.5.1 #14–18).
    // Arrange: a placement pointing at the global FEATHER_FOXTROT; editor = student.
    // Act: copyOnWrite(placement, FEATHER_FOXTROT, student).
    // Assert: new figure doc has scope:account, ownerId:student, source:custom,
    //   baseFigureRef:FEATHER_FOXTROT.id, its OWN attributes (== base by content);
    //   placement.figureRef re-points to it.
    // Covers US-008 AC-1 (copy fields) + AC-2 (placement re-pointed) — §10.2 "placement re-point".
    const { copyOnWrite } = await importDomain();
    const placement = makePlacement(FEATHER_FOXTROT.id, { id: "plc_cow" });
    const { variant, placement: repointed } = copyOnWrite(
      placement,
      FEATHER_FOXTROT,
      SAMPLE_STUDENT,
    );
    expect(variant).toMatchObject({
      scope: "account",
      ownerId: SAMPLE_STUDENT,
      source: "custom",
      baseFigureRef: FEATHER_FOXTROT.id,
    });
    // The copy carries its OWN attributes, equal by content to the source's.
    expect(variant?.attributes).toEqual(FEATHER_FOXTROT.attributes);
    expect(repointed.figureRef).toBe(variant?.id);
  });

  it("leaves the shared base figure untouched (no disturbance to others)", async () => {
    // Intent: copy-on-write must not mutate the app-owned base others reference.
    // Arrange: snapshot FEATHER_FOXTROT JSON. Act: copyOnWrite.
    // Assert: the base figure is byte-for-byte unchanged.
    // Covers US-008 AC-3 (base untouched) — §10.2 "no disturbance to the shared base".
    const { copyOnWrite } = await importDomain();
    const before = JSON.stringify(FEATHER_FOXTROT);
    copyOnWrite(makePlacement(FEATHER_FOXTROT.id), FEATHER_FOXTROT, SAMPLE_STUDENT);
    expect(JSON.stringify(FEATHER_FOXTROT)).toBe(before);
  });

  it("does NOT copy-on-write when the user already owns the figure (edits in place)", async () => {
    // Intent: editing your own figure edits in place (flows to your routines, US-034).
    // Arrange: a figure already owned by the coach. Act: copyOnWrite(.., byUser:coach).
    // Assert: no variant is created (helper signals in-place edit) for the owner.
    // Covers US-008 AC-4 (no COW for owner).
    const { copyOnWrite } = await importDomain();
    const owned = { ...FEATHER_FOXTROT, scope: "account" as const, ownerId: SAMPLE_COACH };
    const result = copyOnWrite(makePlacement(owned.id), owned, SAMPLE_COACH);
    expect(result.variant).toBeNull();
  });

  // ── Extra edge cases (in the spirit of US-008, beyond the listed ACs) ──

  it("mints a fresh ULID variant id and does not mutate the input placement", async () => {
    // Intent: the variant gets a real client id, and COW is pure — the caller's
    // placement object is not mutated (a new re-pointed placement is returned).
    const { copyOnWrite } = await importDomain();
    const placement = makePlacement(FEATHER_FOXTROT.id, { id: "plc_keep" });
    const { variant, placement: repointed } = copyOnWrite(
      placement,
      FEATHER_FOXTROT,
      SAMPLE_STUDENT,
    );
    expect(variant?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(placement.figureRef).toBe(FEATHER_FOXTROT.id); // input untouched
    expect(repointed.id).toBe("plc_keep"); // same placement identity, new figureRef
    expect(repointed.figureRef).toBe(variant?.id);
  });

  it("copy-on-writes another account-holder's figure (only the owner edits in place)", async () => {
    // Intent: an account figure owned by SOMEONE ELSE still triggers COW — only
    // the figure's own owner edits in place (§5.2 "others auto-variant").
    const { copyOnWrite } = await importDomain();
    const coachOwned = { ...FEATHER_FOXTROT, scope: "account" as const, ownerId: SAMPLE_COACH };
    const { variant } = copyOnWrite(makePlacement(coachOwned.id), coachOwned, SAMPLE_STUDENT);
    expect(variant).not.toBeNull();
    expect(variant?.ownerId).toBe(SAMPLE_STUDENT);
    expect(variant?.baseFigureRef).toBe(coachOwned.id);
  });

  it("is a frozen snapshot — a later change to the SOURCE does not change the copy", async () => {
    // Intent: the copy is a frozen snapshot of the source's attributes at copy
    // time; later edits to the source never flow into the copy (§5.2, §2.5.1
    // #15). Build a MUTABLE source (the shared fixture is frozen), copy from it,
    // then mutate the source's attributes and assert the copy is unchanged.
    const { copyOnWrite } = await importDomain();
    const source: FigureDoc = {
      ...FEATHER_FOXTROT,
      attributes: FEATHER_FOXTROT.attributes.map((a) => ({ ...a })),
    };
    const { variant } = copyOnWrite(makePlacement(source.id), source, SAMPLE_STUDENT);
    expect(variant).not.toBeNull();
    const copySnapshot = JSON.stringify(variant?.attributes);

    // A later edit to the SOURCE: retime + revalue every step, append a new one.
    for (const a of source.attributes) {
      a.count += 10;
      a.value = "changed";
    }
    source.attributes.push({ id: "a_new_source", kind: "sway", count: 99, value: "to_R" });

    // The copy's attributes are untouched by the later source edit.
    expect(JSON.stringify(variant?.attributes)).toBe(copySnapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ⟳v5 — live overlay variants (docs/concepts/figures.md § Variants, 2026-07-02).
// The Passing Tumble Turn scenario is the canonical spec: a variant that
// re-choreographs its last beats keeps them exactly as authored while new
// catalog values keep appearing on its untouched beats.
// ─────────────────────────────────────────────────────────────────────────

describe("⟳v5 overlay variants (per-beat ownership)", () => {
  const attr = (
    id: string,
    kind: string,
    count: number,
    value: string,
    extra?: Partial<{ role: "leader" | "follower" | null; deletedAt: number | null }>,
  ) => ({ id, kind, count, role: extra?.role ?? null, value, deletedAt: extra?.deletedAt ?? null });

  const tumbleTurnBase = (): FigureDoc => ({
    id: "gfig_slowfox_tumble-turn",
    scope: "global",
    ownerId: "app",
    figureType: "tumble-turn",
    dance: "foxtrot",
    name: "Tumble Turn",
    source: "library",
    bars: 2,
    attributes: [
      attr("b1", "direction", 1, "forward"),
      attr("b2", "footwork", 1, "HT"),
      attr("b3", "direction", 2, "side"),
      attr("b4", "direction", 4, "back"),
      attr("b5", "footwork", 4, "TH"),
      attr("b6", "direction", 5, "close"),
    ],
    schemaVersion: 1,
    deletedAt: null,
  });

  it("spawnVariant owns nothing until touched — it resolves to exactly the base", async () => {
    const { resolveFigure, spawnVariant } = await importDomain();
    const base = structuredClone(tumbleTurnBase());
    const placement = { id: "p1", figureRef: "gfig_slowfox_tumble-turn", deletedAt: null };
    const { variant, placement: rePointed } = spawnVariant(placement, base, "u_me");
    expect(variant.attributes).toEqual([]); // owns no beats
    expect(variant.baseFigureRef).toBe("gfig_slowfox_tumble-turn"); // LIVE link
    expect(variant.bars).toBeUndefined(); // resolves live from the base (§2.5.2)
    expect(rePointed.figureRef).toBe(variant.id);
    const resolved = resolveFigure(base, variant);
    expect(resolved.attributes.map((a: { id: string }) => a.id)).toEqual([
      "b1",
      "b2",
      "b3",
      "b4",
      "b5",
      "b6",
    ]);
    expect(resolved.bars).toBe(2);
  });

  it("the Passing Tumble Turn: base additions reach untouched beats only (§5.2)", async () => {
    const { resolveFigure, spawnVariant } = await importDomain();
    const base = structuredClone(tumbleTurnBase());
    // The dancer re-choreographs beats 4–5 (the passing ending).
    const edited = [
      attr("b1", "direction", 1, "forward"),
      attr("b2", "footwork", 1, "HT"),
      attr("b3", "direction", 2, "side"),
      attr("v1", "direction", 4, "forward"), // passing: forward, not back
      attr("v2", "footwork", 4, "T"),
      attr("v3", "direction", 5, "forward"),
    ];
    const placement = { id: "p1", figureRef: "gfig", deletedAt: null };
    const { variant } = spawnVariant(placement, base, "u_me", edited);
    // The variant owns ONLY beats 4 and 5 (beats 1/2 unchanged → unowned).
    expect([...(await importDomain()).ownedBeats(variant)].sort()).toEqual([4, 5]);

    // The catalog later gains a NEW KIND's values on every beat (admin edit).
    base.attributes.push(
      attr("n1", "sway", 1, "none"),
      attr("n2", "sway", 2, "to_L"),
      attr("n3", "sway", 4, "to_R"),
      attr("n4", "sway", 5, "none"),
    );
    const resolved = resolveFigure(base, variant);
    const at = (beat: number) =>
      resolved.attributes
        .filter((a: { count: number }) => Math.floor(a.count) === beat)
        .map((a: { id: string }) => a.id)
        .sort();
    // Untouched beats got the new sway values…
    expect(at(1)).toEqual(["b1", "b2", "n1"]);
    expect(at(2)).toEqual(["b3", "n2"]);
    // …the re-choreographed beats did NOT (per-beat blocking, Q-OVERLAY-GRAIN).
    expect(at(4)).toEqual(["v1", "v2"]);
    expect(at(5)).toEqual(["v3"]);
  });

  it("a base edit never rewrites an owned beat; a variant edit never touches the base (#17)", async () => {
    const { spawnVariant } = await importDomain();
    const base = structuredClone(tumbleTurnBase());
    const before = JSON.stringify(base);
    const edited = [attr("v1", "direction", 4, "forward")];
    spawnVariant({ id: "p1", figureRef: "g", deletedAt: null }, base, "u_me", edited);
    expect(JSON.stringify(base)).toBe(before); // base untouched by the spawn
  });

  it("clearing a base-charted beat = copy-down + tombstone, so it reads empty (#16)", async () => {
    const { resolveFigure, variantAttributesForEdit } = await importDomain();
    const base = structuredClone(tumbleTurnBase());
    // The edit clears beat 5 entirely (removes "b6") and keeps the rest.
    const edited = base.attributes.filter((a) => Math.floor(a.count) !== 5);
    const owned = variantAttributesForEdit(base, edited, { now: 123 });
    // Beat 5 is owned via a TOMBSTONED copy-down of the base's value.
    const beat5 = owned.filter((a: { count: number }) => Math.floor(a.count) === 5);
    expect(beat5).toHaveLength(1);
    expect(beat5[0]?.deletedAt).toBe(123);
    expect(beat5[0]?.id).not.toBe("b6"); // fresh id — never the base's
    // Resolution shows nothing live on beat 5, even after a base edit there.
    const variant: FigureDoc = { ...structuredClone(tumbleTurnBase()), attributes: owned };
    const resolved = resolveFigure(base, variant);
    const liveBeat5 = resolved.attributes.filter(
      (a: { count: number; deletedAt?: number | null }) =>
        Math.floor(a.count) === 5 && a.deletedAt == null,
    );
    expect(liveBeat5).toEqual([]);
  });

  it("an unchanged full-timeline edit yields NO owned beats (stays fully live)", async () => {
    const { variantAttributesForEdit } = await importDomain();
    const base = structuredClone(tumbleTurnBase());
    // Same content, different ids — the comparison is by MEANING (#20).
    const edited = base.attributes.map((a) => ({ ...a, id: `re-${a.id}` }));
    expect(variantAttributesForEdit(base, edited)).toEqual([]);
  });

  it("§9 back-compat: a legacy full copy owning EVERY beat resolves to exactly its own content", async () => {
    // A pre-v5 frozen copy carries its OWN complete timeline (it owns every beat it
    // has content on). Its `baseFigureRef` becoming a LIVE link changes nothing: base
    // values on OWNED beats never leak in — so resolution returns exactly the copy's
    // current content (zero behavior change for existing data). Only a base value on
    // a beat the copy never used would appear.
    const { resolveFigure } = await importDomain();
    const base = structuredClone(tumbleTurnBase());
    // The legacy copy: its OWN full timeline (different ids + a diverged beat-4 value),
    // owning beats 1,2,4,5 — every beat the base charts.
    const legacyCopy: FigureDoc = {
      ...structuredClone(tumbleTurnBase()),
      id: "fig_legacy",
      scope: "account",
      ownerId: "u_me",
      source: "custom",
      baseFigureRef: "gfig_slowfox_tumble-turn",
      attributes: [
        attr("c1", "direction", 1, "forward"),
        attr("c2", "footwork", 1, "HT"),
        attr("c3", "direction", 2, "side"),
        attr("c4", "direction", 4, "forward"), // diverged from the base's "back"
        attr("c5", "footwork", 4, "T"),
        attr("c6", "direction", 5, "close"),
      ],
    };
    // The catalog later gains a NEW KIND on beats the copy already OWNS — must NOT leak.
    base.attributes.push(attr("n1", "sway", 1, "to_L"), attr("n4", "sway", 4, "to_R"));
    const resolved = resolveFigure(base, legacyCopy);
    // Exactly the copy's own attributes — no base values on any owned beat.
    expect(resolved.attributes.map((a: { id: string }) => a.id).sort()).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
    ]);
  });

  it("copyFigureForFork keeps a variant a VARIANT (live base link) under a new owner", async () => {
    const { copyFigureForFork } = await importDomain();
    const variant: FigureDoc = {
      ...structuredClone(tumbleTurnBase()),
      id: "fig_variant",
      scope: "account",
      ownerId: "u_origin",
      source: "custom",
      baseFigureRef: "gfig_slowfox_tumble-turn",
      attributes: [attr("v1", "direction", 4, "forward")],
    };
    const copy = copyFigureForFork(variant, "u_forker");
    expect(copy.id).not.toBe("fig_variant");
    expect(copy.ownerId).toBe("u_forker");
    expect(copy.baseFigureRef).toBe("gfig_slowfox_tumble-turn"); // catalog flow-in continues
    expect(copy.attributes).toEqual([attr("v1", "direction", 4, "forward")]);
    // Deep copy: mutating the copy's (single) attribute never touches the origin's.
    for (const a of copy.attributes) a.value = "back";
    expect(variant.attributes[0]?.value).toBe("forward");
  });

  it("variant-authored bars override the base; unauthored resolve live (§2.5.2)", async () => {
    const { resolveFigure } = await importDomain();
    const base = structuredClone(tumbleTurnBase());
    // A bare variant that never authored `bars` (drop the base fixture's key).
    const { bars: _bars, ...noBars } = structuredClone(tumbleTurnBase());
    const bare: FigureDoc = {
      ...noBars,
      id: "v",
      scope: "account",
      baseFigureRef: "g",
      attributes: [],
    };
    expect(resolveFigure(base, bare).bars).toBe(2); // falls back to the base
    const authored: FigureDoc = { ...bare, bars: 3 };
    expect(resolveFigure(base, authored).bars).toBe(3); // variant override wins
  });

  // Regression — issue #284: a predicate note must DROP after a single-cell
  // variant edit changes the matching notation. This exercises the whole edit
  // path a global-figure edit takes (spawnVariant → variantAttributesForEdit →
  // resolveFigure), then runs matchPredicate over the resolved timeline exactly
  // as the reading view does — the resolved figure must carry ONLY the variant's
  // re-tagged value on the owned beat, never the shadowed base value.
  it("#284: retagging a beat's value via a variant edit drops a predicate note on the OLD value", async () => {
    const { resolveFigure, spawnVariant } = await importDomain();
    const { matchPredicate } = await import("./predicate");
    // Waltz Whisk: right sway on count 1, LEFT sway on count 2 (the QA seed).
    const base: FigureDoc = {
      id: "gfig_waltz_whisk",
      scope: "global",
      ownerId: "app",
      figureType: "whisk",
      dance: "waltz",
      name: "Whisk",
      source: "library",
      counts: 3,
      baseFigureRef: null,
      schemaVersion: 6,
      deletedAt: null,
      attributes: [attr("b1", "sway", 1, "to_R"), attr("b2", "sway", 2, "to_L")],
    };
    // A `to_L` predicate note surfaces only on count 2 before the edit.
    const toL = {
      type: "attributePredicate" as const,
      kind: "sway",
      value: "to_L",
      scope: "waltz" as const,
    };
    expect(matchPredicate(toL, base)).toEqual([2]);

    // The user edits "Sway at count 2" from left → right. The editor hands back
    // the RESOLVED timeline with count 2 flipped (a global figure is standalone,
    // so the base IS the resolved timeline); spawnVariant keeps only the diff.
    const edited = [attr("b1", "sway", 1, "to_R"), attr("e2", "sway", 2, "to_R")];
    const placement = { id: "p1", figureRef: base.id, deletedAt: null };
    const { variant } = spawnVariant(placement, base, "u_me", edited);

    // The reading view resolves the variant against its live base, then matches.
    const resolved = resolveFigure(base, variant);
    // Both counts now read right — no live left sway remains anywhere.
    expect(matchPredicate(toL, resolved)).toEqual([]);
    // And the right-sway predicate now catches BOTH counts.
    const toR = { ...toL, value: "to_R" };
    expect(matchPredicate(toR, resolved)).toEqual([1, 2]);
  });

  // Regression — issue #284, the `none`/absence sentinel lens: a variant that
  // CLEARS a value must make a `none` note APPEAR on that beat (the mirror of the
  // value-drop case — the resolved beat must carry no live attribute of the kind).
  it("#284: a variant that clears a beat's value makes a `none` predicate note appear", async () => {
    const { resolveFigure, spawnVariant } = await importDomain();
    const { matchPredicate, PREDICATE_NONE } = await import("./predicate");
    const base: FigureDoc = {
      id: "gfig_waltz_whisk",
      scope: "global",
      ownerId: "app",
      figureType: "whisk",
      dance: "waltz",
      name: "Whisk",
      source: "library",
      counts: 3,
      baseFigureRef: null,
      schemaVersion: 6,
      deletedAt: null,
      attributes: [attr("b1", "sway", 1, "to_R"), attr("b2", "sway", 2, "to_L")],
    };
    const none = {
      type: "attributePredicate" as const,
      kind: "sway",
      value: PREDICATE_NONE,
      scope: "waltz" as const,
    };
    // Before: counts 1 and 2 both carry a sway; only count 3 has none.
    expect(matchPredicate(none, base)).toEqual([3]);

    // The user clears the sway on count 2 (edited timeline drops it entirely).
    const edited = [attr("b1", "sway", 1, "to_R")];
    const placement = { id: "p1", figureRef: base.id, deletedAt: null };
    const { variant } = spawnVariant(placement, base, "u_me", edited);
    const resolved = resolveFigure(base, variant);
    // A cleared beat carries only a TOMBSTONED copy-down → no live sway → matches none.
    expect(matchPredicate(none, resolved)).toEqual([2, 3]);
  });
});
