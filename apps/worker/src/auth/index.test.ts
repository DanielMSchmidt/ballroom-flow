import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { displayNameFromClaims } from "./index";

// Negative-path auth tests — deterministic without live Clerk keys.
// The positive path (a real Clerk-issued token → 200 with sub) is exercised
// after provisioning (see PROVISIONING.md) / in M3 with a signed test key.

it("rejects /api/me without a bearer token", async () => {
  const res = await SELF.fetch("https://example.com/api/me");
  expect(res.status).toBe(401);
});

it("rejects /api/me with an invalid token", async () => {
  const res = await SELF.fetch("https://example.com/api/me", {
    headers: { Authorization: "Bearer not-a-real-token" },
  });
  expect(res.status).toBe(401);
});

describe("displayNameFromClaims — a real name from Clerk session-token claims", () => {
  it("prefers a full `name` claim", () => {
    expect(displayNameFromClaims({ name: "Ada Lovelace" })).toBe("Ada Lovelace");
  });

  it("joins first + last across claim spellings", () => {
    expect(displayNameFromClaims({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(displayNameFromClaims({ given_name: "Grace", family_name: "Hopper" })).toBe(
      "Grace Hopper",
    );
  });

  it("falls back to username, then the email local-part", () => {
    expect(displayNameFromClaims({ username: "ada" })).toBe("ada");
    expect(displayNameFromClaims({ email: "grace@example.com" })).toBe("grace");
  });

  it("returns undefined when the token carries no identity claim (sub-only)", () => {
    expect(displayNameFromClaims({ sub: "user_123" })).toBeUndefined();
    expect(displayNameFromClaims({ name: "   " })).toBeUndefined();
  });
});
