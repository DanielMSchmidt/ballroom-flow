import { type Locale, setLocale, useLocale, useMessages } from "../i18n";
import { uiMessages } from "../i18n/messages/ui";
import { SegmentedToggle } from "./SegmentedToggle";

/**
 * LanguageToggle — the compact EN | DE switcher for chrome surfaces (the
 * landing header, the desktop side rail). Wraps SegmentedToggle around the
 * locale seam (i18n/locale.ts): the switch applies live and persists. The
 * Profile screen keeps its own full-width switcher with explanatory copy —
 * this is the always-visible shortcut, not a replacement.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const t = useMessages(uiMessages);
  const locale = useLocale();
  return (
    <SegmentedToggle<Locale>
      ariaLabel={t.language}
      options={[
        { value: "en", label: "EN" },
        { value: "de", label: "DE" },
      ]}
      value={locale}
      onChange={setLocale}
      className={className}
    />
  );
}
