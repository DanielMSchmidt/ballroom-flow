// @ballroom/domain — pure domain logic, no I/O.
// Submodules (ids, vocabulary, dances, timing, sortkey, oplog, seeding, copy,
// schemas) are added in Milestone 1 and re-exported here.
export { DANCES, type DanceId, type DanceMeta } from "./dances";
export { newId } from "./ids";
