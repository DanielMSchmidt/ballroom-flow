// ─────────────────────────────────────────────────────────────────────────
// Clerk test JWT minting (docs/system/testing.md: "Clerk test JWKS/PEM + makeTestJWT; real
// verify + per-doc role lookup at the DO boundary").
//
// We mint REAL RS256 JWTs with a FIXED RSA keypair (test-keys.ts) using Web
// Crypto (available in workerd, so this runs inside vitest-pool-workers). The
// matching PUBLIC key is bound as the worker's `CLERK_JWT_KEY` (vitest.config.ts)
// so `@clerk/backend`'s `verifyToken({ jwtKey })` verifies our tokens
// NETWORKLESSLY (no Clerk JWKS fetch). This exercises the real auth boundary
// (auth/index.ts) deterministically, with no live Clerk.
//
// The keypair is FIXED (not generated per run) because the worker under test
// (`SELF`) reads CLERK_JWT_KEY from a STATIC binding — it can't see a runtime
// env mutation (its env is a different object than the test runner's). See
// test-keys.ts for the full rationale.
//
// No new dependency: built on Web Crypto + base64url, not `jose`/`jsonwebtoken`.
// (If a future test needs ES256/EdDSA or JWKS rotation, consider adding `jose`
// — see TEST-MAP.md "Missing dependencies". RS256 is enough for v1.)
// ─────────────────────────────────────────────────────────────────────────

import { TEST_JWT_PRIVATE_KEY_PEM, TEST_JWT_PUBLIC_KEY_PEM } from "./test-keys";

const enc = new TextEncoder();

/** Decode a PEM (BEGIN/END framed base64) to its raw DER bytes. */
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s/g, "");
  const bin = atob(b64);
  const buffer = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return buffer;
}

function base64url(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") bytes = enc.encode(input);
  else if (input instanceof Uint8Array) bytes = input;
  else bytes = new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A test keypair + the artifacts the worker needs to verify its tokens. */
export interface TestKeypair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  /** SPKI PEM of the public key — bound as the worker's CLERK_JWT_KEY for networkless verify. */
  publicKeyPem: string;
  kid: string;
}

/** Standard Clerk-ish JWT claims. `sub` is the Clerk user id the worker reads. */
export interface JwtClaims {
  sub: string;
  /** seconds since epoch; defaults to now-5s. */
  iat?: number;
  /** seconds since epoch; defaults to now+1h. Set in the past for expiry tests. */
  exp?: number;
  iss?: string;
  azp?: string;
  [claim: string]: unknown;
}

/**
 * Load the FIXED RS256 test keypair (test-keys.ts) as Web Crypto keys. Returns
 * the private key (to sign), the public key, and the public SPKI PEM (= the
 * worker's test CLERK_JWT_KEY). Deterministic so it matches the static binding.
 */
export async function generateTestKeypair(kid = "test-key-1"): Promise<TestKeypair> {
  const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(TEST_JWT_PRIVATE_KEY_PEM),
    algorithm,
    false,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    pemToDer(TEST_JWT_PUBLIC_KEY_PEM),
    algorithm,
    false,
    ["verify"],
  );
  return { privateKey, publicKey, publicKeyPem: TEST_JWT_PUBLIC_KEY_PEM, kid };
}

/**
 * Mint a signed RS256 JWT for `claims`, signed by `keypair.privateKey`. The
 * returned compact JWT verifies against `keypair.publicKeyPem` (set as
 * CLERK_JWT_KEY). Defaults give a valid-now, 1h-valid token.
 */
export async function makeTestJWT(keypair: TestKeypair, claims: JwtClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: keypair.kid };
  const payload: JwtClaims = {
    iat: now - 5,
    exp: now + 3600,
    iss: "https://test.clerk.local",
    ...claims,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keypair.privateKey,
    enc.encode(signingInput),
  );
  return `${signingInput}.${base64url(sig)}`;
}

/** Convenience: an already-expired token (exp in the past) for negative-path tests. */
export async function makeExpiredJWT(keypair: TestKeypair, sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return makeTestJWT(keypair, { sub, iat: now - 7200, exp: now - 3600 });
}
