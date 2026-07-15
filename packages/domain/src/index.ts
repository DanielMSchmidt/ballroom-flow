// @weavesteps/domain — pure domain logic, no I/O.
// Submodules (ids, vocabulary, dances, timing, sortkey, oplog, seeding, copy,
// schemas) are added in Milestone 1 and re-exported here.
export { DANCE_IDS, DANCES, type DanceId, type DanceMeta, isDanceId } from "./dances";
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
  type PlacementPart,
  partBeatSpan,
  resolveFigureBars,
  resolveFigureCounts,
  SUB_BEATS,
  stepSpan,
  windowAttributes,
} from "./figure-grid";
export { figureTypeNoteCount, matchesFigureType } from "./figuretype";
export {
  cloneRoutine,
  copyFigureForFork,
  copyOnWrite,
  ownedBeats,
  resolveFigure,
  spawnVariant,
  variantAttributesForEdit,
} from "./fork";
export { isPlainRecord, isRecord, stringIdOf } from "./guards";
export { newId } from "./ids";
export {
  figureHasLibraryOrigin,
  figureMatchesLibraryOrigin,
  figureTypeHasCatalogFamily,
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
export {
  type BothWriteTargets,
  bothWriteTargets,
  deriveFollowerValue,
  isBothConsistent,
  splitSharedForRole,
} from "./role-write";
export { parseAnchors, parseAttributeRead, parseAttributeWrite, zAnchor } from "./schemas";
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
  phraseCountLabel,
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
