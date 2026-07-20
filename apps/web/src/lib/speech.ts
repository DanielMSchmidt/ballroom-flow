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

/**
 * Push-to-talk DUAL capture: `start` = press, `stop` = release. On press it runs
 * BOTH on-device SpeechRecognition (where available) AND a MediaRecorder clip, so
 * either path can resolve the note. On release it decides ONCE: if the on-device
 * engine produced text, that wins (free, instant); otherwise the recorded clip is
 * handed to the server Whisper fallback (`onAudioFallback`).
 *
 * This is the design fix for mobile Chrome, which advertises SpeechRecognition but
 * streams no results — so `onerror`/`onend` from recognition are IGNORED, the
 * decision is driven entirely by whether any transcript text arrived by release.
 */
export function dualCapture(Ctor: SpeechRecognitionCtor | null): SpeechCapture {
  let rec: SpeechRecognitionLike | null = null;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  // The active callbacks, held so stop() can resolve without threading them through
  // every branch (set on start).
  let pendingCb: SpeechCaptureCallbacks | null = null;
  const chunks: Blob[] = [];
  // The full on-device transcript so far. In continuous mode `ev.results`
  // ACCUMULATES every segment, so we rebuild the whole string each event.
  let latest = "";
  // Decide-once guard: the on-device path and the recorder's onstop both race to
  // finish; whichever the decision picks resolves exactly once.
  let resolved = false;
  // True once stop() has been called: a getUserMedia promise that settles AFTER
  // release must clean up rather than start recording.
  let releasedBeforeRecorder = false;

  function stopRecognition(): void {
    rec?.stop();
    rec = null;
  }
  function stopStream(): void {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  }

  return {
    onDevice: Ctor != null,
    start(cb) {
      latest = "";
      resolved = false;
      releasedBeforeRecorder = false;
      chunks.length = 0;
      pendingCb = cb;

      if (Ctor) {
        const r = new Ctor();
        rec = r;
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
          cb.onTranscript(latest, false); // live — the FINAL decision happens on stop
        };
        // A recognition error means only that the on-device path failed; the recorded
        // clip is the fallback, so we swallow it and let stop() decide on the clip.
        r.onerror = () => {};
        // The decision is made on stop(), not here (continuous recognition never
        // finalizes on its own, and Chrome's silence-timeout onend must not pre-empt
        // the recorder path). onend is intentionally a no-op.
        r.onend = () => {};
        r.start();
      }

      // ALWAYS record too — the fallback clip for the no-on-device-result case —
      // when the recording API is present. (With only on-device recognition and no
      // MediaRecorder, the on-device path alone carries the capture.)
      const canRecord =
        typeof MediaRecorder !== "undefined" &&
        typeof navigator !== "undefined" &&
        navigator.mediaDevices != null;
      if (!canRecord) return;
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((s) => {
          if (releasedBeforeRecorder) {
            // Released before the mic opened — discard the late stream, don't record.
            for (const track of s.getTracks()) track.stop();
            return;
          }
          stream = s;
          const mr = new MediaRecorder(s);
          recorder = mr;
          mr.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          mr.onstop = () => {
            if (!resolved) {
              resolved = true;
              cb.onAudioFallback(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
            }
            stopStream();
          };
          mr.start();
        })
        .catch((err) => {
          // A denied mic is only fatal when there's no on-device recognizer to carry
          // the capture; with recognition present, the on-device path still works.
          if (Ctor == null && !resolved) {
            resolved = true;
            cb.onError(err instanceof Error ? err : new Error("microphone denied"));
          }
        });
    },
    stop() {
      if (resolved) {
        // Already decided (a prior stop, or the recorder's async onstop) — just clean up.
        stopRecognition();
        stopStream();
        return;
      }
      const text = latest.trim();
      if (text.length > 0) {
        // On-device path won: ship the transcript, discard the recorder (no upload).
        resolved = true;
        pendingCb?.onTranscript(text, true);
        recorder?.stop(); // fires onstop, but `resolved` already true → no fallback
        recorder = null;
        stopRecognition();
        stopStream();
        return;
      }
      // No on-device text → the recorded clip is the note. Stop recognition, then let
      // the recorder's onstop deliver the fallback blob.
      stopRecognition();
      if (recorder) {
        recorder.stop(); // onstop fires onAudioFallback (guarded by `resolved`)
        recorder = null;
      } else {
        // Fast release: the recorder hasn't started yet. Resolve to an empty audio
        // fallback now (the sheet's #289 empty-state handles an empty transcript),
        // and mark so a late getUserMedia cleans up instead of recording.
        releasedBeforeRecorder = true;
        resolved = true;
        pendingCb?.onAudioFallback(new Blob(chunks, { type: "audio/webm" }));
        stopStream();
      }
    },
  };
}

/**
 * Create a speech capture: a push-to-talk DUAL capture running on-device
 * SpeechRecognition (where supported) AND a MediaRecorder clip together, deciding
 * on release which resolves the note (`dualCapture`). In an E2E build the
 * injected-transcript hook stands in for the microphone.
 */
export function createSpeechCapture(): SpeechCapture {
  if (isE2E()) return e2eCapture();
  const Ctor = speechRecognitionCtor();
  const canRecord =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices != null;
  if (Ctor || canRecord) return dualCapture(Ctor);
  // Nothing available — a capture that reports an error on start.
  return {
    onDevice: false,
    start(cb) {
      cb.onError(new Error("speech capture unsupported"));
    },
    stop() {},
  };
}
