import { verifyToken } from "@clerk/backend";
import type { Context } from "hono";
import type { Env } from "../index";

export type AuthedUser = {
  sub: string;
  /** A human display name derived from the token's Clerk identity claims, when
   *  present (see `displayNameFromClaims`). Absent when the session token carries
   *  no name/username claim (Clerk's default token is `sub`-only — add the
   *  claims via the session-token template; see PROVISIONING.md). */
  name?: string;
  /** The user's email from the token's Clerk claims, when present. Kept SEPARATE
   *  from `name` so it can be shown as a distinct fallback (a member's full email
   *  is more recognisable than the raw `user_…` id) when no real name exists.
   *  See `emailFromClaims`. */
  email?: string;
};

/** The Clerk verification keys an auth check needs (a subset of the worker Env). */
type ClerkKeys = Pick<Env, "CLERK_SECRET_KEY" | "CLERK_JWT_KEY">;

const trimmed = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/**
 * Derive a human display NAME from a verified Clerk JWT's claims, or `undefined`
 * when none are present. Prefers a full name, then a username — accepting the
 * common claim spellings so it works whether the session-token template emits
 * camelCase (`firstName`), snake_case (`first_name`), or the OIDC standard
 * (`given_name`). Networkless (no Clerk fetch).
 *
 * Email is intentionally NOT folded in here — it's surfaced separately via
 * `emailFromClaims` so a member with only an email claim shows their actual
 * email address (a distinct fallback tier) rather than a bare local-part.
 */
export function displayNameFromClaims(claims: Record<string, unknown>): string | undefined {
  const first =
    trimmed(claims.firstName) ?? trimmed(claims.first_name) ?? trimmed(claims.given_name);
  const last = trimmed(claims.lastName) ?? trimmed(claims.last_name) ?? trimmed(claims.family_name);
  const joined = [first, last].filter(Boolean).join(" ");
  const full =
    trimmed(claims.name) ??
    trimmed(claims.fullName) ??
    trimmed(claims.full_name) ??
    (joined || undefined);
  if (full) return full;
  return trimmed(claims.username);
}

/**
 * Derive the user's EMAIL from a verified Clerk JWT's claims, or `undefined`.
 * Accepts the common claim spellings (`email`, `email_address`, `primaryEmail`)
 * so it works across session-token templates. Networkless (no Clerk fetch).
 * Used as the fallback shown for a member who is logged in but has no name yet —
 * better than the raw `user_…` id (see `listMembers` / `/api/me`).
 */
export function emailFromClaims(claims: Record<string, unknown>): string | undefined {
  return trimmed(claims.email) ?? trimmed(claims.email_address) ?? trimmed(claims.primaryEmail);
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
    const claims = payload as unknown as Record<string, unknown>;
    return {
      sub: payload.sub,
      name: displayNameFromClaims(claims),
      email: emailFromClaims(claims),
    };
  } catch {
    return null;
  }
}

/** Verify the request's Clerk JWT on a Hono context (the REST surface). */
export function authenticate(c: Context<{ Bindings: Env }>): Promise<AuthedUser | null> {
  return authenticateToken(c.req.header("Authorization"), c.env);
}
