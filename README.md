# aorch

A durable orchestrator for CLI coding agents. It runs workflows of agents (Claude Code, Codex, OpenCode, local models) in isolated git worktrees, checks their work with gates, and keeps every run as an append-only event log you can resume.

- **Terminal UI** (`aorch tui`): dashboard of runs and workflows, a run view with live activity lines and metrics, step sessions you can attach to, a diff viewer, a workflow editor, settings and a theme editor.
- **Web dashboard** (`aorch serve`): visual workflow builder, run timeline, knowledge graph of your Obsidian-style vault, and a Crew tab for linking bots to models.
- **Crew**: Maestro (orchestrator), Scout, Brick, Bolt, Probe, Lens and Gate. Link any bot to any agent and model, local ones included.
- **Maestro supervisor**: on failure, retries, then escalates the failing step to a stronger model, then stops and explains.

## Terminal UI tips

- **Ctrl-K** opens the command palette: jump to a tab, open a run, edit or run a workflow, link a bot, change settings, or run a skill. Type to filter.
- **Mouse**: click tabs, rows and bots (click a selected row again to open it), wheel to scroll, right-click to go back. Turn it off in Settings if you prefer to select text (or hold shift while dragging).
- **Skills**: `aorch skills` lists them; `aorch skills run <name> --task "…"` runs one. Two kinds: built-in or custom aorch workflows (JSON in `<home>/skills/`, e.g. `{"name":"my-skill","description":"…","steps":[{"role":"coder","prompt":"…"},{"role":"tester"}]}`), and Claude Code skills found in `~/.claude/skills` and `<repo>/.claude/skills`. A Claude Code skill runs inside a Claude agent step that is told to invoke it by name. In the workflow editor press `k` to add either kind.
- **Reactions**: bots cheer when a step passes, shudder when one fails, and a baton slides along the arrow when work is handed on. Maestro shows ↻ or ⇧ on a step it retries or escalates. Turn it off in Settings.
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

`aorch orchestrate "<task>" --repo <dir>` asks Maestro to design a workflow for a task. `aorch run <pipeline.json> --repo <dir> --task "<task>"` runs a saved one. `aorch --help` lists everything.

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

Rules can limit by `--labels`, `--events`, and opt in to `--drafts` and `--forks`. Each PR runs once per commit. PR text is passed to agents fenced as data, and a workflow that executes commands (a test gate or setup step) refuses fork PRs unless you pass `--trust-code`. `aorch serve` stays loopback-only; only the webhook path accepts outside hosts, and it needs the HMAC signature. Azure DevOps and AWS CodeCommit links are recognised but not wired up yet.

## Bots asking each other

A step can ask a step that already finished: why it did something, or about a bug it may have caused. It ends its answer with `@ASK <step-id>: <question>`; aorch puts the question to that step (read-only, resuming its own session when the agent supports it), then gives the answer back so the asker finishes. At most 2 questions per round, 2 rounds, billed to the asker, and every exchange is logged as a `consult` event (shown in `aorch run`, the run's event list, and as a `?` / `…` mark over the two bots in the strip). Turn it on per workflow with `"settings": { "consult": 2 }` (new workflows have it on; `0` or leaving it out turns it off). Fix loops use it too: the fixing step can ask the reviewer that sent it back.

## Teams: a manager hands out work

A `manager` step plans the work and hands pieces to other bots at run time, then reviews what comes back. It is read-only: it coordinates and never edits files. The `team` workflow (`manager → tests → review → approve`, tests only when the repo has a test command) is the quickest way to try it; you can also add a manager step to any workflow by hand. Maestro does not propose manager steps.

The manager replies with a plan, `{"tasks":[…]}`. Each task is a hand-off contract:

- `to`: the bot or role that gets the work (the manager's `roster`, or any bot except gates, approvals and managers)
- `goal`: what to do; `expected`: what done looks like
- `context`: ids of finished steps whose output the receiver needs
- `mode`: `read` (default) or `write`; write tasks may edit files in the run worktree. Write tasks are only accepted when the workflow sets `allowWrites: true` in its `settings` (the `team` workflow does; a plan with write tasks otherwise goes back to the manager with the reason), they can only go to bots that edit files (not planners, reviewers or other read-only bots), and they still pause for your approval by default (see `planApproval` below)
- `after`: ids of tasks in the same plan that must finish first (tasks without `after` run in parallel)

A spawned step is the receiving bot's usual step (its persona, read-only setting, and for reviewers the diff and `VERDICT` line) with the contract on top. The manager sees the task, its own instructions and guidance, the project context, the output of the steps before it, and the list of steps in the run. A plan holds at most 12 tasks; goals and expected results are capped at 500 characters and `context` at 10 step ids.

Spawned steps show up under their manager in the run view, `aorch show` and the run board, marked `↳` with the receiving bot's name, and open like any other step. After they finish the manager reviews the results and replies `{"decision":"accept"}`, `{"redo":[…]}` (send some back) or `{"more":[…]}` (plan more work).

Limits live in the workflow's `settings`: `allowWrites` (managers may hand out write tasks, default off), `maxDepth` (how deep managers may nest, default 3, 1 to 5; it only matters once managers can nest, planned for stage 2, since spawned steps today are always at depth 1), `maxSpawn` (steps spawned per run, default 12, 1 to 30) and `planApproval` (the manager's plan must be approved before anything is spawned). Unless you set `planApproval` yourself, a plan that includes write tasks pauses for approval (`planApproval: false` turns that off). Redos count against `maxSpawn`, and the run's cost cap and wall-clock limit apply to everything a manager spawns, including the manager's own plan and review calls.

In this first stage the `team` workflow has no automatic fix loop for the tests or the reviewer after the manager: if they fail, the run ends as an error, and you retry or resume it (`aorch resume`, or Retry in the run chat). Feeding such a failure back into the manager's review is planned. A pull request from a fork is refused for any workflow with a manager step unless you pass `--trust-code`, because spawned steps may run and edit code.

Worker-to-worker hand-offs (`@HAND`, a step passing work straight to another step) are the next stage and are not part of this release.

## Crew styles

The crew can be drawn five ways. Switch with `aorch crew <style>`, `--crew <style>` / `AORCH_CREW` for one run, `c` in the dashboard, or the picker at the top of the Crew tab in the web dashboard.

| style | what a bot looks like | good for |
| --- | --- | --- |
| `pebble` | the pixel family (default), fully customisable | everyone |
| `classic` | the original visor bots (built-in crew only) | nostalgia |
| `sigil` | the glyph alone, drawn in 6×6 pixels: hollow when idle, solid with a light band when working | engineers, tmux, SSH |
| `tile` | the sigil's inverse: a rounded coloured tile with the glyph cut out of it and a status light in the corner | app-icon lovers |
| `ticker` | a three-letter symbol chip, a stance arrow and a sparkline | traders, the Trading desk |
| `orbit` | two initials in a small ring; a lit arc runs round it while the bot works | shared dashboards |

The mark styles (`sigil`, `tile`, `ticker`, `orbit`) are derived from the bot, so custom bots work with no extra setup: the glyph comes from the bot's id, the symbol and initials from its name, the colour from its look. Every mark fits in four rows and sits in the same 4×10 slot a pixel bot uses and a 5-column mini mark in lists, so no screen changes layout when you switch. The bot editor still edits the pixel look, which `pebble` uses.

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

Slash commands: `/status`, `/approve` `/reject` `/retry` `/resume`, `/open` `/chat [run]`, `/sessions` `/main`, `/runs` `/workflows` `/crew` `/settings` to switch screen, `/run <workflow> <task>`, `/providers`, `/clear`, `/help`, `/quit`. Every other question aorch asks (names, paths, colours) is also typed on the line at the bottom of the screen.

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
