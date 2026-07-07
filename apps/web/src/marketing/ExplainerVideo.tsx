import { useId, useState } from "react";
import { useMessages } from "../i18n";
import { explainerMessages } from "../i18n/messages/explainer";
import { EXPLAINER } from "./video/explainer.manifest";

// Resolve the committed asset files to fingerprinted URLs at build time (same
// pattern as the screenshot gallery in Landing.tsx). The files are produced by
// `pnpm video:generate`; until then the globs are empty and the <video> simply
// has no source (the poster/CTA still render).
const VIDEOS = import.meta.glob<{ default: string }>("./video/*.mp4", { eager: true });
const POSTERS = import.meta.glob<{ default: string }>("./video/*.png", { eager: true });

const videoUrl = VIDEOS[`./video/${EXPLAINER.file}`]?.default ?? "";
const posterUrl = POSTERS[`./video/${EXPLAINER.poster}`]?.default ?? "";

export interface ExplainerVideoProps {
  className?: string;
}

/**
 * The auto-generated product tour, embedded via a native `<video>` (poster +
 * controls, lazily loaded, no autoplay — respects reduced-motion and keeps the
 * bundle light; Remotion stays a build-only dependency). Localized label/caption.
 */
export function ExplainerVideo({ className }: ExplainerVideoProps): React.JSX.Element {
  const t = useMessages(explainerMessages);
  return (
    // biome-ignore lint/a11y/useMediaCaption: silent UI screencast (no spoken audio); the localized aria-label + burnt-in on-screen captions convey the content.
    <video
      className={`w-full rounded-xl border border-border-subtle shadow-sm ${className ?? ""}`}
      controls
      preload="none"
      playsInline
      poster={posterUrl || undefined}
      aria-label={t.title}
    >
      {videoUrl && <source src={videoUrl} type="video/mp4" />}
      {t.unsupported}
    </video>
  );
}

export interface WatchTourProps {
  className?: string;
}

/**
 * A subtle "watch the tour" disclosure — the compact entry point used once a
 * user already has choreos (the empty state shows the video inline instead).
 * Toggles the ExplainerVideo in an accessible collapsible region.
 */
export function WatchTour({ className }: WatchTourProps): React.JSX.Element {
  const t = useMessages(explainerMessages);
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={regionId}
        className="inline-flex items-center gap-1.5 text-2xs font-semibold text-accent"
      >
        <PlayGlyph />
        {open ? t.hideTour : t.watchTour}
      </button>
      {open && (
        <div id={regionId} className="mt-2">
          <ExplainerVideo className="max-w-2xl" />
        </div>
      )}
    </div>
  );
}

function PlayGlyph(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 items-center justify-center rounded-full text-ink-inverse"
      style={{ background: "var(--bf-accent)" }}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
        <title>play</title>
        <path d="M1.5 0.5L7 4L1.5 7.5Z" />
      </svg>
    </span>
  );
}
