---
title: Embed photos, videos, and YouTube links in annotations
wep: 0005
owning-areas: [domain, contract, worker, web, design, ops]
status: provisional
authors: ["@danielmschmidt"]
approver: owner
created: 2026-07-14
last-updated: 2026-07-14
see-also:
  [
    "PLAN §13 (Appendix: Media v1.1 — the pre-process sketch this WEP picks up)",
    "PLAN §12 Q-M1/2/3 (types / caps / entities)",
    "PLAN §2.6 (Annotation carries media[] (v1.1))",
    "PLAN §4.3 (reading-view notes margin — the compact-on-timeline surface)",
    "PLAN §11.2 (offline scope boundary — uploads are live-gated)",
    "PLAN §8 D27 (Queues reserved for media — deliberately NOT used here)",
    "docs/design/project/Ballroom Builder v3.dc.html (the voice/photo/video attach affordance, today toasting 'Attach — coming soon')",
    "WEP-0002 (account-doc live DO — prerequisite for family-note media, which is out of scope here)",
  ]
replaces: null
superseded-by: null
---

# WEP-0005: Embed photos, videos, and YouTube links in annotations

*(Raises the reserved media increment: PLAN §13 sketched the storage approach, Q-M1/2/3 held
the open questions, and PLAN §12 said "raise a WEP when picked up" — this is that WEP. It is
`provisional`: the direction and the named scenario are set; Design Details below are a sketch
with the open questions called out, to be completed — including the design-bundle prototype —
before promotion to `implementable`.)*

## Summary

Annotations ("comments") gain multimedia content, **embedded inline in the note's text**:

- a **photo** you took (uploaded),
- a **video** you recorded — e.g. your coach demonstrating the figure (uploaded),
- a **YouTube link** — e.g. someone cool dancing the same figure (embedded by reference,
  nothing stored).

Uploads go browser→R2 via presigned PUT (the PLAN §13 approach); a media item is referenced
from the text by an id token so it renders **at its position in the prose**, not as a gallery
bolted underneath. Full embeds (playable video, full-size photo, YouTube player) render only
in the **opened thread**; the compact surfaces — the reading programme's notes-margin snippet
and the Journal cards — show a small **media chip** next to the existing two-line snippet, and
tapping opens the thread exactly as today. Media reads are gated by the same membership that
gates the annotation itself.

## Motivation

A note like "keep the head weight left through the heel turn" is a poor substitute for the
20 seconds of video where the coach *shows* it. The design bundle has carried photo/video/voice
attach affordances since Builder v1 (today they toast *"Attach — coming soon"*), PLAN has
reserved `media[]` on the Annotation and R2 in the architecture since v1 planning, and the
Journal entry editor ships a visibly disabled media affordance. The product intent was never
in question — only sequencing. This WEP sequences it.

### Goals

- **Attach media to routine-scoped annotations** (the timeline comments): uploaded images,
  uploaded videos, and YouTube links. This resolves **Q-M1 (types)** — voice recordings stay
  out (see Non-Goals) — and the annotation arm of **Q-M3 (entities)**.
- **Inline placement in the text**: a media item sits where the author put it in the note's
  prose, so "watch how she delays the rise: ⏵" keeps the video in its sentence.
- **Compact on the timeline**: the reading programme's notes margin and the Journal cards
  never render a player, iframe, or full-size image — a small chip signals "this note has
  media", and the existing tap-to-open-thread interaction shows the full embeds.
- **Private by default**: media visibility ≡ annotation visibility. A non-member of the
  routine can never fetch the bytes; the coach video is not on the public internet.
- **Caps** on size/count/total storage so the free plan can't be used as a file locker —
  resolving **Q-M2 (caps)**, values proposed below for owner confirmation.

### Non-Goals

- **No voice recordings** in this increment. The design mock's affordance stays; audio adds a
  recording UI + its own codec/permission surface for the least-demanded medium. A later WEP
  (or a scope amendment here) when someone actually wants it.
- **No media on replies.** The `MediaItem` shape extends naturally, but the compose surface
  and caps story ship for annotation bodies first.
- **No media on `figureType` family notes** (account-doc annotations) or the Journal's
  account arm. Their content rides the cross-account `FigureTypeNoteIndex` read path and the
  account doc is being rehomed by WEP-0002 — media there needs that landed first. The
  Journal's *routine* arm shows the compact chip like every other surface.
- **No rich-text editor.** Annotation text stays a plain string; inline embedding is done
  with id tokens (below), not a block/rich-text document model.
- **No server-side transcoding/thumbnailing pipeline.** Client-side compression + client-side
  poster capture. D27's reserved Queues stay reserved (see Alternatives).
- **No general link unfurling** (Instagram, Vimeo, arbitrary OpenGraph). YouTube only —
  it's the named use case; every added provider is an added privacy/CSP/renderer surface.
- **No media search/browse surface** ("all my videos"). Media lives where its note lives.

## Proposal

**Named scenario — the coach's Feather Finish video.** At Tuesday's lesson the coach
demonstrates the follower's heel turn in the **Feather Finish** of Daniel's Slowfox choreo;
Daniel films ~20 seconds on his phone, and also has a photo of the whiteboard sketch and a
YouTube link of a couple dancing the figure beautifully.

*Today:* the note thread on count 4 of the Feather Finish takes text only. The attach
affordances in the design toast "coming soon". The video stays in the camera roll, unfindable
by Thursday's practice; the YouTube URL gets pasted as dead text.

*Proposed:* in the thread compose, Daniel writes *"Coach: keep the head weight left through
the heel turn — watch how she delays the rise:"*, taps **video**, picks the clip (it compresses
client-side, uploads to R2, and drops into the text right there), continues *"compare"*, pastes
the YouTube URL (it becomes an embed token), taps **photo** for the whiteboard. The note is one
piece of prose with three embeds at their meaningful positions.

On the reading programme, the Feather Finish's margin cell looks as it does today — avatar,
two-line snippet — plus a compact **⏵2 ▣1 media chip**. No video element, no iframe, no image
bytes load on the programme. Tapping the cell opens the thread (existing behavior): the photo
renders inline, the coach video plays in place (poster first), and the YouTube embed is a
click-to-load facade that only contacts YouTube when tapped. Daniel's partner — a member of
the routine — sees all of it; the media URLs are useless to anyone else. On Thursday, practice
starts by opening count 4 and watching the coach.

**Risks & mitigations (sketch):**

- *This is the system's first binary storage* — a new bucket, a new authz surface, real cost.
  Mitigation: keys are namespaced by docRef so authorization is derivable from the key alone;
  serving goes through the worker's membership gate; caps are enforced at upload-URL minting
  (worker), not client-side.
- *Media outlives what it's attached to* (soft-delete world). Mitigation: tombstoned media
  stays fetchable to members (undo must restore it); actual R2 garbage collection is deferred
  debt, recorded in Drawbacks.
- *Stale tabs* (rollout skew) would render the inline token as literal text. Open question
  below; likely acceptable-transient, to be decided at `implementable`.

## Design Details

*(Sketch — to be completed for `implementable`. The UI flow must be prototyped in
`docs/design/` first, per house rule; the prototype is a promotion requirement, and the
Builder v3 attach affordance graduates from "coming soon" in that same design pass.)*

### Data shape (domain)

`Annotation` gains an optional `media?: MediaItem[]` (optional ⇒ lenient reads, no migration
ladder step — same pattern as `customKinds?`). Discriminated union, client-ULID ids,
soft-delete only:

```ts
type MediaItem =
  | {
      id: string; // ULID, client-generated
      type: "image" | "video"; // uploaded to R2
      objectKey: string; // media/<docRef>/<annotationId>/<mediaId>
      mimeType: string;
      sizeBytes: number;
      width?: number;
      height?: number;
      durationSeconds?: number; // video
      posterKey?: string; // video poster frame, captured client-side
      createdAt: number;
      deletedAt?: number | null;
    }
  | {
      id: string;
      type: "youtube";
      videoId: string; // parsed from the pasted URL (watch/shorts/youtu.be forms)
      url: string; // the original URL, for provenance
      createdAt: number;
      deletedAt?: number | null;
    };
```

### Inline embedding — id tokens in plain text

The note's `text` stays a plain string. A media item is placed inline by a token
`![media:<mediaId>]` at its position. The renderer splits on tokens: a token whose item is
live renders the embed; a token whose item is tombstoned renders a quiet "removed" stub; an
item present in `media[]` but referenced nowhere (possible under concurrent text edits)
renders appended after the text — nothing is ever silently lost. This keeps CRDT semantics
trivial (the media list is append+tombstone; the text field's existing merge behavior is
untouched) and avoids a rich-text model.

### Storage & upload (worker / ops)

- **New infrastructure: one R2 bucket** (reserved in PLAN §6/§13; per-env like D1). This is
  the WEP-triggering dependency.
- **Upload = presigned PUT, browser→R2 direct** (PLAN §13): client compresses images
  client-side and captures a video poster frame; `POST /api/docs/:docRef/media/upload-url`
  checks `canAnnotate` (commenter+) membership **and the caps** and mints the URL. On PUT
  success the client writes the `MediaItem` + token into the annotation — an ordinary CRDT
  edit through the store seam.
- **Serving:** `GET /api/media/<objectKey>` on the worker — membership of the docRef in the
  key prefix gates it (viewer+), streamed from the R2 binding with **Range** support (video
  scrubbing). *Open question:* stream-through vs 302-to-short-lived-signed-URL (cache/egress
  vs simplicity + revocation immediacy) — decide with numbers at `implementable`.
- **Upload retry:** inline while online; iOS Safari lacks Background Sync, so an in-app retry
  queue, not a service-worker one (PLAN §13). Attaching media is **live-gated** (the §11.2
  boundary: server-minting actions stay online-only); note *text* editing stays offline-capable
  as today.

### YouTube embeds (web)

Click-to-load facade: the note renders a thumbnail-sized placeholder with a play glyph; only
an explicit tap loads the `youtube-nocookie.com` iframe. No third-party request happens from
merely reading a note (privacy, weight, offline-honesty, and it makes the ship-gate journey
assertable without network). *Open question:* whether the facade thumbnail itself loads from
`i.ytimg.com` eagerly in the opened thread, on tap only, or proxied — decide in the design
pass.

### Surfaces (web / design)

- **Compose** (thread compose in the figure-detail read lens, the margin ＋): the design
  bundle's photo/video rows become live; a pasted YouTube URL is detected and offered as an
  embed. Prototype-first in `docs/design/`.
- **Full embeds** render only where the thread renders (the figure-detail read lens's
  annotation surfaces).
- **Compact surfaces** — the reading programme's 29% notes margin and Journal cards — render
  the existing two-line snippet plus a **media chip** (kind glyphs + counts), never an
  `<img>`/`<video>`/`<iframe>` of the content. Tap-to-open-thread is unchanged. Tokens are
  stripped from the snippet text (and from the `journal_entry` text projection — or handled
  by the Journal renderer; decide at `implementable`).

### Permissions

Exactly the annotation's own model (§5.1): create/attach requires `canAnnotate` (commenter+);
attach/remove on an existing note is **author-only** (the hardened post-connect authorship
check applies — media edits are annotation modifications); reading media requires membership
of the routine (viewer+). No public URLs, ever.

### Caps (Q-M2 — proposed values, owner confirms at `implementable`)

- Image ≤ 10 MB pre-compression (client targets ~2 MB after).
- Video ≤ 90 s and ≤ 150 MB.
- ≤ 4 media items per annotation.
- Per-user total storage: 500 MB (free plan) — enforced at upload-URL minting; usage tracked
  in a D1 counter maintained by the mint/confirm path (an `expectIndexedQuery`-covered read).
  An admin override seam can follow `routineCapOverride`'s pattern if needed.

### Migration & back-compat

- `media?` is optional; docs without it read unchanged. No schema-version bump expected.
- **Rollout skew:** a stale tab renders `![media:<id>]` tokens as literal text until reload.
  Likely acceptable (the §7 stale-bundle nudge bounds the window); confirm — or gate token
  *insertion* on the negotiated sync-wire version — at `implementable`.
- **Rollback:** doc fields are inert extra keys to an old build; R2 objects simply go unread.

## Test Plan

*(Sketch — per TEST-MAP conventions, written/unskipped first.)*

- **Domain:** token split/render model (live / tombstoned / unreferenced items); media
  append + tombstone; convergence: concurrent attach vs text edit, concurrent attach vs
  tombstone; lenient read of media-less docs.
- **Worker/DO:** upload-URL mint authz (non-member 403, viewer 403, commenter 200); caps
  enforced at mint; serve path — member streams (incl. Range), non-member 403, tombstoned
  item still readable to members; author-only media modification at the boundary;
  `expectIndexedQuery` on the usage-counter reads.
- **Component (+axe):** compose attach flow; YouTube facade makes no external request until
  tap; margin cell renders chip, not media elements; thread renders embeds at token
  positions.
- **E2E:** the ship-gate journey below (local R2 via the wrangler dev harness).

## Ship Gate

**`apps/web/e2e/annotation-media.spec.ts`, green on the implementing PR:**

1. A member attaches a photo and a YouTube link inline to a note at a count; the reading
   programme's margin cell shows the compact media chip and contains **no** `img`/`video`/
   `iframe` of the content.
2. Tapping the cell opens the thread: the photo renders inline at its position in the text;
   the YouTube facade renders and loads its iframe **only after** an explicit tap.
3. A second member of the routine sees and can load the photo; a signed-in **non-member's**
   direct fetch of the media URL is rejected.

Marking `implemented` additionally requires, in the same change: PLAN §13 rewritten to
as-built (and §2.6's `media[] (v1.1)`, §4.0's "coming soon" row, §11.2's live-gated list
updated), the `docs/design/` prototype matched pixel-for-pixel, TEST-MAP rows added, and this
WEP's front-matter + CLAUDE.md index row flipped together.

## Drawbacks

- **First binary storage in the system**: real cost (storage + egress), a new bucket per env
  to provision (PROVISIONING.md), and the backup story grows an R2 chapter.
- **A new authz surface** (the serving path) in exactly the class where this repo's worst
  bugs lived — hard review gate, no exceptions.
- **Garbage-collection debt by design**: soft-delete + undo means tombstoned media's R2
  objects are retained; actual GC (a lifecycle/Queues job, D27) is deferred, so storage only
  grows until that lands.
- Video serving (Range, large responses) is the heaviest request path the worker will have.
- Tokens in plain text are a *convention*, not a model — a user can type `![media:x]` by hand
  and get a "removed" stub; accepted as harmless.

## Alternatives

- **Bytes in the Automerge doc (base64/blob in the CRDT).** Rejected: a 150 MB coach video in
  the doc explodes DO SQLite persistence, snapshot catch-up frames, and client memory; docs
  are for structure, R2 is for blobs (the PLAN §13 split, reaffirmed).
- **Links only — no uploads (e.g. "put it on YouTube unlisted").** Rejected: fails the named
  scenario. The coach video and the whiteboard photo are private, moment-of-lesson artifacts;
  forcing them through a third-party host adds friction, consent problems, and no membership
  gate.
- **`media[]` as a gallery under the note, not inline.** Rejected: the owner's explicit
  requirement is in-text placement — "watch how she delays the rise: ⏵" loses its meaning
  when the video is divorced from its sentence. (This is the one place this WEP goes beyond
  the PLAN §13 sketch.)
- **A rich-text/block document model for note text** (Automerge Text + embedded blocks).
  Rejected for this increment: annotation text is a plain string end-to-end today; rich text
  is a far larger model change with its own convergence questions — a separate WEP if prose
  formatting is ever wanted. Id tokens reach the stated goal.
- **Full embeds on the timeline margin.** Rejected: the owner's requirement is compact-with
  -click-to-open; the margin renders every note in the programme, so per-note players/iframes
  are a performance and layout non-starter in a 29% column.
- **Public/unauthenticated media URLs (obscurity-keyed).** Rejected: the coach video must not
  leak; permissions live at enforced boundaries here (§5.1), and an unguessable URL is not a
  boundary.
- **Server-side processing pipeline now (Queues: transcode, thumbnails, virus scan).**
  Deferred, not rejected: client-side compression + poster capture covers v-first at zero
  infra; D27 keeps Queues reserved for when GC or transcoding earns its way in.
- **General oEmbed/unfurl support for arbitrary providers.** Rejected (YAGNI): one provider,
  one renderer, one privacy story; widen only on demonstrated need.
