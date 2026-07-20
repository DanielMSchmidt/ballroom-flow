// AI voice notes — the capture sheet (docs/concepts/annotations.md § The Journal;
// design: docs/design/project/Ballroom Builder v3.dc.html lines 1026–1063). Mic →
// live transcript → a PROPOSED anchor rendered as a chip → Confirm/Edit/Discard.
// The component holds NO I/O of its own — capture, interpret, and transcribe are
// injected seams (the JournalLinkPicker pattern). Confirm emits the ORDINARY
// JournalLink the manual picker would; the AI never writes.
import type { VoiceNoteProposal } from "@weavesteps/contract";
import { useCallback, useEffect, useRef, useState } from "react";
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

// "idle" — sheet open, awaiting a hold; "rec" — actively capturing (held, or the
// keyboard toggle is on). The mic never auto-starts (push-to-talk, #291): mobile
// Chrome advertises SpeechRecognition but streams nothing, so an auto-start "rec"
// state sat forever on "…". See docs/concepts/annotations.md § Voice capture.
type Phase = "idle" | "rec" | "interpreting" | "confirm" | "unresolved" | "empty";

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
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [proposal, setProposal] = useState<VoiceNoteProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards resolveTranscript to run once per capture: the manual Stop and the
  // capture's own onend both try to finalize — whichever lands first wins, the
  // other is a no-op. Reset when a new capture starts.
  const resolvingRef = useRef(false);
  // True while a hold (or keyboard-toggle) capture is live — the press-and-hold and
  // keyboard-toggle handlers share it so a stray pointerleave after release, or a
  // second Enter, can't double-start/stop the capture.
  const recordingRef = useRef(false);

  const resolveTranscript = useCallback(
    async (finalText: string) => {
      if (resolvingRef.current) return;
      resolvingRef.current = true;
      setTranscript(finalText);
      // An empty/silent capture has nothing to interpret — the contract's
      // transcript.trim().min(1) guard would 400 the request. Short-circuit to an
      // honest "didn't catch anything" state client-side (bug #289): no doomed
      // round-trip, no console error, no misleading saveFailed copy.
      if (finalText.trim().length === 0) {
        setPhase("empty");
        return;
      }
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

  const startCapture = useCallback((): void => {
    if (recordingRef.current) return; // already holding — ignore a repeat press
    recordingRef.current = true;
    setPhase("rec");
    setTranscript("");
    setProposal(null);
    setError(null);
    resolvingRef.current = false;
    capture.start({
      onTranscript: (text, final) => {
        setTranscript(text);
        // Interim results update the live display. The FINAL decision is made when the
        // user releases (capture.stop) — the dual capture ships the final transcript
        // there, or hands back a recorded clip for the Whisper fallback.
        if (final) void resolveTranscript(text);
      },
      onAudioFallback: (clip) => {
        void transcribe(clip)
          .then((text) => resolveTranscript(text))
          .catch(() => setError(t.saveFailed));
      },
      onError: () => setError(t.saveFailed),
    });
  }, [capture, resolveTranscript, transcribe, t.saveFailed]);

  // Release: stop the capture and let it decide (on-device transcript, or a recorded
  // clip → Whisper). Advances the sheet off "rec" so it's never stuck listening.
  const stopCapture = useCallback((): void => {
    if (!recordingRef.current) return; // not holding — a stray pointerleave/keyup
    recordingRef.current = false;
    capture.stop();
  }, [capture]);

  // Stop capture when the sheet closes (a hold left open, then dismissed).
  useEffect(() => {
    if (open) return;
    if (recordingRef.current) {
      recordingRef.current = false;
      capture.stop();
    }
  }, [open, capture]);

  // Press-and-hold isn't keyboard-operable, so the talk button ALSO toggles on
  // Enter/Space (first = start, second = stop). Pointer handlers own the hold path.
  const toggleCapture = useCallback((): void => {
    if (recordingRef.current) stopCapture();
    else startCapture();
  }, [startCapture, stopCapture]);

  // Retry from the empty state: back to idle so the user holds again (push-to-talk),
  // rather than auto-recording. Clears the prior empty transcript.
  const resetToIdle = useCallback((): void => {
    recordingRef.current = false;
    resolvingRef.current = false;
    setTranscript("");
    setProposal(null);
    setError(null);
    setPhase("idle");
  }, []);

  if (!open) return null;

  const confidenceLabel =
    proposal?.confidence === "high"
      ? t.voiceConfidenceHigh
      : proposal?.confidence === "medium"
        ? t.voiceConfidenceMedium
        : t.voiceConfidenceLow;

  return (
    <Sheet open={open} onClose={props.onClose} title={t.voiceSheetTitle}>
      {(phase === "idle" || phase === "rec") && (
        <div className="flex flex-col items-center gap-3 py-1">
          {/* Push-to-talk: hold the mic (pointer) or toggle it (keyboard). While held
              we're in "rec" — the on-device path streams a live transcript; the
              mobile/Whisper path has none, so it shows a "recording…" indicator. */}
          <button
            type="button"
            aria-pressed={phase === "rec"}
            aria-label={phase === "rec" ? t.voiceRecordingButton : t.voiceHoldButton}
            onPointerDown={(e) => {
              e.preventDefault(); // keep focus off the button so a subsequent key toggles cleanly
              startCapture();
            }}
            onPointerUp={stopCapture}
            onPointerLeave={stopCapture}
            onPointerCancel={stopCapture}
            onKeyDown={(e) => {
              // Space/Enter toggle; prevent the browser's synthetic click (which would
              // fire a second toggle) and Space page-scroll.
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                toggleCapture();
              }
            }}
            className="flex h-16 w-16 touch-none select-none items-center justify-center rounded-full bg-accent"
            style={
              phase === "rec"
                ? { animation: "bf-mic-pulse 1.6s var(--bf-ease-out) infinite" }
                : undefined
            }
          >
            <MicGlyph />
          </button>
          <span className="text-2xs font-bold text-ink">
            {phase === "rec" ? t.voiceRecording : t.voiceHoldPrompt}
          </span>
          {phase === "rec" && (
            <div
              role="status"
              aria-live="polite"
              className="w-full rounded-xl border border-border-default bg-surface-sunken px-3 py-3 text-ink"
              style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-md)" }}
            >
              {transcript ? `“${transcript}”` : "…"}
            </div>
          )}
          <span className="text-2xs text-ink-muted">
            {phase === "rec" ? t.voiceOnDeviceHint : t.voiceKeyboardHint}
          </span>
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
                    ? // AA-contrast success pairing (bug #290): tint bg + ink fg is
                      // the shipped Badge component's success combo (6.6:1). The
                      // former bg-success-subtle + text-success was 4.33:1 (fails AA).
                      "rounded bg-success-tint px-1.5 py-0.5 text-3xs font-semibold text-success-ink"
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

      {(phase === "unresolved" || phase === "empty") && (
        <div className="flex flex-col gap-3">
          <div className="text-2xs font-bold text-ink">
            {phase === "empty" ? t.voiceEmptyTitle : t.voiceUnresolvedTitle}
          </div>
          <div
            className="rounded-xl border border-border-default bg-surface-sunken px-3 py-3 text-ink"
            style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-md)" }}
          >
            {transcript ? `“${transcript}”` : "…"}
          </div>
          <p className="text-2xs text-ink-muted">
            {phase === "empty" ? t.voiceEmptyBody : (error ?? t.voiceUnresolvedBody)}
          </p>
          <div className="flex flex-col gap-2">
            {phase === "empty" ? (
              // Nothing was heard — the retry affordance restarts capture (bug
              // #289). Keep-as-text is still rendered but stays disabled: there is
              // no transcript to keep, so no empty note can be saved.
              <>
                <button
                  type="button"
                  onClick={resetToIdle}
                  className="rounded-xl bg-accent px-3 py-3 text-center text-2xs font-bold text-surface"
                >
                  {t.voiceRetry}
                </button>
                <button
                  type="button"
                  onClick={() => props.onUseAsText(transcript)}
                  className="rounded-xl border border-border-strong px-3 py-2.5 text-center text-3xs font-bold text-ink-secondary disabled:opacity-50"
                  disabled={transcript.trim().length === 0}
                >
                  {t.voiceKeepAsText}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => props.onUseAsText(transcript)}
                className="rounded-xl bg-accent px-3 py-3 text-center text-2xs font-bold text-surface"
                disabled={transcript.trim().length === 0}
              >
                {t.voiceKeepAsText}
              </button>
            )}
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
