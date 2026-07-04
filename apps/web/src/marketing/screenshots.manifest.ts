// Single source of truth for the landing-page gallery AND the CI diff/comment
// script. The Playwright @screenshots journey writes a PNG per `file`; Landing
// imports them; scripts/screenshot-diff.mjs diffs them in this order.
export interface Screenshot {
  /** Stable id used by the journey + diff classification. */
  key: string;
  /** File name under apps/web/src/marketing/screenshots/. */
  file: string;
  /** Accessible alt text (also the landing <img> alt). */
  alt: string;
  /** Human caption shown under the image on the landing page. */
  caption: string;
}

export const SCREENSHOTS: Screenshot[] = [
  {
    key: "hero",
    file: "hero.png",
    alt: "A Waltz routine laid out in Weave Steps",
    caption: "Your whole routine, figure by figure.",
  },
  {
    key: "create",
    file: "create.png",
    alt: "Creating a new Waltz routine",
    caption: "Start a routine in seconds — pick a dance and go.",
  },
  {
    key: "sections",
    file: "sections.png",
    alt: "A routine organised into Long Side and Short Side sections",
    caption: "Organise figures by the floor: Long Side, Short Side, corners.",
  },
  {
    key: "notate",
    file: "notate.png",
    alt: "Notating a figure across technique dimensions",
    caption: "Annotate every step — footwork, rise & fall, sway, turn.",
  },
  {
    key: "lanes",
    file: "lanes.png",
    alt: "The Lanes cross-step technique grid",
    caption: "See one technique across every step in the Lanes grid.",
  },
  {
    key: "reading",
    file: "reading.png",
    alt: "The read-only reading view for sharing with a coach",
    caption: "Share a clean reading view with your partner and coach.",
  },
];
