import { AccountControls } from "../auth/app-auth";
import { useMessages } from "../i18n";
import { landingMessages } from "../i18n/messages/landing";
import { SCREENSHOTS, type Screenshot } from "../marketing/screenshots.manifest";
import { BrandMark, Card, LanguageToggle } from "../ui";

// Resolve the committed PNGs to fingerprinted asset URLs at build time. The
// manifest's `file` field is the key into this map.
const IMAGES = import.meta.glob<{ default: string }>("../marketing/screenshots/*.png", {
  eager: true,
});

function imageUrl(file: string): string {
  const entry = IMAGES[`../marketing/screenshots/${file}`];
  return entry?.default ?? "";
}

function shot(key: string): Screenshot {
  const s = SCREENSHOTS.find((x) => x.key === key);
  if (!s) throw new Error(`unknown screenshot key: ${key}`);
  return s;
}

function Shot({ s, className }: { s: Screenshot; className?: string }): React.JSX.Element {
  // Localized alt text lives in the landing catalog (keyed by the manifest's
  // stable key) so the manifest — shared with the CI pipeline — stays untouched.
  const t = useMessages(landingMessages);
  return (
    <img
      src={imageUrl(s.file)}
      alt={t.alts[s.key as keyof typeof t.alts] ?? s.alt}
      loading="lazy"
      className={`w-full rounded-xl border border-border-subtle shadow-sm ${className ?? ""}`}
    />
  );
}

const FEATURES = ["create", "sections", "notate", "lanes", "reading"] as const;

/**
 * Logged-out marketing page. Standalone (no app shell / nav). The sign-in CTA
 * goes through the auth seam (AccountControls) so it works in both the live-Clerk
 * and E2E builds.
 */
export function Landing(): React.JSX.Element {
  const t = useMessages(landingMessages);
  const hero = shot("hero");
  return (
    <div className="min-h-dvh bg-surface text-ink">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
        <span className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <BrandMark size={26} className="shrink-0 text-accent" />
          Weave Steps
        </span>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <AccountControls />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5">
        {/* Hero */}
        <section className="flex flex-col items-center gap-8 py-10 text-center lg:py-16">
          <div className="flex max-w-2xl flex-col items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight lg:text-5xl">{t.heroTitle}</h1>
            <p className="text-sm text-ink-secondary lg:text-base">{t.heroBlurb}</p>
            <div className="mt-2">
              <AccountControls />
            </div>
          </div>
          <Shot s={hero} className="max-w-3xl" />
        </section>

        {/* Feature blocks, alternating sides */}
        <section className="flex flex-col gap-12 py-8 lg:gap-20">
          {FEATURES.map((key, i) => {
            const s = shot(key);
            return (
              <div
                key={s.key}
                className={`flex flex-col items-center gap-6 lg:flex-row lg:gap-10 ${
                  i % 2 === 1 ? "lg:flex-row-reverse" : ""
                }`}
              >
                <div className="flex-1">
                  <Shot s={s} />
                </div>
                <p className="flex-1 text-base font-medium text-ink lg:text-lg">
                  {t.captions[s.key as keyof typeof t.captions] ?? s.caption}
                </p>
              </div>
            );
          })}
        </section>

        {/* Closing CTA */}
        <section className="py-12 lg:py-20">
          <Card>
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <h2 className="text-xl font-bold tracking-tight lg:text-2xl">{t.closingCta}</h2>
              <AccountControls />
            </div>
          </Card>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-5 py-8 text-2xs text-ink-muted">Weave Steps</footer>
    </div>
  );
}
