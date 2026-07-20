// Comment activity fade-out (docs/ideas/comment-activity-fadeout.md § The rule):
//   active(c) ⇔ lastActivity(c) ≥ now − 28×24h  (absolute window)
//             ∨ lastActivity(c) ≥ anchor − 7×24h (session-gap window)
// Rolling ms durations, both windows INCLUSIVE. `now` is always injected —
// this suite (and every consumer) never reads the wall clock.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeAnnotation } from "./__fixtures__/factories";
import {
  ACTIVE_WINDOW_MS,
  lastActivity,
  partitionByActivity,
  SESSION_GAP_WINDOW_MS,
} from "./annotation-activity";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000; // fixed, injected — never Date.now()

const at = (msAgo: number, id: string) => makeAnnotation({ id, createdAt: NOW - msAgo });

describe("window constants", () => {
  it("are rolling ms durations (28d absolute, 7d session gap) — never calendar days", () => {
    expect(ACTIVE_WINDOW_MS).toBe(28 * DAY);
    expect(SESSION_GAP_WINDOW_MS).toBe(7 * DAY);
  });
});

describe("lastActivity", () => {
  it("is the max of createdAt and the LIVE replies' createdAt", () => {
    const a = makeAnnotation({
      createdAt: NOW - 100 * DAY,
      replies: [
        { id: "r1", authorId: "u2", text: "old", createdAt: NOW - 90 * DAY, deletedAt: null },
        { id: "r2", authorId: "u2", text: "fresh", createdAt: NOW - 1 * DAY, deletedAt: null },
      ],
    });
    expect(lastActivity(a)).toBe(NOW - 1 * DAY);
  });

  it("ignores tombstoned replies", () => {
    const a = makeAnnotation({
      createdAt: NOW - 100 * DAY,
      replies: [
        { id: "r1", authorId: "u2", text: "deleted", createdAt: NOW - 1 * DAY, deletedAt: NOW },
      ],
    });
    expect(lastActivity(a)).toBe(NOW - 100 * DAY);
  });
});

describe("partitionByActivity — window edges (both inclusive)", () => {
  it("absolute window: exactly 28d old is active; 1ms older is stale (given a fresh anchor)", () => {
    const fresh = at(0, "fresh");
    const onEdge = at(28 * DAY, "edge");
    const past = at(28 * DAY + 1, "past");
    const { active, stale } = partitionByActivity([past, onEdge, fresh], NOW);
    expect(active.map((a) => a.id)).toEqual(["edge", "fresh"]);
    expect(stale.map((a) => a.id)).toEqual(["past"]);
  });

  it("relative window: exactly 7d behind the anchor is active; 1ms further is stale", () => {
    // Quiet routine: everything is far outside the 28d window — only the
    // session-gap clause decides. Anchor at 40d ago.
    const anchor = at(40 * DAY, "anchor");
    const inBurst = at(47 * DAY, "in-burst"); // anchor − 7d exactly
    const before = at(47 * DAY + 1, "before"); // 1ms past the burst
    const { active, stale } = partitionByActivity([before, inBurst, anchor], NOW);
    expect(active.map((a) => a.id)).toEqual(["in-burst", "anchor"]);
    expect(stale.map((a) => a.id)).toEqual(["before"]);
  });

  it("a reply to a stale thread REACTIVATES it (activity is per thread)", () => {
    const mayComment = makeAnnotation({
      id: "may",
      createdAt: NOW - 70 * DAY,
      replies: [
        { id: "r", authorId: "u2", text: "again today", createdAt: NOW - 1 * DAY, deletedAt: null },
      ],
    });
    const other = at(70 * DAY, "other");
    const fresh = at(0, "fresh");
    const { active, stale } = partitionByActivity([mayComment, other, fresh], NOW);
    expect(active.map((a) => a.id)).toEqual(["may", "fresh"]);
    expect(stale.map((a) => a.id)).toEqual(["other"]);
  });

  it("a tombstoned reply is NOT activity", () => {
    const old = makeAnnotation({
      id: "old",
      createdAt: NOW - 70 * DAY,
      replies: [
        { id: "r", authorId: "u2", text: "gone", createdAt: NOW - 1 * DAY, deletedAt: NOW },
      ],
    });
    const fresh = at(0, "fresh");
    expect(partitionByActivity([old, fresh], NOW).stale.map((a) => a.id)).toEqual(["old"]);
  });

  it("returns empty partitions for an empty list", () => {
    expect(partitionByActivity([], NOW)).toEqual({ active: [], stale: [] });
  });
});

describe("partitionByActivity — properties", () => {
  // Comment-like inputs across a heavy-tailed 3-year age range, with optional replies.
  const arbList = fc.array(
    fc
      .record({
        ageMs: fc.integer({ min: 0, max: 1000 * DAY }),
        replyAgesMs: fc.array(fc.integer({ min: 0, max: 1000 * DAY }), { maxLength: 3 }),
      })
      .map(({ ageMs, replyAgesMs }) =>
        makeAnnotation({
          createdAt: NOW - ageMs,
          replies: replyAgesMs.map((r, i) => ({
            id: `r${i}-${r}`,
            authorId: "u2",
            text: "reply",
            createdAt: NOW - r,
            deletedAt: null,
          })),
        }),
      ),
    { minLength: 1, maxLength: 40 },
  );

  it("non-empty input ⇒ non-empty active set (never-empty guarantee)", () => {
    fc.assert(
      fc.property(arbList, (list) => {
        expect(partitionByActivity(list, NOW).active.length).toBeGreaterThan(0);
      }),
    );
  });

  it("the newest (max lastActivity) comment is always active", () => {
    fc.assert(
      fc.property(arbList, (list) => {
        const newest = list.reduce((a, b) => (lastActivity(b) > lastActivity(a) ? b : a));
        expect(partitionByActivity(list, NOW).active).toContain(newest);
      }),
    );
  });

  it("active ∪ stale is an order-preserving partition (no reorder, no loss, no dupes)", () => {
    fc.assert(
      fc.property(arbList, (list) => {
        const { active, stale } = partitionByActivity(list, NOW);
        const activeSet = new Set(active);
        expect(active).toEqual(list.filter((c) => activeSet.has(c)));
        expect(stale).toEqual(list.filter((c) => !activeSet.has(c)));
        expect(active.length + stale.length).toBe(list.length);
      }),
    );
  });

  it("everything with lastActivity within 28d is active regardless of the anchor", () => {
    fc.assert(
      fc.property(arbList, (list) => {
        const { stale } = partitionByActivity(list, NOW);
        for (const c of stale) {
          expect(lastActivity(c)).toBeLessThan(NOW - ACTIVE_WINDOW_MS);
        }
      }),
    );
  });
});
