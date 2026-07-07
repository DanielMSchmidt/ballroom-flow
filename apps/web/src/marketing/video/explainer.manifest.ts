// Single source of truth for the auto-generated explainer video asset. The
// Playwright @video journey + Remotion (apps/web/remotion/) produce the files;
// scripts/render-explainer.mjs writes them HERE; the app embeds them via
// ExplainerVideo.tsx (README links the same committed files). Mirrors the
// screenshots.manifest.ts pattern — localized copy lives in the i18n catalogs,
// keyed off this file; the fields here are the stable fallback.
export interface ExplainerVideoAsset {
  /** MP4 under apps/web/src/marketing/video/ (h264, embedded via <video>). */
  file: string;
  /** Poster PNG shown before playback (also the <video> poster + README image). */
  poster: string;
  /** Fallback accessible label (localized copy overrides in i18n). */
  title: string;
  /** Fallback one-line caption. */
  caption: string;
  /** Approx runtime in seconds (kept honest with the rendered clip). */
  durationSeconds: number;
}

export const EXPLAINER: ExplainerVideoAsset = {
  file: "explainer.mp4",
  poster: "explainer-poster.png",
  title: "A guided tour of Weave Steps: build, notate and share a routine",
  caption: "A slow, step-by-step walkthrough — from your first tap to sharing.",
  durationSeconds: 62,
};
