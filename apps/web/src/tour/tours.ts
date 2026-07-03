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
// The copy itself lives in i18n/messages/tours.ts; each page's steps are BUILT
// on access (property getters + pickMessages), never frozen at module load, so
// a tour started after a locale switch speaks the current language.
import { pickMessages } from "../i18n/messages";
import { tourMessages } from "../i18n/messages/tours";

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
  get choreos() {
    const t = pickMessages(tourMessages).choreos;
    return [
      { ...t.welcome },
      { element: "[data-tour='new-choreo']", ...t.newChoreo },
      { element: "[data-tour='nav-library']", ...t.navLibrary },
      { element: "[data-tour='nav-journal']", ...t.navJournal },
      { element: "[data-tour='nav-profile']", ...t.navProfile },
    ];
  },
  get library() {
    const t = pickMessages(tourMessages).library;
    return [
      { element: "[data-tour='library-tabs']", ...t.tabs },
      { element: "[data-tour='library-filter']", ...t.filter },
      { element: "[data-tour='library-save']", ...t.save },
    ];
  },
  get journal() {
    const t = pickMessages(tourMessages).journal;
    return [
      { element: "[data-tour='journal-new']", ...t.newEntry },
      { element: "[data-tour='journal-filters']", ...t.filters },
    ];
  },
  get profile() {
    const t = pickMessages(tourMessages).profile;
    return [
      { element: "[data-tour='profile-name']", ...t.name },
      { element: "[data-tour='profile-colour']", ...t.colour },
    ];
  },
  get assemble() {
    const t = pickMessages(tourMessages).assemble;
    return [
      { element: "[data-tour='role-toggle']", ...t.roleToggle },
      { element: "[data-tour='lens-toggle']", ...t.lensToggle },
      { element: "[data-tour='share']", ...t.share },
      { element: "[data-tour='quick-note']", ...t.quickNote },
    ];
  },
};
