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
  /** Speed the raw journey clip up to fit its window without dead air. */
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
    seconds: 2.6,
    kicker: "WEAVE STEPS",
    title: "Build ballroom choreography, step by step.",
    subtitle: "A mobile-first studio for couples and coaches.",
  },
  {
    type: "scene",
    id: "author",
    clip: "author.webm",
    seconds: 8.5,
    playbackRate: 2.4,
    kicker: "AUTHOR",
    caption: "Assemble a routine figure by figure — then notate every step.",
  },
  {
    type: "card",
    id: "coach-info",
    variant: "info",
    seconds: 2.2,
    kicker: "COACH & COLLABORATE",
    title: "Leave lessons on any step.",
    subtitle: "Corrections, drills and notes — anchored where they belong.",
  },
  {
    type: "scene",
    id: "annotate",
    clip: "annotate.webm",
    seconds: 7.5,
    playbackRate: 2.2,
    kicker: "ANNOTATE",
    caption: "Add a lesson, reply in a thread, and filter the ones that matter.",
  },
  {
    type: "card",
    id: "journal-info",
    variant: "info",
    seconds: 2.2,
    kicker: "PRACTICE JOURNAL",
    title: "Every lesson flows into your journal.",
    subtitle: "Across every routine, ready for your next practice.",
  },
  {
    type: "scene",
    id: "journal",
    clip: "journal.webm",
    seconds: 6.5,
    playbackRate: 2.0,
    kicker: "JOURNAL",
    caption: "Notes you write while building surface, cross-routine, in one place.",
  },
  {
    type: "card",
    id: "outro",
    variant: "outro",
    seconds: 3,
    kicker: "GET STARTED",
    title: "Weave your next routine.",
    subtitle: "Free to start · works on your phone",
  },
];

/** Just the recorded snippets — the journey iterates this to know what to film. */
export const SCENES: SceneSegment[] = TIMELINE.filter((s): s is SceneSegment => s.type === "scene");

/** Total composition length in frames (sum of every segment's window). */
export const TOTAL_FRAMES: number = TIMELINE.reduce((n, s) => n + sec(s.seconds), 0);
