// Explainer-video catalog (see i18n/messages.ts for the `de: typeof en` pattern
// that makes a missing/extra German key a compile error). Shared by the Landing
// hero, the Choreo-list empty state, and the "watch the tour" reveal.
const en = {
  title: "A guided tour: build a routine step by step, notate it, and share it.",
  caption: "A slow, hand-held walkthrough — from your first tap to sharing a routine.",
  watchTour: "Watch the guided tour",
  hideTour: "Hide the tour",
  unsupported: "Your browser can't play this video.",
};

const de: typeof en = {
  title: "Eine geführte Tour: Choreo Schritt für Schritt bauen, notieren und teilen.",
  caption: "Eine langsame, geführte Tour — vom ersten Tippen bis zum Teilen einer Choreo.",
  watchTour: "Geführte Tour ansehen",
  hideTour: "Tour ausblenden",
  unsupported: "Dein Browser kann dieses Video nicht abspielen.",
};

export const explainerMessages = { en, de };
