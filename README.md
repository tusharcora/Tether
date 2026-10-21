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

Slash commands: `/runs` `/workflows` `/crew` `/settings` switch screen, `/run <workflow> <task>` starts a workflow, `/approve` and `/reject` answer a run that is waiting for you, `/providers`, `/clear`, `/help`, `/quit`. Every other question aorch asks (names, paths, colours) is also typed on the line at the bottom of the screen.

## LLM providers

Settings → **LLM providers** lists every agent and model server aorch can use (installed? reachable? which models?) and adds new ones: DeepSeek, OpenAI, OpenRouter, Groq, Together, Fireworks, or any OpenAI-compatible URL. The same from the shell: `aorch providers`, `aorch providers add deepseek`, `aorch providers add --name mybox --url https://host/v1 --key-env MYBOX_KEY`, `aorch providers remove mybox`. Keys are never stored: you give the *name* of the environment variable that holds the key. Link a provider's model to a bot in the Crew tab.

### Usage and spend (Experiential Labs)

Providers on `experientiallabs.ai` also expose a Spend API, read with the same API key you added the provider with:

```
aorch usage                      # last 7 days: all-in spend, tokens, per model
aorch usage --days 30 --by key   # group by key, member, app, provider…
```

The same view is in Settings → LLM providers → the provider → Usage and spend. The organisation id is read from `/api/whoami`; set it by hand with `aorch providers org-id <name> <id>` if that fails. If the key needs to differ for usage, `aorch providers usage-key <name> <ENV_VAR>` sets an override. All-in spend is paid + BYOK + free; money is kept as exact integers (nano-USD) and shown to the cent, and a report with unknown provider accounting is marked provisional.
