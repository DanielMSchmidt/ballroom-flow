# Default "Golden Waltz Basic" Starter Routine on Onboarding

**Date:** 2026-06-27
**Status:** Approved design
**Branch base:** `development` (post-#71)
**Implements:** US-055 (demo routine on join)

## Goal

Give every NEW user a ready-made **"Golden Waltz Basic"** choreography the first time they onboard, so they land on a populated app instead of an empty one. It's a normal owned, editable routine — their starting point.

## What the routine contains

One section, **"Basic"**, six placements (all six already carry WDSF step timing/actions in `LIBRARY_FIGURES`, so the steps pre-fill):

| # | figure | figureType | timing |
|---|---|---|---|
| 1 | Closed Change on RF | `closed-change-on-rf` | `123` |
| 2 | Natural Turn | `natural-turn` | `123 123` |
| 3 | Closed Change on LF | `closed-change-on-lf` | `123` |
| 4 | Reverse Turn | `reverse-turn` | `123 123` |
| 5 | Whisk | `whisk` | `123` |
| 6 | Chassé from PP | `chasse-from-pp` | `12&3` |

## Architecture: materialize-on-onboarding (not central-template-fork)

A fresh, independent copy is built per user from a domain fixture — no app-owned template doc to provision, no cross-user shared figures. Each user's starter looks exactly like figures/routines they created themselves.

### 1. Domain builder — `packages/domain/src/starter-routine.ts` (pure, TDD)

```ts
buildGoldenWaltzBasic(ownerId: string, mintId: () => string): {
  routine: RoutineDoc;
  figures: FigureDoc[];
}
```

- Defines the 6 figures by `(dance="waltz", figureType, name)` and looks each up in `LIBRARY_FIGURES`, copying its `attributes` verbatim so the seeded timeline matches the library exactly.
- Each `FigureDoc`: `{ id: mintId(), scope:"account", ownerId, figureType, dance:"waltz", name, source:"custom", attributes, schemaVersion:1, deletedAt:null }` — mirroring how a normal library pick instantiates an owned figure (the existing `/api/figures` seed uses `source:"custom"`).
- The `RoutineDoc`: `{ id: mintId(), title:"Golden Waltz Basic", dance:"waltz", ownerId, sections:[{ id:mintId(), name:"Basic", placements:[…6 → figureRef…], deletedAt:null }], annotations:[], schemaVersion:1, deletedAt:null }`.
- `mintId` is injected (worker passes `newId`) so the function is pure and deterministic-testable. If a named figure is somehow missing from the library it is **omitted** (the builder never invents step data) and the omission is surfaced to the caller for logging — the routine still seeds with whatever figures resolved.

### 2. Worker seeding — `apps/worker/src/starter.ts`

```ts
seedStarterRoutine(env: Env, userId: string): Promise<void>
```

Using the existing primitives:
1. `const { routine, figures } = buildGoldenWaltzBasic(userId, newId)`.
2. For each figure: `createFigureRows(DB, { figureRef, ownerId, name, dance, figureType })` → `DOC_DO.get(idFromName(figureRef)).seedDoc(figureDoc)` → `linkPlacement(DB, routine.id, figureRef)`.
3. `createOwnedRoutine(DB, { docRef: routine.id, ownerId, title, dance })` → `DOC_DO.get(idFromName(routine.id)).seedDoc(routine)`.

Figures are created before the routine so the placement edges and references resolve. `seedDoc` is no-clobber, so this is safe against a re-run on the same (already-seeded) doc ids.

### 3. Trigger — first onboarding only — `POST /api/onboarding`

The onboarding route currently upserts the `users` row. Change:
1. `SELECT` the user row **before** the upsert.
2. Upsert as today (capture displayName + identityColor).
3. **If the row was absent** (genuine first onboarding), `await seedStarterRoutine(c.env, user.sub)` wrapped in `try/catch` — a seeding failure is logged and swallowed so onboarding still returns 200 (the account must succeed even if the gift doesn't).

Re-onboarding / profile edits hit the existing-row path → the starter is never re-seeded (seeded at most once per user, keyed on the one-time `users` PK insert).

### Quota

The starter is created via `createOwnedRoutine`, which projects the `document_registry` (type `routine`) + owner `membership` rows — so it **counts as the user's first owned routine** (1 of `FREE_ROUTINE_CAP` = 3). No special-casing in `countOwnedRoutines`. Onboarding itself runs no quota gate, and 1 ≤ 3, so seeding never trips the cap.

## Testing

- **Domain** (`starter-routine.test.ts`): builder returns 1 section named "Basic", 6 placements in the listed order, 6 figures each owned by the given user with `figureType` set and `attributes` equal to the corresponding `LIBRARY_FIGURES` entry's attributes; all minted ids distinct; placements' `figureRef`s match the figures' ids.
- **Worker** (`starter.test.ts` or extend `me-profile.test.ts`): a first `POST /api/onboarding` for a new user seeds "Golden Waltz Basic" (it appears in `GET /api/routines` as owned, and a referenced figure DO is seeded with attributes via the `runInDurableObject` change-replay pattern from `figures.test.ts`); a second onboarding for the same user creates **no** second starter routine.

## Touch list

- `packages/domain/src/starter-routine.ts` (new) + test + export from `index.ts`.
- `apps/worker/src/starter.ts` (new) + test.
- `apps/worker/src/index.ts` — onboarding route: first-run detection + best-effort seed call.

## Out of scope

- Per-step footwork/sway/rise (not in the public syllabus; figures carry only the WDSF timing/start/finish that the library already holds).
- A central app-owned template / `forkedFromRef` provenance (materialize-direct needs none).
- Localization of the routine/section titles.
- Backfilling existing users (this fires on onboarding only; existing accounts are untouched).
