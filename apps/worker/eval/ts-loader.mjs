// Module resolve hook so the plain-Node eval can import the ACTUAL monorepo TS
// sources (the production prompt builder) without a bundler or a new dependency.
//
// The repo's workspace packages export raw `.ts` and use extensionless relative
// imports (`./fork`, `./dances`), neither of which Node's default ESM resolver
// handles. This hook fills exactly those two gaps:
//   • bare `@weavesteps/{domain,contract}` → that package's `src/index.ts`
//   • a relative import with no real extension → the same path + `.ts`
// Node's built-in type-stripping (`--experimental-strip-types`, default in
// Node ≥22.18/24) does the actual TS→JS. Synchronous `registerHooks` (Node
// ≥22.15) keeps this in-process, so `voice-eval.mjs` reuses the production
// `buildInterpretMessages`/`groundProposal` with ZERO prompt drift.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKSPACE_SRC = {
  "@weavesteps/domain": resolve(ROOT, "packages/domain/src/index.ts"),
  "@weavesteps/contract": resolve(ROOT, "packages/contract/src/index.ts"),
};

// Anything ending in a real module extension is left to the default resolver.
const HAS_EXTENSION = /\.(m?js|m?ts|json|node)$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const workspace = WORKSPACE_SRC[specifier];
    if (workspace) {
      return { url: pathToFileURL(workspace).href, shortCircuit: true };
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !HAS_EXTENSION.test(specifier) &&
      context.parentURL?.startsWith("file:")
    ) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`);
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
