// First-visit tour catalog (see i18n/messages.ts for the pattern: `de: typeof en`
// makes a missing/extra German key a compile error). `chrome` is the driver.js
// button/progress copy; the `{{current}}`/`{{total}}` placeholders are
// driver.js's OWN template syntax and must survive in every language.
const en = {
  chrome: {
    next: "Next",
    back: "Back",
    done: "Got it",
    progress: "{{current}} of {{total}}",
  },
  choreos: {
    welcome: {
      title: "Welcome to Weave Steps",
      description:
        "This is your choreo list — every routine you build or join lives here. Here's a quick look around; skip any time.",
    },
    newChoreo: {
      title: "Start a choreo",
      description: "Pick the dance, name it, and start placing figures section by section.",
    },
    navLibrary: {
      title: "Figure Library",
      description:
        "Browse the shared figure catalog, and keep the figures you reuse under My figures.",
    },
    navJournal: {
      title: "Journal",
      description: "Lesson and practice notes, linked to the exact step or figure they're about.",
    },
    navProfile: {
      title: "Profile",
      description:
        "Set your name and note colour — every note you write is tinted with it, so partners know who said what.",
    },
  },
  library: {
    tabs: {
      title: "Catalog & My figures",
      description:
        "The Catalog is the shared figure reference. My figures holds the ones you've saved to reuse.",
    },
    filter: {
      title: "Filter by dance",
      description: "Show only the figures of one dance, or All to browse everything.",
    },
    save: {
      title: "Save a figure",
      description:
        "↟ save puts a catalog figure into My figures — a frozen copy that's yours to adapt.",
    },
  },
  journal: {
    newEntry: {
      title: "Write an entry",
      description:
        "Capture what changed in a lesson or practice — while it's fresh. Entries can link to a step, a figure, or a whole figure family.",
    },
    filters: {
      title: "Find entries again",
      description: "Filter by lessons, practice, or everything that touches one figure.",
    },
  },
  profile: {
    name: {
      title: "Your name",
      description: "Shown to everyone you share a choreo with.",
    },
    colour: {
      title: "Your note colour",
      description:
        "Every note and reply you write is tinted with this colour, across all shared choreos.",
    },
  },
  assemble: {
    roleToggle: {
      title: "Leader or Follower",
      description:
        "L · F flips the whole programme between the leader's and the follower's steps. Remembered on this device.",
    },
    lensToggle: {
      title: "Read ⇄ edit",
      description:
        "You're in the reading programme. Tap ✎ to switch to the builder and change sections, figures and steps.",
    },
    share: {
      title: "Share",
      description: "Invite your partner or coach — everyone edits the same choreo, live.",
    },
    typeChips: {
      title: "Show only what you're working on",
      description:
        "Tap a chip to tuck that column away — across the whole routine, and every choreo. Step always stays. “+N hidden” on a figure peeks at what's tucked; your picks are remembered.",
    },
    quickNote: {
      title: "Quick note",
      description: "Jot down what the coach just said without leaving the programme.",
    },
  },
};

const de: typeof en = {
  chrome: {
    next: "Weiter",
    back: "Zurück",
    done: "Alles klar",
    progress: "{{current}} von {{total}}",
  },
  choreos: {
    welcome: {
      title: "Willkommen bei Weave Steps",
      description:
        "Das ist deine Choreo-Liste — jede Choreografie, die du baust oder der du beitrittst, findest du hier. Hier ein kurzer Rundgang; überspringen geht jederzeit.",
    },
    newChoreo: {
      title: "Eine Choreo starten",
      description:
        "Wähle den Tanz, gib ihr einen Namen und platziere Figuren Abschnitt für Abschnitt.",
    },
    navLibrary: {
      title: "Figurenbibliothek",
      description:
        "Stöbere im gemeinsamen Figurenkatalog und sammle die Figuren, die du wiederverwendest, unter Meine Figuren.",
    },
    navJournal: {
      title: "Journal",
      description:
        "Notizen aus Unterricht und Training, verknüpft mit genau dem Schritt oder der Figur, um die es geht.",
    },
    navProfile: {
      title: "Profil",
      description:
        "Lege deinen Namen und deine Notizfarbe fest — jede Notiz von dir wird damit eingefärbt, damit Partner wissen, wer was gesagt hat.",
    },
  },
  library: {
    tabs: {
      title: "Katalog & Meine Figuren",
      description:
        "Der Katalog ist das gemeinsame Figuren-Nachschlagewerk. Meine Figuren enthält die, die du zum Wiederverwenden gespeichert hast.",
    },
    filter: {
      title: "Nach Tanz filtern",
      description: "Zeige nur die Figuren eines Tanzes — oder Alle, um alles zu durchstöbern.",
    },
    save: {
      title: "Eine Figur speichern",
      description:
        "↟ speichern legt eine Katalogfigur in Meine Figuren ab — eine eingefrorene Kopie, die du anpassen kannst.",
    },
  },
  journal: {
    newEntry: {
      title: "Einen Eintrag schreiben",
      description:
        "Halte fest, was sich im Unterricht oder Training geändert hat — solange es frisch ist. Einträge können auf einen Schritt, eine Figur oder eine ganze Figurenfamilie verweisen.",
    },
    filters: {
      title: "Einträge wiederfinden",
      description: "Filtere nach Unterricht, Training oder allem, was eine Figur betrifft.",
    },
  },
  profile: {
    name: {
      title: "Dein Name",
      description: "Sichtbar für alle, mit denen du eine Choreo teilst.",
    },
    colour: {
      title: "Deine Notizfarbe",
      description:
        "Jede Notiz und Antwort von dir wird mit dieser Farbe eingefärbt — in allen geteilten Choreos.",
    },
  },
  assemble: {
    roleToggle: {
      title: "Leader oder Follower",
      description:
        "L · F schaltet das ganze Programm zwischen den Schritten des Leaders und des Followers um. Wird auf diesem Gerät gemerkt.",
    },
    lensToggle: {
      title: "Lesen ⇄ Bearbeiten",
      description:
        "Du bist im Leseprogramm. Tippe auf ✎, um zum Bearbeiten zu wechseln und Abschnitte, Figuren und Schritte zu ändern.",
    },
    share: {
      title: "Teilen",
      description: "Lade deinen Partner oder Coach ein — alle bearbeiten dieselbe Choreo, live.",
    },
    typeChips: {
      title: "Zeig nur, woran du gerade arbeitest",
      description:
        "Tippe auf einen Chip, um diese Spalte auszublenden — in der ganzen Choreo und in jeder anderen. Step bleibt immer sichtbar. „+N ausgeblendet“ an einer Figur zeigt kurz, was verborgen ist; deine Auswahl wird gemerkt.",
    },
    quickNote: {
      title: "Schnelle Notiz",
      description: "Notiere, was der Coach gerade gesagt hat, ohne das Programm zu verlassen.",
    },
  },
};

export const tourMessages = { en, de };
