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
    /** When type==="routine" and sections present, the routine DO is server-seeded. */
    sections?: {
      id: string;
      name: string;
      placements: { id: string; figureRef: string }[];
    }[];
    /** Routine annotations server-seeded with explicit (backdatable) createdAt —
     *  the UI stamps Date.now(), so comment activity fade-out journeys backdate
     *  through this seam. */
    annotations?: {
      id: string;
      authorId: string;
      kind: "note" | "lesson" | "practice";
      text: string;
      anchors: unknown[];
      createdAt: number;
      replies?: { id: string; authorId: string; text: string; createdAt: number }[];
    }[];
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
  /** Seed figure docs: D1 registry row + figure DO CRDT content. */
  figures?: {
    docRef: string;
    scope: "global" | "account";
    ownerId: string;
    name: string;
    dance: string;
    figureType: string;
    attributes?: unknown[];
  }[];
  /** Direct placement_edge rows (routine→figure) for the access cascade. */
  placementEdges?: { routineRef: string; figureRef: string }[];
  /** Direct journal_entry rows (T6) — the routine-scoped projection. */
  journalEntries?: {
    entryId: string;
    routineRef: string;
    authorId: string;
    kind: "lesson" | "practice";
    text: string;
    anchors?: unknown[];
    createdAt?: number;
    deletedAt?: number | null;
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
