import { expect, test } from "@playwright/test";
import { gotoRoutine, seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Core authoring journey (PLAN §10.2 E2E: "full authoring"). Runs against the
// REAL worker (D1 + per-document Durable Objects + the fail-closed auth/sync
// boundary) via the #191 E2E harness — no live Clerk, but a real test JWT and
// the real permission boundary.
// Covers: US-025 (create), US-018 (open & view), US-026 (sections),
//         US-027 (figure placements), and persistence across reload.
//
// @smoke — part of the CI PR smoke subset.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke core authoring journey", () => {
  test("create a routine → add a section → add a figure → reload persists", async ({ page }) => {
    const user = "user_solo";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Solo", identityColor: "#3344ff" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // 1. Create a routine (US-025) — server-side create + quota gate.
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Routine name").fill("E2E Foxtrot");
    await page.getByLabel("Dance").selectOption("foxtrot");
    await page.getByRole("button", { name: "Create" }).click();

    // 2. The new routine opens in Assemble as an editor (owner → editor): the
    //    add-section affordance is the proof we connected with edit rights.
    const addSection = page.getByRole("button", { name: "Add section" });
    await expect(addSection).toBeVisible({ timeout: 15_000 });

    // 3. Add a section "Intro" (US-026); it renders in order. (Wait for the
    //    routine doc to hydrate from the DO catch-up before editing — see the
    //    edit-before-hydration note in the PR; generous timeout absorbs it.)
    await addSection.click();
    await page.getByLabel("Section name").fill("Intro");
    await page.getByLabel("Section name").press("Enter");
    await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });

    // 4. Add a figure "Feather Step" to the section (US-027): mints a custom
    //    figure doc + a placement; the card shows the figure name.
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByLabel("Figure name").fill("Feather Step");
    await page.getByLabel("Figure name").press("Enter");
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });

    // 4b. Notate the figure (US-028 hero flow): open its step timeline, tap
    //     count 1, set footwork "T"; the chip shows on that count.
    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    await page.getByRole("button", { name: /count 1/i }).click();
    await page.getByRole("button", { name: /^T$/ }).click();
    await expect(page.getByLabel(/count 1 attributes/i).getByText("T")).toBeVisible();
    await page.keyboard.press("Escape");

    // 5. Reload → the routine document (the section) AND the figure (its name,
    //    server-seeded durably at create, #205) were DO-persisted and replay on
    //    reconnect (US-018 open & view). The figure-after-reload is reliable now
    //    that the server owns the figure seed (no racy client write).
    await page.reload();
    await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });

    // 5b. The NOTATION persisted too (figure doc, its own DO): reopen the step
    //     timeline → count 1 still carries "T".
    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    await expect(page.getByLabel(/count 1 attributes/i).getByText("T")).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");

    // The created title is also indexed in D1: it shows in the Choreo list.
    await page.getByRole("button", { name: /all routines/i }).click();
    await expect(page.getByText("E2E Foxtrot")).toBeVisible();
  });

  test("a viewer sees the routine read-only (no edit affordances)", async ({ page }) => {
    const owner = "user_owner";
    const viewer = "user_viewer";
    const docRef = "rt_view_sample";
    await resetDb(page);
    await seedDb(page, {
      users: [
        { id: owner, displayName: "Owner", identityColor: "#111111" },
        { id: viewer, displayName: "Viewer", identityColor: "#222222" },
      ],
      docs: [{ docRef, type: "routine", ownerId: owner, title: "Shared Routine", dance: "waltz" }],
      memberships: [{ docRef, userId: viewer, role: "viewer" }],
    });
    await seedAuth(page, viewer);
    await gotoRoutine(page, docRef);

    // The viewer connects (US-021 allows a member) and views, but sees NO edit
    // controls (US-018/US-026 gate on the shared capability table).
    await expect(page.getByText(/no sections yet/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Add section" })).toHaveCount(0);
  });
});
