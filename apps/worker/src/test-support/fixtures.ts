// ─────────────────────────────────────────────────────────────────────────
// Worker-layer shared fixtures: a seed spec mirroring the domain SAMPLE routine
// + figure library (coach owns a shared Foxtrot routine + global figures; the
// student is a co-member; a stranger is a non-member). Reused by the DO/sync,
// permission, quota, invite, and EXPLAIN suites so a routine + figure doc + the
// co-membership relationships exist consistently.
//
// IDs are stable strings (not ULIDs) for legible failures; suites that need
// isolation between cases append a unique suffix (see do-id.ts).
// ─────────────────────────────────────────────────────────────────────────
import type { SeedDoc, SeedMembership, SeedSpec, SeedUser } from "./seed";

export const COACH = "user_coach";
export const STUDENT = "user_student";
export const STRANGER = "user_stranger";

export const ROUTINE_DOC = "rt_sample";
export const ROUTINE_DO_NAME = "routine-rt_sample";
export const FEATHER_FOXTROT_DOC = "fig_feather_foxtrot";
export const FEATHER_WALTZ_DOC = "fig_feather_waltz";
export const STUDENT_VARIANT_DOC = "fig_feather_variant_student";
export const ACCOUNT_DOC_COACH = "acct_coach";

export const SAMPLE_USERS: SeedUser[] = [
  { id: COACH, displayName: "Coach", identityColor: "#c0563f", plan: "free" },
  { id: STUDENT, displayName: "Student", identityColor: "#1f8a5b", plan: "free" },
  { id: STRANGER, displayName: "Stranger", identityColor: "#5b6b8a", plan: "free" },
];

export const SAMPLE_DOCS: SeedDoc[] = [
  {
    docRef: ROUTINE_DOC,
    type: "routine",
    ownerId: COACH,
    doName: ROUTINE_DO_NAME,
    dance: "foxtrot",
    title: "Sample Foxtrot",
  },
  {
    docRef: FEATHER_FOXTROT_DOC,
    type: "global-figure",
    ownerId: "app",
    doName: "figure-fig_feather_foxtrot",
    figureType: "feather",
    dance: "foxtrot",
  },
  {
    docRef: FEATHER_WALTZ_DOC,
    type: "global-figure",
    ownerId: "app",
    doName: "figure-fig_feather_waltz",
    figureType: "feather",
    dance: "waltz",
  },
  {
    docRef: ACCOUNT_DOC_COACH,
    type: "account",
    ownerId: COACH,
    doName: "account-acct_coach",
  },
];

// Coach owns the routine (editor); student is a commenter co-member; stranger
// is intentionally absent (non-member → permission-rejected, sees no notes).
export const SAMPLE_MEMBERSHIPS: SeedMembership[] = [
  { id: "mem_coach_rt", docRef: ROUTINE_DOC, userId: COACH, role: "editor" },
  { id: "mem_student_rt", docRef: ROUTINE_DOC, userId: STUDENT, role: "commenter" },
];

/** The full sample seed spec (users + docs + memberships). */
export const SAMPLE_SEED: SeedSpec = {
  users: SAMPLE_USERS,
  docs: SAMPLE_DOCS,
  memberships: SAMPLE_MEMBERSHIPS,
};
