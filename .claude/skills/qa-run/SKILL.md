---
name: qa-run
description: Launch the independent qa-explorer agent against a locally-served E2E build of Weave Steps. User-invoked only (/qa-run [focus]) — full exploratory sweep of every documented feature by default, or a focused sweep when args name an area (e.g. "/qa-run sharing and invites"). The agent files GitHub issues for confirmed findings; this skill collects the coverage report. Do not invoke on your own initiative — the user decides when QA runs.
---

# /qa-run — employ the independent QA explorer

You are the orchestrator. The testing itself is done by the **`qa-explorer`** agent
(`.claude/agents/qa-explorer.md`) — an independent, adversarial tester that launches its own
server + browser, verifies every feature first-hand on desktop and mobile with multiple
accounts, and files `[QA]`-prefixed GitHub issues. Your job is to launch it well and to
relay its results faithfully. **Do not do the testing yourself, and do not start fixing
anything it finds** — the user stays in control of both.

## 1. Preflight (fast — don't burn the agent's budget on a broken env)

1. `git rev-parse --short HEAD` and `git status --short` — note the SHA; warn the user if
   the tree is dirty (the run will test uncommitted state; that may be intended).
2. Dependencies present? (`node_modules` exists / `pnpm install` has run — see
   `ballroom-flow-build-and-env` if not.)
3. Pick a **unique free port** for the run (not 4173) and pass it to the agent.
4. Scope: `/qa-run` with no args = **full sweep** (every feature in `docs/concepts/`, all
   probes). With args = focused sweep of the named area — the agent still runs the
   applicable probes from `.claude/qa/probes.md` and still tests both viewports and
   multi-account within that area.

## 2. Launch

Create the report directory if needed: `.claude/qa/reports/`. Then launch **one**
`qa-explorer` agent (subagent_type: `qa-explorer`) with a prompt containing exactly:

- The scope (full sweep, or the user's focus area verbatim).
- The commit SHA and whether the tree was dirty.
- The port to use (`E2E_PORT=<port>`).
- The report path: `.claude/qa/reports/<YYYY-MM-DD>-<scope-slug>.md` — it must write its
  full report there in addition to its final summary message.
- Any extra context the user gave (recent changes to stress, areas to skip, time budget).

The run is long (a full sweep can be an hour+ of agent time). Let it run to completion;
don't interrupt it for progress, and don't run a second explorer in parallel against the
same port or state dir.

## 3. When it returns

1. **Relay the results** — the agent's summary is not shown to the user, so your message
   must carry it: issues filed (numbers + titles + severity), the coverage table's headline
   (N verified / N issues / N not-verified and why), probe outcomes, and the agent's
   "dig next" pointers.
2. Sanity-check the issues list against the repo (they really exist, no obvious dupes). If
   the agent couldn't file issues (no GitHub access), the findings are in the report file —
   tell the user and offer to file them.
3. The report file and any `.claude/qa/probes.md` state are worth keeping across sessions:
   offer to commit them on a `chore/qa-report-<date>` branch (never to `main` — CLAUDE.md
   §6). Committing is the user's call.
4. **Do not fix anything.** If the user wants fixes, that's a separate task another agent
   picks up from the filed issues.
