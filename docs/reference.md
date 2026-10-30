# Tether reference

The full manual: every command, setting and limit. New here? Start with the [README](../README.md).

## Contents

- [Terminal UI tips](#terminal-ui-tips)
- [Pull requests as triggers](#pull-requests-as-triggers)
- [Triggers](#triggers)
  - [Issue and comment triggers](#issue-and-comment-triggers)
- [Schedules](#schedules)
- [Code Mode: long results and browser tools](#code-mode-long-results-and-browser-tools)
- [Bots asking each other](#bots-asking-each-other)
- [Teams: a manager hands out work](#teams-a-manager-hands-out-work)
  - [Worker handoffs: `@HAND`](#worker-handoffs-hand)
- [Squad runs](#squad-runs)
- [Squads](#squads)
- [Tickets](#tickets)
- [Evolve: bots that improve with use](#evolve-bots-that-improve-with-use)
- [Crew styles (web dashboard)](#crew-styles-web-dashboard)
- [Talking to Tether](#talking-to-tether)
  - [Every run has its own conversation](#every-run-has-its-own-conversation)
  - [Commands Tether can run](#commands-tether-can-run)
- [LLM providers](#llm-providers)
  - [Usage and spend (Experiential Labs)](#usage-and-spend-experiential-labs)
- [Rewind, fork and try more ways](#rewind-fork-and-try-more-ways)
- [Terminal and Preview](#terminal-and-preview)
- [Telegram squads](#telegram-squads)
- [Deleting runs](#deleting-runs)

## Terminal UI tips

- **Tabs**: `1` chat, `2` runs, `3` workflows, `4` crew, `5` triggers, `6` settings (outside the chat tab; `tab` and `shift-tab` always cycle).
- **Ctrl-K** opens the command palette: jump to a tab, open a run, edit or run a workflow, link a bot, change settings, or run a skill. Type to filter.
- **Mouse**: click tabs, rows and steps (click a selected row again to open it), wheel to scroll, right-click to go back. Turn it off in Settings if you prefer to select text (or hold shift while dragging).
- **Skills**: `tether skills` lists them; `tether skills run <name> --task "…"` runs one. Two kinds: built-in or custom Tether workflows (JSON in `<home>/skills/`, e.g. `{"name":"my-skill","description":"…","steps":[{"role":"coder","prompt":"…"},{"role":"tester"}]}`), and Claude Code skills found in `~/.claude/skills` and `<repo>/.claude/skills`. A Claude Code skill runs inside a Claude agent step that is told to invoke it by name. In the workflow editor press `k` to add either kind.
- **The face**: one small face band sits at the top-left of the header (`▐  ●  ●  ▌`). Its eyes, colour and a glyph beside it show what is going on: idle (blinks now and then), working (`◉◉` and a spinner), waiting for you (`◔◔` amber `?`), done (`^^` green `✓`, for a few seconds after a run you started finishes), failed (`╥╥` red `!`) and asleep (`––` grey `z`, after ten idle minutes with nothing running; any key wakes it). It follows your colour theme, and shrinks to `▐●●▌` under 40 columns.
- **Reactions**: a step sparkles when it passes, shudders when one fails, and a baton slides along the arrow when work is handed on. Tether shows ↻ or ⇧ on a step it retries or escalates. Turn it off in Settings.
- **Side pane and charts** (run view): on terminals 100+ columns wide a pane beside the live output shows the selected step's diff or events (`|` cycles diff / events / off, `J`/`K` or the wheel scroll it). With colour and 34+ rows, `g` toggles a timeline and cost chart drawn with half-block pixels.

## Pull requests as triggers

Link a GitHub PR and run any workflow on it. It uses the `gh` CLI you are already signed in with (`gh auth login`).

```
tether pr https://github.com/acme/api/pull/42            # runs the built-in full-review (read-only, 5 steps)
tether pr acme/api#42 --workflow my-review --comment     # your own workflow, post the result as a PR comment
```

Run it automatically:

```
tether pr rule add acme/api --workflow full-review --comment   # which PRs run what
tether pr map acme/api ~/code/api                              # optional: use your checkout instead of a clone
tether pr watch                                                # polls GitHub every 60s, no setup
# or webhooks:
tether pr secret                                               # then add a GitHub webhook (Pull requests) to <tunnel>/api/webhooks/github
tether serve
```

These rules are triggers: see [Triggers](#triggers) for ids, pausing, a dry-run test, the delivery log and a guided webhook setup (`tether triggers …`). `tether pr rule …` keeps working and edits the same list.

Rules can limit by `--labels`, `--events`, and opt in to `--drafts` and `--forks`. Each PR runs once per commit. PR text is passed to agents fenced as data, and a workflow that executes commands (a test gate or setup step) refuses fork PRs unless you pass `--trust-code`. `tether serve` stays loopback-only; only the webhook path accepts outside hosts, and it needs the HMAC signature. Azure DevOps and AWS CodeCommit links are recognised but not wired up yet.

## Triggers

A **trigger** says: when a pull request arrives that matches this, start this workflow, in this workspace, on this agent. Triggers are the PR rules from `tether pr`, with an id, a pause switch, a status and a log of everything that reached them. They are stored in `<home>/pr.json` (older files load unchanged).

```
tether triggers add acme/api --workflow full-review --comment      # new trigger (the id defaults to acme-api-full-review)
tether triggers add acme/api --workflow quick-check --workspace api --agent codex --model gpt-5 --labels ready
tether triggers list                                                # id, status, repo, workflow, workspace, agent, last delivery
tether triggers disable acme-api-full-review   # keep it, ignore PRs (enable turns it back on)
tether triggers test acme-api-full-review acme/api#42    # dry run: would it start, and with what? add --fire to really start it
tether triggers log [id] --limit 50     # recent deliveries (what started, what a trigger refused, failures)
tether triggers setup                   # webhook payload URL, secret and tunnel help
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

- **Webhook**: GitHub calls `POST /api/webhooks/github` on `tether serve`. Run `tether triggers setup` for the values to paste into GitHub (Settings, Webhooks, content type `application/json`, event *Pull requests*) and for tunnel commands, since `tether serve` listens on this machine only. Only the webhook path is reachable through a tunnel, and every request must carry a valid HMAC signature.
- **Polling**: `tether pr watch` asks GitHub every 60 seconds. No tunnel or secret needed, but `gh` must be signed in. It re-reads your triggers on every sweep, so enabling, disabling, adding and removing apply while it runs. It only polls named repos: `*` triggers work through the webhook only (it says so once).

**Deliveries log.** `<home>/triggers-log.jsonl` keeps the most recent 500 entries, each `started`, `ignored`, `skipped` (matched but refused: already reviewed, fork guard) or `error`, with the reason. What gets written: the webhook records starts, failures, and PRs a matching trigger refused (draft, fork or label filters); actions no trigger listens for (closed, edited, ...) and repos no trigger covers leave no entry. Polling records only what it starts and its failures, each once per commit rather than every sweep. A dry-run `test` logs nothing; `test --fire` logs. Webhook and poll processes write the same file; if both trim it at the very same moment an entry can be lost.

**Status** in lists and dashboards:

- `paused`: the trigger is disabled.
- `error`: its latest delivery failed. `tether triggers log <id>` says why.
- `active`: it started a run within the last 24 hours.
- `idle`: enabled, nothing recent (or nothing yet).

**Where to manage them.** The web dashboard has a Triggers screen (list, add and edit form, pause, delete, test, deliveries, webhook setup). The terminal UI has a **Triggers** tab (key `5`, or `/triggers`): `↑↓` select, `space` pause or enable, `t` dry-run test against a PR link or `owner/repo#n`, `d` delete (asks first), `l` recent deliveries for the selected trigger, `s` webhook setup. The tab is empty until you add one; it shows the command to run.

**The webhook secret** is generated and saved in `<home>/pr.json` (mode 600) the first time you run `tether triggers setup`, or comes from `AORCH_WEBHOOK_SECRET` if set (the variable wins). `tether triggers setup --generate` replaces it. It is shown only by that command and when you generate it from the dashboard. Lists, the TUI, the delivery log and API responses never contain it; setup views show only its last four characters.

### Issue and comment triggers

A trigger can also fire on GitHub issues and comments (set **Fires on** in the dashboard's trigger form, or `"on"` in `pr.json`):

| `on` | fires when | option |
|---|---|---|
| `pr` (default) | a pull request event, as above | `events`, `labels`, `drafts`, `forks`, `comment` |
| `issue` | an issue is opened; with `label`, when that label is added or an issue opens with it | `label` |
| `comment` | a new comment on an issue or PR mentions `@tether` (as a word, any case) | `mention`, e.g. `@bolt` |

The run's task is the issue's title and text (or the comment's text) with a link, fenced as data. It starts on the repo's checkout like a PR run (a mapped folder, the trigger's workspace if it lists the repo, else a clone) and is logged in the deliveries log the same way. Rules:

- Only authors GitHub marks as the repo's **owner, member or collaborator** start a run; bots never do. Anyone else is logged as `ignored` with the reason (anyone can open an issue on a public repo, and the run works on your machine).
- The same issue opening, label or comment starts once, even when GitHub redelivers it.
- Nothing is posted back to the issue. The dry-run test works for PR triggers only.
- In the GitHub webhook settings, also tick **Issues** and **Issue comments**. Requests without an `X-GitHub-Event` header, or whose body is not a JSON object, are refused with 400 after the signature check.

## Schedules

A **schedule** starts a workflow in a workspace, or gives a goal its next turn, at set times. Manage them in the **Schedules** section of the web dashboard's Triggers screen: each shows its next fire, an on/off switch, **Run now** and **Delete**; the form takes a cron rule or a preset (every night 02:00, weekdays 09:00, Mondays 09:00, hourly).

- **Cron**: five fields, `minute hour day-of-month month day-of-week`, each `*`, a value, `a-b`, `*/n`, `a-b/n` or a comma list; Sunday is 0 or 7. No names, `@daily` macros or `L`/`W`/`#`. When either day field starts with `*`, a date must match both; otherwise either one (Vixie cron).
- **Time**: this computer's time zone. A time in a skipped DST hour fires at the first minute after it; a repeated hour fires once.
- **Targets**: a workflow (with a workspace and a task) starts a normal run. A goal (an open loop goal) checks again and proposes its next run, the way resuming it does; one already waiting for you or running is left alone.
- **When the app is closed**: nothing runs. On the next start, a schedule that missed its time runs **once**, then waits for its next fire. Turning a schedule back on, or changing its rule, counts from now.
- While the server runs it checks every 30 seconds. The last run (or why it could not start) shows on the schedule.
- Stored in `<home>/schedules.json` (mode 600). API: `GET/POST /api/schedules`, `PATCH /api/schedules/:id` (`enabled`, `name`, `cron`), `DELETE /api/schedules/:id`, `POST /api/schedules/:id/run`.

## Code Mode: long results and browser tools

**Long `run_code` results.** A script whose result (return value and logs) is over 16 KB no longer loses the rest: the full text is saved to `.tether/spill/<id>.txt` in the run's worktree (or the assistant's workspace folder), and the agent gets the start, the end and a note naming the file, to read in line ranges with `repo.read(path, { from, to })`. `.tether/` ignores itself in git, so spills never show in a diff, a commit or a search. Files are owner-only and are deleted after 24 hours (checked when the server starts and when each step ends). This works for every agent, since claude, codex and the OpenAI-compatible loop all use `run_code`.

**The OpenAI-compatible loop** (OpenRouter, NVIDIA, local models) also trims old tool results: before each model call, a result from an earlier turn that is over 8,192 characters keeps its first 4,096 and last 1,024 around a note saying how much was cut (the latest turn stays whole). When the model calls the same tool with the same arguments 3, 5 or 8 times in a row, a reminder is added to that result asking it to change course. Neither blocks anything.

**Browser presets.** Settings → Agents & tools → MCP servers offers two browser servers, off until you add one: **Playwright browser** (`npx -y @playwright/mcp@0.0.80 --browser chromium --isolated --headless`) and **Chrome DevTools** (`npx -y chrome-devtools-mcp@1.9.0 --no-usage-statistics --isolated --headless=true`). Once added, every agent reaches them in Code Mode as `mcp.playwright` and `mcp.chrome_devtools`. The first use downloads the package (and Playwright may need `npx playwright install chromium`).

These parts are ported from deepseek-harness (MIT); see `THIRD_PARTY_NOTICES.md`.

## Bots asking each other

A step can ask a step that already finished: why it did something, or about a bug it may have caused. It ends its answer with `@ASK <step-id>: <question>`; Tether puts the question to that step (read-only, resuming its own session when the agent supports it), then gives the answer back so the asker finishes. At most 2 questions per round, 2 rounds, billed to the asker, and every exchange is logged as a `consult` event (shown in `tether run`, the run's event list, and as a `?` / `…` mark over the two bots in the strip). Turn it on per workflow with `"settings": { "consult": 2 }` (new workflows have it on; `0` or leaving it out turns it off). Fix loops use it too: the fixing step can ask the reviewer that sent it back.

## Teams: a manager hands out work

A `manager` step plans the work and hands pieces to other bots at run time, then reviews what comes back. It is read-only: it coordinates and never edits files. The `team` workflow (`manager → tests → review → approve`, tests only when the repo has a test command) is the quickest way to try it; you can also add a manager step to any workflow by hand. Tether does not propose manager steps in a workflow (open-ended work goes to a team run, below).

The manager replies with a plan, `{"tasks":[…]}`. Each task is a hand-off contract:

- `to`: the bot or role that gets the work (the manager's `roster`, or any bot except gates, approvals and managers)
- `goal`: what to do; `expected`: what done looks like
- `context`: ids of finished steps whose output the receiver needs
- `mode`: `read` (default) or `write`; write tasks may edit files in the run worktree. Write tasks are only accepted when the workflow sets `allowWrites: true` in its `settings` (the `team` workflow does; a plan with write tasks otherwise goes back to the manager with the reason), they can only go to bots that edit files (not planners, reviewers or other read-only bots), and they still pause for your approval by default (see `planApproval` below)
- `after`: ids of tasks in the same plan that must finish first (tasks without `after` run in parallel)

A spawned step is the receiving bot's usual step (its persona, read-only setting, and for reviewers the diff and `VERDICT` line) with the contract on top. The manager sees the task, its own instructions and guidance, the project context, the output of the steps before it, and the list of steps in the run. A plan holds at most 12 tasks; goals and expected results are capped at 500 characters and `context` at 10 step ids.

Spawned steps show up under their manager in the run view, `tether show` and the run board, marked `↳` with the receiving bot's name, and open like any other step. After they finish the manager reviews the results and replies `{"decision":"accept"}`, `{"redo":[…]}` (send some back) or `{"more":[…]}` (plan more work).

Limits live in the workflow's `settings`: `allowWrites` (managers may hand out write tasks, default off), `maxDepth` (how deep managers may nest, default 3, 1 to 5; it also bounds worker handoff chains), `maxSpawn` (steps spawned per run, default 12, 1 to 30) and `planApproval` (the manager's plan must be approved before anything is spawned). Unless you set `planApproval` yourself, a plan that includes write tasks pauses for approval (`planApproval: false` turns that off). Redos count against `maxSpawn`, and the run's cost cap and wall-clock limit apply to everything a manager spawns, including the manager's own plan and review calls.

In this first stage the `team` workflow has no automatic fix loop for the tests or the reviewer after the manager: if they fail, the run ends as an error, and you retry or resume it (`tether resume`, or Retry in the run chat). Feeding such a failure back into the manager's review is planned. A pull request from a fork is refused for any workflow with a manager step unless you pass `--trust-code`, because spawned steps may run and edit code.

### Worker handoffs: `@HAND`

A worker (any agent step, including one a manager spawned) can pass a sub-task to a teammate while it works. It ends its answer with a line that starts in column 0:

```
@HAND reviewer: check a.txt | expect: PASS or a list of problems | context: step-1
@HAND! coder: add the missing test | expect: the test passes
```

`@HAND <bot>: <goal>` is a read-only handoff; `@HAND!` asks for a write handoff. `expect:` and `context:` (ids of finished steps) are optional. The line must start at column 0 (indented lines, quoted lines and lines inside code fences are ignored), and a step may make at most 2 requests per round.

- `handoff` (1 to 3) in the workflow's `settings` is how many rounds of handoffs a step may start. Off when unset; the `team` workflow sets it to 1.
- `allowWorkerWrites` is the write permission for workers: `@HAND!` is refused unless it is `true`. Write handoffs can only go to bots that edit files. A write handoff gets no per-handoff human approval: setting `allowWorkerWrites: true` is the opt-in, so only set it for workflows where workers may change files unattended.
- The receiving step is a child of the worker (ids like `<worker>-h1`), shown under it as `↳ <bot> (handoff)` in the run view, `tether show` and the board, and logged as a `handoff` event.
- Handoffs share the manager limits: they count against `maxSpawn` and `maxDepth`, and the run's cost cap and wall-clock limit cover them.
- Loop rule: a worker cannot hand to its own role or to any step or role already in its chain of delegators (including the manager that started the chain). A refused request is not run; the reason goes back to the worker.
- The child's answer comes back to the worker, which then finishes its own step with it. A failed handoff does not fail the run: the worker is told it failed and decides what to do.
- `@ASK` is still the cheap way to ask a question: it consults a step that already finished and spawns nothing. Use `@HAND` when someone needs to do new work.


## Squad runs

A run is either a **workflow** (a fixed pipeline of steps, everything above) or a **squad** run (the run kind is still called `team` in the API and the CLI, `tether team`): you give a goal, Tether asks you a few questions, writes a plan, and once you approve it a manager (Boss) hands the work to bots from the crew. Use a workflow when you know the steps; use a team when the work is open-ended. Tether proposes a team run when you describe open-ended work or ask for "a team".

**Planning cards.** Before any plan, Tether asks in rounds. Each round has up to 4 questions (cards) with at most 6 options each; every card has a recommended option (marked with a star), and most carry a one-line reason for asking. Some cards also accept your own words (free text, up to 2000 characters). The "writes" card is always worded by Tether itself ("May agents change files in the worktree?"), whatever the model wrote, so its yes means yes. Press enter or run with `--yes` to take the recommended answers. After at most 3 rounds (`--rounds n`, 1 to 6) Tether has to write the plan, which lists the goal, success criteria, who does what (read or write) and the limits. Nothing starts until you approve it. Boss's first batch of work needs no second approval only when it stays inside the plan (the bots it names, writes only where the plan says write); anything beyond it, and every later batch, asks you again.

**Modes.** `live` (default) keeps you in the loop: progress reports in the run's chat and questions from workers wait for you. `autonomous` goes quiet: Tether answers workers' questions with the recommended option (logged as answered by Tether) and reports only once, at the end. Planning questions always come to you in both modes (unless `--yes`). Switch any time: `/mode live|autonomous` in the run's chat, `tether mode <runId> live|autonomous`, or the toggle in the dashboard. A card that is already waiting stays waiting.

**Workers can ask you: `@ASK user:`.** A worker that needs a decision ends its answer with a line in column 0:

```
@ASK user: Which database? | options: postgres; sqlite | recommended: sqlite | why: the repo has no server
```

`options:` (at most 6, separated by `;`), `recommended:` (a label or number; the first option if missing) and `why:` are optional; without options you get a "proceed with your best judgement" card. The step pauses, the run waits, and when you answer the step runs again with your answer in its prompt. Files it had changed before pausing are reverted while it waits, and it is told to redo them. At most 4 questions per reply; at most 2 cards wait at once, and beyond that, or when the step cannot wait (a `@HAND` child), Tether answers with the recommended option and says so. `@ASK <step-id>:` still consults a finished step as described above.

**Limits.**

- Budget: applies only with **Spending caps** on (Settings) or an explicit `--budget`; with caps off, costs still show but nothing stops on cost. With caps on, a plan without a cost cap gets `$5`. `--budget <dollars>` (or `budget` in the API) overrides the model's cap; nothing can go above `$50` (`TEAM_MAX_BUDGET_USD`). The cap is for the whole run, planning included: planning calls get only what is left, and planning stops (the run ends with an error that says so) once it has spent `--budget`, or `$5` when no budget was given. The plan shows what planning spent and what is left; a plan whose cap planning already used up cannot be approved (reject it and start again with a larger `--budget`). The cap and the plan's wall-clock limit (clamped to 1 minute to 4 hours) cover everything the team spawns, and a run that hits them stops and says so.
- Writes: agents edit files in the run's own worktree unless you answer no to the "writes" card; nothing reaches your branch until you approve or merge. Only your no makes a run read-only: the model's own card and plan cannot change it. With writes on, workers may also use `@HAND!`.
- Workers can pass sub-tasks with `@HAND` and consult finished steps with `@ASK <step-id>:`, as in the sections above.

**Commands.**

```
tether team "<goal>" --repo <dir> [--mode live|autonomous] [--roster coder,reviewer] [--budget 2.50] [--rounds 3] [--yes]
tether answer <runId> <question> <option | "your own words">   # answer a waiting card from another terminal
tether plan <runId> [--reject]                                 # approve (or reject) a finished plan
tether mode <runId> live|autonomous
tether show <runId>                                            # includes the questions, answers (and who gave them) and the plan
```

`tether team` asks the cards in the terminal and shows the plan before it starts. Without a terminal and without `--yes` it prints the cards and exits with code 2; continue with `tether answer` and `tether plan`. `--json` prints JSON only. `--roster` limits the plan to those bots.

**Terminal UI.** `T` on the Runs or Workflows tab (or `/team <task>`, or the command palette) starts a team run. Cards appear in the run's chat. Press enter to give the card the keys; then `1`-`9` pick an option, enter takes the recommended one, `o` types your own words when the card allows it, and esc goes back to chatting. Until you press enter, what you type is an ordinary chat message. When the plan is ready the chat says so: `/approve` starts the team, `/reject` cancels. A waiting question or plan turns the face amber and puts a `?` on the run in the Runs tab.

**Dashboard.** The New run dialog has a Workflow / Team toggle and a mode toggle. A team run in the Runs tab shows a Team badge, a badge while it waits for you, the question cards (option buttons, recommended badge, free text, "Use recommendations"), the plan with Approve / Reject, and the dialogue so far. A run waiting on you is never shown as interrupted, and Stop ends it at any point (planning, plan ready, or paused on a question).

**Stop and resume.** Stopping a team run while it plans, or while its plan waits, drops the open cards. `tether resume <runId>` (or Resume in the dashboard) plans again from the answers given so far: the round that was cut off is asked again, and a stopped plan comes back for approval.

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

**Feedback.** Tell Tether how a step went: `tether feedback <runId> <node> up|down [note…]`, `+` / `-` on a step in the terminal's run view, the Good / Bad buttons under a finished step in the dashboard, or `POST /api/runs/:id/feedback` with `{"node","rating":"up"|"down","note"}`. A thumbs-down only teaches something when it has a note saying why.

**Lessons.** When a run finishes (done or failed), Tether reflects on it without any model call and keeps per-bot lessons in `<home>/harness/<bot>/lessons.json`: work sent back for rework twice or more, two or more refused handoffs, a thumbs-down note, or a thumbs-up on a step that needed no rework and was quick and cheap. Each lesson carries its evidence (run, step and signal ids) and its provenance: `metrics` (wording made by Tether), `feedback` (your note) or `check` (a reviewer's or gate's words: lowest trust, never cited unless a person's feedback backs it). A lesson stays **tentative** until at least 3 distinct runs support it with no conflicting lesson (for example the same step both sent back and liked); then it is **confident**. Only confident lessons are ever proposed. Confident lessons are also written to the vault under `lessons/<bot>/`, as a record; vault retrieval never puts `lessons/` notes (or lesson and harness notes by type) into any prompt, so a lesson reaches a bot only through guidance you accepted. See them with `tether lessons [bot]`, in the terminal's evolve view, or in the dashboard. Lesson and feedback text is data: it is fenced whenever it goes into a prompt (the editor's prompt and the guidance block), and every vault note retrieved as context is a fenced `<vault-note>` data section.

**Proposals.** `tether evolve <bot>` makes one model call (the editor: Tether's binding unless you pass `--agent`/`--model`, with a $0.50 cost cap where the adapter enforces one, and a 3-minute timeout) that suggests a small diff to the harness from the confident lessons. With no confident lessons it says "not enough evidence" and makes no call. A proposal has at most 5 edits, each citing at least one lesson; edits outside the editable fields, over the size limits, citing anything but a confident lesson of this bot, or matching an edit you rejected before are dropped with a reason. Nothing is applied: a proposal is a file under `<home>/harness/<bot>/proposals/` until you decide. At most 10 proposals can be open per bot. An open proposal written for an older version is closed as **superseded** the next time `tether evolve` runs for that bot with confident lessons (shown apart from proposals you rejected); it cannot be accepted anyway, because accepting checks that the harness is still at the version the proposal was written for.

**Probes (optional, they cost money).** `tether evolve <bot> --probe --budget <usd> [--tasks n] [--proposal id] [--allow-commands]` replays up to `n` (default 3, at most 8) recent read-only runs of that bot once with the current harness and once per proposed edit, and keeps an edit only when it did better in most of the tasks it was compared on. There is no probe without `--budget`, and the spend stops at it. Replays run read-only agent steps in a throwaway clone (pushing from it is blocked), never teach lessons, and only use adapters that can cap a call's cost. Runs whose workflow has a gate or setup command are skipped unless you pass `--allow-commands`: those commands then re-run in the clone with your shell's full rights, so they can reach anything a command can (only pass it for commands you trust). The result is saved on the proposal: the dashboard, the evolve view and `tether evolve --show <id>` show each edit as kept, dropped or not probed. Probe replays are hidden from run lists (`tether runs --all`, `P` on the terminal's Runs tab, or "show probe replays" in the dashboard shows them; `GET /api/runs?all=1`), `tether probes --clean` deletes the finished ones, and each probe first deletes finished replays older than 7 days or beyond the newest 100 (their scores are already saved on the proposal). The probe's search for runs to replay never counts probe replays.

**Accept, reject, roll back.** Nothing is ever applied by itself.

- `tether evolve --accept <id>` applies all edits; `--pick 1,3` applies only those (numbered from 1, as printed); `--pick kept` applies what the saved probe kept. When a probe dropped an edit, accepting without an explicit pick is refused everywhere (CLI, terminal, dashboard, API), so you choose. Accepting writes the next version (noted `evolve <id>`), a line in `<home>/harness/<bot>/changelog.jsonl`, and a vault note `lessons/<bot>/harness-v<N>.md` with the changes and the cited lessons (best effort); the next run uses it.
- `tether evolve --reject <id>` rejects every edit of it; rejected edits are remembered (by fingerprint) and never proposed again. Showing and rejecting also work for proposals of a bot you have since deleted.
- Accept, reject and rollback take a per-bot lock (`<home>/harness/<bot>/.lock`, stale after 60 seconds), so two processes cannot interleave them; the second one is told the harness is busy.
- `tether harness <bot>` shows the current version; `tether harness <bot> log` lists the versions and the changelog (adoptions and rollbacks); `tether harness <bot> diff <a> <b>` shows what changed; `tether harness <bot> rollback <v>` makes a new version that copies `v` (rolling back to the current version, or to one that does not exist, is an error and changes nothing).
- `tether evolve <bot> --list` lists a bot's proposals; `tether evolve --show <id>` shows one with its diff, evidence and probe results.

**Terminal UI.** The Crew tab shows each bot's harness version and `● proposal` when one is open. `v` opens the bot's evolve view: the proposals with their diff, the lessons they cite and any probe results. Digits tick edits to accept, `K` ticks the edits the probe kept, `a` accepts (the ticked edits, or all when nothing is ticked and the probe dropped nothing), `r` rejects after you press `y`, and esc goes back. The view follows the proposal you are looking at by its id, so a new proposal arriving while you read never moves your selection, ticks or a pending reject onto another one. The view never asks the editor for a proposal (that costs money): run `tether evolve <bot>` for that.

**Dashboard.** On the Crew tab each agent or reviewer bot shows its harness version and a `● proposal` badge; Evolve opens its harness (with versions and roll back), proposals (tick edits, Accept, Pick the kept edits, Reject with an inline confirm) and lessons. Like the terminal, it reviews proposals and never makes them.

**Tether.** When recent runs show a bot sent back again and again, Tether may offer to run `tether evolve <bot>`; it never runs it on its own. Any `tether evolve …` or `tether harness … rollback` command Tether proposes asks you every time, even when Tether commands are set to "always", and "always allow" is not remembered for them.

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

## Talking to Tether

The first tab, **chat**, is a conversation with Tether like the one in Claude Code: just start typing, enter sends, and the transcript scrolls (↑↓, PgUp/PgDn). Tether's replies, the workflows it proposes, and the runs it starts all appear in the transcript, and the live crew board sits under it while a run is going, so you watch the orchestration without leaving the chat. Click a run card to open the full run view.

Tether can:

- **plan and save** a workflow from what you need ("a careful flow for payment code, with a human sign-off"),
- **optimize** a saved one ("make full-review cheaper"),
- **run** a saved workflow on a task, and **answer questions** about what the crew is doing.

It only proposes. A proposal shows up as a card; `enter` accepts it and `esc` declines. Replacing a workflow copies the old one to `pipelines/.backup/` first. Proposals are checked the same way as hand-built workflows (known step types, a test gate only when the repo has a test command).

When the input is empty, a greyed-out suggestion for the next step is shown, based on the latest run (`/approve` when it is waiting for you, `/retry` after a failure, `/open` when it finished); press `tab` to fill it in, then enter to send. While a suggestion is showing, `shift-tab` switches screens.

### Every run has its own conversation

Starting a run opens a conversation just for it (switch with `/sessions`, go back with `/main`; `/` on a run's screen jumps to its chat). It is saved to `<home>/chats/`, so closing Tether and coming back puts you exactly where you were: the transcript, what Tether proposed, and what you chose.

- **Progress reports.** Tether reports as steps finish ("Scout finished: PASS · 3 of 5 steps · $0.12"), when a step needs your approval, and when the run is done. `/status` gives the picture any time. Reports for a run you are not looking at appear as a notice.
- **When a run fails**, Tether reads the failure and tells you in plain words what went wrong, then offers numbered options with a ★ recommended one: retry the failed step, move a step to a stronger model, give a step new instructions ("guidance", added to its prompt), do it by hand, or open the run. Pick with `enter` or `1`–`9`. Options are a fixed set of actions checked against the real run, never shell commands, and nothing happens until you pick one. Without a model to ask, rule-based options are offered.
- **Pick up where it stopped.** Retrying or resuming continues from the first unfinished step; nothing already done is repeated. If Tether was closed mid-run, the conversation offers to resume it when you return.
- **Change things any time.** Tell Tether in the run's conversation ("use a stronger model for the coder", "keep the change small") and it offers the matching option.

### Commands Tether can run

Tether can ask to run a shell command (check `git status`, run the tests, look at a file) in the run's worktree, or in your folder from the main chat. A card shows the command, where it runs and why, with three choices: **1 allow once**, **2 always allow** that exact command, **3 deny**. The output comes back into the conversation and Tether reads it and carries on (up to three commands in a row per message).

Settings → **Tether commands** has three modes: *ask first* (default), *always run* (no prompt), and *off*. Even in *always run*, plainly destructive commands (`sudo`, `rm -rf /` or `~`, piping a download into a shell, force-pushing main, writing to disk devices) are refused. Commands run with a 2-minute limit and without environment variables that look like secrets (`*KEY*`, `*TOKEN*`, `*SECRET*`, `*PASSWORD*`). `/allowed` lists what you always allow and `/allowed clear` forgets it. Approvals are stored in `<home>/permissions.json`.

Slash commands: `/status`, `/approve` `/reject` `/retry` `/resume`, `/open` `/chat [run]`, `/sessions` `/main`, `/runs` `/workflows` `/crew` `/triggers` `/settings` to switch screen, `/run <workflow> <task>`, `/providers`, `/clear`, `/help`, `/quit`. Every other question Tether asks (names, paths, colours) is also typed on the line at the bottom of the screen.

## LLM providers

Settings → **LLM providers** lists every agent and model server Tether can use (installed? reachable? which models?) and adds new ones: DeepSeek, OpenAI, OpenRouter, NVIDIA, Groq, Together, Fireworks, or any OpenAI-compatible URL. The same from the shell: `tether providers`, `tether providers add deepseek`, `tether providers add --name mybox --url https://host/v1 --key-env MYBOX_KEY`, `tether providers remove mybox`. Keys are never stored: you give the *name* of the environment variable that holds the key. Link a provider's model to a bot in the Crew tab. Free hosted models: Settings → **Accounts** connects OpenRouter (one approval in the browser) or NVIDIA (paste a key from build.nvidia.com once; `pbpaste | tether accounts connect nvidia` from the shell). Those keys go to the Keychain, never to the config file. NVIDIA's free tier allows about 40 requests a minute and is meant for trying things out.

### Usage and spend (Experiential Labs)

Providers on `experientiallabs.ai` also expose a Spend API, read with the same API key you added the provider with:

```
tether usage                      # last 7 days: all-in spend, tokens, per model
tether usage --days 30 --by key   # group by key, member, app, provider…
```

The same view is in Settings → LLM providers → the provider → Usage and spend. The organisation id is read from `/api/whoami`; set it by hand with `tether providers org-id <name> <id>` if that fails. If the key needs to differ for usage, `tether providers usage-key <name> <ENV_VAR>` sets an override. All-in spend is paid + BYOK + free; money is kept as exact integers (nano-USD) and shown to the cent, and a report with unknown provider accounting is marked provisional.

## Squads

A **squad** is people and agents (Crew bots) working on one project, in Tether or in a Telegram group. Squads replaced Teams (2026-10-30): the same squads with the same ids; on first start Tether moves `<home>/teams/` to `<home>/squads/` once (a home that already has `squads/` keeps it and leaves `teams/` alone). The sidebar lists them under **Squads** (a pulsing dot while one works, the number of things waiting on you, or how many messages came since you last looked) and every agent under **Agents** with its face and what it is doing.

**The channel (board 8).**

- **Right now**: a card per busy agent (its face, a live line such as "editing Tabs.tsx", its progress, a timer and its ticket), a **You** card when something waits on you, and the free agents. A card filters the channel to that member; **Show everyone** clears it.
- Agents write like teammates: one or two first-person sentences, at most 280 characters, no headings, lists, code blocks or other markdown; numbers that matter inline. The work sits behind **What I did** (files changed, +/−, the commands that ran with their results, time, model) with **Full report** (the agent's raw output, never posted in the channel), **Diff** and **Open the run**.
- Hand-offs show as a chip ("Handed to Lens for a review"). Replies to an agent's message go in its thread (the first review of a hand-off stays in the channel); a person can reply in any thread from the panel on the right. Messages take reactions (Nice, Thanks, +1, Looking) and can be pinned; hover a message, or tab to it, for React, Reply in thread, Pin and Open the run. A line shows who is writing ("Lens is reading Bolt's change…").
- **Chat | Map**: the map shows who handed work to whom today; lines move while that work is live.
- The composer suggests asks ("Ask Bolt to…", "Have Lens review a PR", "What's everyone doing?"); `@` opens a picker that says whether each agent is **free now** or **busy · will queue**.
- **Squad pulse** (right, when no thread is open): the squad's tickets per status (each opens the board on this squad), what shipped today with five days of shipping, what is coming up (queued pickups, recurring tickets and their next scheduled time) and what is pinned (a message with a link reads "Link", anything else "Decision").

**The status writer.** Squad messages come from templates when they only restate facts (started, plan waiting, plan approved, queued, auto-fix round n, ready to ship, PR opened, merged). When there is a report to condense (work finished, failed, auto-fix gave up) the squad's cheapest model writes it: an agent of the squad on a free model first (OpenRouter, NVIDIA or a `:free` model), else the speaking agent's own binding. Its reply is checked (length, at most two sentences, where a fragment of three words or fewer such as "Fixed it." does not count, no markdown, every @mention a member of the squad, a failure that says so plainly) and replaced by the template when it breaks a rule. Agents answering a ping get the same rules in their prompt; an answer that breaks them is flattened to its first two sentences and the whole answer is kept as its report.

**Work.** "@Bolt fix the sign-in redirect" becomes a ticket (assigned to Bolt, reviewed by the squad's reviewer agent when it has one, made from the message) and a run on Bolt's binding. If Bolt is already working on a run in the squad, the task waits in the squad's queue as a Todo ticket ("I'm in the middle of WEB-145, so I'll pick this up next.") and starts when that run stops working (it reaches its ship card or ends); **Start now** starts it at once. When the work is done Bolt says so and asks the reviewer; a failed review hands the work back as a rework on the same branch, in the reviewer's thread, and replaces the ship card that waited. Agents hand on at most 3 times in a row before a person must step in.

**The ship card.** It shows the change's size (a +/− bar), the test gate, the review and the ticket's criteria. **Ship it** approves, opens the PR and merges it once its checks pass; until it merges the card says "Shipped by you · PR #n open" with **Undo** (the PR is closed, the merge watch stops and the card waits again). **Not yet** asks what should change and the agent reworks it once. A failure (a push or merge that did not work, a run that failed, auto-fix giving up) is said in the channel with its reason.

**API** (loopback; `/api/teams…` answers the same for one release):

- `GET /api/squads` → `{ squads, teams, agents }` (`teams` is the same list under its old name; each agent has `state`, `line`, `since`, `progress`, `ticket`). Each squad has `status`, `needs`, `recent` (when the newest messages from others came) and its `queue`.
- `GET /api/squads/:id` (the squad, messages, members with what each is doing, queue, spend), `POST /api/squads`, `PATCH /api/squads/:id`, `DELETE /api/squads/:id`.
- `POST /api/squads/:id/messages { text, thread? }`, `POST /api/squads/:id/messages/:msg/react { reaction }`, `POST /api/squads/:id/messages/:msg/pin { on }`.
- `POST /api/squads/:id/cards/:msg { action, reason?, task? }`, `POST /api/squads/:id/cards/:msg/undo`, `GET /api/squads/:id/diff/:msg`, `POST /api/squads/:id/queue/:q/start`.

## Tickets

Every goal is a **ticket** (Tickets replaced Goals, 2026-10-30): software-engineering tickets with a key (`<PREFIX>-<n>`, numbered per project in creation order and never reused; the prefix is the last word of the project name, at most 4 letters, `acme-web` → `WEB`, and editable from the Tickets header, which renames every key of the project), a type (feature, bug, refactor, chore), a status (**Backlog, Todo, In progress, In review, Done, Canceled**), a priority (Urgent, High, Medium, Low, none), an assignee and an optional reviewer (an agent or you), a squad, labels, **acceptance criteria**, linked PRs, what it has spent (shown; a cap only with Spending caps on and a limit set), where it came from (a chat, a squad message) and its activity.

- **Criteria**: the items you tick, and at most one **auto-checked** criterion: a command (the old goal check) run after each of the ticket's runs, in that run's worktree.
- **Flow**: asking a chat or a squad to build, fix or change something makes a ticket (in a chat, the ticket card: Start, Edit ticket, or "Just answer, no ticket"). Its first run moves it to In progress; a run waiting on its ship approval, or a PR it opened, moves it to In review (it **needs you** when an approval waits); a send-back moves it back to In progress; the merge moves it to Done. A run that ends with nothing to ship is Done. A ticket you move to Canceled stops its loop, to Backlog pauses one, to Done ends one; moved out of Done or Canceled it waits for a Start again.
- **Recurring tickets** are the old loops ("@Probe keep main green"): a ticket with an auto-checked criterion that runs until it passes, within its limits; schedules (Triggers → Schedules) give one its next turn.
- **Start** on a ticket assigned to a squad's agent hands it to that agent in its squad; a comment that @mentions an agent hands it the ticket the same way (an agent in no squad of the project is refused, plainly). Otherwise Start runs it as goals ran: its workflow, or a squad run.

**The screen (board 10)**: **This week** (shipped since Monday with a bar per day, in flight and who, the average Todo → Done time, the oldest ticket waiting on you), filters (All, Needs me, Bugs, Canceled, a squad, an assignee), **Board** (a column per status; in-progress cards show the agent's live line and timer, in-review cards their criteria and PR, Done cards their merged PR; Canceled shows in the List) or **List** (key, title, status, priority, assignee, squad, updated), and the detail panel (properties, criteria, the ship banner in review with Merge PR or Ship it and Send back, Start, the activity and a comment box). Backlog shows **Ideas from your chats** (asks a chat drafted a ticket for that were answered "no ticket"; **+** makes one); Todo shows **Ready for an agent** (a free squad agent for each unassigned ticket, with Assign, which also starts it, and the queued pickups, with Start now). Each box shows only when it has something real. `#/goals…` links open Tickets, `#/teams/…` links open Squads.

**Migration**: on first start each goal gets a number (per project, in creation order), a status (paused not started → Todo, paused → Backlog, active → In progress, needs you → In review, met → Done, stopped → Canceled), an assignee and reviewer from its loop agent and assignees, and a squad from its team; its check, items and runs stay as they were (they are the criteria and the history). Running it again changes nothing.

**API** (loopback; `/api/goals…` answers the same for one release):

- `GET /api/tickets[?ws=]`, `GET /api/tickets/stream`, `GET /api/tickets/:id`. A ticket has the goal's fields plus `key`, `stage` (the status), `priority`, `assignee`, `reviewer`, `labels`, `prs`, `squad`, `criteria`, `activity` and `needs` (why it waits on you).
- `POST /api/tickets { title, workspace, type?, priority?, stage?: 'backlog'|'todo', assignee?, reviewer?, labels?, squad?, criteria?, description?, check?, recurring? }`: with `stage` it waits for its Start; without it a goal starts as before.
- `PATCH /api/tickets/:id { stage?, priority?, assignee?, reviewer?, labels?, squad?, recurring?, … }` (`null` clears an assignee, reviewer or squad), `DELETE /api/tickets/:id`.
- `POST /api/tickets/:id/start`, `/comments { text }`, `/ship` (Ship it or Merge PR), `/send-back { reason? }`, `/check`, `/next`, `/items`, `PATCH /api/tickets/:id/items/:n`.
- `PUT /api/tickets/prefix { workspace, prefix }`, `GET /api/tickets/ideas?ws=`, `POST /api/tickets/ideas { workspace, chat, proposal }`.

## Rewind, fork and try more ways

On a run's page, a finished step's ⋯ menu has:

- **Rewind to before this step.** The run's worktree goes back to the commit the step started from (untracked files the steps made are removed; setup output and git-ignored files stay). That step and every step after it are queued again, and the run is left stopped: press **Resume** to carry on. Nothing is lost: the old head, with any uncommitted work committed on top, is kept at `refs/tether/rewind/<run>/<n>`, and **Undo** in the banner puts it back until the run moves on. Spent cost stays spent. A live run is stopped first; a run already shipped as a PR is not rewound (fork it instead). In a team run, only the steps the manager handed out can be rewound, and their manager runs again.
- **Fork from after this step.** A new run with the same task, workflow and project starts from the step's commit; the step and the ones before it show as done, "From run <id>".
- **Open its changes.**

**Try 2 more ways** (a run's header, or a started goal card) runs the same task 1 to 4 more times at once, each on another agent or model, from the same starting commit: an attempt set (A is the run you started from; a set holds up to 8). The defaults are the agents and models you have set up, free ones first, never the run's own and none twice. Each attempt counts toward its goal's run cap and budget and its team's daily limits like any run. **Compare** (`#/attempts/<set>`) lists them side by side with their check, changes, cost, time and review. Tether marks its pick (the check passes, then fewer failing tests, then the smaller diff, then the lower cost) but never ships on its own. **Pick X and ship** opens that run's PR (the team's approver rule applies) and stops the others; their worktrees and branches are removed 7 days later, their run records kept.

API: `POST /api/runs/:id/rewind { node }`, `POST /api/runs/:id/rewind/undo`, `POST /api/runs/:id/fork { node }`, `GET|POST /api/runs/:id/attempts { count, agents? }`, `GET /api/attempts/:set`, `POST /api/attempts/:set/pick { run, merge? }`.

## Terminal and Preview

A run's page has two more tabs for checking its work without leaving Tether.

- **Terminal** runs a command (`sh -lc`) in the run's worktree and streams what it prints. It is a console, not an interactive shell: one command at a time, ↑ and ↓ walk your earlier commands, Stop or Ctrl+C ends the command and everything it started. The first 100 000 characters show; a longer output is saved whole under the worktree's `.tether/spill/` (git ignores it). The last 50 commands are kept while Tether runs.
- **Preview** starts the project's dev command in the worktree (`npm run dev`, else `npm run start`, else the command you type) with `PORT` set to a free port, and shows the page in a sandboxed frame once it prints a `localhost` or `127.0.0.1` address (or on its `PORT` after 20 seconds). On a wide window it opens beside the step. Reload, Open in browser and Stop are in its bar.

Commands get your `PATH` and a few basics (`HOME`, `USER`, `SHELL`, `LANG`, `TERM`, `TMPDIR`, `TZ`), none of Tether's keys or tokens. Every process is ended by Stop, by deleting the run, and when Tether quits; ones a crash left behind are ended the next time it starts. The routes answer loopback only, like the rest of the API: `GET|POST /api/runs/:id/exec { command }`, `POST /api/runs/:id/exec/stop`, `GET|POST|DELETE /api/runs/:id/preview { command? }`; the output rides the run's stream (`/api/runs/:id/stream`) as `proc` events.

## Telegram squads

A squad can live in a Telegram group: people talk to Tether's agents there, get live progress, and approve ships from their phone. Everything runs on your Mac while Tether runs (long polling, no server, no public URL).

**Set up once:**

1. In Telegram, open @BotFather, send `/newbot`, and copy the token it gives you.
2. Settings → Accounts → **Telegram**: paste the token and press Connect. Tether checks it with Telegram and keeps it in your Keychain; nothing else stores it.
3. Press **Link my Telegram** and send the `/iam <code>` it shows to your bot in a private chat (within 10 minutes). From then on your Telegram account is you: you can approve and start runs in every Telegram squad.
4. Optional, for voice notes: **Voice notes: download model (~241 MB)**. The model (SenseVoice, INT8) is checked against pinned hashes and kept in `<home>/models/sensevoice/`. Voice notes are decoded with the Mac's own `afconvert` (`ffmpeg` elsewhere) and transcribed on this machine: the audio never leaves it.

**Make a squad:** New squad (+ beside Squads) → **Telegram group**. Once it is made, the squad shows a one-time pairing code. Add the bot to your group, make it an **admin** (it needs that to pin the live status and to see every message; or turn privacy off with BotFather's `/setprivacy`), and send `/pair <code>` in the group.

**In the group:**

- @mention an agent (`@Bolt fix the Back button`) or reply to an agent's message: the same squad rules as a Tether squad (an answer, a run and its ticket, recurring work, a review, a merge), within the squad's daily limits. Replies come labelled with the agent's name, in the squad voice: the agent's sentence and one line of What I did (files, +/−, the commands and their results), never its raw report.
- Run progress and decisions are edited in place (at most one edit every 3 s per message). One pinned message shows what is running, what needs you and today's spend.
- Cards have buttons: **Ship it / Not yet / Diff** on ship cards (then how the ship went: the PR open, merged, or why not), **Approve / Reject** on plans, **Start run / Edit / Dismiss** on proposals (Edit asks you to reply with the task as it should run).
- `/status`, `/runs` (the last 5, with their PR links), `/new <task>` (a run on the agent it names, else the squad's first), `/mute 1h` (or `30m`, up to 24 h, or `off`: holds back everything but approvals and proposals).
- A photo goes to the agent when its model reads images (Claude, or an OpenRouter model tagged for images); otherwise the agent gets the caption and the group is told.
- A voice note is transcribed, echoed as "Voice: …", then handled like typed text. Until the model is downloaded the group is told so.

**People and permissions** (the squad's header): everyone in the group can chat and @mention agents and appears as they speak or join. Per person, two switches, both off for new people: **Approver** (approve, reject, ask for a merge) and **Can start runs** (runs, loops and `/new`). Without it, an ask becomes a proposal card that an allowed person starts, and the asker is told why once. You always have both. Agents and other Telegram bots never approve; an agent starts runs only through a person who may.

**Safety:** Tether acts only on the linked group (an unlinked group may only `/pair`, a private chat only `/iam`); every other update is dropped and logged by id only. Every approval asked in a Telegram squad also lands in your Inbox and Home "Needs you"; deciding in either place settles both, and a second press is told who decided first. The Tether room of a Telegram squad is a read-only mirror. Disconnecting removes the token from the Keychain and stops listening; squads keep their group link for later.

API (loopback): `POST /api/accounts/telegram { token }`, `DELETE /api/accounts/telegram`, `GET /api/telegram`, `POST /api/telegram/iam`, `POST /api/telegram/voice`, `POST /api/squads/:id/pair`, `PATCH /api/squads/:id/people/:person { approver?, canStartRuns? }`, `DELETE /api/squads/:id/people/:person` (the `/api/teams/…` paths answer too, for one release).

## Deleting runs

In the Runs tab press `D` on a run (or `D` inside the run) and confirm: the run's history, worktree, `aorch/<id>` branch and its chat are removed. A live run must be stopped first. From the shell: `tether delete <runId>…` (add `--keep-work` to keep the branch and files), or `tether delete all --finished` to clear every done or failed run. The dashboard API has `DELETE /api/runs/:id`.
