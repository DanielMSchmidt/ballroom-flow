// @ballroom/domain — pure domain logic, no I/O.
// Submodules (ids, vocabulary, dances, timing, sortkey, oplog, seeding, copy,
// schemas) are added in Milestone 1 and re-exported here.
export { DANCE_IDS, DANCES, type DanceId, type DanceMeta } from "./dances";
export { buildFigureDoc, readFigure, softDeleteAttribute } from "./doc-figure";
export { addSection, buildRoutineDoc, readRoutine, softDeleteSection } from "./doc-routine";
export type {
  Alignment,
  Anchor,
  Annotation,
  AnnotationKind,
  Attribute,
  DocHandle,
  DocScope,
  FigureDoc,
  FigureSource,
  FigureType,
  Overlay,
  Placement,
  ReadOptions,
  Reply,
  Role,
  RoutineDoc,
  Section,
} from "./doc-types";
export { matchesFigureType } from "./figuretype";
export { cloneRoutine, copyOnWrite } from "./fork";
export { newId } from "./ids";
export { CURRENT_SCHEMA_VERSION, migrate } from "./migrations";
export { resolve } from "./overlay";
export {
  type Capabilities,
  type Capability,
  can,
  capabilitiesFor,
  type EffectiveRole,
  type MembershipRole,
} from "./permissions";
export { parseAttributeRead, parseAttributeWrite } from "./schemas";
export { barsForFigure, countLabel, countToPhrase, isOnEighthGrid } from "./timing";
export { redoLastChange, undoLastChange } from "./undo";
export {
  ATTRIBUTE_REGISTRY,
  mergeRegistry,
  normalizeValue,
  type RegistryKind,
  type StandardRegistry,
} from "./vocabulary";
