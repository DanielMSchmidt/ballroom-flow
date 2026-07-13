import { describe, expect, it } from "vitest";
import type { DanceId } from "./__fixtures__";
import { importDomain } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-002 — Dance metadata registry [M1, system/developer]
// PLAN §3, §10.2 invariant: timing/phrasing derive from ONE `DANCES` source.
//
// Product `DANCES` (dances.ts, M1 §9 1.2) does not exist yet → dynamic import,
// suite skipped. RED→GREEN: export `DANCES` keyed by DanceId with the metadata
// asserted below.
// ─────────────────────────────────────────────────────────────────────────

const STANDARD: DanceId[] = ["waltz", "viennese_waltz", "quickstep", "foxtrot", "tango"];

describe("US-002 Dance metadata registry", () => {
  it("exposes exactly the 5 Standard travelling dances, all travelling:true", async () => {
    // Intent: only the 5 Standard dances exist in v1; each is travelling.
    // Arrange: import DANCES. Act: read its keys + travelling flags.
    // Assert: keys === STANDARD set; every dance.travelling === true.
    // Covers AC-1 (the 5 exist, travelling) + AC-3 (no Latin/spot).
    const { DANCES } = await importDomain();
    expect(Object.keys(DANCES).sort()).toEqual([...STANDARD].sort());
    for (const id of STANDARD) {
      expect(DANCES[id].travelling).toBe(true);
    }
  });

  it("sets beatsPerBar/phraseBeats per meter (3/6 Waltz+Viennese, 4/8 rest)", async () => {
    // Intent: per-meter phrasing constants drive float-count timing (US-004).
    // Arrange: import DANCES. Act: read beatsPerBar + phraseBeats per dance.
    // Assert: Waltz/Viennese = 3 beats/bar & 6 phrase beats; rest = 4 & 8.
    // Covers AC-2 (beatsPerBar/phraseBeats), and the §10.2 single-source rule.
    const { DANCES } = await importDomain();
    for (const id of ["waltz", "viennese_waltz"] as const) {
      expect(DANCES[id].beatsPerBar).toBe(3);
      expect(DANCES[id].phraseBeats).toBe(6);
    }
    for (const id of ["quickstep", "foxtrot", "tango"] as const) {
      expect(DANCES[id].beatsPerBar).toBe(4);
      expect(DANCES[id].phraseBeats).toBe(8);
    }
  });

  it("carries a timeSignature for every dance", async () => {
    // Intent: timeSignature present for rendering (AC-2 "timeSignature present").
    // Arrange/Act: import DANCES, read timeSignature. Assert: truthy per dance.
    const { DANCES } = await importDomain();
    for (const id of STANDARD) {
      expect(DANCES[id].timeSignature).toBeTruthy();
    }
  });

  // ── Extra edge cases (in the spirit of US-002, beyond the listed ACs) ──

  it("contains no Latin/spot dances (v1 scope)", async () => {
    // Intent: AC-3 stated positively — the registry must not leak any out-of-
    // scope dance (no Cha Cha, Rumba, Samba, Paso Doble, Jive, etc.).
    const { DANCES } = await importDomain();
    const forbidden = ["cha_cha", "rumba", "samba", "paso_doble", "jive", "salsa"];
    for (const id of forbidden) {
      expect(Object.keys(DANCES)).not.toContain(id);
    }
  });

  it("carries every metadata field with a sane type for each dance", async () => {
    // Intent: each DanceMeta is complete — no partially-populated entry slips in.
    const { DANCES } = await importDomain();
    for (const id of STANDARD) {
      const meta = DANCES[id];
      expect(typeof meta.timeSignature).toBe("string");
      expect(typeof meta.beatsPerBar).toBe("number");
      expect(typeof meta.phraseBeats).toBe("number");
      expect(typeof meta.travelling).toBe("boolean");
    }
  });
});
