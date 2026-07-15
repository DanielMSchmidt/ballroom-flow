# AI Voice Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/ideas/ai-voice-notes.md`](ai-voice-notes.md) — all decisions there are final; do not relitigate. Load `ballroom-flow-change-control` before starting, `ballroom-flow-validation-and-qa` before writing any test.

**Goal:** A dancer speaks a practice note; the app transcribes it (Web Speech first, Workers AI Whisper fallback), a Workers AI text model resolves it against the *actual figures in the user's choreos* into a **proposed** anchor, the user confirms/corrects in the voice sheet, and the note commits through the **existing** annotation write seams. The AI only proposes — it never writes.

**Architecture:** A pure choreo-context serializer in `packages/domain` (`serializeChoreoContext` + a new dance-alias table); proposal schemas in `packages/contract` mirroring the existing `Anchor` union; a mockable `VoiceAi` seam in `apps/worker` (deterministic fixture impl + Workers AI impl) behind two **read-only** routes (`POST /api/voice-notes/interpret`, `POST /api/voice-notes/transcribe`) that re-validate every model output with Zod; a `VoiceNoteSheet` in `apps/web` recreating the `Ballroom Builder v3.dc.html` voice sheet, whose Confirm produces the same `JournalLink` payload the manual picker would and saves via the shipped `createFamilyEntry` / `createRoutineEntry` paths. Workers AI binding (`AI`) exists **only** in the deployed wrangler envs — dev, unit tests, and E2E all run the fixture, keeping the zero-secret matrix.

**Tech Stack:** TypeScript (strict), Vitest (`domain` node / `worker` vitest-pool-workers / `component` browser+axe), Playwright, pnpm monorepo, Hono (worker), Zod (contract), Cloudflare Workers AI via AI Gateway, Automerge (untouched — the AI stays outside the CRDT).

## Global Constraints

- **TDD:** write the failing test first, watch it fail, then implement. One commit per task.
- **Branch `feat/ai-voice-notes` off `main`, PR into `main`** (the old `development` staging branch is gone — CLAUDE.md §6). Commit and push as you go; never merge red.
- **The AI seam MUST be mockable with deterministic fixtures.** Every test layer (worker unit, component, E2E) runs against the fixture implementation — no live model call anywhere in CI. **Zero secrets in tests**: no Cloudflare account id, no API token, no `AI` binding in the default/e2e wrangler envs.
- **`/api/voice-notes/interpret` (and `/transcribe`) are READ-ONLY.** They never write D1, never touch a DO's CRDT content, never mint registry rows. The only commit path is the existing client → store seam (`createAnnotation` / `createFamilyNote`) behind the user's explicit Confirm.
- **Zod re-validation of model output is MANDATORY.** Workers AI JSON mode gives no hard schema guarantee: the worker parses the raw model output with the contract schema **and** grounds every ref against the assembled context; any mismatch → `resolved: false`. Never trust the model's shape, never cast it.
- **No `any`, no type assertions** (`as` is a lint error via `lint-plugins/no-type-assertion.grit`; `as const` allowed). Narrow with type guards / Zod.
- **Soft-delete only** (`deletedAt` tombstones); **IDs are client-generated ULIDs** (`newId`) — nothing in this feature mints server-side content ids (the notes it saves flow through the existing seams, which already follow this).
- **`apps/web` components never touch Automerge or `lib/rpc` directly — only through `apps/web/src/store/`** and injected loader props (the established `Journal`/`JournalEntryEditor` pattern).
- **Worker tests:** `isolatedStorage: false` ⇒ every test uses unique DO ids/doc refs (`apps/worker/src/test-support/do-id.ts`; unique-per-run refs in E2E seeds too, see `journal-link-picker.spec.ts:33`).
- **No audio retention** — transcribe and discard; the clip is never persisted.
- **No new dependencies** (Workers AI rides the existing `@cloudflare/workers-types` v5 / wrangler 4 toolchain). Never `--no-verify`; run gates explicitly: `pnpm -w lint`, `pnpm -w typecheck`, package-scoped tests.
- Package filters: domain = `@weavesteps/domain`, contract = `@weavesteps/contract`, worker = `worker`, web = `web`.

## Exact signatures this plan builds on (verbatim from the codebase)

**Domain (`packages/domain/src/`):**

- The anchor union — `doc-types.ts:124` (reused verbatim; **no new anchor type**):
  ```ts
  export type Anchor =
    | { type: "point"; figureRef: string; count: number; role?: Role }
    | { type: "figure"; figureRef: string }
    | { type: "figureType"; figureType: FigureType; danceScope: DanceId | "all"; count?: number; role?: Role };
  ```
- `export const zAnchor: z.ZodType<Anchor>` and `export function parseAnchors(input: unknown): Anchor[] | null` — `schemas.ts:41` / `schemas.ts:36` (the `superRefine` there enforces: a timed/roled `figureType` anchor cannot have `danceScope: "all"`).
- `export const DANCE_IDS = ["waltz", "viennese_waltz", "quickstep", "foxtrot", "tango"] as const;` / `export type DanceId = (typeof DANCE_IDS)[number];` / `export function isDanceId(x: unknown): x is DanceId` — `dances.ts:18,21,28`. **Note: no dance aliases exist anywhere in the codebase today** ("slowfox" appears in no source file) — Task 1 introduces them.
- `export function resolveFigure(base: Pick<FigureDoc, "attributes" | "counts" | "bars">, variant: FigureDoc): FigureDoc` — `fork.ts:134`.
- `export function sortByOrder<T extends Ordered>(items: readonly T[]): T[]` — `order.ts:95` (fractional `sortKey` ordering for sections/placements).
- `export function figureTypeHasCatalogFamily(figureType: string): boolean` — `library.ts:188`.
- `export function newId(): string` — `ids.ts:18` (ULID).
- `RoutineDoc` / `FigureDoc` / `Section` / `Placement` / `Attribute` / `Annotation` / `AnnotationKind` — `doc-types.ts`.

**Contract (`packages/contract/src/index.ts`):** plain shared Zod schemas (no Hono client here; the worker exports `export type AppType = typeof app;` at `apps/worker/src/index.ts:1186`). Patterns to mirror: `zFamilyNoteBody` (`index.ts:158`) with its `superRefine` rejecting `count`/`role` with `danceScope: "all"`; `zJournalAnchor` (`index.ts:315`); `export function figureTypeAnchorLabel(figureType: string, danceScope: string, count?: number | null): string` (`index.ts:464`). Tests live in `packages/contract/src/index.test.ts`.

**Worker (`apps/worker/src/`):**

- `export function authenticate(c: Context<{ Bindings: Env }>): Promise<AuthedUser | null>` — `auth/index.ts:147`.
- Route pattern (Hono, parse-with-contract-Zod, fail-closed 401) — `POST /api/account/family-notes` at `index.ts:709`:
  ```ts
  app.post("/api/account/family-notes", async (c) => {
    const user = await authenticate(c);
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    const parsed = zFamilyNoteBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_family_note" }, 400);
    ...
  ```
- Snapshot assembly + **per-figure authorization** pattern (the context assembler must copy this — a routine's placements are caller-controlled CRDT content, so every figureRef is gated individually) — `GET /api/routines/:id/snapshot` at `index.ts:928–996`.
- `export async function resolveEffectiveRole(db: D1Database, docRef: string, userId: string): Promise<EffectiveRole | null>` — `db/membership.ts:65`.
- `export async function listRoutines(db: D1Database, userId: string): Promise<RoutineListItem[]>` — `db/routines.ts:99`.
- `async getSnapshot(): Promise<RoutineDoc>` on `DocDO` — `doc-do.ts:687`; `export function readFigureSnapshot(stub: DurableObjectStub<DocDO>): Promise<FigureDoc | null>` — `figure-snapshot.ts:17`.
- `export type Env = { DB: D1Database; DOC_DO: DurableObjectNamespace<DocDO>; ... E2E_TEST_ROUTES?: string; ... }` — `index.ts:71` (all deploy-only bindings are optional — the pattern `AI` follows).
- Test helpers: `uniqueDocName(prefix)` / `uniqueDocStub(namespace, prefix)` — `test-support/do-id.ts:28,37`; `authedContext` — `test-support/authed-context.ts`; `seedDb` — `test-support/seed.ts`.

**Web (`apps/web/src/`):**

- Routine store seam — `store/routine.ts:244`:
  ```ts
  createAnnotation(input: { kind: AnnotationKind; text: string; anchors: Anchor[]; tags?: string[] }): void;
  ```
- Account store seam — `store/account.ts:93`:
  ```ts
  createFamilyNote(input: { figureType: string; danceScope: DanceId | "all"; kind: AnnotationKind; text: string; count?: number; role?: Role }): void;
  ```
- REST family-note author (what the Journal actually calls) — `store/family-notes.ts:47`:
  ```ts
  export async function createFamilyNote(input: { figureType: string; danceScope: string; kind: AnnotationKind; text: string; count?: number; role?: "leader" | "follower" }, token: string | null, baseUrl = ""): Promise<FamilyNote>
  ```
- Routine-entry author — `store/journal.ts:151`:
  ```ts
  export async function createRoutineJournalEntry(routineRef: string, input: { kind: AnnotationKind; text: string; anchors: Anchor[] }, opts: { getToken: () => Promise<string | null>; currentUserId?: string; baseUrl?: string; timeoutMs?: number }): Promise<JournalEntry | null>
  ```
- Picker loaders — `store/journal.ts:38,55`: `loadRoutineOptions(token, baseUrl?)` and `loadRoutineFigureOptions(routineId, token, baseUrl?)`.
- The link payload the picker produces — `components/JournalLinkPicker.tsx:50`:
  ```ts
  export type JournalLink =
    | { home: "routine"; routineRef: string; routineTitle: string; anchor: Anchor; label: string }
    | { home: "account"; figureType: string; danceScope: string; count?: number; role?: "leader" | "follower"; anchor: Anchor; label: string };
  ```
- The editor's injected save seams — `components/JournalEntryEditor.tsx:31,40` (`createFamilyEntry(input): Promise<void>`, `createRoutineEntry(routineRef, input): Promise<void>`), wired from `App.tsx:89–121`. **Note:** the editor's `canSave` requires `text && links.length > 0` (`JournalEntryEditor.tsx:65`) — see the scenario-C honesty note in Task 6.
- RPC helpers (store layer only): `apiGet<T>(path, token, opts?)` / `apiPost<T>(path, token, body, opts?)` — `lib/rpc.ts:205,223` (`apiPost` is JSON-only; the audio-blob upload needs a small raw-body helper in the store).
- E2E-only browser seam precedent (compile-time `VITE_E2E` gate + `window.__weave*` hook) — `store/e2e-socket.ts`.
- Component-test harness: `renderUi` from `test-support/render.tsx`; axe pattern per `components/landing.test.tsx:3,46`: `import { axe } from "vitest-axe"; expect(await axe(container)).toHaveNoViolations();`.

**E2E (`apps/web/e2e/`):** `resetDb(page)` / `seedDb(page, spec)` — `support/fixtures.ts:62,68`; `seedAuth(page, userId)` — `support/auth.ts:26`; unique-per-run doc refs + choreo-first picker driving — `journal-link-picker.spec.ts` (the closest existing journey; mirror its seed shapes).

**Wrangler (`apps/worker/wrangler.toml`):** bindings are NOT inherited by named environments — `ANALYTICS` is redeclared per env (`wrangler.toml:15,120,161`); `[env.e2e]` carries `E2E_TEST_ROUTES = "1"` and deliberately NO deploy-only bindings. `AI` follows exactly this pattern (Task 4).

**Design source (recreate pixel-for-pixel):** `docs/design/project/Ballroom Builder v3.dc.html` — the "voice" affordance in the Journal entry editor (line 649), the voice sheet at lines 1026–1063: **rec state** = pulsing mic (`micPulse` keyframes, line 24) + "listening…" + live transcript card + "transcribes on this device — falls back to the app's speech service if it can't" + stop button; **confirm state** = "Here's what I heard" + transcript card + `PROPOSED TARGET` label with green "high confidence" tag + blue anchor chip (`↳ every Feather Step · all my Slow Foxtrot choreos`) + "resolved against the figures actually in your choreos — nothing saves without your confirm" + `Confirm & save` primary / `Edit target` + `Discard` secondary row.

**Model ids (final, from the idea doc):** STT fallback `@cf/openai/whisper-large-v3-turbo` (with `initial_prompt` seeded with in-scope figure names, `language: "en"`); extraction default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; cost/latency floor to A/B `@cf/meta/llama-3.1-8b-instruct-fast`; in-Cloudflare escalation candidate for the low-confidence slice `@cf/moonshotai/kimi-k2.7`.

---

### Task 1: Domain choreo-context serializer + dance aliases

**Files:**
- Create: `packages/domain/src/voice-context.ts`
- Create: `packages/domain/src/voice-context.test.ts`
- Modify: `packages/domain/src/index.ts` (exports)

**Interfaces (produced):**

```ts
export interface ChoreoContextCount { count: number; attributes: { kind: string; value: unknown; role?: Role | null }[] }
export interface ChoreoContextFigure {
  figureRef: string; figureType: string; name: string; sortKey?: string;
  counts: ChoreoContextCount[];
}
export interface ChoreoContextChoreo { id: string; name: string; dance: DanceId; figures: ChoreoContextFigure[] }
export interface ChoreoContext {
  dances: { id: DanceId; name: string; aliases: string[] }[]; // only dances present in scope
  choreos: ChoreoContextChoreo[];
}

/** Spoken/colloquial names per dance (NEW DATA — nothing like this exists yet).
 *  Sourced from common ballroom usage; e.g. foxtrot: ["slowfox", "slow foxtrot", "slow fox"]. */
export const DANCE_ALIASES: Record<DanceId, readonly string[]>;

/** Resolve a spoken dance mention (case-insensitive; matches id, display name, or alias) to a DanceId. */
export function resolveDanceAlias(mention: string): DanceId | null;

/** PURE. Serialize in-scope choreography the way the reading view models it:
 *  tombstones dropped, sections+placements in sortKey order (sortByOrder), a
 *  variant resolved against its live base (resolveFigure), one figures[] entry
 *  PER PLACEMENT (ordinals — "the first bounce fallaway" — need position, and a
 *  figure placed twice appears twice). */
export function serializeChoreoContext(
  routines: { routine: RoutineDoc; figures: Record<string, FigureDoc>; bases?: Record<string, FigureDoc> }[],
): ChoreoContext;
```

- [ ] **Step 1: Write the failing test** — `packages/domain/src/voice-context.test.ts` (use the factories in `packages/domain/src/__fixtures__/factories.ts` where they fit). Cover, at minimum:
  - figures appear in placement order across sortKey-shuffled sections/placements, one entry per placement (place the same `figureRef` twice → two entries);
  - tombstoned placements, sections, and attributes are dropped; break placements (no `figureRef`) are skipped;
  - counts are grouped ascending with their live attributes (`kind`/`value`/`role` carried through);
  - a variant with a `baseFigureRef` + supplied base serializes its **resolved** timeline (owned beats from the variant, unowned from the base — reuse a two-beat variant like the fork tests do);
  - `dances` lists exactly the dances present, each with its aliases; `resolveDanceAlias("Slowfox")` → `"foxtrot"`, `resolveDanceAlias("waltz")` → `"waltz"`, `resolveDanceAlias("salsa")` → `null`;
  - purity: no `Date.now`/randomness — same input twice → deeply equal output.
- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @weavesteps/domain exec vitest run voice-context` → FAIL "Cannot find module './voice-context'".
- [ ] **Step 3: Implement** `voice-context.ts` consuming only `./doc-types`, `./dances`, `./fork` (`resolveFigure`), `./order` (`sortByOrder`). Alias data is a small hand-curated table with a provenance comment (common ballroom usage; NOT figure/seed data, so the figure-data pipeline rules don't apply — but never invent obscure aliases: waltz ["english waltz", "slow waltz"], viennese_waltz ["viennese"], foxtrot ["slowfox", "slow foxtrot", "slow fox"], quickstep [], tango [] is the sourced-safe floor).
- [ ] **Step 4: Export** `serializeChoreoContext`, `resolveDanceAlias`, `DANCE_ALIASES`, and the `ChoreoContext*` types from `packages/domain/src/index.ts` (alphabetical with neighbors).
- [ ] **Step 5: Verify green** — `pnpm --filter @weavesteps/domain exec vitest run voice-context && pnpm -w lint && pnpm -w typecheck`.
- [ ] **Step 6: Commit** — `feat(domain): choreo-context serializer + dance aliases for voice notes`

---

### Task 2: Contract schemas for POST /api/voice-notes/interpret

**Files:**
- Modify: `packages/contract/src/index.ts`
- Modify: `packages/contract/src/index.test.ts`

**Interfaces (produced):** two schemas — the **model-output** schema (what the extraction model is asked for and what the worker's mandatory re-validation parses) and the **route response** schema (the grounded proposal, decorated with labels + save-routing):

```ts
/** POST /api/voice-notes/interpret request. */
export const zInterpretVoiceNote = z.object({
  transcript: z.string().trim().min(1).max(4000),
  /** Captured in-context: narrow the context to this one choreo. */
  routineRef: z.string().min(1).optional(),
});
export type InterpretVoiceNote = z.infer<typeof zInterpretVoiceNote>;

/** The anchor union, mirrored for the wire (same three shapes as domain Anchor;
 *  danceScope constrained like zFamilyNoteBody). Same superRefine invariant as
 *  zAnchor: a timed/roled figureType anchor cannot span "all". */
export const zVoiceAnchor = z.discriminatedUnion("type", [
  z.object({ type: z.literal("point"), figureRef: z.string().min(1), count: z.number(),
             role: z.enum(["leader", "follower"]).nullish() }),
  z.object({ type: z.literal("figure"), figureRef: z.string().min(1) }),
  z.object({ type: z.literal("figureType"), figureType: z.string().min(1),
             danceScope: z.enum([...DANCE_IDS, "all"]), count: z.number().optional(),
             role: z.enum(["leader", "follower"]).nullish() }),
]).superRefine(/* timed/roled + "all" → issue (mirror schemas.ts:60) */);

/** RAW model output (untrusted until parsed with THIS schema — the mandatory re-validation). */
export const zVoiceExtraction = z.object({
  resolved: z.boolean(),
  noteText: z.string().trim().min(1).max(4000),
  confidence: z.enum(["high", "medium", "low"]),
  anchor: zVoiceAnchor.nullable(),
  alternatives: z.array(zVoiceAnchor).max(5).default([]),
}).superRefine(/* resolved:true requires anchor != null */);
export type VoiceExtraction = z.infer<typeof zVoiceExtraction>;

/** One grounded, display-ready proposal option. */
export const zVoiceProposalOption = z.object({
  anchor: zVoiceAnchor,
  /** The routine a figure/point anchor saves into (null for a figureType family anchor). */
  routineRef: z.string().nullable(),
  label: z.string().min(1),
});

/** POST /api/voice-notes/interpret response. resolved:false ⇒ proposed:null and
 *  noteText falls back to the transcript (never a wrong anchor). */
export const zVoiceNoteProposal = z.object({
  resolved: z.boolean(),
  noteText: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  proposed: zVoiceProposalOption.nullable(),
  alternatives: z.array(zVoiceProposalOption).max(5),
}).superRefine(/* resolved:true ⇔ proposed != null; anchor.type !== "figureType" ⇒ routineRef != null */);
export type VoiceNoteProposal = z.infer<typeof zVoiceNoteProposal>;

/** POST /api/voice-notes/transcribe response (request body is raw audio bytes, not JSON). */
export const zTranscribeResponse = z.object({ transcript: z.string() });
```

- [ ] **Step 1: Write the failing tests** in `packages/contract/src/index.test.ts`: all three anchor shapes accepted (point with role, bare figure, figureType with concrete danceScope + count); malformed model output **rejected** — missing `noteText`, `confidence: "certain"`, `anchor.type: "predicate"`, `resolved: true` with `anchor: null`, timed figureType with `danceScope: "all"`, `alternatives` longer than 5, non-object garbage (`"[]"`, `null`); `zInterpretVoiceNote` trims and rejects empty/oversized transcripts.
- [ ] **Step 2: Verify RED** — `pnpm --filter @weavesteps/contract exec vitest run index` (new cases fail: exports missing).
- [ ] **Step 3: Implement** the schemas in `packages/contract/src/index.ts` (contract → domain dependency direction holds: only `DANCE_IDS` is imported, as today).
- [ ] **Step 4: Verify green** — `pnpm --filter @weavesteps/contract exec vitest run index && pnpm -w lint && pnpm -w typecheck`.
- [ ] **Step 5: Commit** — `feat(contract): voice-note interpret request/extraction/proposal schemas`

---

### Task 3: Worker AI seam, deterministic fixture, and the read-only routes

**Files:**
- Create: `apps/worker/src/voice-ai.ts` (seam interface + fixture impl + grounding)
- Create: `apps/worker/src/voice-ai.test.ts`
- Create: `apps/worker/src/routes/voice-notes.test.ts`
- Modify: `apps/worker/src/index.ts` (two routes)

**Interfaces (produced):**

```ts
// apps/worker/src/voice-ai.ts
export interface VoiceAi {
  /** Whisper-fallback STT. `initialPrompt` is seeded with in-scope figure names. */
  transcribe(audio: Uint8Array, opts: { initialPrompt: string }): Promise<string>;
  /** Grounded extraction. Returns the model's RAW JSON — UNTRUSTED until Zod-parsed. */
  interpret(transcript: string, context: ChoreoContext): Promise<unknown>;
}

/** Deterministic fixture (unit tests, E2E, local dev — zero secrets, zero flake). */
export function fixtureVoiceAi(): VoiceAi;

/** Select the implementation: the real Workers AI seam only when the binding is
 *  bound AND we're not under the E2E harness; fixture everywhere else. */
export function voiceAiFor(env: Env): VoiceAi;

/** The mandatory re-validation + grounding: Zod-parse the raw output with
 *  zVoiceExtraction, then verify every ref against the context (figureRef must
 *  be a serialized placement's figureRef; figureType must appear in the context;
 *  a concrete danceScope must be a context dance; a point count must be one of
 *  that figure's counts). Any failure ⇒ { resolved:false, noteText: transcript,
 *  confidence:"low", proposed:null, alternatives:[] }. Success decorates each
 *  anchor with its owning routineRef (figure/point) and a label
 *  (figureTypeAnchorLabel for family anchors; "<name> · <choreo title>" style
 *  for figure/point). PURE — exported for direct testing. */
export function groundProposal(raw: unknown, context: ChoreoContext, transcript: string): VoiceNoteProposal;
```

Fixture behavior (fully deterministic, derived from its inputs — this is what makes the E2E scenarios assertable without canned per-test responses):
- `transcribe(audio)` → `new TextDecoder().decode(audio)` (tests/E2E pass the transcript as UTF-8 bytes).
- `interpret(transcript, ctx)` emits **model-shaped** JSON (so the route's re-validation runs identically on fixture and real output): lowercase the transcript; resolve a dance via `resolveDanceAlias` over its words/bigrams; match a choreo by name substring; match a figure by normalized name/figureType substring (tolerate plural "s"); an ordinal word ("first"/"second") or a matched choreo name ⇒ a `figure` anchor on the nth matching placement of that choreo; otherwise a matched figure ⇒ an (untimed) `figureType` anchor with the resolved dance (or `"all"` if no dance matched); no figure match ⇒ `resolved: false`. `noteText` = the transcript with the leading "in <dance>[,] [in|on] [my] [the] <figure/choreo> …," clauses stripped (fall back to the whole transcript); confidence: `high` when dance+figure matched, `medium` when figure only.

Routes (in `index.ts`, following the `index.ts:709` pattern):
- `POST /api/voice-notes/interpret` — `authenticate` (401 fail-closed) → `zInterpretVoiceNote.safeParse` (400) → assemble context → `voiceAiFor(c.env).interpret(...)` → `groundProposal(...)` → `c.json(proposal)`. Context assembly (`assembleVoiceContext(env, userId, routineRef?)`, local helper): `routineRef` given ⇒ that routine only, gated by `resolveEffectiveRole`; otherwise `listRoutines(env.DB, userId)` filtered to `role !== "viewer"` (mirrors `store/journal.ts:46` — annotate-capable); per routine: `getSnapshot()` + the **per-figure `resolveEffectiveRole` gate + `readFigureSnapshot` + bases fan-out copied from `index.ts:928–996`** (the routine's role does NOT imply the right to read every listed ref); then `serializeChoreoContext`. A model failure (seam throws) degrades to the `resolved:false` fallback, never a 500 with a half-trusted body.
- `POST /api/voice-notes/transcribe` — `authenticate` → read raw body bytes, reject > 4 MiB with 413 (a ~15 s clip is far below this; defensive bound like `zCreateFigure`'s attribute cap) → `voiceAiFor(c.env).transcribe(bytes, { initialPrompt })` with `initialPrompt` = the caller's in-scope figure names (from the same context assembly, names only) → `c.json({ transcript })`. The audio is never stored.

- [ ] **Step 1: Write the failing seam/grounding tests** — `apps/worker/src/voice-ai.test.ts` (pure, no DO needed): `groundProposal` rejects non-parsing output → `resolved:false` with `noteText` = transcript; rejects a schema-valid extraction whose `figureRef` is NOT in the context (the grounding half of "never trust the model"); rejects a `figureType` not present in context and a `point` count the figure doesn't chart; accepts + decorates a valid figureType extraction (label via `figureTypeAnchorLabel`) and a valid figure extraction (routineRef = the owning choreo). Fixture: scenario-A/B/C transcripts against a hand-built two-foxtrot-routine `ChoreoContext` produce figureType-feather/figure-earliest-bounce-fallaway/`resolved:false` respectively, and are stable across repeated calls.
- [ ] **Step 2: Verify RED** — `pnpm --filter worker exec vitest run voice-ai` → "Cannot find module './voice-ai'".
- [ ] **Step 3: Implement `voice-ai.ts`** (fixture + grounding + `voiceAiFor`; the Workers AI impl arrives in Task 4 — until then `voiceAiFor` returns the fixture unconditionally, honestly, since `Env` has no `AI` yet).
- [ ] **Step 4: Write the failing route tests** — `apps/worker/src/routes/voice-notes.test.ts` via `SELF.fetch` + `authedContext` + `seedDb`, mirroring `routes/journal.test.ts` conventions; **unique doc refs per test** (`uniqueDocName`). Cover: 401 unauthenticated; 400 malformed body; scenario A seed (two foxtrot routines sharing a Feather) → transcript resolves to a schema-valid `figureType`/foxtrot proposal (`zVoiceNoteProposal.parse` the response body — the contract IS the assertion); scenario B seed → `figure` anchor on the earliest Bounce Fallaway with its `routineRef`; predicate/unresolved transcript → `resolved:false` + `noteText` = transcript; a viewer-only routine's figures do NOT appear in the resolution scope; **read-only proof**: snapshot `document_registry` + `journal_entry` + `figure_type_note_index` row counts before/after both routes — unchanged; `/transcribe` echoes UTF-8 bytes as `{ transcript }` (fixture) and 413s an oversized body. Zero secrets: the suite runs with no `AI` binding at all.
- [ ] **Step 5: Verify RED, then wire the routes** in `index.ts` and go GREEN — `pnpm --filter worker exec vitest run voice`.
- [ ] **Step 6: Full worker suite + gates** — `pnpm --filter worker exec vitest run && pnpm -w lint && pnpm -w typecheck`.
- [ ] **Step 7: Commit** — `feat(worker): mockable VoiceAi seam + read-only /api/voice-notes routes (fixture-backed)`

---

### Task 4: Workers AI binding + AI Gateway wiring (deployed envs only)

**Files:**
- Modify: `apps/worker/wrangler.toml`
- Modify: `apps/worker/src/index.ts` (`Env`)
- Modify: `apps/worker/src/voice-ai.ts` (real implementation + model constants)
- Modify: `apps/worker/src/voice-ai.test.ts` (selection tests)

**Wrangler:** bindings are NOT inherited by named environments (the `ANALYTICS` precedent, `wrangler.toml:15,120,161`) — and here that is the *feature*: declare the AI binding **only** under the deployed envs, so the default (dev + vitest-pool-workers) and `[env.e2e]` configs stay AI-free and secret-free, and `voiceAiFor` selects the fixture there structurally:

```toml
# docs/ideas/ai-voice-notes.md: Workers AI (STT fallback + extraction), deployed envs
# ONLY — dev/tests/e2e run the deterministic fixture seam (zero secrets).
[env.staging.ai]
binding = "AI"

[env.production.ai]
binding = "AI"

# AI Gateway (logging / rate-limiting / cost / accept-rate telemetry): the gateway
# id is a var so a missing gateway can't break dev; create it in the dashboard
# (AI Gateway → "weave-steps") before first deploy.
#   [env.staging.vars]  AI_GATEWAY_ID = "weave-steps"   (append to existing vars)
#   [env.production.vars]  AI_GATEWAY_ID = "weave-steps"
```

**Env:** add to `apps/worker/src/index.ts:71` block, both optional (dev/test run with neither — same doc-comment style as `ANALYTICS`):

```ts
  AI?: Ai;
  AI_GATEWAY_ID?: string;
```

**voice-ai.ts additions:**

```ts
/** Model choice is a DATA decision — keep docs/TOOLING.md's record in sync (Task 8). */
export const VOICE_STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const VOICE_EXTRACT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
/** Cost/latency floor to A/B in the field; escalation candidate for the
 *  low-confidence slice: @cf/moonshotai/kimi-k2.7 (idea doc, final). */
export const VOICE_EXTRACT_MODEL_FLOOR = "@cf/meta/llama-3.1-8b-instruct-fast";

export function workersVoiceAi(ai: Ai, gatewayId?: string): VoiceAi;
```

`workersVoiceAi.interpret` calls `ai.run(VOICE_EXTRACT_MODEL, { messages, response_format: { type: "json_schema", json_schema: /* zVoiceExtraction-equivalent, hand-written */ } }, gatewayId ? { gateway: { id: gatewayId } } : {})` with a system prompt embedding the serialized context (closed multiple-choice framing) and returns the raw response for `groundProposal` to validate — **the JSON-schema constraint is a hint, never a guarantee; the Zod re-validation stays mandatory**. `transcribe` calls `ai.run(VOICE_STT_MODEL, { audio: [...], initial_prompt: opts.initialPrompt, language: "en" }, ...)` likewise. `voiceAiFor(env)` becomes: `env.AI && env.E2E_TEST_ROUTES !== "1" ? workersVoiceAi(env.AI, env.AI_GATEWAY_ID) : fixtureVoiceAi()`.

Type-honesty watchpoint: `ai.run`'s result type is model-keyed in `@cloudflare/workers-types` v5. If the pinned version's `AiModels` catalog lacks these model keys or the output type doesn't narrow, fix it at the source — regenerate/augment types (e.g. `wrangler types`) or widen through one small documented boundary helper that Zod-parses immediately — **never `as`**. If a `wrangler`/`workers-types` bump turns out to be required, STOP: that's a dependency change needing owner sign-off (CLAUDE.md §3).

- [ ] **Step 1: Write the failing selection tests** (extend `voice-ai.test.ts`): `voiceAiFor({ ...env })` with no `AI` → fixture; with a stub `Ai` object and `E2E_TEST_ROUTES: "1"` → fixture; with a stub `Ai` and no e2e flag → the workers impl, and its `interpret` passes `{ gateway: { id } }` only when `AI_GATEWAY_ID` is set (assert via a recording stub `Ai` — no network, no secret).
- [ ] **Step 2: RED → implement → GREEN** — `pnpm --filter worker exec vitest run voice-ai`.
- [ ] **Step 3: Config sanity** — `pnpm --filter worker exec vitest run` (whole suite still green with no binding) and `pnpm -w typecheck`. Do NOT attempt a live model call from CI/sandbox.
- [ ] **Step 4: Commit** — `feat(worker): Workers AI + AI Gateway wiring for voice notes (deployed envs only)`
- [ ] **Step 5: Ops note in the PR description**: staging/production need the AI Gateway created (dashboard) and `AI_GATEWAY_ID` var present before the first deploy exercises the real seam; Workers AI usage is account-billed (see idea doc costs).

---

### Task 5: Web capture UI — the voice sheet (design-parity) + capture/store seams

**Files:**
- Create: `apps/web/src/store/voice-notes.ts`
- Create: `apps/web/src/store/voice-notes.test.ts`
- Create: `apps/web/src/lib/speech.ts`
- Create: `apps/web/src/components/VoiceNoteSheet.tsx`
- Create: `apps/web/src/components/voice-note-sheet.test.tsx`
- Modify: `apps/web/src/i18n/messages/journal.ts` (new strings, en + de like every message table)

**Store seam (components touch ONLY this):**

```ts
// apps/web/src/store/voice-notes.ts
export type { VoiceNoteProposal } from "@weavesteps/contract";
export async function interpretVoiceNote(
  input: { transcript: string; routineRef?: string }, token: string | null, baseUrl = "",
): Promise<VoiceNoteProposal>;   // apiPost + zVoiceNoteProposal.parse (never trust the wire)
export async function transcribeVoiceClip(
  clip: Blob, token: string | null, baseUrl = "",
): Promise<string>;              // raw-body fetch (apiPost is JSON-only) + zTranscribeResponse.parse
```

**Capture seam (browser API isolation + E2E hook, `store/e2e-socket.ts` precedent):**

```ts
// apps/web/src/lib/speech.ts
export interface SpeechCaptureCallbacks {
  onTranscript(text: string, final: boolean): void;
  /** Web Speech unsupported/failed: hand back the recorded clip for the Whisper fallback. */
  onAudioFallback(clip: Blob): void;
  onError(err: Error): void;
}
export interface SpeechCapture { readonly onDevice: boolean; start(cb: SpeechCaptureCallbacks): void; stop(): void; }
export function createSpeechCapture(): SpeechCapture;
```

`createSpeechCapture` tries `SpeechRecognition`/`webkitSpeechRecognition` (continuous, interim results); unsupported or erroring → `MediaRecorder` and `onAudioFallback` on stop. Under `isE2E()` a `window.__weaveVoiceTranscript: string | undefined` hook makes `start` emit that string as the final transcript (Playwright cannot produce mic input; compile-time-gated exactly like `__weaveZombifySockets`).

**Component (recreate the design pixel-for-pixel — `Ballroom Builder v3.dc.html:1026–1063`):**

```ts
export interface VoiceNoteSheetProps {
  open: boolean;
  onClose: () => void;
  /** Injected seams — the component holds no I/O of its own (JournalLinkPicker pattern). */
  capture: SpeechCapture;
  interpret: (input: { transcript: string; routineRef?: string }) => Promise<VoiceNoteProposal>;
  transcribe: (clip: Blob) => Promise<string>;
  /** Confirm & save / corrected pick: the ordinary picker payload + the note text. */
  onConfirm: (link: JournalLink, noteText: string) => void;
  /** resolved:false fallback: hand the transcript to the entry editor as plain text. */
  onUseAsText: (text: string) => void;
  routineRef?: string;
}
export function VoiceNoteSheet(props: VoiceNoteSheetProps): React.JSX.Element | null;
```

States (reuse `ui/Sheet.tsx`): **rec** — pulsing mic (accent circle, `micPulse`-equivalent keyframe in `styles/`), "listening…", live transcript card, the on-device/fallback caption, dark stop pill; **interpreting** — spinner over the frozen transcript; **confirm** — "Here's what I heard", transcript card, `PROPOSED TARGET` + confidence tag (green "high confidence" when `confidence === "high"`; render medium/low distinctly — color never the sole signal), the blue `↳ <label>` chip, the "resolved against the figures actually in your choreos — nothing saves without your confirm" caption, `Confirm & save` primary, `Edit target` / `Discard` row; **unresolved** — transcript card + "couldn't find a target" copy + "Keep as note text" / `Discard`. Proposal → `JournalLink` mapping is a small exported pure function `proposalToLink(p: VoiceNoteProposal): JournalLink | null` (figureType anchor → `home: "account"`; figure/point → `home: "routine"` with the proposal's `routineRef`/label — shapes verbatim from `JournalLinkPicker.tsx:50`).

- [ ] **Step 1: Failing store tests** (`voice-notes.test.ts`, jsdom + fetch mock like existing store tests): parses a valid proposal; rejects (throws) a malformed body instead of returning it.
- [ ] **Step 2: Failing component + axe tests** (`voice-note-sheet.test.tsx`, `renderUi` + a scripted `SpeechCapture` stub + stub `interpret`): rec state renders mic/"listening…"/live transcript/stop; stop → interpret called with the final transcript → confirm state shows transcript, `PROPOSED TARGET`, "high confidence" tag, and the proposal label chip for **each of the three anchor shapes**; `Confirm & save` → `onConfirm` with the exact `JournalLink` (deep-equal against a hand-built picker payload) + noteText; `Discard` → `onClose`, nothing saved; unresolved proposal → fallback state, "Keep as note text" → `onUseAsText(transcript)`; `expect(await axe(container)).toHaveNoViolations()` on rec AND confirm states (`landing.test.tsx` pattern).
- [ ] **Step 3: RED → implement (`speech.ts`, `voice-notes.ts`, `VoiceNoteSheet.tsx`, i18n strings) → GREEN** — `pnpm --filter web exec vitest run voice-note`.
- [ ] **Step 4: Gates** — `pnpm -w lint && pnpm -w typecheck`.
- [ ] **Step 5: Commit** — `feat(web): voice note capture sheet (Web Speech + Whisper-fallback seams, design-parity)`

---

### Task 6: Wire Confirm into the existing save seams (the AI never writes)

**Files:**
- Modify: `apps/web/src/components/JournalEntryEditor.tsx` (the "voice" affordance + sheet)
- Modify: `apps/web/src/components/Journal.tsx` (pass-through props)
- Modify: `apps/web/src/App.tsx` (inject `interpret`/`transcribe`/`createSpeechCapture` alongside the existing loaders, `App.tsx:84–121` pattern)
- Modify: `apps/web/src/components/journal.test.tsx` (editor voice-path tests)

Behavior (design lines 647–652 + idea doc):
- The editor grows the accent-colored mic **"voice"** control beside the disabled photo/video affordances; it opens `VoiceNoteSheet`.
- **Confirm & save** → `proposalToLink` result is appended to the editor's ordinary `links` state and `noteText` fills the textarea; the save button then drives the **unchanged** save path — `createRoutineEntry` (→ `createRoutineJournalEntry` → routine store `createAnnotation`) or `createFamilyEntry` (→ REST `createFamilyNote` → the account DO) — byte-identical payloads to a manual picker flow. No new write path exists for the AI to use.
- **Edit target** → close the proposal and open the existing `JournalLinkPicker` (it resets to its choreo step on open — `JournalLinkPicker.tsx:109–117` — **it has no pre-fill seam, and this plan does not add one**; the idea's "rendered in the existing picker" is satisfied by the proposal chip + hand-off to the ordinary picker, exactly as the design prototype shows). The user's pick replaces the proposal; the transcript text stays.
- **Unresolved / "Keep as note text"** → the transcript fills the textarea with NO link. **Honesty note:** the shipped editor requires ≥ 1 link to save (`canSave`, `JournalEntryEditor.tsx:65`), and an anchorless note has no home in either projection — so "plain journal note" means *transcript preserved in the editor, user links (or discards) manually*. The ship gate asserts exactly that (idea doc scenario C: "the app offers a plain journal note or discard — never a wrong anchor"); do NOT weaken `canSave` — that would be a data-shape/mental-model change outside this idea.

- [ ] **Step 1: Failing editor tests** (extend `journal.test.tsx`, stub capture/interpret): voice → stop → confirm on a figureType proposal → save calls `createFamilyEntry` with `{ figureType, danceScope, kind, text }` deep-equal to the manual-picker equivalent; a figure proposal → save calls `createRoutineEntry(routineRef, { kind, text, anchors: [{ type: "figure", figureRef }] })`; **no save seam is called before Confirm** (assert both spies uncalled after interpret resolves); unresolved → textarea holds the transcript, no link chip, save disabled until a manual link is added.
- [ ] **Step 2: RED → wire → GREEN** — `pnpm --filter web exec vitest run journal voice-note`.
- [ ] **Step 3: Full web suite + gates** — `pnpm --filter web exec vitest run && pnpm -w lint && pnpm -w typecheck`.
- [ ] **Step 4: Commit** — `feat(web): voice proposal confirms through the existing annotation seams`

---

### Task 7: Ship gate — `apps/web/e2e/voice-notes.spec.ts` (@smoke, fixture AI)

**Files:**
- Create: `apps/web/e2e/voice-notes.spec.ts`

Runs against the `[env.e2e]` worker: no `AI` binding + `E2E_TEST_ROUTES=1` ⇒ `voiceAiFor` serves the deterministic fixture; transcripts are injected via `window.__weaveVoiceTranscript` (set with `page.addInitScript` / `page.evaluate` before opening the sheet). Mirror `journal-link-picker.spec.ts` throughout: unique-per-run doc refs (`resetDb` wipes only D1 — DO state survives), `seedAuth`, the viewport-agnostic nav locator, exact-name buttons. The idea doc's Test plan defines the three journeys:

- [ ] **Step 1: Write the three failing journeys** (`test.describe("@smoke AI voice notes (fixture AI)", ...)` — @smoke per the delivery model; the fixture path IS the core path in CI):
  1. **Scenario A — the Feather sway (family note):** seed two foxtrot routines (`Foxtrot A`/`Foxtrot B`) sharing one global `feather` figure ("Feather Step") with placement edges + editor memberships (the `seedTwoWaltzRoutines` shape, dance swapped). Inject *"In Slowfox, in Feather Steps, I need to settle the sway before the Three Step."* → Journal → New entry → voice → stop → confirm state shows the figureType/foxtrot proposal label + confidence tag → **Confirm & save** → save the entry → the family note surfaces on the Feather in the *other* routine (Foxtrot B's reading-view notes margin / family notes, as `fork-and-figures.spec.ts`'s US-041 journey asserts visibility).
  2. **Scenario B — the competition bounce fallaway (instance note):** seed one routine titled **"Comp Slowfox"** (dance foxtrot) placing **two DISTINCT `bounce_fallaway` figure docs** (each placement its own docRef — a `figure` anchor names a figure doc, so instance-level resolution requires distinct docs; seed them so). Inject *"In my competition slowfox, on the first bounce fallaway, I need to change the direction to go more diagonal."* → proposal is a `figure` anchor whose label names the first instance → Confirm → save → the annotation appears on the **first** Bounce Fallaway's thread only (open the routine, assert present on instance 1, absent on instance 2).
  3. **Scenario C — the unresolved note:** same seed as A; inject *"Remember to breathe and stay grounded."* → the sheet shows the unresolved state (no proposal chip, no anchor) → "Keep as note text" puts the transcript in the editor textarea (save stays disabled with no link — never a wrong anchor); then Discard path closes clean with nothing saved.
- [ ] **Step 2: Verify RED, implement nothing here** — these journeys must pass purely on Tasks 1–6 output; fix product code (not the test) if they don't. Run: `pnpm --filter web exec playwright test voice-notes.spec.ts` (sandbox setup: `ballroom-flow-build-and-env` skill).
- [ ] **Step 3: Full smoke** — `pnpm test:e2e:smoke` green.
- [ ] **Step 4: Commit** — `test(e2e): AI voice notes ship gate — feather family note, bounce-fallaway instance, unresolved fallback`

---

### Task 8: Fold the mental-model delta into the docs; delete the idea + this plan

**Files:**
- Modify: `docs/concepts/annotations.md` — § The Journal gains the voice capture path: mic → transcript → **proposed** anchor → confirm/correct → the ordinary write; anchor semantics unchanged (an on-ramp, not a new note class); unresolved → transcribe-only fallback; predicate-shaped utterances can't anchor until `attribute-predicate-anchors.md` revives.
- Modify: `docs/system/architecture.md` — the read-only `POST /api/voice-notes/interpret` (+ `/transcribe`), the `VoiceAi` seam + fixture (zero-secret test matrix holds), the Workers AI binding via AI Gateway (deployed envs only), the domain choreo-context serializer, and the invariant: **the AI is advisory pre-fill; zero wrong-anchor commits can occur past the confirm step; the DO boundary/permissions/CRDT write paths are untouched.**
- Modify: `docs/TOOLING.md` — record the model choice as a data decision: default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, floor `@cf/meta/llama-3.1-8b-instruct-fast` (A/B), STT `@cf/openai/whisper-large-v3-turbo`, in-Cloudflare escalation candidate `@cf/moonshotai/kimi-k2.7`; sufficiency is field-validated via the confirm step's accept/edit signal through AI Gateway.
- Modify: `docs/TEST-MAP.md` — one row per new surface (domain `voice-context.test.ts`, contract cases, worker `voice-ai.test.ts` + `routes/voice-notes.test.ts`, web `voice-note-sheet.test.tsx`, e2e `voice-notes.spec.ts`), per the coverage-matrix convention.
- Delete: `docs/ideas/ai-voice-notes.md` **and** `docs/ideas/ai-voice-notes.plan.md` (shipping an idea folds its delta in and deletes the file — CLAUDE.md §1; this plan goes with it).

- [ ] **Step 1: Write the doc updates** (both layers must read true against the shipped code — a doc-vs-code divergence is a bug).
- [ ] **Step 2: Delete the two idea-folder files** in the same commit.
- [ ] **Step 3: Full gates one last time** — `pnpm -w lint && pnpm -w typecheck && pnpm -w test && pnpm test:e2e:smoke`.
- [ ] **Step 4: Commit** — `docs: fold AI voice notes into concepts/system docs; retire the idea + plan`
- [ ] **Step 5: Push + open the PR against `main`** — title `feat: AI voice notes — speak a note, land it on the right anchor`; body: the three named scenarios, the read-only/confirm-gate invariant, the ops note from Task 4 Step 5, and the standard footer. Do not merge red; worker/permission-adjacent diffs (Tasks 3–4) are hard-gated in review.

---

## Self-Review

**Spec coverage (idea doc § Test plan & ship gate → tasks):** domain serializer + alias resolution → Task 1 ✓; contract accepts all three anchor shapes / rejects malformed output → Task 2 ✓; worker assembles context, calls the stubbed seam, schema-valid proposal, unresolved → `resolved:false` → Task 3 ✓; binding + gateway + real model ids → Task 4 ✓; component + axe on the confirmation card per anchor shape, correction, picker-parity payload → Tasks 5–6 ✓; the three-scenario `@smoke` Playwright gate → Task 7 ✓; docs fold + idea deletion → Task 8 ✓.

**Honesty notes (codebase-vs-idea discrepancies found while verifying signatures — the plan works around them rather than papering over them):**
1. **No dance aliases exist in `packages/domain` today** — the idea's "dance (id + name + aliases)" context shape requires Task 1 to introduce `DANCE_ALIASES` (new, hand-curated, provenance-commented).
2. **`JournalLinkPicker` has no pre-fill seam** (it hard-resets to its first step on open, `JournalLinkPicker.tsx:109–117`) — "renders the proposal in the existing picker" is implemented as the design prototype actually shows it: a proposal chip in the voice sheet, with **Edit target** handing off to the ordinary picker.
3. **The entry editor cannot save a link-less note** (`canSave`, `JournalEntryEditor.tsx:65`) and no projection surfaces an anchorless note — scenario C's "plain journal note" is therefore *transcript preserved in the editor* (link manually or discard), and the ship gate asserts that, not a link-less save.
4. **A `figure` anchor names a figure doc, not a placement** — scenario B's "that instance only" holds when the two Bounce Fallaways are distinct figure docs; the E2E seed makes them so (and the serializer still emits per-placement entries so ordinals ground).
5. **Contract layer**: `packages/contract` is plain shared Zod (the Hono `AppType = typeof app` export lives in the worker, `index.ts:1186`) — Task 2 adds schemas there, no RPC client changes.

**Type consistency:** `serializeChoreoContext`/`ChoreoContext` (Task 1) are consumed by `VoiceAi.interpret`/`groundProposal` (Task 3); `zVoiceExtraction` re-validation + `zVoiceNoteProposal` response (Task 2) are produced by Task 3 and parsed again client-side in Task 5's store; `proposalToLink` emits the verbatim `JournalLink` union (Task 5) consumed by the existing editor seams (Task 6). Every quoted signature was read from source at the cited file:line on 2026-07-15.
