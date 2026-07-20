// US-039 / US-042 — the annotation panel: a kinded note/lesson/practice thread
// for a selected anchor (a point or a figure), with replies and kind/figure
// filters. docs/concepts/annotations.md § The Journal.
//
// Presentational: data + handlers as props (the §3 seam). The screen (Task 8)
// feeds it `annotations` + `onCreate/onReply/onDeleteReply` wired to the store;
// uncontrolled local state is a fallback so the panel is usable standalone.
//
// Capability gating mirrors the shared table (principle #26): only a commenter+
// sees the compose box. The worker still enforces it — a viewer's write is
// refused at the DO (US-039 effect-based gate).
//
// Styling: uses the `../ui` primitives (Button, Chip) so the panel matches the
// rest of the app — 44px touch targets (#3), focus rings (#7), the shared
// type/colour scale — and keeps the accessible names/roles the tests rely on.
import type { MintMediaUpload, MintMediaUploadResponse } from "@weavesteps/contract";
import {
  type Annotation,
  type AnnotationKind,
  type MediaItem,
  mediaToken,
  partitionByActivity,
  type Role,
} from "@weavesteps/domain";
import { useRef, useState } from "react";
import { getLocale, pickMessages, useMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import {
  captureVideoPoster,
  compressImage,
  videoDurationSeconds,
  youtubeVideoId,
} from "../lib/media-files";
import { onSelectValue } from "../lib/select-value";
import { Button, Chip } from "../ui";
import { MediaParts } from "./MediaParts";

/** A point or figure anchor the panel is composing against (Task 8 supplies it). */
export type ComposeAnchor =
  | { type: "point"; figureRef: string; count: number; role?: Role }
  | { type: "figure"; figureRef: string };

export interface AnnotationPanelProps {
  /** The viewer's per-document role; only commenter+ may compose (US-039 AC-4). */
  role: "viewer" | "commenter" | "editor";
  /** The viewer's user id — reply delete is offered only on their own replies. */
  currentUserId?: string;
  /** Controlled annotation set (Task 8). Omit to use internal state (standalone). */
  annotations?: Annotation[];
  /** The anchor a newly-composed annotation attaches to (Task 8). */
  composeAnchor?: ComposeAnchor;
  /**
   * Human-readable labels for figure refs (US-042 by-figure filter). The panel
   * derives the figure set from the annotations' anchors; this maps each ref to
   * a name. A ref with no entry falls back to the ref itself.
   */
  figureLabels?: Record<string, string>;
  /** Create handler (controlled). Omitted ⇒ the panel appends to internal state.
   *  `media` carries the composer's attached items (inline, placed by tokens in
   *  `text`) — omitted when there is none (docs/ideas/annotation-media-embeds.md). */
  onCreate?: (input: { kind: AnnotationKind; text: string; media?: MediaItem[] }) => void;
  // ── Inline media compose (docs/ideas/annotation-media-embeds.md) ──────────────
  /** The routine docRef — needed for the worker-proxied YouTube thumbnail and mint. */
  docRef?: string;
  /** Whether the routine's sync is LIVE — uploads are server-minting, so the attach
   *  affordances only appear when live (note text stays offline-capable). */
  mediaSyncLive?: boolean;
  /** Mint an upload grant (wired from the store; commenter+ + caps checked server-side). */
  onMintMediaUpload?: (req: MintMediaUpload) => Promise<MintMediaUploadResponse>;
  /** Upload a media blob to its minted URL (single PUT or multipart; from the store). */
  onUploadMedia?: (uploadUrl: string, blob: Blob, mimeType: string) => Promise<void>;
  /** Mint a client ULID for a new media item (from the store's `newId`). Injectable
   *  for tests; defaults to a local counter so the panel works standalone. */
  newMediaId?: () => string;
  /** Reply handler (controlled). */
  onReply?: (annotationId: string, text: string) => void;
  /** Reply-delete handler (controlled); shown only on the viewer's own replies. */
  onDeleteReply?: (annotationId: string, replyId: string) => void;
  /**
   * Whole-annotation soft-delete handler (#294, docs/concepts/annotations.md §
   * Ownership: "anyone may only edit or delete their own"). Offered ONLY on the
   * viewer's OWN annotations (a.authorId === currentUserId) — same author gate as
   * reply-delete; the worker/DO still enforces it. Soft-delete only (tombstone;
   * routine-doc undo restores it). Omitted ⇒ no delete control renders.
   */
  onDeleteAnnotation?: (annotationId: string) => void;
  /**
   * Soft-delete one posted media item (docs/concepts/annotations.md § Media). The
   * per-item ✕ is offered ONLY on the viewer's OWN annotations (media edits an
   * annotation's content — same author-only gate as reply-delete; the worker/DO
   * still enforces it). Omitted ⇒ no remove control renders at all.
   */
  onRemoveMedia?: (annotationId: string, mediaId: string) => void;
  // ── T8 Thread parity (frame 1.14) ────────────────────────────────────────
  /** Thread header title — e.g. "Spin Turn · step 2". When set, the panel
   *  renders in THREAD MODE: a titled header + flat comment list + single reply
   *  composer, instead of the filter bar + kind-select compose form. */
  threadTitle?: string;
  /** Optional thread sub-header — e.g. "whole figure" for a figure-level thread
   *  (US-004a). Rendered under the title in thread mode. */
  threadSubtitle?: string;
  /** Author display names: authorId → display name ("Daniel"). Falls back to
   *  authorId when missing. Used in T8 thread mode. */
  authorNameMap?: Record<string, string>;
  /** Author identity colors: authorId → hex color ("#3b7dd8"). Falls back to
   *  a stable hash slot when missing. Used in T8 thread mode. */
  authorColorMap?: Record<string, string>;
  /** Current viewer's identity color (for the reply composer avatar). */
  currentUserColor?: string;
  /** Current viewer's display name (for avatar initial in reply composer). */
  currentUserName?: string;
  /**
   * Evaluation instant for comment activity fade-out (docs/concepts/annotations.md
   * § Where notes appear). Thread mode only: stale comments (older than 28d and
   * >7d behind the newest activity in this thread) collapse behind one counted
   * divider. Injected in tests; defaults to the mount instant in the app — the
   * app's first wall-clock-dependent rendering, captured once per mount.
   */
  now?: number;
}

/** A kind filter, or a `figure:<ref>` by-figure filter (US-042). */
type Filter = "all" | "lessons" | "practice" | `figure:${string}`;

const KINDS: AnnotationKind[] = ["note", "lesson", "practice"];

let localSeq = 0;
const nextLocalId = (): string => `local-${localSeq++}`;
let localMediaSeq = 0;
/** Standalone media-id fallback (the store injects a real ULID via `newMediaId`). */
const nextLocalMediaId = (): string => `localmedia-${localMediaSeq++}`;

/** The distinct figure refs an annotation set anchors to (US-042 by-figure). */
function figureRefsOf(list: Annotation[]): string[] {
  const seen = new Set<string>();
  for (const a of list) {
    for (const an of a.anchors) {
      if (an.type === "point" || an.type === "figure") seen.add(an.figureRef);
    }
  }
  return [...seen];
}

/** Does an annotation anchor to `figureRef`? (point or figure anchor.) */
function anchorsToFigure(a: Annotation, figureRef: string): boolean {
  return a.anchors.some(
    (an) => (an.type === "point" || an.type === "figure") && an.figureRef === figureRef,
  );
}

export function AnnotationPanel({
  role,
  currentUserId,
  annotations,
  composeAnchor,
  figureLabels,
  onCreate,
  onReply,
  onDeleteReply,
  onDeleteAnnotation,
  onRemoveMedia,
  threadTitle,
  threadSubtitle,
  authorNameMap,
  authorColorMap,
  currentUserColor,
  currentUserName,
  now,
  docRef = "",
  mediaSyncLive = false,
  onMintMediaUpload,
  onUploadMedia,
  newMediaId,
}: AnnotationPanelProps): React.JSX.Element {
  const t = useMessages(journalMessages);
  const canAnnotate = role === "commenter" || role === "editor";
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<AnnotationKind>("note");
  // Pending attached media (built with conditional spreads — never an `undefined`
  // key). Uploads are live-gated (mediaSyncLive); note text stays offline-capable.
  const [pendingMedia, setPendingMedia] = useState<MediaItem[]>([]);
  const mintId = newMediaId ?? nextLocalMediaId;
  // A stable compose-session id for the object-key namespace. The final annotation
  // gets its own id at create time; membership is derived from the docRef prefix,
  // never this segment, so a compose-session value is sufficient for the key.
  const composeSessionRef = useRef<string | null>(null);
  if (composeSessionRef.current === null) {
    composeSessionRef.current = mintId();
  }
  const composeAnnotationId = composeSessionRef.current;
  // File inputs for the photo/video pickers (opened by the icon buttons).
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [local, setLocal] = useState<Annotation[]>([]);
  // Fade-out evaluation instant: captured once per mount so the partition is
  // stable across unrelated re-renders (docs/system/sync-and-offline.md § Flicker).
  const [mountNow] = useState(() => Date.now());
  const evalNow = now ?? mountNow;
  // Expanded state is plain local state — resets on unmount (no per-device persistence).
  const [showOlder, setShowOlder] = useState(false);

  // Controlled when `annotations` is provided; otherwise the panel owns the list.
  const list = annotations ?? local;
  const figureRefs = figureRefsOf(list);

  const submit = (): void => {
    const text = draft.trim();
    if (!text) return;
    // Thread mode always uses "note" kind; the filter-bar mode uses the select.
    const submitKind: AnnotationKind = threadTitle ? "note" : kind;
    // Conditional spread: an omitted `media` key when there's none (the domain
    // rejects an assigned `undefined`; the store passes this straight through).
    const mediaFields = pendingMedia.length > 0 ? { media: pendingMedia } : {};
    if (onCreate) {
      onCreate({ kind: submitKind, text, ...mediaFields });
    } else {
      const anchor: ComposeAnchor = composeAnchor ?? { type: "figure", figureRef: "" };
      setLocal((prev) => [
        ...prev,
        {
          id: nextLocalId(),
          authorId: currentUserId ?? "me",
          kind: submitKind,
          text,
          tags: [],
          anchors: [anchor],
          replies: [],
          ...mediaFields,
          createdAt: 0,
          deletedAt: null,
        },
      ]);
    }
    setDraft("");
    setPendingMedia([]);
  };

  // ── Media attach (note composer only; no media on replies) ────────────────────
  // Append a media item + its inline token to the draft, holding the item for Create.
  const holdMedia = (item: MediaItem): void => {
    setDraft((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${mediaToken(item.id)}`);
    setPendingMedia((prev) => [...prev, item]);
  };
  const clearPending = (mediaId: string): void => {
    setPendingMedia((prev) => prev.filter((m) => m.id !== mediaId));
    setDraft((prev) =>
      prev
        .replace(mediaToken(mediaId), "")
        .replace(/\s{2,}/g, " ")
        .trim(),
    );
  };

  /** Upload an image/video: compress/capture → mint → upload → hold with its token. */
  const attachUpload = async (file: File, type: "image" | "video"): Promise<void> => {
    if (!onMintMediaUpload || !onUploadMedia) return;
    const mediaId = mintId();
    if (type === "image") {
      const { blob, width, height } = await compressImage(file);
      const grant = await onMintMediaUpload({
        annotationId: composeAnnotationId,
        mediaId,
        type: "image",
        mimeType: "image/jpeg",
        sizeBytes: blob.size,
      });
      await onUploadMedia(grant.uploadUrl, blob, "image/jpeg");
      holdMedia({
        id: mediaId,
        type: "image",
        objectKey: grant.objectKey,
        mimeType: "image/jpeg",
        sizeBytes: blob.size,
        width,
        height,
        createdAt: Date.now(),
      });
      return;
    }
    // Video: capture a poster (uploaded separately) + read the duration.
    const [poster, durationSeconds] = await Promise.all([
      captureVideoPoster(file),
      videoDurationSeconds(file),
    ]);
    const posterId = mintId();
    const posterGrant = await onMintMediaUpload({
      annotationId: composeAnnotationId,
      mediaId: posterId,
      type: "image",
      mimeType: "image/jpeg",
      sizeBytes: poster.size,
      poster: true,
    });
    await onUploadMedia(posterGrant.uploadUrl, poster, "image/jpeg");
    const grant = await onMintMediaUpload({
      annotationId: composeAnnotationId,
      mediaId,
      type: "video",
      mimeType: file.type || "video/mp4",
      sizeBytes: file.size,
      durationSeconds,
    });
    await onUploadMedia(grant.uploadUrl, file, file.type || "video/mp4");
    holdMedia({
      id: mediaId,
      type: "video",
      objectKey: grant.objectKey,
      posterKey: posterGrant.objectKey,
      mimeType: file.type || "video/mp4",
      sizeBytes: file.size,
      durationSeconds,
      createdAt: Date.now(),
    });
  };

  /** Attach a YouTube link (no upload): parse the id → token + youtube item. */
  const attachYoutube = (): void => {
    const raw = window.prompt(t.youtubePrompt);
    if (!raw) return;
    const videoId = youtubeVideoId(raw);
    if (!videoId) return;
    holdMedia({ id: mintId(), type: "youtube", videoId, url: raw.trim(), createdAt: Date.now() });
  };

  const visible = list.filter((a) => {
    if (filter === "all") return true;
    if (filter === "lessons") return a.kind === "lesson";
    if (filter === "practice") return a.kind === "practice";
    // `figure:<ref>` — only annotations anchored to that figure (US-042 by-figure).
    return anchorsToFigure(a, filter.slice("figure:".length));
  });

  const labelFor = (ref: string): string => figureLabels?.[ref] ?? ref;

  // ── Thread mode (frame 1.14): titled header + flat comment list + footer reply ──
  if (threadTitle) {
    // Comment activity fade-out: `visible` is the full per-anchor list in thread
    // mode (the kind/figure filter is a standard-mode feature only). Stale
    // comments collapse behind ONE counted divider that expands in place.
    const { active, stale } = partitionByActivity(visible, evalNow);
    const threadComments = stale.length > 0 && !showOlder ? active : visible;
    return (
      <section aria-label={t.thread} className="flex flex-col gap-3">
        {/* Thread header: title ("Spin Turn · step 2") + comment count. */}
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-bold text-ink">{threadTitle}</h2>
          {threadSubtitle && (
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              {threadSubtitle}
            </p>
          )}
          {/* Header count stays honest to the FULL thread, not the collapsed subset. */}
          <p className="text-2xs text-ink-muted">{t.commentCount(visible.length)}</p>
        </div>

        {/* One tap row above the list: counted "N more comments" (collapsed) or
            "showing all · collapse older" (expanded). Absent when nothing is stale. */}
        {stale.length > 0 && (
          <button
            type="button"
            aria-expanded={showOlder}
            onClick={() => setShowOlder((v) => !v)}
            className="flex items-center gap-2 min-h-[var(--bf-touch-target)]"
          >
            <span className="h-px flex-1" style={{ background: "var(--bf-border-subtle)" }} />
            {showOlder ? (
              <span className="text-ink-faint" style={{ font: "600 9px/1 inherit" }}>
                {t.showingAllCollapseOlder}
              </span>
            ) : (
              <span
                className="rounded-[12px] border-[1.5px] border-line bg-surface px-2 py-0.5 text-ink-faint"
                style={{ font: "700 10px/1.4 inherit" }}
              >
                {t.moreComments(stale.length)}
              </span>
            )}
            <span className="h-px flex-1" style={{ background: "var(--bf-border-subtle)" }} />
          </button>
        )}

        <ul aria-label={t.commentThread} className="flex flex-col gap-4">
          {threadComments.map((a) => (
            <li key={a.id}>
              <ThreadComment
                annotation={a}
                docRef={docRef}
                currentUserId={currentUserId}
                authorColorMap={authorColorMap}
                authorNameMap={authorNameMap}
                canReply={canAnnotate && Boolean(onReply)}
                onReply={onReply ? (text) => onReply(a.id, text) : undefined}
                onDeleteReply={
                  onDeleteReply ? (replyId) => onDeleteReply(a.id, replyId) : undefined
                }
                onDelete={
                  onDeleteAnnotation && a.authorId === currentUserId
                    ? () => onDeleteAnnotation(a.id)
                    : undefined
                }
                onRemoveMedia={
                  onRemoveMedia && a.authorId === currentUserId
                    ? (mediaId) => onRemoveMedia(a.id, mediaId)
                    : undefined
                }
              />
            </li>
          ))}
        </ul>

        {/* Footer reply composer (frame 1.14 ③): avatar + "add a reply…" + send.
            Tints the avatar + border with the current user's identity colour.
            Commenter+ only (viewers are read-only). */}
        {canAnnotate && (
          <form
            aria-label={t.addReply}
            className="flex items-center gap-2 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <AuthorAvatar name={currentUserName} color={currentUserColor} size="md" />
            <input
              aria-label={t.addReplyField}
              placeholder={t.addReplyPlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 rounded-full border border-border-strong bg-surface-sunken px-4 text-sm text-ink placeholder:text-ink-faint min-h-[var(--bf-touch-target)] outline-none"
              style={
                currentUserColor ? { borderColor: currentUserColor, boxShadow: "none" } : undefined
              }
            />
            <Button type="submit" variant="secondary" size="sm" disabled={!draft.trim()}>
              {t.send}
            </Button>
          </form>
        )}
      </section>
    );
  }

  // ── Standard mode: filter bar + annotation list + kind-select compose form ──
  return (
    <section aria-label={t.annotations} className="flex flex-col gap-3">
      {/* Filter chips share the app's "pick one" pattern (#5/#7): a real button
          per filter, aria-pressed on the active one, 44px hit area via Chip. */}
      <fieldset className="flex flex-wrap items-center gap-1">
        <legend className="bf-sr-only">{t.filterAnnotations}</legend>
        {(["all", "lessons", "practice"] as const).map((f) => (
          <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
            {t.annotationFilter(f)}
          </Chip>
        ))}
        {/* By-figure filters (US-042): one chip per anchored figure. */}
        {figureRefs.map((ref) => {
          const value: Filter = `figure:${ref}`;
          return (
            <Chip key={ref} selected={filter === value} onClick={() => setFilter(value)}>
              {labelFor(ref)}
            </Chip>
          );
        })}
      </fieldset>

      <ul aria-label={t.commentThread} className="flex flex-col gap-2">
        {visible.map((a) => (
          <li key={a.id}>
            <AnnotationRow
              annotation={a}
              currentUserId={currentUserId}
              docRef={docRef}
              canReply={canAnnotate && Boolean(onReply)}
              onReply={onReply ? (text) => onReply(a.id, text) : undefined}
              onDeleteReply={onDeleteReply ? (replyId) => onDeleteReply(a.id, replyId) : undefined}
              onDelete={
                onDeleteAnnotation && a.authorId === currentUserId
                  ? () => onDeleteAnnotation(a.id)
                  : undefined
              }
              onRemoveMedia={
                onRemoveMedia && a.authorId === currentUserId
                  ? (mediaId) => onRemoveMedia(a.id, mediaId)
                  : undefined
              }
            />
          </li>
        ))}
      </ul>

      {canAnnotate && (
        <form
          aria-label={t.addAnnotation}
          className="flex flex-col gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {/* Kind chosen via a labelled select; the chosen kind also renders as
              text on each annotation so colour is never the only cue (#5).
              Native control stays keyboard/AT-friendly with a 44px target (#3/#7). */}
          <select
            aria-label={t.kindSelect}
            value={kind}
            onChange={onSelectValue(KINDS, setKind)}
            className="w-full appearance-none rounded-md border border-border-strong bg-surface-sunken px-3.5 text-sm text-ink min-h-[var(--bf-touch-target)] outline-none"
          >
            {KINDS.map((k) => (
              // Option VALUES are the stored kinds; only the visible label localizes.
              <option key={k} value={k}>
                {t.kindLabel(k)}
              </option>
            ))}
          </select>
          <textarea
            aria-label={t.noteField}
            placeholder={t.notePlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border-strong bg-surface-sunken px-3.5 py-2 text-sm text-ink placeholder:text-ink-faint outline-none"
          />
          {/* Inline media attach (docs/ideas/annotation-media-embeds.md): the three
              affordances appear only when sync is live (uploads are server-minting)
              and a mint/upload seam is wired. Note text stays offline-capable. */}
          {mediaSyncLive && onMintMediaUpload && onUploadMedia && (
            <MediaComposeRow
              pending={pendingMedia}
              onClear={clearPending}
              photoInputRef={photoInputRef}
              videoInputRef={videoInputRef}
              onPickPhoto={(file) => void attachUpload(file, "image")}
              onPickVideo={(file) => void attachUpload(file, "video")}
              onAttachYoutube={attachYoutube}
            />
          )}
          <Button type="submit" variant="primary" size="sm" disabled={!draft.trim()}>
            {t.addNote}
          </Button>
        </form>
      )}
    </section>
  );
}

/** Photo/video/YouTube icon buttons (44px targets) + hidden file inputs + a pending
 *  media chip row ("lands inline…" helper). Builder v3 ~559-568. Note composer only —
 *  media is not allowed on replies (discrepancy note 6). */
function MediaComposeRow({
  pending,
  onClear,
  photoInputRef,
  videoInputRef,
  onPickPhoto,
  onPickVideo,
  onAttachYoutube,
}: {
  pending: MediaItem[];
  onClear: (mediaId: string) => void;
  photoInputRef: React.RefObject<HTMLInputElement | null>;
  videoInputRef: React.RefObject<HTMLInputElement | null>;
  onPickPhoto: (file: File) => void;
  onPickVideo: (file: File) => void;
  onAttachYoutube: () => void;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  return (
    <div className="flex flex-col gap-2">
      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {pending.map((m) => (
            <span
              key={m.id}
              data-testid="pending-media-chip"
              className="inline-flex items-center gap-1.5 rounded-[9px] border-[1.5px] px-2.5 py-1 text-[9px] font-bold"
              style={{
                borderColor: "var(--bf-accent-border, #cdddee)",
                background: "var(--bf-media-chip-bg, #eef4fb)",
                color: "var(--bf-studio-blue, #1f3f63)",
              }}
            >
              {mediaChipGlyph(m)}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t.clearMedia}
                onClick={() => onClear(m.id)}
              >
                ✕
              </Button>
            </span>
          ))}
          <span className="text-2xs text-ink-faint" style={{ fontFamily: "var(--bf-font-note)" }}>
            {t.pendingMediaHint}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={photoInputRef}
          data-testid="media-photo-input"
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPickPhoto(file);
            e.target.value = "";
          }}
        />
        <input
          ref={videoInputRef}
          data-testid="media-video-input"
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPickVideo(file);
            e.target.value = "";
          }}
        />
        <AttachIconButton label={t.attachPhoto} onClick={() => photoInputRef.current?.click()}>
          <rect x="3" y="6" width="18" height="14" rx="2" />
          <circle cx="12" cy="13" r="3.2" />
          <path d="M8 6l1.5-2h5L16 6" />
        </AttachIconButton>
        <AttachIconButton label={t.attachVideo} onClick={() => videoInputRef.current?.click()}>
          <rect x="2" y="6" width="13" height="12" rx="2" />
          <path d="M15 10l6-3v10l-6-3z" />
        </AttachIconButton>
        <AttachIconButton label={t.attachYoutube} onClick={onAttachYoutube}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none" />
        </AttachIconButton>
      </div>
    </div>
  );
}

/** A 44px-target attach icon button (Builder v3 ~566-568). */
function AttachIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex min-h-[var(--bf-touch-target)] min-w-[var(--bf-touch-target)] items-center justify-center rounded-md text-ink-muted outline-none"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

/** The compact glyph for a pending item's chip (▣ photo, ⏵ video/YouTube). */
function mediaChipGlyph(item: MediaItem): string {
  return item.type === "image" ? "▣" : "⏵";
}

// ── T8 helpers: Thread mode components ───────────────────────────────────────

/** Relative time from a unix-ms timestamp (e.g. "2h", "3d ago", "3 May"). */
function relativeTime(createdAt: number): string {
  const t = pickMessages(journalMessages);
  const now = Date.now();
  const diffMs = now - createdAt;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t.justNow;
  if (diffMin < 60) return t.minutesAgo(diffMin);
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t.hoursAgo(diffHr);
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return t.yesterday;
  if (diffDay < 7) return t.daysAgo(diffDay);
  // Older: format as "3 May"
  return new Date(createdAt).toLocaleDateString(getLocale() === "de" ? "de-DE" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** Round identity avatar: initial of the author name on their identity colour.
 *  Decorative — the name is rendered alongside, so aria-hidden is correct. */
function AuthorAvatar({
  name,
  color,
  size = "md",
}: {
  name?: string;
  color?: string;
  size?: "sm" | "md";
}) {
  const initial = (name?.trim()[0] ?? "?").toUpperCase();
  const sizeCls = size === "sm" ? "h-[20px] w-[20px] text-[10px]" : "h-[32px] w-[32px] text-sm";
  return (
    <span
      aria-hidden="true"
      className={`flex flex-none items-center justify-center rounded-full font-bold text-white ${sizeCls}`}
      style={{ backgroundColor: color ?? "var(--bf-identity-1)" }}
    >
      {initial}
    </span>
  );
}

/** One thread comment (T8 frame 1.14): large avatar + author name in identity
 *  colour + relative time + Caveat text.  Reply thread indented below. */
function ThreadComment({
  annotation: a,
  docRef,
  currentUserId,
  authorColorMap,
  authorNameMap,
  canReply,
  onReply,
  onDeleteReply,
  onDelete,
  onRemoveMedia,
}: {
  annotation: Annotation;
  docRef: string;
  currentUserId?: string;
  authorColorMap?: Record<string, string>;
  authorNameMap?: Record<string, string>;
  canReply: boolean;
  onReply?: (text: string) => void;
  onDeleteReply?: (replyId: string) => void;
  /** Whole-note soft-delete (author-only; already gated by the caller). */
  onDelete?: () => void;
  onRemoveMedia?: (mediaId: string) => void;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  // Resolved display name only; the label may still show the raw id as text, but
  // the avatar initial must never come from an id — a ULID starts with "0", which
  // is exactly the leak in #292. `undefined` here makes AuthorAvatar show "?".
  const resolvedName = authorNameMap?.[a.authorId];
  const authorName = resolvedName ?? a.authorId;
  const authorColor = authorColorMap?.[a.authorId];
  const time = relativeTime(a.createdAt);
  return (
    <div className="flex gap-3">
      <AuthorAvatar name={resolvedName} color={authorColor} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Author name (in identity colour) · relative time, then the author's
            own delete affordance pushed to the row's end. */}
        <p className="flex items-baseline gap-1.5 text-sm">
          <span className="font-semibold" style={{ color: authorColor ?? "var(--bf-ink)" }}>
            {authorName}
          </span>
          <span className="text-2xs text-ink-muted">· {time}</span>
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              aria-label={t.deleteNote}
              onClick={onDelete}
            >
              {t.deleteNote}
            </Button>
          )}
        </p>
        {/* Comment body — ordered text/media parts; media renders INLINE at its
            token position in the prose (docs/ideas/annotation-media-embeds.md).
            The author gets a per-item ✕ to soft-delete a mis-attached media. */}
        <div className="text-[15px] text-ink" style={{ fontFamily: "var(--bf-font-note)" }}>
          <MediaParts text={a.text} media={a.media} docRef={docRef} onRemove={onRemoveMedia} />
        </div>
        {/* Threaded replies (indented) */}
        {a.replies.length > 0 && (
          <ul aria-label={t.repliesThread} className="mt-1 flex flex-col gap-1 pl-2">
            {a.replies.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-2xs text-ink-secondary">
                <span>{r.text}</span>
                {r.authorId === currentUserId && onDeleteReply && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteReply(r.id)}
                  >
                    {t.deleteReply}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canReply && onReply && <ReplyBox onSend={onReply} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** One annotation: its kind (as text, not colour-only), body, and reply thread. */
function AnnotationRow({
  annotation: a,
  currentUserId,
  docRef,
  canReply,
  onReply,
  onDeleteReply,
  onDelete,
  onRemoveMedia,
}: {
  annotation: Annotation;
  currentUserId?: string;
  docRef: string;
  canReply: boolean;
  onReply?: (text: string) => void;
  onDeleteReply?: (replyId: string) => void;
  /** Whole-note soft-delete (author-only; already gated by the caller). */
  onDelete?: () => void;
  onRemoveMedia?: (mediaId: string) => void;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line p-2">
      {/* kind chip + the note body as ordered text/media parts (media renders
          inline at its token position — docs/ideas/annotation-media-embeds.md).
          The author gets a per-item ✕ to soft-delete a mis-attached media. */}
      <div className="flex flex-col gap-1.5 text-sm">
        <Chip tone="neutral" asStatic data-kind={a.kind}>
          {t.kindLabel(a.kind)}
        </Chip>
        <div className="text-ink">
          <MediaParts text={a.text} media={a.media} docRef={docRef} onRemove={onRemoveMedia} />
        </div>
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            aria-label={t.deleteNote}
            onClick={onDelete}
          >
            {t.deleteNote}
          </Button>
        )}
      </div>
      <ul aria-label={t.repliesThread} className="flex flex-col gap-1 pl-3">
        {a.replies.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-2xs text-ink-secondary">
            <span>{r.text}</span>
            {r.authorId === currentUserId && onDeleteReply && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onDeleteReply(r.id)}>
                {t.deleteReply}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canReply && onReply && <ReplyBox onSend={onReply} />}
    </div>
  );
}

/** A single inline reply composer. */
function ReplyBox({ onSend }: { onSend: (text: string) => void }): React.JSX.Element {
  const t = useMessages(journalMessages);
  const [text, setText] = useState("");
  return (
    <form
      aria-label={t.replyForm}
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        onSend(t);
        setText("");
      }}
    >
      <input
        aria-label={t.replyField}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.replyPlaceholder}
        className="flex-1 rounded-md border border-border-strong bg-surface-sunken px-3 text-sm text-ink placeholder:text-ink-faint min-h-[var(--bf-touch-target)] outline-none"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={!text.trim()}>
        {t.postReply}
      </Button>
    </form>
  );
}
