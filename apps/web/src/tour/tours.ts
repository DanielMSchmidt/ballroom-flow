// First-visit UI tours — the step scripts, one per top-level page.
// =================================================================
// Each page gets a short, skippable coach-mark tour the FIRST time it is
// viewed (persisted per page in localStorage — see useFirstVisitTour). Steps
// anchor to `[data-tour="…"]` attributes on the real UI; a step whose target
// isn't currently in the DOM (e.g. the save affordance while signed out) is
// silently dropped, so the tour always fits what the user actually sees.
//
// Copy style: title = the control's name; description = one plain sentence on
// what it's for. Keep tours ≤5 steps — they explain the screen, not the app.

export const TOUR_PAGE_IDS = ["choreos", "library", "journal", "profile", "assemble"] as const;
export type TourPageId = (typeof TOUR_PAGE_IDS)[number];

export interface TourStepDef {
  /** CSS selector of the highlighted control. When it matches several nodes
   *  (e.g. the nav renders both a mobile bar and a desktop rail), the first
   *  VISIBLE match is highlighted. Omit for a centered, unanchored step. */
  element?: string;
  title: string;
  description: string;
}

export const TOURS: Record<TourPageId, TourStepDef[]> = {
  choreos: [
    {
      title: "Welcome to Ballroom Flow",
      description:
        "This is your choreo list — every routine you build or join lives here. Here's a quick look around; skip any time.",
    },
    {
      element: "[data-tour='new-choreo']",
      title: "Start a choreo",
      description: "Pick the dance, name it, and start placing figures section by section.",
    },
    {
      element: "[data-tour='nav-library']",
      title: "Figure Library",
      description:
        "Browse the shared figure catalog, and keep the figures you reuse under My figures.",
    },
    {
      element: "[data-tour='nav-journal']",
      title: "Journal",
      description: "Lesson and practice notes, linked to the exact step or figure they're about.",
    },
    {
      element: "[data-tour='nav-profile']",
      title: "Profile",
      description:
        "Set your name and note colour — every note you write is tinted with it, so partners know who said what.",
    },
  ],
  library: [
    {
      element: "[data-tour='library-tabs']",
      title: "Catalog & My figures",
      description:
        "The Catalog is the shared figure reference. My figures holds the ones you've saved to reuse.",
    },
    {
      element: "[data-tour='library-filter']",
      title: "Filter by dance",
      description: "Show only the figures of one dance, or All to browse everything.",
    },
    {
      element: "[data-tour='library-save']",
      title: "Save a figure",
      description:
        "↟ save puts a catalog figure into My figures — a frozen copy that's yours to adapt.",
    },
  ],
  journal: [
    {
      element: "[data-tour='journal-new']",
      title: "Write an entry",
      description:
        "Capture what changed in a lesson or practice — while it's fresh. Entries can link to a step, a figure, or a whole figure family.",
    },
    {
      element: "[data-tour='journal-filters']",
      title: "Find entries again",
      description: "Filter by lessons, practice, or everything that touches one figure.",
    },
  ],
  profile: [
    {
      element: "[data-tour='profile-name']",
      title: "Your name",
      description: "Shown to everyone you share a choreo with.",
    },
    {
      element: "[data-tour='profile-colour']",
      title: "Your note colour",
      description:
        "Every note and reply you write is tinted with this colour, across all shared choreos.",
    },
  ],
  assemble: [
    {
      element: "[data-tour='role-toggle']",
      title: "Leader or Follower",
      description: "Flip the whole programme between the leader's and the follower's steps.",
    },
    {
      element: "[data-tour='lens-toggle']",
      title: "Read ⇄ edit",
      description:
        "You're in the reading programme. Tap ✎ to switch to the builder and change sections, figures and steps.",
    },
    {
      element: "[data-tour='share']",
      title: "Share",
      description: "Invite your partner or coach — everyone edits the same choreo, live.",
    },
    {
      element: "[data-tour='quick-note']",
      title: "Quick note",
      description: "Jot down what the coach just said without leaving the programme.",
    },
  ],
};
