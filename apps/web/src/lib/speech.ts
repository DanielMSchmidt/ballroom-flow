// AI voice notes — the speech-capture seam (docs/concepts/annotations.md § The
// Journal). Browser-API isolation so the VoiceNoteSheet holds no I/O of its own:
// try on-device SpeechRecognition first (free, instant), fall back to a
// MediaRecorder clip for the server Whisper path where Web Speech is unsupported
// (notably iOS Safari). Under the E2E build a window hook injects a deterministic
// transcript — Playwright cannot produce microphone input — gated at COMPILE time
// by `isE2E()`, exactly like store/e2e-socket.ts's `__weaveZombifySockets`.
import { isE2E } from "./e2e-auth";

declare global {
  interface Window {
    /** E2E-only: the transcript `createSpeechCapture().start` emits as final. */
    __weaveVoiceTranscript?: string;
  }
}

export interface SpeechCaptureCallbacks {
  onTranscript(text: string, final: boolean): void;
  /** Web Speech unsupported/failed: hand back the recorded clip for the Whisper fallback. */
  onAudioFallback(clip: Blob): void;
  onError(err: Error): void;
}

export interface SpeechCapture {
  /** True when on-device recognition drives this capture (vs the record→upload fallback). */
  readonly onDevice: boolean;
  start(cb: SpeechCaptureCallbacks): void;
  stop(): void;
}

// ── Minimal structural typings for the non-standard browser APIs ──────────────
// The DOM lib doesn't ship SpeechRecognition types uniformly; declare exactly the
// surface used so access stays type-honest (no `any`, no cast).
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  /** Fires when recognition ends — after `stop()`, or Chrome's own silence
   *  timeout. The single reliable "capture is done" signal (continuous mode never
   *  finalizes on its own), so it's where the accumulated final transcript ships. */
  onend: (() => void) | null;
}
interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
}

/** Read a global property the DOM lib doesn't declare, as `unknown` — a runtime
 *  lookup (Reflect.get returns `unknown`), never a cast; the caller narrows. */
function globalProp(name: string): unknown {
  return typeof globalThis === "undefined" ? undefined : Reflect.get(globalThis, name);
}

/** Read a SpeechRecognition constructor off the global without a cast. */
function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = globalProp("SpeechRecognition") ?? globalProp("webkitSpeechRecognition");
  return isSpeechRecognitionCtor(ctor) ? ctor : null;
}

function isSpeechRecognitionCtor(v: unknown): v is SpeechRecognitionCtor {
  return typeof v === "function";
}

/** The E2E capture: emit the injected transcript as a final result, no mic. */
function e2eCapture(): SpeechCapture {
  return {
    onDevice: true,
    start(cb) {
      const text = typeof window !== "undefined" ? (window.__weaveVoiceTranscript ?? "") : "";
      // Emit on a microtask so callers can subscribe first (mirrors a real result).
      queueMicrotask(() => cb.onTranscript(text, true));
    },
    stop() {},
  };
}

/** On-device SpeechRecognition capture (continuous, interim results). */
function recognitionCapture(Ctor: SpeechRecognitionCtor): SpeechCapture {
  let rec: SpeechRecognitionLike | null = null;
  // The full transcript so far. In continuous mode `ev.results` ACCUMULATES every
  // segment, so we rebuild the whole string each event rather than emitting
  // per-segment — the old code kept only the LAST segment, which is why the manual
  // Stop usually sent a fragment (or nothing).
  let latest = "";
  let done = false;
  return {
    onDevice: true,
    start(cb) {
      const r = new Ctor();
      rec = r;
      latest = "";
      done = false;
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";
      r.onresult = (ev) => {
        let full = "";
        for (let i = 0; i < ev.results.length; i++) {
          const result = ev.results[i];
          if (result) full += result[0].transcript;
        }
        latest = full.trim();
        cb.onTranscript(latest, false); // live — the FINAL ships once, from onend
      };
      r.onerror = (ev) => cb.onError(new Error(ev.error ?? "speech recognition error"));
      // The one reliable completion signal (continuous recognition doesn't deliver
      // a terminal isFinal result on its own): ship the accumulated transcript as
      // final, exactly once. Empty (silence) is honest — the sheet routes it to the
      // "didn't catch anything" state rather than a doomed interpret.
      r.onend = () => {
        if (done) return;
        done = true;
        cb.onTranscript(latest, true);
      };
      r.start();
    },
    stop() {
      // Ask recognition to end; onend delivers the final transcript. Keep `rec` so a
      // late onresult/onend still resolves against a live reference.
      rec?.stop();
    },
  };
}

/** Record→upload capture: gather a MediaRecorder clip, hand it to the Whisper fallback on stop. */
function recorderCapture(): SpeechCapture {
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  return {
    onDevice: false,
    start(cb) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((s) => {
          const mr = new MediaRecorder(s);
          recorder = mr;
          mr.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          mr.onstop = () => {
            cb.onAudioFallback(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
            for (const track of s.getTracks()) track.stop();
          };
          mr.start();
        })
        .catch((err) => cb.onError(err instanceof Error ? err : new Error("microphone denied")));
    },
    stop() {
      recorder?.stop();
      recorder = null;
    },
  };
}

/**
 * Create a speech capture: on-device SpeechRecognition where supported, else a
 * MediaRecorder clip for the server Whisper fallback. In an E2E build the
 * injected-transcript hook stands in for the microphone.
 */
export function createSpeechCapture(): SpeechCapture {
  if (isE2E()) return e2eCapture();
  const Ctor = speechRecognitionCtor();
  if (Ctor) return recognitionCapture(Ctor);
  if (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices
  ) {
    return recorderCapture();
  }
  // Nothing available — a capture that reports an error on start.
  return {
    onDevice: false,
    start(cb) {
      cb.onError(new Error("speech capture unsupported"));
    },
    stop() {},
  };
}
