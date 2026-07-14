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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  // vitest-pool-workers 4.x removed the `fetchMock` export from `cloudflare:test`
  // (undici MockAgent); the supported replacement is spying on `globalThis.fetch`
  // (Cloudflare "Migrate from Vitest 3 to Vitest 4" guide). reportError() (via
  // authenticateToken's waitUntil) calls the global `fetch`, so a spy fully
  // intercepts the outbound Sentry envelope POST — no real network — and the
  // call count is a direct, stronger substitute for assertNoPendingInterceptors.
  beforeEach(async () => {
    const { resetAuthFailureReportingForTest } = await import("./index");
    resetAuthFailureReportingForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a token signed by the WRONG key (config-mismatch class) to Sentry, with its reason", async () => {
    // Intent: the incident signature — a structurally valid, unexpired token
    //   whose signature doesn't verify against the worker's CLERK_JWT_KEY
    //   (i.e. SPA and worker point at different Clerk instances) — must emit a
    //   Sentry event naming the verification reason, and still fail closed.
    const { authenticateToken } = await import("./index");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const foreign = await foreignKeypair();
    const token = await makeTestJWT(foreign, { sub: "user_evil_twin_instance" });
    const { waitUntil, pending } = waitUntilCollector();

    const user = await authenticateToken(`Bearer ${token}`, AUTH_ENV, waitUntil);
    expect(user).toBeNull(); // fail-closed is unchanged
    expect(pending.length).toBe(1); // the report rode waitUntil (not dropped I/O)
    await Promise.all(pending);

    // Exactly one outbound report, to the Sentry envelope endpoint, naming the reason.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error("expected exactly one fetch call");
    expect(String(call[0])).toBe("https://o123.ingest.sentry.io/api/456/envelope/");
    const envelopeBody = String(call[1]?.body);
    expect(envelopeBody).toContain("AuthVerificationError");
    expect(envelopeBody).toContain("token-invalid-signature");
  });

  it("reports each failure class at most once per isolate (no event flood from a broken deploy)", async () => {
    // Intent: in the incident EVERY request failed identically; one event per
    //   class per isolate is enough signal and protects the Sentry quota.
    const { authenticateToken } = await import("./index");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const foreign = await foreignKeypair();
    const { waitUntil, pending } = waitUntilCollector();
    await authenticateToken(
      `Bearer ${await makeTestJWT(foreign, { sub: "u1" })}`,
      AUTH_ENV,
      waitUntil,
    );
    await Promise.all(pending);
    expect(pending.length).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Same class again: no second report is even scheduled — the collector
    // staying at 1 and fetch staying at one call prove none happened.
    await authenticateToken(
      `Bearer ${await makeTestJWT(foreign, { sub: "u2" })}`,
      AUTH_ENV,
      waitUntil,
    );
    expect(pending.length).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
