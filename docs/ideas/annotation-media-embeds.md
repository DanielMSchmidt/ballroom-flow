# Embed photos, videos, and YouTube links in annotations

*(Created 2026-07-14 as WEP-0005, migrated 2026-07-15 · areas: domain, contract, worker,
web, design, ops. Direction and scenario are set; design details are a completable sketch —
the `docs/design/` prototype is still owed before implementation.)*

## Summary

Annotations ("comments") gain multimedia content, **embedded inline in the note's text**:

- a **photo** you took (uploaded),
- a **video** you recorded — e.g. your coach demonstrating the figure (uploaded),
- a **YouTube link** — embedded by reference, nothing stored.

Uploads go browser→R2 via presigned PUT; a media item is referenced from the text by an id
token so it renders **at its position in the prose**, not as a gallery bolted underneath.
Full embeds (playable video, full-size photo, YouTube player) render only in the **opened
thread**; the compact surfaces — the reading programme's notes-margin snippet and the
Journal cards — show a small **media chip**, and tapping opens the thread exactly as today.
Media reads are gated by the same membership that gates the annotation.

## Mental-model delta

- [`docs/concepts/annotations.md`](../concepts/annotations.md) § One concept: annotations
  gain `media[]` (photos, videos, YouTube references), placed inline in the text; the
  "planned increment" pointer there is replaced by the real behavior.
- § Where notes appear: compact surfaces show a media chip, never the media itself; full
  embeds render only in the opened thread.
- [`docs/concepts/collaboration.md`](../concepts/collaboration.md) § Offline: attaching
  media joins the live-gated list (uploads are server-minting); note *text* editing stays
  offline-capable.
- Mechanics land in [`docs/system/architecture.md`](../system/architecture.md): the first
  **R2 bucket** (per env — a provisioning addition), the upload-URL mint + membership-gated
  serving path (a new authz surface — hard review gate), caps, and the token-in-plain-text
  embedding convention.

## Motivation

A note like "keep the head weight left through the heel turn" is a poor substitute for the
20 seconds of video where the coach *shows* it. The design bundle has carried
photo/video/voice attach affordances since v1 (they toast "Attach — coming soon"), and the
Journal editor ships a visibly disabled media affordance. The intent was never in question —
only sequencing.

### Goals

- Attach media to **routine-scoped** annotations: uploaded images, uploaded videos, YouTube
  links. (Resolves the long-open type question: voice recordings stay out.)
- **Inline placement in the text** — "watch how she delays the rise: ⏵" keeps the video in
  its sentence.
- **Compact on the timeline**: margin and Journal cards never render a player, iframe, or
  full-size image.
- **Private by default**: media visibility ≡ annotation visibility; the coach video is
  never on the public internet.
- **Caps** on size/count/total storage so the free plan can't be a file locker.

### Non-goals

- No voice recordings (least-demanded medium; its own recording/codec surface — later).
- No media on replies, and none on family notes / the Journal's account arm (their content
  rides the cross-account index read path; revisit after the account-doc surfaces settle).
- No rich-text editor — annotation text stays a plain string; embedding is id tokens.
- No server-side transcoding/thumbnailing (client-side compression + poster capture; Queues
  stay reserved).
- No general link unfurling — YouTube only; every provider is a privacy/CSP/renderer
  surface.
- No media search/browse surface.

## Proposal

**Named scenario — the coach's Feather Finish video.** At Tuesday's lesson the coach
demonstrates the follower's heel turn in the Feather Finish of Daniel's Slowfox choreo;
Daniel films ~20 seconds, has a photo of the whiteboard sketch, and a YouTube link of a
couple dancing the figure beautifully.

*Today:* the note thread on count 4 takes text only; the video stays in the camera roll,
unfindable by Thursday; the YouTube URL is dead text.

*Proposed:* in the thread compose, Daniel writes *"Coach: keep the head weight left through
the heel turn — watch how she delays the rise:"*, taps **video** (client-side compress →
R2 upload → drops into the text right there), continues *"compare"*, pastes the YouTube URL
(becomes an embed token), taps **photo** for the whiteboard. One piece of prose, three
embeds at their meaningful positions. The reading programme's margin cell shows only a
compact **⏵2 ▣1** chip; tapping opens the thread — photo inline, coach video playable
(poster first), YouTube as a click-to-load facade that contacts YouTube only when tapped.
The partner (a member) sees everything; the URLs are useless to anyone else.

**Risks & mitigations:**

- *First binary storage in the system* — new bucket, new authz surface, real cost. Keys are
  namespaced by docRef so authorization derives from the key alone; serving goes through the
  worker's membership gate; caps enforced at upload-URL minting.
- *Media outlives what it's attached to* (soft-delete world): tombstoned media stays
  fetchable to members (undo must restore it); R2 garbage collection is deferred debt
  (Drawbacks).
- *Stale tabs* render the inline token as literal text until reload — likely acceptable
  (the stale-bundle nudge bounds the window); confirm before implementing.

## Design details

*(Sketch — complete before implementing; prototype the compose/render surfaces in
`docs/design/` first, graduating the attach affordance from "coming soon".)*

**Data shape (domain):** `Annotation` gains optional `media?: MediaItem[]` (optional ⇒
lenient reads, no migration step). Discriminated union, client-ULID ids, soft-delete only:

```ts
type MediaItem =
  | { id; type: "image" | "video"; objectKey /* media/<docRef>/<annotationId>/<mediaId> */;
      mimeType; sizeBytes; width?; height?; durationSeconds?; posterKey?; createdAt; deletedAt? }
  | { id; type: "youtube"; videoId; url /* provenance */; createdAt; deletedAt? };
```

**Inline embedding — id tokens in plain text:** a media item is placed by a token
`![media:<mediaId>]`. The renderer splits on tokens: live item → embed; tombstoned →
a quiet "removed" stub; an item referenced nowhere (possible under concurrent text edits)
renders appended after the text — nothing silently lost. CRDT semantics stay trivial
(append + tombstone list; the text field's merge behavior untouched).

**Storage & upload (worker/ops):** one **R2 bucket per env** (the dependency this idea
introduces). Upload = presigned PUT, browser→R2 direct; `POST
/api/docs/:docRef/media/upload-url` checks commenter+ membership **and the caps**, then
mints. On PUT success the client writes the `MediaItem` + token — an ordinary CRDT edit.
Serving: `GET /api/media/<objectKey>` on the worker — membership of the docRef in the key
prefix gates it (viewer+), streamed from R2 with **Range** support. *Open question:*
stream-through vs 302-to-signed-URL — decide with numbers. Upload retry is in-app (iOS
Safari lacks Background Sync); attaching is **live-gated**.

**YouTube:** click-to-load facade (`youtube-nocookie.com`); no third-party request from
merely reading a note. *Open question:* facade thumbnail sourcing.

**Permissions:** exactly the annotation's model — create/attach commenter+, modify
author-only (media edits are annotation modifications; the post-connect authorship check
applies), read viewer+ members. No public URLs, ever.

**Caps (proposed, confirm before implementing):** image ≤ 10 MB pre-compression (client
targets ~2 MB); video ≤ 90 s and ≤ 150 MB; ≤ 4 items per annotation; 500 MB per free user —
enforced at mint, usage tracked in an indexed D1 counter.

**Back-compat:** `media?` is inert to old readers; rollback leaves R2 objects unread.

## Test plan & ship gate

Domain: token split/render (live/tombstoned/unreferenced); convergence (concurrent attach
vs text edit / vs tombstone); lenient reads. Worker: mint authz (non-member/viewer 403,
commenter 200), caps at mint, serve path (member streams incl. Range, non-member 403,
tombstoned readable to members), author-only modification, indexed counter reads.
Component + axe: compose flow; facade makes no external request until tap; margin renders
chip, never media elements. **Ship gate — `apps/web/e2e/annotation-media.spec.ts`:**
(1) member attaches photo + YouTube inline; margin shows the chip and contains no
img/video/iframe of the content; (2) opening the thread renders the photo at its token
position and the facade loads its iframe only after an explicit tap; (3) a second member
can load the photo; a signed-in non-member's direct fetch is rejected. Shipping also
updates the concept/system docs per the mental-model delta, PROVISIONING.md (the bucket),
TEST-MAP, and deletes this file.

## Drawbacks

- First binary storage: real cost, per-env provisioning, an R2 chapter in the backup story.
- A new authz surface (the serving path) in exactly the class where this repo's worst bugs
  lived — hard review gate, no exceptions.
- GC debt by design: soft-delete + undo retain tombstoned media's R2 objects until a
  lifecycle/Queues job lands.
- Video serving (Range, large responses) becomes the worker's heaviest request path.
- Tokens in plain text are a convention, not a model — a hand-typed `![media:x]` yields a
  "removed" stub; accepted as harmless.

## Alternatives

- **Bytes in the Automerge doc** — a 150 MB video in the doc explodes DO persistence,
  snapshot frames, and client memory; docs are for structure, R2 is for blobs.
- **Links only, no uploads** ("put it on YouTube unlisted") — fails the named scenario: the
  coach video and whiteboard photo are private, moment-of-lesson artifacts; a third-party
  host adds friction, consent problems, and no membership gate.
- **Gallery under the note instead of inline** — rejected by owner: "watch how she delays
  the rise: ⏵" loses its meaning divorced from its sentence.
- **A rich-text/block document model** — a far larger model change with its own convergence
  questions; id tokens reach the stated goal.
- **Full embeds on the timeline margin** — per-note players/iframes in a 29% column that
  renders every note is a performance and layout non-starter.
- **Public obscurity-keyed URLs** — an unguessable URL is not a boundary; the coach video
  must not leak.
- **Server-side processing pipeline now** (transcode/thumbnails/scan via Queues) — deferred,
  not rejected: client-side covers v-first at zero infra.
- **General oEmbed for arbitrary providers** — one provider, one renderer, one privacy
  story; widen only on demonstrated need.
