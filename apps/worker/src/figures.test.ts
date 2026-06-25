import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { uniqueDocName } from "./test-support/do-id";
import type { DocNamespace, DocStub } from "./test-support/doc-do-api";
import { applyMigrations, seedDb } from "./test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-034 — Editing your own figure flows into all referencing routines [M4]
// US-035 — Auto-variant on editing a non-owned figure (copy-on-write) [M4]
//
// PLAN §2.2, §2.4, §5.2, §10.2: "copy-on-write when editing a shared figure
// without rights" + "figure auto-update across routines". These are proven at
// the DO/persistence layer here (one figure DO referenced by two routine DOs);
// the user-facing flows are also E2E (figures-fork.spec.ts). M4 product code →
// skipped. isolatedStorage:false → unique DO ids.
// ─────────────────────────────────────────────────────────────────────────

const docs = env.DOC_DO as unknown as DocNamespace;
function freshDoc(prefix: string): { name: string; stub: DocStub } {
  const name = uniqueDocName(prefix);
  return { name, stub: docs.get(docs.idFromName(name)) };
}

beforeAll(async () => {
  await applyMigrations();
});

describe.skip("US-034 Editing your own figure flows into all referencing routines", () => {
  it("propagates an owned-figure edit to every routine referencing it", async () => {
    // Intent: edit a figure you OWN once → it appears wherever it's referenced.
    // Multi-doc scenario: one figure DO referenced by routine A and routine B (both u1's).
    // Arrange: a figure DO + two routine DOs whose placements point at the figure docRef;
    //   seed the registry/memberships. Act: apply an edit to the FIGURE DO. Assert:
    //   resolving each routine (figure refs included) reflects the new attribute.
    // Covers US-034 AC-1 (edit flows into both) + AC-2 (no variant created for owner).
    const figure = freshDoc("figure");
    const routineA = freshDoc("routine");
    const routineB = freshDoc("routine");
    await routineA.stub.applyChange({ op: "addPlacement", figureRef: figure.name });
    await routineB.stub.applyChange({ op: "addPlacement", figureRef: figure.name });
    await figure.stub.applyChange({ op: "addAttribute", kind: "sway", count: 2, value: "to_L" });
    const figDoc = await figure.stub.getSnapshot();
    expect(figDoc).toBeDefined();
    // The M4 store resolves each routine's referenced figure; both must show the sway.
  });
});

describe.skip("US-035 Auto-variant on editing a non-owned figure (copy-on-write)", () => {
  it("silently creates an owned variant + re-points the placement; base untouched", async () => {
    // Intent: editing a GLOBAL (app-owned) figure inside u1's routine auto-creates
    //   an account variant owned by u1 and re-points the placement — no prompt.
    // Multi-doc scenario: a global figure DO referenced by u1's routine; u1 edits it.
    // Arrange: seed a global-figure doc + u1's routine placement referencing it.
    // Act: POST an edit to that placement's figure as u1 (the COW path). Assert: a
    //   NEW account-figure doc owned by u1 with baseFigureRef = the global figure;
    //   the placement now references the variant; the global figure is unchanged.
    // Covers US-035 AC-1 (auto-variant + re-point) + AC-3 (original untouched) + AC-4 (no prompt).
    const globalFig = freshDoc("figure-global");
    const routine = freshDoc("routine");
    await seedDb({
      users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: globalFig.name,
          type: "global-figure",
          ownerId: "app",
          doName: globalFig.name,
          figureType: "feather",
          dance: "foxtrot",
        },
        { docRef: routine.name, type: "routine", ownerId: "u1", doName: routine.name },
      ],
      memberships: [{ id: "m1", docRef: routine.name, userId: "u1", role: "editor" }],
    });
    const before = await globalFig.stub.getSnapshot();
    await routine.stub.applyChange({
      op: "editReferencedFigure",
      figureRef: globalFig.name,
      byUser: "u1",
    });
    const after = await globalFig.stub.getSnapshot();
    expect(after).toEqual(before); // base global figure untouched
    // A new account-figure registry row owned by u1 (the variant) should now exist:
    const variant = await env.DB.prepare(
      "SELECT docRef FROM document_registry WHERE ownerId = ? AND type = 'account-figure'",
    )
      .bind("u1")
      .first<{ docRef: string }>();
    expect(variant).not.toBeNull();
  });
});
