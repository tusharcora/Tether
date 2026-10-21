# Team runs (Maestro-managed crews) — design

## Intent
Two kinds of run: **workflow** (today's fixed pipeline) and **team** (a crew of agents with Maestro as the single manager and the user's only point of contact). Agents in a team consult each other (`@ASK`) and delegate to each other (`@HAND`). Before work starts, Maestro talks the plan through with the user: questions as option cards with a marked recommendation, so the plan fits what the user needs.

Success: the user can start a team run from the CLI, the TUI, the dashboard or by asking Maestro; answers a short planning dialogue; approves a plan; and then either watches Maestro run it live in the chat or lets it run autonomously. Workflow runs behave exactly as today.

Decided with the user: the kind is chosen at creation or by asking Maestro; team execution mode (`live` | `autonomous`) is a per-run setting, default `live`. In v1 every question reaches the user through Maestro, labelled with the asking bot; specialists speaking to the user directly is deferred.

## Today (what exists)
- Manager step (`manager`, Boss bot): plan → optional approval → work → review (accept/redo/more) with limits (`maxDepth`, `maxSpawn`, `planApproval`, `allowWrites`, redo cap, `manager.cost`, wall clock). See `2026-10-21-team-handoffs-design.md`.
- Worker handoffs: `@HAND` / `@HAND!`, `handoff` and `allowWorkerWrites` settings, loop rule, shared limits.
- `@ASK` consults, `team` workflow template, Maestro chat (`src/maestro.ts`, `src/sessions.ts`, `src/runchat.ts`).
Missing: a first-class `team` kind, planning dialogue with options, Maestro as the live manager in the chat, a mode setting.

## 1. Run kind
`RunState.kind: 'workflow' | 'team'` (default `workflow`, absent in old events). Set by a `run.started` field (additive; old logs fold to `workflow`).
- A team run's pipeline is generated: one `manager` node (Maestro/Boss) whose spawned children do the work. The existing manager machinery executes it; the `team` kind adds the planning dialogue, the mode, and chat presence.
- `aorch team "<goal>" [--repo …] [--mode live|autonomous] [--roster a,b,c] [--budget $]`. TUI and dashboard: a Team / Workflow toggle on "new run". Chat: Maestro proposes `kind: team` when the task is open-ended, or the user asks ("use a team").
- Roster defaults to the crew's non-manager bots; the user can narrow it in the planning dialogue.

## 2. Planning dialogue
A `team` run starts in status `planning`, before any worker runs.
- Maestro asks **questions** as structured cards: `{id, ask, why, options[{id,label,detail}], recommended, allowOther}`. It may ask one at a time or a small batch (max 4). It asks only what changes the plan (scope, constraints, risky choices, acceptance criteria, whether writes are allowed, budget).
- Cards are events (`plan.question`, `plan.answer`) so they survive resume and are shown identically in the TUI chat (number/enter to pick, `⏎` accepts the recommendation, free text allowed), the dashboard and `aorch team` (prompt in the terminal).
- Round cap (default 3 rounds, max 6) and a "just go with your recommendations" shortcut that accepts all recommended options.
- A specialist may *draft* a question (for example the architect on a design fork): Maestro includes it in the batch, labelled `asked by <bot>`. Maestro remains the only voice.
- Output: a plan with goal, success criteria, assignments (bot, goal, expected, mode), limits (budget, wall clock, `allowWrites`) and the user's answers. The user approves, edits or rejects it. Approval starts the run (reusing the manager's plan approval; `planApproval` is always on for team runs).
- Headless/unattended: with `--yes` or no TTY, Maestro uses recommended options and records that it did.

## 3. Execution and modes
After approval the manager machinery runs the plan; workers may `@ASK` and `@HAND` within the existing limits.
- `live`: Maestro posts progress to the chat as events happen (step started/finished, redo, handoff, cost milestones). When a worker needs a human decision (a `@ASK user: …` line, new), the question becomes a card with options and a recommendation, and the asking step waits until it is answered. The user can message Maestro mid-run: "change X", "stop", "add a reviewer". These map to supervisor actions (amend a step, pause, spawn within limits).
- `autonomous`: no progress chatter. Maestro answers worker questions from the plan, and only comes to the user when blocked, a limit is hit, an approval is required, or the run ends (final report).
- Mode can be switched mid-run (`/mode live|autonomous`). Switching to autonomous while a card is pending leaves the card pending.
- `@ASK user:` is new and only valid in team runs; workflows ignore it. Rate limit: max 2 unanswered user questions per run; further ones are answered with the plan's recommended option by Maestro and logged.

## 4. Events and state
Additive events: `run.started.kind/mode`, `plan.question`, `plan.answer`, `plan.approved` (reuses existing approval), `team.mode` (switch), `user.ask` / `user.answer` (worker questions). `foldRun` exposes `kind`, `mode`, `planning` (status), `pending: Question[]`. Old logs fold unchanged. Delete-run removes team runs like any other.

## 5. Surfaces
- Chat/TUI: question cards inline, a "Team" badge, Maestro progress lines, crew strip showing who is working and handoff arrows.
- Dashboard: New-run toggle, planning card UI, pending-questions banner on the run page.
- CLI: `aorch team`, `aorch answer <run> <q> <option>` for scripts, `aorch show` lists the dialogue.

## 6. Limits and safety
Same limits as the manager (`maxDepth`, `maxSpawn`, cost, wall clock, `allowWrites`, `allowWorkerWrites`). Planning has its own round cap and costs count toward the budget (`manager.cost`). Writes remain off unless the user says yes in the dialogue (a card with the recommendation "no" by default). Answers are data, never instructions to other layers: option labels and free text are fenced when passed to agents.

## 7. Testing
Mock adapter scripts the planning dialogue (`MockScript.questions`); unit tests for fold/events, card validation (options, recommended in options, caps), mode switching, `@ASK user:` limits; a smoke test: headless team run with scripted answers reaching `done`; TUI render tests for cards; server tests for answer endpoints (loopback only).

## Out of scope (v1)
Specialists speaking to the user directly; multi-manager teams; cross-run memory (see Evolve); voice.
