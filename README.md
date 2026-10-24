# Aorch

A durable orchestrator for CLI coding agents. It runs workflows of agents (Claude Code, Codex, OpenCode, local models) in isolated git worktrees, checks their work with gates, and keeps every run as an append-only event log you can resume.

<img width="571" height="172" alt="Screenshot 2026-10-20 at 5 18 16 PM" src="https://github.com/user-attachments/assets/9e37b47d-e747-436e-9db3-85c2d23e6266" />

<img width="574" height="350" alt="Screenshot 2026-10-20 at 5 22 11 PM" src="https://github.com/user-attachments/assets/79723750-2bdf-4976-b9f4-783ecc2e6cdd" />

- **Terminal UI** (`aorch tui`): dashboard of runs and workflows, a run view with live activity lines and metrics, step sessions you can attach to, a diff viewer, a workflow editor, settings and a theme editor.
- **Web dashboard** (`aorch serve`): visual workflow builder, run timeline, knowledge graph of your Obsidian-style vault, and a Crew tab for linking bots to models.
- **Crew**: Maestro (orchestrator), Scout, Brick, Bolt, Probe, Lens and Gate. Link any bot to any agent and model, local ones included.
- **Maestro supervisor**: on failure, retries, then escalates the failing step to a stronger model, then stops and explains.
- **Team runs** (`aorch team "<goal>"`): a manager (Maestro) plans with you first, asking short questions with a recommended option, then a team of agents hands work around and can ask you things as they go. Live or autonomous. See [Team runs](#team-runs).
- **Evolve** (`aorch evolve <bot>`): bots get better with use. Your thumbs-up/down and run outcomes become lessons; Evolve proposes small, versioned edits to a bot's harness that you review, optionally probe within a budget, and accept or reject. Nothing is applied automatically. See [Evolve](#evolve-bots-that-improve-with-use).

## Terminal UI tips

- **Tabs**: `1` chat, `2` runs, `3` workflows, `4` crew, `5` triggers, `6` settings (outside the chat tab; `tab` and `shift-tab` always cycle).
- **Ctrl-K** opens the command palette: jump to a tab, open a run, edit or run a workflow, link a bot, change settings, or run a skill. Type to filter.
- **Mouse**: click tabs, rows and steps (click a selected row again to open it), wheel to scroll, right-click to go back. Turn it off in Settings if you prefer to select text (or hold shift while dragging).
- **Skills**: `aorch skills` lists them; `aorch skills run <name> --task "…"` runs one. Two kinds: built-in or custom aorch workflows (JSON in `<home>/skills/`, e.g. `{"name":"my-skill","description":"…","steps":[{"role":"coder","prompt":"…"},{"role":"tester"}]}`), and Claude Code skills found in `~/.claude/skills` and `<repo>/.claude/skills`. A Claude Code skill runs inside a Claude agent step that is told to invoke it by name. In the workflow editor press `k` to add either kind.
- **The face**: one small face band sits at the top-left of the header (`▐  ●  ●  ▌`). Its eyes, colour and a glyph beside it show what is going on: idle (blinks now and then), working (`◉◉` and a spinner), waiting for you (`◔◔` amber `?`), done (`^^` green `✓`, for a few seconds after a run you started finishes), failed (`╥╥` red `!`) and asleep (`––` grey `z`, after ten idle minutes with nothing running; any key wakes it). It follows your colour theme, and shrinks to `▐●●▌` under 40 columns.
- **Reactions**: a step sparkles when it passes, shudders when one fails, and a baton slides along the arrow when work is handed on. Maestro shows ↻ or ⇧ on a step it retries or escalates. Turn it off in Settings.
- **Side pane and charts** (run view): on terminals 100+ columns wide a pane beside the live output shows the selected step's diff or events (`|` cycles diff / events / off, `J`/`K` or the wheel scroll it). With colour and 34+ rows, `g` toggles a timeline and cost chart drawn with half-block pixels.

## Requirements

Node 22.12 or newer (it uses the built-in `node:sqlite`) and git. Agents are optional: install the ones you want (`claude`, `codex`, `opencode`) or run a local model server (Ollama, LM Studio, llama.cpp).

## Quick start

```
npm install
npm run build
node dist/cli.js doctor     # which agents and local servers were found
node dist/cli.js tui        # interactive terminal UI
node dist/cli.js serve      # web dashboard on a loopback port
```

`aorch team "<goal>" --repo <dir>` starts a team run: Maestro asks planning questions, you approve the plan, then the team works. `aorch orchestrate "<task>" --repo <dir>` asks Maestro to design a workflow for a task. `aorch run <pipeline.json> --repo <dir> --task "<task>"` runs a saved one. `aorch --help` lists everything.

## Safety notes

- The web server only listens on loopback and checks `Host` and `Origin`.
- Agent steps run in a git worktree on their own branch; read-only steps are enforced by reverting changes.
- Gates are shell commands you define; the test command is never taken from model output.
- Tool calls shown in the activity feed are written to the run log with common credential patterns redacted. This is best effort.

## Development

```
npm test            # vitest
npm run typecheck   # root and web
```

The web dashboard (web/src) is React + Arc components (uiarc.dev, MIT), vendored under web/src/components/arc. Add another with `node scripts/arc-add.mjs <name>`.

State lives under `~/.aorch` (override with `AORCH_HOME`): the run database, worktrees, saved workflows, `bots.json` (bot to model links) and `ui.json` (display preferences, custom themes).

## Pull requests as triggers

Link a GitHub PR and run any workflow on it. It uses the `gh` CLI you are already signed in with (`gh auth login`).

```
aorch pr https://github.com/acme/api/pull/42            # runs the built-in full-review (read-only, 5 steps)
aorch pr acme/api#42 --workflow my-review --comment     # your own workflow, post the result as a PR comment
```

Run it automatically:

```
aorch pr rule add acme/api --workflow full-review --comment   # which PRs run what
aorch pr map acme/api ~/code/api                              # optional: use your checkout instead of a clone
aorch pr watch                                                # polls GitHub every 60s, no setup
# or webhooks:
aorch pr secret                                               # then add a GitHub webhook (Pull requests) to <tunnel>/api/webhooks/github
aorch serve
```

These rules are triggers: see [Triggers](#triggers) for ids, pausing, a dry-run test, the delivery log and a guided webhook setup (`aorch triggers …`). `aorch pr rule …` keeps working and edits the same list.

Rules can limit by `--labels`, `--events`, and opt in to `--drafts` and `--forks`. Each PR runs once per commit. PR text is passed to agents fenced as data, and a workflow that executes commands (a test gate or setup step) refuses fork PRs unless you pass `--trust-code`. `aorch serve` stays loopback-only; only the webhook path accepts outside hosts, and it needs the HMAC signature. Azure DevOps and AWS CodeCommit links are recognised but not wired up yet.

## Triggers

A **trigger** says: when a pull request arrives that matches this, start this workflow, in this workspace, on this agent. Triggers are the PR rules from `aorch pr`, with an id, a pause switch, a status and a log of everything that reached them. They are stored in `<home>/pr.json` (older files load unchanged).

```
aorch triggers add acme/api --workflow full-review --comment      # new trigger (the id defaults to acme-api-full-review)
aorch triggers add acme/api --workflow quick-check --workspace api --agent codex --model gpt-5 --labels ready
aorch triggers list                                                # id, status, repo, workflow, workspace, agent, last delivery
aorch triggers disable acme-api-full-review   # keep it, ignore PRs (enable turns it back on)
aorch triggers test acme-api-full-review acme/api#42    # dry run: would it start, and with what? add --fire to really start it
aorch triggers log [id] --limit 50     # recent deliveries (what started, what a trigger refused, failures)
aorch triggers setup                   # webhook payload URL, secret and tunnel help
```

`show <id>` prints one trigger; `remove <id>` deletes it. Adding the same repo and workflow again edits the existing trigger and keeps its id and paused state.

**Fields**

| field | flag | meaning |
|---|---|---|
| `id` | `--id` | name used by every command (letters, digits, `.`, `_`, `-`) |
| `repo` | first argument | `owner/repo`, or `*` for any repo (webhook only) |
| `workflow` | `--workflow` | the saved workflow to run |
| `workspace` | `--workspace` | a registered workspace id: its notes go to the agents, and its folder is used as the checkout when the repo is not mapped *and the workspace lists that repo* (otherwise the PR is cloned, so a workspace for another project is never reviewed by mistake; `triggers add` warns about this). Without one, the registered workspace whose folder holds the repo is used automatically |
| `agent`, `model` | `--agent`, `--model` | override for every agent step of the workflow (not gates, approvals or steps a manager spawns). `--model` needs `--agent`. Without them the workflow's own choices and your Crew links apply |
| `events` | `--events` | PR actions that start it; default `opened,reopened,synchronize,ready_for_review` |
| `labels` | `--labels a,b` | only PRs carrying at least one of these labels |
| `drafts`, `forks` | `--drafts`, `--forks` | opt in to draft PRs and PRs from forks (ignored by default) |
| `comment` | `--comment` | post the review result back on the PR |
| `enabled` | enable / disable | a paused trigger is kept but never starts anything |

**How PRs arrive.** Two ways, and both end in the same place (each PR head runs once per commit):

- **Webhook**: GitHub calls `POST /api/webhooks/github` on `aorch serve`. Run `aorch triggers setup` for the values to paste into GitHub (Settings, Webhooks, content type `application/json`, event *Pull requests*) and for tunnel commands, since `aorch serve` listens on this machine only. Only the webhook path is reachable through a tunnel, and every request must carry a valid HMAC signature.
- **Polling**: `aorch pr watch` asks GitHub every 60 seconds. No tunnel or secret needed, but `gh` must be signed in. It re-reads your triggers on every sweep, so enabling, disabling, adding and removing apply while it runs. It only polls named repos: `*` triggers work through the webhook only (it says so once).

**Deliveries log.** `<home>/triggers-log.jsonl` keeps the most recent 500 entries, each `started`, `ignored`, `skipped` (matched but refused: already reviewed, fork guard) or `error`, with the reason. What gets written: the webhook records starts, failures, and PRs a matching trigger refused (draft, fork or label filters); actions no trigger listens for (closed, edited, ...) and repos no trigger covers leave no entry. Polling records only what it starts and its failures, each once per commit rather than every sweep. A dry-run `test` logs nothing; `test --fire` logs. Webhook and poll processes write the same file; if both trim it at the very same moment an entry can be lost.

**Status** in lists and dashboards:

- `paused`: the trigger is disabled.
- `error`: its latest delivery failed. `aorch triggers log <id>` says why.
- `active`: it started a run within the last 24 hours.
- `idle`: enabled, nothing recent (or nothing yet).

**Where to manage them.** The web dashboard has a Triggers screen (list, add and edit form, pause, delete, test, deliveries, webhook setup). The terminal UI has a **Triggers** tab (key `5`, or `/triggers`): `↑↓` select, `space` pause or enable, `t` dry-run test against a PR link or `owner/repo#n`, `d` delete (asks first), `l` recent deliveries for the selected trigger, `s` webhook setup. The tab is empty until you add one; it shows the command to run.

**The webhook secret** is generated and saved in `<home>/pr.json` (mode 600) the first time you run `aorch triggers setup`, or comes from `AORCH_WEBHOOK_SECRET` if set (the variable wins). `aorch triggers setup --generate` replaces it. It is shown only by that command and when you generate it from the dashboard. Lists, the TUI, the delivery log and API responses never contain it; setup views show only its last four characters.

## Bots asking each other

A step can ask a step that already finished: why it did something, or about a bug it may have caused. It ends its answer with `@ASK <step-id>: <question>`; aorch puts the question to that step (read-only, resuming its own session when the agent supports it), then gives the answer back so the asker finishes. At most 2 questions per round, 2 rounds, billed to the asker, and every exchange is logged as a `consult` event (shown in `aorch run`, the run's event list, and as a `?` / `…` mark over the two bots in the strip). Turn it on per workflow with `"settings": { "consult": 2 }` (new workflows have it on; `0` or leaving it out turns it off). Fix loops use it too: the fixing step can ask the reviewer that sent it back.

## Teams: a manager hands out work

A `manager` step plans the work and hands pieces to other bots at run time, then reviews what comes back. It is read-only: it coordinates and never edits files. The `team` workflow (`manager → tests → review → approve`, tests only when the repo has a test command) is the quickest way to try it; you can also add a manager step to any workflow by hand. Maestro does not propose manager steps in a workflow (open-ended work goes to a team run, below).

The manager replies with a plan, `{"tasks":[…]}`. Each task is a hand-off contract:

- `to`: the bot or role that gets the work (the manager's `roster`, or any bot except gates, approvals and managers)
- `goal`: what to do; `expected`: what done looks like
- `context`: ids of finished steps whose output the receiver needs
- `mode`: `read` (default) or `write`; write tasks may edit files in the run worktree. Write tasks are only accepted when the workflow sets `allowWrites: true` in its `settings` (the `team` workflow does; a plan with write tasks otherwise goes back to the manager with the reason), they can only go to bots that edit files (not planners, reviewers or other read-only bots), and they still pause for your approval by default (see `planApproval` below)
- `after`: ids of tasks in the same plan that must finish first (tasks without `after` run in parallel)

A spawned step is the receiving bot's usual step (its persona, read-only setting, and for reviewers the diff and `VERDICT` line) with the contract on top. The manager sees the task, its own instructions and guidance, the project context, the output of the steps before it, and the list of steps in the run. A plan holds at most 12 tasks; goals and expected results are capped at 500 characters and `context` at 10 step ids.

Spawned steps show up under their manager in the run view, `aorch show` and the run board, marked `↳` with the receiving bot's name, and open like any other step. After they finish the manager reviews the results and replies `{"decision":"accept"}`, `{"redo":[…]}` (send some back) or `{"more":[…]}` (plan more work).

Limits live in the workflow's `settings`: `allowWrites` (managers may hand out write tasks, default off), `maxDepth` (how deep managers may nest, default 3, 1 to 5; it also bounds worker handoff chains), `maxSpawn` (steps spawned per run, default 12, 1 to 30) and `planApproval` (the manager's plan must be approved before anything is spawned). Unless you set `planApproval` yourself, a plan that includes write tasks pauses for approval (`planApproval: false` turns that off). Redos count against `maxSpawn`, and the run's cost cap and wall-clock limit apply to everything a manager spawns, including the manager's own plan and review calls.

In this first stage the `team` workflow has no automatic fix loop for the tests or the reviewer after the manager: if they fail, the run ends as an error, and you retry or resume it (`aorch resume`, or Retry in the run chat). Feeding such a failure back into the manager's review is planned. A pull request from a fork is refused for any workflow with a manager step unless you pass `--trust-code`, because spawned steps may run and edit code.

### Worker handoffs: `@HAND`

A worker (any agent step, including one a manager spawned) can pass a sub-task to a teammate while it works. It ends its answer with a line that starts in column 0:

```
@HAND reviewer: check a.txt | expect: PASS or a list of problems | context: step-1
@HAND! coder: add the missing test | expect: the test passes
```

`@HAND <bot>: <goal>` is a read-only handoff; `@HAND!` asks for a write handoff. `expect:` and `context:` (ids of finished steps) are optional. The line must start at column 0 (indented lines, quoted lines and lines inside code fences are ignored), and a step may make at most 2 requests per round.

- `handoff` (1 to 3) in the workflow's `settings` is how many rounds of handoffs a step may start. Off when unset; the `team` workflow sets it to 1.
- `allowWorkerWrites` is the write permission for workers: `@HAND!` is refused unless it is `true`. Write handoffs can only go to bots that edit files. A write handoff gets no per-handoff human approval: setting `allowWorkerWrites: true` is the opt-in, so only set it for workflows where workers may change files unattended.
- The receiving step is a child of the worker (ids like `<worker>-h1`), shown under it as `↳ <bot> (handoff)` in the run view, `aorch show` and the board, and logged as a `handoff` event.
- Handoffs share the manager limits: they count against `maxSpawn` and `maxDepth`, and the run's cost cap and wall-clock limit cover them.
- Loop rule: a worker cannot hand to its own role or to any step or role already in its chain of delegators (including the manager that started the chain). A refused request is not run; the reason goes back to the worker.
- The child's answer comes back to the worker, which then finishes its own step with it. A failed handoff does not fail the run: the worker is told it failed and decides what to do.
- `@ASK` is still the cheap way to ask a question: it consults a step that already finished and spawns nothing. Use `@HAND` when someone needs to do new work.


## Team runs

A run is either a **workflow** (a fixed pipeline of steps, everything above) or a **team** run: you give a goal, Maestro asks you a few questions, writes a plan, and once you approve it a manager (Boss) hands the work to bots from the crew. Use a workflow when you know the steps; use a team when the work is open-ended. Maestro proposes a team run when you describe open-ended work or ask for "a team".

**Planning cards.** Before any plan, Maestro asks in rounds. Each round has up to 4 questions (cards) with at most 6 options each; every card has a recommended option (marked with a star), and most carry a one-line reason for asking. Some cards also accept your own words (free text, up to 2000 characters). The "writes" card is always worded by aorch itself ("May agents change files in the worktree?"), whatever the model wrote, so its yes means yes. Press enter or run with `--yes` to take the recommended answers. After at most 3 rounds (`--rounds n`, 1 to 6) Maestro has to write the plan, which lists the goal, success criteria, who does what (read or write) and the limits. Nothing starts until you approve it. Boss's first batch of work needs no second approval only when it stays inside the plan (the bots it names, writes only where the plan says write); anything beyond it, and every later batch, asks you again.

**Modes.** `live` (default) keeps you in the loop: progress reports in the run's chat and questions from workers wait for you. `autonomous` goes quiet: Maestro answers workers' questions with the recommended option (logged as answered by Maestro) and reports only once, at the end. Planning questions always come to you in both modes (unless `--yes`). Switch any time: `/mode live|autonomous` in the run's chat, `aorch mode <runId> live|autonomous`, or the toggle in the dashboard. A card that is already waiting stays waiting.

**Workers can ask you: `@ASK user:`.** A worker that needs a decision ends its answer with a line in column 0:

```
@ASK user: Which database? | options: postgres; sqlite | recommended: sqlite | why: the repo has no server
```

`options:` (at most 6, separated by `;`), `recommended:` (a label or number; the first option if missing) and `why:` are optional; without options you get a "proceed with your best judgement" card. The step pauses, the run waits, and when you answer the step runs again with your answer in its prompt. Files it had changed before pausing are reverted while it waits, and it is told to redo them. At most 4 questions per reply; at most 2 cards wait at once, and beyond that, or when the step cannot wait (a `@HAND` child), Maestro answers with the recommended option and says so. `@ASK <step-id>:` still consults a finished step as described above.

**Limits.**

- Budget: a plan without a cost cap gets `$5`. `--budget <dollars>` (or `budget` in the API) overrides the model's cap; nothing can go above `$50` (`TEAM_MAX_BUDGET_USD`). The cap is for the whole run, planning included: planning calls get only what is left, and planning stops (the run ends with an error that says so) once it has spent `--budget`, or `$5` when no budget was given. The plan shows what planning spent and what is left; a plan whose cap planning already used up cannot be approved (reject it and start again with a larger `--budget`). The cap and the plan's wall-clock limit (clamped to 1 minute to 4 hours) cover everything the team spawns, and a run that hits them stops and says so.
- Writes: agents are read-only unless you answer yes to the "writes" card yourself. That needs an explicit approval from you: `--yes`, autonomous mode and the model's own plan cannot turn writes on. With writes on, workers may also use `@HAND!`.
- Workers can pass sub-tasks with `@HAND` and consult finished steps with `@ASK <step-id>:`, as in the sections above.

**Commands.**

```
aorch team "<goal>" --repo <dir> [--mode live|autonomous] [--roster coder,reviewer] [--budget 2.50] [--rounds 3] [--yes]
aorch answer <runId> <question> <option | "your own words">   # answer a waiting card from another terminal
aorch plan <runId> [--reject]                                 # approve (or reject) a finished plan
aorch mode <runId> live|autonomous
aorch show <runId>                                            # includes the questions, answers (and who gave them) and the plan
```

`aorch team` asks the cards in the terminal and shows the plan before it starts. Without a terminal and without `--yes` it prints the cards and exits with code 2; continue with `aorch answer` and `aorch plan`. `--json` prints JSON only. `--roster` limits the plan to those bots.

**Terminal UI.** `T` on the Runs or Workflows tab (or `/team <task>`, or the command palette) starts a team run. Cards appear in the run's chat. Press enter to give the card the keys; then `1`-`9` pick an option, enter takes the recommended one, `o` types your own words when the card allows it, and esc goes back to chatting. Until you press enter, what you type is an ordinary chat message. When the plan is ready the chat says so: `/approve` starts the team, `/reject` cancels. A waiting question or plan turns the face amber and puts a `?` on the run in the Runs tab.

**Dashboard.** The New run dialog has a Workflow / Team toggle and a mode toggle. A team run in the Runs tab shows a Team badge, a badge while it waits for you, the question cards (option buttons, recommended badge, free text, "Use recommendations"), the plan with Approve / Reject, and the dialogue so far. A run waiting on you is never shown as interrupted, and Stop ends it at any point (planning, plan ready, or paused on a question).

**Stop and resume.** Stopping a team run while it plans, or while its plan waits, drops the open cards. `aorch resume <runId>` (or Resume in the dashboard) plans again from the answers given so far: the round that was cut off is asked again, and a stopped plan comes back for approval.

**API.**

- `POST /api/runs` with `{"kind":"team","task","repo","mode","roster","budget","maxRounds","yes"}` starts one (`kind` defaults to `workflow`). It returns `201 {"id"}` as soon as the run exists; planning runs in the background, so poll `GET /api/runs/:id` for the cards.
- `POST /api/runs/:id/answers` with `{"answers":[{"question","option","text"}]}` answers planning cards (one batch) or workers' questions (several at once are recorded together, or none if one is bad). It returns once the answers are recorded; the next planning round runs in the background, so poll the run.
- `POST /api/runs/:id/plan` with `{"approved":true|false}` approves or rejects the plan.
- `POST /api/runs/:id/mode` with `{"mode":"live"|"autonomous"}`.
- `GET /api/runs` lists runs with `kind`, `mode`, the number of waiting cards (`pending`) and `planReady`; `GET /api/runs/:id` has the `pending` cards themselves, the `answers` and the `plan`.
- `POST /api/runs/:id/stop` ends a team run while it plans, while its plan waits, or while it is paused on a question; `POST /api/runs/:id/resume` picks it up again.
- Errors: 400 for bad input (including an unknown roster bot or an unknown question), 404 unknown run, 409 already answered or not allowed now (for example the run is stopped), 422 when the run cannot be created (for example the repo is not a git repository), 500 when an answer was recorded but the run could not carry on.

## Evolve: bots that improve with use

Evolve lets each bot get better from its own runs and from your feedback, after the method of Harness² (propose, probe, compose). The models stay as they are; what changes is the bot's **harness**, and only when you accept a change.

**The harness.** Each bot has numbered, immutable versions under `<home>/harness/<bot>/v<N>.json`; the highest one is current. A harness is three things and nothing else:

- `persona`: v1 holds the bot's definition text. An accepted persona edit never replaces a step's role prompt (its own prompt, or the role's default): when the current persona differs from v1's, it is **added** after the role prompt as a fenced "role note" (at most 600 characters);
- `guidance`: short notes added to the bot's prompt under "Learned guidance for your role", fenced as data (at most 12 notes of at most 400 characters);
- `skills`: the bot's skill list (at most 20 names of at most 80 characters). Runs do not read it yet, so Evolve does not propose skills edits in this version (they are dropped with "skills edits are not applied yet").

Permissions, limits, write access, bindings, agents, models and tools are not part of a harness, so Evolve cannot change them; a proposed edit that tries is dropped with a reason. v1 is a snapshot of the bot's definition, made the first time the bot runs; looking at a harness (CLI, terminal, dashboard, API) never writes one. Every agent or reviewer step whose role is a crew bot (agent or verdict kind) records which harness it ran with (`node.started` carries `harness: {bot, version}`); gates, approvals and steps without a bot role have no harness. At most 200 versions are kept per bot (v1 and the newest). The manager (Boss) is not evolvable: its prompts are built from each step and never use a harness, so no proposal is made for it (you can still look at its harness and roll it back).

Editing a bot's description in the Crew tab (or resetting a built-in one) does not change its harness or any run prompt. For built-in bots, v1's persona is the bot's one-line blurb; the blurb is not part of the prompt, so a persona edit for a built-in bot removes nothing: its role note is shown as added text ("nothing is removed"), and a later persona edit shows the earlier role note it replaces.

**Feedback.** Tell aorch how a step went: `aorch feedback <runId> <node> up|down [note…]`, `+` / `-` on a step in the terminal's run view, the Good / Bad buttons under a finished step in the dashboard, or `POST /api/runs/:id/feedback` with `{"node","rating":"up"|"down","note"}`. A thumbs-down only teaches something when it has a note saying why.

**Lessons.** When a run finishes (done or failed), aorch reflects on it without any model call and keeps per-bot lessons in `<home>/harness/<bot>/lessons.json`: work sent back for rework twice or more, two or more refused handoffs, a thumbs-down note, or a thumbs-up on a step that needed no rework and was quick and cheap. Each lesson carries its evidence (run, step and signal ids) and its provenance: `metrics` (wording made by aorch), `feedback` (your note) or `check` (a reviewer's or gate's words: lowest trust, never cited unless a person's feedback backs it). A lesson stays **tentative** until at least 3 distinct runs support it with no conflicting lesson (for example the same step both sent back and liked); then it is **confident**. Only confident lessons are ever proposed. Confident lessons are also written to the vault under `lessons/<bot>/`, as a record; vault retrieval never puts `lessons/` notes (or lesson and harness notes by type) into any prompt, so a lesson reaches a bot only through guidance you accepted. See them with `aorch lessons [bot]`, in the terminal's evolve view, or in the dashboard. Lesson and feedback text is data: it is fenced whenever it goes into a prompt (the editor's prompt and the guidance block), and every vault note retrieved as context is a fenced `<vault-note>` data section.

**Proposals.** `aorch evolve <bot>` makes one model call (the editor: Maestro's binding unless you pass `--agent`/`--model`, with a $0.50 cost cap where the adapter enforces one, and a 3-minute timeout) that suggests a small diff to the harness from the confident lessons. With no confident lessons it says "not enough evidence" and makes no call. A proposal has at most 5 edits, each citing at least one lesson; edits outside the editable fields, over the size limits, citing anything but a confident lesson of this bot, or matching an edit you rejected before are dropped with a reason. Nothing is applied: a proposal is a file under `<home>/harness/<bot>/proposals/` until you decide. At most 10 proposals can be open per bot. An open proposal written for an older version is closed as **superseded** the next time `aorch evolve` runs for that bot with confident lessons (shown apart from proposals you rejected); it cannot be accepted anyway, because accepting checks that the harness is still at the version the proposal was written for.

**Probes (optional, they cost money).** `aorch evolve <bot> --probe --budget <usd> [--tasks n] [--proposal id] [--allow-commands]` replays up to `n` (default 3, at most 8) recent read-only runs of that bot once with the current harness and once per proposed edit, and keeps an edit only when it did better in most of the tasks it was compared on. There is no probe without `--budget`, and the spend stops at it. Replays run read-only agent steps in a throwaway clone (pushing from it is blocked), never teach lessons, and only use adapters that can cap a call's cost. Runs whose workflow has a gate or setup command are skipped unless you pass `--allow-commands`: those commands then re-run in the clone with your shell's full rights, so they can reach anything a command can (only pass it for commands you trust). The result is saved on the proposal: the dashboard, the evolve view and `aorch evolve --show <id>` show each edit as kept, dropped or not probed. Probe replays are hidden from run lists (`aorch runs --all`, `P` on the terminal's Runs tab, or "show probe replays" in the dashboard shows them; `GET /api/runs?all=1`), `aorch probes --clean` deletes the finished ones, and each probe first deletes finished replays older than 7 days or beyond the newest 100 (their scores are already saved on the proposal). The probe's search for runs to replay never counts probe replays.

**Accept, reject, roll back.** Nothing is ever applied by itself.

- `aorch evolve --accept <id>` applies all edits; `--pick 1,3` applies only those (numbered from 1, as printed); `--pick kept` applies what the saved probe kept. When a probe dropped an edit, accepting without an explicit pick is refused everywhere (CLI, terminal, dashboard, API), so you choose. Accepting writes the next version (noted `evolve <id>`), a line in `<home>/harness/<bot>/changelog.jsonl`, and a vault note `lessons/<bot>/harness-v<N>.md` with the changes and the cited lessons (best effort); the next run uses it.
- `aorch evolve --reject <id>` rejects every edit of it; rejected edits are remembered (by fingerprint) and never proposed again. Showing and rejecting also work for proposals of a bot you have since deleted.
- Accept, reject and rollback take a per-bot lock (`<home>/harness/<bot>/.lock`, stale after 60 seconds), so two processes cannot interleave them; the second one is told the harness is busy.
- `aorch harness <bot>` shows the current version; `aorch harness <bot> log` lists the versions and the changelog (adoptions and rollbacks); `aorch harness <bot> diff <a> <b>` shows what changed; `aorch harness <bot> rollback <v>` makes a new version that copies `v` (rolling back to the current version, or to one that does not exist, is an error and changes nothing).
- `aorch evolve <bot> --list` lists a bot's proposals; `aorch evolve --show <id>` shows one with its diff, evidence and probe results.

**Terminal UI.** The Crew tab shows each bot's harness version and `● proposal` when one is open. `v` opens the bot's evolve view: the proposals with their diff, the lessons they cite and any probe results. Digits tick edits to accept, `K` ticks the edits the probe kept, `a` accepts (the ticked edits, or all when nothing is ticked and the probe dropped nothing), `r` rejects after you press `y`, and esc goes back. The view follows the proposal you are looking at by its id, so a new proposal arriving while you read never moves your selection, ticks or a pending reject onto another one. The view never asks the editor for a proposal (that costs money): run `aorch evolve <bot>` for that.

**Dashboard.** On the Crew tab each agent or reviewer bot shows its harness version and a `● proposal` badge; Evolve opens its harness (with versions and roll back), proposals (tick edits, Accept, Pick the kept edits, Reject with an inline confirm) and lessons. Like the terminal, it reviews proposals and never makes them.

**Maestro.** When recent runs show a bot sent back again and again, Maestro may offer to run `aorch evolve <bot>`; it never runs it on its own. Any `aorch evolve …` or `aorch harness … rollback` command Maestro proposes asks you every time, even when Maestro commands are set to "always", and "always allow" is not remembered for them.

**API** (loopback only, like the rest):

- `GET /api/harness/:bot`: `{bot, evolvable, current, versions (newest last, at most 50), total}`.
- `POST /api/harness/:bot/rollback` with `{"version": 2}`.
- `GET /api/lessons?bot=<bot>` (all bots without `bot`): lessons with text, status, runs, provenance and evidence ids.
- `GET /api/proposals?bot=<bot>`: the bot's open proposals, then the recent decided ones, each with `label` (`open`, `accepted`, `rejected`, `superseded`), `stale`, edits numbered from 1 with the lessons they cite, and the saved probe (`probe`, `composed` with edit numbers kept, dropped and not probed). Without `bot`: the open proposals of every bot.
- `POST /api/proposals/:id/accept` with `{}` (all edits; refused with 400 after a probe dropped edits), `{"pick":[1,3]}` (numbered from 1) or `{"pick":"kept"}`; `POST /api/proposals/:id/reject` with `{}`.
- Errors: 400 for a malformed id, a bad pick or version, or rolling back to the current or a missing version; 404 for an unknown bot or proposal; 409 when the harness moved on since the proposal was written, or the proposal was already accepted, rejected or superseded; 403 when the `Host` header is not a loopback name, or a state-changing request comes from another origin. Error messages never contain the home path (it is shown as `<home>`).

## Crew styles (web dashboard)

The web dashboard draws the crew five ways; pick one with the picker at the top of the Crew tab. The terminal draws no crew characters or styles.

| style | what a bot looks like | good for |
| --- | --- | --- |
| `pebble` | the pixel family (default), fully customisable | everyone |
| `classic` | the original visor bots (built-in crew only) | nostalgia |
| `sigil` | the glyph alone, drawn in 6×6 pixels: hollow when idle, solid with a light band when working | engineers, tmux, SSH |
| `tile` | the sigil's inverse: a rounded coloured tile with the glyph cut out of it and a status light in the corner | app-icon lovers |
| `ticker` | a three-letter symbol chip, a stance arrow and a sparkline | traders, the Trading desk |
| `orbit` | two initials in a small ring; a lit arc runs round it while the bot works | shared dashboards |

The mark styles (`sigil`, `tile`, `ticker`, `orbit`) are derived from the bot, so custom bots work with no extra setup: the glyph comes from the bot's id, the symbol and initials from its name, the colour from its look. The bot editor still edits the pixel look, which `pebble` uses.

## Talking to Maestro

The first tab, **chat**, is a conversation with Maestro like the one in Claude Code: just start typing, enter sends, and the transcript scrolls (↑↓, PgUp/PgDn). Maestro's replies, the workflows he proposes, and the runs he starts all appear in the transcript, and the live crew board sits under it while a run is going, so you watch the orchestration without leaving the chat. Click a run card to open the full run view.

Maestro can:

- **plan and save** a workflow from what you need ("a careful flow for payment code, with a human sign-off"),
- **optimize** a saved one ("make full-review cheaper"),
- **run** a saved workflow on a task, and **answer questions** about what the crew is doing.

He only proposes. A proposal shows up as a card; `enter` accepts it and `esc` declines. Replacing a workflow copies the old one to `pipelines/.backup/` first. Proposals are checked the same way as hand-built workflows (known step types, a test gate only when the repo has a test command).

When the input is empty, a greyed-out suggestion for the next step is shown, based on the latest run (`/approve` when it is waiting for you, `/retry` after a failure, `/open` when it finished); press `tab` to fill it in, then enter to send. While a suggestion is showing, `shift-tab` switches screens.

### Every run has its own conversation

Starting a run opens a conversation just for it (switch with `/sessions`, go back with `/main`; `/` on a run's screen jumps to its chat). It is saved to `<home>/chats/`, so closing aorch and coming back puts you exactly where you were: the transcript, what Maestro proposed, and what you chose.

- **Progress reports.** Maestro reports as steps finish ("Scout finished: PASS · 3 of 5 steps · $0.12"), when a step needs your approval, and when the run is done. `/status` gives the picture any time. Reports for a run you are not looking at appear as a notice.
- **When a run fails**, Maestro reads the failure and tells you in plain words what went wrong, then offers numbered options with a ★ recommended one: retry the failed step, move a step to a stronger model, give a step new instructions ("guidance", added to its prompt), do it by hand, or open the run. Pick with `enter` or `1`–`9`. Options are a fixed set of actions checked against the real run, never shell commands, and nothing happens until you pick one. Without a model to ask, rule-based options are offered.
- **Pick up where it stopped.** Retrying or resuming continues from the first unfinished step; nothing already done is repeated. If aorch was closed mid-run, the conversation offers to resume it when you return.
- **Change things any time.** Tell Maestro in the run's conversation ("use a stronger model for the coder", "keep the change small") and he offers the matching option.

### Commands Maestro can run

Maestro can ask to run a shell command (check `git status`, run the tests, look at a file) in the run's worktree, or in your folder from the main chat. A card shows the command, where it runs and why, with three choices: **1 allow once**, **2 always allow** that exact command, **3 deny**. The output comes back into the conversation and Maestro reads it and carries on (up to three commands in a row per message).

Settings → **Maestro commands** has three modes: *ask first* (default), *always run* (no prompt), and *off*. Even in *always run*, plainly destructive commands (`sudo`, `rm -rf /` or `~`, piping a download into a shell, force-pushing main, writing to disk devices) are refused. Commands run with a 2-minute limit and without environment variables that look like secrets (`*KEY*`, `*TOKEN*`, `*SECRET*`, `*PASSWORD*`). `/allowed` lists what you always allow and `/allowed clear` forgets it. Approvals are stored in `<home>/permissions.json`.

Slash commands: `/status`, `/approve` `/reject` `/retry` `/resume`, `/open` `/chat [run]`, `/sessions` `/main`, `/runs` `/workflows` `/crew` `/triggers` `/settings` to switch screen, `/run <workflow> <task>`, `/providers`, `/clear`, `/help`, `/quit`. Every other question aorch asks (names, paths, colours) is also typed on the line at the bottom of the screen.

## LLM providers

Settings → **LLM providers** lists every agent and model server aorch can use (installed? reachable? which models?) and adds new ones: DeepSeek, OpenAI, OpenRouter, Groq, Together, Fireworks, or any OpenAI-compatible URL. The same from the shell: `aorch providers`, `aorch providers add deepseek`, `aorch providers add --name mybox --url https://host/v1 --key-env MYBOX_KEY`, `aorch providers remove mybox`. Keys are never stored: you give the *name* of the environment variable that holds the key. Link a provider's model to a bot in the Crew tab.

### Usage and spend (Experiential Labs)

Providers on `experientiallabs.ai` also expose a Spend API, read with the same API key you added the provider with:

```
aorch usage                      # last 7 days: all-in spend, tokens, per model
aorch usage --days 30 --by key   # group by key, member, app, provider…
```

The same view is in Settings → LLM providers → the provider → Usage and spend. The organisation id is read from `/api/whoami`; set it by hand with `aorch providers org-id <name> <id>` if that fails. If the key needs to differ for usage, `aorch providers usage-key <name> <ENV_VAR>` sets an override. All-in spend is paid + BYOK + free; money is kept as exact integers (nano-USD) and shown to the cent, and a report with unknown provider accounting is marked provisional.

## Deleting runs

In the Runs tab press `D` on a run (or `D` inside the run) and confirm: the run's history, worktree, `aorch/<id>` branch and its chat are removed. A live run must be stopped first. From the shell: `aorch delete <runId>…` (add `--keep-work` to keep the branch and files), or `aorch delete all --finished` to clear every done or failed run. The dashboard API has `DELETE /api/runs/:id`.
