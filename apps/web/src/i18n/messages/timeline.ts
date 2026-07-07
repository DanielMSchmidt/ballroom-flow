// Reading view + figure timeline + lanes catalog (see i18n/messages.ts for the
// pattern: `de: typeof en` makes a missing/extra German key a compile error).
// Leader/Follower stay untranslated by convention (glossary), so en === de there.
// Column labels (Step/Rise/…) arrive already localized from reading-columns.ts —
// the functions here only compose around them.
const en = {
  // Shared (reading view + timeline)
  stepsFor: "Steps for",
  leader: "Leader",
  follower: "Follower",
  // Counts ⇄ slow/quick timing lens (Tango/Foxtrot/Quickstep).
  timingLens: "Timing notation",
  countsLens: "Counts (1 & 2)",
  slowQuickLens: "Slows & quicks (S Q)",
  aboutColumn: (column: string) => `About ${column}`,
  countN: (n: number | string) => `count ${n}`,
  bars: (n: number) => `${n} bar${n === 1 ? "" : "s"}`,

  // Reading view (RoutineReadingView)
  noSections: "This choreo has no sections yet.",
  noFiguresInSection: "No figures in this section.",
  figureUnavailable: "This figure is unavailable.",
  loadingFigure: "Loading figure…",
  breakLabel: "Break",
  noStepsYet: "No steps noted yet.",
  figureSteps: (name: string) => `${name} steps`,
  aboutValue: (column: string, value: string) => `About ${column} — ${value}`,
  addNote: "Add note",
  libraryFigure: "Library figure",
  customFigure: "Custom figure",
  pagerPosition: (index: number, total: number) => `${index} of ${total}`,
  emptyFigureSub: "empty",

  // Column picker + notes margin (Builder v3)
  shownColumns: "Shown technique columns",
  hideColumn: (column: string) => `Hide the ${column} column`,
  showColumn: (column: string) => `Show the ${column} column`,
  readingHint: "pick up to 4 columns above · notes live in the right margin — tap ＋ to add",
  notesHeader: "NOTES",
  notesForCount: (count: string) => `Notes — count ${count}`,
  notesForFigure: (name: string) => `Notes — ${name}`,

  // Figure timeline (FigureTimeline)
  barsStepperLabel: "Bars",
  barsStepperUnit: "bars",
  inYourLibrary: "In your library",
  addToMyLibrary: "Add to my library",
  adjustedStill: (name: string) => `adjusted for this choreo — still ${name}`,
  madeYours: "Made this figure yours",
  variantOf: (base: string | undefined) => `Variant of ${base ?? "the base figure"}`,
  forkIntoVariant: "Fork into variant",
  stepGrid: "Step grid",
  countHeader: "Count",
  helperCaption:
    "tap ＋ to add an attribute — nothing is required · scroll sideways for more types",
  barN: (n: number) => `bar ${n}`,
  subBeatTitle: (symbol: string, vulgar: string) => `the ${symbol} (${vulgar} beat)`,
  countAttributes: (count: number) => `count ${count} attributes`,
  editCell: (column: string, count: string) => `Edit ${column} at count ${count}`,
  addCell: (column: string, count: string) => `Add ${column} at count ${count}`,

  // Lanes
  viewing: "Viewing:",
  flipRoleTo: (target: string) => `Flip role to ${target}`,
  lane: (kindLabel: string) => `${kindLabel} lane`,
};

const de: typeof en = {
  stepsFor: "Schritte für",
  leader: "Leader",
  follower: "Follower",
  timingLens: "Timing-Notation",
  countsLens: "Zählzeiten (1 & 2)",
  slowQuickLens: "Langsam & schnell (S Q)",
  aboutColumn: (column) => `Über ${column}`,
  countN: (n) => `Zählzeit ${n}`,
  bars: (n) => (n === 1 ? "1 Takt" : `${n} Takte`),

  noSections: "Diese Choreo hat noch keine Abschnitte.",
  noFiguresInSection: "Keine Figuren in diesem Abschnitt.",
  figureUnavailable: "Diese Figur ist nicht verfügbar.",
  loadingFigure: "Figur lädt …",
  breakLabel: "Pause",
  noStepsYet: "Noch keine Schritte notiert.",
  figureSteps: (name) => `Schritte von ${name}`,
  aboutValue: (column, value) => `Über ${column} — ${value}`,
  addNote: "Notiz hinzufügen",
  libraryFigure: "Bibliotheksfigur",
  customFigure: "Eigene Figur",
  pagerPosition: (index, total) => `${index} von ${total}`,
  emptyFigureSub: "leer",

  shownColumns: "Angezeigte Technik-Spalten",
  hideColumn: (column) => `Spalte ${column} ausblenden`,
  showColumn: (column) => `Spalte ${column} einblenden`,
  readingHint:
    "wähle oben bis zu 4 Spalten · Notizen stehen rechts am Rand — zum Hinzufügen ＋ tippen",
  notesHeader: "NOTIZEN",
  notesForCount: (count) => `Notizen — Zählzeit ${count}`,
  notesForFigure: (name) => `Notizen — ${name}`,

  barsStepperLabel: "Takte",
  barsStepperUnit: "Takte",
  inYourLibrary: "In deiner Bibliothek",
  addToMyLibrary: "Zu meiner Bibliothek hinzufügen",
  adjustedStill: (name) => `für diese Choreo angepasst — weiterhin ${name}`,
  madeYours: "Diese Figur gehört jetzt dir",
  variantOf: (base) => (base ? `Variante von ${base}` : "Variante der Ausgangsfigur"),
  forkIntoVariant: "Als Variante abzweigen",
  stepGrid: "Schrittraster",
  countHeader: "Zählzeit",
  helperCaption:
    "tippe auf ＋, um ein Attribut hinzuzufügen — nichts ist Pflicht · seitwärts scrollen für weitere Typen",
  barN: (n) => `Takt ${n}`,
  subBeatTitle: (symbol, vulgar) => `das ${symbol} (${vulgar} Schlag)`,
  countAttributes: (count) => `Attribute bei Zählzeit ${count}`,
  editCell: (column, count) => `${column} bei Zählzeit ${count} bearbeiten`,
  addCell: (column, count) => `${column} bei Zählzeit ${count} hinzufügen`,

  viewing: "Ansicht:",
  flipRoleTo: (target) => `Rolle zu ${target} wechseln`,
  lane: (kindLabel) => `Spur: ${kindLabel}`,
};

export const timelineMessages = { en, de };
