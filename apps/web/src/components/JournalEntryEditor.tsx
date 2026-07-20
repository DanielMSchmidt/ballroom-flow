// T6 — the Journal entry editor (frame 3.3). A Lesson/Practice toggle, a
// handwritten-style text area, the LINKS section (chips + the link picker), and a
// disabled "media coming soon" affordance (docs/ideas/annotation-media-embeds.md).
//
// Per the LOCKED full-parity decision the SAVE path is determined by the entry's
// links, and each link kind writes independently (#293): routine-scoped links
// (point/figure) collapse into one createRoutineEntry (createAnnotation) on that
// routine's editable store, each account figureType link saves its own
// createFamilyEntry (createFamilyNote), and each attribute-predicate link its own
// createPredicateEntry — an entry carrying several kinds lands them all. The
// seams are injected (store seam). The voice sheet's proposal confirms through
// this same link+save path — the AI never writes.
import type { VoiceNoteProposal } from "@weavesteps/contract";
import type { AnnotationKind, RegistryKind } from "@weavesteps/domain";
import { useState } from "react";
import { useMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import type { SpeechCapture } from "../lib/speech";
import { Button, Card, IconButton, SegmentedToggle } from "../ui";
import { CloseIcon } from "../ui/icons";
import {
  type JournalLink,
  JournalLinkPicker,
  type RoutineFigureOption,
  type RoutineOption,
} from "./JournalLinkPicker";
import { VoiceNoteSheet } from "./VoiceNoteSheet";

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
  /** Author an attribute-predicate note (account store's createPredicateNote). */
  createPredicateEntry: (input: {
    attrKind: string;
    attrValue: string;
    role?: "leader" | "follower";
    scope: string;
    routineRef?: string;
    kind: AnnotationKind;
    text: string;
  }) => Promise<void>;
  loadRoutineOptions: () => Promise<RoutineOption[]>;
  loadRoutineFigures: (routineRef: string) => Promise<RoutineFigureOption[]>;
  /** Custom attribute kinds for the picker's attribute-family list. */
  customKinds?: RegistryKind[];
  /** AI voice notes (docs/concepts/annotations.md § The Journal). Injected seams
   *  for the mic affordance; when all three are absent the control is hidden. The
   *  proposal it confirms flows through the ORDINARY link+save path — the AI never
   *  writes. */
  createSpeechCapture?: () => SpeechCapture;
  interpretVoice?: (input: {
    transcript: string;
    routineRef?: string;
  }) => Promise<VoiceNoteProposal>;
  transcribeVoice?: (clip: Blob) => Promise<string>;
}

export function JournalEntryEditor({
  authorLabel,
  onBack,
  onSaved,
  createFamilyEntry,
  createRoutineEntry,
  createPredicateEntry,
  loadRoutineOptions,
  loadRoutineFigures,
  customKinds,
  createSpeechCapture,
  interpretVoice,
  transcribeVoice,
}: JournalEntryEditorProps): React.JSX.Element {
  const t = useMessages(journalMessages);
  const [kind, setKind] = useState<Exclude<AnnotationKind, "note">>("lesson");
  const [text, setText] = useState("");
  const [links, setLinks] = useState<JournalLink[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The active capture instance (created once per open so the sheet's effect
  // doesn't restart it on every render); null while the sheet is closed.
  const [capture, setCapture] = useState<SpeechCapture | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The mic affordance appears only when all three voice seams are injected.
  const voiceEnabled =
    createSpeechCapture != null && interpretVoice != null && transcribeVoice != null;

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
      const predicateLinks = links.filter(
        (l): l is Extract<JournalLink, { home: "accountPredicate" }> =>
          l.home === "accountPredicate",
      );
      // Each link kind writes to its own home INDEPENDENTLY (#293): an entry
      // carrying a routine link, account figureType links, and predicate links
      // lands all of them — matching what each kind produces on its own.
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
      // Each attribute-predicate link saves its own predicate note.
      for (const pred of predicateLinks) {
        await createPredicateEntry({
          attrKind: pred.attrKind,
          attrValue: pred.attrValue,
          scope: pred.scope,
          kind,
          text: text.trim(),
          ...(pred.role ? { role: pred.role } : {}),
          ...(pred.routineRef ? { routineRef: pred.routineRef } : {}),
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

      <div className="flex items-center gap-3">
        {/* AI voice capture (docs/concepts/annotations.md § The Journal): speak the
            note, the anchor is proposed, you confirm — then the ordinary save path. */}
        {voiceEnabled && (
          <button
            type="button"
            onClick={() => setCapture(createSpeechCapture())}
            className="flex items-center gap-1.5 text-2xs font-bold text-accent"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <title>{t.voice}</title>
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            {t.voice}
          </button>
        )}
        {/* Media is a v1.1 affordance — visibly disabled, not hidden. */}
        <button
          type="button"
          disabled
          aria-label={t.addMedia}
          className="flex-1 rounded-lg border border-dashed border-border-subtle px-3 py-3 text-center text-2xs text-ink-faint opacity-60"
        >
          {t.addMediaHint}
        </button>
      </div>

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
        customKinds={customKinds}
      />

      {voiceEnabled && capture != null && (
        <VoiceNoteSheet
          open={capture != null}
          onClose={() => setCapture(null)}
          capture={capture}
          interpret={interpretVoice}
          transcribe={transcribeVoice}
          onConfirm={(link, noteText) => {
            // The confirmed proposal becomes an ORDINARY link + text — the save
            // button then drives the unchanged path. The AI never writes.
            setLinks((prev) => [...prev, link]);
            setText((prev) => (prev.trim().length > 0 ? prev : noteText));
            setCapture(null);
          }}
          onEditTarget={(noteText) => {
            // Hand off to the manual picker (it resets to its first step); the
            // transcript stays in the editor.
            setText((prev) => (prev.trim().length > 0 ? prev : noteText));
            setCapture(null);
            setPickerOpen(true);
          }}
          onUseAsText={(noteText) => {
            // Unresolved: keep the transcript as the note text, no link.
            setText((prev) => (prev.trim().length > 0 ? prev : noteText));
            setCapture(null);
          }}
        />
      )}
    </section>
  );
}
