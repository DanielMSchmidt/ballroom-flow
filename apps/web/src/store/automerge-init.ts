// Lazy Automerge WASM initialization (the code-split enabler).
//
// The production build resolves the SLIM Automerge (vite alias
// `@automerge/automerge` → `@automerge/automerge/slim`), which does NOT
// auto-initialize its ~2.75 MB WASM via a top-level await. That top-level await
// was the reason the WASM couldn't be code-split off the initial load:
// `vite-plugin-top-level-await` hoisted it into the ENTRY chunk, wrapping the
// whole app render in `Promise.all([automergeInit]).then(renderApp)` — so the
// WASM sat on the critical path no matter how the React components were split.
//
// With slim, there is no auto-init, so nothing gets hoisted; instead we
// initialize the WASM HERE, awaited by `openRoutine` (the single live/Automerge
// entry point — the read/snapshot path is Automerge-free). The result: the WASM
// (and the Automerge glue) load only when a routine is actually opened, behind
// the lazy Assemble chunk, off the first paint of the choreo list.
//
// Memoized — one initialization per session; concurrent callers share the promise.
//
// Under vitest the store resolves the FULL Automerge (the test config has no
// alias), which auto-initializes its own WASM, so this is a no-op there.
let initPromise: Promise<void> | null = null;

export function ensureWasm(): Promise<void> {
  if (!initPromise) initPromise = initWasm();
  return initPromise;
}

async function initWasm(): Promise<void> {
  // vitest resolves the auto-initializing full Automerge — nothing to do, and the
  // `?url` asset import below isn't meaningful outside a real vite build.
  if (import.meta.env.MODE === "test") return;
  const [{ initializeWasm }, { default: wasmUrl }] = await Promise.all([
    import("@automerge/automerge/slim"),
    import("@automerge/automerge/automerge.wasm?url"),
  ]);
  await initializeWasm(wasmUrl);
}
