// US-055 — the default "Golden Waltz Basic" starter routine seeded for every new
// user on first onboarding. A PURE builder: it materializes a fresh, owned,
// editable RoutineDoc + its referenced FigureDocs, copying each figure's step
// timeline verbatim from the shipped library catalog (LIBRARY_FIGURES) so the
// starter matches what a user would get by picking the same figures themselves.
// Id minting is injected so this stays deterministic and side-effect-free; the
// worker passes `newId`. Figures are separate docs (figureRef) — created and
// seeded before the routine by the caller.
import type { DanceId } from "./dances";
import type { Attribute, FigureDoc, RoutineDoc } from "./doc-types";
import { LIBRARY_FIGURES } from "./library";

/** The starter's figures, in choreography order, by their canonical figureType. */
const GOLDEN_WALTZ_BASIC: readonly string[] = [
  "closed-change-on-rf",
  "natural-turn",
  "closed-change-on-lf",
  "reverse-turn",
  "whisk",
  "chasse-from-pp",
];

const WALTZ: DanceId = "waltz";

/**
 * Build the "Golden Waltz Basic" starter: one waltz routine (a single "Basic"
 * section) plus the FigureDocs its placements reference. Each figure is an owned
 * account-scoped doc carrying the library figure's canonical name + step
 * attributes. `missing` reports any figureType absent from the library (so the
 * caller can log it) — such a figure is skipped, never fabricated.
 */
export function buildGoldenWaltzBasic(
  ownerId: string,
  mintId: () => string,
): { routine: RoutineDoc; figures: FigureDoc[]; missing: string[] } {
  const figures: FigureDoc[] = [];
  const missing: string[] = [];

  for (const figureType of GOLDEN_WALTZ_BASIC) {
    const lib = LIBRARY_FIGURES.find((l) => l.dance === WALTZ && l.figureType === figureType);
    if (!lib) {
      missing.push(figureType);
      continue;
    }
    figures.push({
      id: mintId(),
      scope: "account",
      ownerId,
      figureType,
      dance: WALTZ,
      name: lib.name,
      source: "custom",
      attributes: (lib.attributes ?? []) as Attribute[],
      schemaVersion: 1,
      deletedAt: null,
    });
  }

  const routine: RoutineDoc = {
    id: mintId(),
    title: "Golden Waltz Basic",
    dance: WALTZ,
    ownerId,
    sections: [
      {
        id: mintId(),
        name: "Basic",
        placements: figures.map((f) => ({ id: mintId(), figureRef: f.id, deletedAt: null })),
        deletedAt: null,
      },
    ],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  };

  return { routine, figures, missing };
}
