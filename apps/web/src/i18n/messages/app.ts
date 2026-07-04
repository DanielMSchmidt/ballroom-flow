// App shell catalog (App.tsx + auth controls). See i18n/messages.ts for the
// pattern: `de: typeof en` makes a missing/extra German key a compile error.
const en = {
  navChoreo: "Choreo",
  navLibrary: "Library",
  navJournal: "Journal",
  navProfile: "Profile",
  onboardingNudge: "Add your name and note colour so co-editors know who's who.",
  setUpProfile: "Set up profile",
  libraryViewLabel: "Library view",
  libraryTabCatalog: "Catalog",
  libraryTabMine: "My figures",
  comingSoon: "Coming soon",
  comingSoonBody: "This screen lands in a later milestone.",
  loadingApp: "Loading Weave Steps",
  signIn: "Sign in",
  signedIn: "Signed in",
};

const de: typeof en = {
  navChoreo: "Choreo",
  navLibrary: "Bibliothek",
  navJournal: "Journal",
  navProfile: "Profil",
  onboardingNudge:
    "Füge deinen Namen und deine Notizfarbe hinzu, damit Mitbearbeiter wissen, wer wer ist.",
  setUpProfile: "Profil einrichten",
  libraryViewLabel: "Bibliotheksansicht",
  libraryTabCatalog: "Katalog",
  libraryTabMine: "Meine Figuren",
  comingSoon: "Bald verfügbar",
  comingSoonBody: "Diese Ansicht kommt in einem späteren Meilenstein.",
  loadingApp: "Weave Steps wird geladen",
  signIn: "Anmelden",
  signedIn: "Angemeldet",
};

export const appMessages = { en, de };
