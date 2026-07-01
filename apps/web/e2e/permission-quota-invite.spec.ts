import { expect, test } from "@playwright/test";
import { gotoRoutine, seedAuth, stagePendingAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { closeUsers, openUser } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// Permission / quota / invite journeys (PLAN §10.2 E2E: "permission (forged sync
// connection rejected per doc); quota; invite redemption"). Runs against the REAL
// worker (D1 + per-document Durable Objects + the fail-closed auth/sync boundary)
// via the #191 E2E harness — real test JWTs, the real US-021 boundary.
//   US-021 — a non-member opening a routine is denied (per doc);
//   US-022 — quota: the 4th owned routine → upsell (and isn't created);
//   US-023 — invite redemption grants membership and opens the routine;
//   US-024 — the Share screen: roster + roles, and issuing an invite from the UI.
//
// @smoke — part of the CI PR smoke subset (FE-2 is done only when this is green).
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke permission boundary (non-member denied)", () => {
  test("a non-member opening a routine sees a calm access-denied state (US-021)", async ({
    page,
  }) => {
    // Intent: a user with no membership cannot open a routine (the per-doc gate),
    //   and is told so explicitly — distinct from an offline/connectivity state.
    // Scenario: a stranger deep-links to a routine owned by someone else.
    const owner = "user_owner";
    const stranger = "user_stranger";
    const docRef = "rt_sample";
    await resetDb(page);
    await seedDb(page, {
      users: [
        { id: owner, displayName: "Owner", identityColor: "#111111" },
        { id: stranger, displayName: "Stranger", identityColor: "#222222" },
      ],
      docs: [{ docRef, type: "routine", ownerId: owner, title: "Private Routine", dance: "waltz" }],
    });
    await seedAuth(page, stranger);
    await gotoRoutine(page, docRef);

    // The access preflight (GET …/access → 403) surfaces the denied state; the
    // underlying WS sync is also fail-closed (US-021 AC-2/3) — defence in depth.
    await expect(page.getByRole("heading", { name: /don.?t have access/i })).toBeVisible({
      timeout: 15_000,
    });
    // It must NOT show editing affordances for a denied routine.
    await expect(page.getByRole("button", { name: "Add section" })).toHaveCount(0);
  });
});

test.describe("@smoke quota upsell (4th owned routine)", () => {
  test("creating a 4th owned routine shows the upsell and does not create it (US-022)", async ({
    page,
  }) => {
    // Intent: the free 3-routine cap is enforced with an upsell sourced from the
    //   server (the cap is on /api/me; the create 402 enforces the same value).
    // Scenario: a free user who already owns 3 routines tries to create a 4th.
    const user = "user_full";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Full", identityColor: "#333333", plan: "free" }],
      docs: [1, 2, 3].map((n) => ({
        docRef: `rt_full_${n}`,
        type: "routine",
        ownerId: user,
        title: `Routine ${n}`,
        dance: "waltz",
      })),
    });
    await seedAuth(page, user);
    await page.goto("/");

    // The three owned routines list; New Choreo at cap → the upsell (NOT the form).
    await expect(page.getByText("Routine 1")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /new choreo/i }).click();
    await expect(page.getByText(/upgrade|limit|upsell/i)).toBeVisible();
    // The create form did NOT open (no routine is being created).
    await expect(page.getByLabel("Routine name")).toHaveCount(0);
  });
});

test.describe("@smoke invite redemption", () => {
  test("redeeming a valid invite link grants membership and opens the routine (US-023)", async ({
    page,
  }) => {
    // Intent: a user redeems an invite link and gains the chosen role on the doc.
    // Scenario: an invitee opens an invite URL for rt_sample as commenter.
    const owner = "user_owner";
    const invitee = "user_invitee";
    const docRef = "rt_sample";
    const token = "inv_valid_token";
    await resetDb(page);
    await seedDb(page, {
      users: [
        { id: owner, displayName: "Owner", identityColor: "#111111" },
        { id: invitee, displayName: "Invitee", identityColor: "#444444" },
      ],
      docs: [{ docRef, type: "routine", ownerId: owner, title: "Shared Routine", dance: "waltz" }],
      invites: [{ id: token, docRef, role: "commenter", expiresAt: Date.now() + 86_400_000 }],
    });
    await seedAuth(page, invitee);
    await page.goto(`/invite/${token}`);

    // Redemption deep-links into the joined routine; the invitee (now a commenter
    // member) is allowed IN — not denied — and views it read-only. (The header
    // reads "Untitled routine" because test-seed projects only the D1 index, not
    // the CRDT doc — the doc is empty until a real create seeds it.)
    await expect(page).toHaveURL(/\/routines\/rt_sample/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /untitled routine/i })).toBeVisible({
      timeout: 15_000,
    });
    // Not denied, and commenter ≠ editor → no structural-edit affordances.
    await expect(page.getByRole("heading", { name: /don.?t have access/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add section" })).toHaveCount(0);
  });
});

test.describe("@smoke invite deep-link (signed-out visitor)", () => {
  test("a signed-out friend opening a share link signs in and lands in the routine (US-023)", async ({
    page,
  }) => {
    // Intent: a signed-OUT visitor opening a /invite/:token share link is NOT
    //   dropped on the generic dead-end card — they get a sign-in prompt that
    //   names the shared routine + a real sign-in control, and after signing in
    //   they return to the same link so redemption opens the routine.
    // Regression: the app shell rendered the button-less signed-out card BEFORE
    //   the invite branch, so a friend opening a share link had no way in.
    const owner = "user_share_owner_out";
    const friend = "user_share_friend_out";
    const docRef = "rt_shared_out";
    const token = "inv_signedout_token";
    await resetDb(page);
    await seedDb(page, {
      users: [
        { id: owner, displayName: "Owner", identityColor: "#111111" },
        { id: friend, displayName: "Friend", identityColor: "#555555" },
      ],
      docs: [{ docRef, type: "routine", ownerId: owner, title: "Shared Routine", dance: "waltz" }],
      invites: [{ id: token, docRef, role: "commenter", expiresAt: Date.now() + 86_400_000 }],
    });
    // The friend arrives SIGNED OUT: the session is staged, not active.
    await stagePendingAuth(page, friend);
    await page.goto(`/invite/${token}`);

    // Not a dead end: an invite-aware sign-in prompt (names the shared routine)
    //   with a real sign-in control — and it must NOT auto-redeem or bounce to
    //   the marketing Landing while signed out.
    await expect(page.getByText(/you.?ve been invited to a routine/i)).toBeVisible({
      timeout: 15_000,
    });
    const signIn = page.getByRole("button", { name: /sign in/i });
    await expect(signIn).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/invite/${token}`));

    // Completing sign-in returns to the SAME invite URL → redemption runs → the
    //   friend (now a commenter member) is allowed into the routine, not denied.
    await signIn.click();
    await expect(page).toHaveURL(new RegExp(`/routines/${docRef}`), { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /don.?t have access/i })).toHaveCount(0);
  });
});

test.describe("@smoke share screen (roster + invite from the UI)", () => {
  test("an owner opens Share, sees the roster, and issues an invite link an invitee redeems (US-024)", async ({
    page,
    browser,
  }) => {
    // Intent: prove the Share screen end-to-end — the owner views who has access
    //   and in what role (US-024 AC-1), and issues an invite link THROUGH THE UI
    //   (AC-4) that a real invitee redeems (chaining issue→redeem against the real
    //   worker, not a DB-seeded token). The server still enforces the boundary.
    // Scenario: owner shares a routine that already has one viewer member.
    const owner = "user_share_owner";
    const member = "user_share_viewer";
    const invitee = "user_share_invitee";
    const docRef = "rt_share_sample";
    await resetDb(page);
    await seedDb(page, {
      users: [
        { id: owner, displayName: "Owner", identityColor: "#111111" },
        { id: member, displayName: "Member", identityColor: "#222222" },
        { id: invitee, displayName: "Invitee", identityColor: "#333333" },
      ],
      docs: [{ docRef, type: "routine", ownerId: owner, title: "Shared Routine", dance: "waltz" }],
      memberships: [{ docRef, userId: member, role: "viewer" }],
    });
    await seedAuth(page, owner);
    await gotoRoutine(page, docRef);

    // The owner connects with edit rights → the Share affordance is present.
    const shareButton = page.getByRole("button", { name: "Share" });
    await expect(shareButton).toBeVisible({ timeout: 15_000 });
    await shareButton.click();

    // 1. Roster (AC-1): the existing viewer member shows with their role.
    const shareSheet = page.getByRole("dialog", { name: /share this routine/i });
    // Frame 4.2: section heading is "PARTNERS ON THIS ROUTINE" (CSS uppercase).
    await expect(shareSheet.getByText(/partners on this routine/i)).toBeVisible();
    // Frame 4.2: the member row shows their displayName (T9b: m.displayName ?? m.userId).
    await expect(shareSheet.getByText("Member")).toBeVisible();
    // Frame 4.2: role pill is lowercase "viewer" (not "Viewer" Badge; the invite
    // <option> reads "Viewer — can view", so exact match still distinguishes them).
    await expect(shareSheet.getByText("viewer", { exact: true })).toBeVisible();

    // 2. Issue an invite link from the UI (AC-4): expand the invite form via the
    //    "+ invite someone" CTA (frame 4.2 ③), pick a role, create the link.
    await shareSheet.getByRole("button", { name: /\+ invite someone/i }).click();
    await shareSheet.getByLabel("Role").selectOption("commenter");
    await shareSheet.getByRole("button", { name: "Create link" }).click();
    const inviteCode = shareSheet.locator("code", { hasText: "/invite/" });
    await expect(inviteCode).toBeVisible({ timeout: 15_000 });
    const inviteUrlText = (await inviteCode.textContent())?.trim() ?? "";
    const token = inviteUrlText.match(/\/invite\/([^/\s]+)$/)?.[1];
    expect(token, `expected an invite token in "${inviteUrlText}"`).toBeTruthy();

    // 3. A real invitee redeems the UI-issued link → granted membership, opens the
    //    routine (not denied). This closes the issue→redeem loop end-to-end.
    const guest = await openUser(browser, invitee);
    try {
      await seedAuth(guest.page, invitee);
      await guest.page.goto(`/invite/${token}`);
      await expect(guest.page).toHaveURL(new RegExp(`/routines/${docRef}`), { timeout: 15_000 });
      await expect(guest.page.getByRole("heading", { name: /don.?t have access/i })).toHaveCount(0);
    } finally {
      await closeUsers(guest);
    }
  });
});
