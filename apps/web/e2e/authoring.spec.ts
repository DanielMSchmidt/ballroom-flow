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
    await page.getByLabel("Choreo name").fill("E2E Foxtrot");
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

    // 4. Add a figure "My Step" to the section (US-027): a typed name always
    //    mints a custom figure doc + a placement (§4.3 — even a catalog-colliding
    //    name stays a custom); the card shows the figure name.
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByLabel("Figure name").fill("My Step");
    await page.getByLabel("Figure name").press("Enter");

    // 4b. Creating a NEW custom figure opens its full-screen step editor
    //     IMMEDIATELY (create-navigates, §4.3) — no separate "edit steps" tap.
    //     Notate it (US-028 hero flow, Builder v3 ② quick-add): the FIRST tap on
    //     the empty Step cell places a blank step (presence attr + toast); the
    //     SECOND tap opens the single-attribute overlay → set DIRECTION "Forward"
    //     (the headline) + FOOTWORK "Heel-Toe" (a slot) → Done (closes the
    //     overlay). The headline + chip show on count 1.
    await expect(page.getByRole("dialog", { name: /steps · my step/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /^Add Step at count 1$/i }).click();
    await page.getByRole("button", { name: /^Edit Step at count 1$/i }).click();
    await page.getByRole("button", { name: /^Forward$/ }).click();
    await page.getByRole("button", { name: /^Heel-Toe$/ }).click();
    await page.getByRole("button", { name: /^Done$/ }).click();
    await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i);
    await expect(page.getByLabel(/count 1 attributes/i).getByText("HT")).toBeVisible();
    // 4c. Set the figure's entry alignment (US-031): D6 — tap the "diag wall" (DW)
    //     direction chip in the Entry group (qualifier defaults to "facing"), then
    //     close the sheet; the placement shows an "entry facing diag wall" chip.
    await page
      .getByRole("group", { name: /entry alignment/i })
      .getByRole("button", { name: /^diag wall$/i })
      .click();
    await page.keyboard.press("Escape");
    await expect(page.getByText(/entry facing diag wall/i)).toBeVisible({ timeout: 15_000 });

    // 5. Reload → the routine document (the section) AND the figure (its name,
    //    server-seeded durably at create, #205) were DO-persisted and replay on
    //    reconnect (US-018 open & view). The figure-after-reload is reliable now
    //    that the server owns the figure seed (no racy client write).
    await page.reload();
    // Reload returns to READ; switch back to EDIT so section headings and the
    // step-timeline editor are accessible below.
    await page.getByRole("button", { name: /list view/i }).click();
    await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("My Step")).toBeVisible({ timeout: 15_000 });
    // The entry-alignment chip persisted too (figure doc).
    await expect(page.getByText(/entry facing diag wall/i)).toBeVisible({ timeout: 15_000 });

    // 5b. The NOTATION persisted too (figure doc, its own DO): reopen the step
    //     timeline → count 1 still carries the "forward" headline + "ball" footwork.
    await page.getByRole("button", { name: /edit steps: My Step/i }).click();
    await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i, { timeout: 15_000 });
    await expect(page.getByLabel(/count 1 attributes/i).getByText("HT")).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");

    // 5c. The reading view lays the whole routine out read-only as a per-figure
    //     used-columns table — the step's direction + footwork MERGE into one
    //     blue Step chip (frame 1.6): "forward" + "HT" → "fwd·HT".
    await page.getByRole("button", { name: /reading view/i }).click();
    const reading = page.getByTestId("reading-view");
    await expect(reading.getByText("fwd·HT")).toBeVisible();
    await page.getByRole("button", { name: /list view/i }).click();

    // The created title is also indexed in D1: it shows in the Choreo list.
    await page.getByRole("button", { name: /all choreos/i }).click();
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
    await page.getByLabel("Choreo name").fill("E2E Kinds");
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

    // creating the custom figure lands directly in its full-screen step editor
    // (create-navigates, §4.3)
    await expect(page.getByRole("dialog", { name: /steps · my step/i })).toBeVisible({
      timeout: 15_000,
    });

    // create a custom kind "Energy". "add kind" opens the type PICKER (frame
    // 1.15); the "＋ new attribute type" footer opens the builder (frame 1.16).
    await page.getByRole("button", { name: /add kind/i }).click();
    await page
      .getByRole("dialog", { name: /add an attribute/i })
      .getByRole("button", { name: /new attribute type/i })
      .click();
    // Scope to the builder dialog to avoid ambiguity; use placeholder selectors to
    // avoid the required-asterisk suffix that breaks getByLabel exact regex.
    const kindDialog = page.getByRole("dialog", { name: /add attribute kind/i });
    await kindDialog.getByPlaceholder("e.g. Energy").fill("Energy");
    // Values are now a chip editor (add one at a time). A comma-joined string
    // typed into the add-field is split + flushed into the value list on submit,
    // so a single fill + Create still yields both values.
    await kindDialog.getByPlaceholder(/type a value/i).fill("low, high");
    await kindDialog.getByRole("button", { name: "Create" }).click();

    // Energy becomes a new COLUMN in the bars-driven grid (allColumns adds custom
    // kinds), so it's addable at every count.
    await expect(page.getByRole("columnheader", { name: /energy/i })).toBeVisible({
      timeout: 15_000,
    });

    // view Energy in a lane grid
    await page.getByRole("button", { name: "Lanes" }).click();
    await expect(page.getByRole("grid")).toBeVisible();

    // persists across reload: re-open the figure, Energy is still a grid column
    await page.reload();
    // Reload returns to READ; switch back to EDIT to access the step timeline.
    await page.getByRole("button", { name: /list view/i }).click();
    await page.getByRole("button", { name: /edit steps: My Step/i }).click();
    await expect(page.getByRole("columnheader", { name: /energy/i })).toBeVisible({
      timeout: 15_000,
    });
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
