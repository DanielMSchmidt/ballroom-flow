// AI voice notes — the capture sheet (docs/concepts/annotations.md § The Journal).
// Proves the rec → interpret → confirm/unresolved flow and that Confirm emits the
// VERBATIM JournalLink the manual picker would (proposalToLink), for each of the
// three static anchor shapes. axe on the rec + confirm states.
import type { VoiceNoteProposal } from "@weavesteps/contract";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { SpeechCapture, SpeechCaptureCallbacks } from "../lib/speech";
import { renderUi, screen, waitFor } from "../test-support/render";
import type { JournalLink } from "./JournalLinkPicker";
import { proposalToLink, VoiceNoteSheet } from "./VoiceNoteSheet";

/** A scripted capture: hand the test a way to emit a final transcript on demand. */
function scriptedCapture(): { capture: SpeechCapture; emit: (text: string) => void } {
  let cb: SpeechCaptureCallbacks | null = null;
  const capture: SpeechCapture = {
    onDevice: true,
    start(callbacks) {
      cb = callbacks;
    },
    stop() {},
  };
  return { capture, emit: (text) => cb?.onTranscript(text, true) };
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
  const { capture, emit } = scriptedCapture();
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
  return { ...result, emit, interpret, onConfirm, onUseAsText, onEditTarget, onClose };
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
