// Landing (logged-out marketing page) catalog (see i18n/messages.ts for the
// pattern: `de: typeof en` makes a missing/extra German key a compile error).
// Screenshot captions/alts are keyed by the manifest's stable `key` so the
// manifest itself (which also drives the CI screenshot pipeline) stays
// untouched: `en` mirrors it byte-for-byte and Landing falls back to the
// manifest copy for any unknown key.
const en = {
  heroTitle: "Build ballroom choreography, step by step.",
  heroBlurb:
    "Ballroom Flow is a mobile-first studio for couples and coaches to assemble routines, annotate every step's technique, and keep it all in sync across your devices.",
  closingCta: "Ready to build your next routine?",
  captions: {
    hero: "Your whole routine, figure by figure.",
    create: "Start a routine in seconds — pick a dance and go.",
    sections: "Organise figures by the floor: Long Side, Short Side, corners.",
    notate: "Annotate every step — footwork, rise & fall, sway, turn.",
    lanes: "See one technique across every step in the Lanes grid.",
    reading: "Share a clean reading view with your partner and coach.",
  },
  alts: {
    hero: "A Waltz routine laid out in Ballroom Flow",
    create: "Creating a new Waltz routine",
    sections: "A routine organised into Long Side and Short Side sections",
    notate: "Notating a figure across technique dimensions",
    lanes: "The Lanes cross-step technique grid",
    reading: "The read-only reading view for sharing with a coach",
  },
};

const de: typeof en = {
  heroTitle: "Erstelle Ballroom-Choreografien, Schritt für Schritt.",
  heroBlurb:
    "Ballroom Flow ist ein Mobile-First-Studio, in dem Paare und Coaches Choreos zusammenstellen, die Technik jedes Schritts annotieren und alles auf allen Geräten synchron halten.",
  closingCta: "Bereit für deine nächste Choreo?",
  captions: {
    hero: "Deine ganze Choreo, Figur für Figur.",
    create: "Starte eine Choreo in Sekunden — Tanz auswählen und los.",
    sections: "Ordne Figuren nach dem Parkett: lange Seite, kurze Seite, Ecken.",
    notate: "Annotiere jeden Schritt — Fußarbeit, Heben & Senken, Neigung, Drehung.",
    lanes: "Sieh eine Technik über alle Schritte hinweg im Lanes-Raster.",
    reading: "Teile eine aufgeräumte Leseansicht mit Partner und Coach.",
  },
  alts: {
    hero: "Eine Walzer-Choreo, ausgelegt in Ballroom Flow",
    create: "Eine neue Walzer-Choreo erstellen",
    sections: "Eine Choreo, gegliedert in Abschnitte für lange und kurze Seite",
    notate: "Eine Figur über mehrere Technik-Dimensionen notieren",
    lanes: "Das Lanes-Raster mit einer Technik über alle Schritte",
    reading: "Die schreibgeschützte Leseansicht zum Teilen mit dem Coach",
  },
};

export const landingMessages = { en, de };
