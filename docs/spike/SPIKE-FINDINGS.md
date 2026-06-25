# M0.5 Architecture Spike — Findings

**Date:** 2026-06-25 · **Verdict: GO** ✅
**Goal:** before committing the v4.x plan, prove the riskiest, least-proven piece — running **Automerge** as a CRDT inside **Cloudflare Durable Objects + SQLite**, with sync + persistence + a permission boundary.

The throwaway spike lives in `apps/worker/spike/` (a SQLite-backed `RoutineDO` hosting an Automerge doc) and runs against the **real workerd + DO + SQLite runtime** via `@cloudflare/vitest-pool-workers`. Reproduce:

```
cd apps/worker
pnpm exec vitest run --config vitest.spike.config.ts        # S1–S5 + smoke (6 tests)
pnpm exec wrangler deploy --dry-run -c wrangler.spike.toml   # bundling + size
```

## What was proven (all green on the real runtime)

| # | Question | Result |
|---|---|---|
| Smoke | Does Automerge (WASM) load + run inside workerd? | ✅ **Yes, with zero special init.** `init/change/save/load` work; `@automerge/automerge@3.2.6`. |
| S1 | Does DO SQLite persist + reload an Automerge doc? | ✅ Saved as a BLOB (`Uint8Array`→`ArrayBuffer`) via `ctx.storage.sql`; white-box test confirms the bytes are in SQLite and the cold-load path reconstructs the doc. |
| S2 | Do two clients converge through the DO? | ✅ Two clients pull, edit concurrently (offline), push via `merge` — both edits survive. |
| S3 | Permission boundary? | ✅ The DO gates each op; a viewer and a non-member are rejected, an editor succeeds. (Production: check D1 membership on the *sync connection*, not per-op.) |
| S4 | Partition convergence / commutativity / idempotence? | ✅ Diverged replicas converge regardless of merge order; duplicate changes are idempotent. |
| S5 | Multi-doc references + variant overlay? | ✅ A routine DO references a separate figure DO; overlay resolution (base − tombstones + overrides + additions) works, and **a new base attribute flows up into the variant**. |
| Build | Does it bundle + deploy under the Workers size limit? | ✅ **gzip 920 KiB** total (Automerge WASM is the bulk, 2.6 MB raw) — well under the 10 MB paid limit (and the 3 MB free limit). |

## Sharp edges found (these refine the plan)

1. **vitest-pool-workers isolated storage is incompatible with SQLite-backed DOs.** Teardown asserts on the `.sqlite` file and chokes on SQLite's `-shm`/`-wal` sidecars (`Isolated storage failed… Expected .sqlite, got …sqlite-shm`). **Fix:** set `poolOptions.workers.isolatedStorage: false` and give each test a **unique DO id/name** (we do). → Folded into PLAN.md §10.
2. **Persistence strategy matters for cost.** The spike does a full `save`/`load` per op (simplest correctness proof). **Production** should keep the doc in memory and persist **incremental** changes (`A.saveIncremental` / per-change bytes) to SQLite, compacting to a fresh snapshot on the DO **alarm** — not rewrite the whole doc each edit. → PLAN.md §2.4/§6.
3. **WebSocket + Hibernatable WebSockets were *not* exercised end-to-end.** vitest-pool-workers can't easily drive a real WS hibernation cycle, so the spike used **DO RPC** as the transport stand-in. The CRDT + storage + permission core is proven; the **live WS sync/hibernation behavior is the one remaining unknown** and must be validated with `wrangler dev` or a manual harness in **M2**. → PLAN.md §9 (M2) + §12.
4. **We may not need `automerge-repo`.** The spike used **core `@automerge/automerge`** + a hand-rolled change/merge exchange and it was small and clean. `automerge-repo` adds a storage/network-adapter framework; its main value is an efficient **sync protocol** (only exchange missing changes) and multi-doc bookkeeping. **Recommendation:** start M2 with **core Automerge + a thin custom sync over DO WebSockets** (what the spike approximates); adopt `automerge-repo`'s sync protocol only if delta-efficiency demands it. This *reduces* the "DIY adapters" risk the plan flagged. → PLAN.md D13/§6.1/Q-CRDT-LIB.

## Net effect on the plan
The foundational bet (Automerge-in-DO-on-Cloudflare) is **validated** — persistence, convergence, permission, multi-doc/overlay, and deployable bundle size all hold. The remaining risk narrows to **(a) live WebSocket/hibernation sync** (validate in M2) and **(b) per-document DO fan-out at scale** (a perf question, not a feasibility one). Proceed with the plan.
