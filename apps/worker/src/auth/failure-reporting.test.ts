// ─────────────────────────────────────────────────────────────────────────
// US-049 (2026-07-05 incident) — auth verification failures must be OBSERVABLE.
//
// Production shipped with the SPA's Clerk publishable key and the worker's
// CLERK_* secrets pointing at DIFFERENT Clerk instances: every signed-in user's
// token failed verification, every API call returned 401 ("can't create a
// choreography"), and NOTHING reached Sentry — `authenticateToken` swallowed
// the verification error, and a 401 is a handled response so `app.onError`
// never fires. These tests pin the fix: a CONFIG-CLASS verification failure
// (wrong signature = wrong instance, missing/invalid keys, JWKS trouble) is
// reported to Sentry with its reason; BENIGN user states (an expired token)
// stay quiet; each class reports at most once per isolate so a broken deploy
// can't flood the project.
// ─────────────────────────────────────────────────────────────────────────
import { fetchMock } from "cloudflare:test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  generateTestKeypair,
  makeExpiredJWT,
  makeTestJWT,
  type TestKeypair,
} from "../test-support/jwt";
import { TEST_JWT_PUBLIC_KEY_PEM } from "../test-support/test-keys";

const SENTRY_DSN = "https://pubkey@o123.ingest.sentry.io/456";
/** The env the worker would see with Clerk + Sentry provisioned (networkless verify). */
const AUTH_ENV = { CLERK_JWT_KEY: TEST_JWT_PUBLIC_KEY_PEM, SENTRY_DSN };

/** A keypair the worker does NOT trust — tokens it signs are exactly the
 *  wrong-Clerk-instance signature of the 2026-07-05 production incident. */
async function foreignKeypair(): Promise<TestKeypair> {
  const kp = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );
  // generateKey is typed CryptoKey | CryptoKeyPair; an RSA algorithm always
  // yields a pair — narrow with a runtime check instead of asserting.
  if (!("privateKey" in kp)) throw new Error("expected generateKey to return an RSA keypair");
  return { privateKey: kp.privateKey, publicKey: kp.publicKey, publicKeyPem: "", kid: "foreign" };
}

/** Collects the promises authenticateToken hands to waitUntil so the test can
 *  await the fire-and-forget Sentry POST deterministically. */
function waitUntilCollector(): {
  waitUntil: (p: Promise<unknown>) => void;
  pending: Promise<unknown>[];
} {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p) => void pending.push(p), pending };
}

describe("authenticateToken — verification-failure reporting (US-049 / 2026-07-05 incident)", () => {
  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterAll(() => {
    fetchMock.assertNoPendingInterceptors();
    fetchMock.deactivate();
  });
  beforeEach(async () => {
    const { resetAuthFailureReportingForTest } = await import("./index");
    resetAuthFailureReportingForTest();
  });

  it("reports a token signed by the WRONG key (config-mismatch class) to Sentry, with its reason", async () => {
    // Intent: the incident signature — a structurally valid, unexpired token
    //   whose signature doesn't verify against the worker's CLERK_JWT_KEY
    //   (i.e. SPA and worker point at different Clerk instances) — must emit a
    //   Sentry event naming the verification reason, and still fail closed.
    const { authenticateToken } = await import("./index");

    let envelopeBody = "";
    fetchMock
      .get("https://o123.ingest.sentry.io")
      .intercept({
        method: "POST",
        path: "/api/456/envelope/",
        body: (body) => {
          envelopeBody = String(body);
          return true;
        },
      })
      .reply(200, "{}");

    const foreign = await foreignKeypair();
    const token = await makeTestJWT(foreign, { sub: "user_evil_twin_instance" });
    const { waitUntil, pending } = waitUntilCollector();

    const user = await authenticateToken(`Bearer ${token}`, AUTH_ENV, waitUntil);
    expect(user).toBeNull(); // fail-closed is unchanged
    expect(pending.length).toBe(1); // the report rode waitUntil (not dropped I/O)
    await Promise.all(pending);

    expect(envelopeBody).toContain("AuthVerificationError");
    expect(envelopeBody).toContain("token-invalid-signature");
  });

  it("reports each failure class at most once per isolate (no event flood from a broken deploy)", async () => {
    // Intent: in the incident EVERY request failed identically; one event per
    //   class per isolate is enough signal and protects the Sentry quota.
    const { authenticateToken } = await import("./index");

    fetchMock
      .get("https://o123.ingest.sentry.io")
      .intercept({ method: "POST", path: "/api/456/envelope/" })
      .reply(200, "{}");

    const foreign = await foreignKeypair();
    const { waitUntil, pending } = waitUntilCollector();
    await authenticateToken(
      `Bearer ${await makeTestJWT(foreign, { sub: "u1" })}`,
      AUTH_ENV,
      waitUntil,
    );
    await Promise.all(pending);
    expect(pending.length).toBe(1);

    // Same class again: no second report is even scheduled (disableNetConnect
    // would reject the fetch; the collector staying at 1 proves none happened).
    await authenticateToken(
      `Bearer ${await makeTestJWT(foreign, { sub: "u2" })}`,
      AUTH_ENV,
      waitUntil,
    );
    expect(pending.length).toBe(1);
  });

  it("does NOT report an expired token — a benign user state, not a config failure", async () => {
    // Intent: expired tokens happen all day (a tab left open past the 60s
    //   session-token TTL); they must stay out of Sentry entirely.
    const { authenticateToken } = await import("./index");
    const kp = await generateTestKeypair();
    const { waitUntil, pending } = waitUntilCollector();

    const user = await authenticateToken(
      `Bearer ${await makeExpiredJWT(kp, "user_stale_tab")}`,
      AUTH_ENV,
      waitUntil,
    );
    expect(user).toBeNull();
    expect(pending.length).toBe(0); // nothing scheduled → nothing fetched (net is locked down)
  });

  it("does NOT report (and does not throw) when SENTRY_DSN is unset", async () => {
    // Intent: fail-open observability — an unprovisioned env must behave
    //   exactly as before: quiet 401, no crash, no network attempt.
    const { authenticateToken } = await import("./index");
    const foreign = await foreignKeypair();
    const user = await authenticateToken(`Bearer ${await makeTestJWT(foreign, { sub: "u3" })}`, {
      CLERK_JWT_KEY: TEST_JWT_PUBLIC_KEY_PEM,
    });
    expect(user).toBeNull();
  });

  it("still authenticates a valid token (the happy path is untouched)", async () => {
    const { authenticateToken } = await import("./index");
    const kp = await generateTestKeypair();
    const user = await authenticateToken(
      `Bearer ${await makeTestJWT(kp, { sub: "user_ok" })}`,
      AUTH_ENV,
    );
    expect(user?.sub).toBe("user_ok");
  });
});
