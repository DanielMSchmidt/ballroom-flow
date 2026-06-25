import { expect, test } from "@playwright/test";
import { gotoRoutine, seedAuth } from "./support/auth";

// ─────────────────────────────────────────────────────────────────────────
// Export → import round-trip (PLAN §10.2 E2E: "export→import (with referenced
// figures)"). Covers US-047 (export bundle incl. referenced figures) + US-048
// (import recreates owned docs; unknown values survive; migration applied).
// SKIPPED until M8 export/import + screens + E2E auth exist.
// ─────────────────────────────────────────────────────────────────────────

test.describe("export → import round-trip (routine + referenced figures)", () => {
  test.skip(true, "M8 export/import + screens + E2E auth not built yet (see TEST-MAP.md)");

  test("export a routine then import the bundle into a recreated owned routine", async ({
    page,
  }) => {
    // Intent: a routine + its referenced figures round-trip through a JSON bundle.
    // User scenario: the user exports rt_sample, then imports the downloaded bundle.
    // Steps/asserts:
    //   1. seedAuth; open rt_sample; trigger Export → capture the downloaded JSON bundle;
    //      it contains the routine + every referenced figure + schemaVersion (US-047).
    //   2. Go to Import; upload the bundle → a NEW owned routine is created and opens,
    //      with the same sections/placements; unknown attribute values survived (US-048).
    await seedAuth(page, "user_owner");
    await gotoRoutine(page, "rt_sample");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });
});
