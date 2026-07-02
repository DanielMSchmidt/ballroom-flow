import { expect, type Page, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { closeUsers, expectConverged, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// Per-user undo across two clients (PLAN §10.2 E2E: "per-user undo across two
// clients"). Covers US-038 (undo reverts only YOUR change; the other client's
// concurrent edit survives; redo). The domain primitive (history-based per-actor
// undo, US-010) is proven in packages/domain; this proves it end-to-end through
// the store seam + live sync, in two real browsers.
//
// @smoke — FE-5 is done only when this journey is green.
// ─────────────────────────────────────────────────────────────────────────

const A = "user_a";
const B = "user_b";

async function createRoutineAsOwner(page: Page, title: string): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: /new choreo/i }).click();
  await page.getByLabel("Choreo name").fill(title);
  // Waltz is the pre-selected chip in the New-choreo sheet, so no dance pick needed.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /create choreo/i })
    .click();
  await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({ timeout: 15_000 });
  const docRef = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(docRef, "expected a created routine id in the URL").toBeTruthy();
  return docRef;
}

async function addSection(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByLabel("Section name").fill(name);
  await page.getByLabel("Section name").press("Enter");
}

test.describe("@smoke per-user undo across two clients", () => {
  test("A's undo reverts only A's last change; B's concurrent edit survives; redo restores", async ({
    browser,
  }) => {
    // Intent: history-based per-user undo merges correctly with a concurrent
    //   remote edit — A's undo touches only A's change; B's survives; redo restores.
    const [a, b] = await openTwoUsers(browser, A, B);
    await resetDb(a.page);
    await seedDb(a.page, {
      users: [
        { id: A, displayName: "A", identityColor: "#111111" },
        { id: B, displayName: "B", identityColor: "#222222" },
      ],
    });
    await seedAuth(a.page, A);
    await seedAuth(b.page, B);

    // A owns a routine; B joins as a co-editor; both open it live.
    const docRef = await createRoutineAsOwner(a.page, "Undo Waltz");
    await seedDb(a.page, { memberships: [{ docRef, userId: B, role: "editor" }] });
    await b.page.goto(`/routines/${docRef}`);
    // Opening an existing routine lands in READ; switch to EDIT so the section
    // builder affordances (and undo/redo toolbar) are visible.
    await b.page.getByRole("button", { name: /list view/i }).click();
    await expect(b.page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });

    // 1. A adds "FromA", B adds "FromB"; both clients converge on BOTH.
    await addSection(a.page, "FromA");
    await expectConverged([a.page, b.page], "[data-testid='section-list']", "FromA");
    await addSection(b.page, "FromB");
    await expectConverged([a.page, b.page], "[data-testid='section-list']", "FromB");

    // 2. A undoes → "Undone" toast; "FromA" disappears on BOTH; "FromB" REMAINS.
    await a.page.getByRole("button", { name: /^undo$/i }).click();
    await expect(a.page.getByText(/undone/i)).toBeVisible();
    await expect(a.page.getByRole("heading", { name: "FromA" })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(b.page.getByRole("heading", { name: "FromA" })).toHaveCount(0, {
      timeout: 15_000,
    });
    // B's concurrent edit survives A's undo (US-038 AC-2).
    await expect(a.page.getByRole("heading", { name: "FromB" })).toBeVisible();
    await expect(b.page.getByRole("heading", { name: "FromB" })).toBeVisible();

    // 3. A redoes → "FromA" reappears on both (US-038 AC-4).
    await a.page.getByRole("button", { name: /^redo$/i }).click();
    await expectConverged([a.page, b.page], "[data-testid='section-list']", "FromA");

    await closeUsers(a, b);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Figure-editor undo — "undo follows the surface being edited" (PLAN §5.4). The
// full-screen figure editor auto-saves with no Save button; its honesty rests on
// an undo existing THERE, targeting the figure's OWN doc (store.undoFigure). This
// drives the real journey: open the editor → set an attribute → undo → the cell
// is empty again.
//
// @smoke — part of the CI PR smoke subset.
// ─────────────────────────────────────────────────────────────────────────
test.describe("@smoke figure-editor undo (targets the figure doc, §5.4)", () => {
  test("set a step attribute in the figure editor, then undo it — the cell empties", async ({
    page,
  }) => {
    const user = "user_fig_undo";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Solo", identityColor: "#3344ff" }],
    });
    await seedAuth(page, user);

    // Create a routine → a section → a NON-catalog custom figure (an empty figure
    // to notate by hand; a catalog name would arrive pre-filled and spawn a variant).
    const docRef = await createRoutineAsOwner(page, "Undo Figure Waltz");
    expect(docRef).toBeTruthy();
    await addSection(page, "Steps");
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByLabel("Figure name").fill("My Step");
    await page.getByLabel("Figure name").press("Enter");
    await expect(page.getByText("My Step")).toBeVisible({ timeout: 15_000 });

    // Open the figure's full-screen editor and set a single attribute at count 1:
    // tap the Step cell → the overlay → DIRECTION "Forward" → Save (closes overlay).
    await page.getByRole("button", { name: /edit steps: My Step/i }).click();
    const editor = page.getByRole("dialog", { name: /steps · my step/i });
    await page.getByRole("button", { name: /Step at count 1$/i }).click();
    await page.getByRole("button", { name: /^Forward$/ }).click();
    await page.getByRole("button", { name: /^Save$/ }).click();
    // The edit landed: count 1 now carries the "forward" headline.
    await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i, { timeout: 15_000 });

    // Undo from the EDITOR HEADER (scoped to the dialog so it's the figure's undo,
    // not the routine toolbar's) → "Undone" toast, and count 1 empties again (§5.4).
    await editor.getByRole("button", { name: /^undo$/i }).click();
    await expect(page.getByText(/^undone$/i)).toBeVisible();
    await expect(page.getByTestId("step-headline-1")).toHaveCount(0, { timeout: 15_000 });
  });
});
