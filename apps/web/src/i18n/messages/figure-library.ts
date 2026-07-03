// Figure Library catalog (see i18n/messages.ts for the pattern: `de: typeof en`
// makes a missing/extra German key a compile error). Figure names themselves
// (e.g. "Natural Turn") are canonical syllabus names from the domain catalog and
// are never translated — only the surrounding UI copy is.
const en = {
  title: "Figure Library",
  subtitle: "the shared figure catalogue · filter by dance",
  filter: (dance: string) => `Filter: ${dance}`,
  filterByDance: "Filter by dance",
  all: "All",
  myFigures: "My figures",
  catalog: "Catalog",
  catalogFor: (dance: string) => `Catalog · ${dance}`,
  emptyMineTitle: "Nothing in My figures for this dance yet",
  emptyMineDescription: "↟ save a catalog figure and it lands here.",
  savedBadge: "saved",
  customBadge: "custom",
  basedOn: (name: string) => `based on ${name}`,
  yourOwnFigure: "your own figure",
  libraryFigureFallback: "a library figure",
  notInChoreoYet: "not in a choreo yet",
  usedIn: (n: number) => `used in ${n} ${n === 1 ? "choreo" : "choreos"}`,
  editFigure: (title: string | null | undefined) => `Edit ${title ?? "figure"}`,
  saveAria: (name: string) => `Save ${name} to My figures`,
  save: "save",
  toastSaved: "Saved to My figures",
  toastAlreadySaved: "Already in My figures",
  toastSaveFailed: "Couldn't save to My figures",
  toastView: "View",
};

const de: typeof en = {
  title: "Figurenbibliothek",
  subtitle: "der gemeinsame Figurenkatalog · nach Tanz filtern",
  filter: (dance) => `Filter: ${dance}`,
  filterByDance: "Nach Tanz filtern",
  all: "Alle",
  myFigures: "Meine Figuren",
  catalog: "Katalog",
  catalogFor: (dance) => `Katalog · ${dance}`,
  emptyMineTitle: "Für diesen Tanz ist noch nichts in Meine Figuren",
  emptyMineDescription: "↟ speichere eine Katalogfigur und sie landet hier.",
  savedBadge: "gespeichert",
  customBadge: "eigen",
  basedOn: (name) => `basiert auf ${name}`,
  yourOwnFigure: "deine eigene Figur",
  libraryFigureFallback: "eine Bibliotheksfigur",
  notInChoreoYet: "noch in keiner Choreo",
  usedIn: (n) => (n === 1 ? "in 1 Choreo verwendet" : `in ${n} Choreos verwendet`),
  editFigure: (title) => `${title ?? "Figur"} bearbeiten`,
  saveAria: (name) => `${name} in Meine Figuren speichern`,
  save: "speichern",
  toastSaved: "In Meine Figuren gespeichert",
  toastAlreadySaved: "Schon in Meine Figuren",
  toastSaveFailed: "Konnte nicht in Meine Figuren speichern",
  toastView: "Ansehen",
};

export const figureLibraryMessages = { en, de };
