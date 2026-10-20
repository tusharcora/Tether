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
