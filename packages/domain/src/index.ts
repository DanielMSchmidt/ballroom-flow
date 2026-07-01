// @ballroom/domain — pure domain logic, no I/O.
// Submodules (ids, vocabulary, dances, timing, sortkey, oplog, seeding, copy,
// schemas) are added in Milestone 1 and re-exported here.
export { DANCE_IDS, DANCES, type DanceId, type DanceMeta } from "./dances";
export {
  addAccountReply,
  addFamilyNote,
  buildAccountDoc,
  readAccount,
  resolveFamilyNotesFor,
  softDeleteAccountAnnotation,
} from "./doc-account";
export { buildFigureDoc, readFigure, softDeleteAttribute } from "./doc-figure";
export { buildDoc } from "./doc-internal";
export {
  addAnnotation,
  addReply,
  addSection,
  buildRoutineDoc,
  readRoutine,
  softDeleteAnnotation,
  softDeleteReply,
  softDeleteSection,
} from "./doc-routine";
export type {
  AccountDoc,
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
  Placement,
  ReadOptions,
  Reply,
  Role,
  RoutineDoc,
  Section,
} from "./doc-types";
export {
  defaultFigureBars,
  figureGridSlots,
  type GridSlot,
  resolveFigureBars,
  SUB_BEATS,
} from "./figure-grid";
export { matchesFigureType } from "./figuretype";
export { cloneRoutine, copyOnWrite } from "./fork";
export { newId } from "./ids";
export {
  figureMatchesLibraryOrigin,
  globalFigureRef,
  LIBRARY_FIGURES,
  type LibraryFigure,
  type LibraryGroup,
  libraryFiguresForDance,
  libraryGroupsForDance,
  libraryGroupsForFilter,
} from "./library";
export { CURRENT_SCHEMA_VERSION, migrate } from "./migrations";
export {
  ensureSortKeys,
  keyBetween,
  keyForMove,
  type Ordered,
  sequentialKeys,
  sortByOrder,
} from "./order";
export {
  type Capabilities,
  type Capability,
  can,
  capabilitiesFor,
  type EffectiveRole,
  type MembershipRole,
} from "./permissions";
export { parseAttributeRead, parseAttributeWrite } from "./schemas";
export { buildGoldenWaltzBasic } from "./starter-routine";
export {
  barsForFigure,
  countLabel,
  countToPhrase,
  isOnEighthGrid,
  type NumberedBeatEntry,
  numberRoutineBeats,
  offBeatSymbol,
  type RoutineBeatEntry,
} from "./timing";
export { redoLastChange, undoLastChange, wasSupersededByOthers } from "./undo";
export {
  ATTRIBUTE_REGISTRY,
  isReservedKind,
  kindAppliesToDance,
  mergeRegistry,
  normalizeValue,
  type RegistryKind,
  type StandardRegistry,
  slugifyKind,
} from "./vocabulary";
export { buildWdsfAttributes, parseWdsfTiming } from "./wdsf-timing";
