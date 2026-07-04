// #116 — Real two-client WebSocket convergence smoke (the spike's last gate).
//
// vitest-pool-workers can't drive a full Hibernatable-WS delivery cycle
// (SPIKE-FINDINGS sharp-edge #3), so this drives TWO real WebSocket clients
// against the live `GET /docs/:id/connect` route on a real workerd runtime and
// asserts genuine cross-client convergence — the thing the in-pool RPC stand-in
// can't prove.
//
// USAGE (against a running `wrangler dev`):
//   pnpm --filter worker dev          # in one shell (boots local workerd)
//   node apps/worker/scripts/ws-smoke.mjs   # in another (uses ws://localhost:8787)
//   # or override the base: WS_BASE=ws://localhost:8801 node …/ws-smoke.mjs
//
// It exercises: (1) A's change reaches B + both converge (heads-equal);
// (2) a fresh client catches up via the on-connect SNAPSHOT frame;
// (3) a duplicate change is a no-op. Exits non-zero on any failure.
//
// Uses Node's built-in `WebSocket` (Node 22+/24) — no `ws` dependency — and the
// real `@automerge/automerge` to build/apply changes the way the DO's wire does.
//
// D10 wire (2026-07-02): server→client BINARY frames carry a 1-byte TYPE tag —
// SNAPSHOT (whole doc, A.load+merge on connect) or CHANGE (one incremental
// change). Client→server frames stay RAW change bytes (untagged). These byte
// constants MIRROR @weavesteps/contract's SYNC_FRAME_* (kept inline so this plain
// node script needs no TS/workspace resolution).
import * as A from "@automerge/automerge";

const SYNC_FRAME_SNAPSHOT = 0x01;
const SYNC_FRAME_CHANGE = 0x02;

const BASE = process.env.WS_BASE ?? "ws://localhost:8787";
const docId = `smoke-${Math.random().toString(16).slice(2)}`;
const url = `${BASE}/docs/${docId}/connect`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open a WS client; buffers incoming BINARY frames (ignores the text caught-up
 *  marker) as Uint8Array, tag byte included. */
function connect(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const received = [];
    ws.addEventListener("message", (ev) => {
      if (ev.data instanceof ArrayBuffer) received.push(new Uint8Array(ev.data));
      // text frames (SYNC_CAUGHT_UP) carry no doc bytes — ignore.
    });
    ws.addEventListener("open", () => resolve({ ws, received, label }));
    ws.addEventListener("error", (e) => reject(new Error(`${label} ws error: ${e.message ?? e}`)));
    setTimeout(() => reject(new Error(`${label} connect timeout`)), 8000);
  });
}

/** Merge all buffered server→client frames into a doc: a SNAPSHOT frame is
 *  A.load+merge'd; CHANGE frames are applied. Strips the 1-byte type tag. */
function applyFrames(doc, frames) {
  let next = doc;
  const changes = [];
  for (const f of frames) {
    if (f.byteLength === 0) continue;
    const payload = f.slice(1);
    if (f[0] === SYNC_FRAME_SNAPSHOT) next = A.merge(next, A.load(payload));
    else if (f[0] === SYNC_FRAME_CHANGE) changes.push(payload);
  }
  if (changes.length > 0) [next] = A.applyChanges(next, changes);
  return next;
}

const headsEqual = (x, y) =>
  JSON.stringify(A.getHeads(x).sort()) === JSON.stringify(A.getHeads(y).sort());

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
};

async function main() {
  const a = await connect("A");
  const b = await connect("B");
  await sleep(500); // let catch-up frames arrive

  // Both clients build their local doc from the DO's catch-up replay.
  let docA = applyFrames(A.init(), a.received.splice(0));
  let docB = applyFrames(A.init(), b.received.splice(0));

  // (1) A makes a real change and sends its raw bytes; B must receive + converge.
  const beforeHeadsB = A.getHeads(docB);
  // The DO seeds an empty routine whose `sections` is already an Automerge array,
  // so push into it — never reassign (Automerge 3.x rejects assigning an existing
  // doc object back onto itself: "Cannot create a reference to an existing …").
  docA = A.change(docA, (d) => {
    d.sections.push({ id: "sec_smoke", name: "FromA", placements: [], deletedAt: null });
  });
  const change = A.getLastLocalChange(docA);
  a.ws.send(change);
  await sleep(800);

  check("(1a) B received a frame after A's change", b.received.length > 0);
  docB = applyFrames(docB, b.received.splice(0));
  check(
    "(1b) B's doc has A's edit (section 'FromA')",
    (docB.sections ?? []).some((s) => s.name === "FromA"),
  );
  check("(1c) A and B converged (heads-equal)", headsEqual(docA, docB));
  check(
    "(1d) B's heads advanced",
    JSON.stringify(A.getHeads(docB)) !== JSON.stringify(beforeHeadsB),
  );

  // (3) duplicate: re-send the same change — must be a no-op (no heads change).
  const headsBeforeDup = A.getHeads(docB).sort();
  a.ws.send(change);
  await sleep(500);
  docB = applyFrames(docB, b.received.splice(0));
  check(
    "(3) duplicate change is a no-op (B heads unchanged)",
    JSON.stringify(A.getHeads(docB).sort()) === JSON.stringify(headsBeforeDup),
  );

  // (2) reconnect/catch-up: a fresh client C must catch up to A's edit on connect.
  const c = await connect("C");
  await sleep(600);
  const docC = applyFrames(A.init(), c.received.splice(0));
  check(
    "(2) reconnecting client C catches up via the on-connect snapshot (has A's edit)",
    (docC.sections ?? []).some((s) => s.name === "FromA"),
  );
  check("(2b) C converged with A (heads-equal)", headsEqual(docC, docA));

  for (const cl of [a, b, c]) cl.ws.close();
  console.log(failures === 0 ? "\nSMOKE_RESULT=ALL_PASS" : `\nSMOKE_RESULT=${failures}_FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log(`SMOKE_ERROR: ${e?.stack ?? e}`);
  process.exit(2);
});
