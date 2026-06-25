// ─────────────────────────────────────────────────────────────────────────
// Typed dynamic-import shim for NOT-YET-BUILT product screens/components.
//
// WHY: component tests reference screens the frontend agent is building in
// parallel (they don't exist yet). A literal `import("../components/Foo")` would
// fail `tsc` (unresolved module) and break the (skipped) suite's typecheck. We
// can't use `any` (Biome noExplicitAny:error). So we import via a RUNTIME-VARIABLE
// specifier and cast to a caller-supplied structural type — `tsc` can't resolve
// the variable specifier, so it trusts the cast. The runtime import only happens
// inside a skipped `it`, so nothing loads until the component exists + we unskip.
//
// Usage (inside a skipped test body):
//   const { AttributeEditor } = await importComponent<AttributeEditorModule>(
//     "../components/AttributeEditor",
//   );
// ─────────────────────────────────────────────────────────────────────────
import type { ComponentType } from "react";

/** A React component module with at least one named/default export under test. */
export type ComponentModule = Record<string, ComponentType<Record<string, unknown>>>;

/**
 * Dynamically import a product component module, typed as `T`. The specifier is
 * passed through a variable so the type-checker defers to the `T` cast rather
 * than resolving the (currently missing) module. Replace with a direct typed
 * import once the component exists.
 */
export async function importComponent<T = ComponentModule>(specifier: string): Promise<T> {
  const path = specifier;
  return (await import(/* @vite-ignore */ path)) as T;
}
