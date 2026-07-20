// T6 — the Journal entry editor (frame 3.3). A Lesson/Practice toggle, a
// handwritten-style text area, the LINKS section (chips + the link picker), and a
// disabled "media coming soon" affordance (docs/ideas/annotation-media-embeds.md).
//
// Per the LOCKED full-parity decision the SAVE path is determined by the entry's
// links, and each link kind writes independently (#293): routine-scoped links
// (point/figure) collapse into one createRoutineEntry (createAnnotation) on that
// routine's editable store, AND each account figureType link saves its own
// createFamilyEntry (createFamilyNote) — an entry carrying both kinds lands both.
// Both seams are injected (store seam).
import type { AnnotationKind } from "@weavesteps/domain";
import { useState } from "react";
import { useMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import { Button, Card, IconButton, SegmentedToggle } from "../ui";
import { CloseIcon } from "../ui/icons";
import {
  type JournalLink,
  JournalLinkPicker,
  type RoutineFigureOption,
  type RoutineOption,
} from "./JournalLinkPicker";

export interface JournalEntryEditorProps {
  /** The author label shown in the header ("you" for self). */
  authorLabel?: string;
  onBack: () => void;
  /** Called after a successful save so the list refreshes + the editor closes. */
  onSaved: () => void;
  /** Author an account-scoped figureType lesson/practice (createFamilyNote).
   *  docs/concepts/annotations.md § Anchors (WEP-0004): a TIMED link passes
   *  count/role through (never with "all"). */
  createFamilyEntry: (input: {
    figureType: string;
    danceScope: string;
    kind: AnnotationKind;
    text: string;
    count?: number;
    role?: "leader" | "follower";
  }) => Promise<void>;
  /** Author a routine-scoped lesson/practice (createAnnotation on the routine). */
  createRoutineEntry: (
    routineRef: string,
    input: { kind: AnnotationKind; text: string; anchors: JournalLink["anchor"][] },
  ) => Promise<void>;
  loadRoutineOptions: () => Promise<RoutineOption[]>;
  loadRoutineFigures: (routineRef: string) => Promise<RoutineFigureOption[]>;
}

export function JournalEntryEditor({
  authorLabel,
  onBack,
  onSaved,
  createFamilyEntry,
  createRoutineEntry,
  loadRoutineOptions,
  loadRoutineFigures,
}: JournalEntryEditorProps): React.JSX.Element {
  const t = useMessages(journalMessages);
  const [kind, setKind] = useState<Exclude<AnnotationKind, "note">>("lesson");
  const [text, setText] = useState("");
  const [links, setLinks] = useState<JournalLink[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = text.trim().length > 0 && !saving;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const routineLinks = links.filter((l) => l.home === "routine");
      const accountLinks = links.filter(
        (l): l is Extract<JournalLink, { home: "account" }> => l.home === "account",
      );
      // Each link kind writes to its own home INDEPENDENTLY (#293): an entry
      // carrying both a routine link and an account figureType link must land
      // both — the routine annotation AND one family note per figureType link —
      // matching exactly what each link kind produces on its own.
      const [firstRoutine] = routineLinks;
      if (firstRoutine) {
        // All same-routine anchors collapse into one annotation.
        const routineRef = firstRoutine.routineRef;
        const sameRoutine = routineLinks.filter((l) => l.routineRef === routineRef);
        await createRoutineEntry(routineRef, {
          kind,
          text: text.trim(),
          anchors: sameRoutine.map((l) => l.anchor),
        });
      }
      // docs/concepts/annotations.md § Anchors (WEP-0004): one family note per
      // linked figureType (each carries its own scope + optional timed anchor).
      for (const acct of accountLinks) {
        await createFamilyEntry({
          figureType: acct.figureType,
          danceScope: acct.danceScope,
          kind,
          text: text.trim(),
          ...(acct.count != null ? { count: acct.count } : {}),
          ...(acct.role ? { role: acct.role } : {}),
        });
      }
      if (links.length === 0) {
        // No link — save as a general account note (unanchored to a specific figure).
        await createFamilyEntry({
          figureType: "general",
          danceScope: "all",
          kind,
          text: text.trim(),
        });
      }
      onSaved();
    } catch {
      setError(t.saveFailed);
      setSaving(false);
    }
  };

  return (
    <section aria-label={t.editorRegion} className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2">
        <div className="flex items-center gap-2">
          <IconButton label={t.back} onClick={onBack}>
            <span className="text-lg leading-none">‹</span>
          </IconButton>
          <span className="text-sm font-bold text-ink">
            {t.editorHeader(
              kind === "lesson" ? t.kindLesson : t.kindPractice,
              authorLabel ?? t.authorYou,
            )}
          </span>
        </div>
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={!canSave}>
          {t.done}
        </Button>
      </header>

      <SegmentedToggle
        ariaLabel={t.entryKind}
        options={[
          { value: "lesson", label: t.kindLesson },
          { value: "practice", label: t.kindPractice },
        ]}
        value={kind}
        onChange={setKind}
      />

      <textarea
        aria-label={t.entryText}
        placeholder={t.entryPlaceholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full rounded-lg border border-border-strong bg-surface-sunken px-3.5 py-3 text-ink placeholder:text-ink-faint outline-none"
        style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-md)" }}
      />

      <div className="flex flex-col gap-2">
        <p className="text-2xs font-bold uppercase tracking-wide text-ink-muted">
          {t.linksHeading}
        </p>
        {links.map((link, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: links can repeat (same label); index disambiguates.
            key={`${link.home}-${link.label}-${i}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-border-default bg-surface px-3 py-2"
          >
            <span className="text-2xs text-studio-blue">↳ {link.label}</span>
            <IconButton
              label={t.removeLink(link.label)}
              onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
            >
              <CloseIcon size={14} />
            </IconButton>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded-lg border border-dashed border-border-strong px-3 py-3 text-center text-2xs text-ink-secondary min-h-[var(--bf-touch-target)]"
        >
          {t.addLink}
        </button>
      </div>

      {/* Media is a v1.1 affordance — visibly disabled, not hidden. */}
      <button
        type="button"
        disabled
        aria-label={t.addMedia}
        className="rounded-lg border border-dashed border-border-subtle px-3 py-3 text-center text-2xs text-ink-faint opacity-60"
      >
        {t.addMediaHint}
      </button>

      {error && (
        <Card>
          <p className="text-2xs text-danger">{error}</p>
        </Card>
      )}

      <JournalLinkPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(link) => setLinks((prev) => [...prev, link])}
        loadRoutineOptions={loadRoutineOptions}
        loadRoutineFigures={loadRoutineFigures}
      />
    </section>
  );
}
