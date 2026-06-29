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
    await page.getByRole("button", { name: "Foxtrot" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /create choreo/i })
      .click();

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

    // 4. Add a figure "My Step" to the section (US-027): mints a custom
    //    figure doc + a placement; the card shows the figure name. NOTE: use a
    //    NON-catalog name — a typed catalog name (e.g. "Feather Step") now resolves
    //    to the library figure and arrives pre-filled, which would break the
    //    empty-figure manual-notation flow this test exercises.
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByLabel("Figure name").fill("My Step");
    await page.getByLabel("Figure name").press("Enter");
    await expect(page.getByText("My Step")).toBeVisible({ timeout: 15_000 });

    // 4b. Notate the figure (US-028 hero flow + 2026-06-28 parity): open its step
    //     timeline, tap count 1, set the step's DIRECTION "forward" (the headline)
    //     and FOOTWORK "ball" (a slot). The headline + the chip show on count 1.
    await page.getByRole("button", { name: /edit steps: My Step/i }).click();
    await page.getByRole("button", { name: /beat 1/i }).click();
    await page.getByRole("button", { name: /^forward$/ }).click();
    await page.getByRole("button", { name: /^ball$/ }).click();
    await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i);
    await expect(page.getByLabel(/count 1 attributes/i).getByText("ball")).toBeVisible();
    // 4c. Set the figure's entry alignment (US-031): a facing-direction → a chip.
    await page.getByLabel(/entry direction/i).selectOption("DW");
    await page.keyboard.press("Escape");
    await expect(page.getByText(/entry DW/i)).toBeVisible({ timeout: 15_000 });

    // 5. Reload → the routine document (the section) AND the figure (its name,
    //    server-seeded durably at create, #205) were DO-persisted and replay on
    //    reconnect (US-018 open & view). The figure-after-reload is reliable now
    //    that the server owns the figure seed (no racy client write).
    await page.reload();
    await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("My Step")).toBeVisible({ timeout: 15_000 });
    // The entry-alignment chip persisted too (figure doc).
    await expect(page.getByText(/entry DW/i)).toBeVisible({ timeout: 15_000 });

    // 5b. The NOTATION persisted too (figure doc, its own DO): reopen the step
    //     timeline → count 1 still carries the "forward" headline + "ball" footwork.
    await page.getByRole("button", { name: /edit steps: My Step/i }).click();
    await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i, { timeout: 15_000 });
    await expect(page.getByLabel(/count 1 attributes/i).getByText("ball")).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");

    // 5c. The reading view lays the whole routine out read-only as a columnar
    //     table — the step's direction is the headline ("forward") and footwork
    //     "ball" shows as its tight column code ("B").
    await page.getByRole("button", { name: /reading view/i }).click();
    const reading = page.getByTestId("reading-view");
    await expect(reading.getByText("forward", { exact: true })).toBeVisible();
    await expect(reading.getByText("B", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /list view/i }).click();

    // The created title is also indexed in D1: it shows in the Choreo list.
    await page.getByRole("button", { name: /all routines/i }).click();
    await expect(page.getByText("E2E Foxtrot")).toBeVisible();
  });

  test("create a custom kind, see it in the editor + a lane, persists on reload", async ({
    page,
  }) => {
    const user = "user_kinds";
    await resetDb(page);
    await seedDb(page, { users: [{ id: user, displayName: "Kinds", identityColor: "#33aa55" }] });
    await seedAuth(page, user);
    await page.goto("/");

    // create routine → section → figure (reuse the existing pattern)
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Routine name").fill("E2E Kinds");
    await page.getByRole("button", { name: "Foxtrot" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /create choreo/i })
      .click();
    await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByLabel("Section name").fill("Intro");
    await page.getByLabel("Section name").press("Enter");
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByLabel("Figure name").fill("My Step");
    await page.getByLabel("Figure name").press("Enter");
    await expect(page.getByText("My Step")).toBeVisible({ timeout: 15_000 });

    // open the figure's step timeline and a count editor
    await page.getByRole("button", { name: /edit steps: My Step/i }).click();
    await page.getByRole("button", { name: /beat 1/i }).click();

    // create a custom kind "Energy"
    await page.getByRole("button", { name: /add kind/i }).click();
    // Scope to the dialog to avoid ambiguity; use placeholder selectors to
    // avoid the required-asterisk suffix that breaks getByLabel exact regex.
    const kindDialog = page.getByRole("dialog", { name: /add attribute kind/i });
    await kindDialog.getByPlaceholder("e.g. Energy").fill("Energy");
    await kindDialog.getByPlaceholder("e.g. low, medium, high").fill("low, high");
    await kindDialog.getByRole("button", { name: "Create" }).click();

    // the Energy section appears in the still-open count 1 editor — under the
    // "More attributes" disclosure (the editor leads with direction + footwork;
    // technique + custom kinds are revealed there, 2026-06-28 parity).
    await page.getByRole("button", { name: /more attributes/i }).click();
    await expect(page.getByRole("heading", { name: /energy/i })).toBeVisible({ timeout: 15_000 });

    // view Energy in a lane grid
    await page.getByRole("button", { name: "Lanes" }).click();
    await expect(page.getByRole("grid")).toBeVisible();

    // persists across reload: re-open the figure + count 1, Energy still there
    await page.reload();
    await page.getByRole("button", { name: /edit steps: My Step/i }).click();
    await page.getByRole("button", { name: /beat 1/i }).click();
    await page.getByRole("button", { name: /more attributes/i }).click();
    await expect(page.getByRole("heading", { name: /energy/i })).toBeVisible({ timeout: 15_000 });
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
