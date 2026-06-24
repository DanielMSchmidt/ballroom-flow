# Platform & Architecture Research — Ballroom Flow

**App:** Collaborative, offline-first, mobile-first PWA — a ballroom dance choreography builder.
**Data shape:** Ordered lists of figures/steps + attribute tags + threaded comments + per-user journals with media (voice/photo/video).
**Collaboration:** 2–3 people per routine (couple + maybe coach). Real-time-ish nice, eventual sync acceptable.
**Constraints:** Hosted on Cloudflare; no self-run auth (managed/third-party identity); cheap (~$0 at hobby scale, usage-based); performant; offline-first; quality & maintainability over feature count.

> Research date: **2026-06-24**. Pricing/free-tier figures cited inline with source URLs. Cloudflare numbers verified against `developers.cloudflare.com`.

---

## TL;DR Recommendation

- **Frontend:** React + Vite **SPA** (client-rendered), shipped as a PWA via `vite-plugin-pwa` (Workbox). Avoid heavy SSR — it fights offline-first.
- **Local store + sync:** **TinyBase** with its `MergeableStore` (CRDT) persisted to IndexedDB on the client and synchronized through a **Durable Object** running TinyBase's `synchronizer-ws-server-durable-object`. This is the most native, ~$0, fully-self-hostable-on-Cloudflare local-first path. (Yjs-on-Durable-Objects via PartyServer is the strong runner-up if we later need rich-text/cursor collaboration.)
- **Backend/API:** **Hono** on Workers, with the **Hono RPC** typed client for client↔Worker contract safety.
- **Auth:** **Clerk** (50k MRU free, networkless JWT verification in Workers, Google sign-in, passkeys). Runner-up: **Supabase Auth** (50k MAU free) if we want auth + a free Postgres in one.
- **Media:** **R2** with Worker-issued **presigned PUT URLs**; offline capture stored as Blobs in IndexedDB, deferred upload via service-worker Background Sync.
- **Hosting:** Single **Worker** serving the SPA via **Workers Static Assets** + the Hono API + the Durable Object namespace. (Skip Pages — Workers is the 2026 default.)
- **Testing:** Vitest (units) + `@cloudflare/vitest-pool-workers` (Worker/DO/D1 integration) + Vitest browser mode/Testing Library (components) + Playwright (E2E incl. offline/two-client sync).
- **Realistic monthly cost at hobby scale: $0** (everything fits free tiers). Optionally **$5/mo** for Workers Paid to remove the 100k req/day cap and unlock higher DO duration limits.

---

## 1. Cloudflare Storage & Compute Options

### Workers (compute + hosting)
- **Free:** 100,000 requests/day, 10 ms CPU time per invocation. Static-asset requests are **free** (don't count against the request limit).
- **Paid ($5/mo):** 10M requests/mo + 30M CPU-ms included; then **$0.30/M requests**, **$0.02/M CPU-ms**.
- **2026 note:** Workers reached feature parity with Pages for static assets, SSR, and custom domains; Cloudflare is unifying the two. **For a new project, deploy to Workers from day one** and serve the SPA via Workers Static Assets.
- Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Migrate from Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) (seen 2026-06-24).

### Durable Objects (the heart of the sync design)
- **SQLite-backed DOs are GA**, with a **10 GB SQLite database per Durable Object** ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
- **Available on the Workers Free plan** (this is relatively recent — only the SQLite storage backend is offered on Free; the legacy KV backend requires Paid). ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/))
- **SQLite storage billing turned on January 2026** (target 2026-01-07). Free plan is **not charged** for storage. ([changelog 2025-12-12](https://developers.cloudflare.com/changelog/2025-12-12-durable-objects-sqlite-storage-billing/))

| | Free plan | Paid plan |
|---|---|---|
| Requests | 100k/day | 1M/mo incl., then $0.15/M |
| Duration | 13,000 GB-s/day | 400,000 GB-s/mo incl., then $12.50/M GB-s |
| SQLite storage | 5 GB (not billed) | 5 GB-mo incl., then $0.20/GB-mo |
| Rows read | 5M/day | 25B/mo incl., then $0.001/M |
| Rows written | 100k/day | 50M/mo incl., then $1.00/M |

Source: [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (seen 2026-06-24).

**Why DOs are the right sync coordinator:** A Durable Object is a single-threaded, globally-addressable, strongly-consistent actor. You route every request/WebSocket for a given choreo id to **the same DO instance** (one DO per routine). That DO is the **authoritative coordinator + op-log host** for that document: it holds the canonical state in its embedded SQLite, fans changes out to connected peers, and persists for offline reload. This gives us a clean per-document concurrency boundary without us running any servers.

**WebSocket Hibernation API** lets a DO keep WebSocket connections open while the object itself is evicted from memory between messages — you are **not billed for duration** while hibernating. Essential for cheap "always-connected" sync where clients sit idle most of the time. ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), Hibernation note).

**Point-in-time recovery** is available for SQLite-backed DOs (restore to any point in a retention window) — a cheap safety net for a couple's accumulated choreography.

### D1 (SQLite, serverless)
- **Free:** 5 GB storage, 5M rows read/day, 100k rows written/day.
- **Paid:** ~$0.001/M rows read, **$1.00/M rows written**, $0.75/GB-mo storage after free tier.
- **Read replication** (global read replicas) does not add per-replica charges — same row-based billing.
- **Watch-out:** "rows read" counts **rows scanned**, not returned — un-indexed full scans get expensive (a documented $134 surprise bill scenario). Index everything you query.
- Role here: **D1 is the global/relational store** — the index of which users belong to which routines, sharing/ACL, user profiles, and a denormalized catalog of routines for listing/search. Per-document live editing state lives in the **DO**, not D1.
- Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [$134 D1 bill writeup](https://fullstacksveltekit.com/blog/cloudflare-d1-bill) (seen 2026-06-24).

### KV
- **Free:** generous reads, limited writes/day; **eventually consistent** (writes can take up to ~60s to propagate globally).
- Role here: cache static config, feature flags, session/JWT cache. **Not** a source of truth for collaborative data (the eventual-consistency + 1-write-per-key-per-second ceiling is wrong for editing). Source: [KV docs](https://developers.cloudflare.com/kv/).

### R2 (media)
- **Free:** 10 GB storage, 1M Class A ops, 10M Class B ops per month; **zero egress fees** (confirmed — includes Workers API, S3 API, and `r2.dev`).
- **Paid:** $0.015/GB-mo storage; Class A $4.50/M, Class B $0.36/M; egress still **$0**.
- S3-compatible → standard **presigned URLs** supported.
- Role here: all voice/photo/video attachments. Zero egress is a major win for media playback.
- Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 product page](https://www.cloudflare.com/products/r2/) (seen 2026-06-24).

### Workers Assets / Pages
- Use **Workers Static Assets** to serve the compiled SPA. Static-asset requests are free. SPA mode (serve `index.html` for unmatched routes) is supported. **Skip Pages** for new builds. ([Static Assets](https://developers.cloudflare.com/workers/static-assets/)).

### Hyperdrive — N/A
Hyperdrive accelerates connections to **external** databases (Postgres/MySQL). We're using D1 + DO-SQLite, both native, so there's no external DB to pool. Not needed.

### Recommended Cloudflare combination
- **1 Worker** = SPA assets (Workers Static Assets) + Hono API + DO binding.
- **Durable Object (SQLite) per choreo** = live sync coordinator + op log + offline-durable canonical copy.
- **D1** = users, memberships/ACL, routine index, sharing.
- **R2** = media blobs.
- **KV** = light config/JWT cache (optional).

**Hobby cost estimate (~5 users, few hundred docs, few hundred MB media):** **$0/mo** — everything sits inside free tiers. Risk is the **100k req/day** Workers cap and **13,000 GB-s/day** DO duration cap; WebSocket Hibernation keeps DO duration near zero, so the cap is unlikely to bite. If it does, **$5/mo** Workers Paid removes it comfortably.

---

## 2. Offline-First / Local-First Sync Architecture

### The core design choice: full CRDT vs. single-writer DO + op log

Our data is **structured** (ordered figure lists + tags + threaded comments), **not** free-form rich text, and there are only **2–3 collaborators** who are rarely editing the exact same field simultaneously.

- A **full document CRDT** (Yjs/Automerge) shines for rich-text and many simultaneous cursors. For ordered lists it solves concurrent insert-ordering elegantly (fractional indexing / sequence CRDTs) so two people inserting a figure at the same spot both survive.
- A **single-writer-per-doc Durable Object + op log** (server-authoritative: client sends ops, DO orders them, rebroadcasts) is simpler to reason about and test, and is enough when concurrent edits to the *same field* are rare. But you (re)implement merge/offline-reconcile logic yourself.

**Recommendation:** Use a CRDT, but a **lightweight, structured one (TinyBase MergeableStore)** rather than hand-rolling an op log. It gives automatic conflict-free merge for offline edits *and* runs natively on a Durable Object, so we get the DO's "one authoritative coordinator per doc" property **and** principled merge — best of both. For ordered lists, store an explicit **fractional-index / sort-key cell** per figure so reordering merges cleanly under the CRDT. Threaded comments are append-mostly (new rows), which CRDTs handle trivially.

### Library survey (Cloudflare fit, conflict model, cost)

| Library | Conflict model | Self-host sync on CF Workers/DO? | Client store | License | $0 on CF? | Fit for our data |
|---|---|---|---|---|---|---|
| **TinyBase** | CRDT (`MergeableStore`) or plain | **Yes — first-class** DO synchronizer + DO-SQLite persister | IndexedDB (+ many) | MIT | **Yes** | Excellent (tabular rows + values; ordered via sort-key) |
| **Yjs** (+ PartyServer `y-partyserver`, `y-durableobjects`) | CRDT (sequence/array) | **Yes — mature** on DO | IndexedDB (`y-indexeddb`) | MIT | **Yes** | Great, esp. if rich-text/cursors needed; arrays for ordered lists |
| **Automerge / Automerge-Repo 2.0** | CRDT (document) | Possible (WS sync server in a DO) but **no official CF adapter**; DIY | IndexedDB | MIT | Yes (DIY) | Strong CRDT, heavier wasm; more custom glue on CF |
| **ElectricSQL** | Read-path sync from **Postgres**; pivoted 2026 to an "agents on sync" / Postgres read-sync product, **not** a write-CRDT | Needs Postgres + Elixir service (not native CF) | varies | Apache-2 | **No** (needs Postgres infra) | Poor fit (no managed Postgres on CF; read-only sync) |
| **PowerSync** | Server-authoritative sync over **Postgres/Mongo/MySQL** | Needs PowerSync service + a DB | SQLite (wasm) | paid SaaS + OSS | **No** ($0 only at tiny scale, needs a DB) | Overkill; DB-centric |
| **RxDB** | Pluggable; **HTTP replication to a custom endpoint** | **Yes** — write a custom replication endpoint as a Worker/DO | IndexedDB / OPFS-SQLite | Apache-2 (some paid plugins) | **Yes** (DIY backend) | Good, but you build & test the sync protocol yourself |
| **Triplit** | CRDT-ish sync engine | **Acquired by Supabase (Oct 2025)**; open-sourcing in progress | IndexedDB | OSS | Uncertain (in transition) | Promising but in flux — risky to bet on now |
| **Jazz** (`cojson`) | CRDT (covalues) | Runs on its own sync infra (jazz cloud / self-host node); **not a native CF DO deploy** | IndexedDB | MIT | Partial (self-host node, not CF) | Nice DX but not a clean CF-$0 story |
| **Replicache / Zero** (Rocicorp) | Server-authoritative + client cache; **Zero reached 1.0 (June 2026)** | **No** — needs `zero-cache` stateful service **+ Postgres** | IndexedDB | Apache-2 | **No** (stateful server + Postgres ≠ serverless CF) | Great tech, wrong infra shape for $0 CF |
| **Dexie Cloud** | Sync SaaS on top of Dexie | Paid SaaS backend (Dexie itself = local IndexedDB, free) | IndexedDB | Dexie MIT; Cloud paid | **No** (Cloud is SaaS) | Local Dexie great; Cloud is a paid add-on |
| **Liveblocks** | CRDT (Storage) + presence, **SaaS** | No (hosted SaaS) | in-memory + their backend | paid SaaS | **No** | Polished but a paid dependency |

Sources: [TinyBase DO guide](https://tinybase.org/guides/integrations/cloudflare-durable-objects/), [TinyBase DO-SQLite persister](https://tinybase.org/api/the-essentials/persisting-stores/createdurableobjectsqlstoragepersister/), [vite-tinybase-ts-react-sync-durable-object template](https://github.com/tinyplex/vite-tinybase-ts-react-sync-durable-object), [cloudflare/partykit (y-partyserver)](https://github.com/cloudflare/partykit), [napolab/y-durableobjects](https://github.com/napolab/y-durableobjects), [Automerge-Repo 2.0](https://automerge.org/blog/automerge-repo-2/), [Electric](https://electric.ax/) & [Electric/Cloudflare](https://electric-sql.com/docs/integrations/cloudflare), [RxDB replication](https://rxdb.info/replication.html) / [HTTP replication](https://rxdb.info/replication-http.html), [Triplit→Supabase acquisition](https://www.buildmvpfast.com/blog/local-first-software-saas-rxdb-pouchdb-sync-2026), [Jazz](https://jazz.tools/blog/what-is-jazz), [Zero 1.0 / open source](https://zero.rocicorp.dev/docs/open-source) & [InfoQ Zero 1.0](https://www.infoq.com/news/2026/06/zero-version-1/) (all seen 2026-06-24).

**Why TinyBase wins for this project:** It is the only library with a **first-party, documented Durable Object synchronizer AND a DO-SQLite persister** — meaning the entire sync backend is a few hundred lines deployed on *our own* Cloudflare for $0, with clients persisting to IndexedDB for offline. Its `MergeableStore` gives CRDT merge so offline edits from two people reconcile without clobbering. The data model (tables of rows + keyed values) maps directly onto figures/tags/comments. Maturity is solid (v5/v6 era, active), MIT-licensed, tiny (~5–10 KB).

**Yjs is the runner-up** and the migration target if we later want collaborative rich-text notes or live cursors: `y-partyserver` (Cloudflare's PartyServer) makes Yjs-on-DO turnkey.

### Local client storage
- **IndexedDB** is the durable client store (works in service workers, large quota). Use the sync library's IndexedDB persister (TinyBase persister / `y-indexeddb`). If using raw access, **Dexie** is the ergonomic wrapper.
- **OPFS + sqlite-wasm** is an option for heavy local SQL, but adds complexity and worker plumbing; **not needed** at our data sizes — IndexedDB is simpler and sufficient.
- **PWA/service-worker offline:** `vite-plugin-pwa` (Workbox under the hood) for precaching the app shell + runtime caching; **Background Sync API** for deferred writes/uploads when offline. The sync library handles data reconciliation; the service worker handles asset offline + queued media upload.

---

## 3. Auth Without Self-Hosting

We must verify a session/JWT **at the edge in a Worker** and want Google sign-in, passkeys, and a generous free tier.

| Provider | Free tier (2026) | Workers-edge verify | Google sign-in | Passkeys | Notes |
|---|---|---|---|---|---|
| **Clerk** | **50k MRU** (retained users — only counts users returning >24h after signup) | **Yes** — `@clerk/backend` runs in Workers; set the JWKS/PEM for **networkless** JWT verify | Yes | Yes | Best balance of DX + free tier; M2M JWT verify free (Feb 2026) |
| **Supabase Auth** | **50k MAU** | Yes — verify Supabase JWT (JWKS) in Worker | Yes | Yes | Comes with free Postgres/storage; runs off-CF but that's fine |
| **WorkOS AuthKit** | **1M MAU** (most generous) | Yes (JWT/JWKS) | Yes | Yes | SSO connections paid ($125/mo each) but consumer auth free; slightly more enterprise-oriented |
| **Firebase Auth** | **50k MAU** (email/social); SMS never free | Yes (verify Google-signed JWT via JWKS) | Yes (Google-native) | Yes | Heavier SDK; Google ecosystem lock-in |
| **Auth0** | **25k MAU** (raised from 7.5k) | Yes (JWKS) | Yes | Yes | Smallest free tier here; first paid tier $35/mo |
| **Stytch** | **25 MAU** free, then $0.05/MAU | Yes | Yes | Yes | Tiny free tier — not for a free hobby app |
| **Cloudflare Access / Zero Trust** | 50 seats free | Native to CF | via IdP | via IdP | Aimed at **internal/team** app gating, not consumer signup flows — awkward fit |
| **Better Auth** | Free (it's a library) | Yes — runs **in your Worker** on D1 | Yes | Yes | **Self-hosted** — contradicts "don't run own auth"; you own the DB & flows |
| **Lucia** | n/a | n/a | n/a | n/a | **Deprecated as a library**; now a learning resource/reference, not a dependency |
| **Google Identity Services direct** | Free | You verify Google ID token (JWKS) in Worker; **you** manage sessions | Yes (only Google) | — | Cheapest but you build session mgmt, refresh, account linking yourself |

Sources: [Clerk pricing](https://clerk.com/pricing) & [Verifying Clerk JWTs in Cloudflare Workers](https://www.subaud.io/verifying-clerk-jwts-in-cloudflare-workers/) & [Clerk serverless/edge](https://clerk.com/articles/authentication-for-serverless-and-edge-deployments), [Supabase pricing](https://supabase.com/pricing), [WorkOS/Auth0/Firebase/Stytch comparison](https://www.buildmvpfast.com/api-costs/authentication) & [Zuplo auth pricing](https://zuplo.com/learning-center/api-authentication-pricing), [Better Auth on Cloudflare (Hono)](https://hono.dev/examples/better-auth-on-cloudflare) & [better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare), [Cloudflare JWT validation in a Worker](https://developers.cloudflare.com/api-shield/security/jwt-validation/jwt-worker/) (all seen 2026-06-24).

**Recommendation: Clerk.** 50k MRU free, Google + passkeys out of the box, and — critically — **networkless JWT verification in Workers**: Clerk issues a short-lived JWT; the Worker verifies the signature against Clerk's public key (cached JWKS / PEM) with **no network round-trip per request**, so auth adds ~0 latency at the edge and stays free. The flow: client gets Clerk session JWT → sends as `Authorization: Bearer` → Hono middleware verifies signature + claims → maps `sub` to our D1 user. The DO uses the same verified identity to authorize WebSocket connections to a choreo.

**Runner-up: Supabase Auth** if we'd rather have auth + a managed Postgres + storage in one free account (50k MAU). It runs off-Cloudflare but JWT verification at the edge is identical in shape. **Avoid** rolling our own (Better Auth/Google-direct) given the explicit "no self-run auth" constraint — though Better Auth is the fallback if a managed vendor's pricing ever turns hostile, since it slots into our existing Hono+D1 Worker.

---

## 4. Language / Framework / Runtime

**TypeScript** throughout (no Rust/Wasm needed; the only wasm in play is whatever a CRDT lib bundles, which is transparent).

### Backend on Workers — **Hono**
The de-facto Workers-native framework in 2026: ~14 KB, Web-Standards based, runs everywhere, used in production by Cloudflare itself. Crucially it ships **Hono RPC** — export `typeof app` from the server, get a fully-typed client (`hc`) with **zero codegen and no OpenAPI** — giving us tRPC-style end-to-end types between SPA and Worker without a separate contract layer. ([Hono RPC](https://hono.dev/docs/guides/rpc), [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers), seen 2026-06-24.)

### Frontend — client-rendered SPA, not SSR
For an **offline-first** app, server-side rendering is a liability: the user is often offline, so the app must boot and run entirely from the cached shell + local store. A **client-rendered SPA** is the natural fit. Meta-frameworks and their CF status:

- **React Router v7 / Remix, SvelteKit, SolidStart, TanStack Start, Astro, Next-on-Workers (`@opennextjs/cloudflare`)** all deploy to Workers in 2026 with varying maturity (Next-on-Workers is usable but the heaviest/most caveated). All are **SSR-first**, which we mostly *don't* want.
- We can still use one in **SPA mode**, but that throws away their main benefit.

**Recommendation: React + Vite SPA** (or SvelteKit in SPA/`adapter-cloudflare` mode if the team prefers Svelte). Reasons: (1) the richest ecosystem for the offline/local-first libs we're choosing (TinyBase and Yjs both have first-class React bindings); (2) Vite + `vite-plugin-pwa` is the cleanest PWA toolchain; (3) a plain SPA keeps the mental model simple and testable — exactly the "quality over features" the owner asked for. Serve the built SPA from the **same Worker** via Workers Static Assets, alongside the Hono API and the DO.

**Concrete stack:** `React 19 + Vite + vite-plugin-pwa` (frontend) · `TinyBase MergeableStore` + IndexedDB persister (local store + sync client) · `Hono` API + `TinyBase DO synchronizer` (Worker/DO) · `D1` (relational) · `R2` (media) · `Clerk` (auth) · `Drizzle` (typed D1 access).

---

## 5. Media Attachments (voice / photo / video)

- **Upload path: presigned PUT URLs.** Browser asks the Worker for a short-lived R2 presigned PUT URL (Worker authorizes via Clerk JWT + checks the user owns the journal entry), then uploads the blob **directly to R2** — bytes never pass through the Worker, so no CPU-time/egress cost and no Worker body-size limits. For large video use **multipart upload**. ([R2 presigned URLs are S3-compatible](https://developers.cloudflare.com/r2/), zero egress confirmed above.)
- **Download/playback:** zero egress on R2 → serve via presigned GET or a Worker that streams from R2; either way bandwidth is free.
- **Offline capture & deferred upload:** capture (MediaRecorder for voice/video, file input/camera for photo) → store the Blob in **IndexedDB** with a "pending upload" record → service-worker **Background Sync** flushes the queue when connectivity returns, requesting a fresh presigned URL per item. The journal entry's metadata (which syncs via TinyBase) carries the R2 object key; the binary is uploaded out-of-band.
- **Cost control:** compress client-side before upload (`browser-image-compression` for photos; cap voice memos to a sane bitrate; warn/limit on video). Hundreds of MB sits inside R2's free 10 GB.

---

## 6. Testing & Quality Tooling

**Testing pyramid:**

1. **Unit (Vitest):** pure domain logic — figure-list ordering, fractional-index sort-key generation, tag rules, comment-thread shaping, CRDT merge helpers. Fast, no runtime.
2. **Worker/DO/D1 integration (`@cloudflare/vitest-pool-workers`):** runs tests **inside `workerd`**, giving real DO bindings, real D1, real R2 bindings. Test the sync coordinator DO directly (apply ops, assert broadcast/persisted state), test Hono routes, run `applyD1Migrations()` against a test DB. SQLite-backed DOs "work seamlessly in tests." ([vitest-pool-workers config](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/), [Testing Durable Objects](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/), [Hono CF testing](https://hono.dev/examples/cloudflare-vitest), seen 2026-06-24.)
3. **Component (Vitest browser mode + Testing Library):** React components against the local TinyBase store (seed an in-memory store, assert UI).
4. **E2E + offline/sync (Playwright):** drive the real PWA. Use Playwright's **offline emulation** (`context.setOffline(true)`) and **two browser contexts** to test the core local-first guarantee: client A edits offline, client B edits the same routine online, A reconnects → assert both sets of edits survive and merge (no clobber). Also test service-worker registration, app-shell offline boot, and Background-Sync media upload.
5. **Contract testing (client↔Worker):** lean on **Hono RPC** types as the compile-time contract; add a thin runtime check with **Zod** schemas shared between client and Worker for request/response validation. This catches drift without a separate contract tool.

**Quality tooling:** TypeScript strict, ESLint + Prettier (or Biome), Drizzle for typed D1, CI running the four test layers on PRs (Wrangler/Miniflare for the Worker layers, headless Playwright for E2E). Aim: every sync/merge edge case has a `vitest-pool-workers` or Playwright two-client test — this is the highest-risk area.

---

## 7. Reference Architectures

### Option A (recommended) — TinyBase-on-Durable-Objects, all-Cloudflare
```
[ React+Vite PWA ]  -- IndexedDB (TinyBase MergeableStore, offline) 
       |  WebSocket (Hibernatable) per choreo
       v
[ Worker ]  Hono API + Workers Static Assets (serves SPA)
   |  \-- Clerk JWT verify (networkless, edge)
   |  \-- presigned R2 URLs
   |
   +--> [ Durable Object (SQLite) per choreo ]  TinyBase synchronizer + canonical store/op log
   +--> [ D1 ]   users, memberships/ACL, routine index, sharing
   +--> [ R2 ]   media blobs
```
- **Cost at hobby scale: $0/mo** (optionally $5/mo Workers Paid to lift caps).
- **Strengths:** fully self-hosted on owner's Cloudflare, near-zero ops, principled offline merge, one authoritative coordinator per doc, simplest mental model.
- **Risks/unknowns:** TinyBase synchronizer maturity for our exact merge edge cases (mitigate with the two-client Playwright tests); free-tier DO duration/request caps (mitigate with Hibernation + Workers Paid if needed); reordering semantics need an explicit sort-key convention.

### Option B — Yjs-on-PartyServer, all-Cloudflare
Same topology, but the DO runs **`y-partyserver`** and the client uses **Yjs + y-indexeddb**. Choose this if collaborative **rich-text** notes or **live cursors** become first-class. More battle-tested CRDT for sequences; slightly more code to map structured data onto Yjs types. Still **$0** on free tiers. ([y-partyserver](https://github.com/cloudflare/partykit)).

**Decision:** Start with **Option A**; Option B is a known, low-risk pivot if collaboration needs grow.

---

## 8. Open Questions to Resolve Before Committing

1. **Real-time required, or is eventual sync OK?** (Drives Hibernation/WebSocket tuning; both options support either, but it sets UX expectations.)
2. **Max collaborators per routine?** Confirmed ~2–3? If it could grow to a class/studio (10s), revisit DO fan-out and CRDT choice.
3. **Concurrent edits to the *same* figure/field — common or rare?** If rare, the lightweight CRDT is ideal; if a coach and couple routinely co-edit one step live, lean harder toward Yjs.
4. **Media size limits & retention.** Per-attachment cap? Video allowed or voice+photo only? Keep originals forever, or expire? (Drives R2 budget and client compression policy.)
5. **Auth vendor lock-in tolerance.** Comfortable depending on Clerk's free tier long-term, or want the Better-Auth-in-our-Worker escape hatch designed in from day one?
6. **Sharing model.** Invite-by-link, by email, roles (owner/editor/commenter/coach)? This shapes the D1 ACL schema and DO connection authorization.
7. **Offline conflict UX.** When a merge produces a surprising result, do we surface history/undo (favors a CRDT with change history) or silently merge?
8. **Native wrapper later?** If an app-store presence is likely, confirm the PWA-first bet (Capacitor wrap) is acceptable vs. a future React Native path (would change the local-store choice).
