// Plain-language reference copy for the attribute info sheet (frame 1.13).
//
// The attribute VALUES live in the domain registry (the single source of truth);
// this is the *presentational* glossary — a one-line human description per kind
// and per value, read in the info sheet. Keyed by the standard kind slug. A
// custom kind has no prose here, so the info sheet falls back to the registry's
// raw values (still useful: title + colour + the value list + usage count).
//
// STORE-DATA GAP: descriptions/value definitions are not modelled on the domain
// RegistryKind, so a custom kind can't carry its own prose yet. If that's wanted,
// add optional `description`/`valueDefs` to RegistryKind (domain) and read them
// here ahead of this map.

export interface KindGloss {
  /** One-line "what is this kind" subtitle (shown under the title). */
  subtitle: string;
  /** A short prose description (the Caveat paragraph in the frame). */
  description: string;
  /** Optional per-value definition, keyed by the registry value. */
  values?: Record<string, string>;
}

export const ATTRIBUTE_GLOSSARY: Record<string, KindGloss> = {
  direction: {
    subtitle: "where the step travels",
    description: "Which way the step travels across the floor — the step's headline.",
    values: {
      forward: "Forward — stepping forward along your line",
      back: "Back — stepping backward",
      side: "Side — stepping to the side",
      close: "Close — feet close together, no travel",
      diag_forward: "Diagonal forward — forward on a diagonal",
      diag_back: "Diagonal back — back on a diagonal",
      in_place: "In place — a weight change with no travel",
    },
  },
  footwork: {
    subtitle: "what touches the floor, in order",
    description:
      "The part of the foot contacting the floor through the step — read in order of contact.",
    values: {
      ball: "Ball — ball of the foot",
      ball_flat: "Ball-Flat — ball, then lowering to flat",
      flat: "Flat — the whole foot flat",
      heel: "Heel — heel leads, e.g. forward walks",
      heel_ball: "Heel-Ball — heel, then rising to ball",
      toe: "Toe — ball/toe only, e.g. side steps in rise",
      tap: "Tap — a tap with no weight taken",
    },
  },
  rise: {
    subtitle: "the up-and-down through the step",
    description: "Rise & fall — the rise and lowering of the body and feet through the step.",
    values: {
      commence: "Commence — the rise begins",
      body_rise: "Body rise — rise through the body, feet still flat",
      foot_rise: "Foot rise — rise onto the feet",
      up: "Up — fully risen",
      continue: "Continue — stay up",
      lowering: "Lowering — lowering down",
      NFR: "NFR — no foot rise",
    },
  },
  position: {
    subtitle: "the dance position / hold",
    description: "The hold or dance position the step is danced in.",
    values: {
      closed: "Closed — closed hold, partners square",
      promenade: "Promenade — a V-shaped promenade position",
      wing: "Wing — wing position",
    },
  },
  bodyActions: {
    subtitle: "body actions through the step",
    description: "Body actions used through the step (more than one can apply).",
    values: {
      CBM: "CBM — Contrary Body Movement: turning the opposite side toward the moving leg",
      CBMP: "CBMP — CBM Position: the foot placed across without the body turn",
    },
  },
  sway: {
    subtitle: "the lean of the body",
    description: "The lean of the body away from the moving foot.",
    values: {
      to_L: "To L — sway to the left",
      to_R: "To R — sway to the right",
      none: "None — no sway",
    },
  },
  turn: {
    subtitle: "amount & direction of turn",
    description: "How much the step turns, and in which direction.",
    values: {
      none: "None — no turn",
      eighth_L: "⅛ L — an eighth turn to the left",
      eighth_R: "⅛ R — an eighth turn to the right",
      quarter_L: "¼ L — a quarter turn to the left",
      quarter_R: "¼ R — a quarter turn to the right",
      three_eighth_L: "⅜ L — three eighths to the left",
      three_eighth_R: "⅜ R — three eighths to the right",
      half_L: "½ L — a half turn to the left",
      half_R: "½ R — a half turn to the right",
    },
  },
};

/** The glossary entry for a kind, or null for a custom kind with no prose. */
export function glossFor(kind: string): KindGloss | null {
  return ATTRIBUTE_GLOSSARY[kind] ?? null;
}
