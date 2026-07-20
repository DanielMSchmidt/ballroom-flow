// AI voice notes — the store seam (docs/concepts/annotations.md § The Journal).
// Components reach the read-only voice-note routes ONLY through this seam (the
// established store-boundary rule). Both calls re-validate the wire with the
// contract schema — never trust a response body — so a component always receives
// a schema-valid proposal or a thrown error, never a half-trusted shape.
import {
  type VoiceNoteProposal,
  zTranscribeResponse,
  zVoiceNoteProposal,
} from "@weavesteps/contract";
import { apiPost } from "../lib/rpc";

export type { VoiceNoteProposal } from "@weavesteps/contract";

/** Resolve a transcript against the caller's choreography into a PROPOSED anchor. */
export async function interpretVoiceNote(
  input: { transcript: string; routineRef?: string },
  token: string | null,
  baseUrl = "",
): Promise<VoiceNoteProposal> {
  const raw = await apiPost<unknown>(`${baseUrl}/api/voice-notes/interpret`, token, input);
  return zVoiceNoteProposal.parse(raw);
}

/** Whisper-fallback STT: upload the recorded clip, get the transcript back. The
 *  audio is never stored server-side. `apiPost` is JSON-only, so the raw audio
 *  bytes go through a plain fetch (still Zod-validated on the way back). */
export async function transcribeVoiceClip(
  clip: Blob,
  token: string | null,
  baseUrl = "",
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/voice-notes/transcribe`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "content-type": "application/octet-stream",
    },
    body: clip,
  });
  if (!res.ok) throw new Error(`transcribe -> ${res.status}`);
  return zTranscribeResponse.parse(await res.json()).transcript;
}
