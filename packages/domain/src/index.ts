// @ballroom/domain — pure domain logic, no I/O.
// Submodules (ids, vocabulary, dances, timing, sortkey, oplog, seeding, copy,
// schemas) are added in Milestone 1 and re-exported here.
export { DANCES, type DanceId, type DanceMeta } from "./dances";
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
export { cloneRoutine, copyOnWrite } from "./fork";
export { newId } from "./ids";
export { resolve } from "./overlay";
export { barsForFigure, countLabel, countToBar } from "./timing";
export { redoLastChange, undoLastChange } from "./undo";
export {
  ATTRIBUTE_REGISTRY,
  mergeRegistry,
  normalizeValue,
  type RegistryKind,
  type StandardRegistry,
} from "./vocabulary";
