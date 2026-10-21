# Team handoffs (CrewAI-style delegation) — design

## Intent
Make aorch's agents pass work to each other like a small team, borrowing the *pattern* from CrewAI (manager that delegates, agents that hand sub-tasks to teammates, tasks with an explicit goal and expected output). Not the CrewAI framework: no Python dependency, no new adapter. aorch keeps owning runs, worktrees, approvals, the event log and the TUI.

Success: a user can run a `team` workflow where a manager plans and assigns work to crew bots, workers can hand sub-tasks sideways, everything is visible live in the TUI and run chat, and all of it is bounded, resumable and deletable like any other run. Workflows without a manager behave exactly as today.

Decided with the user: build both a **manager** and **worker-to-worker handoffs**, in two stages.

## Today (what exists)
- Sequential handoff along DAG edges; upstream output passed via `pipeMode` (`direct` or full ancestors).
- `@ASK <step>: …` lets a running step question a finished one, read-only (`src/consult.ts`).
- Gates/reviewers loop work back to a fixing step.
- Missing: forward delegation, a manager that plans at run time, per-handoff contracts, merge of parallel results.

## Approach
Handoffs become **dynamic nodes in the existing DAG**, added by a new `node.spawned` event (event-sourced; resume, TUI, dashboard and run deletion keep working). Rejected: separate child runs (worktree merge pain, hard to follow in the TUI) and prompt-only inline delegation (invisible, not resumable).

## 1. Handoff contract
One record per handoff:
- `to`: bot id or role on the roster.
- `goal`: one sentence.
- `expected`: what the result should look like (file change, verdict, short report).
- `context`: list of step ids whose output the receiver needs (replaces dumping all upstream text).
- `mode`: `read` | `write`. Default `read`; `write` requires workflow permission.
- `after`: optional ids of sibling contracts it depends on (manager plans only).

The receiver's prompt is built from the contract. Its result returns to the delegator in the requested form. Recorded as `node.spawned {id, parent, depth, contract}`; shown in the step list, crew view (baton between bots) and run chat.

## 2. Manager (stage 1)
An agent step with `manager: true` and a roster (default: whole crew, or an explicit list). Rounds:
1. **Plan:** manager replies with JSON contracts; engine validates (known bots, non-empty goals, acyclic `after`, limits) and spawns. Invalid plans are returned to the manager with the reason.
2. **Work:** spawned steps run on the normal scheduler (independent ones in parallel); write steps use the usual worktree, gates and approvals.
3. **Review:** manager sees each result beside `expected` and answers `accept`, `redo <step>: <reason>` or `more work: <contracts>`.
4. **Done:** manager's summary is the run result.

Control: `planApproval` (default on when any contract is `write`) pauses for user approval before spawning; Maestro-as-manager shows the plan as a choice card (approve / edit / reject); the run cost cap applies. Authoring: "manager" step type in the editor plus a built-in `team` workflow (manager → spawned work → tester → reviewer).

## 3. Worker handoffs (stage 2)
A worker may end its answer with:
`@HAND <bot>: <goal> | expect: <expected> | context: <step ids>` (read) or `@HAND! …` (write).
- Read handoffs run as a real spawned step, resumable and visible.
- Write handoffs only if the workflow sets `allowWorkerWrites`; run serially in the same worktree; the delegator pauses and resumes with the result appended.
- Sideways only: cannot target the delegator's own ancestors (no loops). `@ASK` is unchanged.

## 4. Limits and safety (engine-enforced)
- `maxDepth` 3, `maxSpawn` 12 per run (redos count), redo loops 2 per step.
- Run cost cap covers spawned steps; hitting it pauses the run.
- Approval steps still pause the run; spawned write steps follow workflow approval rules.
- Failures of spawned steps are returned to the delegator, who may retry, reassign or give up (then normal failure card).
- Every spawn/handoff is an event: run chat, progress reports and failure diagnosis see it; deleting a run removes its spawned steps.
- Old logs and workflows replay unchanged; new events are additive.

## Testing
Unit: contract parsing/validation, depth/spawn limits, cycle rejection, `@HAND` parsing. Engine (mock adapter): manager run with parallel spawns, redo loop, failure routed back, resume mid-run, run deletion. TUI: baton/step rendering.

## Build order
Stage 1: contract, `node.spawned`, manager, limits, `team` workflow. Stage 2: `@HAND` workers. Each stage is its own plan and ships separately.

## Out of scope
CrewAI framework/Python bridge, importing CrewAI YAML projects, long-term agent memory.
