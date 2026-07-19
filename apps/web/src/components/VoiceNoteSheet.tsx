// AI voice notes — the capture sheet (docs/concepts/annotations.md § The Journal;
// design: docs/design/project/Ballroom Builder v3.dc.html lines 1026–1063). Mic →
// live transcript → a PROPOSED anchor rendered as a chip → Confirm/Edit/Discard.
// The component holds NO I/O of its own — capture, interpret, and transcribe are
// injected seams (the JournalLinkPicker pattern). Confirm emits the ORDINARY
// JournalLink the manual picker would; the AI never writes.
import type { VoiceNoteProposal } from "@weavesteps/contract";
import { useCallback, useEffect, useState } from "react";
import { useMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import type { SpeechCapture } from "../lib/speech";
import { Sheet } from "../ui";
import type { JournalLink } from "./JournalLinkPicker";

export interface VoiceNoteSheetProps {
  open: boolean;
  onClose: () => void;
  capture: SpeechCapture;
  interpret: (input: { transcript: string; routineRef?: string }) => Promise<VoiceNoteProposal>;
  transcribe: (clip: Blob) => Promise<string>;
  /** Confirm & save: the ordinary picker payload + the note text. */
  onConfirm: (link: JournalLink, noteText: string) => void;
  /** resolved:false fallback: hand the transcript to the entry editor as plain text. */
  onUseAsText: (text: string) => void;
  /** Edit target: hand off to the ordinary link picker (the transcript stays). */
  onEditTarget: (noteText: string) => void;
  routineRef?: string;
}

type Phase = "rec" | "interpreting" | "confirm" | "unresolved";

/**
 * Map a grounded proposal to the verbatim `JournalLink` the manual picker
 * produces (shapes from JournalLinkPicker.tsx): a figureType anchor → an account
 * family link; a figure/point anchor → a routine link with its owning routineRef.
 * Returns null when the proposal isn't resolved (the caller shows the fallback).
 */
export function proposalToLink(p: VoiceNoteProposal): JournalLink | null {
  if (!p.resolved || p.proposed == null) return null;
  const { anchor, routineRef, label } = p.proposed;
  if (anchor.type === "figureType") {
    return {
      home: "account",
      figureType: anchor.figureType,
      danceScope: anchor.danceScope,
      ...(anchor.count != null ? { count: anchor.count } : {}),
      ...(anchor.role ? { role: anchor.role } : {}),
      anchor,
      label,
    };
  }
  // figure / point → a routine link (the grounding guaranteed routineRef non-null).
  if (routineRef == null) return null;
  // The label is "<figure name> · <choreo title>"; the choreo title is the tail.
  const routineTitle = label.includes(" · ") ? label.slice(label.indexOf(" · ") + 3) : label;
  return { home: "routine", routineRef, routineTitle, anchor, label };
}

export function VoiceNoteSheet(props: VoiceNoteSheetProps): React.JSX.Element | null {
  const t = useMessages(journalMessages);
  const { open, capture, interpret, transcribe, routineRef } = props;
  const [phase, setPhase] = useState<Phase>("rec");
  const [transcript, setTranscript] = useState("");
  const [proposal, setProposal] = useState<VoiceNoteProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolveTranscript = useCallback(
    async (finalText: string) => {
      setTranscript(finalText);
      setPhase("interpreting");
      try {
        const p = await interpret({ transcript: finalText, ...(routineRef ? { routineRef } : {}) });
        setProposal(p);
        setPhase(p.resolved ? "confirm" : "unresolved");
      } catch {
        setError(t.saveFailed);
        setPhase("unresolved");
      }
    },
    [interpret, routineRef, t.saveFailed],
  );

  // Start capture when the sheet opens; stop + reset when it closes.
  useEffect(() => {
    if (!open) return;
    setPhase("rec");
    setTranscript("");
    setProposal(null);
    setError(null);
    capture.start({
      onTranscript: (text, final) => {
        setTranscript(text);
        if (final) {
          capture.stop();
          void resolveTranscript(text);
        }
      },
      onAudioFallback: (clip) => {
        void transcribe(clip)
          .then((text) => resolveTranscript(text))
          .catch(() => setError(t.saveFailed));
      },
      onError: () => setError(t.saveFailed),
    });
    return () => capture.stop();
  }, [open, capture, resolveTranscript, transcribe, t.saveFailed]);

  const stop = (): void => {
    capture.stop();
    if (transcript.trim().length > 0) void resolveTranscript(transcript);
  };

  if (!open) return null;

  const confidenceLabel =
    proposal?.confidence === "high"
      ? t.voiceConfidenceHigh
      : proposal?.confidence === "medium"
        ? t.voiceConfidenceMedium
        : t.voiceConfidenceLow;

  return (
    <Sheet open={open} onClose={props.onClose} title={t.voiceSheetTitle}>
      {phase === "rec" && (
        <div className="flex flex-col items-center gap-3 py-1">
          <span
            aria-hidden
            className="flex h-16 w-16 items-center justify-center rounded-full bg-accent"
            style={{ animation: "bf-mic-pulse 1.6s var(--bf-ease-out) infinite" }}
          >
            <MicGlyph />
          </span>
          <span className="text-2xs font-bold text-ink">{t.voiceListening}</span>
          <div
            role="status"
            aria-live="polite"
            className="w-full rounded-xl border border-border-default bg-surface-sunken px-3 py-3 text-ink"
            style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-md)" }}
          >
            {transcript ? `“${transcript}”` : "…"}
          </div>
          <span className="text-2xs text-ink-muted">{t.voiceOnDeviceHint}</span>
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-2xs font-bold text-surface"
          >
            <span className="h-2.5 w-2.5 rounded-sm bg-danger" />
            {t.voiceStop}
          </button>
        </div>
      )}

      {phase === "interpreting" && (
        <div className="flex flex-col gap-3 py-2">
          <div
            className="rounded-xl border border-border-default bg-surface-sunken px-3 py-3 text-ink"
            style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-md)" }}
          >
            {transcript ? `“${transcript}”` : "…"}
          </div>
          <span className="text-2xs text-ink-muted">{t.voiceInterpreting}</span>
        </div>
      )}

      {phase === "confirm" && proposal?.proposed != null && (
        <div className="flex flex-col gap-3">
          <div className="text-2xs font-bold text-ink">{t.voiceHeard}</div>
          <div
            className="rounded-xl border border-border-default bg-surface-sunken px-3 py-3 text-ink"
            style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-md)" }}
          >
            “{proposal.noteText}”
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-3xs font-bold uppercase tracking-wide text-ink-muted">
              {t.voiceProposedTarget}
              <span
                className={
                  proposal.confidence === "high"
                    ? "rounded bg-success-subtle px-1.5 py-0.5 text-3xs font-semibold text-success"
                    : "rounded bg-surface-sunken px-1.5 py-0.5 text-3xs font-semibold text-ink-secondary"
                }
              >
                {confidenceLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-studio-blue-subtle bg-studio-blue-subtle px-3 py-2.5">
              <span className="flex-1 text-2xs font-bold text-studio-blue">
                ↳ {proposal.proposed.label}
              </span>
            </div>
            <div className="mt-1.5 text-2xs text-ink-muted">{t.voiceGroundedHint}</div>
          </div>
          <div className="mt-0.5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                const link = proposalToLink(proposal);
                if (link) props.onConfirm(link, proposal.noteText);
              }}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-3 text-2xs font-bold text-surface"
            >
              {t.voiceConfirmSave}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => props.onEditTarget(proposal.noteText)}
                className="flex-1 rounded-xl border border-border-strong px-3 py-2.5 text-center text-3xs font-bold text-ink-secondary"
              >
                {t.voiceEditTarget}
              </button>
              <button
                type="button"
                onClick={props.onClose}
                className="flex-1 rounded-xl border border-danger-subtle px-3 py-2.5 text-center text-3xs font-bold text-danger"
              >
                {t.voiceDiscard}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "unresolved" && (
        <div className="flex flex-col gap-3">
          <div className="text-2xs font-bold text-ink">{t.voiceUnresolvedTitle}</div>
          <div
            className="rounded-xl border border-border-default bg-surface-sunken px-3 py-3 text-ink"
            style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-md)" }}
          >
            {transcript ? `“${transcript}”` : "…"}
          </div>
          <p className="text-2xs text-ink-muted">{error ?? t.voiceUnresolvedBody}</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => props.onUseAsText(transcript)}
              className="rounded-xl bg-accent px-3 py-3 text-center text-2xs font-bold text-surface"
              disabled={transcript.trim().length === 0}
            >
              {t.voiceKeepAsText}
            </button>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-xl border border-danger-subtle px-3 py-2.5 text-center text-3xs font-bold text-danger"
            >
              {t.voiceDiscard}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function MicGlyph(): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative — the "listening…" label carries meaning.
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
