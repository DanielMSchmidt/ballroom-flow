// @ballroom/domain — the ISTD/WDSF Standard figure catalogue, by NAME and grade.
//
// This is the complete pick-list a routine builds from. Figure names and their syllabus
// grade are public reference facts; they are listed here so the catalogue is whole. The
// *detailed per-step technique* (footwork charts) is NOT here — it lives in the copyrighted
// WDSF/ISTD technique books and is not openly sourceable, so it is added in figures.ts only
// for figures whose both-role footwork has been verified (see CHARTED_FIGURES). Every other
// entry below is instantiated as an un-charted figure (empty charts) the dancer fills in,
// rather than seeded with invented footwork.
//
// Names follow common ISTD usage (the WDSF catalogue's names mostly match); grade placement
// follows the ISTD syllabus and can differ slightly between ISTD/IDTA/WDSF. v1 covers the
// five Standard dances; Latin is deferred (its footwork vocabulary is not yet modelled).

import type { DanceId } from "./vocabulary";

export type CatalogLevel = "bronze" | "silver" | "gold";
export type CatalogEntry = readonly [dance: DanceId, name: string, level: CatalogLevel];

/** Stable id for a catalogue figure: `dance.snake_case_name`. */
export function catalogFigureId(dance: DanceId, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${dance}.${slug}`;
}

export const STANDARD_CATALOG: readonly CatalogEntry[] = [
  // --- Waltz ---------------------------------------------------------------------------
  ["waltz", "Closed Change (Natural to Reverse)", "bronze"],
  ["waltz", "Closed Change (Reverse to Natural)", "bronze"],
  ["waltz", "Natural Turn", "bronze"],
  ["waltz", "Reverse Turn", "bronze"],
  ["waltz", "Natural Spin Turn", "bronze"],
  ["waltz", "Whisk", "bronze"],
  ["waltz", "Chasse from Promenade Position", "bronze"],
  ["waltz", "Closed Impetus", "bronze"],
  ["waltz", "Outside Change", "bronze"],
  ["waltz", "Reverse Corte", "silver"],
  ["waltz", "Back Whisk", "silver"],
  ["waltz", "Basic Weave", "silver"],
  ["waltz", "Double Reverse Spin", "silver"],
  ["waltz", "Reverse Pivot", "silver"],
  ["waltz", "Progressive Chasse to Right", "silver"],
  ["waltz", "Weave from Promenade Position", "silver"],
  ["waltz", "Closed Telemark", "silver"],
  ["waltz", "Open Telemark", "silver"],
  ["waltz", "Open Impetus", "silver"],
  ["waltz", "Cross Hesitation", "silver"],
  ["waltz", "Hesitation Change", "silver"],
  ["waltz", "Wing", "silver"],
  ["waltz", "Outside Spin", "gold"],
  ["waltz", "Turning Lock", "gold"],
  ["waltz", "Left Whisk", "gold"],
  ["waltz", "Contra Check", "gold"],
  ["waltz", "Closed Wing", "gold"],
  ["waltz", "Drag Hesitation", "gold"],
  ["waltz", "Fallaway Reverse and Slip Pivot", "gold"],
  ["waltz", "Hover Corte", "gold"],

  // --- Tango ---------------------------------------------------------------------------
  ["tango", "Walk", "bronze"],
  ["tango", "Progressive Side Step", "bronze"],
  ["tango", "Progressive Link", "bronze"],
  ["tango", "Closed Promenade", "bronze"],
  ["tango", "Rock Turn", "bronze"],
  ["tango", "Open Reverse Turn (Lady Outside)", "bronze"],
  ["tango", "Back Corte", "bronze"],
  ["tango", "Open Promenade", "silver"],
  ["tango", "Left Foot Rock", "silver"],
  ["tango", "Natural Twist Turn", "silver"],
  ["tango", "Natural Promenade Turn", "silver"],
  ["tango", "Promenade Link", "silver"],
  ["tango", "Four Step", "silver"],
  ["tango", "Back Open Promenade", "gold"],
  ["tango", "Outside Swivel", "gold"],
  ["tango", "Fallaway Promenade", "gold"],
  ["tango", "Four Step Change", "gold"],
  ["tango", "Brush Tap", "gold"],
  ["tango", "Fallaway Four Step", "gold"],
  ["tango", "Oversway", "gold"],

  // --- Viennese Waltz ------------------------------------------------------------------
  ["viennese_waltz", "Natural Turn", "bronze"],
  ["viennese_waltz", "Reverse Turn", "bronze"],
  ["viennese_waltz", "Forward Change (Natural to Reverse)", "bronze"],
  ["viennese_waltz", "Forward Change (Reverse to Natural)", "bronze"],
  ["viennese_waltz", "Backward Change (Natural to Reverse)", "silver"],
  ["viennese_waltz", "Backward Change (Reverse to Natural)", "silver"],
  ["viennese_waltz", "Natural Fleckerl", "gold"],
  ["viennese_waltz", "Reverse Fleckerl", "gold"],
  ["viennese_waltz", "Contra Check", "gold"],

  // --- Slow Foxtrot --------------------------------------------------------------------
  ["foxtrot", "Feather Step", "bronze"],
  ["foxtrot", "Three Step", "bronze"],
  ["foxtrot", "Natural Turn", "bronze"],
  ["foxtrot", "Feather Finish", "bronze"],
  ["foxtrot", "Closed Impetus and Feather Finish", "bronze"],
  ["foxtrot", "Change of Direction", "bronze"],
  ["foxtrot", "Reverse Turn", "silver"],
  ["foxtrot", "Natural Weave", "silver"],
  ["foxtrot", "Basic Weave", "silver"],
  ["foxtrot", "Closed Telemark", "silver"],
  ["foxtrot", "Open Telemark", "silver"],
  ["foxtrot", "Top Spin", "silver"],
  ["foxtrot", "Hover Telemark", "silver"],
  ["foxtrot", "Open Impetus", "silver"],
  ["foxtrot", "Weave from Promenade Position", "silver"],
  ["foxtrot", "Hover Feather", "gold"],
  ["foxtrot", "Hover Cross", "gold"],
  ["foxtrot", "Natural Telemark", "gold"],
  ["foxtrot", "Curved Feather", "gold"],
  ["foxtrot", "Natural Twist Turn", "gold"],
  ["foxtrot", "Reverse Wave", "gold"],

  // --- Quickstep -----------------------------------------------------------------------
  ["quickstep", "Quarter Turns", "bronze"],
  ["quickstep", "Natural Turn", "bronze"],
  ["quickstep", "Natural Spin Turn", "bronze"],
  ["quickstep", "Progressive Chasse", "bronze"],
  ["quickstep", "Forward Lock", "bronze"],
  ["quickstep", "Natural Turn with Hesitation", "silver"],
  ["quickstep", "Closed Impetus", "silver"],
  ["quickstep", "Chasse Reverse Turn", "silver"],
  ["quickstep", "Double Reverse Spin", "silver"],
  ["quickstep", "Quick Open Reverse", "silver"],
  ["quickstep", "Running Finish", "silver"],
  ["quickstep", "Four Quick Run", "silver"],
  ["quickstep", "Cross Chasse", "silver"],
  ["quickstep", "Tipple Chasse to Right", "gold"],
  ["quickstep", "V6", "gold"],
  ["quickstep", "Fishtail", "gold"],
  ["quickstep", "Running Right Turn", "gold"],
  ["quickstep", "Six Quick Run", "gold"],
  ["quickstep", "Rumba Cross", "gold"],
  ["quickstep", "Cross Swivel", "gold"],
] as const;
