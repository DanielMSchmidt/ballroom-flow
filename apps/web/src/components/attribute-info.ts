// Presentational taglines for the attribute info sheet (frame 1.13).
//
// The kind's DESCRIPTION (the Caveat paragraph) and per-VALUE definitions now
// live on the domain `RegistryKind` (`description` / `valueDefs`), so the info
// sheet reads them straight off the merged registry — covering custom kinds too.
// What stays here is the one purely-presentational bit the registry doesn't
// model: a short "what is this kind" SUBTITLE shown under the title. Keyed by
// the standard kind slug; a custom kind simply has none (the sheet omits it).

export interface KindGloss {
  /** One-line "what is this kind" subtitle (shown under the title). */
  subtitle: string;
}

export const ATTRIBUTE_GLOSSARY: Record<string, KindGloss> = {
  direction: { subtitle: "where the step travels" },
  footwork: { subtitle: "what touches the floor, in order" },
  rise: { subtitle: "the up-and-down through the step" },
  position: { subtitle: "the dance position / hold" },
  bodyActions: { subtitle: "body actions through the step" },
  sway: { subtitle: "the lean of the body" },
  turn: { subtitle: "amount & direction of turn" },
};

/** The glossary entry for a kind, or null for a custom kind with no subtitle. */
export function glossFor(kind: string): KindGloss | null {
  return ATTRIBUTE_GLOSSARY[kind] ?? null;
}
