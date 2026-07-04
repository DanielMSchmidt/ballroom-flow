// Identity-colour assignment for a choreo's members (US-039 threads, DESIGN-
// PRINCIPLES #5 — authorship legible by colour + name).
//
// A member who has set a profile colour keeps it. A member who hasn't — the
// "logged in, no profile yet" case — gets a DEFAULT colour chosen to differ from
// the OTHER participants in the same choreo, so two profile-less co-editors never
// collide on the same avatar / note tint (the reported bug: everyone fell back to
// identity slot 1 / blue). Deterministic (stable per user + roster), so a member
// reads the same colour across renders and devices.
import { IDENTITY_HEX } from "../ui";

/** A member as far as colour assignment cares: an id + any chosen colour. */
export interface ColorableMember {
  userId: string;
  /** The member's chosen identity colour hex, when they've onboarded. */
  identityColor?: string;
}

/** A stable palette slot for a user id (small string hash → index). */
function hashSlot(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return h % IDENTITY_HEX.length;
}

/**
 * Pick a default colour for `userId` that avoids the `taken` set. Starts from the
 * user's stable hash slot and linear-probes forward, so colours stay stable per
 * user yet distinct within a choreo (guaranteed distinct for up to
 * `IDENTITY_HEX.length` members; beyond that the palette wraps and may repeat).
 */
export function defaultIdentityColor(
  userId: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const start = hashSlot(userId);
  for (let i = 0; i < IDENTITY_HEX.length; i++) {
    const hex = IDENTITY_HEX[(start + i) % IDENTITY_HEX.length];
    if (hex && !taken.has(hex.toLowerCase())) return hex;
  }
  // Palette exhausted (more members than slots) — fall back to the hash slot.
  return IDENTITY_HEX[start] ?? IDENTITY_HEX[0];
}

/**
 * Build `userId → identity colour` for a choreo's members. Chosen colours claim
 * their slot first; profile-less members then get distinct defaults that avoid
 * the colours already in use (their own + the others'). Roster order is honoured,
 * so an earlier-joined member keeps first pick when a default would collide.
 */
export function buildMemberColorMap(members: ColorableMember[]): Record<string, string> {
  const map: Record<string, string> = {};
  const taken = new Set<string>();
  // Pass 1: real, chosen colours claim their slot.
  for (const m of members) {
    const chosen = m.identityColor?.trim();
    if (chosen) {
      map[m.userId] = chosen;
      taken.add(chosen.toLowerCase());
    }
  }
  // Pass 2: assign distinct defaults to members without a chosen colour.
  for (const m of members) {
    if (map[m.userId]) continue;
    const color = defaultIdentityColor(m.userId, taken);
    map[m.userId] = color;
    taken.add(color.toLowerCase());
  }
  return map;
}
