import { verifyToken } from "@clerk/backend";
import type { Context } from "hono";
import type { Env } from "../index";

export type AuthedUser = {
  sub: string;
  /** A human display name derived from the token's Clerk identity claims, when
   *  present (see `displayNameFromClaims`). Absent when the session token carries
   *  no name/username/email claim (Clerk's default token is `sub`-only — add the
   *  claims via the session-token template; see PROVISIONING.md). */
  name?: string;
};

/** The Clerk verification keys an auth check needs (a subset of the worker Env). */
type ClerkKeys = Pick<Env, "CLERK_SECRET_KEY" | "CLERK_JWT_KEY">;

/**
 * Derive a human display name from a verified Clerk JWT's claims, or `undefined`
 * when none are present. Prefers a full name, then a username, then the local
 * part of an email — accepting the common claim spellings so it works whether the
 * session-token template emits camelCase (`firstName`), snake_case (`first_name`),
 * or the OIDC standard (`given_name`). This is how we "get something better than
 * the raw Clerk user id" for a member's name (networkless — no Clerk fetch).
 */
export function displayNameFromClaims(claims: Record<string, unknown>): string | undefined {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const first = str(claims.firstName) ?? str(claims.first_name) ?? str(claims.given_name);
  const last = str(claims.lastName) ?? str(claims.last_name) ?? str(claims.family_name);
  const joined = [first, last].filter(Boolean).join(" ");
  const full =
    str(claims.name) ?? str(claims.fullName) ?? str(claims.full_name) ?? (joined || undefined);
  if (full) return full;
  const username = str(claims.username);
  if (username) return username;
  const email = str(claims.email) ?? str(claims.email_address) ?? str(claims.primaryEmail);
  if (email) return email.split("@")[0] || undefined;
  return undefined;
}

/**
 * Verify a Clerk session JWT from a raw `Authorization` header, networklessly,
 * against the configured Clerk keys. Returns the user's `sub`, or `null` when
 * the header is absent or the token is invalid/unverifiable.
 *
 * Context-free so BOTH the Hono REST surface (`authenticate`) and the DO sync
 * boundary (US-021) verify identically — one place owns the Clerk lock-in (Q-A1).
 */
export async function authenticateToken(
  header: string | null | undefined,
  env: ClerkKeys,
): Promise<AuthedUser | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  try {
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
      jwtKey: env.CLERK_JWT_KEY,
    });
    return {
      sub: payload.sub,
      name: displayNameFromClaims(payload as unknown as Record<string, unknown>),
    };
  } catch {
    return null;
  }
}

/** Verify the request's Clerk JWT on a Hono context (the REST surface). */
export function authenticate(c: Context<{ Bindings: Env }>): Promise<AuthedUser | null> {
  return authenticateToken(c.req.header("Authorization"), c.env);
}
