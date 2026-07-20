// docs/ideas/annotation-media-embeds.md — the compact media chip. Every surface that
// must NOT render the media itself (the reading-view notes margin, Journal cards)
// shows this instead: `⏵2 ▣1`-style glyph counts. YouTube counts as video (per the
// projected `videoCount`). Never renders an img/video/iframe.
//
// Builder v3 chip styling: docs/design/project/Ballroom Builder v3.dc.html ~150/181/534
// (`font:700 8px 'Inconsolata';color:#4a6b8a;background:#eef4fb;border:1px solid #cdddee`).

/** Glyphs the chip uses — image (▣) and video/YouTube (⏵). */
const IMAGE_GLYPH = "▣";
const VIDEO_GLYPH = "⏵";

/**
 * The chip's text label from its counts: `⏵3` for videos (incl. YouTube), `▣2` for
 * images, joined video-first (`⏵2 ▣1`). Empty string when both are 0 — the caller
 * omits the chip entirely in that case.
 */
export function mediaChipLabel(counts: { images: number; videos: number }): string {
  const parts: string[] = [];
  if (counts.videos > 0) parts.push(`${VIDEO_GLYPH}${counts.videos}`);
  if (counts.images > 0) parts.push(`${IMAGE_GLYPH}${counts.images}`);
  return parts.join(" ");
}

export interface MediaChipProps {
  images: number;
  videos: number;
}

/** The compact chip. Renders nothing when there's no media so a caller can drop it
 *  in unconditionally. The visible glyph counts carry an accessible label so the
 *  chip isn't glyph-only to a screen reader (#5). */
export function MediaChip({ images, videos }: MediaChipProps): React.JSX.Element | null {
  const label = mediaChipLabel({ images, videos });
  if (!label) return null;
  const words: string[] = [];
  if (videos > 0) words.push(`${videos} video${videos === 1 ? "" : "s"}`);
  if (images > 0) words.push(`${images} photo${images === 1 ? "" : "s"}`);
  return (
    <span
      data-media-chip
      role="img"
      aria-label={words.join(", ")}
      className="inline-flex flex-none items-center self-start rounded-[7px] border px-1.5 py-0.5 text-[8px] font-bold"
      style={{
        color: "var(--bf-studio-blue, #4a6b8a)",
        background: "var(--bf-media-chip-bg, #eef4fb)",
        borderColor: "var(--bf-media-chip-border, #cdddee)",
        fontFamily: "var(--bf-font-mono, 'Inconsolata')",
      }}
    >
      <span aria-hidden="true">{label}</span>
    </span>
  );
}
