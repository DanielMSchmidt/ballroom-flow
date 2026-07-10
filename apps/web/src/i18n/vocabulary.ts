// German overlay for the BUILTIN attribute vocabulary + dance names.
//
// The domain's ATTRIBUTE_REGISTRY (packages/domain/vocabulary.ts) stays the
// single ENGLISH source of truth — ids, colors, cardinality, and applicability
// rules are locale-independent and never duplicated here. This module only
// re-skins the human prose (label, description, valueDefs) for German, kind by
// kind. USER-DEFINED kinds pass through untranslated by design (PLAN: user
// content is single-language); the overlay applies to `builtin` kinds only.
//
// Stored VALUES (e.g. "commence", "to_L") are ids and never localized — only
// their display labels are (attribute-display.ts owns the full-label/abbrev
// maps; this file owns the registry prose).
import {
  ATTRIBUTE_REGISTRY,
  type DanceId,
  type RegistryKind,
  type StandardRegistry,
} from "@weavesteps/domain";
import { type Locale, useLocale } from "./locale";

/** Display names for the five Standard dances, per locale. German competitive
 *  naming: the slow waltz is "Langsamer Walzer", foxtrot is "Slowfox". */
const DANCE_NAMES: Record<Locale, Record<DanceId, string>> = {
  en: {
    waltz: "Waltz",
    viennese_waltz: "Viennese Waltz",
    quickstep: "Quickstep",
    foxtrot: "Foxtrot",
    tango: "Tango",
  },
  de: {
    waltz: "Langsamer Walzer",
    viennese_waltz: "Wiener Walzer",
    quickstep: "Quickstep",
    foxtrot: "Slowfox",
    tango: "Tango",
  },
};

/** The display name of a dance in `locale`. */
export function danceName(dance: DanceId, locale: Locale): string {
  return DANCE_NAMES[locale][dance];
}

/** The German prose per builtin kind: label + description + value glossary.
 *  Value KEYS are the registry ids; only display prose is translated. */
interface KindProse {
  label: string;
  description: string;
  valueDefs?: Record<string, string>;
}

const DE_KINDS: Record<string, KindProse> = {
  direction: {
    label: "Richtung",
    description: "Wohin der Schritt über das Parkett führt — die Überschrift des Schritts.",
    valueDefs: {
      forward: "Vorwärts — Schritt vorwärts entlang deiner Linie",
      back: "Rückwärts — Schritt rückwärts",
      side: "Seite — Schritt zur Seite",
      diagonal_forward: "Diagonal vorwärts — Bewegung vorwärts auf einer Diagonale",
      diagonal_back: "Diagonal rückwärts — Bewegung rückwärts auf einer Diagonale",
      behind: "Hinter — kreuzt hinter dem Standbein",
      close: "Schließen — Füße schließen, kein Raumgewinn",
      in_front: "Vorgekreuzt — kreuzt vor dem Standbein (z. B. Lockstep)",
      diagonal: "Diagonal — Bewegung auf einer Diagonale (alter, ungeteilter Wert)",
      in_place: "Am Platz — Gewichtswechsel ohne Raumgewinn",
    },
  },
  footwork: {
    label: "Fußarbeit",
    description:
      "Der Teil des Fußes, der während des Schritts Bodenkontakt hat — in Kontaktreihenfolge gelesen.",
    valueDefs: {
      HT: "HT — Ferse-Spitze: erst Ferse, dann Spitze (z. B. Vorwärtsschritte)",
      TH: "TH — Spitze-Ferse: erst Spitze, dann Ferse (z. B. Rückwärtsschritte, der schließende/senkende Schritt)",
      T: "T — Spitze/Ballen (z. B. Seitschritte im Heben)",
      H: "H — Nur Ferse",
      B: "B — Fußballen",
      WF: "WF — Ganzer Fuß, flach am Boden",
      BF: "BF — Ballen, dann Absenken auf den flachen Fuß",
      IE: "IE — Innenkante des Fußes",
      flat: "F — Flacher Fuß, der ganze Fuß ohne Abrollen",
      "heel turn":
        "Fersendrehung — auf dem Ballen ansetzen, Gewicht auf die Ferse, der schließende Fuß parallel",
      "heel pull":
        "Fersenzug — Drehung auf der Ferse des Standbeins, der freie Fuß wird zurück und zur Seite gezogen",
      "H flat": "H Flat — Ferse, dann der ganze Fuß flach (WDSF-Vorwärtsschritt)",
      HB: "HB — Ferse-Ballen: erst Ferse, dann Ballen (z. B. WDSF-Fersendrehung)",
      BT: "BT — Ballen-Spitze: erst Ballen, dann Spitze",
      TB: "TB — Spitze-Ballen: erst Spitze, dann Ballen",
      THB: "THB — Spitze-Ferse-Ballen abgerollt",
      BHB: "BHB — Ballen-Ferse-Ballen abgerollt (z. B. Pivots)",
      HBH: "HBH — Ferse-Ballen-Ferse abgerollt",
      "I/E of B": "I/E of B — Innenkante des Ballens",
      "I/E of BH": "I/E of BH — Innenkante des Ballens, dann Ferse",
      "O/E of T, BH": "O/E of T, BH — Außenkante der Spitze, dann Ballen-Ferse",
      BH: "BH — Ballen-Ferse: erst Ballen, dann Ferse",
      HTH: "HTH — Ferse-Spitze-Ferse abgerollt",
      THT: "THT — Spitze-Ferse-Spitze abgerollt",
      "T/H/T":
        "T/H/T — Spitze, Ferse, Spitze auf klar getrennten Schlägen (eine Fersendrehungs-Aktion)",
      "H/T": "H/T — Ferse, dann Spitze auf aufeinanderfolgenden Schlägen",
      "T/H": "T/H — Spitze, dann Ferse auf aufeinanderfolgenden Schlägen",
      "T/TH": "T/TH — Spitze, dann Spitze-Ferse",
      "TH/T": "TH/T — Spitze-Ferse, dann Spitze",
    },
  },
  rise: {
    label: "Heben & Senken",
    description: "Heben & Senken — das Heben und Absenken von Körper und Füßen durch den Schritt.",
    valueDefs: {
      commence: "Beginn — das Heben beginnt",
      body_rise: "Körperheben — Heben im Körper, die Füße noch flach",
      foot_rise: "Fußheben — Heben auf die Füße",
      up: "Oben — voll gehoben",
      continue: "Fortsetzen — oben bleiben",
      lowering: "Senken — Absenken",
      body_lower:
        "Körpersenken — der Körper senkt sich, ohne die Füße zu senken (Gegenstück zum Körperheben)",
      NFR: "NFR — kein Fußheben",
    },
  },
  position: {
    label: "Position",
    description: "Die Tanzhaltung bzw. Position, in der der Schritt getanzt wird.",
    valueDefs: {
      closed: "Geschlossen — geschlossene Tanzhaltung, die Partner frontal zueinander",
      promenade: "Promenade — eine V-Form, die offenen Seiten des Paares zueinander",
      counter_promenade: "Gegenpromenade — eine V-Form, zur anderen (geschlossenen) Seite geöffnet",
      fallaway: "Fallaway — Promenadenform in Rückwärtsbewegung",
      outside_partner: "Außenseitlich — Schritt außen am Partner vorbei, meist rechts",
      left_side: "Linksseitlich — die Partner nach links versetzt",
      right_side: "Rechtsseitlich — die Partner nach rechts versetzt",
      tandem: "Tandem — ein Partner direkt vor dem anderen, beide in dieselbe Richtung",
      wing: "Wing — Wing-Position",
      left_angle: "Linkswinkel — die WDSF-Left-Angle-Position (z. B. Twist Turns, Rondes)",
      CBMP: "CBMP — CBM-Position: der Fuß kreuzt die Linie ohne die Körperdrehung",
    },
  },
  bodyActions: {
    label: "Körperaktionen",
    description: "Körperaktionen während des Schritts (mehrere können zutreffen).",
    valueDefs: {
      CBM: "CBM — Contrary Body Movement: die Gegenseite des Körpers dreht zum Schwungbein",
      side_leading: "Seitführung — die gleiche Körperseite geht mit dem tretenden Fuß mit",
      shaping: "Shaping — eine Körperform (Dehnung oder Linie), durch den Schritt gehalten",
      oversway: "Oversway — eine starke Neigungslinie, der Körper über das Standbein gestreckt",
      leg_line: "Beinlinie — eine gestreckte Beinlinie (z. B. eine gestreckte Fußspitze)",
    },
  },
  rotation: {
    label: "Rotation",
    description:
      "Wie Schultern und Hüften durch den Schritt rotieren (die WDSF-Rotationsspalte — Light./Dyn./Lead.).",
    valueDefs: {},
  },
  head: {
    label: "Kopf",
    description:
      "Kopfposition und -bewegung durch den Schritt (die WDSF-Extension-Spalte — z. B. „allmählich zurück, Kopf endet in Pos. 1“).",
    valueDefs: {},
  },
  sway: {
    label: "Neigung",
    description: "Die Neigung des Körpers weg vom Schwungbein.",
    valueDefs: {
      to_L: "Nach L — Neigung nach links",
      to_R: "Nach R — Neigung nach rechts",
      none: "Keine — keine Neigung",
    },
  },
  turn: {
    label: "Drehung",
    description: "Wie viel der Schritt dreht — und in welche Richtung.",
    valueDefs: {
      none: "Keine — keine Drehung",
      eighth_L: "⅛ L — eine Achteldrehung nach links",
      eighth_R: "⅛ R — eine Achteldrehung nach rechts",
      quarter_L: "¼ L — eine Vierteldrehung nach links",
      quarter_R: "¼ R — eine Vierteldrehung nach rechts",
      three_eighth_L: "⅜ L — drei Achtel nach links",
      three_eighth_R: "⅜ R — drei Achtel nach rechts",
      half_L: "½ L — eine halbe Drehung nach links",
      half_R: "½ R — eine halbe Drehung nach rechts",
      five_eighth_L: "⅝ L — fünf Achtel nach links",
      five_eighth_R: "⅝ R — fünf Achtel nach rechts",
      three_quarter_L: "¾ L — eine Dreivierteldrehung nach links",
      three_quarter_R: "¾ R — eine Dreivierteldrehung nach rechts",
      seven_eighth_L: "⅞ L — sieben Achtel nach links",
      seven_eighth_R: "⅞ R — sieben Achtel nach rechts",
      full_L: "Ganze L — eine ganze Drehung nach links",
      full_R: "Ganze R — eine ganze Drehung nach rechts",
    },
  },
};

/**
 * Localize one registry kind's prose. English (the source language) and any
 * non-builtin kind return the input unchanged — user-defined kinds are
 * single-language by design. valueDefs merge OVER the English ones so a value
 * the overlay misses still shows its English definition rather than nothing.
 */
export function localizeKind(kind: RegistryKind, locale: Locale): RegistryKind {
  if (locale === "en" || !kind.builtin) return kind;
  const prose = DE_KINDS[kind.kind];
  if (!prose) return kind;
  return {
    ...kind,
    label: prose.label,
    description: prose.description,
    valueDefs: kind.valueDefs ? { ...kind.valueDefs, ...prose.valueDefs } : prose.valueDefs,
  };
}

// One localized registry per locale, built lazily — the registry is static data,
// so identity-stable results keep React memo/effect deps quiet.
const cache = new Map<Locale, StandardRegistry>();

/** The builtin registry with `locale` prose (identity-stable per locale). */
export function localizedRegistry(locale: Locale): StandardRegistry {
  if (locale === "en") return ATTRIBUTE_REGISTRY;
  let reg = cache.get(locale);
  if (!reg) {
    reg = Object.fromEntries(
      Object.entries(ATTRIBUTE_REGISTRY).map(([id, kind]) => [id, localizeKind(kind, locale)]),
    ) as StandardRegistry;
    cache.set(locale, reg);
  }
  return reg;
}

/** React: the builtin registry in the active locale (re-renders on switch).
 *  Merge sites use this as the `mergeRegistry` base so custom kinds pass
 *  through untranslated. */
export function useLocalizedRegistry(): StandardRegistry {
  return localizedRegistry(useLocale());
}
