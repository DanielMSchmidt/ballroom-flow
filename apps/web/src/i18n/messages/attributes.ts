// Attribute editing/info surfaces catalog — the per-count editor (frame 1.12),
// the attribute explainer (frame 1.13), the add-kind picker/builder (frames
// 1.15/1.16), and Profile's attribute-types manager (frame 1.17). See
// i18n/messages.ts for the pattern: `de: typeof en` makes a missing/extra
// German key a compile error.
//
// Registry kind labels/descriptions/valueDefs arrive pre-localized via
// useLocalizedRegistry; user-created kind labels and values are single-language
// and render verbatim — neither is re-translated here.
const en = {
  // AttributeEditor (frame 1.12)
  attributesForCount: (n: number) => `Attributes for count ${n}`,
  rolesLegend: "Roles",
  rolesSameForBoth: "Same for both",
  rolesPerRole: "Per role",
  moreAttributes: "More attributes",
  fewerAttributes: "Fewer attributes",
  remove: "Remove",
  removeAttribute: "remove attribute",
  save: "Save",
  add: "Add",
  aboutKind: (label: string) => `About ${label}`,
  customValueLabel: (label: string) => `Custom ${label}`,
  customValuePlaceholder: (label: string) => `Custom ${label.toLowerCase()}…`,

  // AttributeInfoSheet (frame 1.13)
  explainerSubtitle: "attribute explainer · back returns to your spot",
  backToSpot: "Back to your spot",
  valuesHeading: "Values",
  usedIn: (n: number, scope?: string) =>
    `Used in ${n} step${n === 1 ? "" : "s"}${scope ? ` across ${scope}` : ""}.`,
  tapValueHint: "Tap a value to see every step that uses it.",
  seeStepsUsing: (value: string) => `See steps using ${value}`,
  pagerPosition: (i: number, n: number) => `${i} of ${n}`,

  // attribute-info.ts — the per-kind "what is this" subtitles (standard kinds).
  glossarySubtitles: {
    direction: "where the step travels",
    footwork: "what touches the floor, in order",
    rise: "the up-and-down through the step",
    position: "the dance position / hold",
    bodyActions: "body actions through the step",
    sway: "the lean of the body",
    turn: "amount & direction of turn",
  },

  // AddKindSheet (frame 1.16) — the custom-type builder.
  addKindTitle: "Add attribute kind",
  labelField: "Label",
  labelPlaceholder: "e.g. Energy",
  descriptionField: "Description",
  descriptionPlaceholder: "e.g. How much drive the step carries",
  descriptionHint: "One line shown in the attribute info sheet (optional)",
  colorField: "Color",
  cardinalityField: "Cardinality",
  cardinalitySingle: "Single",
  cardinalityMulti: "Multi",
  valueTypeField: "Value type",
  valueTypeEnum: "Enum (fixed list)",
  valueTypeText: "Text (free-form)",
  valuesField: "Values",
  valuesPlaceholder: "e.g. low, medium, high",
  valuesHint: "Comma-separated list (used for enum kinds)",
  errorLabelRequired: "Label is required",
  errorInvalidName: "Enter a valid name",
  errorReservedName: "That name is reserved",
  errorEnumValues: "At least one value is required for enum kinds",
  valueDefsLegend: "Value definitions (optional)",
  definitionFor: (v: string) => `Definition for "${v}"`,
  definitionPlaceholder: (v: string) => `What "${v}" means`,
  differsByRole: "Differs by leader / follower",
  requiredToggle: "Required (a core slot for every step)",
  create: "Create",

  // AddKindPicker (frame 1.15) + AttributeTypesManager (frame 1.17) badges.
  addAttributeTitle: "Add an attribute",
  requiredKindTitle: "Required attribute type",
  requiredBadge: "required",
  roleAwareTitle: "Commonly differs by leader / follower",
  roleAwareBadge: "L/F",
  multiBadge: "multi",
  customBadge: "custom",
  newAttributeType: "new attribute type",

  // AttributeTypesManager (frame 1.17)
  attributeTypes: "Attribute types",
  newType: "new type",
  scopeThisChoreo: "this choreo",
  scopeStandard: "standard",
  typesExplainer:
    "Standard types are shared by everyone · custom types are scoped to a choreo so partners see them.",
};

const de: typeof en = {
  // AttributeEditor (frame 1.12)
  attributesForCount: (n) => `Attribute für Zählzeit ${n}`,
  rolesLegend: "Rollen",
  rolesSameForBoth: "Gleich für beide",
  rolesPerRole: "Pro Rolle",
  moreAttributes: "Mehr Attribute",
  fewerAttributes: "Weniger Attribute",
  remove: "Entfernen",
  removeAttribute: "Attribut entfernen",
  save: "Speichern",
  add: "Hinzufügen",
  aboutKind: (label) => `Über ${label}`,
  // German kind labels are capitalized nouns — no lowercasing as in English.
  customValueLabel: (label) => `Eigener Wert für ${label}`,
  customValuePlaceholder: (label) => `Eigener Wert für ${label}…`,

  // AttributeInfoSheet (frame 1.13)
  explainerSubtitle: "Attribut-Erklärung · Zurück bringt dich an deine Stelle",
  backToSpot: "Zurück zu deiner Stelle",
  valuesHeading: "Werte",
  usedIn: (n, scope) =>
    `In ${n === 1 ? "1 Schritt" : `${n} Schritten`}${scope ? ` in ${scope}` : ""} verwendet.`,
  tapValueHint: "Tippe auf einen Wert, um jeden Schritt zu sehen, der ihn verwendet.",
  seeStepsUsing: (value) => `Schritte mit ${value} anzeigen`,
  pagerPosition: (i, n) => `${i} von ${n}`,

  // attribute-info.ts — the per-kind "what is this" subtitles (standard kinds).
  glossarySubtitles: {
    direction: "wohin der Schritt führt",
    footwork: "was den Boden berührt, in welcher Reihenfolge",
    rise: "das Heben & Senken durch den Schritt",
    position: "die Tanzposition / Haltung",
    bodyActions: "Körperaktionen durch den Schritt",
    sway: "die Neigung des Körpers",
    turn: "Grad & Richtung der Drehung",
  },

  // AddKindSheet (frame 1.16) — the custom-type builder.
  addKindTitle: "Attributtyp hinzufügen",
  labelField: "Bezeichnung",
  labelPlaceholder: "z. B. Energie",
  descriptionField: "Beschreibung",
  descriptionPlaceholder: "z. B. Wie viel Schwung der Schritt trägt",
  descriptionHint: "Eine Zeile, die in der Attribut-Erklärung angezeigt wird (optional)",
  colorField: "Farbe",
  cardinalityField: "Kardinalität",
  cardinalitySingle: "Einzeln",
  cardinalityMulti: "Mehrere",
  valueTypeField: "Werttyp",
  valueTypeEnum: "Auswahl (feste Liste)",
  valueTypeText: "Text (Freitext)",
  valuesField: "Werte",
  valuesPlaceholder: "z. B. niedrig, mittel, hoch",
  valuesHint: "Kommagetrennte Liste (für Auswahl-Typen)",
  errorLabelRequired: "Bezeichnung ist erforderlich",
  errorInvalidName: "Gib einen gültigen Namen ein",
  errorReservedName: "Dieser Name ist reserviert",
  errorEnumValues: "Für Auswahl-Typen ist mindestens ein Wert erforderlich",
  valueDefsLegend: "Wertdefinitionen (optional)",
  definitionFor: (v) => `Definition für "${v}"`,
  definitionPlaceholder: (v) => `Was "${v}" bedeutet`,
  differsByRole: "Unterscheidet sich nach Leader / Follower",
  requiredToggle: "Erforderlich (ein Kernfeld für jeden Schritt)",
  create: "Erstellen",

  // AddKindPicker (frame 1.15) + AttributeTypesManager (frame 1.17) badges.
  addAttributeTitle: "Attribut hinzufügen",
  requiredKindTitle: "Erforderlicher Attributtyp",
  requiredBadge: "erforderlich",
  roleAwareTitle: "Unterscheidet sich häufig nach Leader / Follower",
  roleAwareBadge: "L/F",
  multiBadge: "mehrfach",
  customBadge: "eigen",
  newAttributeType: "neuer Attributtyp",

  // AttributeTypesManager (frame 1.17)
  attributeTypes: "Attributtypen",
  newType: "neuer Typ",
  scopeThisChoreo: "diese Choreo",
  scopeStandard: "Standard",
  typesExplainer:
    "Standardtypen sind für alle gleich · eigene Typen gelten pro Choreo, damit Partner sie sehen.",
};

export const attributesMessages = { en, de };
