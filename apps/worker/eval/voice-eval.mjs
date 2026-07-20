// Voice-note EVAL harness — runs the REAL Cloudflare Workers AI extraction model
// against the golden cases and reports pass/fail. Run ON DEMAND (credentialed),
// NEVER in CI. See docs/TOOLING.md § AI voice notes for the env vars + command.
//
//   pnpm eval:voice            (from apps/worker, or `pnpm --filter worker eval:voice`)
//
// It reuses the ACTUAL production prompt: it imports `buildInterpretMessages`
// (the same builder `workersVoiceAi.interpret` calls) and `groundProposal` (the
// same re-validation + grounding the /interpret route runs), so what it evaluates
// is exactly what ships — no prompt drift. The model is called via the Workers AI
// REST API, routed through AI Gateway with the `cf-aig-gateway-id` header.
//
// This file is the I/O shell only; the golden cases + the pure expectation checker
// live in `voice-eval-core.mjs` (unit-tested in `voice-eval-core.test.ts`).
import { buildInterpretMessages, groundProposal, VOICE_EXTRACT_MODEL } from "../src/voice-ai.ts";
import { checkExpectation, GOLDEN_CASES } from "./voice-eval-core.mjs";

/** Read a required env var or fail fast with a clear, actionable message. */
function requireEnv(name) {
  const value = process.env[name];
  if (value == null || value === "") {
    console.error(
      `\nMissing env var ${name}. The voice eval calls the REAL Workers AI model and needs:\n` +
        "  CLOUDFLARE_ACCOUNT_ID   your Cloudflare account id\n" +
        "  CLOUDFLARE_API_TOKEN    a token with Workers AI read/run\n" +
        "  AI_GATEWAY_ID           the AI Gateway id (e.g. weave-steps)\n" +
        "\nSet them, then re-run `pnpm eval:voice`. (Nothing here runs in CI.)\n",
    );
    process.exit(2);
  }
  return value;
}

/** POST one transcript+context to the Workers AI extraction model; return raw JSON.
 *  Mirrors `workersVoiceAi.interpret`: the model may answer with the JSON as a
 *  string (chat) — parse it; `groundProposal` re-validates whatever comes back. */
async function callModel({ accountId, apiToken, gatewayId }, transcript, context) {
  const payload = buildInterpretMessages(transcript, context);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${VOICE_EXTRACT_MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      "cf-aig-gateway-id": gatewayId,
    },
    body: JSON.stringify({
      messages: payload.messages,
      response_format: payload.response_format,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Workers AI HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const envelope = await res.json();
  // Workers AI wraps the model output in { result: {...}, success, errors }.
  const result = envelope?.result ?? envelope;
  const response = result?.response ?? result;
  if (typeof response === "string") {
    try {
      return JSON.parse(response);
    } catch {
      return null; // unparseable → groundProposal degrades to resolved:false
    }
  }
  return response;
}

async function main() {
  const creds = {
    accountId: requireEnv("CLOUDFLARE_ACCOUNT_ID"),
    apiToken: requireEnv("CLOUDFLARE_API_TOKEN"),
    gatewayId: requireEnv("AI_GATEWAY_ID"),
  };

  console.log(
    `\nVoice-note eval — model ${VOICE_EXTRACT_MODEL} (via AI Gateway ${creds.gatewayId})\n`,
  );
  const rows = [];
  let passed = 0;

  for (const testCase of GOLDEN_CASES) {
    let proposal;
    let error = null;
    try {
      const raw = await callModel(creds, testCase.transcript, testCase.context);
      // The SAME grounding prod runs — Zod re-validate + ground every ref.
      proposal = groundProposal(raw, testCase.context, testCase.transcript);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (error != null) {
      rows.push({ name: testCase.name, status: "ERROR", detail: error });
      continue;
    }
    const { pass, failures } = checkExpectation(proposal, testCase.expect);
    if (pass) {
      passed += 1;
      rows.push({
        name: testCase.name,
        status: "PASS",
        detail: `noteText: ${JSON.stringify(proposal.noteText)}`,
      });
    } else {
      rows.push({ name: testCase.name, status: "FAIL", detail: failures.join("; ") });
    }
  }

  for (const row of rows) {
    const mark = row.status === "PASS" ? "✓" : row.status === "FAIL" ? "✗" : "!";
    console.log(`  ${mark} ${row.status.padEnd(5)} ${row.name}`);
    if (row.detail) console.log(`        ${row.detail}`);
  }
  const total = GOLDEN_CASES.length;
  console.log(`\n${passed}/${total} passed.\n`);
  process.exit(passed === total ? 0 : 1);
}

await main();
