import { expect, type Page, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { closeUsers, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// annotation-media-embeds ship gate (docs/ideas/annotation-media-embeds.md §
// Test plan & ship gate). Runs against the REAL worker (D1 + per-document DOs +
// R2 (Miniflare-simulated) + the fail-closed auth/sync boundary) via the #191
// harness — no live Clerk, a real test JWT, the real membership gate.
//
// Journeys: (1) a member attaches a photo + a YouTube link inline in one note;
// the reading-programme margin shows only the media CHIP (no img/video/iframe of
// the content). (2) opening the thread renders the photo at its token position
// and the YouTube facade whose iframe loads ONLY after an explicit tap.
// (3) a second member loads the photo; a signed-in non-member's direct fetch is
// rejected 403. A guard fails the test if the page EVER contacts YouTube/Google.
//
// @smoke — part of the CI PR smoke subset (baseline must stay green).
// ─────────────────────────────────────────────────────────────────────────

// A tiny valid 2×2 RGB PNG as an in-memory upload — no fixture file on disk. It
// must decode in-browser (createImageBitmap) for the client compression step.
const PNG_2x2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DA8B+MgBgAHfAD/dPQfSYAAAAASUVORK5CYII=",
  "base64",
);

/** Fail the test if the page ever makes a request to YouTube/Google. The facade
 *  must contact NOTHING third-party until an explicit tap; the worker-proxied
 *  thumb is same-origin. Records + fulfils (204) any such request so a leak is
 *  loud, not silent. */
function guardExternalRequests(page: Page): { log: string[] } {
  const log: string[] = [];
  for (const pat of ["**youtube.com/**", "**youtube-nocookie.com/**", "**ytimg.com/**"]) {
    void page.route(pat, (route) => {
      log.push(route.request().url());
      return route.fulfill({ status: 204, body: "" });
    });
  }
  return { log };
}

/** Create a routine with one section + the Feather Step figure, then open its
 *  Annotations panel from the reading lens (mirrors annotations.spec.ts). */
async function openFigureAnnotations(page: Page) {
  await page.getByRole("button", { name: /new choreo/i }).click();
  await page.getByLabel("Choreo name").fill("E2E Media");
  await page.getByRole("button", { name: "Foxtrot" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /create choreo/i })
    .click();

  const addSection = page.getByRole("button", { name: "Add section" });
  await expect(addSection).toBeVisible({ timeout: 15_000 });
  await addSection.click();
  await page.getByLabel("Section name").fill("Intro");
  await page.getByLabel("Section name").press("Enter");
  await page.getByRole("button", { name: "Add figure" }).click();
  await page.getByRole("button", { name: "Feather Step", exact: true }).click();
  await page.getByRole("button", { name: /add to choreo/i }).click();
  await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: /reading view/i }).click();
  await page
    .getByTestId("reading-view")
    .getByRole("button", { name: "Feather Step", exact: true })
    .click();
  return page.getByRole("region", { name: /^annotations$/i });
}

test.describe("@smoke annotation media embeds", () => {
  test("attach a photo + YouTube inline → margin chip → thread render → facade tap", async ({
    page,
  }) => {
    const guard = guardExternalRequests(page);
    const user = "user_media_a";
    await resetDb(page);
    await seedDb(page, { users: [{ id: user, displayName: "Coach", identityColor: "#1f8a5b" }] });
    await seedAuth(page, user);
    await page.goto("/");

    const panel = await openFigureAnnotations(page);

    // The media compose row appears only once the doc syncs LIVE (uploads are
    // server-minting). Attach a photo (in-memory PNG) — a pending chip appears.
    await expect(panel.getByRole("button", { name: /attach photo/i })).toBeVisible({
      timeout: 15_000,
    });
    await panel
      .getByTestId("media-photo-input")
      .setInputFiles({ name: "whiteboard.png", mimeType: "image/png", buffer: PNG_2x2 });
    await expect(panel.getByTestId("pending-media-chip")).toHaveCount(1, { timeout: 15_000 });

    // Attach a YouTube link (the composer prompts for the URL).
    page.once("dialog", (d) => void d.accept("https://youtu.be/dQw4w9WgXcQ"));
    await panel.getByRole("button", { name: /attach youtube/i }).click();
    await expect(panel.getByTestId("pending-media-chip")).toHaveCount(2, { timeout: 15_000 });

    // Compose the note — the tokens land inline in the prose.
    await panel.getByLabel("Kind").selectOption("lesson");
    await panel.getByRole("textbox", { name: /^note$/i }).fill("head weight left");
    await panel.getByRole("button", { name: /add note/i }).click();
    await expect(panel.getByText("head weight left")).toBeVisible({ timeout: 15_000 });

    // JOURNEY 2 (in the open thread): the photo <img> renders at its token
    // position (same-origin /api/media/...) and the YouTube facade shows its
    // worker-proxied thumb but NO iframe until an explicit tap.
    const photo = panel.getByRole("img", { name: /attachment on this note/i });
    await expect(photo).toBeVisible({ timeout: 15_000 });
    expect(await photo.getAttribute("src")).toMatch(/^\/api\/media\/media\//);
    expect(await panel.locator("iframe").count()).toBe(0);

    // BEFORE any tap: the page has contacted NO third-party host (the facade thumb
    // is the worker-proxied same-origin /api/media/youtube-thumb; reading a note
    // makes no request to Google).
    expect(guard.log).toEqual([]);

    // The nocookie iframe is created ONLY after an explicit tap.
    const facade = panel.getByRole("button", { name: /load youtube video/i });
    await expect(facade).toBeVisible();
    await facade.click();
    await expect(panel.locator('iframe[src*="youtube-nocookie.com/embed/"]')).toHaveCount(1, {
      timeout: 15_000,
    });
    // Now — and only now — the browser loads the (guard-stubbed) nocookie embed.
    expect(guard.log.some((u) => u.includes("youtube-nocookie.com/embed/"))).toBe(true);
  });

  test("the author soft-deletes a posted photo → removed stub → undo restores it (#291)", async ({
    page,
  }) => {
    // The documented soft-delete/undo path, driven end-to-end (QA dig-next 3):
    // attach a photo, remove it (tombstone → the "removed" stub renders, the img
    // is gone), then undo from the editing toolbar → the photo returns. The R2
    // object keeps serving throughout (undo just flips the tombstone).
    const user = "user_media_a";
    await resetDb(page);
    await seedDb(page, { users: [{ id: user, displayName: "Coach", identityColor: "#1f8a5b" }] });
    await seedAuth(page, user);
    await page.goto("/");

    const panel = await openFigureAnnotations(page);

    await expect(panel.getByRole("button", { name: /attach photo/i })).toBeVisible({
      timeout: 15_000,
    });
    // Type the prose first, THEN attach — the media token lands after the text
    // (holdMedia appends it), so the posted note keeps its inline `![media:…]`
    // token. (A later fill() would wipe the token, leaving the item unreferenced —
    // which renders while live but leaves no "removed" stub once tombstoned.)
    await panel.getByLabel("Kind").selectOption("lesson");
    await panel.getByRole("textbox", { name: /^note$/i }).fill("wrong photo");
    await panel
      .getByTestId("media-photo-input")
      .setInputFiles({ name: "whiteboard.png", mimeType: "image/png", buffer: PNG_2x2 });
    await expect(panel.getByTestId("pending-media-chip")).toHaveCount(1, { timeout: 15_000 });
    await panel.getByRole("button", { name: /add note/i }).click();

    // The photo renders inline; the author sees the per-item remove ✕.
    const photo = panel.getByRole("img", { name: /attachment on this note/i });
    await expect(photo).toBeVisible({ timeout: 15_000 });
    const removeBtn = panel.getByRole("button", { name: /remove media/i });
    await expect(removeBtn).toBeVisible();

    // Remove it → the embed becomes the quiet "removed" stub; the img is gone.
    await removeBtn.click();
    await expect(panel.getByText(/media removed/i)).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole("img", { name: /attachment on this note/i })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /remove media/i })).toHaveCount(0);

    // Undo lives in the editing toolbar (routine doc). Close the figure detail,
    // flip to List view, undo, then back to Reading view and reopen the figure —
    // the photo is restored (tombstone reverted; the same object still serves it).
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /list view/i }).click();
    await page.getByRole("button", { name: /^undo$/i }).click();
    await expect(page.getByText(/^undone$/i)).toBeVisible();

    await page.getByRole("button", { name: /reading view/i }).click();
    await page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Feather Step", exact: true })
      .click();
    const restoredPanel = page.getByRole("region", { name: /^annotations$/i });
    const restored = restoredPanel.getByRole("img", { name: /attachment on this note/i });
    await expect(restored).toBeVisible({ timeout: 15_000 });
    expect(await restored.getAttribute("src")).toMatch(/^\/api\/media\/media\//);
    await expect(restoredPanel.getByText(/media removed/i)).toHaveCount(0);
  });

  test("a second member loads the photo; a signed-in non-member's direct fetch is 403", async ({
    browser,
  }) => {
    const OWNER = "user_media_a";
    const MEMBER = "user_media_b";
    const OUTSIDER = "user_media_x";
    const [a, b] = await openTwoUsers(browser, OWNER, MEMBER);
    await resetDb(a.page);
    await seedDb(a.page, {
      users: [
        { id: OWNER, displayName: "Coach", identityColor: "#1f8a5b" },
        { id: MEMBER, displayName: "Student", identityColor: "#8a1f5b" },
        { id: OUTSIDER, displayName: "Stranger", identityColor: "#5b1f8a" },
      ],
    });
    await seedAuth(a.page, OWNER);
    await seedAuth(b.page, MEMBER);
    await a.page.goto("/");

    const panel = await openFigureAnnotations(a.page);
    const docRef = new URL(a.page.url()).pathname.split("/").pop() ?? "";

    await expect(panel.getByRole("button", { name: /attach photo/i })).toBeVisible({
      timeout: 15_000,
    });
    await panel
      .getByTestId("media-photo-input")
      .setInputFiles({ name: "whiteboard.png", mimeType: "image/png", buffer: PNG_2x2 });
    await expect(panel.getByTestId("pending-media-chip")).toHaveCount(1, { timeout: 15_000 });
    await panel.getByLabel("Kind").selectOption("lesson");
    await panel.getByRole("textbox", { name: /^note$/i }).fill("compare this");
    await panel.getByRole("button", { name: /add note/i }).click();

    const ownerPhoto = panel.getByRole("img", { name: /attachment on this note/i });
    await expect(ownerPhoto).toBeVisible({ timeout: 15_000 });
    const objectSrc = (await ownerPhoto.getAttribute("src")) ?? "";
    expect(objectSrc).toMatch(/^\/api\/media\/media\//);

    // Member B shares the routine and loads the same photo (200 stream via B's
    // __session cookie — naturalWidth > 0 proves the bytes came through).
    await seedDb(a.page, { memberships: [{ docRef, userId: MEMBER, role: "commenter" }] });
    await seedAuth(b.page, MEMBER);
    await b.page.goto(`/routines/${docRef}`);
    // A co-member opening a shared routine lands in the reading view already, so
    // there's no lens toggle to click — wait for the routine, then open the figure
    // from the reading programme (switch lenses first only if a toggle is shown).
    await expect(b.page.getByText("Feather Step").first()).toBeVisible({ timeout: 15_000 });
    const bReadingToggle = b.page.getByRole("button", { name: /reading view/i });
    if (await bReadingToggle.count()) await bReadingToggle.click();
    await b.page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Feather Step", exact: true })
      .click();
    const bPanel = b.page.getByRole("region", { name: /^annotations$/i });
    const bPhoto = bPanel.getByRole("img", { name: /attachment on this note/i });
    await expect(bPhoto).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => bPhoto.evaluate((el) => (el instanceof HTMLImageElement ? el.naturalWidth : 0)), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // A signed-in NON-member's direct fetch of the same object is rejected 403.
    const outsider = await browser.newContext();
    const outsiderPage = await outsider.newPage();
    await seedAuth(outsiderPage, OUTSIDER);
    await outsiderPage.goto("/");
    const status = await outsiderPage.evaluate(
      (src) => fetch(src, { credentials: "include" }).then((r) => r.status),
      objectSrc,
    );
    expect(status).toBe(403);
    await outsider.close();

    await closeUsers(a, b);
  });
});
