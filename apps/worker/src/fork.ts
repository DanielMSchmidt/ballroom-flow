// apps/worker/src/fork.ts
// Shared fork-routine helper (US-037/US-045/US-055). Extracted from the
// POST /api/routines/:id/fork route so the onboarding gift (starter.ts) can
// reuse the exact same snapshot-clone logic without duplicating it.
import { copyFigureForFork, type FigureDoc, newId } from "@ballroom/domain";
import { routineCapFor } from "./db/admin";
import { createFigureRows, findSavedLibraryFigure, getRegistryTypes } from "./db/figures";
import { linkPlacement } from "./db/placement-edge";
import { countOwnedRoutines, createOwnedRoutine } from "./db/routines";
import type { Env } from "./index";
import { APP_OWNER } from "./sample";

export interface ForkSuccess {
  docRef: string;
  title: string;
  dance: string;
  forkedFromRef: string;
  /** The forker's plan — returned so the route needn't re-query it for the response. */
  plan: string;
}

export interface ForkUpsell {
  upsell: true;
  cap: number;
  owned: number;
  plan: string;
}

/**
 * Clone a routine into a new, owned document for `userId`. Identical to the
 * logic formerly inline in POST /api/routines/:id/fork, but extracted so
 * seedStarterRoutine can share it (passing skipQuota:true for the gift).
 *
 * Returns a ForkSuccess with the new doc's metadata, or a ForkUpsell marker
 * when the user is at/over their plan quota and skipQuota is false/omitted.
 * The caller is responsible for auth checks (role / owner) before calling.
 */
export async function forkRoutineFor(
  env: Env,
  { originRef, userId, skipQuota }: { originRef: string; userId: string; skipQuota?: boolean },
): Promise<ForkSuccess | ForkUpsell> {
  // Resolve the forker's cap + plan once (D31: routineCapFor honours a per-user
  // `routineCapOverride` before the plan default; pro is unbounded). The plan is
  // also returned to the caller for its response body, so the route needn't
  // re-query it.
  const { plan, cap } = await routineCapFor(env.DB, userId);

  // Quota gate (unless caller explicitly bypasses for gifting).
  if (!skipQuota) {
    const owned = await countOwnedRoutines(env.DB, userId);
    if (owned >= cap) {
      return { upsell: true, cap, owned, plan };
    }
  }

  // Snapshot the origin's CRDT content and clone it into a fresh, owned doc.
  // The new doc gets no shared Automerge history → frozen from later origin
  // structural edits (sections/annotations).
  const origin = await env.DOC_DO.get(env.DOC_DO.idFromName(originRef)).getSnapshot();
  const docRef = newId();
  const title = origin.title ?? "Untitled routine";
  const dance = origin.dance ?? "waltz";

  // v5 (PLAN §2.4/§5.2, D12): a fork must be independent of its ORIGIN, so
  // every ACCOUNT figure it places is copied for the forker BEFORE the routine
  // doc is seeded — the fork is born with the correct refs, never re-pointed by
  // post-hoc CRDT surgery. A variant is copied AS a variant (`copyFigureForFork`
  // keeps `baseFigureRef`, so catalog flow-in continues); a from-scratch custom
  // is copied plain. A GLOBAL (catalog) ref — and a ref with no registry row at
  // all, a dangling/legacy reference there's nothing to copy — is left OUT of
  // the map below, so its placement keeps pointing at the original (globals
  // stay live by design, §5.2).
  const figureRefs = [
    ...new Set(
      (origin.sections ?? []).flatMap((s) =>
        (s.placements ?? []).map((p) => p.figureRef).filter((ref): ref is string => ref != null),
      ),
    ),
  ];
  const figureCopies = await copyAccountFiguresForFork(env, figureRefs, userId);

  const sections = (origin.sections ?? []).map((section) => ({
    ...section,
    placements: (section.placements ?? []).map((p) => {
      const copyRef = p.figureRef ? figureCopies.get(p.figureRef) : undefined;
      return copyRef ? { ...p, figureRef: copyRef } : p;
    }),
  }));

  await createOwnedRoutine(env.DB, {
    docRef,
    ownerId: userId,
    title,
    dance,
    forkedFromRef: originRef,
  });

  await env.DOC_DO.get(env.DOC_DO.idFromName(docRef)).seedDoc({
    ...origin,
    sections,
    id: docRef,
    ownerId: userId,
    forkedFromRef: originRef,
    schemaVersion: origin.schemaVersion ?? 1,
    deletedAt: null,
  });

  // Placement edges for the new routine → figure COPIES (never the originals —
  // those edges stay on the origin routine), so the role cascade (§5.1) grants
  // the fork's own members edit access to figures only THEY can now reach.
  for (const copyRef of figureCopies.values()) {
    await linkPlacement(env.DB, docRef, copyRef);
  }

  return { docRef, title, dance, forkedFromRef: originRef, plan };
}

/**
 * Copy every ACCOUNT figure in `figureRefs` for the forker (v5, PLAN §2.4/§5.2)
 * and return a map of origin figureRef → the forker's new copy. Left OUT of the
 * returned map (placement stays live) for three cases:
 *   • a GLOBAL (catalog) ref (registry `type='global-figure'`);
 *   • a ref with no registry row at all (dangling/legacy — nothing to copy);
 *   • an APP-owned ref (`ownerId === APP_OWNER`) — the read-only start-from-
 *     template figures (sample.ts) are registered `type='account-figure'` for
 *     historical reasons (US-045/Task 6) but are, in effect, catalog content:
 *     nothing ever edits them in place (no admin/user edit route exists for an
 *     app-owned figure), so there is no "origin's later edits" for a fork to
 *     protect against — copying them would only add DO round-trips (this is
 *     the ~6-figure Golden Waltz Basic template forked on EVERY onboarding,
 *     starter.ts) for no independence benefit.
 *
 * Sequential per-figure DO round-trips (fetch snapshot, then seed the copy) —
 * fine at the scale a routine references figures (dozens, not thousands); the
 * registry-type lookup itself is batched (`getRegistryTypes`). There is no
 * cross-DO batch RPC to fan this out further.
 */
async function copyAccountFiguresForFork(
  env: Env,
  figureRefs: string[],
  forkerId: string,
): Promise<Map<string, string>> {
  const copies = new Map<string, string>();
  if (figureRefs.length === 0) return copies;

  const types = await getRegistryTypes(env.DB, figureRefs);
  for (const ref of figureRefs) {
    if (types.get(ref) !== "account-figure") continue; // global, or unregistered — leave live

    // The DO RPC stub degrades the `FigureDoc | null` return type — reassert it
    // (same cast the GET /api/routines/:id/snapshot route uses for the same call).
    const figure = (await env.DOC_DO.get(
      env.DOC_DO.idFromName(ref),
    ).getFigureSnapshot()) as FigureDoc | null;
    if (!figure) continue; // never-seeded/dangling doc — nothing to copy
    if (figure.ownerId === APP_OWNER) continue; // app-owned template content — see above

    copies.set(ref, await copyOneAccountFigureForFork(env, figure, forkerId));
  }
  return copies;
}

/**
 * Copy ONE account figure for a fork: mint the copy (`copyFigureForFork`),
 * eager-project its D1 rows (`createFigureRows` — mirrors POST /api/figures'
 * #205 seed), and seed its DO durably.
 *
 * `createFigureRows` fails closed with `owner_conflict` for TWO different D1
 * reasons that both surface identically:
 *   1. a genuine `newId()` docRef collision (vanishingly unlikely) — retried
 *      below with a fresh id (`copyFigureForFork` mints one each call);
 *   2. for a VARIANT copy, the `account_figure_base_idx` partial unique index
 *      (migration 0010: at most ONE account-figure per `(ownerId,
 *      forkedFromRef)`, written for save-to-library idempotency) — this fires
 *      when the forker ALREADY owns some derivative of the SAME base (from
 *      unrelated prior activity, or because the figure being forked is
 *      already theirs). That derivative is itself an independent figure the
 *      forker fully controls, so reusing it keeps the fork independent of the
 *      ORIGIN just as well as minting a redundant new copy would — resolved
 *      via `findSavedLibraryFigure` (a same-shape (owner, base) → docRef
 *      lookup) rather than failing the whole fork.
 */
async function copyOneAccountFigureForFork(
  env: Env,
  figure: FigureDoc,
  forkerId: string,
): Promise<string> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const copy = copyFigureForFork(figure, forkerId);
    const created = await createFigureRows(env.DB, {
      figureRef: copy.id,
      ownerId: forkerId,
      name: copy.name,
      dance: copy.dance,
      figureType: copy.figureType,
      baseFigureRef: copy.baseFigureRef,
    });
    if (created === "owner_conflict") {
      if (copy.baseFigureRef) {
        const existing = await findSavedLibraryFigure(env.DB, forkerId, copy.baseFigureRef);
        if (existing) return existing; // reuse the forker's own existing derivative
      }
      continue; // no existing derivative found — a genuine id collision, retry fresh
    }
    await env.DOC_DO.get(env.DOC_DO.idFromName(copy.id)).seedDoc({
      ...copy,
      schemaVersion: copy.schemaVersion ?? 1,
    });
    return copy.id;
  }
  throw new Error(`fork: exhausted newId() collision retries copying figure ${figure.id}`);
}
