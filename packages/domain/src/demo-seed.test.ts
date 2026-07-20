// US-056 — the staging demo-seed builder (docs/system/architecture.md § Ops /
// admin seams). A PURE, DETERMINISTIC builder that materializes a rich SYNTHETIC
// demo dataset for one target user: multiple cross-dance routines composed from
// REAL charted library figures, richly annotated (every anchor type that exists
// in main's schema), threaded, backdated, shared with synthetic co-members, plus
// one account-wide custom kind applied on steps.
//
// Invariants pinned here (each a demo-seed contract):
//  - deterministic + idempotent: same target user + clock → byte-identical output,
//    all ids namespaced by the target user (never collide with real data);
//  - only anchor types that EXIST in main's schema (point / figure / figureType);
//  - backdated createdAt spread across recent + old (fade-out material);
//  - synthetic co-members author some notes + a family note and are members of
//    some routines; the owner authors the rest;
//  - every placed figure references a real charted library figure (no fabrication).
import { describe, expect, it } from "vitest";
import { importDomain } from "./__fixtures__";
import { LIBRARY_FIGURES } from "./library";

const USER = "user_owner_123";
// A fixed clock so the backdated spread is deterministic in the test.
const NOW = Date.UTC(2026, 6, 20); // 2026-07-20

describe("US-056 buildDemoSeed — synthetic staging demo dataset", () => {
  it("produces multiple routines across at least three dances, each composed of real charted figures", async () => {
    const { buildDemoSeed } = await importDomain();
    const seed = buildDemoSeed({ userId: USER, now: NOW });

    expect(seed.routines.length).toBeGreaterThanOrEqual(3);
    const dances = new Set(seed.routines.map((r) => r.routine.dance));
    expect(dances.size).toBeGreaterThanOrEqual(3);

    // Every placement references one of the routine's figures, and every figure is
    // a REAL library figure for that dance (never fabricated).
    for (const { routine, figures } of seed.routines) {
      const figureIds = new Set(figures.map((f) => f.id));
      const placements = routine.sections.flatMap((s) => s.placements);
      expect(placements.length).toBeGreaterThan(0);
      for (const p of placements) {
        expect(p.figureRef).toBeDefined();
        expect(figureIds.has(p.figureRef ?? "")).toBe(true);
      }
      for (const f of figures) {
        const lib = LIBRARY_FIGURES.find(
          (l) => l.dance === f.dance && l.figureType === f.figureType,
        );
        expect(lib, `${f.dance}:${f.figureType} must exist in the catalog`).toBeDefined();
        // Every charted catalog attribute is present verbatim (the builder may
        // ALSO append a synthetic custom-kind attribute, but never invents or
        // mutates real figure data).
        for (const src of lib?.attributes ?? []) {
          expect(f.attributes).toContainEqual(src);
        }
        expect(f.ownerId).toBe(USER);
        expect(f.scope).toBe("account");
      }
    }
  });

  it("is deterministic and namespaced by the target user (idempotent re-run)", async () => {
    const { buildDemoSeed } = await importDomain();
    const a = buildDemoSeed({ userId: USER, now: NOW });
    const b = buildDemoSeed({ userId: USER, now: NOW });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));

    // Every minted id is namespaced by the user, so two different users never collide.
    const other = buildDemoSeed({ userId: "user_other", now: NOW });
    const idsA = collectIds(a);
    const idsOther = collectIds(other);
    for (const id of idsA) expect(id).toContain(USER);
    // No id is shared between the two users' seeds.
    expect(idsA.some((id) => idsOther.includes(id))).toBe(false);
  });

  it("annotates with every anchor type that exists in main's schema (point, figure, figureType)", async () => {
    const { buildDemoSeed } = await importDomain();
    const seed = buildDemoSeed({ userId: USER, now: NOW });

    const anchors = [
      ...seed.routines.flatMap((r) => r.routine.annotations.flatMap((a) => a.anchors)),
      ...seed.accounts.flatMap((acc) => acc.doc.annotations.flatMap((a) => a.anchors)),
    ];
    const types = new Set(anchors.map((a) => a.type));
    expect(types.has("point")).toBe(true);
    expect(types.has("figure")).toBe(true);
    expect(types.has("figureType")).toBe(true);
    // No anchor type outside the three main-schema variants.
    for (const t of types) expect(["point", "figure", "figureType"]).toContain(t);
  });

  it("includes threaded replies and a multi-message conversation", async () => {
    const { buildDemoSeed } = await importDomain();
    const seed = buildDemoSeed({ userId: USER, now: NOW });
    const threaded = seed.routines
      .flatMap((r) => r.routine.annotations)
      .filter((a) => a.replies.length > 0);
    expect(threaded.length).toBeGreaterThan(0);
    // At least one conversation with two or more replies.
    expect(threaded.some((a) => a.replies.length >= 2)).toBe(true);
  });

  it("backdates createdAt across recent and old (fade-out material)", async () => {
    const { buildDemoSeed } = await importDomain();
    const seed = buildDemoSeed({ userId: USER, now: NOW });
    const createdAts = [
      ...seed.routines.flatMap((r) =>
        r.routine.annotations.flatMap((a) => [
          a.createdAt,
          ...a.replies.map((rep) => rep.createdAt),
        ]),
      ),
      ...seed.accounts.flatMap((acc) => acc.doc.annotations.map((a) => a.createdAt)),
    ];
    expect(createdAts.length).toBeGreaterThan(0);
    // Every timestamp is in the past relative to `now`.
    for (const t of createdAts) expect(t).toBeLessThanOrEqual(NOW);
    // Something recent (within ~10 days) AND something old (>= 60 days).
    const DAY = 24 * 60 * 60 * 1000;
    expect(createdAts.some((t) => NOW - t <= 10 * DAY)).toBe(true);
    expect(createdAts.some((t) => NOW - t >= 60 * DAY)).toBe(true);
  });

  it("creates synthetic co-members that are members of some routines and author some notes", async () => {
    const { buildDemoSeed } = await importDomain();
    const seed = buildDemoSeed({ userId: USER, now: NOW });

    // 2-3 synthetic co-members, all namespaced by the owner, none is the owner.
    expect(seed.coMemberIds.length).toBeGreaterThanOrEqual(2);
    for (const id of seed.coMemberIds) {
      expect(id).toContain(USER);
      expect(id).not.toBe(USER);
    }

    // Some routines are shared with the co-members (membership rows).
    const sharedWithCoMember = seed.memberships.filter((m) => seed.coMemberIds.includes(m.userId));
    expect(sharedWithCoMember.length).toBeGreaterThan(0);
    // Every membership references a real routine in this seed and a known user.
    const routineRefs = new Set(seed.routines.map((r) => r.routine.id));
    for (const m of seed.memberships) {
      expect(routineRefs.has(m.docRef)).toBe(true);
      expect([USER, ...seed.coMemberIds]).toContain(m.userId);
      expect(["viewer", "commenter", "editor"]).toContain(m.role);
    }

    // A co-member authors at least one routine annotation.
    const coAuthored = seed.routines
      .flatMap((r) => r.routine.annotations)
      .some((a) => seed.coMemberIds.includes(a.authorId));
    expect(coAuthored).toBe(true);

    // At least one synthetic co-member has an account doc carrying a family note.
    const coMemberAccounts = seed.accounts.filter((a) => seed.coMemberIds.includes(a.userId));
    expect(coMemberAccounts.length).toBeGreaterThan(0);
    const coFamilyNote = coMemberAccounts
      .flatMap((a) => a.doc.annotations)
      .some((a) => a.anchors.some((an) => an.type === "figureType"));
    expect(coFamilyNote).toBe(true);
  });

  it("defines one account-wide custom kind and applies it on some steps", async () => {
    const { buildDemoSeed } = await importDomain();
    const seed = buildDemoSeed({ userId: USER, now: NOW });

    expect(seed.customKind).toBeDefined();
    expect(seed.customKind.builtin).toBe(false);
    expect(seed.customKind.kind.length).toBeGreaterThan(0);
    expect((seed.customKind.values ?? []).length).toBeGreaterThan(0);
    // The custom kind is role-aware (an enum spread across the roles), per the brief.
    expect(seed.customKind.roleAware).toBe(true);

    // The kind is applied as attributes on at least one figure's timeline, on real counts.
    const applied = seed.routines
      .flatMap((r) => r.figures)
      .flatMap((f) => f.attributes)
      .filter((a) => a.kind === seed.customKind.kind);
    expect(applied.length).toBeGreaterThan(0);
    for (const a of applied) {
      expect((seed.customKind.values ?? []).includes(String(a.value))).toBe(true);
      expect(Number.isFinite(a.count)).toBe(true);
    }
  });

  it("marks every routine, figure and account doc as owned by the target user or a co-member", async () => {
    const { buildDemoSeed } = await importDomain();
    const seed = buildDemoSeed({ userId: USER, now: NOW });
    const known = new Set([USER, ...seed.coMemberIds]);
    for (const { routine } of seed.routines) {
      expect(routine.ownerId).toBe(USER); // routines are owned by the target user only
    }
    for (const acc of seed.accounts) {
      expect(known.has(acc.userId)).toBe(true);
      expect(acc.doc.ownerId).toBe(acc.userId);
    }
  });
});

/** Collect every id-bearing string in a seed for the namespacing/collision checks. */
function collectIds(seed: {
  routines: {
    routine: {
      id: string;
      sections: { id: string; placements: { id: string }[] }[];
      annotations: { id: string; replies: { id: string }[] }[];
    };
    figures: { id: string }[];
  }[];
  accounts: { doc: { annotations: { id: string }[] } }[];
}): string[] {
  const ids: string[] = [];
  for (const { routine, figures } of seed.routines) {
    ids.push(routine.id);
    for (const s of routine.sections) {
      ids.push(s.id);
      for (const p of s.placements) ids.push(p.id);
    }
    for (const a of routine.annotations) {
      ids.push(a.id);
      for (const rep of a.replies) ids.push(rep.id);
    }
    for (const f of figures) ids.push(f.id);
  }
  for (const acc of seed.accounts) for (const a of acc.doc.annotations) ids.push(a.id);
  return ids;
}
