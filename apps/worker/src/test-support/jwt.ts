// ─────────────────────────────────────────────────────────────────────────
// Clerk test JWT minting (PLAN §10.3: "Clerk test JWKS/PEM + makeTestJWT; real
// verify + per-doc role lookup at the DO boundary").
//
// We mint REAL RS256 JWTs with a locally-generated RSA keypair using Web Crypto
// (available in workerd, so this runs inside vitest-pool-workers). The matching
// PUBLIC key is exported as PEM so it can be injected as the worker's
// `CLERK_JWT_KEY` env var — `@clerk/backend`'s `verifyToken({ jwtKey })` then
// verifies our tokens NETWORKLESSLY (no Clerk JWKS fetch). This exercises the
// real auth boundary (auth/index.ts) deterministically, with no live Clerk.
//
// No new dependency: built on Web Crypto + base64url, not `jose`/`jsonwebtoken`.
// (If a future test needs ES256/EdDSA or JWKS rotation, consider adding `jose`
// — see TEST-MAP.md "Missing dependencies". RS256 is enough for v1.)
// ─────────────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function base64url(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") bytes = enc.encode(input);
  else if (input instanceof Uint8Array) bytes = input;
  else bytes = new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A minted keypair + the artifacts the worker needs to verify its tokens. */
export interface TestKeypair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  /** SPKI PEM of the public key — set as the worker's CLERK_JWT_KEY for networkless verify. */
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

/** Generate an RSA-256 keypair and export the public key as SPKI PEM. */
export async function generateTestKeypair(kid = "test-key-1"): Promise<TestKeypair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
  const pem = `-----BEGIN PUBLIC KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PUBLIC KEY-----`;
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicKeyPem: pem, kid };
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
