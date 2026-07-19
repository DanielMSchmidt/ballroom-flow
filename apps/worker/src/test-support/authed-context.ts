// ─────────────────────────────────────────────────────────────────────────
// authedContext(role) (docs/system/testing.md: "authedContext(role)"). Produces everything
// a permission test needs for ONE actor against ONE doc:
//   • a seeded user,
//   • a seeded Membership with the requested role (or none → non-member),
//   • a minted, signed JWT for that user (verifies against the worker's
//     CLERK_JWT_KEY = keypair.publicKeyPem — see jwt.ts),
//   • an `authHeaders()` helper for fetch / WS upgrade requests.
//
// This is the boundary fixture for US-021 (DO connection permission) and the
// REST permission paths. The DO/route then verifies the JWT and looks up the
// per-doc role from D1 (seedDb) — exactly the production path, deterministically.
//
// Per-suite setup contract (the caller wires this in beforeAll):
//   1. await applyMigrations();
//   2. const kp = await generateTestKeypair();  // set env CLERK_JWT_KEY = kp.publicKeyPem
//   3. await seedDb({...});                      // or SAMPLE_SEED
//   4. const ctx = await authedContext({ keypair: kp, userId, docRef, role });
// ─────────────────────────────────────────────────────────────────────────
import { makeExpiredJWT, makeTestJWT, type TestKeypair } from "./jwt";
import type { MembershipRole, SeedMembership } from "./seed";

export interface AuthedContextOptions {
  keypair: TestKeypair;
  userId: string;
  /** The doc this actor is acting against (for the role/membership). */
  docRef: string;
  /** The granted role, or `null`/omitted to model a NON-MEMBER (forged connection). */
  role?: MembershipRole | null;
  /** Mint an already-expired token (negative path). */
  expired?: boolean;
  /** Extra JWT claims to embed (e.g. Clerk identity claims like `name`/`email`
   *  emitted by the session-token template). Merged over the base `{ sub }`. */
  claims?: Record<string, unknown>;
}

export interface AuthedContext {
  userId: string;
  docRef: string;
  role: MembershipRole | null;
  /** Signed JWT (compact). */
  token: string;
  /** A Membership row to feed seedDb — present only when a role was granted. */
  membership: SeedMembership | null;
  /** Authorization header object for fetch()/WebSocket upgrade. */
  authHeaders(): Record<string, string>;
}

/**
 * Build an authed actor context. Note: this does NOT itself write to D1 — it
 * returns the `membership` row so the caller can include it in a single
 * `seedDb` batch. A `null` role yields `membership: null`, modelling the
 * forged-connection case (valid JWT, no membership) the DO must reject.
 */
export async function authedContext(opts: AuthedContextOptions): Promise<AuthedContext> {
  const { keypair, userId, docRef, role = null, expired = false, claims } = opts;
  const token = expired
    ? await makeExpiredJWT(keypair, userId)
    : await makeTestJWT(keypair, { sub: userId, ...claims });
  const membership: SeedMembership | null = role
    ? { id: `mem_${userId}_${docRef}`, docRef, userId, role }
    : null;
  return {
    userId,
    docRef,
    role,
    token,
    membership,
    authHeaders: () => ({ Authorization: `Bearer ${token}` }),
  };
}
