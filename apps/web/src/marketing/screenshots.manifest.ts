// Single source of truth for the landing-page gallery AND the CI diff/comment
// script. The Playwright @screenshots journey writes a PNG per `file`; Landing
// imports them; scripts/screenshot-diff.mjs diffs them in this order.
// NOT every entry is on the landing page — Landing picks its keys via its own
// FEATURES list; the rest exist purely for the PR visual diff (e.g. the
// add-figure picker pair).
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
  {
    key: "figure",
    file: "figure.png",
    alt: "The read-only figure view: the step grid with notes beneath",
    caption: "Tap a figure while reading — steps and notes, no accidental edits.",
  },
  // Diff-only (not in Landing's FEATURES): the add-figure picker pair —
  // the searchable library with the always-present "Create my own figure"
  // row, and the compose view it swaps to.
  {
    key: "addfigure",
    file: "addfigure.png",
    alt: "The add-figure picker: searchable library with a Create my own figure row",
    caption: "Search the library — or create your own figure, always one tap away.",
  },
  {
    key: "composefigure",
    file: "composefigure.png",
    alt: "The compose view for a new custom figure: name and length",
    caption: "Name your figure and set its length — steps come whenever you're ready.",
  },
];
