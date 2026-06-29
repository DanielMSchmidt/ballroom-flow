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

// ─────────────────────────────────────────────────────────────────────────
// US-007 — Choreo fork (clone) + US-008 — Copy-on-write (auto-variant)
// [M1, system/developer]. PLAN §2.4, §5.2, §10.2 invariant: "fork clone +
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
    // possible (PLAN §5.2 / §1 "lineage so changes can merge back"); a refactor
    // that quietly rebuilds the doc would break that, so assert it self-evidently.
    const { buildRoutineDoc, cloneRoutine } = await importDomain();
    const origin = buildRoutineDoc(SAMPLE_ROUTINE);
    const fork = cloneRoutine(origin, { byUser: SAMPLE_STUDENT });
    // The product builders return in-memory Automerge docs; A.getHistory reads
    // the change log (the shim types them opaquely, hence the cast).
    expect(A.getHistory(fork as A.Doc<unknown>).length).toBeGreaterThanOrEqual(
      A.getHistory(origin as A.Doc<unknown>).length,
    );
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
    // FROZEN copy carrying its own attributes — no overlay, no flow-up (§5.2,
    // §2.5.1 #14–18).
    // Arrange: a placement pointing at the global FEATHER_FOXTROT; editor = student.
    // Act: copyOnWrite(placement, FEATHER_FOXTROT, student).
    // Assert: new figure doc has scope:account, ownerId:student, source:custom,
    //   baseFigureRef:FEATHER_FOXTROT.id, its OWN attributes (== base by content),
    //   and NO overlay; placement.figureRef re-points to it.
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
    // No overlay — the live-overlay model is retired.
    expect(variant?.overlay).toBeUndefined();
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
