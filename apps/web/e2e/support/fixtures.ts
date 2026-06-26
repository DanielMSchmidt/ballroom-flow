// Seed/reset the worker's D1 index for E2E journeys via the gated /api/test/*
// routes (mounted only under the E2E wrangler env, #191). page.request uses the
// configured baseURL, so these hit the same origin the app talks to.
import type { Page } from "@playwright/test";

export interface SeedSpec {
  users?: { id: string; displayName: string; identityColor: string; plan?: "free" | "pro" }[];
  docs?: {
    docRef: string;
    type: string;
    ownerId: string;
    doName?: string;
    title?: string | null;
    dance?: string | null;
    figureType?: string | null;
  }[];
  memberships?: {
    id?: string;
    docRef: string;
    userId: string;
    role: "viewer" | "commenter" | "editor";
  }[];
  invites?: {
    id: string;
    docRef: string;
    role: "viewer" | "commenter" | "editor";
    expiresAt: number;
    redeemedAt?: number | null;
  }[];
}

/** Wipe the D1 index (deterministic per-test starting point). */
export async function resetDb(page: Page): Promise<void> {
  const res = await page.request.post("/api/test/reset");
  if (!res.ok()) throw new Error(`reset failed: ${res.status()} ${await res.text()}`);
}

/** Seed D1 index rows for a test. */
export async function seedDb(page: Page, spec: SeedSpec): Promise<void> {
  const res = await page.request.post("/api/test/seed", { data: spec });
  if (!res.ok()) throw new Error(`seed failed: ${res.status()} ${await res.text()}`);
}
