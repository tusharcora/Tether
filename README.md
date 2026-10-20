# Aorch

A durable orchestrator for CLI coding agents. It runs workflows of agents (Claude Code, Codex, OpenCode, local models) in isolated git worktrees, checks their work with gates, and keeps every run as an append-only event log you can resume.

<img width="571" height="172" alt="Screenshot 2026-10-20 at 5 18 16 PM" src="https://github.com/user-attachments/assets/9e37b47d-e747-436e-9db3-85c2d23e6266" />

<img width="574" height="350" alt="Screenshot 2026-10-20 at 5 22 11 PM" src="https://github.com/user-attachments/assets/79723750-2bdf-4976-b9f4-783ecc2e6cdd" />

- **Terminal UI** (`aorch tui`): dashboard of runs and workflows, a run view with live activity lines and metrics, step sessions you can attach to, a diff viewer, a workflow editor, settings and a theme editor.
- **Web dashboard** (`aorch serve`): visual workflow builder, run timeline, knowledge graph of your Obsidian-style vault, and a Crew tab for linking bots to models.
- **Crew**: Maestro (orchestrator), Scout, Brick, Bolt, Probe, Lens and Gate. Link any bot to any agent and model, local ones included.
- **Maestro supervisor**: on failure, retries, then escalates the failing step to a stronger model, then stops and explains.

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
