import { verifyToken } from "@clerk/backend";
import type { Context } from "hono";
import type { Env } from "../index";

export type AuthedUser = { sub: string };

/**
 * Verifies the Clerk session JWT on the request, networklessly, against the
 * configured Clerk keys. Returns the user's Clerk `sub`, or `null` when the
 * request is unauthenticated or the token is invalid/unverifiable.
 *
 * Isolated here so the auth provider can be swapped without touching routes
 * (Q-A1: keep Clerk lock-in contained to this module).
 */
export async function authenticate(c: Context<{ Bindings: Env }>): Promise<AuthedUser | null> {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  try {
    const payload = await verifyToken(token, {
      secretKey: c.env.CLERK_SECRET_KEY,
      jwtKey: c.env.CLERK_JWT_KEY,
    });
    return { sub: payload.sub };
  } catch {
    return null;
  }
}
