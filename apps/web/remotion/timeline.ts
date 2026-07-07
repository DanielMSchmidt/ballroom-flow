// ─────────────────────────────────────────────────────────────────────────
// The explainer-video timeline — shared constants + types for the auto-
// generated product tour. The tour is a SINGLE continuous screen-recording of
// one real authoring journey (create → build → notate → reference → overview →
// note → share), narrated by lower-third captions that change step by step.
//
// Three pieces stay in sync through this file:
//   1. the Playwright @video journey (apps/web/e2e/explainer-video.spec.ts)
//      records ONE clip (`TOUR_CLIP`) and, for every captioned step, writes a
//      timestamped mark into `TOUR_MARKS_FILE` (a CaptionMark);
//   2. the Remotion composition (Explainer.tsx) plays that clip at real speed
//      and shows the caption whose mark the playhead has reached, wrapped by
//      the intro / outro cards below;
//   3. scripts/render-explainer.mjs reads the marks file, passes it as Remotion
//      inputProps, and sizes the composition to the recorded clip length.
//
// The step captions live WITH the actions in the recorder (they narrate a
// specific click), so they aren't duplicated here — only the intro/outro card
// copy and the layout constants are. Keep all on-screen copy short + plain.
// ─────────────────────────────────────────────────────────────────────────

export const FPS = 30;
export const WIDTH = 1280;
export const HEIGHT = 720;

// The recorder films at a NARROWER desktop viewport than the composition frame.
// The app content is a 672px centred column; at 1280px it floats in ~192px of
// empty gutter each side (why the UI "looks small"). 1024px is the smallest
// width that still keeps the desktop layout — the side rail + centred dialogs
// the @video journey selects by role — so recording here nearly halves the
// gutters and makes every control noticeably bigger without changing structure.
export const REC_WIDTH = 1024;
export const REC_HEIGHT = 720;

/** Seconds → whole frames at the composition FPS. */
export const sec = (s: number): number => Math.round(s * FPS);
/** Milliseconds → whole frames at the composition FPS. */
export const msToFrames = (ms: number): number => Math.round((ms / 1000) * FPS);

/** A full-screen text card that bookends the recorded tour. */
export interface CardSegment {
  variant: "intro" | "outro";
  seconds: number;
  /** Small mono eyebrow above the title (e.g. "WEAVE STEPS"). */
  kicker?: string;
  title: string;
  subtitle?: string;
}

/** One timed lower-third caption, keyed to a moment in the recorded clip. */
export interface CaptionMark {
  /** When this caption should appear, in ms from the start of the recording. */
  atMs: number;
  /** Mono eyebrow — the step label (e.g. "1 · CREATE"). */
  kicker: string;
  /** The plain-language instruction shown while this step happens. */
  caption: string;
}

/** A vertical-pan keyframe: at `atMs` the window's objectPosition Y should be
 *  `y` (%). The recorder emits pairs of these to ramp the view DOWN and reveal
 *  controls that sit below the crop (the tall Add-figure picker + Share dialog),
 *  then ramp back. Timestamped from the recording so it tracks real UI timing. */
export interface PanKeyframe {
  atMs: number;
  y: number;
}

/** What the recorder writes next to the clip; what the renderer reads back. */
export interface TourManifest {
  clip: string;
  /** Recorded clip length (wall-clock ms) — sizes the tour Sequence. */
  durationMs: number;
  marks: CaptionMark[];
  pans: PanKeyframe[];
}

/** Props the render script feeds the composition (from the marks file). A type
 *  alias (not an interface) so Remotion accepts it as the composition's props —
 *  interfaces aren't assignable to Remotion's `Record<string, unknown>` bound. */
export type ExplainerProps = {
  tourDurationMs: number;
  marks: CaptionMark[];
  pans: PanKeyframe[];
};

/** The single recorded clip + its sidecar marks file (under remotion/public/). */
export const TOUR_CLIP = "tour.webm";
export const TOUR_MARKS_FILE = "tour-marks.json";

export const INTRO_CARD: CardSegment = {
  variant: "intro",
  seconds: 4,
  kicker: "WEAVE STEPS",
  title: "Build ballroom choreography, step by step.",
  subtitle: "New here? Follow along — we'll go slowly and show you exactly where to tap.",
};

export const OUTRO_CARD: CardSegment = {
  variant: "outro",
  seconds: 4.5,
  kicker: "YOUR TURN",
  title: "That's the whole loop.",
  subtitle: "Free to start · works on your phone",
};

export const INTRO_FRAMES = sec(INTRO_CARD.seconds);
export const OUTRO_FRAMES = sec(OUTRO_CARD.seconds);
