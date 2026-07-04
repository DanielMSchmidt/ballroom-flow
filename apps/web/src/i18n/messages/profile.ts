// Profile screen catalog (see i18n/messages.ts for the pattern: `de: typeof en`
// makes a missing/extra German key a compile error).
const en = {
  title: "Profile",
  displayNameLabel: "Display name",
  displayNamePlaceholder: "How you appear to co-editors",
  colourLegend: "Profile colour",
  colourHint: "Every note & reply of yours is tinted with this, across shared choreos.",
  colourOption: (n: number) => `Use colour ${n}`,
  notePreview: "This is how your notes appear.",
  roleNote:
    "Leader / Follower is a per-figure timeline toggle (remembered between sessions), not a profile setting.",
  planFreeStatus: (owned: number, cap: number) => `Free · ${owned} of ${cap} choreos`,
  planOwned: (owned: number, cap: number | undefined) =>
    `You own ${owned} ${owned === 1 ? "choreo" : "choreos"}${cap ? ` of ${cap}` : ""}.`,
  planPro: "Pro plan",
  planFree: "Free plan",
  languageLegend: "Language",
  languageHint:
    "Applies to menus and the standard vocabulary. Your own notes and custom attributes stay as you wrote them.",
  replayTours: "Replay the intro tours",
  replayToursHint: "Shows each page's quick walkthrough again on its next visit.",
  save: "Save",
  signOut: "Sign out",
};

const de: typeof en = {
  title: "Profil",
  displayNameLabel: "Anzeigename",
  displayNamePlaceholder: "So erscheinst du für Mitbearbeiter",
  colourLegend: "Profilfarbe",
  colourHint: "Jede deiner Notizen & Antworten wird damit eingefärbt — in allen geteilten Choreos.",
  colourOption: (n) => `Farbe ${n} verwenden`,
  notePreview: "So erscheinen deine Notizen.",
  roleNote:
    "Leader / Follower ist ein Umschalter pro Figur in der Schrittansicht (wird zwischen Sitzungen gemerkt), keine Profileinstellung.",
  planFreeStatus: (owned, cap) => `Gratis · ${owned} von ${cap} Choreos`,
  planOwned: (owned, cap) =>
    owned === 1
      ? `Dir gehört 1 Choreo${cap ? ` von ${cap}` : ""}.`
      : `Dir gehören ${owned} Choreos${cap ? ` von ${cap}` : ""}.`,
  planPro: "Pro-Tarif",
  planFree: "Gratis-Tarif",
  languageLegend: "Sprache",
  languageHint:
    "Gilt für Menüs und das Standardvokabular. Eigene Notizen und eigene Attribute bleiben, wie du sie geschrieben hast.",
  replayTours: "Die Einführungstouren erneut ansehen",
  replayToursHint: "Zeigt die kurze Einführung jeder Seite beim nächsten Besuch erneut.",
  save: "Speichern",
  signOut: "Abmelden",
};

export const profileMessages = { en, de };
