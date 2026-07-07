// Explainer-video catalog (see i18n/messages.ts for the `de: typeof en` pattern
// that makes a missing/extra German key a compile error). Shared by the Landing
// hero, the Choreo-list empty state, and the "watch the tour" reveal.
const en = {
  title: "A 30-second tour: build a routine, coach it, keep every lesson.",
  caption: "See it in 30 seconds — authoring, coaching and your practice journal.",
  watchTour: "Watch the 30-second tour",
  hideTour: "Hide the tour",
  unsupported: "Your browser can't play this video.",
};

const de: typeof en = {
  title: "Eine 30-Sekunden-Tour: Choreo bauen, coachen, jede Lektion behalten.",
  caption: "In 30 Sekunden — Erstellen, Coaching und dein Übungsjournal.",
  watchTour: "30-Sekunden-Tour ansehen",
  hideTour: "Tour ausblenden",
  unsupported: "Dein Browser kann dieses Video nicht abspielen.",
};

export const explainerMessages = { en, de };
