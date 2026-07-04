// Typed message catalogs (see locale.ts for the seam). Each screen/feature owns
// one file under i18n/messages/ following this pattern:
//
//   const en = { title: "Profile", saved: (n: number) => `${n} saved` };
//   const de: typeof en = { title: "Profil", saved: (n) => `${n} gespeichert` };
//   export const profileMessages = { en, de };
//
// `de: typeof en` makes the German catalog structurally complete: a missing or
// extra key is a COMPILE error — there is no runtime fallback language to hide
// behind. Interpolated/plural strings are plain functions, so the type system
// also pins their arguments.
import { getLocale, useLocale } from "./locale";

/** A per-feature catalog: one identically-shaped object per locale. */
export interface Catalog<T> {
  en: T;
  de: T;
}

/** React: the active locale's messages for a catalog (re-renders on switch). */
export function useMessages<T>(catalog: Catalog<T>): T {
  return catalog[useLocale()];
}

/** Non-React callers (tours, display helpers): the active locale's messages. */
export function pickMessages<T>(catalog: Catalog<T>): T {
  return catalog[getLocale()];
}
