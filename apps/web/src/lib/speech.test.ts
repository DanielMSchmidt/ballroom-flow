// AI voice notes — the push-to-talk dual-capture seam (docs/concepts/annotations.md
// § The Journal, § Voice capture). Proves `dualCapture`'s decide-once logic: the
// on-device transcript wins when non-empty; otherwise the recorded clip reaches the
// Whisper fallback; `onerror` is ignored (the clip is the fallback); double-stop
// resolves exactly once. jsdom ships no SpeechRecognition / MediaRecorder, so both
// are hand-stubbed to the structural surface the code touches.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dualCapture, type SpeechCaptureCallbacks } from "./speech";

// ── A scriptable SpeechRecognition stub matching SpeechRecognitionLike ────────
class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult:
    | ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void)
    | null = null;
  onerror: ((ev: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
    FakeRecognition.instances.push(this);
  }
  stop(): void {
    this.stopped = true;
  }
  /** Emit a continuous-mode result set (accumulated segments). */
  emit(segments: string[]): void {
    const results = segments.map((transcript) => ({ 0: { transcript }, isFinal: false }));
    this.onresult?.({ results });
  }
  static instances: FakeRecognition[] = [];
}

// ── A scriptable MediaRecorder + getUserMedia ─────────────────────────────────
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  started = false;
  stopped = false;
  constructor(readonly stream: FakeStream) {
    FakeMediaRecorder.instances.push(this);
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
    // Deliver a chunk, then fire onstop (mirrors the browser's terminal event).
    this.ondataavailable?.({ data: new Blob(["clip"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

class FakeStream {
  stopped = 0;
  getTracks(): Array<{ stop: () => void }> {
    return [{ stop: () => (this.stopped += 1) }];
  }
}

function installMediaRecorder(getUserMedia: () => Promise<FakeStream>): void {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

function callbacks(): {
  cb: SpeechCaptureCallbacks;
  transcripts: Array<{ text: string; final: boolean }>;
  clips: Blob[];
  errors: Error[];
} {
  const transcripts: Array<{ text: string; final: boolean }> = [];
  const clips: Blob[] = [];
  const errors: Error[] = [];
  return {
    transcripts,
    clips,
    errors,
    cb: {
      onTranscript: (text, final) => transcripts.push({ text, final }),
      onAudioFallback: (clip) => clips.push(clip),
      onError: (err) => errors.push(err),
    },
  };
}

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeMediaRecorder.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dualCapture", () => {
  it("ships the on-device transcript as final when it heard something", async () => {
    const stream = new FakeStream();
    installMediaRecorder(async () => stream);
    const capture = dualCapture(FakeRecognition);
    const { cb, transcripts, clips } = callbacks();

    capture.start(cb);
    await Promise.resolve(); // let getUserMedia's promise settle
    const rec = FakeRecognition.instances[0];
    if (!rec) throw new Error("recognition not started");
    rec.emit(["head stays ", "left through the turn"]);
    expect(transcripts.at(-1)).toEqual({ text: "head stays left through the turn", final: false });

    capture.stop();
    // Decision: on-device text present → final transcript, NO audio fallback.
    expect(transcripts.at(-1)).toEqual({
      text: "head stays left through the turn",
      final: true,
    });
    expect(clips).toHaveLength(0);
  });

  it("routes to the recorded clip (Whisper fallback) when on-device heard nothing", async () => {
    const stream = new FakeStream();
    installMediaRecorder(async () => stream);
    const capture = dualCapture(FakeRecognition);
    const { cb, transcripts, clips } = callbacks();

    capture.start(cb);
    await Promise.resolve();
    // No onresult ever fires (the mobile-Chrome silence case).
    capture.stop();

    expect(clips).toHaveLength(1);
    expect(clips[0]?.size).toBeGreaterThan(0);
    // No final on-device transcript was shipped.
    expect(transcripts.some((t) => t.final)).toBe(false);
  });

  it("ignores recognition onerror — the recorded clip is the fallback", async () => {
    const stream = new FakeStream();
    installMediaRecorder(async () => stream);
    const capture = dualCapture(FakeRecognition);
    const { cb, clips, errors } = callbacks();

    capture.start(cb);
    await Promise.resolve();
    const rec = FakeRecognition.instances[0];
    rec?.onerror?.({ error: "no-speech" });
    // onError must NOT be called for a recognition error while a recorder exists.
    expect(errors).toHaveLength(0);

    capture.stop();
    // Falls through to the clip.
    expect(clips).toHaveLength(1);
  });

  it("resolves exactly once across a double stop()", async () => {
    const stream = new FakeStream();
    installMediaRecorder(async () => stream);
    const capture = dualCapture(FakeRecognition);
    const { cb, transcripts, clips } = callbacks();

    capture.start(cb);
    await Promise.resolve();
    const rec = FakeRecognition.instances[0];
    rec?.emit(["done"]);

    capture.stop();
    capture.stop(); // idempotent — no second final, no clip
    const finals = transcripts.filter((t) => t.final);
    expect(finals).toHaveLength(1);
    expect(finals[0]).toEqual({ text: "done", final: true });
    expect(clips).toHaveLength(0);
  });

  it("errors only when getUserMedia rejects AND there is no on-device recognizer", async () => {
    installMediaRecorder(async () => {
      throw new Error("mic denied");
    });
    const capture = dualCapture(null); // no SpeechRecognition available
    const { cb, errors } = callbacks();

    capture.start(cb);
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveLength(1);
  });

  it("resolves to an empty audio fallback on a fast release before the recorder starts", async () => {
    // getUserMedia never settles before stop() (the fast-release edge). A deferred
    // holder keeps the resolver out of control-flow narrowing (TS would else infer it
    // `never`).
    const deferred: { resolve: (s: FakeStream) => void } = { resolve: () => {} };
    installMediaRecorder(
      () =>
        new Promise<FakeStream>((res) => {
          deferred.resolve = res;
        }),
    );
    const capture = dualCapture(FakeRecognition);
    const { cb, clips, transcripts } = callbacks();

    capture.start(cb);
    // Release immediately — recorder promise hasn't resolved, no on-device text.
    capture.stop();

    expect(transcripts.some((t) => t.final)).toBe(false);
    expect(clips).toHaveLength(1);
    expect(clips[0]?.size).toBe(0);
    // A late-arriving stream must be cleaned up, not left recording.
    deferred.resolve(new FakeStream());
    await Promise.resolve();
  });
});
