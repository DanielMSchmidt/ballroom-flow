// Production-safe subpath surface for the shared SAMPLE fixture data
// (@weavesteps/domain/fixtures). The worker leans on this to seed the app-owned
// READ-ONLY sample routine (US-045, apps/worker/src/sample.ts).
//
// This file deliberately re-exports ONLY the sample *data* (frozen routines +
// figure library) — NOT the test-only utilities the sibling `index.ts` barrel
// pulls in (`domain-api` = the importDomain test shim, `convergence`, `factories`).
// Keeping those out of the public subpath preserves the `__fixtures__` =
// test-only boundary: only pure sample data crosses the package edge.
export {
  FEATHER_FOXTROT,
  FEATHER_WALTZ,
  SAMPLE_FIGURE_LIBRARY,
  SAMPLE_ROUTINE,
  SAMPLE_WALTZ_ROUTINE,
  STUDENT_FEATHER_VARIANT,
  THREE_STEP_FOXTROT,
} from "./sample";
