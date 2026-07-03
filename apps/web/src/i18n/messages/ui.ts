// UI primitives catalog — the English DEFAULT strings the ui/ components fall
// back to when a caller passes no label (see i18n/messages.ts for the pattern:
// `de: typeof en` makes a missing/extra German key a compile error).
const en = {
  navPrimaryLabel: "Primary navigation",
  navTabBarLabel: "Tab bar",
  offlineTitle: "You're offline",
  offlineDescription:
    "This choreo's data needs a connection to load. The app itself still works — reconnect to see the latest.",
  accessDeniedTitle: "You don't have access",
  accessDeniedDescription:
    "You're not a member of this choreo, so it can't be opened. Ask the owner for an invite link to join.",
  scopeLibrary: "Library",
  scopeCustom: "Custom",
  // Leading space: appended directly after the scope word for screen readers.
  scopeFigureSuffix: " figure",
  offlineBanner:
    "You're offline — showing what's saved on this device. Changes sync when you're back online.",
  notifications: "Notifications",
  dismissNotification: "Dismiss notification",
  close: "Close",
  cancel: "Cancel",
  back: "Back",
  loading: "Loading",
  working: "Working",
};

const de: typeof en = {
  navPrimaryLabel: "Hauptnavigation",
  navTabBarLabel: "Tab-Leiste",
  offlineTitle: "Du bist offline",
  offlineDescription:
    "Die Daten dieser Choreo brauchen zum Laden eine Verbindung. Die App selbst funktioniert weiter — verbinde dich neu, um den neuesten Stand zu sehen.",
  accessDeniedTitle: "Du hast keinen Zugriff",
  accessDeniedDescription:
    "Du bist kein Mitglied dieser Choreo, deshalb kann sie nicht geöffnet werden. Bitte den Inhaber um einen Einladungslink, um beizutreten.",
  scopeLibrary: "Bibliothek",
  scopeCustom: "Eigene",
  scopeFigureSuffix: " Figur",
  offlineBanner:
    "Du bist offline — angezeigt wird, was auf diesem Gerät gespeichert ist. Änderungen werden synchronisiert, sobald du wieder online bist.",
  notifications: "Benachrichtigungen",
  dismissNotification: "Benachrichtigung schließen",
  close: "Schließen",
  cancel: "Abbrechen",
  back: "Zurück",
  loading: "Lädt",
  working: "Wird ausgeführt",
};

export const uiMessages = { en, de };
