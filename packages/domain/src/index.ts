// @weavesteps/domain — pure domain logic, no I/O.
// Submodules (ids, vocabulary, dances, timing, sortkey, oplog, seeding, copy,
// schemas) are added in Milestone 1 and re-exported here.
export { DANCE_IDS, DANCES, type DanceId, type DanceMeta } from "./dances";
export {
  addAccountReply,
  addFamilyNote,
  addLibraryRef,
  buildAccountDoc,
  readAccount,
  removeLibraryRef,
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
  defaultFigureCounts,
  figureCountSlots,
  figureGridSlots,
  type GridSlot,
  partBeatSpan,
  resolveFigureBars,
  resolveFigureCounts,
  SUB_BEATS,
  windowAttributes,
} from "./figure-grid";
export { matchesFigureType } from "./figuretype";
export {
  cloneRoutine,
  copyFigureForFork,
  copyOnWrite,
  ownedBeats,
  resolveFigure,
  spawnVariant,
  variantAttributesForEdit,
} from "./fork";
export { newId } from "./ids";
export {
  figureMatchesLibraryOrigin,
  globalFigureRef,
  LIBRARY_FIGURES,
  type LibraryFigure,
  type LibraryGroup,
  libraryFigureByRef,
  libraryFiguresForDance,
  libraryGroupsForDance,
  libraryGroupsForFilter,
  parseGlobalFigureRef,
} from "./library";
export { CURRENT_SCHEMA_VERSION, migrate, migrateDraft } from "./migrations";
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
export {
  isSeededAttributeId,
  reconcileSeededFigure,
  type SeedFigureContent,
} from "./seed-reconcile";
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
  slowQuickTokens,
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
