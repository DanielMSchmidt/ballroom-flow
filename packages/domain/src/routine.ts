// @ballroom/domain — pure in-memory routine assembly (design §2.1 Routine/Side/Figure).
//
// This is the model the Assemble and Figure Timeline screens drive: a routine owns ordered
// Sides, each Side owns ordered Figures, and a Figure added from the catalog is instantiated
// (instantiateFigure) so it arrives PRE-FILLED with both-role step charts. `figureTimeline()`
// projects a figure into the rows the timeline view shows (one per step, with timing + every
// technique attribute). No I/O: persistence, sortKeys, and auth are the worker's job — here
// insertion order is display order.

import {
  type FigureInstance,
  getLibraryFigure,
  instantiateFigure,
  type Step,
  type Timing,
} from "./figures";
import type { DanceId, StepRole } from "./vocabulary";

export type SideKind = "long" | "short" | "corner";

export interface Side {
  id: string;
  kind: SideKind;
  figures: FigureInstance[];
}

export interface Routine {
  id: string;
  title: string;
  dance: DanceId;
  /** The user who created it (auth/identity is enforced at the worker layer). */
  createdByUserId: string;
  sides: Side[];
}

export function createRoutine(input: {
  id: string;
  title: string;
  dance: DanceId;
  createdByUserId: string;
}): Routine {
  return { ...input, sides: [] };
}

export function getSide(routine: Routine, sideId: string): Side | undefined {
  return routine.sides.find((s) => s.id === sideId);
}

/** Append a section to the routine; returns the created side. */
export function addSide(routine: Routine, input: { id: string; kind: SideKind }): Side {
  const side: Side = { id: input.id, kind: input.kind, figures: [] };
  routine.sides.push(side);
  return side;
}

/**
 * Add a figure from the catalog to a section. The figure is instantiated from its library
 * default, so its leader + follower charts (footwork, timing, every slot) are filled in at
 * add-time. Returns the created figure instance.
 */
export function addFigure(
  routine: Routine,
  sideId: string,
  input: { id: string; libraryFigureId: string },
): FigureInstance {
  const side = getSide(routine, sideId);
  if (!side) throw new Error(`no such side: ${sideId}`);
  const library = getLibraryFigure(input.libraryFigureId);
  if (!library) throw new Error(`no such library figure: ${input.libraryFigureId}`);
  const figure = instantiateFigure(library, input.id);
  side.figures.push(figure);
  return figure;
}

/** Every figure in the routine, in side-then-figure order (the Assemble reading order). */
export function routineFigures(routine: Routine): FigureInstance[] {
  return routine.sides.flatMap((s) => s.figures);
}

/** One timeline row per step: its 1-based index plus the full technique record. */
export interface TimelineRow extends Step {
  n: number;
}

/** Project a figure into the rows the Figure Timeline view renders, for one role. */
export function figureTimeline(figure: FigureInstance, role: StepRole): TimelineRow[] {
  const steps = role === "leader" ? figure.leaderSteps : figure.followerSteps;
  return steps.map((step, i) => ({ n: i + 1, ...step }));
}

export type { Timing };
