# System architecture

*How the system works underneath the mental model in [`docs/concepts/`](../concepts/). This
doc covers storage, boundaries, permissions, projections, and the load-bearing technical
decisions with their rationale. Sync and offline mechanics have their own doc:
[`sync-and-offline.md`](sync-and-offline.md); testing has [`testing.md`](testing.md).*

## The shape: a graph of Automerge documents

Everything canonical is a **CRDT document** ([Automerge](https://automerge.org/)), one per
**Durable Object**, indexed by **D1**:

```
[ React 19 + Vite PWA ]   (installable shell)
   • Clerk client (session JWT)
   • store/ seam (core Automerge, multi-doc): snapshot-hydrated reads; live doc
     connections for edit; variant resolution against its base; history-based
     per-user undo; components bind ONLY via store/
        │  WebSocket sync per document (change frames + snapshot catch-up)   ▲ REST for list/search/invite/quota/snapshot
        ▼                                                                    │
[ Worker + Durable Objects ]   (Smart Placement; Analytics Engine)
   • Worker (Hono): Clerk verify; list/search/invite/quota over the D1 index → D1
   • Durable Object PER DOCUMENT (routine, figure — global & account, account docs), SQLite-backed:
       – hosts the Automerge doc; persists INCREMENTAL changes (snapshot + change log)
       – WebSocket sync (Hibernatable); connect catch-up = ONE snapshot frame
       – authenticates each connection (Clerk JWT) + checks that doc's membership/role
       – alarm: compaction + D1 index/journal/library projections + invite expiry
        │
        ▼
[ D1 (Drizzle) ]  index only: users, memberships, DocumentRegistry, invites, projections
        (R2 for media → future; Queues → future)
```

**Document types** (each in its own DO):

- **Routine docs** — sections → placements (each holding a `figureRef`) + routine-scoped
  annotations.
- **Figure docs** — `global` (admin-owned canonical catalog, one per family × dance) and
  `account` (variants carrying a **live** `baseFigureRef`, and from-scratch customs).
- **Account docs** — one per user (`account:<userId>`): family notes (`figureType`
  annotations), library bookmarks (`libraryFigureRefs`), the index of the user's figures.
  Owner-only boundary; lazily minted on first touch (`ensureAccountDoc`, seeded from any
  pre-existing D1 rows under the migration actor, gated on the registry row's absence).

**Why Automerge + a document graph** (over Yjs/Loro/a single per-routine doc): cross-routine
figure reuse, fork with lineage, and per-user history-based undo all need a many-document
model with Git-like clone/merge/history; Yjs's subdocument story didn't fit and its
Cloudflare server (y-partyserver) is single-doc-per-room. Cost: no Cloudflare-blessed
Automerge server exists — the thin DO sync layer below is ours (spike-validated;
[`docs/spike/SPIKE-FINDINGS.md`](../spike/SPIKE-FINDINGS.md)). We run **core
`@automerge/automerge` with a hand-rolled sync loop**, not `automerge-repo` — the spike
showed the repo layer isn't needed; adopt its sync protocol only if delta-efficiency ever
demands it.

## Global constraints (the always-true invariants)

- **Canonical state lives in the Automerge documents** (persisted in each doc's DO SQLite);
  **D1 is a pure index/registry** — no CRDT content, every row re-derivable from docs.
  No separate op-log.
- **All ids are client-generated ULIDs** (offline/concurrent creation needs collision-free
  client ids — server-assigned ids are a CRDT blocker).
- **Soft-delete only** (`deletedAt` tombstones) — CRDT merge semantics and undo depend on it.
- **Permissions are enforced per-document at the DO sync boundary** (and the REST surface) —
  **never** by post-hoc CRDT cell rejection (per-cell rejection is incoherent with CRDTs;
  `research/critique-sync.md`).
- **The client touches documents only through `apps/web/src/store/`** (the typed seam);
  components never see Automerge or the RPC client.
- **Quota check on routine create. Every D1 query indexed** (EXPLAIN no-SCAN in CI).
  **WCAG AA.**
- **TS strict, no `any`, no unproven casts** (machine-enforced — see CLAUDE.md § type
  honesty).

## Module boundaries (pnpm workspaces)

Dependency direction: `contract → domain`; `web → contract, domain`; `worker → contract,
domain`.

- **`packages/domain/`** — pure TS, in-memory Automerge, no I/O. Document schemas
  (`doc-routine.ts`, `doc-figure.ts`, `doc-account.ts`), variant/overlay resolution
  (`fork.ts`: `resolveFigure` per-beat ownership, copy-down, `spawnVariant`,
  `copyFigureForFork`), the ATTRIBUTE_REGISTRY (`vocabulary.ts`) + merge, float-count timing
  (`timing.ts`), grid/length resolution (`figure-grid.ts`), Both-lens write derivation
  (`role-write.ts`), fractional-index ordering (`order.ts`), history-based undo (`undo.ts`),
  Zod schemas, the migration ladder (`migrations.ts`), catalog data
  (`library-data.ts`/`figure-charts.generated.ts` — **generated**, edit the seed JSON and
  regenerate). Fully unit/property-testable.
- **`packages/contract/`** — Zod schemas + Hono RPC `typeof app` types shared by web and
  worker, plus shared doc-shape types and sync-wire constants.
- **`apps/worker/`** — Hono routes (list/search/invite/quota/figures/fork/journal/library/
  profile/me), Clerk middleware (`auth/`), and the per-document SQLite-backed Durable Object
  (`doc-do.ts`); Drizzle/D1 index; `fork.ts`, `ensure-account-doc.ts`,
  `seed-global-figures.ts`.
- **`apps/web/`** — presentational React + the `store/` seam (doc connections, snapshot
  hydration, typed reactive reads, mutations, undo) + `ui/` (design system) + service worker.

## Permission enforcement

Roles and their meaning are in [`docs/concepts/collaboration.md`](../concepts/collaboration.md);
enforcement is here:

- Each DO authenticates every connection (Clerk JWT) and resolves the caller's **effective
  role** for *that* document from D1: stored membership → registry owner (owners carry no
  membership row — set logic must remember this) → the global-figure rule (any user =
  viewer, admin = editor) → the routine→figure **placement-edge cascade**. Account docs
  resolve owner-or-nothing (admins get no special access).
- The boundary gates by **observed effect**, not client-declared labels (a mislabelled
  "annotation" frame carrying structural edits is rejected as a structural edit).
- Roles are **re-enforced after connect**, not only at the handshake: member removal or
  downgrade notifies the doc's DO and drops/downgrades open sockets.
- Annotation **modification** is admitted only for its author, checked against the socket
  identity — never a client-supplied author id.
- REST mutations are gated the same way (e.g. figure upserts require editor-of-a-placing-
  routine; routine delete checks registry ownership, not effective role).
- **Invites:** a server-issued, single-use, expiring random token whose parameters live in
  the D1 Invite row (unforgeable by construction); redemption is an atomic conditional
  update; redeem by an existing member returns `alreadyMember` instead of an error.

*(Each of these clauses exists because its absence was once a real bug — hence the standing
rule: any change touching this area is hard-gated in review. See the
`ballroom-flow-change-control` skill.)*

## Persistence & the DO lifecycle

- The DO keeps the doc in memory and persists **incremental Automerge changes** to its
  SQLite (never a full-doc rewrite per edit); the **alarm** compacts history, projects index
  rows (below), and expires invites — off the request path.
- The persistence layout carries a storage-format generation stamp (distinct from the doc
  content's `schemaVersion`) so a future storage-scheme change can migrate per-DO.
- **Migration ladder:** documents carry a `schemaVersion`; the ladder runs on the DO load
  path inside a change attributed to a **fixed migration actor** (never a user's — so
  per-user undo can never select a migration), and fresh docs are stamped current. Notable
  steps: legacy `bars` → authored `counts`; the figure-length repair (stored `counts` lifted
  to the step span); worker-side legacy-break → Break-figure migration on the alarm.

## D1 — the index & projections

Tables (Drizzle, `apps/worker/src/db/`): **User** (Clerk sub, displayName, identityColor,
plan, `isAdmin`, `routineCapOverride`), **UserNameCache** (claims-derived name/email so
co-members of a not-yet-onboarded user see something real), **Membership** (per docRef),
**DocumentRegistry** (docRef → type/owner/DO routing + card projection columns),
**Invite**, and the projections: **JournalEntry**, **FigureTypeNoteIndex**,
**AttributePredicateNoteIndex**, **LibraryEntry**, **PlacementEdge** (routine→figure edges:
the role cascade + "used in N choreos"), **account_custom_kind** (the one deliberate
D1-as-truth exception: user-defined kinds, declared a non-goal of the account-doc migration).

**Projections are alarm-written, non-destructive, idempotent, tombstone-aware** — the DO is
the single writer of its rows:

- routine DO → registry card columns (`bars`, `figureCount` — eventually consistent by
  design) + `journal_entry` (lesson/practice annotations, for the Journal's routine arm);
- account DO → `library_entry` (bookmarks) + `figure_type_note_index` (family notes; rows
  currently carry the note content — co-member visibility reads this index gated by
  co-membership, never another user's doc) + `attribute_predicate_note_index` (migration 0019
  — attribute-predicate notes, mirroring the family-note index exactly: content-carrying,
  keyed by `{ attrKind, attrValue, scope }`, same co-membership read gate. `routine`-scoped
  rows project for upsert-consistency but the cross-account read filters them out structurally
  — they are self-read only).

The **predicate-note read** (`GET /api/routines/:id/predicate-notes`) mirrors the family-note
read exactly: `resolveEffectiveRole` gates on co-membership (a non-member is refused **before**
any note is read), the author set is the routine's members ∪ owner (the owner has no membership
row), and the query is index-served (EXPLAIN no-SCAN in CI). The note *surfaces* only where a
step matches: the client runs the pure `matchPredicate` (`packages/domain/src/predicate.ts`)
over the resolved timelines it can already see — a read-time content match by meaning
(`normalizeValue` read-aliases), the first content-dependent read path (referential stability
per [`sync-and-offline.md`](sync-and-offline.md) § Flicker). `routine`-scoped predicate notes
resolve entirely client-side from the author's own account doc, merged live via the same seam
as family notes.

The **Journal read** (`GET /api/journal`) UNIONs the two arms; the routine arm is gated by
co-membership of the routine, the account arm by the accessible-authors set — symmetric.

Reads split by audience: **self** reads live from your own docs (instant, offline-capable);
**about-others** reads come from projections (eventually consistent). The Journal list is a
self-read surface too: a one-shot `/api/journal` fetch right after a save reliably loses the
WS-sync + alarm race, so the client merges **own** family notes from the live account doc
(`mergeLiveFamilyNotes`) and echoes just-saved routine entries over the REST list
(`createRoutineJournalEntry` returns the created entry; `mergePendingEntries`), deduped by id
once the projections catch up — the projections stay the only **cross-user** read path
(read-your-writes fix, 2026-07-15). The **library surfaces** follow the same rule — both
read `/api/figures/mine` (the `library_entry` projection), so a bookmark added moments ago
would otherwise be invisible until the alarm projects it: the **Add-figure picker** merges
live-bookmarked figures resolved from the open routine's placed figure docs
(`mergeLiveBookmarkedFigures` — placing the row references the same live figure doc, never
a copy), and the Library's **"My figures" tab** merges live catalog refs resolved from the
bundled catalog (`mergeLiveCatalogBookmarks`); both dedupe by docRef with the REST row
winning once the projection catches up.

## Ordering — fractional-index `sortKey`

Sections and placements carry a `sortKey`: a compact fractional-index string
(`packages/domain/src/order.ts`). Reads sort by it (tie-broken by id); a reorder writes the
moved item's key to a midpoint between its new neighbours — **a single field update, never a
remove-and-reinsert**. Why: an array-splice reorder deletes and re-inserts the Automerge
object, so a concurrent edit to the moved item was *lost* and concurrent splices clobbered
the order (a real, fixed bug). With `sortKey`, same-list concurrent reorders converge with no
lost edits; two moves of the same item resolve deterministically. Inserts-between use the
same midpoint construction.

## Undo — history-based, per user

Automerge has no turnkey per-user undo. Ours computes the **inverse of the user's own last
change** from history (filtered by actor id) and applies it as a new change, which merges
correctly with concurrent edits. Soundness rules (each pinned by tests, each once a bug):

- the inverse targets list elements **by identity (ids), never positional index** —
  replaying historical indices against the current doc deletes a *concurrent peer's* element;
- an already-undone change is never re-selected (repeat press = no-op);
- the figure editor's undo targets the figure's own doc (each figure connection seeds with
  the same per-tab actor so its edits are attributable);
- the "others built on this" hint is exact causal dependency in the change DAG (a transitive
  successor by another actor), peeked pre-undo — advisory only, undo always proceeds.

## AI voice notes — the read-only interpret/transcribe seam

Voice capture (`docs/concepts/annotations.md` § The Journal) rides two **read-only** worker
routes and one mockable AI seam; it adds **no new data shape and no new write path**.

- **`POST /api/voice-notes/interpret`** assembles the caller's in-scope choreography and
  resolves a transcript into a *proposed* anchor. Context assembly reuses the snapshot route's
  **per-figure authorization** verbatim — a routine's placements are caller-controlled CRDT
  content, so every referenced figure ref is gated individually by `resolveEffectiveRole`,
  and only annotate-capable (non-viewer) routines are in scope. A pure serializer in
  `packages/domain` (`serializeChoreoContext`, `resolveDanceAlias`) turns the assembled docs
  into grounding data (figures in placement order, one entry per placement so ordinals ground;
  variants resolved live against their base). **`POST /api/voice-notes/transcribe`** echoes a
  Whisper-fallback transcript; the audio is never stored.
- **Both routes are read-only** — they never write D1, never touch a DO's CRDT content, never
  mint registry rows. The only commit path is the existing client → store seam
  (`createAnnotation` / `createFamilyNote`) behind the user's explicit **Confirm**. The AI
  stays entirely outside the DO boundary, the permission model, and the CRDT.
- **The model output is never trusted.** Workers AI JSON mode gives no hard schema guarantee,
  so the worker **re-validates** every extraction with the contract Zod schema **and grounds**
  every ref against the assembled context (`groundProposal`); any mismatch degrades to
  `resolved: false` (a transcript-only note). The one hard safety property is structural:
  **zero wrong-anchor commits can occur past the confirm step.**
- **The AI seam is mockable** (`VoiceAi` in `apps/worker/src/voice-ai.ts`): a deterministic
  fixture backs dev, unit tests, and E2E, so the **zero-secret test matrix holds**. The real
  Workers AI binding (`AI`, routed via **AI Gateway** for logging/rate-limiting/cost/accept-
  rate telemetry) exists **only in the deployed wrangler envs** — `voiceAiFor` selects the
  fixture whenever the binding is absent or the E2E flag is set. Model choice is a data
  decision recorded in `docs/TOOLING.md`.
- **Invariant:** the AI is advisory pre-fill only. A voice-proposed `attributePredicate`
  anchor is a recorded future refinement — predicate utterances fall back to a plain note
  today (the predicate anchor itself ships; the voice pipeline does not propose it).

## The catalog seed pipeline (summary)

The Standard syllabus ships as data: ISTD is the system of record for identity (families ×
dances), WDSF for timing and per-step technique. `docs/seed/*.json` →
`scripts/gen-library.mjs` / `gen-figure-charts.mjs` → generated TS in `packages/domain`
(never hand-edit generated files). Global figure docs are seeded self-healingly on deployed
envs (hash-guarded `ensureGlobalFigures` on the API seam); **the seed is authoritative for
seeded content** — re-running reconciles existing docs to the bundle (deterministic seed ids
updated/added/tombstoned) while user-added attributes (client ULIDs) and variant-owned beats
survive. **No fabrication**: every value carries recorded provenance; unverifiable content is
omitted, never guessed. Full workflow: the `ballroom-flow-figure-data-pipeline` skill.

## Non-functional requirements

- **Performance:** mobile-first; shell interactive < ~2 s; list/search from the D1 index
  (indexed, EXPLAIN-gated in CI); opening a routine = one snapshot + a handful of DO syncs;
  Smart Placement co-locates the worker near D1. The store's reads are referentially stable
  (`store/reconcile.ts`): unchanged subtrees keep object identity so a doc change re-renders
  only what changed — new read paths must preserve this (components must never observe a
  background rematerialization).
- **Cost:** Workers Paid (~$5/mo). Many small DOs; Hibernatable WebSockets keep idle ones
  free; D1 stays small. Automerge's WASM dominates the worker bundle (~920 KiB gzip — well
  under limits).
- **Ops:** Sentry on both halves via **dependency-free envelope reporters** (one fetch, no
  SDK): worker route errors + config-class auth failures; web uncaught errors + unexpected
  API failures. `GET /api/health` reports config-presence booleans (`clerkConfigured`,
  `sentryConfigured`) so a mis-provisioned env is one curl away from diagnosis. Analytics
  Engine for product metrics. Per-env provisioning invariant: the SPA's Clerk publishable key
  and the worker's Clerk secrets must reference the SAME instance
  ([`PROVISIONING.md`](../../PROVISIONING.md)).
- **i18n:** bilingual EN/DE with **no i18n framework** — a small typed locale seam
  (`apps/web/src/i18n/`), per-screen typed catalogs (`de: typeof en`, so a missing German key
  is a compile error). English is the source language; the domain registry stays English with
  a web-side German overlay; user content and catalog names are never translated. Tests pin
  the English default.
- **Deploy:** worker + SPA ship as one atomic deploy; `main` is production (see CLAUDE.md
  § git flow). Rollout-skew handling (stale tabs) is in
  [`sync-and-offline.md`](sync-and-offline.md) § Version skew.

## Data flow (opening a routine)

1. Clerk JWT.
2. One REST **snapshot** hydrates the screen — routine + placed figures + **variant bases**,
   resolved per-beat client-side. Editors open the routine's live WS; a figure's own WS opens
   only when its editor opens. Viewers use zero sockets
   ([`sync-and-offline.md`](sync-and-offline.md) § The read/edit split).
3. Each DO verifies JWT + role, then syncs changes and persists them.
4. List/search/invite/quota/journal are REST over D1.
5. Alarms compact, project, and expire — off the request path.
