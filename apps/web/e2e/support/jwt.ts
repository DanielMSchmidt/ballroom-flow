// Mint a REAL RS256 test JWT in the Playwright (Node) process, signed by the
// FIXED test private key. The worker (run with the matching public PEM as
// CLERK_JWT_KEY, see wrangler.toml [env.e2e]) verifies it networklessly — the
// same boundary the worker unit tests exercise, now end-to-end. We reuse the
// committed throwaway keypair (apps/worker/src/test-support/test-keys.ts) so
// there is one source of truth for the key.
import { TEST_JWT_PRIVATE_KEY_PEM } from "../../../worker/src/test-support/test-keys";

const enc = new TextEncoder();

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
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

/** Mint a compact RS256 JWT for `sub`, valid for 1h, signed by the test key. */
export async function mintTestJWT(sub: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(TEST_JWT_PRIVATE_KEY_PEM),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "test-key-1" };
  const payload = { sub, iat: now - 5, exp: now + 3600, iss: "https://test.clerk.local" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(signingInput));
  return `${signingInput}.${base64url(sig)}`;
}
