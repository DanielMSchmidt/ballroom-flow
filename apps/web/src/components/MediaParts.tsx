// docs/ideas/annotation-media-embeds.md — inline media renderer for the OPENED
// thread. Splits an annotation's text on its `![media:<id>]` tokens and renders each
// part in order: text spans, a photo card, a video (poster → tap to play), a YouTube
// facade (worker-proxied thumb → tap loads the nocookie iframe), and a "removed" stub
// for tombstoned/dangling ids. Full embeds live here ONLY — the compact surfaces show
// a MediaChip instead.
//
// Builder v3 parity: docs/design/project/Ballroom Builder v3.dc.html ~525-556
// (`p.isText` / `p.isPhoto` / `p.isVideo` / `p.isYt` facade / `p.isGone`).
//
// CRITICAL (a11y + no-third-party-until-tap): before any tap there is NO <iframe> and
// every img[src] points at a same-origin /api/media/... path (incl. the worker-proxied
// youtube-thumb). The nocookie iframe is created ONLY after an explicit facade tap.
import type { MediaItem, UploadedMediaItem, YouTubeMediaItem } from "@weavesteps/domain";
import { splitMediaParts } from "@weavesteps/domain";
import { useState } from "react";
import { useMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";

export interface MediaPartsProps {
  /** The annotation's text — the token positions drive inline ordering. */
  text: string;
  /** The annotation's media items (live + tombstoned); optional/absent when none. */
  media?: MediaItem[];
  /** The routine docRef — needed for the worker-proxied youtube-thumb URL. */
  docRef: string;
  /**
   * Soft-delete a live item (docs/concepts/annotations.md § Media — "a tombstoned
   * item renders a quiet 'removed' stub; undo restores it"). Wired ONLY when the
   * viewer may edit this annotation's content (its author); omitted otherwise, so
   * every live embed then renders remove-less. Never offered on the removed stub.
   */
  onRemove?: (mediaId: string) => void;
}

/** Same-origin media URL for an uploaded object key (never a third-party host). */
const mediaSrc = (objectKey: string): string => `/api/media/${objectKey}`;

/** Renders `splitMediaParts(text, media)` in order (text/photo/video/youtube/removed). */
export function MediaParts({ text, media, docRef, onRemove }: MediaPartsProps): React.JSX.Element {
  const parts = splitMediaParts(text, media);
  return (
    <span className="flex flex-col gap-1.5">
      {parts.map((part, i) => {
        if (part.kind === "text") {
          // Position-stable key: the parts array is derived deterministically from
          // the same (text, media) on every render, so the index is a valid key.
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: parts are positionally stable
              key={`t${i}`}
              className="text-[15px] leading-[1.35] text-ink"
              style={{ fontFamily: "var(--bf-font-note)" }}
            >
              {part.text}
            </span>
          );
        }
        if (part.kind === "removed") {
          return (
            <span
              key={`r${part.mediaId}`}
              data-media-removed
              className="rounded-[9px] border-[1.5px] border-dashed px-2.5 py-1.5 text-[9px] font-semibold text-ink-faint"
              style={{ borderColor: "var(--bf-line, #ddd6ca)" }}
            >
              media removed — undo restores it
            </span>
          );
        }
        const { item } = part;
        const embed =
          item.type === "youtube" ? (
            <YouTubeFacade item={item} docRef={docRef} />
          ) : item.type === "image" ? (
            <PhotoBlock item={item} />
          ) : (
            <VideoBlock item={item} />
          );
        return (
          <MediaEmbed key={item.id} onRemove={onRemove ? () => onRemove(item.id) : undefined}>
            {embed}
          </MediaEmbed>
        );
      })}
    </span>
  );
}

/** Wraps a live embed so its author can soft-delete it (docs/concepts/annotations.md
 *  § Media). When `onRemove` is absent the embed renders exactly as before — a
 *  reader/non-author never sees the control. The ✕ overlays the top-right corner. */
function MediaEmbed({
  onRemove,
  children,
}: {
  onRemove?: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  if (!onRemove) return <>{children}</>;
  return (
    <span className="relative block">
      {children}
      <button
        type="button"
        aria-label={t.removeMedia}
        title={t.removeMedia}
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 flex min-h-[var(--bf-touch-target)] min-w-[var(--bf-touch-target)] items-center justify-center rounded-full text-white outline-none"
        style={{ background: "rgba(0,0,0,.55)" }}
      >
        <span aria-hidden="true" className="text-[13px] font-bold leading-none">
          ✕
        </span>
      </button>
    </span>
  );
}

/** A photo card (Builder v3 ~531): rounded bordered image + `▣ <label>` caption bar. */
function PhotoBlock({ item }: { item: UploadedMediaItem }): React.JSX.Element {
  const label = `${item.width ?? ""}${item.width && item.height ? "×" : ""}${item.height ?? ""}`;
  return (
    <span
      data-media-photo
      className="block overflow-hidden rounded-[10px] border"
      style={{ borderColor: "rgba(0,0,0,.09)" }}
    >
      <img
        src={mediaSrc(item.objectKey)}
        alt="attachment on this note"
        className="block w-full"
        loading="lazy"
      />
      <span className="flex items-center gap-1.5 bg-surface-sunken px-2.5 py-1.5">
        <span className="text-[9px] font-bold text-ink-secondary">▣ {label || "photo"}</span>
      </span>
    </span>
  );
}

/** A video block (Builder v3 ~537): poster still + a play BUTTON that swaps in a
 *  native `<video controls>` (server-side Range streaming, no blob download). */
function VideoBlock({ item }: { item: UploadedMediaItem }): React.JSX.Element {
  const [playing, setPlaying] = useState(false);
  const durationLabel =
    item.durationSeconds !== undefined ? formatDuration(item.durationSeconds) : undefined;
  if (playing) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: user-uploaded coach clips have no caption track
      <video
        data-media-video
        controls
        src={mediaSrc(item.objectKey)}
        className="block w-full rounded-[10px]"
      />
    );
  }
  return (
    <button
      type="button"
      data-media-video-poster
      aria-label="play video"
      onClick={() => setPlaying(true)}
      className="relative block w-full overflow-hidden rounded-[10px]"
      style={{ background: "linear-gradient(150deg,#3a3831,#23211c 70%)" }}
    >
      {item.posterKey ? (
        <img
          src={mediaSrc(item.posterKey)}
          alt="video poster"
          className="block h-[128px] w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex h-[128px] items-center justify-center" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span
          aria-hidden="true"
          className="flex h-[42px] w-[42px] items-center justify-center rounded-full border-2"
          style={{ background: "rgba(255,255,255,.16)", borderColor: "rgba(255,255,255,.85)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" role="img" aria-label="play">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>
      {durationLabel && (
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-2 rounded-[6px] px-1.5 py-0.5 text-[9px] font-bold text-white"
          style={{ background: "rgba(0,0,0,.55)" }}
        >
          {durationLabel}
        </span>
      )}
    </button>
  );
}

/** The YouTube click-to-load facade (Builder v3 ~544): worker-proxied thumbnail +
 *  red play chip + title row. The nocookie iframe is created ONLY after a tap. */
function YouTubeFacade({
  item,
  docRef,
}: {
  item: YouTubeMediaItem;
  docRef: string;
}): React.JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  if (loaded) {
    return (
      <iframe
        data-media-youtube
        title="YouTube video"
        src={`https://www.youtube-nocookie.com/embed/${item.videoId}?autoplay=1`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="aspect-video w-full rounded-[10px] border-0"
      />
    );
  }
  const thumbSrc = `/api/media/youtube-thumb/${item.videoId}?docRef=${encodeURIComponent(docRef)}`;
  return (
    <button
      type="button"
      data-media-youtube-facade
      aria-label="load YouTube video"
      onClick={() => setLoaded(true)}
      className="relative block w-full overflow-hidden rounded-[10px]"
      style={{ background: "linear-gradient(150deg,#2c2a26,#191713 70%)" }}
    >
      {!thumbFailed && (
        <img
          src={thumbSrc}
          alt=""
          aria-hidden="true"
          onError={() => setThumbFailed(true)}
          className="block h-[104px] w-full object-cover"
          loading="lazy"
        />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span
          aria-hidden="true"
          className="flex h-[32px] w-[46px] items-center justify-center rounded-[9px]"
          style={{ background: "#e33" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" role="img" aria-label="play">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>
      <span
        className="flex items-center justify-between gap-1.5 px-2.5 py-1.5"
        style={{ background: "rgba(255,255,255,.08)" }}
      >
        <span className="truncate text-[9px] font-bold" style={{ color: "#e8e4da" }}>
          {item.url}
        </span>
        <span className="flex-none text-[8px] font-semibold" style={{ color: "#8f8a80" }}>
          tap to load · YouTube
        </span>
      </span>
    </button>
  );
}

/** Seconds → `m:ss` for the duration badge. */
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}
