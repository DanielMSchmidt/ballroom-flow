import { verifyToken } from "@clerk/backend";
import type { Context } from "hono";
import type { Env } from "../index";

export type AuthedUser = { sub: string };

/** The Clerk verification keys an auth check needs (a subset of the worker Env). */
type ClerkKeys = Pick<Env, "CLERK_SECRET_KEY" | "CLERK_JWT_KEY">;

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
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

/** Verify the request's Clerk JWT on a Hono context (the REST surface). */
export function authenticate(c: Context<{ Bindings: Env }>): Promise<AuthedUser | null> {
  return authenticateToken(c.req.header("Authorization"), c.env);
}
