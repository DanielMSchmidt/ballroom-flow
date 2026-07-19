// ─────────────────────────────────────────────────────────────────────────
// Playwright helpers for MULTI-USER E2E (docs/system/testing.md § Tooling & CI:
// "two live contexts (two users)"). Two isolated browser contexts = two real clients with independent
// storage/session, so convergence/permission/undo tests mimic real co-editing.
//
// No arbitrary sleeps anywhere (docs/system/testing.md § Tooling & CI "No sleeps"): waiting is done by
// `expectConverged` / Playwright web-first assertions on OBSERVABLE state.
// ─────────────────────────────────────────────────────────────────────────
import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

export interface UserSession {
  context: BrowserContext;
  page: Page;
  /** The seeded user id this session is signed in as. */
  userId: string;
}

/**
 * Open an isolated browser context signed in as `userId`. Auth is established
 * deterministically via `seedAuth` (see auth.ts) — no live Clerk in E2E.
 */
export async function openUser(browser: Browser, userId: string): Promise<UserSession> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page, userId };
}

/** Open two co-editing users in parallel (e.g. coach + student). */
export async function openTwoUsers(
  browser: Browser,
  a: string,
  b: string,
): Promise<[UserSession, UserSession]> {
  return Promise.all([openUser(browser, a), openUser(browser, b)]);
}

/** Tidy up both contexts. */
export async function closeUsers(...sessions: UserSession[]): Promise<void> {
  await Promise.all(sessions.map((s) => s.context.close()));
}

/**
 * Wait for two clients to CONVERGE on the same observable text/state — the
 * convergence assertion for live-sync E2E (US-015/052). Polls the locator on
 * BOTH pages until each shows the expected content; relies on Playwright's
 * built-in auto-retry (no sleeps). Use a stable, semantic locator (a test id or
 * accessible name), never a timeout.
 */
export async function expectConverged(
  pages: Page[],
  locator: string,
  expectedText: string | RegExp,
): Promise<void> {
  await Promise.all(
    pages.map((p) => expect(p.locator(locator)).toContainText(expectedText, { timeout: 15_000 })),
  );
}

/** Assert a piece of state is ABSENT on a page (e.g. a frozen fork must not show an origin edit). */
export async function expectAbsent(page: Page, locator: string): Promise<void> {
  await expect(page.locator(locator)).toHaveCount(0);
}
