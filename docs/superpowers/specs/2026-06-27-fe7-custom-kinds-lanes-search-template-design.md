# FE-7 — Custom kinds / Lanes / Search / Start-from-template (US-043–046)

**Date:** 2026-06-27 · **Branch base:** `development` · **Milestone:** M7
**Epic:** FE-7 (feature-epic table, `docs/USER-STORIES.md`) — done only when the
`@smoke` Playwright journeys are green on PR.

## Goal

Ship the four M7 authoring-power stories as one cohesive feature:

- **US-043** — create/edit user-defined attribute kinds that merge into the
  registry and appear in the editor, lanes, info sheet and chips.
- **US-044** — Lanes: view/edit one kind laid out across every count of a figure.
- **US-045** — an app-owned **read-only sample** routine + an explicit
  **Start from template** action that clones a `templateOf` routine into an
  owned, editable, quota-counted routine.
- **US-046** — search routines + figures by title/name/dance over the D1 index,
  with the EXPLAIN no-SCAN gate satisfied.

The scaffolded (skipped) tests already exist for each story; "done" unskips them,
makes them green, adds the missing domain/contract unit coverage, and lands the
`@smoke` E2E journeys.

## Decisions (locked with the user, 2026-06-27)

1. **Custom-kind storage = account-defined, routine-embedded.** A kind is the
   user's personal vocabulary (lives on their **account doc**) AND is embedded as
   a copy into any **routine doc** that uses it, so co-editors and forks resolve
   the descriptor without reading the author's account doc.
2. **Search = prefix match, indexed.** `LIKE 'q%'` (no leading wildcard) over a
   `COLLATE NOCASE` index — passes the EXPLAIN gate with a real `SEARCH … USING
   INDEX`. The scaffolded test SQL is updated to the prefix form.
3. **Start-from-template = full server seed path.** An app-owned (`ownerId:
   "app"`) read-only sample routine + its figures are server-seeded into D1 + DO
   content; start-from-template forks it via the existing quota-checked fork
   endpoint. The fork **counts against** the 3-routine free cap.
4. **Done bar = component + worker tests AND `@smoke` E2E journeys.**
5. **Custom-kind delete is deferred** (YAGNI; orphaned values would need a
   migration story). Create + edit only.
6. **Search box lives in the Choreo list header.**

### Relationship to the existing onboarding gift (US-055)

`apps/worker/src/starter.ts` (`seedStarterRoutine` → `buildGoldenWaltzBasic`)
already gifts a "Golden Waltz Basic" **owned** routine on first onboarding,
bypassing the quota gate. That is the "one routine we start with" and is the
rough "start from template" the user referred to. US-045 is **distinct**: a
read-only *sample* + an explicit *Start from template* picker. This spec builds
US-045 cleanly and reuses the same domain builder/seed primitives so the two
mechanisms converge rather than diverge. **Converging the onboarding gift to fork
the app-owned template is an OPTIONAL follow-up within this branch**, surfaced for
the user to accept/decline at plan time — not a rip-out of working onboarding.

---

## A. US-043 — Custom attribute kinds

### Data model (`packages/domain`)

Add an optional `customKinds` field to two doc schemas in
`packages/domain/src/doc-types.ts` + their Zod schemas + `read*`/factory helpers:

```ts
interface AccountDoc  { …; customKinds?: RegistryKind[]; }   // source of truth
interface RoutineDoc  { …; customKinds?: RegistryKind[]; }   // embedded copies
```

- A new `zRegistryKind` Zod schema validates a descriptor: kebab-case slug,
  `label`, hex `color`, `cardinality ∈ {single,multi}`, `valueType ∈ {enum,text}`,
  `values?: string[]`, `builtin: false`.
- **Builtin slugs are reserved** — already enforced by `mergeRegistry` (a custom
  kind colliding with a builtin is ignored). A new `slugifyKind(label)` +
  `isReservedKind(slug)` helper rejects collisions at creation time too (defence
  in depth, mirrors the registry guard).
- `customKinds` defaults to `[]` everywhere (forward-compatible read: old docs
  without the field read as no custom kinds).

### Components (`apps/web`)

- **`AddKindSheet.tsx`** (new) — a `Sheet`-based form capturing
  `{ label, color, cardinality, valueType, values[] }`. Slugifies the label,
  builds a `RegistryKind` (`builtin:false`), calls `onCreate(descriptor)`. Inline
  validation: non-empty label, non-reserved slug, ≥1 value for `enum`.
- **`AttributeEditor.tsx`** (edit) — accept `customKinds?: RegistryKind[]` and
  render off `mergeRegistry(ATTRIBUTE_REGISTRY, customKinds)` instead of the bare
  registry. The scaffolded test's arrange is updated to pass an `energy`
  descriptor; the asserted behaviour ("an Energy section appears") is the
  contract.

### Store seam (`apps/web/src/store`)

- `RoutineStore.createCustomKind(descriptor: RegistryKind): void` — writes the
  descriptor to the **account doc** (opening its connection if needed) AND embeds
  a copy into the **current routine doc**. Embedding happens at create time
  (deterministic; "embed only on first use" is a deliberately-skipped
  optimization).
- The store exposes the merged custom descriptors (`account ∪ routine`,
  de-duped by slug) so the Assemble screen passes them to `AttributeEditor` /
  `Lanes`.
- The account doc connection is a new, small seam concern; reuse the existing
  `DocConnection` plumbing (the account doc already exists for annotations).

### Persistence / reload (AC-3)

Round-trips through Automerge → the routine/account DO. A reload re-reads
`customKinds` from the synced doc; the E2E journey asserts the kind survives a
page reload.

---

## B. US-044 — Lanes (one kind across all counts)

- **`Lanes.tsx`** (new) — props `{ kind, role, dance?, initialView?, figure /
  attributes, onChange }`. Renders an ARIA `grid` (`role="grid"`) with one
  `gridcell` per count of the figure, each cell showing/editing that count's value
  for the single `kind`. Edits emit the same attribute mutation the timeline uses
  (shared store mutation — a lane edit and a timeline edit are indistinguishable
  downstream).
- **Role-view filter shared, not duplicated.** Extract the role-lens filter
  currently inside `FigureTimeline` into a small pure helper
  (`filterByRoleView(attributes, view)`) and use it from both `FigureTimeline` and
  `Lanes`. Both honor the same per-device view toggle.
- Custom kinds work in a lane for free (the lane reads the merged registry).

---

## C. US-045 — Sample routine + start-from-template

### Server (`apps/worker`)

- **Seed an app-owned sample.** A new `seedSampleRoutine(env)` (sibling of
  `seedStarterRoutine`) projects the `SAMPLE_ROUTINE` domain fixture + its figures
  with `ownerId: "app"`, `templateOf` set, into D1 + DO content (idempotent —
  `seedDoc` is no-clobber). Invoked once (a seed/migration hook or first-request
  guard; chosen at plan time).
- **`GET /api/templates`** — lists app-owned routines where `templateOf` is set
  (the sample is the first). Indexed via `document_registry_owner_idx`
  (`ownerId="app"`). Returns `RoutineListItem`-shaped rows.
- **Start from template = fork.** Reuse the existing **quota-checked**
  `POST /api/routines/:id/fork`. The app-owned template must be **forkable by any
  authenticated user** (read access to an app-owned template; the fork produces an
  owned, independent copy — copy-on-write per US-007/008). Confirm the fork path
  grants the necessary read on `ownerId="app"` docs; add an explicit allow if the
  fail-closed boundary refuses it.
- **Read-only enforcement.** The sample has no membership for the viewer → the DO
  boundary resolves viewer/none; it opens read-only and cannot be edited in place.

### Web (`apps/web`)

- **`ChoreoList` empty state** surfaces: the read-only **sample** (opens
  read-only) + a **Start from template** action (forks → navigates to the owned
  copy). The scaffolded `choreo-list` US-045 tests assert both affordances + the
  read-only labelling.
- The Assemble header already carries the fork affordance (US-037) for the
  read-only-open case (Make a copy).

---

## D. US-046 — Routine + figure search

### Server (`apps/worker`)

- **Migration** (`0007_search_index.sql`): `CREATE INDEX IF NOT EXISTS
  document_registry_title_idx ON document_registry (title COLLATE NOCASE);`
  (NOCASE so SQLite uses the index for case-insensitive prefix `LIKE`). A second
  index on `(figureType COLLATE NOCASE)` if figure-name search needs it.
- **`GET /api/search?q=…&dance=…`** — prefix search over the registry, scoped to
  the caller's reachable docs: **owned + shared-in routines** (`ownerId = caller`
  / membership) and **global + owned figures** (`ownerId IN (caller, 'app')`).
  No cross-user leakage. The scoping is what makes the query indexable: a scoped
  query `WHERE ownerId = ? AND deletedAt IS NULL AND title LIKE 'q%'` is served by
  the existing `document_registry_owner_idx` as a `SEARCH … USING INDEX
  (ownerId=?)` (the `title LIKE 'q%'` is an applied filter, **not** a SCAN). The
  new `document_registry_title_idx (title COLLATE NOCASE)` additionally covers the
  global-figure prefix branch (`ownerId='app'`) where many rows share one owner.
  Shared-in routines are reached via `membership_user_idx` (already indexed).
- **The EXPLAIN gate tests the REAL query.** `expectIndexedQuery` /
  `expectIndexedDrizzle` is fed the exact compiled SQL the route runs (scoped +
  prefix), so the gate proves the *shipped* search is indexed — not a stand-in.
- **Scaffolded test update.** `apps/worker/src/routes/search.test.ts` US-046 AC-2
  is rewritten from the unscoped leading-wildcard `LIKE '%feather%'` to the real
  scoped prefix query. AC-1 (the 200 + result) stays.

### Web (`apps/web`)

- A search box in the **Choreo list header**; the store wires it to
  `GET /api/search` (debounced). Results render as a filtered list above the
  routine cards; tapping a result opens it.

---

## E. Contract (`packages/contract`)

- `zRegistryKind` (shared validator for custom kinds, also used by the worker if
  custom kinds are ever projected).
- `zSearchResult` / `zSearchResults` for `GET /api/search`.
- `zTemplateListItem` (or reuse `zRoutineListItem`) for `GET /api/templates`.

Dependency direction respected: `contract → domain`; `web/worker → contract,
domain`.

---

## F. Testing & done-bar

**Unit / component / worker (unskip the scaffolds + add coverage):**

- `packages/domain/src/vocabulary.test.ts` — custom kind merge (US-003 primitive,
  already covers `mergeRegistry`); add slug/reserved-collision cases.
- `packages/domain` doc-schema tests — `customKinds` round-trips through
  read/factory; default `[]`.
- `apps/web/src/components/custom-kind.test.tsx` — US-043 (AddKindSheet captures
  the descriptor; the kind appears in the editor). Arrange updated to a descriptor.
- `apps/web/src/components/attribute-editor.test.tsx` — US-044 Lanes describe.
- `apps/web/src/components/choreo-list.test.tsx` — US-045 sample + template.
- `apps/worker/src/routes/search.test.ts` — US-046 (200 result + EXPLAIN indexed,
  prefix form).
- a11y: extend `a11y.test.tsx` rows for AddKindSheet + Lanes (axe clean).

**E2E `@smoke` (real-worker #191 harness, `apps/web/e2e`):**

- `authoring.spec.ts` (extend) — create a custom kind → it appears in the editor
  and in a lane; survives a reload (AC-3).
- `choreo-list`/new spec — empty state → Start from template → owned editable
  copy; the sample stays read-only.
- new `search.spec.ts` — type a query in the Choreo header → a matching
  routine/figure appears.

Run gates explicitly per the worktree workflow: `pnpm lint && pnpm typecheck &&
pnpm test`, then `pnpm test:e2e:smoke`.

---

## G. Sequencing

1. **Domain + contract** — `customKinds` schema + helpers; `zRegistryKind`,
   `zSearchResult(s)`, template list shape. Unit tests green.
2. **Worker** — search route + migration/index (EXPLAIN green); sample seed +
   `GET /api/templates`; verify the fork path forks an `ownerId="app"` template.
3. **Store seam** — `createCustomKind`, merged-registry exposure, template-fork +
   search wiring; account-doc connection.
4. **Components** — `AddKindSheet`, `Lanes`, `ChoreoList` empty state + header
   search. Component + a11y tests green.
5. **E2E** — the three `@smoke` journeys green.

Each step is TDD (RED→GREEN→REFACTOR): unskip/author the failing test first.

## H. Out of scope (YAGNI / deferred)

- Custom-kind **delete** (orphaned-value migration story) — deferred.
- Annotation/content search (v1.1, per US-046 AC).
- FTS5 substring search — prefix is sufficient for v1; revisit if testers need
  mid-word matches.
- US-055 onboarding-gift refactor — optional follow-up, decided at plan time.
- "Embed custom kind only on first use" optimization — embed-at-create instead.
