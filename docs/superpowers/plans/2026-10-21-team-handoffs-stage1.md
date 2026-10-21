# Team Handoffs, Stage 1 (contract + manager) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager step plans a set of handoff contracts at run time, the engine spawns them as real steps, the manager reviews the results (accept / redo / more work), all bounded by engine-enforced limits.

**Architecture:** Spawned steps are added to the run's DAG by a new additive `node.spawned` event that `foldRun` applies to `state.pipeline` (the same way `node.amended` already edits it). A manager is a read-only agent step with `manager: true`; `Engine.runManager` runs plan → work → review rounds by calling the scheduler on the subset of spawned steps. Pure parsing/validation/prompt code lives in a new `src/handoff.ts`.

**Tech Stack:** TypeScript (Node ≥22.12, ESM), vitest, existing `MockAdapter`.

**Spec:** `docs/superpowers/specs/2026-10-21-team-handoffs-design.md` (sections 1, 2, 4; section 3 `@HAND` is stage 2 and not in this plan).

## Global Constraints

- Defaults: `maxDepth` 3, `maxSpawn` 12 per run (redos count), redo loops 2 per step.
- Handoff contract fields: `to`, `goal`, `expected`, `context` (step ids), `mode` (`read`|`write`, default `read`), `after` (sibling ids).
- Spawned step id is `<manager id>-<local id>` (stays within the existing `[A-Za-z0-9_-]{1,40}` id rule).
- `planApproval` defaults to on when any contract is `write`.
- Old event logs and saved workflows must replay and load unchanged; the new event is additive. Pipelines without a manager behave exactly as before; every existing test must stay green.
- No Claude/Anthropic attribution or co-author trailers in commits.
- Maestro choice-card for plan approval is deferred (the existing approve/reject keys on the approval step cover control in stage 1).

## Review Focus

- Manager returns non-JSON or prose around the JSON: plan is parsed from the first JSON object, otherwise the manager is told why and gets one retry round; still invalid fails the manager step with the reason.
- Plan names an unknown bot, a duplicate id, a cyclic `after`, an empty goal, or more tasks than the remaining spawn budget: rejected with a reason fed back, never half-spawned.
- Run is stopped/resumed mid-work: resume reuses existing spawned steps and does not spawn a second plan.
- A spawned step fails: its failure text goes to the manager's review round instead of failing the run directly.
- Cost cap hit during spawned work: run ends with the existing "budget exhausted" error, spawned queued steps are skipped.

---

### Task 1: Types, fold and pipeline validation for spawned steps

**Files:**
- Modify: `src/types.ts` (PipelineNode, PipelineSettings, RunEvent, NodeState, foldRun)
- Modify: `src/pipeline.ts` (normalizePipeline, DEFAULT_SETTINGS, preflight)
- Test: `test/handoff.test.ts` (create)

**Interfaces:**
- Produces:
  - `interface Contract { to: string; goal: string; expected?: string; context: string[]; mode: 'read' | 'write'; after: string[] }`
  - `PipelineNode.manager?: boolean`, `PipelineNode.roster?: string[]`, `PipelineNode.spawn?: { parent: string; depth: number; contract: Contract }`
  - `PipelineSettings.maxDepth?: number`, `maxSpawn?: number`, `planApproval?: boolean`
  - `RunEvent` variant `{ type: 'node.spawned'; node: PipelineNode; parent: string; depth: number; after: string[] }`
  - `RunState.spawned: number` (count of `node.spawned` events)

- [ ] **Step 1: Write failing tests** in `test/handoff.test.ts`: (a) `foldRun` over `run.started` + `node.spawned` adds the node to `state.pipeline.nodes`, adds an edge `from → node` for each id in `after`, adds `state.nodes[id]` as `queued`, and sets `state.spawned` to 1; (b) `normalizePipeline` keeps `manager: true`, `roster: ['coder']`, and settings `maxDepth`/`maxSpawn`/`planApproval`, clamping `maxDepth` to 1..5 and `maxSpawn` to 1..30; (c) `preflight` errors when `manager` is set on a gate/approval node, errors on a `roster` entry that is not a known bot id or built-in role, warns when a manager has a `fixNode`.
- [ ] **Step 2: Run** `npx vitest run test/handoff.test.ts` — expect FAIL (properties/event missing).
- [ ] **Step 3: Implement** the types above; add the `node.spawned` case to `foldRun` (append node to `s.pipeline.nodes`, append edges for `after`, add queued `NodeState`, `s.spawned += 1`; `spawned` starts at 0 in the `run.started` case); extend `normalizePipeline` and `preflight` per the tests. Roster validity: `CREW[id]` exists or id is in `STEP_TYPES`.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — expect all PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Spawned steps: node.spawned event, manager/roster/limits fields, validation"`

### Task 2: Plan and review parsing, validation, prompts (`src/handoff.ts`)

**Files:**
- Create: `src/handoff.ts`
- Test: `test/handoff.test.ts`

**Interfaces:**
- Consumes: `Contract`, `PipelineNode`, `Pipeline`, `RunState` from Task 1.
- Produces:
  - `interface PlanTask extends Contract { id: string }`
  - `parsePlan(output: string): { tasks: PlanTask[] } | { error: string }` — takes the first JSON object (use `extractJson` from `src/composer.ts`) of shape `{"tasks":[{id,to,goal,expected?,context?,mode?,after?}]}`; defaults `mode: 'read'`, `context: []`, `after: []`.
  - `validatePlan(tasks: PlanTask[], o: { manager: PipelineNode; state: RunState; roster: string[]; allowWrite: boolean }): string | undefined` — returns a reason or undefined. Rejects: zero tasks, local id not `[A-Za-z0-9_]{1,30}` or duplicate, `to` not in `roster`, empty `goal`, `after` naming an unknown local id or forming a cycle, `context` naming a step id not in `state.pipeline` and not a sibling local id, more tasks than `maxSpawn - state.spawned`, `mode: 'write'` while `allowWrite` is false.
  - `toNode(t: PlanTask, manager: PipelineNode, depth: number, agent?: string): PipelineNode` — id `${manager.id}-${t.id}`, kind `agent`, role `t.to`, `readOnly: t.mode === 'read'`, `spawn: {parent: manager.id, depth, contract: t}`, `after`/`context` local ids rewritten to full ids.
  - `planPrompt(state, manager, roster, rejection?)`, `reviewPrompt(state, manager, children, round)` — strings.
  - `parseReview(output: string): { accept: true } | { redo: { id: string; reason: string }[] } | { more: PlanTask[] } | { error: string }` — JSON `{"decision":"accept"}`, `{"redo":[{"id","reason"}]}` or `{"more":[tasks]}`.

- [ ] **Step 1: Write failing tests** covering: parsePlan accepts JSON wrapped in prose and code fences, defaults fields, and returns `{error}` for non-JSON and for `tasks` not an array; validatePlan returns a distinct reason for each rejection listed above (assert on a substring such as `unknown bot`, `cycle`, `spawn budget`, `write`); toNode rewrites `after: ['a']` to `['lead-a']` and sets `readOnly`; parseReview parses all three decisions and errors on `{}`.
- [ ] **Step 2: Run** `npx vitest run test/handoff.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `src/handoff.ts`. The plan prompt lists the task, the roster (id, title, one-line blurb from `CREW` / `STEP_BLURB`), the limits, the exact JSON shape, and, when given, the rejection reason. The review prompt lists each child with its `expected`, status and clipped output (clip long outputs to 4000 chars) or error.
- [ ] **Step 4: Run** `npx vitest run test/handoff.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `git commit -am "handoff: parse, validate and prompt for manager plans and reviews"`

### Task 3: Prompts for spawned steps; scripted mock replies

**Files:**
- Modify: `src/prompt.ts` (buildPrompt)
- Modify: `src/types.ts` (MockScript), `src/adapters/mock.ts`
- Test: `test/handoff.test.ts`

**Interfaces:**
- Produces: `MockScript.replies?: Record<string, string[]>` — for a request whose `nodeId` ends in `.<phase>` (e.g. `lead.plan`, `lead.review`) the mock returns `replies[phase][min(attempt-1, len-1)]` as output.
- `buildPrompt` for a node with `spawn` adds a `# Your assignment` section (goal, expected output, who handed it to you) and builds `# Upstream output` only from `spawn.contract.context` ids (instead of all ancestors).

- [ ] **Step 1: Write failing tests:** (a) `buildPrompt` for a spawned node contains `# Your assignment`, the goal and expected text, includes output of a step listed in `context`, and omits output of an unrelated finished ancestor; (b) MockAdapter with `mock.replies = {plan: ['A','B']}` returns `A` for `nodeId: 'x.plan'` attempt 1 and `B` for attempt 2 and 3.
- [ ] **Step 2: Run** the file — expect FAIL.
- [ ] **Step 3: Implement** both changes.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — expect all PASS.
- [ ] **Step 5: Commit** `git commit -am "Spawned steps get an assignment prompt; mock adapter can script rounds"`

### Task 4: Extract the scheduler frontier (no behaviour change)

**Files:**
- Modify: `src/engine.ts` (`execute`)
- Test: existing suite (`test/engine.test.ts` and the rest)

**Interfaces:**
- Produces: `private async stepFrontier(runId: string, signal: AbortSignal, only?: Set<string>): Promise<'progress' | 'idle' | 'stopped'>` — one pass of what the `for(;;)` body in `execute` does after the budget/wall-clock checks: skip-propagation, find ready nodes (restricted to `only` when given), request approvals, run concurrent read-only nodes with `pool`, run serial nodes. Returns `'idle'` when nothing was ready, `'stopped'` when aborted.

- [ ] **Step 1: Baseline:** run `npx vitest run` — all PASS (155).
- [ ] **Step 2: Refactor:** move the body into `stepFrontier`; `execute` loops `for(;;){ checks; const r = await this.stepFrontier(runId, signal); if (r==='stopped') return this.finish(runId,'stopped'); if (r==='idle') break; }`. Keep budget and wall-clock checks in `execute`.
- [ ] **Step 3: Run** `npm run typecheck && npx vitest run` — expect the same 155 PASS.
- [ ] **Step 4: Commit** `git commit -am "engine: extract stepFrontier from execute"`

### Task 5: Manager rounds in the engine

**Files:**
- Modify: `src/engine.ts` (`runNode`, new `runManager`, `askManager`)
- Test: `test/handoff.test.ts` (engine tests with `setup()`, `makeRepo()`, `pipe()`)

**Interfaces:**
- Consumes: `parsePlan`, `validatePlan`, `toNode`, `planPrompt`, `reviewPrompt`, `parseReview` (Task 2); `stepFrontier` (Task 4); `MockScript.replies` (Task 3).
- Produces: `private async runManager(runId: string, node: PipelineNode, signal: AbortSignal): Promise<NodeOutcome>`; `runNode` dispatches to it when `node.manager`.
- Behaviour:
  1. `askManager(runId, node, phase: 'plan'|'review', round, prompt, signal)` calls the node's adapter like `consultStep` does (read-only, `nodeId: \`${node.id}.${phase}\``, `attempt: round`, `mock: node.mock`, cost counted via a `node.finished`-style cost add — reuse the same cost-recording approach as `consultStep`).
  2. If `state.pipeline` already has nodes with `spawn.parent === node.id` (resume), skip planning.
  3. Else plan: up to 2 rounds; on `parsePlan` error or `validatePlan` reason, re-ask with the reason; still invalid → `node.finished` status `error`, error `manager plan rejected: <reason>`.
  4. Append `node.spawned` per task (depth = parent depth + 1, refused if > `maxDepth`; defaults `maxDepth` 3, `maxSpawn` 12). If `planApproval` (default: any `write` task) append a spawned approval step `<id>-approve`, add it to every spawned step's `after`, and return `{ok:true}` without finishing the manager once the approval is awaiting, so the run pauses; on resume the approved plan proceeds.
  5. Work: loop `stepFrontier(runId, signal, only = spawned ids)` until `idle`/`stopped`; if any spawned approval is awaiting, leave the manager unfinished and return (run pauses).
  6. Review (max 3 rounds): `askManager('review')`; `accept` → finish; `redo` → per step at most 2 redos (count in memory plus `loop` events), append `node.amended` with the reason as guidance, re-run via `runAgentOnce`, then review again; `more` → validate and spawn (counts toward `maxSpawn`), work, review again; errors in the review reply → one retry, then treat as accept with the note.
  7. Finish: `node.finished` with output = the manager's final review text (or a built summary), status `done`. A failed spawned step is shown to the manager in review, not propagated as a run failure; if the manager accepts anyway the run still ends `error` only if a spawned step is `error` and unreviewed-away (keep it simple: after `accept`, any spawned step still `error` makes the manager step `error`).

- [ ] **Step 1: Write failing engine tests** (manager node `lead` read-only, mock replies via `mock.replies`):
  - *plan runs and is accepted:* plan spawns `a` (coder, write allowed via `planApproval: false` setting) and `b` (reviewer, `after:['a']`); review `{"decision":"accept"}`; assert run `done`, nodes `lead-a`, `lead-b` exist with `spawn.parent === 'lead'`, `lead-b` ran after `lead-a`, `state.spawned === 2`.
  - *invalid plan retried:* first plan reply is prose, second valid; run `done`; mock saw two `lead.plan` calls, the second prompt contains the rejection reason.
  - *unknown bot rejected twice:* run ends `error` with `manager plan rejected` and `state.spawned === 0`.
  - *redo:* review 1 `{"redo":[{"id":"a","reason":"missing tests"}]}`, review 2 accept; `lead-a` attempts is 2 and its second prompt contains `missing tests`.
  - *redo cap:* three consecutive redo replies for `a`: only 2 redos happen, the third is ignored and manager step fails or accepts per rule 7; assert `lead-a` attempts ≤ 3.
  - *spawn cap:* `maxSpawn: 1` and a 2-task plan → rejected with `spawn budget`.
  - *depth cap:* `maxDepth: 0` → rejected.
  - *approval pause and resume:* write task with default `planApproval` → run status `paused`, `lead-approve` awaiting, no `lead-a` started; after `engine.approve(id,'lead-approve',true)` and `engine.resume(id)` the run finishes `done` and the plan was asked only once.
  - *failed child goes to review:* child `a` mock `failFirst: 9`; review prompt contains its error; reply `accept`; the manager step ends `error`.
  - *budget:* `maxCostUsd: 0.01` with child costing 0.02 → run `error` containing `budget exhausted`, queued spawned steps `skipped`.
  - *stop mid-work:* `engine.stop(id)` while a child runs → status `stopped`; `resume` then reuses the existing children (no second `node.spawned` batch).
- [ ] **Step 2: Run** `npx vitest run test/handoff.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `runManager`/`askManager` per the behaviour list above. Do not duplicate scheduling logic: call `stepFrontier`.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — expect all PASS.
- [ ] **Step 5: Commit** `git commit -am "engine: manager steps plan, spawn, review and redo handoffs within limits"`

### Task 6: Authoring, the `team` workflow, run-view display, docs

**Files:**
- Modify: `src/composer.ts` (`StepType`, `STEP_TYPES`, `STEP_BLURB`, `makeBuiltinStep`, `TEMPLATES`, `Template`)
- Modify: `src/ui.ts` (`nodeLabel` and the node row renderer around line 404), `src/tui.ts` run view (spawned steps listed under the manager, prefixed `↳`, with the receiving bot's name)
- Modify: `src/cli.ts` (`aorch show` prints spawned steps under their manager)
- Modify: `README.md`
- Test: `test/handoff.test.ts`, `test/crew.test.ts` if step lists are asserted

**Interfaces:**
- Produces: step type `manager` (`makeStep('manager', p)` → `{kind:'agent', role:'manager', readOnly:true, manager:true}`); template `team` = `['manager','tester','reviewer','approval']` with label `team · a manager hands out the work → tests → review → approve`; `fromTemplate('team', …)` works without a detected test command (tester omitted as for other templates).

- [ ] **Step 1: Write failing tests:** `makeStep('manager', p)` has `manager: true` and `readOnly: true`; `stepChoices()` includes `manager`; `fromTemplate('team','t','mock')` yields nodes `manager, review, approve` (no test command) and the manager has no `fixNode`; the run-view/`show` line for a spawned node starts with `↳` and contains its bot name (test the pure formatter you add in `ui.ts`, e.g. `spawnedLabel(n: PipelineNode): string`).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the composer additions, `spawnedLabel`, and wire it into the TUI run view node list and `aorch show`. Add `manager` default role prompt to `DEFAULT_ROLE_PROMPTS` in `src/prompt.ts`: it coordinates, never edits files, answers only in the JSON the engine asks for.
- [ ] **Step 4: README:** a "Teams: a manager hands out work" section: the `team` workflow, contract fields, limits and settings (`maxDepth`, `maxSpawn`, `planApproval`), that write plans pause for approval, and that worker-to-worker `@HAND` is the next stage.
- [ ] **Step 5: Run** `npm run typecheck && npx vitest run` — expect all PASS; then `npm run build`.
- [ ] **Step 6: Smoke test** with the mock adapter via a pty/pyte run of `node dist/cli.js tui` (as in earlier TUI checks) and a headless `aorch run` of a `team` pipeline with scripted `replies`; confirm the run view shows `↳` steps.
- [ ] **Step 7: Commit** `git commit -am "Manager step type, team workflow, spawned steps in the run view, docs"`
