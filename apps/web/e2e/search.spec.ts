import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Search journey (US-046). Runs against the REAL worker (D1 prefix search
// scoped to the owner). Seeds TWO owned routines so the assertion is
// non-tautological: typing "My" must surface "My Foxtrot" in the RESULTS
// region and exclude "Zulu Waltz" — even though both are in the normal list.
//
// Assertion scope: the <ul aria-label="Search results"> (ChoreoList.tsx)
// is only rendered when searchResults.length > 0, so scoping to it proves
// the search API returned the right subset.
//
// @smoke — part of the CI PR smoke subset.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke search journey (US-046)", () => {
  test("@smoke typing a title prefix shows the matching routine in search results and excludes the non-match", async ({
    page,
  }) => {
    const user = "user_search";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Searcher", identityColor: "#aa3344" }],
      docs: [
        {
          docRef: "rt_search_foxtrot",
          type: "routine",
          ownerId: user,
          title: "My Foxtrot",
          dance: "foxtrot",
        },
        {
          docRef: "rt_search_waltz",
          type: "routine",
          ownerId: user,
          title: "Zulu Waltz",
          dance: "waltz",
        },
      ],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // Both routines are in the normal list before searching.
    await expect(page.getByText("My Foxtrot")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Zulu Waltz")).toBeVisible({ timeout: 10_000 });

    // Type a prefix that only matches "My Foxtrot" (search is prefix-on-title).
    await page.getByRole("searchbox", { name: /search/i }).fill("My");

    // The search RESULTS region (<ul aria-label="Search results">, ChoreoList.tsx)
    // is rendered only when searchResults.length > 0. Scoping to it here proves
    // the API returned something and that the right item is in that subset.
    const resultsRegion = page.getByRole("list", { name: /search results/i });

    // Wait for the debounce (~300 ms) + network round-trip.
    await expect(resultsRegion.getByText("My Foxtrot")).toBeVisible({ timeout: 10_000 });

    // "Zulu Waltz" must NOT appear in the search results (it IS in the normal list,
    // so this assertion would fail if search were returning everything unfiltered).
    await expect(resultsRegion.getByText("Zulu Waltz")).not.toBeVisible();

    // Bonus: clicking the result navigates to the routine.
    await resultsRegion.getByText("My Foxtrot").click();
    await expect(page).toHaveURL(/\/routines\/rt_search_foxtrot/, { timeout: 10_000 });
  });
});
