# Scope / YAGNI / Sequencing Critique — Weave Steps

**Reviewer stance:** adversarial, focused on scope right-sizing, YAGNI, build-vs-buy, and sequencing for a 2–3 person hobby project where *quality and maintainability beat feature count*. The spec is well-written and unusually disciplined about deferring features — but it is disciplined about the wrong axis. It cuts *product features* hard while leaving the *infrastructure* maximalist. The result is a spec that reads lean but builds heavy.

---

## The core thesis

The spec's stated guiding principle is "quality and maintainability over feature count, apply YAGNI." It applies YAGNI ruthlessly to **features** (lanes view, alignment column, two charts, cross-routine links — all correctly cut) and **not at all to infrastructure** (CRDT + per-routine Durable Objects + two-zone write-authority + hibernatable WebSockets + D1 projection + R2 + Clerk + fractional-index merge). For a solo/2-person hobbyist, the infrastructure *is* the maintenance liability. The hard part of this project is not the dance domain — it's the distributed-systems machinery the spec signs up for in §5–§7. **The YAGNI lens is pointed at the cheap things and away from the expensive ones.**

A telling internal contradiction the spec itself surfaces but doesn't follow to its conclusion (§5.3, "THE CENTRAL TENSION"): the product rule is **"structure is not co-edited — to change steps you fork."** That means **structure has exactly one writer (the owner).** A CRDT exists to merge concurrent writes from multiple writers. The spec's own resolution admits the CRDT's merge power for structure is "a low-stakes convenience (multi-device for the owner), not the core need." So the single most complex component in the stack is justified, by the author's own words, by: (a) one person editing on two of their own devices, and (b) append-only comments. Both have far cheaper solutions. **This is the YAGNI smell that the rest of the critique unpacks.**

---

## 1. Ranked scope / complexity risks

### [BLOCKER] B1 — CRDT + per-routine Durable Object is gold-plating for a single-writer structure
The collaboration model (§5) is *deliberately* single-writer for structure. Comments and journal are append-mostly. The technique tags are also owner-only (§5.3, Q-C1). So **every genuinely "structural" mutation in the system has one authorized writer.** The only true multi-writer surface is *appending comments/journal entries* — and appends to disjoint rows are the trivial case that needs no CRDT at all (any "insert row, server assigns id" scheme converges). The spec is buying TinyBase MergeableStore, fractional-index sort-key merge semantics, a per-routine DO synchronizer, hibernatable WebSocket plumbing, and a two-zone authorization gate — to solve a merge problem that, by construction, barely exists. This is the central over-build and it cascades into the testing plan (§9's "critical" two-client merge tests exist only because the CRDT exists).

### [BLOCKER] B2 — "Offline-first as a hard boot-from-zero-network requirement" drives most of the architectural risk for unquantified benefit
Offline-first is listed as a *non-negotiable constraint* (§1.3.5) and it is the tail wagging the whole architecture dog: it forces a durable local CRDT store, IndexedDB persistence, a sync reconciler, optimistic local writes, connection/sync-state UX, and "defense-in-depth" re-validation of offline edits on reconnect (§6). But the spec never quantifies *when a dancer actually writes offline*. Realistically: a couple **builds and tags** a routine at home (online) and **reads/practices** it in a studio (maybe spotty signal). The high-value offline need is **offline read** of an already-synced routine — which is satisfied by a plain service-worker cache + a read-only local copy, *no CRDT, no write-reconcile*. Full offline *structural authoring in a dead-signal ballroom* is a thin slice of real usage carrying the bulk of the architectural cost. The constraint is stated as binary ("the app boots and is fully usable with no network; edits sync later") without anyone establishing that full offline *write* is needed for v1.

### [MAJOR] B3 — Three storage systems (DO-SQLite + D1 + R2) plus a derived-projection sync invariant
The spec splits live data into per-routine DO-SQLite, with a *denormalized D1 index* that the Worker must keep in sync on "create/rename/fork/membership change" (§2.3, §6, §7.2). That's a hand-maintained derived projection across two databases — a classic source of drift bugs (rename a routine offline, the DO has the new title, the D1 index lags or misses the update). For a list screen of ~dozens of routines for ~3 users, this dual-store optimization ("so the list renders without spinning up every DO") is premature. R2 is only needed for media, which is *already deferred to v1.1* (§4.0, §6) — so **R2 is in the v1 architecture diagram for a v1.1 feature.**

### [MAJOR] B4 — The two-zone write-authority Durable Object is bespoke distributed-systems code a solo maintainer owns forever
§5.3/§7.1 describe a DO that runs the TinyBase synchronizer *and* enforces per-zone write authorization (reject structural ops from non-owners, accept comment ops) *and* validates membership-on-connect against D1. This is custom authorization logic living *inside the CRDT sync path* — the hardest possible place to get auth right, because it must reason about offline-queued ops replaying on reconnect. A bug here is a security bug (a partner mutating structure they shouldn't) discoverable only via the elaborate Playwright two-client/forged-op tests in §9.4. A single-writer server model makes this auth a trivial route guard.

### [MAJOR] B5 — Fork/deep-copy as "the editing mechanism" multiplies routine/DO count and is itself unvalidated as a product decision
"Duplicate to edit" (§5.4) means every time a partner wants to change a step, a whole new routine + new DO is provisioned, deep-copying structure+tags, dropping comments. For a couple co-owning *one* routine this is a strange core interaction (the spec even flags Q-C4: "if a couple both want to edit structure live, the single-writer model breaks"). It's quite likely the couple **does** want to co-edit — they're building *one* routine together. The fork model may be solving a problem (preventing clobber between near-strangers) that this user base doesn't have, while making the common case (two partners, one routine) awkward. And fork provisions DOs unboundedly.

### [MINOR] B6 — Clerk is a reasonable choice but adds a third-party runtime dependency + onboarding surface for ~3 users
Clerk is well-justified on free-tier grounds, but for 3 known users a magic-link or even a shared-secret invite could defer the whole auth surface. Not a blocker (auth is genuinely needed and Clerk is low-effort), but worth noting the onboarding flow (§4.0) is net-new work the wireframe never had.

### [MINOR] B7 — 34 open questions, several of which block the data model, against a fully-specified architecture
§11 has 4 starred model-blocking questions (one-chart-vs-two, CBP/CBM, tags-as-structure, duplicate-to-edit-reconciles-with-CRDT) that a dancer must answer *before* the schema is right — yet the architecture is already pinned down in detail. Specifying the hard distributed-systems layer before validating the domain model with a real dancer is backwards sequencing: you may build the merge machinery and then learn the model wanted two charts (doubling the merge surface) or live co-editing (invalidating the single-writer premise).

---

## 2. A concrete leaner v1 (recommended)

**Recommendation: build the "single-writer server + optimistic local cache" v1. Defer the CRDT/DO/offline-write machinery to a v2 that you build only if real usage proves you need it.** Argue both sides first, then the cut.

### Both sides

**Keep the spec's architecture if:** you are confident the couple will *frequently and concurrently author structure offline* AND you value the learning/portfolio value of building local-first infra AND you accept that the project's risk profile is "ship a distributed system" not "ship a dance app." The spec's design is internally coherent and the platform research is excellent — *if the requirements are real*, Option A is a defensible build.

**Go leaner if:** the goal is a maintainable app two people actually use, shipped this year, where the dance-notation product is the point. Then the CRDT is solving a problem the product model (single-writer + fork) has already defined away, and offline-*write* is a thin usage slice.

**My recommendation: go leaner.** The spec's own §5.3 analysis is the strongest argument for it — it concludes the CRDT barely earns its keep, then keeps it anyway.

### What the leaner v1 looks like

- **One server-authoritative store.** Routines, sides, figures, steps, comments, journal, memberships all in **D1** (Drizzle). No Durable Objects, no CRDT, no per-routine sync coordinator, no dual-store projection. The list screen is just a D1 query — no "render without spinning up DOs" problem because there are no DOs.
- **Writes go through Hono RPC routes** with last-write-wins at the row/field level and a server-assigned `updatedAt`. Ordered lists use the same fractional-index `sortKey` the spec already designed (that part is good and survives) — but resolved server-side, not via CRDT merge.
- **Optimistic local cache for offline *read* + responsive UX.** Cache the SPA shell (vite-plugin-pwa, which the spec already has) and cache fetched routines in IndexedDB (a plain key-value cache, e.g. via the query layer — TanStack Query persistence or a thin Dexie wrapper). Offline = read your cached routines. This delivers the genuinely valuable offline experience (read your routine in the studio) at ~5% of the complexity.
- **Optional: a small offline write queue for the *one* high-value offline write** — adding a comment/journal note while in the studio. Queue it in IndexedDB, POST on reconnect. This is a few-dozen-line outbox, not a CRDT. LWW is fine because comments are append-only (no conflict) and a queued tag edit losing to a concurrent one is a non-event for 3 people.
- **Auth: keep Clerk** (well-justified, low-effort, and auth must be real).
- **Fork: keep as a simple server-side deep-copy** (it's a single INSERT-SELECT-with-new-ids transaction in D1 — *much* simpler than provisioning a new DO). But **reconsider whether fork is even the right model** (see Q1 below) — strongly consider letting the two partners simply **co-own and co-edit one routine** with LWW, which is what a couple building a routine together actually wants.
- **Media: out of v1 entirely** (already deferred); add R2 in v1.1 when you build media. Remove it from the v1 diagram.
- **No real-time sync in v1.** Poll/refetch on focus, or refetch-on-reconnect. Near-real-time for 2–3 people who are usually in the same room talking to each other is a nice-to-have, not a requirement. WebSockets/Hibernation deferred.

### What the leaner v1 keeps (the actually-load-bearing core)
The domain layer (§7.1 `domain/`: enums, sortKey, bar-count, side-naming, fork-copy, Zod schemas) is pure, valuable, and **identical in both architectures** — build it first regardless. The whole product surface (Assemble, Figure Timeline, Step/Tag editor, Threads, Journal, Share, Profile) is unchanged; it's fed by D1-backed RPC instead of a TinyBase store. The wireframe never knew which backend it had.

### What the leaner v1 risks (honest)
- **Concurrent same-field edits clobber (LWW).** Risk: low — single-writer-structure already means this nearly never happens; for 3 people it's a non-event, and a CRDT wouldn't have semantically *resolved* a true conflict anyway, just picked a winner per cell (LWW does the same).
- **No multi-device offline structural authoring with auto-merge.** Risk: the owner editing the same routine offline on phone *and* tablet simultaneously, then both reconnecting, could lose one device's edits. For one person this is rare and recoverable; not worth a CRDT.
- **Real-time feel is degraded** to refetch-on-reconnect/focus. Risk: low for a co-located couple; can add WebSockets later without touching the data model.
- **You may someday genuinely need the CRDT** (if it grows to a studio/class, Q-S3, or true live co-editing becomes core). Risk: real but *deferrable* — and the spec's Option B/Yjs pivot note already shows the team knows the upgrade path. **Building it later, when validated, is cheaper than maintaining it speculatively now.**

**Net:** the leaner v1 cuts ~3 of the highest-risk subsystems (CRDT, per-routine DO + sync coordinator, dual-store projection) and the entire §9.4 two-client-merge test burden, while preserving 100% of the product and the pure domain core. That is the spec's stated value system — quality/maintainability over features — actually applied.

---

## 3. New / sharper questions the open-questions section misses

§11 has 34 questions but they are overwhelmingly *domain* and *config* questions. It is missing the **meta-questions about how much complexity and offline fidelity the owner actually wants vs. shipping**. These are the ones that should be asked *first*, because they can delete entire subsystems.

### NEW-Q1 — Do the two partners want to CO-EDIT one routine, or genuinely each own a forked copy? (deletes or keeps the whole single-writer/fork model)
**Why:** The entire CRDT-vs-not and fork-as-editing decision hinges on this, and the spec assumes "structure is not co-edited" purely because one line of wireframe microcopy says so. A couple building *one* routine together is the most natural co-editing case imaginable. If they want to co-edit:
- (a) **co-own + LWW on a server store** — simplest, no fork, no CRDT (recommended if they co-edit and don't author offline-concurrently);
- (b) **co-own + CRDT** — the spec's machinery, justified only if they *also* edit offline concurrently;
- (c) **fork model as specced** — only if they truly want separate copies (coach reviewing a couple's routine fits this; the couple themselves probably don't).

### NEW-Q2 — Is full offline *WRITE* a real v1 requirement, or is offline *READ* enough? (deletes the CRDT/sync-reconcile layer if read-only)
**Why:** This is the single highest-leverage scope question and §11 never asks it directly (Q-S1/S2 ask about conflict UX and real-time, assuming write-sync exists). Concretely: *when, physically, does a dancer need to create or edit structure with no network?*
- (a) **Offline read only** (cache synced routines; all writes require connectivity) — deletes the CRDT, the sync reconciler, and most of §9.4. Recommended starting assumption.
- (b) **Offline read + offline append (comments/journal) via a simple outbox** — adds ~50 lines, no CRDT.
- (c) **Full offline structural authoring with auto-merge** — the specced CRDT. Only if the owner regularly builds routines with zero signal.

### NEW-Q3 — What is the owner's appetite for maintaining bespoke distributed-systems code as a solo hobbyist? (frames the whole architecture choice)
**Why:** Every piece of infra is a forever-liability for one person. The DO sync coordinator + two-zone auth gate + CRDT merge edge cases are the parts most likely to break in subtle ways and be hardest to debug at 11pm.
- (a) **Minimize infra surface** — D1-only server-authoritative; boring, debuggable, cheap. (recommended for "quality/maintainability")
- (b) **Accept the infra as a deliberate learning/portfolio investment** — then the spec's stack is fine, but call it that explicitly so "maintainability" isn't the justification.

### NEW-Q4 — Is near-real-time sync actually wanted in v1, or is refetch-on-reconnect fine? (deletes WebSocket/Hibernation from v1)
**Why:** Q-S2 asks "real-time vs eventual" but frames both as supported by the WebSocket design. The sharper question: do you need *any* live push in v1 at all? Two co-located partners talking to each other rarely need sub-second cross-device propagation.
- (a) **No live push v1** — refetch on focus/reconnect; add WebSockets later.
- (b) **Live push v1** — keep hibernatable WS.

### NEW-Q5 — Walking-skeleton sequencing: will the project ship? (process, not feature)
**Why:** With a maximalist architecture and 4 model-blocking open questions, there's a real risk of never shipping ("architecture too clever to finish"). The spec has no milestone breakdown. Proposed smallest concept-proving skeleton and milestones below — confirm the owner wants to sequence this way.

#### Suggested walking skeleton (proves the concept end-to-end, no distributed systems)
1. **Pure `domain/` package** + Vitest: enums (§3), sortKey, bar-count, side-naming, fork deep-copy, Zod schemas. (Identical in any architecture; zero risk; do first.)
2. **Single-screen vertical slice, local-only:** create a routine → add a figure from the static catalog → tag a step. Persisted to D1 via Hono RPC. No auth yet (hardcode a user), no sync, no offline. This proves the *core loop* (notate a routine) is real and the domain model holds up — *before* committing to any sync architecture.
3. **Add Clerk auth + memberships + the read-side** (list, share view).
4. **Add comments/threads + journal** (server-authoritative).
5. **Add offline read** (SW shell cache + IndexedDB read cache).
6. **Ship. Use it for a month with a real partner.**
7. **THEN** revisit: did we ever miss offline write? Did LWW ever bite? Only if yes, build the outbox (v1.1) or the CRDT/DO (v2).

This front-loads the riskiest *product* question (is the notation model right?) and defers the riskiest *infra* question (do we need a CRDT?) until usage answers it — the opposite of the current spec's ordering.

### NEW-Q6 — Confirm R2/media is fully out of v1, and remove it from the v1 architecture (§7) accordingly
**Why:** Media is deferred to v1.1 (§4.0, §6) yet R2 is drawn into the v1 architecture diagram and appears in §9.2 tests. Either it's in v1 or it isn't — having it half-in invites building presign/upload plumbing nobody needs yet.
- (a) **Remove R2 from v1 entirely**; add when media ships. (recommended)
- (b) **Keep the R2 binding stubbed** but build no upload code.

---

## Bottom line

The spec is high quality and the research behind it is genuinely strong — but it optimizes the wrong cost. It applies YAGNI to features and maximalism to infrastructure, for a hobby app whose maintainability burden *is* the infrastructure. The author's own "central tension" analysis (§5.3) already proves the CRDT barely earns its keep. The recommendation is to invert the build: ship a boring, server-authoritative, D1-only v1 with offline *read* and optimistic UX, validate the domain model with a real dancer via a walking skeleton, and earn the CRDT/Durable-Object/offline-write machinery in v2 only if real usage demands it. The four starred domain questions — plus the five new meta-questions above — should be answered *before* any sync architecture is built, because their answers can delete entire subsystems.
