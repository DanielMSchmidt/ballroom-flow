# Ballroom Flow — User Stories

**Derived from:** `docs/PLAN.md` (v4.4)
**Status:** Backlog for v1. Incrementally ordered, mapped to the M1–M9 roadmap (§9).
**Audience:** build + test engineers. Acceptance criteria are written to be testable at the layer the plan assigns (§10).

## How to read this

- **IDs are stable** (`US-001` …), zero-padded, never reused.
- **Type** is `user-facing` or `system/developer` (M1 domain-core work is developer/system — not end-user-facing — but the test engineer targets it directly).
- **Milestone** maps to the §9 roadmap (M1 = domain core, M2 = DO sync, … M9 = PWA/a11y). The parallel **content workstream** (full-syllabus seed) is tagged `Content`.
- **Walking skeleton** (the minimal independently-testable spine) is flagged in §"Walking skeleton" and marked `🦴` in the index.
- Out-of-scope items (§11 — offline editing, predicate query anchors, billing, ownership transfer, Latin/spot, media, notifications) have **no stories**.

---

## Summary index

| ID | Title | M | Type | Depends-on | Acceptance (one line) |
|---|---|---|---|---|---|
| US-001 🦴 | ULID id generation | M1 | system/developer | — | Client-generated, monotonic, sortable ULIDs for every entity id. |
| US-002 🦴 | Dance metadata registry | M1 | system/developer | — | `DANCES` exposes time-sig, beats/bar, phrase beats, travelling for the 5 Standard dances. |
| US-003 🦴 | ATTRIBUTE_REGISTRY + merge | M1 | system/developer | US-002 | Standard kinds + user-defined kinds merge; Tango omits rise; CBP→CBMP; single vs multi cardinality. |
| US-004 🦴 | Float-count timing | M1 | system/developer | US-002 | `countLabel`/`countToBar`/`barsForFigure` render e/&/a + i-subdivisions modulo phrase. |
| US-005 🦴 | Routine + figure document schemas | M1 | system/developer | US-001,US-003 | Build/read routine & figure Automerge docs (sections, placements, attributes, annotations); soft-delete flips. |
| US-006 🦴 | Overlay resolution `resolve(base,overlay)` | M1 | system/developer | US-005 | base − tombstones + overrides + additions + rename, resolved live so base additions flow up. |
| US-007 🦴 | Choreo fork (clone) | M1 | system/developer | US-005 | `cloneRoutine` → new id, frozen, `forkedFromRef` provenance, no pull from origin. |
| US-008 🦴 | Copy-on-write (auto-variant) | M1 | system/developer | US-005,US-006 | `copyOnWrite` spawns owned variant w/ `baseFigureRef`+empty overlay, placement re-pointed. |
| US-009 🦴 | Automerge convergence invariants | M1 | system/developer | US-005,US-007 | Property tests: shuffled/partitioned changes converge; commutative; idempotent on duplicates. |
| US-010 🦴 | History-based per-user undo | M1 | system/developer | US-005 | Invert a user's last change; A's undo reverts only A; B's concurrent edit survives; redo. |
| US-011 | `figureType` annotation resolution | M1 | system/developer | US-005 | all-dances note matches the family in any dance; this-dance only its dance; variants inherit figureType. |
| US-012 🦴 | Zod schemas (lenient read / strict write) | M1 | system/developer | US-003,US-004 | Registry-derived; unknown values pass on read, rejected on write; timing range per meter. |
| US-013 | Migration ladder (schemaVersion) | M1 | system/developer | US-005 | schemaVersion envelope; ordered migrations upgrade older docs; unknown values survive. |
| US-014 🦴 | Per-document SQLite-backed DO hosts an Automerge doc | M2 | system/developer | US-005 | DO holds the doc, persists incremental changes to SQLite, rehydrates after eviction. |
| US-015 🦴 | Live WebSocket sync (two clients converge) | M2 | system/developer | US-014,US-009 | Two clients sync changes over Hibernatable WS through the DO and converge; hibernation/wake keeps state. |
| US-016 | DO alarm: compaction + D1 index projection + invite expiry | M2 | system/developer | US-014 | Alarm compacts history, projects a thin registry row to D1, expires invites — off request path. |
| US-017 🦴 | `store/` seam (multi-doc) | M2 | system/developer | US-015,US-006 | store loads routine + referenced figure docs, resolves overlays, exposes reactive reads/mutations/undo. |
| US-018 | Open & view a routine | M2 | user-facing | US-017 | Assemble shows sections → placement cards from the synced routine + referenced figures. |
| US-019 | Clerk sign-in + onboarding | M3 | user-facing | — | Hosted sign-in (Google + passkeys); onboarding captures displayName + identity color. |
| US-020 | Per-document membership & roles | M3 | system/developer | US-019 | Membership rows {viewer\|commenter\|editor} per doc; owner = editor + delete. |
| US-021 🦴 | Permission boundary at the DO connection | M3 | system/developer | US-015,US-020 | DO verifies Clerk JWT + role; editor edits, commenter annotates, viewer read-only, non-member/forged rejected. |
| US-022 | Quota: 3 owned routines + upsell | M3 | user-facing | US-019,US-020 | 4th owned-routine create blocked with upsell; shared-in routines don't count; quota seam present. |
| US-023 | Invite by link (issue + redeem) | M3 | user-facing | US-020 | Editor issues signed expiring token; redeem creates Membership w/ chosen role; expired/redeemed rejected. |
| US-024 | Share screen (member list + roles) | M3 | user-facing | US-020,US-023 | View members + roles; invite by link; editor/owner removes member; role microcopy. |
| US-025 | Create a routine | M3 | user-facing | US-019,US-022 | New Choreo (quota-checked) creates a routine doc + registry row owned by the user. |
| US-026 | Add / rename / reorder / delete sections | M3 | user-facing | US-018,US-021 | Editor adds user-named sections (+ quick-fills), renames, reorders, soft-deletes with confirm. |
| US-027 | Add / reorder / delete figure placements | M3 | user-facing | US-026 | Editor adds a figure placement (figureRef), reorders within a section, soft-deletes with confirm. |
| US-028 🦴 | Figure timeline: place/edit/remove attributes | M2 | user-facing | US-018,US-003,US-021 | Tap a count to add/edit/remove attributes (registry-driven); re-tap clears; role switch inline. |
| US-029 | Attribute editor (registry-derived sections) | M2 | user-facing | US-028 | Sections render from merged registry; Tango hides rise; single vs multi; CBP→CBMP normalized. |
| US-030 | Timeline role-view toggle | M2 | user-facing | US-028 | Tap a step flips viewed role; per-device pref; both-role attributes always shown. |
| US-031 | Edit per-figure alignment | M4 | user-facing | US-028 | Set entry/exit + per-placement alignment (qualifier + direction) chips. |
| US-032 | Application-global figure library browse | M4 | user-facing | US-018 | Browse global canonical figures grouped by figureType, filterable by dance. |
| US-033 | Account variants + custom figures in library | M4 | user-facing | US-032 | See your variants (base-lineage badge) + custom figures; "used in N routines". |
| US-034 | Editing your own figure flows into all referencing routines | M4 | user-facing | US-032,US-008 | Edit an owned figure → change appears in every routine referencing it (figure auto-update). |
| US-035 | Auto-variant on editing a non-owned figure | M4 | user-facing | US-033,US-008 | Editing a global/other's figure silently creates an owned variant, re-points placement, "copied as your variant" toast; original untouched. |
| US-036 | Fork a figure into a variant explicitly | M4 | user-facing | US-033,US-006 | "Fork into variant" creates a variant (overlay); base edits to non-overridden steps flow up. |
| US-037 | Choreo fork ("make it your own") | M4 | user-facing | US-025,US-007 | Fork a routine → owned, frozen clone; origin edits do NOT appear; lineage shown as provenance. |
| US-038 | Per-user undo / redo UX | M5 | user-facing | US-017,US-010 | Undo reverts only your last change in the open doc; "Undone" toast; soft superseded hint; redo. |
| US-039 | Unified annotations: point + figure anchors | M6 | user-facing | US-018,US-021 | Commenter+ creates note/lesson/practice anchored to a point or a figure; reply thread; author-only reply delete. |
| US-040 | `figureType` annotations (this-dance / all-dances) | M6 | user-facing | US-039,US-011 | Anchor a family note scoped this-dance or all-dances; owned in account doc; surfaces on every matching figure across your routines. |
| US-041 | Co-member visibility of family notes (option 2) | M6 | system/developer | US-040,US-020 | FigureTypeNoteIndex + co-membership gate surfaces co-members' family notes on a shared routine's matching figure; non-member sees none. |
| US-042 | Annotation filters (all / lessons / practice / by figure) | M6 | user-facing | US-039 | Timeline + journal share one annotation set; filter by kind and by figure. |
| US-043 | Custom attribute-kind creation UI | M7 | user-facing | US-003,US-029 | Create/edit a user-defined kind; it merges into the registry and appears in the editor, lanes, info sheet. |
| US-044 | Lanes (one kind across all counts) | M7 | user-facing | US-028 | View/edit a single kind laid out across every count of the figure. |
| US-045 | Sample routine + start-from-template | M7 | user-facing | US-018 | Read-only sample routine; start-from-template clones a template into an owned routine. |
| US-046 | Routine + figure search | M7 | user-facing | US-025,US-032 | Search routines/figures by title/name/dance over the D1 index; EXPLAIN shows no SCAN. |
| US-047 | JSON export (routine + referenced figures) | M8 | user-facing | US-025,US-032 | Export a self-contained schemaVersion'd JSON bundle of a routine + its referenced figure docs. |
| US-048 | JSON import (routine + referenced figures) | M8 | user-facing | US-047,US-013 | Import the bundle → routine + figures recreated as owned docs; unknown values survive round-trip; migration applied. |
| US-049 | Ops: Sentry + Analytics Engine + EXPLAIN gate + Smart Placement | M8 | system/developer | US-014 | Errors to Sentry, product metrics to Analytics Engine; CI EXPLAIN gate; Smart Placement; staging + prod. |
| US-050 | PWA install + offline app shell | M9 | user-facing | US-018 | Installable PWA; shell loads offline with a clear "you're offline" for data; <~2s interactive. |
| US-051 | Accessibility WCAG AA | M9 | user-facing | all UI | Color never the sole signal; ≥44px targets; keyboard + SR navigable; reduced-motion; axe clean. |
| US-052 | Cross-browser E2E (iOS Safari + Android Chrome) | M9 | system/developer | US-050 | Core journeys + convergence + fork pass on chromium-desktop, mobile-chrome, mobile-safari. |
| US-053 | Account / profile + plan status | M3 | user-facing | US-019,US-022 | Edit displayName + identity color; show plan + owned-routine count; sign out. |
| US-054 | Full Standard syllabus library seed (ISTD) | Content | system/developer | US-005,US-032 | Global FigureDocs by figureType×dance; validated core at launch, full syllabus rolling; values are data, refinable. |

---

## Walking skeleton

The minimal subset that proves the architecture end-to-end and is each independently testable, in order:

1. **M1 domain core (in-memory, no network):** US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-008, US-009, US-010, US-012 — the document graph, overlay inheritance, fork/copy-on-write, convergence, and undo proven with unit + property tests (this is the §9 M1 "walking skeleton" deliverable).
2. **M2 thin sync spine:** US-014, US-015, US-017 — one DO per doc persisting incremental changes, two clients converging over WS, and the `store/` seam loading a routine + its figure docs.
3. **First user-facing slice:** US-018 (open & view a routine), US-028 (place an attribute on the timeline — the hero flow).
4. **First permission gate:** US-021 — the DO connection boundary (editor/commenter/viewer/non-member/forged).

That spine (US-001–010, 012, 014–015, 017, 018, 021, 028) is the smallest thing that demonstrates the full Automerge-document-graph stack working with a real authored edit syncing between two permissioned clients.

---

## Detailed stories

### Epic A — Domain core (M1, in-memory, TDD)

> All M1 stories are pure `packages/domain/`, in-memory Automerge, no network (§6.1, §9 M1). Type: system/developer. Source: §1.7, §2, §3, §5.2–5.4, §9 M1, §10.2.

#### US-001 — ULID id generation 🦴
- **Narrative:** As the system, I want client-generated ULIDs for every entity id, so that references are stable across documents without a server round-trip.
- **Milestone:** M1 · **Source:** §2.1, §9 1.1, D15 · **Depends-on:** — · **Type:** system/developer
- **Acceptance:**
  - Given a request for a new id, When generated, Then it is a valid 26-char ULID.
  - Ids generated in sequence sort lexicographically by creation time (monotonic).
  - Ids are generated client-side (no network), and two clients never collide in practice.

#### US-002 — Dance metadata registry 🦴
- **Narrative:** As the system, I want a `DANCES` registry, so that timing, phrasing, and applicability rules derive from one source.
- **Milestone:** M1 · **Source:** §3, §9 1.2 · **Depends-on:** — · **Type:** system/developer
- **Acceptance:**
  - The 5 Standard travelling dances exist: `waltz`, `viennese_waltz`, `quickstep`, `foxtrot`, `tango`, each `travelling:true`.
  - `beatsPerBar` = 3 for Waltz/Viennese, 4 for the rest; `phraseBeats` = 6 for Waltz/Viennese, 8 for the rest; `timeSignature` present.
  - No Latin/spot dances are present (v1 scope).

#### US-003 — ATTRIBUTE_REGISTRY + merge 🦴
- **Narrative:** As the system, I want a two-tier attribute registry (standard + user-defined) merged everywhere, so that the editor, lanes, chips, and Zod all read one vocabulary.
- **Milestone:** M1 · **Source:** §3, §9 1.3, D17/D22 · **Depends-on:** US-002 · **Type:** system/developer
- **Acceptance:**
  - Standard kinds present: `step` (incl. footwork `HT/T/TH/heel_pull/H` + free action), `rise` (incl. `NFR`), `position` (single), `bodyActions` (multi: `CBM/CBMP`), `sway`, `turn` (incl. `eighth_L`…`half_R`).
  - `rise` is omitted for Tango via `appliesToDances`.
  - `position` has single cardinality; `bodyActions` multi.
  - Alias normalization: `CBP` → `CBMP` on read.
  - A user-defined kind merges into the registry and is indistinguishable in downstream reads (color, cardinality, valueType honored).
  - Unknown value written to a known kind is rejected; unknown value read passes through.

#### US-004 — Float-count timing 🦴
- **Narrative:** As the system, I want float-count timing helpers, so that counts render in conventional ballroom notation modulo the dance phrase.
- **Milestone:** M1 · **Source:** §2.5, §9 1.4, Q-D3 · **Depends-on:** US-002 · **Type:** system/developer
- **Acceptance:**
  - `countLabel`: `3.25`→"3e", `3.5`→"3&", `3.75`→"3a", `3.125`→"3ia", `3.375`→"3ai".
  - `countToBar` interprets counts modulo the dance's phrase (Waltz/Viennese 1–6; rest 1–8).
  - `barsForFigure` computes per role.
  - Fractions follow `e`=.25, `&`=.5, `a`=.75 (not the earlier swapped draft).

#### US-005 — Routine + figure document schemas 🦴
- **Narrative:** As the system, I want typed routine and figure Automerge document schemas + helpers, so that the document graph is built and read consistently.
- **Milestone:** M1 · **Source:** §2.2–2.6, §9 1.5 · **Depends-on:** US-001, US-003 · **Type:** system/developer
- **Acceptance:**
  - Routine doc holds sections → ordered placements (each with `figureRef`, optional `perPlacementAlignment`) + routine annotations.
  - Figure doc holds `scope`, `ownerId`, `figureType`, `dance`, `name`, `source`, alignment, attributes `{id,kind,count,role?,value}`, optional variant fields (`baseFigureRef`, overlay), `schemaVersion`.
  - Soft-delete is a mergeable `deletedAt` flip; no hard removal anywhere.
  - Typed read/write helpers exist for every shape; reads of a deleted entity reflect the tombstone.

#### US-006 — Overlay resolution `resolve(base, overlay)` 🦴
- **Narrative:** As the system, I want `resolve(base, overlay)`, so that a figure variant inherits the live base and stores only its divergences.
- **Milestone:** M1 · **Source:** §2.2, §5.2, §9 1.6 · **Depends-on:** US-005 · **Type:** system/developer
- **Acceptance:**
  - Effective attributes = base attributes − tombstones, with overrides applied, plus additions.
  - `rename` applies to the variant's name.
  - Base additions to non-overridden attributes flow up into the variant automatically.
  - Overrides win over base; the function is pure and deterministic (same inputs → same output, no mutation of base).

#### US-007 — Choreo fork (clone) 🦴
- **Narrative:** As the system, I want `cloneRoutine`, so that "make it your own" produces an independent frozen copy with provenance.
- **Milestone:** M1 · **Source:** §2.4, §5.2, §9 1.7, D12 · **Depends-on:** US-005 · **Type:** system/developer
- **Acceptance:**
  - `cloneRoutine(doc)` yields a new doc id, retaining shared history, with `forkedFromRef` set.
  - The clone is frozen: a later change to the origin routine does NOT appear in the clone.
  - `forkedFromRef` is provenance-only (no pull mechanism exists).
  - Referenced figure docs remain shared (the clone still points at the same figure docs until diverged).

#### US-008 — Copy-on-write (auto-variant) 🦴
- **Narrative:** As the system, I want `copyOnWrite(placement, sharedFigure, byUser)`, so that editing any non-owned figure diverges only that figure into an owned variant.
- **Milestone:** M1 · **Source:** §2.4, §5.2, §9 1.7, D12 · **Depends-on:** US-005, US-006 · **Type:** system/developer
- **Acceptance:**
  - Produces a new figure doc with `baseFigureRef` = shared figure + empty overlay, `scope:account`, owned by `byUser`.
  - The placement is re-pointed to the new variant.
  - The shared base figure is untouched (no disturbance to others).
  - Editing a figure the user already owns does NOT trigger copy-on-write (edits in place).

#### US-009 — Automerge convergence invariants 🦴
- **Narrative:** As the system, I want property-based convergence tests, so that concurrent/partitioned edits always merge correctly.
- **Milestone:** M1 · **Source:** §5.3, §9 1.8, §10.2 · **Depends-on:** US-005, US-007 · **Type:** system/developer
- **Acceptance:**
  - Random edit sequences applied in different orders converge after exchanging changes (commutative).
  - Two replicas edited "offline" then merged converge with no lost edits.
  - Applying a duplicate change is idempotent.
  - Convergence holds across forks (shuffled/partitioned changes incl. cloned docs).

#### US-010 — History-based per-user undo 🦴
- **Narrative:** As the system, I want history-based per-user undo, so that a user reverts their own last change without an op-log.
- **Milestone:** M1 · **Source:** §5.4, §9 1.9, D14, Q-UNDO · **Depends-on:** US-005 · **Type:** system/developer
- **Acceptance:**
  - Computing the inverse of user A's last change and applying it reverts only A's change.
  - B's concurrent edit survives A's undo.
  - Redo re-applies the undone change; a new edit clears the redo stack.
  - Scope is the doc being edited (no cross-document undo of a copy-on-write).

#### US-011 — `figureType` annotation resolution
- **Narrative:** As the system, I want `figureType` annotation matching, so that family notes resolve to the right figures across dances.
- **Milestone:** M1 · **Source:** §2.6, §5.1, §10.2, D29 · **Depends-on:** US-005 · **Type:** system/developer
- **Acceptance:**
  - An `all`-dances note matches a figure of that family in any dance.
  - A `this-dance` note matches only figures of that family in its dance.
  - A variant inherits its base's `figureType` + `dance`, so family notes match it too.
  - Resolution is pure/deterministic and identity-based (not a predicate query).

#### US-012 — Zod schemas (lenient read / strict write) 🦴
- **Narrative:** As the system, I want registry-derived Zod schemas, so that writes are validated strictly while reads tolerate forward-compatible data.
- **Milestone:** M1 · **Source:** §3, §9 1.10, D7, §10.2 · **Depends-on:** US-003, US-004 · **Type:** system/developer
- **Acceptance:**
  - Schemas are derived from the merged registry.
  - Unknown attribute values pass on read; unknown value written to a known kind is rejected.
  - Timing values outside the meter's valid range are rejected on write.
  - `CBP→CBMP` and other aliases normalize on read.

#### US-013 — Migration ladder (schemaVersion)
- **Narrative:** As the system, I want a `schemaVersion` envelope + migration ladder, so that older documents upgrade and round-trips survive.
- **Milestone:** M1 · **Source:** §2.1, §7, §10.2 · **Depends-on:** US-005 · **Type:** system/developer
- **Acceptance:**
  - Every doc carries `schemaVersion`.
  - An ordered chain of migrations upgrades an older doc to the current version.
  - Unknown attribute values survive a migration (no data loss).
  - Migrating an already-current doc is a no-op.

---

### Epic B — DO sync, persistence & store seam (M2)

> Tested in `workerd` via `vitest-pool-workers` with `isolatedStorage:false` + unique DO ids per test (M0.5 finding, §10.3). Source: §6, §9 M2, §10.2.

#### US-014 — Per-document SQLite-backed DO hosts an Automerge doc 🦴
- **Narrative:** As the system, I want one SQLite-backed Durable Object per document, so that each doc is hosted, persisted, and the sync boundary.
- **Milestone:** M2 · **Source:** §6, D23, §9 M2 · **Depends-on:** US-005 · **Type:** system/developer
- **Acceptance:**
  - The DO holds the Automerge doc in memory and persists incremental changes to DO SQLite (not a full rewrite per edit).
  - After DO eviction + reconnect, the doc rehydrates intact.
  - Routine docs and figure docs each get their own DO (one per document).

#### US-015 — Live WebSocket sync (two clients converge) 🦴
- **Narrative:** As the system, I want live WebSocket change-sync over Hibernatable WebSockets, so that two clients of a document converge in real time.
- **Milestone:** M2 · **Source:** §6, D10, §9 M2 (the M0.5-deferred unknown) · **Depends-on:** US-014, US-009 · **Type:** system/developer
- **Acceptance:**
  - Two clients connected to the same DO exchange Automerge changes and converge.
  - Hibernation then wake does not drop document state or buffered changes.
  - A duplicate change delivered over the socket is idempotent.
  - Starts with core `@automerge/automerge` + a thin custom sync (automerge-repo only if delta efficiency demands).

#### US-016 — DO alarm: compaction + D1 index projection + invite expiry
- **Narrative:** As the system, I want a DO alarm, so that history compaction, index projection, and invite expiry happen off the request path.
- **Milestone:** M2 · **Source:** §6.2, D24, §9 M2 · **Depends-on:** US-014 · **Type:** system/developer
- **Acceptance:**
  - The alarm compacts persisted Automerge history.
  - The alarm projects a thin registry row (title/dance/owner/updatedAt/figureType/dance) to D1.
  - The alarm expires due invites.
  - None of these run on the synchronous request/sync path.

#### US-017 — `store/` seam (multi-doc) 🦴
- **Narrative:** As a frontend developer, I want a typed `store/` seam over automerge, so that components never touch automerge or RPC directly.
- **Milestone:** M2 · **Source:** §6.1, §6.2, D6 · **Depends-on:** US-015, US-006 · **Type:** system/developer
- **Acceptance:**
  - Opening a routine connects to the routine doc's DO, then to each referenced figure doc's DO.
  - Variant overlays resolve client-side via `resolve`.
  - The seam exposes typed reactive reads + mutations + history-based undo.
  - Components import only from `store/` (a lint/architecture check forbids direct automerge/RPC use in components).

#### US-018 — Open & view a routine
- **Narrative:** As a member, I want to open a routine and see its sections and figures, so that I can read the choreography.
- **Milestone:** M2 · **Source:** §4.3, §6.2 · **Depends-on:** US-017 · **Type:** user-facing
- **Acceptance:**
  - Given a routine I'm a member of, When I open it, Then Assemble shows sections in order with placement cards (figure name, badges, attribute summary, alignment chips).
  - Edits made by another connected client appear without reload (live).
  - While offline for data, a clear "you're offline" state shows (no silent stale edits).

---

### Epic C — Auth, membership, permissions & quota (M3)

> Source: §1.6, §4.0, §4.7, §5.1, §5.5, §9 M3, §10.2.

#### US-019 — Clerk sign-in + onboarding
- **Narrative:** As a new user, I want hosted sign-in and onboarding, so that I can start with an identity and color.
- **Milestone:** M3 · **Source:** §4.0, §4.8, D9, §9 M3 · **Depends-on:** — · **Type:** user-facing
- **Acceptance:**
  - Clerk hosted sign-in offers Google + passkeys.
  - Onboarding captures `displayName` + `identityColor`, persisted to the User row.
  - `GET /api/me` returns the verified Clerk `sub`; a missing/invalid JWT → 401 (networkless verify).

#### US-020 — Per-document membership & roles
- **Narrative:** As the system, I want per-document membership with roles, so that access is governed independently per doc.
- **Milestone:** M3 · **Source:** §2.7, §5.1, D11, §9 M3 · **Depends-on:** US-019 · **Type:** system/developer
- **Acceptance:**
  - Membership `{docRef, userId, role}` with role ∈ {viewer, commenter, editor}; owner = an editor who may also delete the doc.
  - A routine doc and a figure doc are shared independently (membership is per doc).
  - Capabilities: editor edits structure + annotations + invites/removes; commenter reads + annotates; viewer reads only.

#### US-021 — Permission boundary at the DO connection 🦴
- **Narrative:** As the system, I want the DO to enforce role at the sync connection, so that permission is never post-hoc CRDT-cell rejection.
- **Milestone:** M3 · **Source:** §5.1, §6, global constraints, §10.2 · **Depends-on:** US-015, US-020 · **Type:** system/developer
- **Acceptance:**
  - The DO authenticates the connection (Clerk JWT) and looks up the doc's role from D1.
  - Editor change accepted; commenter may write annotations only; viewer is read-only; non-member rejected.
  - A forged sync connection (valid JWT, no membership) is rejected — on a routine doc AND on a figure doc.
  - Editing a shared figure without rights triggers copy-on-write (US-035), not a hard block.

#### US-022 — Quota: 3 owned routines + upsell
- **Narrative:** As a free user, I want a clear quota, so that I understand the limit and the upgrade path.
- **Milestone:** M3 · **Source:** §1.6, §4.9, D21, §9 M3 · **Depends-on:** US-019, US-020 · **Type:** user-facing
- **Acceptance:**
  - Creating a 4th owned routine is blocked with an upsell toast/sheet.
  - Routines shared in to me do NOT count against the cap.
  - The quota seam is checked server-side on create (not only client-side).
  - EXPLAIN shows the owned-routine count query is indexed (no SCAN).

#### US-023 — Invite by link (issue + redeem)
- **Narrative:** As an editor, I want to invite by link with a chosen role, so that I can share a doc with the right access.
- **Milestone:** M3 · **Source:** §5.5, §4.7, §9 M3 · **Depends-on:** US-020 · **Type:** user-facing
- **Acceptance:**
  - An editor issues a signed token carrying the docRef + role + expiry.
  - Redeeming creates a Membership with that role.
  - An expired or already-redeemed token is rejected.
  - A non-editor cannot issue an invite.

#### US-024 — Share screen (member list + roles)
- **Narrative:** As an editor, I want a Share screen, so that I can manage members and explain sharing semantics.
- **Milestone:** M3 · **Source:** §4.7 · **Depends-on:** US-020, US-023 · **Type:** user-facing
- **Acceptance:**
  - Shows the member list with each role.
  - Editor/owner can remove a member; viewer/commenter cannot.
  - Invite-by-link is available from this screen.
  - Microcopy explains roles and that editing a shared figure affects every routine using it (else fork/variant).

#### US-025 — Create a routine
- **Narrative:** As a user, I want to create a routine for a dance, so that I can start building choreography.
- **Milestone:** M3 · **Source:** §1.4, §4.1, §9 M3 · **Depends-on:** US-019, US-022 · **Type:** user-facing
- **Acceptance:**
  - New Choreo is quota-checked (US-022) before creation.
  - Creation makes a routine doc (its DO) + a DocumentRegistry row owned by the user.
  - The created routine appears in the Choreo list with dance-color icon, title, `dance · barLabel · created`.

#### US-026 — Add / rename / reorder / delete sections
- **Narrative:** As an editor, I want to manage sections, so that I can organize the routine.
- **Milestone:** M3 · **Source:** §4.0, §4.3, D18 · **Depends-on:** US-018, US-021 · **Type:** user-facing
- **Acceptance:**
  - Editor adds a user-named section (with optional preset quick-fills), renames, reorders, and soft-deletes (confirm dialog).
  - A commenter/viewer cannot add/rename/reorder/delete sections.
  - Reorder and soft-delete merge correctly across two clients.

#### US-027 — Add / reorder / delete figure placements
- **Narrative:** As an editor, I want to manage placements within a section, so that I can sequence figures.
- **Milestone:** M3 · **Source:** §4.0, §4.3 · **Depends-on:** US-026 · **Type:** user-facing
- **Acceptance:**
  - Editor adds a placement (figureRef into a section), reorders within the section, and soft-deletes (confirm).
  - A non-editor cannot modify placements.
  - The placement card shows the figure name + variant/custom badge + attribute summary + alignment chips.

---

### Epic D — Hero authoring: timeline & attributes (M2 surface, refined later)

> The hero flow (§1.4 step 4, §4.4–4.5). Source: §2.5, §3, §4.4, §4.5, §10.2.

#### US-028 — Figure timeline: place/edit/remove attributes 🦴
- **Narrative:** As an editor, I want to place attributes on a figure's count timeline, so that I can notate the figure (the hero flow).
- **Milestone:** M2 · **Source:** §1.4, §4.4, §4.5 · **Depends-on:** US-018, US-003, US-021 · **Type:** user-facing
- **Acceptance:**
  - Tapping a count opens the editor; I can add/edit/remove an attribute of any registry kind for that count.
  - Re-tapping a selected value clears it.
  - I can switch the attribute's role inline (leader/follower/both).
  - Counts render with conventional labels (US-004); a commenter/viewer cannot edit.

#### US-029 — Attribute editor (registry-derived sections)
- **Narrative:** As an editor, I want the editor sections to derive from the merged registry, so that the right kinds/values show per dance.
- **Milestone:** M2 · **Source:** §4.5, §3 · **Depends-on:** US-028 · **Type:** user-facing
- **Acceptance:**
  - Sections render from the merged ATTRIBUTE_REGISTRY (standard + user-defined).
  - Tango hides the rise section.
  - Single-select (position) vs multi-select (bodyActions) honored.
  - `CBP` input normalizes to `CBMP`.

#### US-030 — Timeline role-view toggle
- **Narrative:** As a user, I want to flip the viewed role on the timeline, so that I can read either partner's steps.
- **Milestone:** M2 · **Source:** §1.5, §4.4, D19 · **Depends-on:** US-028 · **Type:** user-facing
- **Acceptance:**
  - Tapping a step flips the viewed role; the choice is a per-device preference (no stored `User.defaultRole`).
  - Attributes with `role=null` (both) always show regardless of the toggle.
  - Role-specific attributes show only for the selected role.

#### US-031 — Edit per-figure alignment
- **Narrative:** As an editor, I want to set per-figure alignment, so that the figure's facing/direction is recorded without a floor concept.
- **Milestone:** M4 · **Source:** §3, §4.3, §4.4 · **Depends-on:** US-028 · **Type:** user-facing
- **Acceptance:**
  - Set `entryAlignment`/`exitAlignment` and optional `perPlacementAlignment` (qualifier `facing/backing/pointing` + a direction).
  - Alignment chips render on the placement card and timeline.
  - No separate floor/long/short/corner concept exists (per-figure alignment suffices).

---

### Epic E — Fork & inheritance UX (M4, the v1 centerpiece)

> Source: §2.2, §2.4, §4.2, §5.2, §9 M4, §10.2, §10.E2E.

#### US-032 — Application-global figure library browse
- **Narrative:** As a user, I want to browse the global figure library, so that I can find canonical figures to use.
- **Milestone:** M4 · **Source:** §2.2, §4.2, D28 · **Depends-on:** US-018 · **Type:** user-facing
- **Acceptance:**
  - Global canonical figures are grouped by `figureType`, filterable by dance.
  - Global figures are app-owned and not directly editable by users.
  - Browsing reads the D1 registry + FigureType catalog (no CRDT scan for the list).

#### US-033 — Account variants + custom figures in library
- **Narrative:** As a user, I want to see my variants and custom figures, so that I can manage my personal library.
- **Milestone:** M4 · **Source:** §2.2, §4.2 · **Depends-on:** US-032 · **Type:** user-facing
- **Acceptance:**
  - My account variants show a badge with base lineage; custom figures show a custom badge.
  - Each figure shows "used in N routines".
  - Variants/custom figures are account-scoped (owned by me, not the app).

#### US-034 — Editing your own figure flows into all referencing routines
- **Narrative:** As a user, I want edits to my own figure to flow everywhere it's used, so that I refine once.
- **Milestone:** M4 · **Source:** §2.2, §5.2, §9 M4, §10.E2E · **Depends-on:** US-032, US-008 · **Type:** user-facing
- **Acceptance:**
  - Given a figure I own referenced by two routines, When I edit it, Then the change appears in both routines (figure auto-update).
  - Editing in place does not create a variant.
  - The change syncs live to other connected members of those routines.

#### US-035 — Auto-variant on editing a non-owned figure
- **Narrative:** As a user editing a figure I don't own, I want an automatic variant, so that I can tweak freely without disturbing others.
- **Milestone:** M4 · **Source:** §2.4, §5.2, Q-COW-TRIGGER, §10.E2E · **Depends-on:** US-033, US-008 · **Type:** user-facing
- **Acceptance:**
  - Editing a global figure or someone else's shared figure silently creates an account-scoped variant I own and re-points the placement.
  - A "copied as your variant" toast shows.
  - The original/base figure is untouched (other routines/users unaffected).
  - No prompt is required (auto, not a dialog).

#### US-036 — Fork a figure into a variant explicitly
- **Narrative:** As a user, I want to fork a figure into a variant on purpose, so that I store overrides while inheriting the base.
- **Milestone:** M4 · **Source:** §2.2, §4.4, §5.2 · **Depends-on:** US-033, US-006 · **Type:** user-facing
- **Acceptance:**
  - "Fork into variant" creates a variant with `baseFigureRef` + overlay.
  - Base edits to non-overridden steps flow up into my variant (live).
  - My overrides/tombstones/additions/rename win over the base where set.

#### US-037 — Choreo fork ("make it your own")
- **Narrative:** As a user, I want to fork a whole routine, so that I get an independent copy to make my own.
- **Milestone:** M4 · **Source:** §2.4, §4.1, §4.7, §5.2, Q-FORK-UX, §10.E2E · **Depends-on:** US-025, US-007 · **Type:** user-facing
- **Acceptance:**
  - Forking creates an owned, frozen clone (a new routine doc) counted against my quota.
  - A later edit to the origin routine does NOT appear in my fork (frozen).
  - Lineage is shown as provenance only (`forkedFromRef`).
  - Referenced figures remain shared (figure-level improvements still flow in until I diverge one).

---

### Epic F — Undo/redo UX (M5)

#### US-038 — Per-user undo / redo UX
- **Narrative:** As an editor, I want to undo my own last change, so that I can recover from mistakes without affecting others.
- **Milestone:** M5 · **Source:** §5.4, §4.9, D14, Q-UNDO, §9 M5 · **Depends-on:** US-017, US-010 · **Type:** user-facing
- **Acceptance:**
  - Undo reverts only my last change in the open doc; an "Undone" toast shows.
  - Another client's concurrent edit survives my undo (two-client test).
  - If others built on my change, a soft "superseded" hint shows (no hard refusal).
  - Redo re-applies; a new edit clears redo. No cross-document undo of a copy-on-write.

---

### Epic G — Annotations incl. cross-dance (M6)

> Source: §2.6, §4.6, §5.1, §9 M6, §10.2, §10.E2E.

#### US-039 — Unified annotations: point + figure anchors
- **Narrative:** As a commenter or editor, I want to annotate a point or a figure, so that corrections/lessons/practice notes are anchored in context.
- **Milestone:** M6 · **Source:** §2.6, §4.6, D20 · **Depends-on:** US-018, US-021 · **Type:** user-facing
- **Acceptance:**
  - Create a `note`/`lesson`/`practice` annotation anchored to a `point {figureRef,count,role?}` or a `figure {figureRef}`.
  - Replies form an ordered thread; reply delete is author-only.
  - Routine annotations are visible to all members of that routine.
  - A viewer cannot create annotations; a commenter+ can.

#### US-040 — `figureType` annotations (this-dance / all-dances)
- **Narrative:** As a user, I want to annotate a whole figure family, so that one note covers a figure this dance or across all dances it exists in.
- **Milestone:** M6 · **Source:** §2.6, §4.6, D29 · **Depends-on:** US-039, US-011 · **Type:** user-facing
- **Acceptance:**
  - The anchor picker offers "this step", "this figure here", or "this figure family" with a dance-scope toggle (this dance | all dances).
  - A `figureType` note is owned in my account doc (account-scoped).
  - An all-dances note surfaces on a figure of that family in any of my routines (e.g. Waltz Feather AND Foxtrot Feather); a this-dance note only in that dance.
  - Variants inherit the family, so family notes surface on my variants too.

#### US-041 — Co-member visibility of family notes (option 2)
- **Narrative:** As a co-member of a shared routine, I want to see co-members' family notes for figures in it, so that a coach's "keep the head left on every Feather" reaches me.
- **Milestone:** M6 · **Source:** §2.6, §2.7, §5.1, Q-FIGNOTE-VIS option 2, §10.E2E · **Depends-on:** US-040, US-020 · **Type:** system/developer
- **Acceptance:**
  - Rendering routine R for member U queries the FigureTypeNoteIndex for notes by `members(R)` whose family/danceScope match a figure in R, and loads them.
  - Co-membership of R authorizes the scoped cross-account read of just those notes' content.
  - A non-member of R sees NONE of those family notes (gate holds).
  - A viewer never browses another user's account doc wholesale.

#### US-042 — Annotation filters (all / lessons / practice / by figure)
- **Narrative:** As a user, I want to filter annotations, so that I can focus on lessons or a specific figure.
- **Milestone:** M6 · **Source:** §4.6 · **Depends-on:** US-039 · **Type:** user-facing
- **Acceptance:**
  - The timeline and journal share one annotation set (one concept).
  - Filters: all / lessons / practice / by figure.
  - Filtering is client-side over loaded annotations (no content search in v1).

---

### Epic H — Custom kinds, Lanes, sample/template, search (M7)

#### US-043 — Custom attribute-kind creation UI
- **Narrative:** As a user, I want to create a custom attribute kind, so that I can notate things the standard kinds don't cover.
- **Milestone:** M7 · **Source:** §4.0, §4.5, D22, §9 M7 · **Depends-on:** US-003, US-029 · **Type:** user-facing
- **Acceptance:**
  - I can create/edit a user-defined kind (label, color, cardinality, valueType, values).
  - The new kind merges into the registry and appears in the attribute editor, lanes, info sheet, and chips.
  - The kind is stored in the relevant document and survives reload.

#### US-044 — Lanes (one kind across all counts)
- **Narrative:** As a user, I want a lane view of a single kind across counts, so that I can scan one dimension of the figure.
- **Milestone:** M7 · **Source:** §4.4, §9 M7 · **Depends-on:** US-028 · **Type:** user-facing
- **Acceptance:**
  - A lane shows one kind laid out across every count of the figure.
  - Editing in a lane updates the same attributes the timeline edits.
  - Lanes honor the role-view toggle.

#### US-045 — Sample routine + start-from-template
- **Narrative:** As a new user, I want a sample routine and templates, so that I can explore and start quickly.
- **Milestone:** M7 · **Source:** §4.0, §4.1, §9 M7 · **Depends-on:** US-018 · **Type:** user-facing
- **Acceptance:**
  - A read-only sample routine is available (and shows in the empty Choreo state).
  - Start-from-template clones a `templateOf` routine into an owned routine (quota-checked).
  - The sample cannot be edited (read-only).

#### US-046 — Routine + figure search
- **Narrative:** As a user, I want to search my routines and figures, so that I can find them by title/name/dance.
- **Milestone:** M7 · **Source:** §4.0, §4.1, §9 M7 · **Depends-on:** US-025, US-032 · **Type:** user-facing
- **Acceptance:**
  - Search routines + figures by title/name/dance over the D1 index.
  - `EXPLAIN QUERY PLAN` shows the search query is indexed (no SCAN).
  - Annotation/content search is NOT included (v1.1).

---

### Epic I — Export/import + ops (M8)

#### US-047 — JSON export (routine + referenced figures)
- **Narrative:** As a user, I want to export a routine with its referenced figures, so that I own a self-contained copy.
- **Milestone:** M8 · **Source:** §4.0, §7, §9 M8 · **Depends-on:** US-025, US-032 · **Type:** user-facing
- **Acceptance:**
  - Export produces a `schemaVersion`'d JSON bundle of the routine doc + every referenced figure doc.
  - The bundle is self-contained (a fork/export round-trips without external refs).
  - Unknown attribute values are preserved in the export.

#### US-048 — JSON import (routine + referenced figures)
- **Narrative:** As a user, I want to import a bundle, so that I can recreate a routine and its figures.
- **Milestone:** M8 · **Source:** §4.0, §7, §9 M8 · **Depends-on:** US-047, US-013 · **Type:** user-facing
- **Acceptance:**
  - Import recreates the routine + referenced figures as docs I own.
  - Unknown attribute values survive the round-trip.
  - An older-`schemaVersion` bundle is migrated on import (US-013).
  - Import respects the quota (importing a routine counts as an owned routine).

#### US-049 — Ops: Sentry + Analytics Engine + EXPLAIN gate + Smart Placement
- **Narrative:** As an operator, I want errors, metrics, query-plan gating, and edge placement, so that the app is observable and performant.
- **Milestone:** M8 · **Source:** §7, D25/D26, §9 M8 · **Depends-on:** US-014 · **Type:** system/developer
- **Acceptance:**
  - Errors report to Sentry (+ `@sentry/cloudflare`); product metrics to Analytics Engine.
  - CI fails if any index/registry/membership/quota query shows a SCAN (EXPLAIN gate).
  - Worker uses Smart Placement; staging + prod environments exist.

---

### Epic J — PWA, a11y, cross-browser (M9)

#### US-050 — PWA install + offline app shell
- **Narrative:** As a mobile user, I want to install the app and have the shell load offline, so that it feels like a native app.
- **Milestone:** M9 · **Source:** §1.3, §7, §9 M9 · **Depends-on:** US-018 · **Type:** user-facing
- **Acceptance:**
  - The PWA is installable on evergreen mobile + desktop.
  - The app shell loads offline; data shows a clear "you're offline" state (online-first; no offline editing in v1).
  - Shell interactive in <~2s.

#### US-051 — Accessibility WCAG AA
- **Narrative:** As a user with accessibility needs, I want WCAG AA compliance, so that the app is usable for everyone.
- **Milestone:** M9 · **Source:** §1.3, §7, §9 M9, §10.3 · **Depends-on:** all UI stories · **Type:** user-facing
- **Acceptance:**
  - Color is never the only signal (kinds/roles carry text/shape too).
  - Touch targets ≥44px; keyboard + screen-reader navigable; reduced-motion honored.
  - axe reports no violations on each screen (component-level `vitest-axe`).

#### US-052 — Cross-browser E2E (iOS Safari + Android Chrome)
- **Narrative:** As QA, I want the core journeys to pass on the target browsers, so that mobile users have a working app.
- **Milestone:** M9 · **Source:** §9 M9, §10.2, §10.3 · **Depends-on:** US-050 · **Type:** system/developer
- **Acceptance:**
  - Playwright matrix `chromium-desktop`, `mobile-chrome`, `mobile-safari` passes core journeys.
  - Includes two live contexts converging on a routine and a fork/copy-on-write flow.
  - Lighthouse-CI runs on the merge/nightly gate.

---

### Epic K — Account/profile (M3)

#### US-053 — Account / profile + plan status
- **Narrative:** As a user, I want a profile screen, so that I can edit identity and see my plan/quota.
- **Milestone:** M3 · **Source:** §4.0, §4.8 · **Depends-on:** US-019, US-022 · **Type:** user-facing
- **Acceptance:**
  - Edit `displayName` + identity color (global note color).
  - Show plan status + owned-routine count.
  - Sign out works (clears the Clerk session).

---

### Content workstream (parallel to engineering)

#### US-054 — Full Standard syllabus library seed (ISTD)
- **Narrative:** As the product, I want a seeded Standard syllabus library, so that users start with canonical figures across all 5 dances.
- **Milestone:** Content (parallel; depends on M1 schemas + M4 library surface) · **Source:** §9 Content workstream, D30, Q-LIBSEED · **Depends-on:** US-005, US-032 · **Type:** system/developer
- **Acceptance:**
  - Global FigureDocs are authored per `figureType` × dance (ISTD), tagged `figureType` + `dance`, app-owned.
  - A validated **core** (most-used figures per dance) ships at launch; the full syllabus expands on a rolling basis.
  - Seed values are data (ATTRIBUTE_REGISTRY + seed docs) — corrections during testing are config edits, not code changes.
  - Seed docs are versioned by `schemaVersion`; the FigureType catalog (families × dances) is bundled.
```

