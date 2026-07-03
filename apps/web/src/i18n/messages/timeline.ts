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
  moreComments: (n: number) => `+${n} more`,
  addNote: "Add note",
  addNoteWholeFigure: "Add note — whole figure",
  wholeFigure: "Whole figure",
  libraryFigure: "Library figure",
  customFigure: "Custom figure",
  pagerPosition: (index: number, total: number) => `${index} of ${total}`,

  // Figure timeline (FigureTimeline)
  barsStepperLabel: "Bars",
  barsStepperUnit: "bars",
  inYourLibrary: "In your library",
  addToMyLibrary: "Add to my library",
  madeYours: "Made this figure yours",
  variantOf: (base: string | undefined) => `Variant of ${base ?? "the base figure"}`,
  forkIntoVariant: "Fork into variant",
  stepGrid: "Step grid",
  countHeader: "Count",
  helperCaption:
    "tap a cell to add / edit one attribute · * required · scroll → Head & custom types",
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
  moreComments: (n) => `+${n} weitere`,
  addNote: "Notiz hinzufügen",
  addNoteWholeFigure: "Notiz hinzufügen — ganze Figur",
  wholeFigure: "Ganze Figur",
  libraryFigure: "Bibliotheksfigur",
  customFigure: "Eigene Figur",
  pagerPosition: (index, total) => `${index} von ${total}`,

  barsStepperLabel: "Takte",
  barsStepperUnit: "Takte",
  inYourLibrary: "In deiner Bibliothek",
  addToMyLibrary: "Zu meiner Bibliothek hinzufügen",
  madeYours: "Diese Figur gehört jetzt dir",
  variantOf: (base) => (base ? `Variante von ${base}` : "Variante der Ausgangsfigur"),
  forkIntoVariant: "Als Variante abzweigen",
  stepGrid: "Schrittraster",
  countHeader: "Zählzeit",
  helperCaption:
    "tippe auf eine Zelle, um ein Attribut hinzuzufügen / zu bearbeiten · * erforderlich · scrollen → Head & eigene Typen",
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
