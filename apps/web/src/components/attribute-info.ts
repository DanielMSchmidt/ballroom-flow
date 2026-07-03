// Presentational taglines for the attribute info sheet (frame 1.13).
//
// The kind's DESCRIPTION (the Caveat paragraph) and per-VALUE definitions now
// live on the domain `RegistryKind` (`description` / `valueDefs`), so the info
// sheet reads them straight off the merged registry — covering custom kinds too.
// What stays here is the one purely-presentational bit the registry doesn't
// model: a short "what is this kind" SUBTITLE shown under the title. Keyed by
// the standard kind slug; a custom kind simply has none (the sheet omits it).
//
// The subtitle strings live in the attributes message catalog (per locale);
// lookups resolve via pickMessages at CALL time so a runtime language switch
// takes effect on the next render.
import { pickMessages } from "../i18n";
import { attributesMessages } from "../i18n/messages/attributes";

export interface KindGloss {
  /** One-line "what is this kind" subtitle (shown under the title). */
  subtitle: string;
}

/** The glossary entry for a kind, or null for a custom kind with no subtitle. */
export function glossFor(kind: string): KindGloss | null {
  const subtitles: Record<string, string> = pickMessages(attributesMessages).glossarySubtitles;
  const subtitle = subtitles[kind];
  return subtitle ? { subtitle } : null;
}
