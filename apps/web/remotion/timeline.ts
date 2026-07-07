// ─────────────────────────────────────────────────────────────────────────
// The explainer-video timeline — the SINGLE SOURCE OF TRUTH for the auto-
// generated product tour. It drives three things so they can never drift:
//   1. the Playwright @video journey (apps/web/e2e/explainer-video.spec.ts),
//      which records ONE real-app clip per `scene` segment into `public/clips/`;
//   2. the Remotion composition (Explainer.tsx), which stitches the clips with
//      the intro / info / outro cards below;
//   3. scripts/render-explainer.mjs, which reads FPS + total duration here.
//
// Mirrors the marketing screenshots.manifest.ts pattern (stable keys shared by
// the recorder + the renderer). Keep the copy short — it's on-screen video text.
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

/** A full-screen text card between the real-app snippets. */
export interface CardSegment {
  type: "card";
  id: string;
  variant: "intro" | "info" | "outro";
  seconds: number;
  /** Small mono eyebrow above the title (e.g. "WEAVE STEPS"). */
  kicker?: string;
  title: string;
  subtitle?: string;
}

/** A recorded real-app snippet with an animated lower-third caption. */
export interface SceneSegment {
  type: "scene";
  id: string;
  /** Clip file written by the journey, under remotion/public/clips/. */
  clip: string;
  seconds: number;
  /** Playback speed for the raw journey clip. 1.0 = real time (the recorder
   * already bakes in generous pauses); >1 fast-forwards, <1 slows further. */
  playbackRate: number;
  /** Mono eyebrow in the lower-third. */
  kicker: string;
  caption: string;
}

export type Segment = CardSegment | SceneSegment;

// The tour: hook → author → coach/comment → journal → call to action. Each
// `scene` is a genuine journey through the running app (§ e2e harness).
export const TIMELINE: Segment[] = [
  {
    type: "card",
    id: "intro",
    variant: "intro",
    seconds: 4,
    kicker: "WEAVE STEPS",
    title: "Build ballroom choreography, step by step.",
    subtitle: "A calm, mobile-first studio for couples and coaches. Let's take a slow tour.",
  },
  {
    type: "scene",
    id: "author",
    clip: "author.webm",
    // Real-time (1.0×) — the recorder already builds in generous pauses, so we
    // play the clip at natural speed rather than fast-forwarding it. `seconds`
    // matches the recorded clip length so there's no dead-air freeze at the end.
    // (Clip durations measured from public/clips/*.webm; re-tune if the journey
    // beats change.)
    seconds: 9.3,
    playbackRate: 1.0,
    kicker: "1 · START A ROUTINE",
    caption:
      "Tap “New choreo”, give it a name, then add figures one at a time. Nothing is locked in — you can rename or remove anything.",
  },
  {
    type: "card",
    id: "coach-info",
    variant: "info",
    seconds: 3.6,
    kicker: "COACH & COLLABORATE",
    title: "Every step can hold a note.",
    subtitle: "Corrections, drills and reminders — pinned exactly where they belong.",
  },
  {
    type: "scene",
    id: "annotate",
    clip: "annotate.webm",
    seconds: 8.4,
    playbackRate: 1.0,
    kicker: "2 · LEAVE A NOTE",
    caption:
      "Open a step, choose a note type and write it. Reply underneath to build a thread — just like chatting about the dance.",
  },
  {
    type: "card",
    id: "journal-info",
    variant: "info",
    seconds: 3.6,
    kicker: "PRACTICE JOURNAL",
    title: "Every note flows into your journal.",
    subtitle: "Gathered across every routine, ready for your next practice.",
  },
  {
    type: "scene",
    id: "journal",
    clip: "journal.webm",
    seconds: 5.1,
    playbackRate: 1.0,
    kicker: "3 · REVIEW & PRACTISE",
    caption:
      "Open the Journal to see notes from all your routines together. Filter to just lessons when you want to focus.",
  },
  {
    type: "card",
    id: "outro",
    variant: "outro",
    seconds: 4,
    kicker: "GET STARTED",
    title: "Weave your next routine.",
    subtitle: "Free to start · works on your phone",
  },
];

/** Just the recorded snippets — the journey iterates this to know what to film. */
export const SCENES: SceneSegment[] = TIMELINE.filter((s): s is SceneSegment => s.type === "scene");

/** Total composition length in frames (sum of every segment's window). */
export const TOTAL_FRAMES: number = TIMELINE.reduce((n, s) => n + sec(s.seconds), 0);
