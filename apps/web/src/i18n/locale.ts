// i18n locale seam — the single source for the UI language (docs/system/architecture.md
// § Non-functional requirements: the UI is bilingual EN/DE; user-authored content is
// never machine-translated).
//
// The locale is a CLIENT-SIDE preference (like the leader/follower toggle), not
// server data: it lives in localStorage, defaults from the browser language, and
// components subscribe via `useLocale()` (useSyncExternalStore) so a switch in
// Profile re-renders the whole tree live — no reload.
//
// Message catalogs live beside this module (see messages.ts + messages/): typed
// per-screen objects, NOT a string-keyed lookup — a missing translation is a
// compile error, not a runtime fallback.
import { useSyncExternalStore } from "react";

/** The UI languages the app ships. English is the source language. */
export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

/** Runtime narrowing to a supported UI locale (CLAUDE.md §4 — guard, don't assert). */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.some((l) => l === value);
}

const STORAGE_KEY = "bf.locale";

/** Narrow an arbitrary string to a supported locale, or undefined. */
function asLocale(value: string | null | undefined): Locale | undefined {
  return isLocale(value) ? value : undefined;
}

/** Browser-language default: any `de*` tag → German, everything else English. */
function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const lang of langs) {
    if (!lang) continue;
    if (lang.toLowerCase().startsWith("de")) return "de";
    if (lang.toLowerCase().startsWith("en")) return "en";
  }
  return "en";
}

function readStored(): Locale | undefined {
  try {
    return asLocale(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return undefined; // storage blocked (private mode) — fall back to detection
  }
}

let current: Locale = readStored() ?? detectLocale();
const listeners = new Set<() => void>();

/** Reflect the active language on <html lang> for a11y / hyphenation. */
function applyDocumentLang(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}
applyDocumentLang(current);

/** The active UI locale (non-React callers: tours, display helpers). */
export function getLocale(): Locale {
  return current;
}

/** Switch the UI language: persist + notify every `useLocale` subscriber. */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // storage blocked — the choice still applies for this session
  }
  applyDocumentLang(locale);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React subscription to the active locale — re-renders on switch. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/** Test-only: reset to a known locale without touching storage semantics. */
export function resetLocaleForTests(locale: Locale = "en"): void {
  current = locale;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  applyDocumentLang(locale);
  for (const listener of listeners) listener();
}
