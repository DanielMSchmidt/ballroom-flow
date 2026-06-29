// T6 — the Journal entry editor (frame 3.3). A Lesson/Practice toggle, a
// handwritten-style text area, the LINKS section (chips + the link picker), and a
// disabled "media coming soon" affordance (PLAN §4.0 media = v1.1).
//
// Per the LOCKED full-parity decision the SAVE path is determined by the entry's
// links: a routine-scoped link (point/figure) saves via createRoutineEntry on
// that routine's editable store (createAnnotation); an account figureType link
// saves via createFamilyEntry (createFamilyNote). Both are injected (store seam).
import type { AnnotationKind } from "@ballroom/domain";
import { useState } from "react";
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
  /** Author an account-scoped figureType lesson/practice (createFamilyNote). */
  createFamilyEntry: (input: {
    figureType: string;
    danceScope: string;
    kind: AnnotationKind;
    text: string;
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
  authorLabel = "you",
  onBack,
  onSaved,
  createFamilyEntry,
  createRoutineEntry,
  loadRoutineOptions,
  loadRoutineFigures,
}: JournalEntryEditorProps): React.JSX.Element {
  const [kind, setKind] = useState<Exclude<AnnotationKind, "note">>("lesson");
  const [text, setText] = useState("");
  const [links, setLinks] = useState<JournalLink[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = text.trim().length > 0 && links.length > 0 && !saving;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      // A routine-scoped link wins the entry's home: its annotation carries every
      // routine anchor on the (single) chosen routine. Otherwise the entry is an
      // account figureType note (the first figureType link).
      const routineLinks = links.filter((l) => l.home === "routine");
      if (routineLinks.length > 0) {
        const routineRef = routineLinks[0]?.routineRef as string;
        const sameRoutine = routineLinks.filter(
          (l) => l.home === "routine" && l.routineRef === routineRef,
        );
        await createRoutineEntry(routineRef, {
          kind,
          text: text.trim(),
          anchors: sameRoutine.map((l) => l.anchor),
        });
      } else {
        const acct = links.find((l) => l.home === "account");
        if (acct && acct.home === "account") {
          await createFamilyEntry({
            figureType: acct.figureType,
            danceScope: acct.danceScope,
            kind,
            text: text.trim(),
          });
        }
      }
      onSaved();
    } catch {
      setError("Couldn't save this entry. Try again.");
      setSaving(false);
    }
  };

  return (
    <section aria-label="Journal entry editor" className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2">
        <div className="flex items-center gap-2">
          <IconButton label="Back" onClick={onBack}>
            <span className="text-lg leading-none">‹</span>
          </IconButton>
          <span className="text-sm font-bold text-ink">
            {kind === "lesson" ? "Lesson" : "Practice"} · {authorLabel} · today
          </span>
        </div>
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={!canSave}>
          done
        </Button>
      </header>

      <SegmentedToggle
        ariaLabel="Entry kind"
        options={[
          { value: "lesson", label: "Lesson" },
          { value: "practice", label: "Practice" },
        ]}
        value={kind}
        onChange={setKind}
      />

      <textarea
        aria-label="entry text"
        placeholder="What did you work on?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full rounded-lg border border-border-strong bg-surface-sunken px-3.5 py-3 text-ink placeholder:text-ink-faint outline-none"
        style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-md)" }}
      />

      <div className="flex flex-col gap-2">
        <p className="text-2xs font-bold uppercase tracking-wide text-ink-muted">Links</p>
        {links.map((link, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: links can repeat (same label); index disambiguates.
            key={`${link.home}-${link.label}-${i}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-border-default bg-surface px-3 py-2"
          >
            <span className="text-2xs text-studio-blue">↳ {link.label}</span>
            <IconButton
              label={`Remove link ${link.label}`}
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
          + link to a step, figure or attribute
        </button>
      </div>

      {/* Media is a v1.1 affordance — visibly disabled, not hidden. */}
      <button
        type="button"
        disabled
        aria-label="Add media (coming soon)"
        className="rounded-lg border border-dashed border-border-subtle px-3 py-3 text-center text-2xs text-ink-faint opacity-60"
      >
        + photo / video · coming soon
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
