// AI voice notes — the capture sheet (docs/concepts/annotations.md § The Journal).
// Proves the rec → interpret → confirm/unresolved flow and that Confirm emits the
// VERBATIM JournalLink the manual picker would (proposalToLink), for each of the
// three static anchor shapes. axe on the rec + confirm states.
import type { VoiceNoteProposal } from "@weavesteps/contract";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { SpeechCapture, SpeechCaptureCallbacks } from "../lib/speech";
import { renderUi, screen, userEvent, waitFor } from "../test-support/render";
import type { JournalLink } from "./JournalLinkPicker";
import { proposalToLink, VoiceNoteSheet } from "./VoiceNoteSheet";

/** A scripted capture: emit a final transcript, or a live (interim) one that only
 *  the manual Stop finalizes — the real on-device case that has no auto-final. */
function scriptedCapture(): {
  capture: SpeechCapture;
  emit: (text: string) => void;
  emitInterim: (text: string) => void;
} {
  let cb: SpeechCaptureCallbacks | null = null;
  const capture: SpeechCapture = {
    onDevice: true,
    start(callbacks) {
      cb = callbacks;
    },
    stop() {},
  };
  return {
    capture,
    emit: (text) => cb?.onTranscript(text, true),
    emitInterim: (text) => cb?.onTranscript(text, false),
  };
}

const familyProposal: VoiceNoteProposal = {
  resolved: true,
  noteText: "settle the sway",
  confidence: "high",
  proposed: {
    anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
    routineRef: null,
    label: "all Feathers · all Foxtrot",
  },
  alternatives: [],
};

const figureProposal: VoiceNoteProposal = {
  resolved: true,
  noteText: "more diagonal",
  confidence: "medium",
  proposed: {
    anchor: { type: "figure", figureRef: "fig_bounce_1" },
    routineRef: "rt_comp",
    label: "Bounce Fallaway · Comp Slowfox",
  },
  alternatives: [],
};

const pointProposal: VoiceNoteProposal = {
  resolved: true,
  noteText: "head left",
  confidence: "high",
  proposed: {
    anchor: { type: "point", figureRef: "fig_nt", count: 2, role: "leader" },
    routineRef: "rt_w",
    label: "Natural Turn · Waltz A",
  },
  alternatives: [],
};

function renderSheet(
  proposal: VoiceNoteProposal,
  overrides: Partial<React.ComponentProps<typeof VoiceNoteSheet>> = {},
) {
  const { capture, emit, emitInterim } = scriptedCapture();
  const onConfirm = vi.fn();
  const onUseAsText = vi.fn();
  const onEditTarget = vi.fn();
  const onClose = vi.fn();
  const interpret = vi.fn(async () => proposal);
  const result = renderUi(
    <VoiceNoteSheet
      open
      onClose={onClose}
      capture={capture}
      interpret={interpret}
      transcribe={async () => ""}
      onConfirm={onConfirm}
      onUseAsText={onUseAsText}
      onEditTarget={onEditTarget}
      {...overrides}
    />,
  );
  return { ...result, emit, emitInterim, interpret, onConfirm, onUseAsText, onEditTarget, onClose };
}

describe("proposalToLink", () => {
  it("maps a figureType proposal to an account family link", () => {
    const link = proposalToLink(familyProposal);
    expect(link).toEqual<JournalLink>({
      home: "account",
      figureType: "feather",
      danceScope: "foxtrot",
      anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
      label: "all Feathers · all Foxtrot",
    });
  });

  it("maps a figure proposal to a routine link with the choreo title from the label", () => {
    const link = proposalToLink(figureProposal);
    expect(link).toEqual<JournalLink>({
      home: "routine",
      routineRef: "rt_comp",
      routineTitle: "Comp Slowfox",
      anchor: { type: "figure", figureRef: "fig_bounce_1" },
      label: "Bounce Fallaway · Comp Slowfox",
    });
  });

  it("returns null for an unresolved proposal", () => {
    expect(
      proposalToLink({
        resolved: false,
        noteText: "breathe",
        confidence: "low",
        proposed: null,
        alternatives: [],
      }),
    ).toBeNull();
  });
});

describe("VoiceNoteSheet", () => {
  it("renders the rec state, then interprets the final transcript", async () => {
    const { emit, interpret } = renderSheet(familyProposal);
    expect(screen.getByText("listening…")).toBeTruthy();
    emit("In Slowfox, in Feather Steps, settle the sway.");
    await waitFor(() =>
      expect(interpret).toHaveBeenCalledWith({
        transcript: "In Slowfox, in Feather Steps, settle the sway.",
      }),
    );
    await waitFor(() => expect(screen.getByText("Here's what I heard")).toBeTruthy());
    expect(screen.getByText("high confidence")).toBeTruthy();
    expect(screen.getByText("↳ all Feathers · all Foxtrot")).toBeTruthy();
  });

  it.each([
    ["figureType", familyProposal],
    ["figure", figureProposal],
    ["point", pointProposal],
  ] as const)("Confirm emits the exact JournalLink for a %s anchor", async (_kind, proposal) => {
    const { emit, onConfirm } = renderSheet(proposal);
    emit("say something");
    await waitFor(() => expect(screen.getByText("Confirm & save")).toBeTruthy());
    screen.getByText("Confirm & save").click();
    expect(onConfirm).toHaveBeenCalledWith(proposalToLink(proposal), proposal.noteText);
  });

  it("Discard closes without saving", async () => {
    const { emit, onClose, onConfirm } = renderSheet(familyProposal);
    emit("x");
    await waitFor(() => expect(screen.getByText("Discard")).toBeTruthy());
    screen.getByText("Discard").click();
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Edit target hands the note text to the picker hand-off", async () => {
    const { emit, onEditTarget } = renderSheet(familyProposal);
    emit("x");
    await waitFor(() => expect(screen.getByText("Edit target")).toBeTruthy());
    screen.getByText("Edit target").click();
    expect(onEditTarget).toHaveBeenCalledWith("settle the sway");
  });

  it("an unresolved proposal offers Keep as note text", async () => {
    const unresolved: VoiceNoteProposal = {
      resolved: false,
      noteText: "Remember to breathe.",
      confidence: "low",
      proposed: null,
      alternatives: [],
    };
    const { emit, onUseAsText } = renderSheet(unresolved);
    emit("Remember to breathe and stay grounded.");
    await waitFor(() => expect(screen.getByText("Keep as note text")).toBeTruthy());
    screen.getByText("Keep as note text").click();
    expect(onUseAsText).toHaveBeenCalledWith("Remember to breathe and stay grounded.");
  });

  it.each([["empty", ""] as const, ["whitespace-only", "   "] as const])(
    "short-circuits an %s transcript: no interpret call, honest 'didn't catch anything' copy",
    async (_kind, text) => {
      // Bug #289: an empty/silent capture must NOT fire the doomed 400 interpret
      // round-trip nor show the misleading saveFailed copy. It short-circuits
      // client-side to an honest empty state (voiceEmptyBody), matching the
      // transcript.trim().min(1) guard the contract already enforces server-side.
      const { emit, interpret } = renderSheet(familyProposal);
      emit(text);
      await waitFor(() => expect(screen.getByText("Didn't catch anything")).toBeTruthy());
      expect(interpret).not.toHaveBeenCalled();
      expect(screen.getByText("I didn't hear anything. Tap the mic and try again.")).toBeTruthy();
      // "Keep as note text" stays disabled — nothing to keep.
      const keep = screen.getByRole("button", { name: "Keep as note text" });
      expect(keep).toBeDisabled();
      // The misleading generic save-failed copy never appears.
      expect(screen.queryByText("Couldn't save this entry. Try again.")).toBeNull();
    },
  );

  it("Stop sends the live transcript with no auto-final — never stuck 'listening'", async () => {
    // The on-device path (continuous recognition) delivers only interim results
    // until the user stops; there is no auto-final. Stop must finalize with the
    // live transcript and advance to interpret — the real-Chrome hang we shipped.
    const { emitInterim, interpret } = renderSheet(pointProposal);
    emitInterim("head stays left through the natural turn");
    await waitFor(() =>
      expect(screen.getByText(/head stays left through the natural turn/)).toBeTruthy(),
    );
    // No final has fired; interpret must not have run yet.
    expect(interpret).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() =>
      expect(interpret).toHaveBeenCalledWith(
        expect.objectContaining({ transcript: "head stays left through the natural turn" }),
      ),
    );
  });

  it("uses an AA-contrast success token pairing for the high-confidence badge", async () => {
    // Bug #290: the confidence badge must pair bg-success-tint with
    // text-success-ink (the shipped Badge component's success pairing, 6.6:1),
    // NOT bg-success-subtle + text-success (4.33:1, fails WCAG AA). axe under
    // jsdom can't compute contrast, so we assert the token classes directly.
    const { emit } = renderSheet(familyProposal);
    emit("say something");
    await waitFor(() => expect(screen.getByText("high confidence")).toBeTruthy());
    const badge = screen.getByText("high confidence");
    expect(badge.className).toContain("bg-success-tint");
    expect(badge.className).toContain("text-success-ink");
    expect(badge.className).not.toContain("bg-success-subtle");
    // The bare text-success token (the failing 4.33:1 combo) is gone; text-success-ink is fine.
    expect(badge.className.split(/\s+/)).not.toContain("text-success");
  });

  it("has no axe violations in the rec state", async () => {
    const { container } = renderSheet(familyProposal);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations in the confirm state", async () => {
    const { container, emit } = renderSheet(familyProposal);
    emit("x");
    await waitFor(() => expect(screen.getByText("Confirm & save")).toBeTruthy());
    expect(await axe(container)).toHaveNoViolations();
  });
});
