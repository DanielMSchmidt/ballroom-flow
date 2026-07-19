# Annotation Media Embeds (photos / videos / YouTube) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/ideas/annotation-media-embeds.md`](annotation-media-embeds.md) — read it fully first. Every decision in it is FINAL (owner-confirmed 2026-07-15): stream-through serving via the R2 binding with Range support (NOT 302/signed URLs); worker-proxied YouTube thumbnail; caps image ≤ 10 MB / video ≤ 3 min & ≤ 300 MB / ≤ 4 items per annotation / 1 GB per free user; stale-tab literal-token rendering accepted; media on routine-scoped annotation threads ONLY — not replies, not family notes, not the Journal's account arm.

**Goal:** A routine member can embed photos (uploaded), videos (uploaded), and YouTube links **inline in an annotation's text** via `![media:<id>]` tokens; full embeds render only in the opened thread, compact surfaces (reading-programme margin, Journal cards) show only a media chip, and every media byte is gated by the same per-document membership that gates the annotation.

**Architecture:** `Annotation` gains optional `media?: MediaItem[]` (discriminated union, client ULIDs, soft-delete tombstones — optional ⇒ lenient reads, no migration). A pure domain token splitter renders text+media as ordered parts. The worker gains the first **R2 bucket** (binding `MEDIA`, one bucket per env): `POST /api/docs/:id/media/upload-url` mints an upload grant (commenter+ AND caps, usage in an indexed D1 `media_object` table), `PUT /api/media/<objectKey>` streams the body into R2 via the binding (single PUT up to ~90 MiB; larger videos go through the R2 **multipart** subroutes under the same grant — see discrepancy note 1), `GET /api/media/<objectKey>` streams it back with Range support — membership (viewer+) derived **from the docRef in the key prefix alone** (`media/<docRef>/<annotationId>/<mediaId>`), and `GET /api/media/youtube-thumb/:videoId` proxies `i.ytimg.com` so a reader's browser never contacts Google. The web store seam grows attach/remove media ops; the compose + inline-embed + facade + chip surfaces recreate `docs/design/project/Ballroom Builder v3.dc.html` pixel-for-pixel. Ship gate: `apps/web/e2e/annotation-media.spec.ts` (@smoke).

**Tech Stack:** TypeScript (strict), Vitest (+ vitest-pool-workers/workerd, vitest-axe), pnpm monorepo, Zod, Hono + Drizzle/raw-SQL D1, Cloudflare Durable Objects + **R2**, Automerge, React, Playwright.

## Global Constraints

- **TDD: write the failing test first, watch it fail, then implement. One commit per task.**
- **THIS IS A HARD-REVIEW-GATE CHANGE.** The serving path is a **new authz surface** — exactly the class where this repo's worst bugs lived. Keys are namespaced `media/<docRef>/<annotationId>/<mediaId>` so **authorization derives from the key alone**: the serving/upload routes parse the docRef out of the key prefix and gate on `resolveEffectiveRole` — never on anything client-supplied beside the key. No public URLs, ever. Flag the PR as security-touching.
- No `any`, no type assertions (`as`/`<T>` — GritQL plugin errors; `as const` allowed). Make types honest at the source; a boundary cast needs one small named documented helper.
- **Soft-delete only** — `deletedAt` tombstones on `MediaItem` and `media_object` rows; never hard removal. Tombstoned media stays fetchable to members (undo must restore it); R2 GC is deferred debt (per the idea's Drawbacks).
- **IDs are client-generated ULIDs** (`newId()` from `@weavesteps/domain`) — `mediaId` included.
- **D1 stays a pure index/registry** — no CRDT content, no media bytes. Every new D1 query gets an `expectIndexedQuery` test (`apps/worker/src/test-support/explain.ts`).
- **Permissions are enforced at the DO sync boundary and the REST surface** — never by post-hoc CRDT cell rejection. The DO's existing commenter annotation-only gate already covers the `media` field (it lives under `annotations`); the new REST routes each gate explicitly.
- **`apps/web` components never touch Automerge or the RPC client directly** — only through `apps/web/src/store/` and the `apps/web/src/ui` design system.
- Automerge sharp edge: **never assign `undefined`** into a doc — build `MediaItem`s with conditional spreads so absent optionals are OMITTED keys.
- Run gates explicitly per task: `pnpm -w lint`, `pnpm -w typecheck`, the package-scoped test. Never `--no-verify`; never pipe `git commit` through grep. Package filters: domain = `@weavesteps/domain`, contract = `@weavesteps/contract`, worker = `worker`, web = `web`.
- Branch off `main` (`feat/annotation-media-embeds`), commit and push as you go, open a PR into `main` (the `development` branch is gone since PR #161 — the older plan template's `--base development` is stale), don't merge red.

## Exact signatures this plan builds on (verbatim from the codebase)

- `Annotation` — `packages/domain/src/doc-types.ts:148`:
  ```ts
  export type Annotation = {
    id: string;
    authorId: string;
    kind: AnnotationKind;
    text: string;
    tags: string[];
    anchors: Anchor[];
    replies: Reply[];
    createdAt: number;
    deletedAt?: number | null;
  };
  ```
  (`Reply` at `doc-types.ts:140`; `AnnotationKind = "note" | "lesson" | "practice"` at `:122`. Note: the idea's sketch omits `tags`/`anchors`/`replies` — the real type above is what `media?: MediaItem[]` is added to.)
- `addAnnotation(doc: A.Doc<RoutineDoc>, input: { authorId: string; kind: AnnotationKind; text: string; anchors: Anchor[]; tags?: string[] }): A.Doc<RoutineDoc>` — `packages/domain/src/doc-routine.ts:81`; `addReply(doc, annotationId, input: { authorId: string; text: string })` at `:107`; `softDeleteAnnotation(doc, annotationId)` at `:126`; internal change helper `mutate<T>(doc: A.Doc<T>, fn: (draft: T) => void): A.Doc<T>` — `doc-internal.ts:71`.
- `buildRoutineDoc(routine: RoutineDoc): A.Doc<RoutineDoc>` — `doc-routine.ts:14`; `readRoutine(doc: A.Doc<RoutineDoc>, opts?: ReadOptions): RoutineDoc` (tombstones omitted by default, `includeDeleted` to see them) — `doc-routine.ts:23`.
- `newId(): string` — `packages/domain/src/ids.ts:18` (ULID).
- Convergence fixtures — `packages/domain/src/__fixtures__/convergence.ts`: `loadAutomerge(): Promise<AutomergeLike>` (`:32`), `applyMutations<T>(doc: Doc<T>, mutations: Mutation<T>[]): Promise<Doc<T>>` (`:48`), `exchangeAndAssertConverged<T>(left: Doc<T>, right: Doc<T>): Promise<{ left; right; converged }>` (`:67`).
- Worker auth: `export function authenticate(c: Context<{ Bindings: Env }>): Promise<AuthedUser | null>` — `apps/worker/src/auth/index.ts:147` (reads the `Authorization` header via `authenticateToken(header, env, waitUntil)` at `:106`).
- `resolveEffectiveRole(db: D1Database, docRef: string, userId: string): Promise<EffectiveRole | null>` — `apps/worker/src/db/membership.ts:65` (owner elevated without a membership row); `can(role: EffectiveRole, action: Capability): boolean` — `packages/domain/src/permissions.ts:59` (`canAnnotate` = commenter+; any non-null role reads).
- The membership-gated route pattern to copy — `apps/worker/src/index.ts:649`:
  ```ts
  app.get("/api/routines/:id/family-notes", async (c) => {
    const user = await authenticate(c);
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    const routineRef = c.req.param("id");
    // Gate on co-membership of the routine: a non-member resolves to null → 403.
    const role = await resolveEffectiveRole(c.env.DB, routineRef, user.sub);
    if (!role) return c.json({ error: "forbidden" }, 403);
  ```
  (path params are `:id` in this codebase, not the idea's `:docRef` spelling.)
- The DO's commenter gate already covers media (no DO change needed for the write path) — `apps/worker/src/doc-do.ts:840-901`: a commenter's change must "(1) touch ONLY `annotations`", "a created annotation (and any reply) must be authored by `sub`", "Non-reply fields may change only on the commenter's OWN annotation" — `media` is a non-reply annotation field, so attach/tombstone by non-authors is already refused post-connect.
- Drizzle table pattern — `apps/worker/src/db/schema.ts` (e.g. `users` / `membership` via `sqliteTable(...)`); the read/write helpers use raw SQL modules like `apps/worker/src/db/journal.ts` (`journalForUser(db: D1Database, userId: string)` at `:125`; the DO alarm projection `projectJournalEntries` at `:51`). `migrations/*.sql` is the source of truth for D1 shape (latest: `0018_timed_family_notes.sql`).
- `Env` — `apps/worker/src/index.ts:71`: `{ DB: D1Database; DOC_DO: DurableObjectNamespace<DocDO>; CLERK_SECRET_KEY?; CLERK_JWT_KEY?; E2E_TEST_ROUTES?; SELF_SEED?; SENTRY_DSN?; ANALYTICS?; BUILD_ID? }` — gains `MEDIA: R2Bucket`.
- `apps/worker/wrangler.toml` — **"Bindings are NOT inherited by named environments — redeclare per env"** (line 107). Existing per-env pattern to mirror for the R2 bucket: `[[d1_databases]] binding = "DB" …` in the default section plus `[[env.e2e.d1_databases]]`, `[[env.staging.d1_databases]]`, `[[env.production.d1_databases]]`. The worker vitest pool reads this file (`wrangler: { configPath: "./wrangler.toml" }` in `apps/worker/vitest.config.ts`), so a default-section `[[r2_buckets]]` is auto-simulated by Miniflare in tests.
- Worker test fixtures — `apps/worker/src/test-support/`: `authedContext(opts: { keypair; userId; docRef; role?; expired?; claims? }): Promise<AuthedContext>` (`authed-context.ts:55`, `authHeaders()` helper; `role: null` = non-member), `applyMigrations(): Promise<void>` + `seedDb(spec: SeedSpec)` (`seed.ts:143/:164`), `generateTestKeypair()` (`jwt.ts:75`), `expectIndexedQuery(db: D1Database, sql: string, params?: unknown[], opts?: ExplainOptions): Promise<void>` (`explain.ts:43`). Every test uses a unique DO id (`do-id.ts`). Outbound-fetch mocking: vitest-pool-workers 4.x removed `fetchMock` — the repo's pattern is `vi.spyOn(globalThis, "fetch")` on a directly-invoked seam (`ops.test.ts:56`).
- Web RPC seam (store-only) — `apps/web/src/lib/rpc.ts`: `apiGet<T>(path, token, opts?)` (`:205`), `apiPost<T>(path, token, body, opts?)` (`:223`), `apiDelete<T>(path, token, body?, opts?)` (`:250`); store REST-helper pattern = `apps/web/src/store/search.ts` (thin wrapper, Zod-parses the response, "components never call directly").
- Store seam for annotations — `apps/web/src/store/routine.ts:238`:
  ```ts
  /** Routine-scoped annotations (US-039), tombstones dropped. */
  readAnnotations(): Annotation[];
  createAnnotation(input: {
    kind: AnnotationKind;
    text: string;
    anchors: Anchor[];
    tags?: string[];
  }): void;
  /** Append a reply to an annotation's thread (US-039). */
  addReply(annotationId: string, text: string): void;
  /** Soft-delete an annotation (US-039). */
  deleteAnnotation(annotationId: string): void;
  ```
  implemented via `routineConn.commit(addAnnotation(routineConn.current(), { authorId: currentUserId, ...input }))` (`:1114-1121`); `syncState(): SyncState` (`:133/:1241`, `"live"` once caught up) is the live-gate seam.
- Component test harness — `apps/web/src/test-support/render.tsx`: `renderUi`, re-exported Testing Library + `userEvent`, and `axeCheck(container: HTMLElement): Promise<AxeResults>` ("assert with toHaveNoViolations"); dynamic `importComponent` pattern per `annotations.test.tsx`. The compose surface is `apps/web/src/components/AnnotationPanel.tsx` (presentational, props `role/currentUserId/annotations/composeAnchor/…`; "only a commenter+ sees the compose box").
- E2E harness — `apps/web/e2e/support/`: `seedAuth(page: Page, userId: string)` + `gotoRoutine(page, routineId)` (`auth.ts`), `resetDb`/`seedDb(page, spec)` (`fixtures.ts` — SeedSpec seeds users/docs+sections/memberships/figures/placementEdges), `openTwoUsers(browser, a, b)` / `expectConverged(pages, …)` / `closeUsers` (`two-users.ts` — "No sleeps"; web-first assertions). CI runs the `@smoke` grep per PR (`playwright.config.ts:8`); conventions in `docs/system/testing.md`, coverage keys in `docs/TEST-MAP.md`.
- Contract pattern — `packages/contract/src/index.ts`: `zCreateRoutine`/`zFamilyNoteBody`/… Zod schemas + `z.infer` types; `zJournalEntry` (`:336`) is the Journal-card DTO the chip data rides on.

### Recorded idea-vs-code discrepancies (resolved here, flag in PR)

1. **"presigned PUT, browser→R2 direct" is unimplementable under the idea's own constraints.** Presigned R2 PUTs require the S3 API credential class the idea explicitly rejects for serving ("a new secret class in PROVISIONING.md"), and the local/E2E harness has no S3 endpoint. Resolution (now also folded into the idea doc, 2026-07-15): the minted `uploadUrl` is **worker-hosted** — `PUT /api/media/<objectKey>` on the same worker, authorized by the normal Bearer token, streaming `request.body` into the R2 binding. Same cost shape as the decided serving path (one worker request + one Class A op), zero new secrets, caps re-checkable at the byte boundary. **Corollary — the Workers request-body limit (~100 MB on this plan) is BELOW the 300 MB video cap**, so a single PUT cannot carry a max-size video: uploads above a `MEDIA_CAPS.singlePutMaxBytes` threshold (set it safely under the env's body limit, e.g. 90 MiB) use the **R2 multipart Workers API** through the same grant + authz gate — `POST /api/media/<objectKey>?action=mpu-create` (grant required, returns `uploadId`), `PUT ?action=mpu-uploadpart&uploadId=…&partNumber=…` (uniform parts ≥ 5 MiB, each under the body limit; cumulative bytes re-checked against the grant), `POST ?action=mpu-complete` (writes the `media_object` row live), `DELETE ?action=mpu-abort` on cancel. Incomplete MPUs auto-abort after 7 days (R2 default), which is the cleanup story for abandoned uploads; per-part upload is also what gives the in-app retry its resume points (<https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/>).
2. **`<img>`/`<video>` elements cannot send an `Authorization` header**, and native Range streaming (decided) requires element-src fetches. Resolution: the media GET routes accept the Clerk session JWT from the `Authorization` header **or the same-origin `__session` cookie** (Clerk's standard cookie; verified by the identical `authenticateToken` call). E2E's `seedAuth` is extended to also set that cookie. This is part of the hard-gated authz surface — review accordingly.
3. **Journal-card chips need index data**: `journal_entry` carries no media info. Resolution: the DO's journal projection additionally projects live media counts (`imageCount`, `videoCount` — YouTube counts as video) so Journal cards render the chip without reading CRDT.
4. **Cap scope**: the owner confirmed only "1 GB per **free** user". Until a pro cap is decided, the mint route applies the same 1 GB to every plan (conservative; one constant to change).
5. **Video duration is client-declared at mint** — server-side probing would need the transcoding pipeline the idea defers. Accepted; size caps are enforced on real bytes at the PUT.
6. Prototype's attach icons sit on the thread panel's single bottom compose row; since media is **not** allowed on replies, the shipped attach affordances live on the **annotation (note) composer** only — the reply row stays text-only.

---

### Task 1: Domain — `MediaItem` on `Annotation` + inline-token splitter + attach/tombstone ops

**Files:**
- Create: `packages/domain/src/media.ts`, `packages/domain/src/media.test.ts`
- Modify: `packages/domain/src/doc-types.ts` (MediaItem union, `Annotation.media?`), `packages/domain/src/doc-routine.ts` (`addAnnotation` input gains `media?`; `attachMedia`; `softDeleteMedia`), `packages/domain/src/index.ts` (exports)

**Interfaces produced:**
- `type MediaItem = UploadedMediaItem | YouTubeMediaItem` (discriminated on `type: "image" | "video" | "youtube"`)
- `mediaToken(mediaId: string): string` → `` `![media:${mediaId}]` ``
- `splitMediaParts(text: string, media?: MediaItem[]): MediaPart[]` — live → media part; tombstoned or unknown-id token → removed stub; unreferenced live items appended (nothing silently lost)
- `attachMedia(doc, annotationId, item)` / `softDeleteMedia(doc, annotationId, mediaId)`

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/media.test.ts
// docs/ideas/annotation-media-embeds.md — inline `![media:<id>]` tokens + CRDT
// semantics (append + tombstone list; the text field's merge behavior untouched).
import { describe, expect, it } from "vitest";
import { applyMutations, exchangeAndAssertConverged } from "./__fixtures__";
import { addAnnotation, attachMedia, buildRoutineDoc, readRoutine, softDeleteMedia } from "./doc-routine";
import type { MediaItem, RoutineDoc } from "./doc-types";
import { mediaToken, splitMediaParts } from "./media";

const img = (id: string, deletedAt?: number): MediaItem => ({
  id,
  type: "image",
  objectKey: `media/r1/a1/${id}`,
  mimeType: "image/jpeg",
  sizeBytes: 1000,
  createdAt: 1,
  ...(deletedAt !== undefined ? { deletedAt } : {}),
});
const yt = (id: string): MediaItem => ({
  id, type: "youtube", videoId: "dQw4w9WgXcQ", url: "https://youtu.be/dQw4w9WgXcQ", createdAt: 1,
});

describe("splitMediaParts", () => {
  it("renders a live item inline at its token position", () => {
    const parts = splitMediaParts(`watch ${mediaToken("m1")} then compare`, [img("m1")]);
    expect(parts).toEqual([
      { kind: "text", text: "watch " },
      { kind: "media", item: img("m1") },
      { kind: "text", text: " then compare" },
    ]);
  });
  it("renders a tombstoned item as a removed stub", () => {
    const parts = splitMediaParts(mediaToken("m1"), [img("m1", 99)]);
    expect(parts).toEqual([{ kind: "removed", mediaId: "m1" }]);
  });
  it("renders a token referencing no item as a removed stub (hand-typed token)", () => {
    expect(splitMediaParts(mediaToken("nope"), [])).toEqual([{ kind: "removed", mediaId: "nope" }]);
  });
  it("appends a live item referenced nowhere (concurrent text edit ate the token)", () => {
    expect(splitMediaParts("plain text", [yt("m2")])).toEqual([
      { kind: "text", text: "plain text" },
      { kind: "media", item: yt("m2") },
    ]);
  });
  it("is a single text part when there is no media at all (lenient: media undefined)", () => {
    expect(splitMediaParts("no media here", undefined)).toEqual([
      { kind: "text", text: "no media here" },
    ]);
  });
});

describe("attachMedia / softDeleteMedia CRDT semantics", () => {
  const base = (): RoutineDoc => ({
    id: "r1", title: "T", dance: "waltz", ownerId: "u1",
    sections: [], annotations: [], schemaVersion: 1, deletedAt: null,
  });
  const withAnnotation = () =>
    addAnnotation(buildRoutineDoc(base()), {
      authorId: "u1", kind: "note", text: "keep the head left", anchors: [],
    });

  it("concurrent attach vs text edit: both survive the merge", async () => {
    const doc = withAnnotation();
    const annId = readRoutine(doc).annotations[0]?.id ?? "";
    const left = attachMedia(doc, annId, img("m1"));
    const right = await applyMutations(doc, [
      (d) => {
        const a = d.annotations.find((x) => x.id === annId);
        if (a) a.text = `edited ${mediaToken("m1")}`;
      },
    ]);
    const { converged } = await exchangeAndAssertConverged(left, right);
    const ann = readRoutine(converged).annotations[0];
    expect(ann?.text).toContain("edited");
    expect(ann?.media?.map((m) => m.id)).toEqual(["m1"]);
  });

  it("concurrent attach vs annotation tombstone: converges, tombstone + media both present", async () => {
    const doc = withAnnotation();
    const annId = readRoutine(doc).annotations[0]?.id ?? "";
    const left = attachMedia(doc, annId, img("m1"));
    const right = await applyMutations(doc, [
      (d) => {
        const a = d.annotations.find((x) => x.id === annId);
        if (a) a.deletedAt = 42;
      },
    ]);
    const { converged } = await exchangeAndAssertConverged(left, right);
    const ann = readRoutine(converged, { includeDeleted: true }).annotations[0];
    expect(ann?.deletedAt).toBe(42);
    expect(ann?.media).toHaveLength(1); // media survives for undo/restore
  });

  it("concurrent attach vs media tombstone on another item: both effects land", async () => {
    const doc = attachMedia(
      withAnnotation(),
      readRoutine(withAnnotation()).annotations[0]?.id ?? "", // NOTE: implementer — bind annId once, see Step 3
      img("m1"),
    );
    // (Implementer: restructure as annId-bound like the tests above; asserted
    // outcome: converged doc has m1.deletedAt set AND m2 present live.)
  });

  it("soft-deletes only (no hard removal), and tombstoned media is readable via includeDeleted", async () => {
    const doc = withAnnotation();
    const annId = readRoutine(doc).annotations[0]?.id ?? "";
    const gone = softDeleteMedia(attachMedia(doc, annId, img("m1")), annId, "m1");
    const ann = readRoutine(gone).annotations[0];
    expect(ann?.media?.[0]?.deletedAt).toEqual(expect.any(Number));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @weavesteps/domain exec vitest run media` → FAIL ("Cannot find module './media'").

- [ ] **Step 3: Implement**

`doc-types.ts` — add next to `Annotation` (all optionals genuinely optional: builders use conditional spreads, NEVER `undefined` assignment — Automerge rejects it):

```ts
/** docs/ideas/annotation-media-embeds.md — media embedded inline in an
 *  annotation's text by `![media:<id>]` tokens. Client-ULID ids, soft-delete
 *  only; `objectKey` is `media/<docRef>/<annotationId>/<mediaId>` so the
 *  worker's serving authz derives from the key alone. */
export type UploadedMediaItem = {
  id: string;
  type: "image" | "video";
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  /** objectKey of the client-captured poster frame (videos). */
  posterKey?: string;
  createdAt: number;
  deletedAt?: number | null;
};
export type YouTubeMediaItem = {
  id: string;
  type: "youtube";
  videoId: string;
  /** The pasted URL, kept as provenance. */
  url: string;
  createdAt: number;
  deletedAt?: number | null;
};
export type MediaItem = UploadedMediaItem | YouTubeMediaItem;
```

and on `Annotation`: `media?: MediaItem[];` (optional ⇒ lenient reads — the v1 corpus keeps parsing, no migration step, old readers ignore it).

`media.ts`:

```ts
import type { MediaItem } from "./doc-types";

export type MediaPart =
  | { kind: "text"; text: string }
  | { kind: "media"; item: MediaItem }
  | { kind: "removed"; mediaId: string };

export const mediaToken = (mediaId: string): string => `![media:${mediaId}]`;

const TOKEN_RE = /!\[media:([A-Za-z0-9]+)\]/g;

/** Split an annotation's plain text into ordered text/media parts.
 *  Live item → embed; tombstoned or unknown id → "removed" stub; a live item
 *  referenced nowhere (concurrent text edits) is appended — nothing lost. */
export function splitMediaParts(text: string, media?: MediaItem[]): MediaPart[] {
  const byId = new Map((media ?? []).map((m) => [m.id, m]));
  const referenced = new Set<string>();
  const parts: MediaPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[0];
    const id = match[1];
    if (id === undefined) continue;
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    last = match.index + token.length;
    referenced.add(id);
    const item = byId.get(id);
    if (item && item.deletedAt == null) parts.push({ kind: "media", item });
    else parts.push({ kind: "removed", mediaId: id });
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  for (const item of media ?? []) {
    if (!referenced.has(item.id) && item.deletedAt == null) parts.push({ kind: "media", item });
  }
  return parts;
}
```

`doc-routine.ts` — mirror `addReply`/`softDeleteReply`:

```ts
/** Attach a media item to an annotation (docs/ideas/annotation-media-embeds.md).
 *  Plain list append — the commenter DO gate treats it as an annotation field. */
export function attachMedia(
  doc: A.Doc<RoutineDoc>,
  annotationId: string,
  item: MediaItem,
): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    const annotation = draft.annotations.find((a) => a.id === annotationId);
    if (!annotation) return;
    if (!annotation.media) annotation.media = [];
    annotation.media.push(item);
  });
}

/** Soft-delete a media item: tombstone flip only (undo restores; R2 object kept). */
export function softDeleteMedia(
  doc: A.Doc<RoutineDoc>,
  annotationId: string,
  mediaId: string,
): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    const media = draft.annotations.find((a) => a.id === annotationId)?.media;
    const item = media?.find((m) => m.id === mediaId);
    if (item) item.deletedAt = Date.now();
  });
}
```

Extend `addAnnotation`'s input with `media?: MediaItem[]` (pushed only when present — no `undefined`). Export `MediaItem`, `UploadedMediaItem`, `YouTubeMediaItem`, `MediaPart`, `mediaToken`, `splitMediaParts`, `attachMedia`, `softDeleteMedia` from `index.ts` (alphabetical with neighbors). Also verify `readRoutine` passes `media` through untouched (it spreads the annotation — tombstoned media must stay visible to the renderer for the removed stub; add an assertion to the existing `doc-routine.test.ts` reads if not covered by Step 1).

- [ ] **Step 4: Verify** — `pnpm --filter @weavesteps/domain exec vitest run media doc-routine && pnpm -w typecheck && pnpm -w lint`
- [ ] **Step 5: Commit** — `git commit -m "feat(domain): MediaItem on Annotation + inline media token splitter"`

---

### Task 2: Contract — upload-mint schemas + media caps constants

**Files:**
- Modify: `packages/contract/src/index.ts`, `packages/contract/src/index.test.ts`

- [ ] **Step 1: Write the failing test** (append to `index.test.ts`, matching its existing parse-style tests):

```ts
describe("media upload mint contract (docs/ideas/annotation-media-embeds.md)", () => {
  it("accepts a valid image mint request and rejects an over-cap one at the schema", () => {
    const ok = zMintMediaUpload.safeParse({
      annotationId: "01ANN", mediaId: "01MED", type: "image",
      mimeType: "image/jpeg", sizeBytes: 1024,
    });
    expect(ok.success).toBe(true);
    expect(zMintMediaUpload.safeParse({ annotationId: "01ANN", mediaId: "01MED", type: "image", mimeType: "image/jpeg", sizeBytes: 0 }).success).toBe(false);
  });
  it("carries the owner-confirmed caps", () => {
    expect(MEDIA_CAPS.imageMaxBytes).toBe(10 * 1024 * 1024);
    expect(MEDIA_CAPS.videoMaxBytes).toBe(300 * 1024 * 1024);
    expect(MEDIA_CAPS.videoMaxSeconds).toBe(180);
    expect(MEDIA_CAPS.itemsPerAnnotation).toBe(4);
    expect(MEDIA_CAPS.freeUserTotalBytes).toBe(1024 * 1024 * 1024);
  });
  it("round-trips the mint response", () => {
    const res = zMintMediaUploadResponse.parse({
      objectKey: "media/r/a/m", uploadUrl: "/api/media/media/r/a/m", maxBytes: 1024,
    });
    expect(res.uploadUrl.startsWith("/api/media/")).toBe(true);
  });
});
```

- [ ] **Step 2: Verify it fails** — `pnpm --filter @weavesteps/contract exec vitest run` → FAIL.
- [ ] **Step 3: Implement** in `index.ts` (near the other route DTOs):

```ts
/** Media caps — owner-confirmed 2026-07-15 (docs/ideas/annotation-media-embeds.md
 *  § Caps): image ≤ 10 MB pre-compression, video ≤ 3 min & ≤ 300 MB, ≤ 4 items
 *  per annotation, 1 GB total per free user. Enforced at upload-URL mint. */
export const MEDIA_CAPS = {
  imageMaxBytes: 10 * 1024 * 1024,
  videoMaxBytes: 300 * 1024 * 1024,
  videoMaxSeconds: 180,
  itemsPerAnnotation: 4,
  freeUserTotalBytes: 1024 * 1024 * 1024,
} as const;

/** POST /api/docs/:id/media/upload-url body. Ids are client ULIDs; `poster`
 *  marks a video's poster-frame object (excluded from the 4-item count, bytes
 *  still counted). Duration is client-declared (no server probing — see plan). */
export const zMintMediaUpload = z.object({
  annotationId: z.string().min(1),
  mediaId: z.string().min(1),
  type: z.enum(["image", "video"]),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  durationSeconds: z.number().positive().optional(),
  poster: z.boolean().optional(),
});
export type MintMediaUpload = z.infer<typeof zMintMediaUpload>;

export const zMintMediaUploadResponse = z.object({
  objectKey: z.string().min(1),
  uploadUrl: z.string().min(1),
  maxBytes: z.number().int().positive(),
});
export type MintMediaUploadResponse = z.infer<typeof zMintMediaUploadResponse>;
```

Also extend `zJournalEntry` with `imageCount: z.number().int().nonnegative().optional()` and `videoCount: z.number().int().nonnegative().optional()` (the Journal-card chip data — discrepancy note 3; optional ⇒ old workers keep validating).

- [ ] **Step 4: Verify** — `pnpm --filter @weavesteps/contract exec vitest run && pnpm -w typecheck`
- [ ] **Step 5: Commit** — `git commit -m "feat(contract): media upload mint schemas + owner-confirmed caps"`

---

### Task 3: Worker — R2 binding, `media_object` index, upload-URL mint + upload PUT (caps + authz at mint)

**Files:**
- Create: `apps/worker/migrations/0019_media_object.sql`, `apps/worker/src/db/media.ts`, `apps/worker/src/routes/media.test.ts`, `apps/worker/src/media-key.ts`
- Modify: `apps/worker/wrangler.toml` (R2 binding ×4 envs), `apps/worker/src/index.ts` (`Env.MEDIA`, the two routes), `apps/worker/src/db/schema.ts` (Drizzle mirror), `apps/worker/src/doc-do.ts` + `apps/worker/src/db/journal.ts` (journal projection media counts)

- [ ] **Step 1: Write the failing tests** — `apps/worker/src/routes/media.test.ts`, mirroring `routes/share.test.ts`/`quota.test.ts` structure (`beforeAll`: `applyMigrations()`, `generateTestKeypair()`, `seedDb` with one routine doc `docRef: "r_media"` owned by `u_owner`, memberships: `u_viewer` viewer / `u_comm` commenter, plus `u_outsider` with no row; `authedContext` per actor):

```ts
// Mint authz — the caps + membership gate (docs/ideas/annotation-media-embeds.md § Test plan).
const mint = (ctx: AuthedContext, body: unknown) =>
  SELF.fetch("https://x/api/docs/r_media/media/upload-url", {
    method: "POST",
    headers: { ...ctx.authHeaders(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const imageBody = (mediaId: string, sizeBytes = 1024) => ({
  annotationId: "01ANN", mediaId, type: "image", mimeType: "image/jpeg", sizeBytes,
});

it("403s a non-member and a viewer; 401s no token", …);           // outsider 403, viewer 403 (commenter+ only)
it("mints for a commenter: objectKey is media/<docRef>/<annotationId>/<mediaId>", …);
//   expect body.objectKey === "media/r_media/01ANN/01MED1"; body.uploadUrl === `/api/media/${body.objectKey}`
it("rejects an over-cap image (> 10 MB) and an over-cap video (> 300 MB or > 180 s) with 413", …);
it("rejects the 5th item on one annotation with 409 (posters excluded from the count)", …);
it("rejects a mint that would exceed the 1 GB total with 402", …); // seed usage near cap via 3×300MB video mints
it("PUT streams the body into R2 under the minted key; content-length above the grant is 413", async () => {
  // mint 1KiB grant → PUT 1KiB Uint8Array with commenter auth → 200; then
  // await env.MEDIA.get(objectKey) — non-null, size 1024. A 2KiB body → 413.
});
it("PUT by a non-member / another user is 403 even with a valid grant", …);
// Multipart (videos above singlePutMaxBytes — the Workers body limit sits below the
// 300 MB cap; discrepancy note 1): same grant + same authz on EVERY subroute.
it("mpu-create requires a grant (404 without one) and the grant's owner (403 otherwise)", …);
it("mpu-uploadpart rejects a part below 5 MiB (except the last) and cumulative bytes over the grant (413)", …);
it("mpu-complete assembles the object under the minted key and marks the media_object row live; the parts round-trip via env.MEDIA.get", …);
it("mpu-abort tombstones the pending row; completing an aborted upload is a 400", …);
it("counter reads are indexed", async () => {
  await expectIndexedQuery(env.DB,
    "SELECT COUNT(*) AS n FROM media_object WHERE docRef = ? AND annotationId = ? AND poster = 0 AND deletedAt IS NULL",
    ["r_media", "01ANN"]);
  await expectIndexedQuery(env.DB,
    "SELECT COALESCE(SUM(bytes), 0) AS used FROM media_object WHERE userId = ? AND deletedAt IS NULL",
    ["u_comm"]);
});
it("a commenter's DO change that attaches media to ANOTHER author's annotation is refused",
  …); // drives the existing doc-do commenter gate with a media-only change frame — proves author-only modification
```

- [ ] **Step 2: Verify RED** — `pnpm --filter worker exec vitest run media` → FAIL (route 404, table missing).

- [ ] **Step 3: Implement**

`migrations/0019_media_object.sql` — pure index, no CRDT content, soft-delete only:

```sql
-- docs/ideas/annotation-media-embeds.md — upload-grant + usage counter for the
-- media caps (enforced at mint). One row per minted R2 object; bytes = the
-- declared (granted) size, re-checked against Content-Length at the PUT.
-- Soft-delete only; R2 GC is deferred debt.
CREATE TABLE IF NOT EXISTS media_object (
  objectKey    TEXT PRIMARY KEY,       -- media/<docRef>/<annotationId>/<mediaId>
  docRef       TEXT NOT NULL,
  annotationId TEXT NOT NULL,
  userId       TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  poster       INTEGER NOT NULL DEFAULT 0,
  createdAt    INTEGER NOT NULL,
  deletedAt    INTEGER
);
CREATE INDEX IF NOT EXISTS media_object_annotation_idx ON media_object (docRef, annotationId);
CREATE INDEX IF NOT EXISTS media_object_user_idx ON media_object (userId);
-- Journal-card media chip (plan discrepancy note 3): projected live media counts.
ALTER TABLE journal_entry ADD COLUMN imageCount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE journal_entry ADD COLUMN videoCount INTEGER NOT NULL DEFAULT 0;
```

`db/media.ts` — raw-SQL module in the `db/journal.ts` style: `insertMediaObject(db, row)`, `mediaObjectFor(db, objectKey): Promise<{ userId: string; bytes: number } | null>`, `annotationMediaCount(db, docRef, annotationId): Promise<number>` (poster-excluded, tombstone-excluded), `userMediaBytes(db, userId): Promise<number>` — the exact SQL strings asserted by `expectIndexedQuery` above. Mirror the table in `db/schema.ts` (Drizzle, for the reset/seed path, like `libraryEntry`).

`wrangler.toml` — default section:

```toml
# docs/ideas/annotation-media-embeds.md — the first binary storage: one R2
# bucket per env. Keys: media/<docRef>/<annotationId>/<mediaId> (authz derives
# from the key alone). Bindings are NOT inherited — redeclared per env below.
[[r2_buckets]]
binding = "MEDIA"
bucket_name = "weave-steps-media-dev"
```

plus `[[env.e2e.r2_buckets]]` (`weave-steps-media-e2e`), `[[env.staging.r2_buckets]]` (`weave-steps-media-staging`), `[[env.production.r2_buckets]]` (`weave-steps-media-production`). Miniflare simulates the default binding for vitest + `wrangler dev`; the real staging/production buckets are a PROVISIONING.md action (Task 7).

`index.ts` — `Env` gains `MEDIA: R2Bucket;` (documented: "first binary storage; serving is stream-through — docs/system/architecture.md"). New `media-key.ts`:

```ts
/** Parse + validate a media object key. The key IS the authorization scope:
 *  media/<docRef>/<annotationId>/<mediaId> — exactly 4 slash-free segments
 *  under the media/ namespace; anything else is not-found. */
export function parseMediaKey(objectKey: string): { docRef: string; annotationId: string; mediaId: string } | null {
  const m = /^media\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(objectKey);
  return m?.[1] && m[2] && m[3] ? { docRef: m[1], annotationId: m[2], mediaId: m[3] } : null;
}
```

Routes (registered with the other `/api/docs/:id/*` routes; auth via `authenticate`, gate via `resolveEffectiveRole` + `can(role, "canAnnotate")` — the family-notes pattern):

```ts
// Mint an upload grant: commenter+ AND caps enforced HERE (idea § Caps, FINAL).
app.post("/api/docs/:id/media/upload-url", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const docRef = c.req.param("id");
  const role = await resolveEffectiveRole(c.env.DB, docRef, user.sub);
  if (!role || !can(role, "canAnnotate")) return c.json({ error: "forbidden" }, 403);
  const parsed = zMintMediaUpload.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  const { annotationId, mediaId, type, sizeBytes, durationSeconds, poster } = parsed.data;
  if (type === "image" && sizeBytes > MEDIA_CAPS.imageMaxBytes)
    return c.json({ error: "image exceeds 10 MB" }, 413);
  if (type === "video" && (sizeBytes > MEDIA_CAPS.videoMaxBytes || (durationSeconds ?? 0) > MEDIA_CAPS.videoMaxSeconds))
    return c.json({ error: "video exceeds 3 min / 300 MB" }, 413);
  if (!poster && (await annotationMediaCount(c.env.DB, docRef, annotationId)) >= MEDIA_CAPS.itemsPerAnnotation)
    return c.json({ error: "media cap reached (4 per note)" }, 409);
  // 1 GB total (owner-confirmed for free; applied to every plan until a pro cap exists).
  if ((await userMediaBytes(c.env.DB, user.sub)) + sizeBytes > MEDIA_CAPS.freeUserTotalBytes)
    return c.json({ error: "storage quota exceeded" }, 402);
  const objectKey = `media/${docRef}/${annotationId}/${mediaId}`;
  await insertMediaObject(c.env.DB, { objectKey, docRef, annotationId, userId: user.sub, bytes: sizeBytes, poster: poster === true });
  return c.json({ objectKey, uploadUrl: `/api/media/${objectKey}`, maxBytes: sizeBytes });
});

// Upload: worker-hosted PUT streaming into the R2 binding (plan discrepancy
// note 1 — presigned browser→R2 PUTs would need the rejected S3 secret class).
app.put("/api/media/*", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const objectKey = decodeURIComponent(new URL(c.req.url).pathname.slice("/api/media/".length));
  const key = parseMediaKey(objectKey);
  if (!key) return c.json({ error: "not found" }, 404);
  const grant = await mediaObjectFor(c.env.DB, objectKey);
  if (!grant || grant.userId !== user.sub) return c.json({ error: "forbidden" }, 403);
  const role = await resolveEffectiveRole(c.env.DB, key.docRef, user.sub);
  if (!role || !can(role, "canAnnotate")) return c.json({ error: "forbidden" }, 403);
  const declared = Number(c.req.header("content-length"));
  if (!Number.isFinite(declared) || declared <= 0 || declared > grant.bytes)
    return c.json({ error: "body exceeds granted size" }, 413);
  const body = c.req.raw.body;
  if (body === null) return c.json({ error: "empty body" }, 400);
  await c.env.MEDIA.put(objectKey, body, {
    httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" },
  });
  return c.json({ objectKey });
});
```

Multipart subroutes (discrepancy note 1 — required for videos above `MEDIA_CAPS.singlePutMaxBytes`, since the Workers body limit is below the 300 MB cap). Same path, dispatched on `?action=`; every subroute repeats the FULL grant + role gate above (never trust the `uploadId` alone):

```ts
// POST ?action=mpu-create   → { uploadId } via c.env.MEDIA.createMultipartUpload(objectKey)
// PUT  ?action=mpu-uploadpart&uploadId&partNumber
//        → parts must be uniform and ≥ 5 MiB (except last); track cumulative bytes on the
//          media_object row and 413 past the grant; returns the R2UploadedPart JSON.
// POST ?action=mpu-complete → upload.complete(parts) — marks the media_object row live.
// DELETE ?action=mpu-abort  → upload.abort() + tombstone the pending row.
// (R2 auto-aborts incomplete MPUs after 7 days — the abandoned-upload cleanup story.)
```

Journal projection (`doc-do.ts` `projectJournalEntries` call path + `db/journal.ts`): when projecting a lesson/practice annotation, also write `imageCount` / `videoCount` = counts of live (`deletedAt == null`) media by type (`youtube` counts as video); surface both in `journalForUser` and the `/api/journal` DTO. Add one worker test in the existing journal projection suite (parity + tombstone flips a count down).

- [ ] **Step 4: Verify** — `pnpm --filter worker exec vitest run media journal && pnpm -w typecheck && pnpm -w lint`, then the full worker suite once: `pnpm --filter worker exec vitest run`.
- [ ] **Step 5: Commit** — `git commit -m "feat(worker): R2 media bucket + upload-URL mint with caps at the boundary"`

---

### Task 4: Worker — membership-gated serving (stream-through + Range) + YouTube thumb proxy

**Files:**
- Create: `apps/worker/src/media-range.ts`, `apps/worker/src/media-range.test.ts`, `apps/worker/src/youtube-thumb.ts`
- Modify: `apps/worker/src/index.ts` (the two GET routes), `apps/worker/src/routes/media.test.ts` (serve-path authz tests)

- [ ] **Step 1: Write the failing tests**

`media-range.test.ts` (pure unit): `parseRange(undefined, 100) → null`; `"bytes=0-3" → { offset: 0, length: 4 }`; `"bytes=4-" → { offset: 4 }`; `"bytes=-5" → { suffix: 5 }`; garbage → `null` (serve full); `"bytes=200-"` with size 100 → `"unsatisfiable"`.

Append to `routes/media.test.ts` (arrange: commenter mints + PUTs a 10-byte body `0123456789` under `media/r_media/01ANN/01SRV`):

```ts
it("streams the object to any member (viewer 200, owner 200) and 403s a non-member", …);
it("honors Range: bytes=0-3 → 206, Content-Range bytes 0-3/10, body '0123'", …);
it("Range: bytes=4- → 206 with the tail; unsatisfiable range → 416", …);
it("serves a TOMBSTONED item's object to members unchanged (no CRDT check on the read path — undo must restore it)", …);
it("404s a key outside the media/ namespace and a malformed key", …);
it("youtube-thumb: 401 unauthenticated; 403 non-member of ?docRef; 400 bad videoId", …);
it("youtube-thumb: streams the upstream jpg with a long-lived Cache-Control", async () => {
  // Unit-test the seam directly (repo pattern: vi.spyOn(globalThis, "fetch") —
  // vitest-pool-workers 4.x removed fetchMock; see ops.test.ts:56):
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Uint8Array([0xff, 0xd8]), { status: 200, headers: { "content-type": "image/jpeg" } }),
  );
  const { fetchYoutubeThumb } = await import("../youtube-thumb");
  const res = await fetchYoutubeThumb("dQw4w9WgXcQ");
  expect(fetchSpy).toHaveBeenCalledWith("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  expect(res.headers.get("cache-control")).toBe("public, max-age=604800, immutable");
});
```

- [ ] **Step 2: Verify RED** — `pnpm --filter worker exec vitest run media` → new tests FAIL.

- [ ] **Step 3: Implement**

`media-range.ts` — `parseRange(header: string | undefined, size: number): R2Range | null | "unsatisfiable"` per the unit tests (single-range `bytes=` forms only; multi-range and garbage → `null` = serve full).

`youtube-thumb.ts`:

```ts
/** Worker-proxied facade thumbnail (decided 2026-07-15): the reader's browser
 *  only ever talks to the app; the worker fetches i.ytimg.com server-side. */
export const YT_VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
export async function fetchYoutubeThumb(videoId: string): Promise<Response> {
  const upstream = await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  if (!upstream.ok) return Response.json({ error: "unavailable" }, { status: 502 });
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}
```

`index.ts` — media reads must work from `<img>`/`<video>` element requests, which cannot carry a Bearer header (discrepancy note 2). One small documented helper, used by BOTH GET routes:

```ts
/** Authenticate a MEDIA READ: the Authorization header when present, else the
 *  same-origin Clerk `__session` cookie (the same JWT, same verifier) — element
 *  src fetches (<img>/<video> Range requests) can't send Bearer headers.
 *  Part of the hard-gated authz surface: verification is authenticateToken in
 *  both arms, nothing weaker. */
async function authenticateMediaRead(c: Context<{ Bindings: Env }>): Promise<AuthedUser | null> {
  const viaHeader = await authenticate(c);
  if (viaHeader) return viaHeader;
  const session = getCookie(c, "__session"); // hono/cookie
  return session ? authenticateToken(`Bearer ${session}`, c.env) : null;
}
```

Register the thumb route BEFORE the wildcard:

```ts
// Facade thumbnail — viewer+ of ?docRef (same membership gate as the media).
app.get("/api/media/youtube-thumb/:videoId", async (c) => {
  const user = await authenticateMediaRead(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const videoId = c.req.param("videoId");
  const docRef = c.req.query("docRef");
  if (!docRef || !YT_VIDEO_ID_RE.test(videoId)) return c.json({ error: "invalid" }, 400);
  const role = await resolveEffectiveRole(c.env.DB, docRef, user.sub);
  if (!role) return c.json({ error: "forbidden" }, 403);
  return fetchYoutubeThumb(videoId);
});

// Serving: stream-through from the R2 binding with Range support (FINAL —
// rejected alternative: 302-to-signed-URL; see the idea's Alternatives).
// Membership (viewer+) derives from the docRef IN THE KEY PREFIX alone.
app.get("/api/media/*", async (c) => {
  const user = await authenticateMediaRead(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const objectKey = decodeURIComponent(new URL(c.req.url).pathname.slice("/api/media/".length));
  const key = parseMediaKey(objectKey);
  if (!key) return c.json({ error: "not found" }, 404);
  const role = await resolveEffectiveRole(c.env.DB, key.docRef, user.sub);
  if (!role) return c.json({ error: "forbidden" }, 403);
  const head = await c.env.MEDIA.head(objectKey);
  if (head === null) return c.json({ error: "not found" }, 404);
  const range = parseRange(c.req.header("Range"), head.size);
  if (range === "unsatisfiable")
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${head.size}` } });
  const obj = await c.env.MEDIA.get(objectKey, range ? { range } : undefined);
  if (obj === null || !("body" in obj)) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  if (range) {
    const { offset, length } = resolveRange(range, head.size); // small helper: offset/length/suffix → absolute
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${head.size}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(head.size));
  return new Response(obj.body, { status: 200, headers });
});
```

(Implementer: verify the exact `R2ObjectBody`/`R2Range` shapes against the pinned `@cloudflare/workers-types` — no casts; `head()` gives the total size that suffix ranges and `Content-Range` need.)

- [ ] **Step 4: Verify** — `pnpm --filter worker exec vitest run media media-range && pnpm --filter worker exec vitest run && pnpm -w typecheck && pnpm -w lint`
- [ ] **Step 5: Commit** — `git commit -m "feat(worker): membership-gated media serving (stream-through + Range) and YouTube thumb proxy"`

---

### Task 5: Web — store seam, compression/poster capture, compose + inline embeds + chips (prototype parity)

**Design source (recreate pixel-for-pixel):** `docs/design/project/Ballroom Builder v3.dc.html` — search `onAttachPhoto` / `onAttachVideo` / `onAttachYt` (compose-row attach icons, line ~566), `replyHasMedia` (pending chip + "lands inline, right where your text ends", ~559), the thread `c.parts` loop (~525-556: `p.isText` / `p.isPhoto` / `p.isVideo` / `p.isYt` "tap to load · YouTube" facade / `p.isGone` "media removed — undo restores it" dashed stub), and `mediaLabel` (margin cells ~150/181, Journal cards ~623 — the compact `⏵2 ▣1`-style chip; `f1|2` seeds the coach scenario, `f7|3` the removed stub). Attach affordances go on the **note composer** (no media on replies — discrepancy note 6). The Journal entry editor's affordances stay "coming soon".

**Files:**
- Create: `apps/web/src/store/media.ts` (+ `media.test.ts`), `apps/web/src/lib/media-files.ts` (+ test), `apps/web/src/components/MediaParts.tsx`, `apps/web/src/components/annotation-media.test.tsx`, `apps/web/src/ui/MediaChip.tsx`
- Modify: `apps/web/src/lib/rpc.ts` (`apiPutBlob`), `apps/web/src/store/routine.ts` (interface + impl), `apps/web/src/components/AnnotationPanel.tsx` (composer attach + inline parts), `apps/web/src/components/RoutineReadingView.tsx` (margin chip), the Journal card component (chip from `imageCount`/`videoCount`)

- [ ] **Step 1: Write the failing tests** — `annotation-media.test.tsx` (renderUi/importComponent/axeCheck harness, per `annotations.test.tsx`):

  1. **Compose**: as `role="commenter"` with a live sync state, the note composer shows photo/video/YouTube attach buttons; attaching (mock the store handler props) shows the pending chip with a clear (`✕`) affordance; as `role="viewer"` no attach affordances exist. Composer submit passes `media` + token-bearing text to `onCreate`.
  2. **Inline render**: an annotation whose text is `` `watch ${mediaToken("m1")} compare ${mediaToken("m2")}` `` with an image `m1` + youtube `m2` renders, in order: text, `<img>` with `src="/api/media/media/r1/a1/m1"`, text, the facade. **The facade makes no external request until tap**: before click there is NO `iframe` and every `img[src]` in the panel points at a same-origin `/api/media/...` path (the worker-proxied thumb `/api/media/youtube-thumb/<id>?docRef=...`); after `userEvent.click` the `iframe[src]` matches `https://www.youtube-nocookie.com/embed/<videoId>`.
  3. **Removed stub**: a tombstoned item's token renders the dashed "media removed — undo restores it" stub, no `img`/`video`.
  4. **Video**: renders poster `<img>` (posterKey URL) + play affordance; after tap a `<video controls src="/api/media/...">` element exists (native Range streaming — no blob download).
  5. **Margin renders chip, never media elements**: the reading-view margin cell for a noted figure shows the `MediaChip` label (e.g. `⏵2 ▣1`) and `container.querySelectorAll("img, video, iframe")` within the margin is EMPTY. Same assertion for a Journal card fed `imageCount/videoCount`.
  6. **axe**: `axeCheck` on the open thread with all four part kinds → no violations (attach buttons and facade are labelled buttons, images carry alt text).

  Plus `store/media.test.ts` (mock `fetch` like `search.test.ts`): `mintMediaUpload` POSTs the contract body with `Authorization: Bearer …` and Zod-parses the response; `uploadMedia` PUTs the blob with its content type. And `lib/media-files` unit tests: `youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")` / watch-URL / garbage → null; `compressImage` targets ≤ ~2 MB and max dimension (jsdom: test the pure decision helpers, not canvas itself).

- [ ] **Step 2: Verify RED** — `pnpm --filter web exec vitest run annotation-media media`.

- [ ] **Step 3: Implement**

  - `lib/rpc.ts`: `apiPutBlob(path: string, token: string | null, blob: Blob, contentType: string): Promise<void>` — a PUT arm of the existing `resilientFetch` (no retries — mutations are never re-sent).
  - `store/media.ts` (the `search.ts` pattern): `mintMediaUpload(token, docRef, req: MintMediaUpload, baseUrl = "")` → `zMintMediaUploadResponse.parse(...)`; `uploadMedia(token, uploadUrl, blob, mimeType)` — single PUT for blobs ≤ `MEDIA_CAPS.singlePutMaxBytes`, else the multipart flow (mpu-create → slice the blob into uniform parts (e.g. 32 MiB, ≥ 5 MiB) → uploadpart sequentially with per-part retry → mpu-complete; abort on cancel). The per-part boundary IS the in-app retry resume point.
  - `lib/media-files.ts`: `compressImage(file: File): Promise<{ blob: Blob; width: number; height: number }>` (createImageBitmap → canvas, target ~2 MB / bounded max edge; the ≤ 10 MB cap is checked pre-compression), `captureVideoPoster(file: File): Promise<Blob>` (video element seek → canvas frame), `videoDurationSeconds(file: File): Promise<number>`, `youtubeVideoId(url: string): string | null`.
  - `store/routine.ts`: `createAnnotation` input gains `media?: MediaItem[]`; new `attachMedia(annotationId: string, item: MediaItem): void` and `removeMedia(annotationId: string, mediaId: string): void` committing the Task 1 domain ops through `routineConn`. Attaching is **live-gated** (`syncState() === "live"` — uploads are server-minting; note text editing stays offline-capable). Upload retry is **in-app**: the composer keeps the failed pending item (mint response + blob) and re-PUTs on tap — no Background Sync (iOS Safari lacks it).
  - `components/MediaParts.tsx`: renders `splitMediaParts(annotation.text, annotation.media)` — text spans; photo block (prototype ~532: rounded, bordered, `▣ <label>` caption bar); video block (~539: dark gradient, centered play ring, duration badge → swaps to `<video controls>` on tap); YouTube facade (~544: dark block, red play chip, title row + "tap to load · YouTube" — thumb `<img>` from `/api/media/youtube-thumb/<videoId>?docRef=...` with a neutral `onerror` fallback; the `youtube-nocookie.com` iframe is created ONLY on explicit tap); removed stub (~551: `border:1.5px dashed`, "media removed — undo restores it").
  - `AnnotationPanel.tsx`: composer attach icons (photo/video/YouTube — the three SVGs at prototype ~566-568, 44px touch targets via `ui` primitives), hidden file inputs, pending chips row (prototype ~559-563 incl. the "lands inline, right where your text ends" helper text). Attach flow: pick file → compress/capture poster → `mintMediaUpload` (+ poster mint with `poster: true`) → `uploadMedia` → append `mediaToken(mediaId)` to the draft text + hold the `MediaItem` (built with conditional spreads — no `undefined` keys); Create passes `{ …, media }`. Paste/enter a YouTube URL → `youtubeVideoId` → token + `{ type: "youtube" }` item (no upload). Author-only remove (`removeMedia`) on own annotations.
  - `ui/MediaChip.tsx` + `mediaChipLabel(counts: { images: number; videos: number }): string` (`▣n` images, `⏵n` videos+youtube — prototype chip styling at ~150). Wire into the reading-view margin (derived client-side from the routine doc's annotations) and Journal cards (from the projected `imageCount`/`videoCount`). Compact surfaces render the chip ONLY — never an img/video/iframe.

- [ ] **Step 4: Verify** — `pnpm --filter web exec vitest run && pnpm -w typecheck && pnpm -w lint`
- [ ] **Step 5: Compare against the prototype** — open `Ballroom Builder v3.dc.html` seeds `f1|2` (coach scenario) and `f7|3` (removed stub) and match spacing/typography/colors; shipped-UI-vs-bundle divergence is a bug.
- [ ] **Step 6: Commit** — `git commit -m "feat(web): inline annotation media — compose, embeds, facade, chips (Builder v3 parity)"`

---### Task 6: Ship gate — `apps/web/e2e/annotation-media.spec.ts` (@smoke)

**Files:**
- Create: `apps/web/e2e/annotation-media.spec.ts`
- Modify: `apps/web/e2e/support/auth.ts` (`seedAuth` additionally sets the `__session` cookie with the minted test JWT — discrepancy note 2, so element-src media requests authenticate in E2E exactly as in production)

The three journeys from the idea's **Test plan & ship gate** section, written first and RED against the current build (harness: `resetDb`/`seedDb` a routine `r_e2e_media` with one section+figure, owner `user_media_a`, member `user_media_b` commenter, `user_media_x` non-member; `seedAuth` + `gotoRoutine`; photo via `setInputFiles` with an in-memory `{ name, mimeType: "image/png", buffer }` — no fixture file. External-request guard on every page: `page.route` for `**youtube.com**`, `**youtube-nocookie.com**`, `**ytimg.com**` recording + fulfilling 204):

- [ ] **Step 1: Journey 1** — member A attaches a photo + a YouTube link inline in one note (compose flow, tokens in the prose); back on the reading programme the margin cell shows the media chip and the margin container **contains no img/video/iframe of the content** (chip only); the external-request log is EMPTY.
- [ ] **Step 2: Journey 2** — opening the thread renders the photo `<img>` at its token position (between the two prose fragments) and the YouTube facade with the worker-proxied thumb; **the facade's iframe exists only after an explicit tap** (assert no `iframe` before, `iframe[src*="youtube-nocookie.com/embed/"]` after; external log still empty before the tap).
- [ ] **Step 3: Journey 3** — `openTwoUsers`: member B opens the routine (convergence via `expectConverged` on the note text), B's photo `<img>` loads (naturalWidth > 0 — the 200 stream through B's cookie); then as signed-in NON-member X, an in-page `fetch(objectSrc)` of the same `/api/media/...` URL resolves 403; an unauthenticated context gets 401.
- [ ] **Step 4: Run** — `pnpm test:e2e:smoke` (build + wrangler e2e harness per `ballroom-flow-build-and-env`); all three green, no flake on `--repeat-each=3` for the new spec.
- [ ] **Step 5: Commit** — `git commit -m "test(e2e): annotation media ship gate (@smoke)"`

---

### Task 7: Fold the mental-model delta, provisioning + test map, delete the idea AND this plan

**Files:**
- Modify: `docs/concepts/annotations.md` (§ One concept: annotations gain `media[]`, inline id-token placement — replace the "planned increment" pointer; § Where notes appear: compact surfaces show a chip, never the media; full embeds only in the opened thread), `docs/concepts/collaboration.md` (§ Offline: attaching media joins the live-gated list; note text stays offline-capable), `docs/system/architecture.md` (new media section: the per-env R2 bucket, key namespacing = authz, mint + stream-through serving + Range, the `__session` read path, caps + `media_object` index, worker-proxied facade thumb, token convention, GC debt), `PROVISIONING.md` (status row + section: create `weave-steps-media-staging` / `weave-steps-media-production` R2 buckets — `wrangler r2 bucket create …` — before deploying; no new secrets), `docs/TEST-MAP.md` (one row: annotation-media-embeds → domain `media.test.ts` / worker `routes/media.test.ts` + `media-range.test.ts` / web `annotation-media.test.tsx` / E2E `annotation-media.spec.ts` @smoke)
- **Delete: `docs/ideas/annotation-media-embeds.md` AND `docs/ideas/annotation-media-embeds.plan.md`** — shipping folds the delta into the two doc layers and deletes the idea in the same change; this plan file goes with it.

- [ ] **Step 1: Update the five docs** — both layers must read true after this PR (a doc-vs-code divergence is a bug, same priority as a failing test).
- [ ] **Step 2: Delete the idea file and this plan file.**
- [ ] **Step 3: Full gates** — `pnpm -w lint && pnpm -w typecheck && pnpm -w test && pnpm test:e2e:smoke && pnpm coverage` (thresholds armed: domain ≥ 90, worker ≥ 88 lines — the new worker routes must be covered, not just present).
- [ ] **Step 4: Push + PR into `main`** — title `feat: inline photo/video/YouTube embeds in annotations`; body: the named coach-Feather-Finish scenario, the FINAL decisions honored (stream-through + Range, worker-proxied thumb, caps, routine-scoped only), the six recorded discrepancies, and a prominent **"HARD REVIEW GATE: new authz surface — media serving/upload/thumb routes + the `__session` read path; keys `media/<docRef>/<annotationId>/<mediaId>`; review like the permission boundary"** callout. Don't merge red.

---

## Self-Review

**Spec coverage against the idea's Test plan & ship gate:**
- Domain: token split (live/tombstoned/unreferenced), convergence (attach vs text edit / vs tombstone), lenient reads → Task 1. ✓
- Worker: mint authz (non-member/viewer 403, commenter 200), caps at mint, serve path (member streams incl. Range, non-member 403, tombstoned readable), author-only modification (DO gate test), indexed counter reads → Tasks 3-4. ✓
- Component + axe: compose flow; facade no-external-until-tap; margin chip never media → Task 5. ✓
- Ship gate journeys (1) chip + no content in margin, (2) token-position render + tap-to-load iframe, (3) second member 200 / non-member rejected → Task 6. ✓
- Ship = docs delta + PROVISIONING (bucket) + TEST-MAP + delete idea (and plan) → Task 7. ✓

**Finality check:** stream-through R2 binding + Range (no 302/signed URLs) — Task 4; worker-proxied youtube-thumb with Cache-Control — Task 4; caps 10 MB/3 min/300 MB/4 items/1 GB at mint with indexed D1 counter — Tasks 2-3; stale-tab literal tokens accepted (no forward-compat work anywhere); media on routine-scoped annotation threads only — no reply/family-note/Journal-account surface is touched (Journal gets only the read-side chip projection). ✓

**Type consistency:** `MediaItem`/`mediaToken`/`splitMediaParts`/`attachMedia`/`softDeleteMedia` (Task 1) are consumed by the store (Task 5) and the renderer; `zMintMediaUpload`/`zMintMediaUploadResponse`/`MEDIA_CAPS` (Task 2) by the mint route (Task 3) and `store/media.ts` (Task 5); `parseMediaKey` (Task 3) by upload PUT and serve GET (Task 4). All quoted signatures verified against source at plan time. ✓
