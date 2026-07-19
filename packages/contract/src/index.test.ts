import { describe, expect, it } from "vitest";
import {
  MEDIA_CAPS,
  zCreateFigure,
  zFamilyNoteBody,
  zInterpretVoiceNote,
  zJournalList,
  zMintMediaUpload,
  zMintMediaUploadResponse,
  zProfileBody,
  zRegistryKind,
  zRoutineList,
  zSaveToLibrary,
  zSearchResults,
  zTemplateList,
  zTranscribeResponse,
  zVoiceExtraction,
  zVoiceNoteProposal,
} from "./index";

describe("zJournalList (T6)", () => {
  it("parses a UNION of routine + account journal entries with resolved anchor labels", () => {
    const parsed = zJournalList.parse({
      entries: [
        {
          id: "a1",
          routineRef: "rt_1",
          authorId: "coach",
          kind: "lesson",
          text: "head left through the natural turn",
          anchors: [
            { type: "point", figureRef: "fig_nt", count: 1, label: "Natural Turn · step 2" },
            { type: "figureType", figureType: "whisk", danceScope: "all", label: "all Whisks" },
          ],
          createdAt: 1000,
          displayName: "Anna",
          identityColor: "#1f8a5b",
          source: "routine",
        },
        {
          id: "n1",
          routineRef: "account:me",
          authorId: "me",
          kind: "practice",
          text: "spin not rushing",
          anchors: [{ type: "figureType", figureType: "whisk", danceScope: "waltz" }],
          createdAt: 900,
          displayName: null,
          identityColor: null,
          source: "account",
        },
      ],
    });
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]?.anchors[0]?.label).toBe("Natural Turn · step 2");
  });

  it("rejects a non-lesson/practice kind (journal is lesson|practice only)", () => {
    expect(
      zJournalList.safeParse({
        entries: [
          {
            id: "x",
            routineRef: "rt",
            authorId: "u",
            kind: "note",
            text: "t",
            anchors: [],
            createdAt: 1,
            displayName: null,
            identityColor: null,
            source: "routine",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("zCreateFigure", () => {
  it("accepts an optional attributes timeline, defaulting to []", () => {
    const base = {
      figureRef: "fig_1",
      name: "Natural Turn",
      dance: "waltz",
      figureType: "natural-turn",
      routineId: "rt_1",
    };
    expect(zCreateFigure.parse(base).attributes).toEqual([]);

    const withAttrs = zCreateFigure.parse({
      ...base,
      attributes: [
        { id: "a1", kind: "step", count: 1, role: null, value: "RF fwd", deletedAt: null },
      ],
    });
    expect(withAttrs.attributes).toHaveLength(1);
  });

  it("rejects a structurally invalid attribute", () => {
    const bad = {
      figureRef: "fig_1",
      name: "X",
      dance: "waltz",
      figureType: "x",
      routineId: "rt_1",
      attributes: [{ id: "a1", count: 1 }], // missing kind/value
    };
    expect(zCreateFigure.safeParse(bad).success).toBe(false);
  });
});

describe("zSaveToLibrary (⟳v5 — bookmark, not a copy)", () => {
  it("accepts the direct v5 shape { figureRef }", () => {
    expect(zSaveToLibrary.safeParse({ figureRef: "fig_1" }).success).toBe(true);
  });

  it("accepts the legacy (dance, figureType, name) triple for back-compat", () => {
    const legacy = { dance: "waltz", figureType: "natural-turn", name: "Natural Turn" };
    expect(zSaveToLibrary.safeParse(legacy).success).toBe(true);
  });

  it("rejects a body matching neither shape", () => {
    expect(zSaveToLibrary.safeParse({ dance: "waltz" }).success).toBe(false);
    expect(zSaveToLibrary.safeParse({}).success).toBe(false);
    expect(zSaveToLibrary.safeParse({ figureRef: "" }).success).toBe(false);
  });
});

describe("write-body length/enum bounds (storage-growth + data-quality hardening)", () => {
  it("zProfileBody caps displayName length (prevents an unbounded name that fans out to every member list)", () => {
    expect(zProfileBody.safeParse({ displayName: "a", identityColor: "#111" }).success).toBe(true);
    expect(
      zProfileBody.safeParse({ displayName: "x".repeat(81), identityColor: "#111" }).success,
    ).toBe(false);
  });

  it("zFamilyNoteBody caps text length and constrains danceScope to a dance or 'all'", () => {
    const base = { kind: "note" as const, text: "keep the head left", figureType: "feather" };
    expect(zFamilyNoteBody.safeParse({ ...base, danceScope: "waltz" }).success).toBe(true);
    expect(zFamilyNoteBody.safeParse({ ...base, danceScope: "all" }).success).toBe(true);
    // A garbage danceScope is dead data (never matches a routine's dance) — reject it.
    expect(zFamilyNoteBody.safeParse({ ...base, danceScope: "cha_cha" }).success).toBe(false);
    // Unbounded note text would bloat D1 + every journal card.
    expect(
      zFamilyNoteBody.safeParse({ ...base, danceScope: "waltz", text: "x".repeat(4001) }).success,
    ).toBe(false);
  });

  it("zFamilyNoteBody accepts a timed dance-scoped note but rejects count/role with 'all' (WEP-0004)", () => {
    // A count pins the note to one moment of every matching figure IN ONE DANCE;
    // counts don't align across dances, so "all" + count/role is invalid.
    const base = { kind: "note" as const, text: "settle before the chassé", figureType: "whisk" };
    expect(zFamilyNoteBody.safeParse({ ...base, danceScope: "waltz", count: 3 }).success).toBe(
      true,
    );
    expect(
      zFamilyNoteBody.safeParse({ ...base, danceScope: "waltz", count: 3, role: "leader" }).success,
    ).toBe(true);
    expect(zFamilyNoteBody.safeParse({ ...base, danceScope: "all", count: 3 }).success).toBe(false);
    expect(zFamilyNoteBody.safeParse({ ...base, danceScope: "all", role: "leader" }).success).toBe(
      false,
    );
    // A non-positive count is not a timing position (the grid starts at 1).
    expect(zFamilyNoteBody.safeParse({ ...base, danceScope: "waltz", count: 0 }).success).toBe(
      false,
    );
  });

  it("zCreateFigure bounds the attributes array (an over-long timeline is not a real figure)", () => {
    const base = {
      figureRef: "fig_1",
      name: "Natural Turn",
      dance: "waltz",
      figureType: "natural-turn",
      routineId: "rt_1",
    };
    const attr = (i: number) => ({ id: `a${i}`, kind: "footwork", count: 1, value: "HT" });
    const many = Array.from({ length: 2001 }, (_, i) => attr(i));
    expect(zCreateFigure.safeParse({ ...base, attributes: many }).success).toBe(false);
  });
});

it("US-043 validates a custom registry kind", () => {
  const ok = zRegistryKind.safeParse({
    kind: "energy",
    label: "Energy",
    color: "#c0563f",
    cardinality: "single",
    valueType: "enum",
    values: ["low", "high"],
    builtin: false,
  });
  expect(ok.success).toBe(true);
});

it("T5 accepts the registry-derived info fields (description/valueDefs/roleAware/required)", () => {
  const ok = zRegistryKind.safeParse({
    kind: "energy",
    label: "Energy",
    color: "#c0563f",
    cardinality: "single",
    valueType: "enum",
    values: ["low", "high"],
    description: "How much drive the step carries.",
    valueDefs: { low: "Low — relaxed", high: "High — driving" },
    roleAware: true,
    required: false,
    builtin: false,
  });
  expect(ok.success).toBe(true);
  // The fields stay optional — a kind with none still validates.
  expect(
    zRegistryKind.safeParse({
      kind: "tempo",
      label: "Tempo",
      color: "#000000",
      cardinality: "single",
      valueType: "enum",
      builtin: false,
    }).success,
  ).toBe(true);
});

it("US-046 shapes search results", () => {
  const ok = zSearchResults.safeParse({
    results: [{ docRef: "r1", type: "routine", title: "My Foxtrot", dance: "foxtrot" }],
  });
  expect(ok.success).toBe(true);
});

it("US-046 search result accepts a null dance (nullable, not optional)", () => {
  // dance is .nullable() — a global figure may project a null dance, but the
  // field must always be PRESENT. Lock both: null is accepted, omission is not.
  const withNull = zSearchResults.safeParse({
    results: [{ docRef: "f1", type: "global-figure", title: "Feather", dance: null }],
  });
  expect(withNull.success).toBe(true);
  const omitted = zSearchResults.safeParse({
    results: [{ docRef: "f1", type: "global-figure", title: "Feather" }],
  });
  expect(omitted.success).toBe(false);
});

describe("US-025 zRoutineListItem card projection (bars / figureCount / forkedFromTitle)", () => {
  it("parses a routine row carrying the projected card fields", () => {
    const parsed = zRoutineList.parse({
      routines: [
        {
          docRef: "rt_1",
          title: "My Waltz",
          dance: "waltz",
          role: "owner",
          updatedAt: 10,
          bars: 12,
          figureCount: 4,
          forkedFromTitle: "Golden Waltz Basic",
        },
      ],
    });
    expect(parsed.routines[0]).toMatchObject({ bars: 12, figureCount: 4 });
    expect(parsed.routines[0]?.forkedFromTitle).toBe("Golden Waltz Basic");
  });

  it("keeps the card fields OPTIONAL (a row may omit them before first projection)", () => {
    // Eventual consistency: a freshly-created routine is listed (eager projection)
    // before its DO alarm has computed bars/figureCount — the row must still parse.
    const parsed = zRoutineList.parse({
      routines: [{ docRef: "rt_2", title: "Fresh", dance: "tango", role: "owner", updatedAt: 1 }],
    });
    expect(parsed.routines[0]?.bars).toBeUndefined();
    expect(parsed.routines[0]?.figureCount).toBeUndefined();
    expect(parsed.routines[0]?.forkedFromTitle).toBeUndefined();
  });
});

it("US-045 shapes the template list", () => {
  const ok = zTemplateList.safeParse({
    templates: [{ docRef: "t1", title: "Sample", dance: "foxtrot", role: "viewer", updatedAt: 1 }],
  });
  expect(ok.success).toBe(true);
});

describe("AI voice notes — interpret request/extraction/proposal schemas", () => {
  describe("zInterpretVoiceNote", () => {
    it("trims and requires a non-empty transcript; routineRef optional", () => {
      const parsed = zInterpretVoiceNote.parse({ transcript: "  settle the sway  " });
      expect(parsed.transcript).toBe("settle the sway");
      expect(parsed.routineRef).toBeUndefined();
      expect(zInterpretVoiceNote.safeParse({ transcript: "" }).success).toBe(false);
      expect(zInterpretVoiceNote.safeParse({ transcript: "   " }).success).toBe(false);
      expect(zInterpretVoiceNote.safeParse({ transcript: "x".repeat(4001) }).success).toBe(false);
      expect(zInterpretVoiceNote.safeParse({ transcript: "ok", routineRef: "rt_1" }).success).toBe(
        true,
      );
    });
  });

  describe("zVoiceExtraction (untrusted model output)", () => {
    it("accepts all three anchor shapes", () => {
      const point = zVoiceExtraction.safeParse({
        resolved: true,
        noteText: "settle the sway",
        confidence: "high",
        anchor: { type: "point", figureRef: "fig_1", count: 2, role: "leader" },
      });
      expect(point.success).toBe(true);
      const figure = zVoiceExtraction.safeParse({
        resolved: true,
        noteText: "more diagonal",
        confidence: "medium",
        anchor: { type: "figure", figureRef: "fig_2" },
      });
      expect(figure.success).toBe(true);
      const family = zVoiceExtraction.safeParse({
        resolved: true,
        noteText: "settle the sway",
        confidence: "high",
        anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot", count: 3 },
      });
      expect(family.success).toBe(true);
    });

    it("defaults alternatives to []", () => {
      const parsed = zVoiceExtraction.parse({
        resolved: false,
        noteText: "breathe",
        confidence: "low",
        anchor: null,
      });
      expect(parsed.alternatives).toEqual([]);
    });

    it("rejects malformed model output", () => {
      // missing noteText
      expect(
        zVoiceExtraction.safeParse({ resolved: true, confidence: "high", anchor: null }).success,
      ).toBe(false);
      // bad confidence
      expect(
        zVoiceExtraction.safeParse({
          resolved: false,
          noteText: "x",
          confidence: "certain",
          anchor: null,
        }).success,
      ).toBe(false);
      // unknown anchor type (predicate falls back to plain notes — never proposed)
      expect(
        zVoiceExtraction.safeParse({
          resolved: true,
          noteText: "x",
          confidence: "high",
          anchor: { type: "predicate", kind: "sway", value: "left" },
        }).success,
      ).toBe(false);
      // resolved:true with a null anchor
      expect(
        zVoiceExtraction.safeParse({
          resolved: true,
          noteText: "x",
          confidence: "high",
          anchor: null,
        }).success,
      ).toBe(false);
      // a timed figureType anchor cannot span "all"
      expect(
        zVoiceExtraction.safeParse({
          resolved: true,
          noteText: "x",
          confidence: "high",
          anchor: { type: "figureType", figureType: "feather", danceScope: "all", count: 3 },
        }).success,
      ).toBe(false);
      // too many alternatives
      expect(
        zVoiceExtraction.safeParse({
          resolved: true,
          noteText: "x",
          confidence: "high",
          anchor: { type: "figure", figureRef: "fig_2" },
          alternatives: Array.from({ length: 6 }, () => ({ type: "figure", figureRef: "f" })),
        }).success,
      ).toBe(false);
      // non-object garbage
      expect(zVoiceExtraction.safeParse("[]").success).toBe(false);
      expect(zVoiceExtraction.safeParse(null).success).toBe(false);
    });
  });

  describe("zVoiceNoteProposal (route response)", () => {
    it("accepts a resolved figureType proposal (routineRef null for a family anchor)", () => {
      const ok = zVoiceNoteProposal.safeParse({
        resolved: true,
        noteText: "settle the sway",
        confidence: "high",
        proposed: {
          anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
          routineRef: null,
          label: "all Feathers · all Foxtrot",
        },
        alternatives: [],
      });
      expect(ok.success).toBe(true);
    });

    it("accepts a resolved figure proposal (routineRef required)", () => {
      const ok = zVoiceNoteProposal.safeParse({
        resolved: true,
        noteText: "more diagonal",
        confidence: "medium",
        proposed: {
          anchor: { type: "figure", figureRef: "fig_2" },
          routineRef: "rt_comp",
          label: "Bounce Fallaway · Comp Slowfox",
        },
        alternatives: [],
      });
      expect(ok.success).toBe(true);
    });

    it("rejects resolved:true with proposed:null", () => {
      expect(
        zVoiceNoteProposal.safeParse({
          resolved: true,
          noteText: "x",
          confidence: "high",
          proposed: null,
          alternatives: [],
        }).success,
      ).toBe(false);
    });

    it("rejects a figure/point proposal whose routineRef is null", () => {
      expect(
        zVoiceNoteProposal.safeParse({
          resolved: true,
          noteText: "x",
          confidence: "high",
          proposed: {
            anchor: { type: "figure", figureRef: "fig_2" },
            routineRef: null,
            label: "Bounce Fallaway",
          },
          alternatives: [],
        }).success,
      ).toBe(false);
    });

    it("accepts a resolved:false / proposed:null fallback", () => {
      const ok = zVoiceNoteProposal.parse({
        resolved: false,
        noteText: "remember to breathe",
        confidence: "low",
        proposed: null,
        alternatives: [],
      });
      expect(ok.proposed).toBeNull();
    });
  });

  describe("zTranscribeResponse", () => {
    it("shapes the STT echo", () => {
      expect(zTranscribeResponse.parse({ transcript: "hello" }).transcript).toBe("hello");
      expect(zTranscribeResponse.safeParse({}).success).toBe(false);
    });
  });
});

describe("media upload mint contract (docs/ideas/annotation-media-embeds.md)", () => {
  it("accepts a valid image mint request and rejects an over-cap one at the schema", () => {
    const ok = zMintMediaUpload.safeParse({
      annotationId: "01ANN",
      mediaId: "01MED",
      type: "image",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
    });
    expect(ok.success).toBe(true);
    expect(
      zMintMediaUpload.safeParse({
        annotationId: "01ANN",
        mediaId: "01MED",
        type: "image",
        mimeType: "image/jpeg",
        sizeBytes: 0,
      }).success,
    ).toBe(false);
  });
  it("carries the owner-confirmed caps", () => {
    expect(MEDIA_CAPS.imageMaxBytes).toBe(10 * 1024 * 1024);
    expect(MEDIA_CAPS.videoMaxBytes).toBe(300 * 1024 * 1024);
    expect(MEDIA_CAPS.videoMaxSeconds).toBe(180);
    expect(MEDIA_CAPS.itemsPerAnnotation).toBe(4);
    expect(MEDIA_CAPS.freeUserTotalBytes).toBe(1024 * 1024 * 1024);
  });
  it("round-trips the mint response", () => {
    const res = zMintMediaUploadResponse.parse({
      objectKey: "media/r/a/m",
      uploadUrl: "/api/media/media/r/a/m",
      maxBytes: 1024,
    });
    expect(res.uploadUrl.startsWith("/api/media/")).toBe(true);
  });
});
