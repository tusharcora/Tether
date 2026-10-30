# Ports from deepseek-harness: design

Date: 2026-10-29 · Branch: `feature/dsh-ports` (from main 29b66d4) · Source: deepseek-harness (`/Users/tushar/Documents/PROJECTS/deepseek-harness/deepseek-harness/packages`, MIT, © 2026 DeepSeek).

## 1. Intent

The owner asked to port as many **working** parts of deepseek-harness (dsh) into Tether as fit. dsh packages run inside dsh's own runtime (DI, event log, host/client faces), so a port **re-implements each package's logic against Tether's code**, keeping its algorithm, constants and tests, not its plumbing.

Key constraint: Tether has one in-process tool loop, `OpenAICompatAdapter.run` in `src/adapters/openai.ts` (OpenRouter, NVIDIA, local models). claude and codex run their own loops (`src/adapters/claude.ts`, `cli.ts`); the one shared choke point that reaches them is Code Mode's `run_code` (`src/codemode/session.ts`, output capped at ~l.147 via `LIMITS` in `sandbox.ts`).

## 2. What gets ported (this build, in order)

1. **Tool-result pruner** (dsh `compaction/compaction-tool-result-pruner`: `src/index.ts`, `src/config.ts`; test `tool-result-pruner.spec.ts`). Model-free: before each model call in `openai.ts`, tool results older than the latest turn and longer than 8192 chars are cut to head + tail with an omission marker stating how many chars were dropped. Keep dsh's thresholds. New `src/adapters/prune.ts`.
2. **Repeat-call reminder** (dsh `guard/repeat-tool-reminder`: `src/index.ts`; test `repeat-tool-reminder.spec.ts`). Counts consecutive identical tool calls (name + deep-key-sorted JSON args); at 3, 5 and 8 repeats appends dsh's reminder text to that tool result. Never blocks. Wired into the `openai.ts` tool loop. New `src/adapters/repeatGuard.ts`.
3. **Spill for oversized tool output** (dsh `spill/spill-policy` `src/index.ts`, `retention.ts`, `notice.ts`; `spill/spill-local` `src/store.ts`; tests `retention.spec.ts`, relevant parts of `spill-policy.spec.ts`). Where `run_code` output is truncated today, write the full output to `<worktree or workspace>/.tether/spill/<id>.txt` (0600), return head + tail + a notice naming the path and how to read it with `repo.read`. Add `.tether/` to the run worktree's `.git/info/exclude` so spills never appear in diffs. Sweep spill files older than 24 h on server start and run end (dsh retention rules). Reaches claude, codex and openai.ts (all use `run_code`). New `src/codemode/spill.ts`.
4. **Browser MCP presets** (dsh `experimental/browser-use-playwright-mcp`, `browser-use-chrome-devtools-mcp`). Two presets in `src/codemode/mcpServers.ts`: `playwright` (`npx -y @playwright/mcp@<pinned>`) and `chrome-devtools` (`npx -y chrome-devtools-mcp@<pinned>`), using dsh's pinned versions. Off by default; enabled from the existing MCP servers UI, then available to every agent as `mcp.<name>` connectors. No npm dependency.
5. **GitHub issue and comment triggers** (dsh `webhook/webhook-github` `handler.ts`, `body.ts`; test `handler.spec.ts`). `src/server.ts` (~l.307-324) accepts `issues` (opened, labeled) and `issue_comment` (created) besides `pull_request`, after Tether's existing HMAC check. `src/pr.ts` gets `parseIssue`/`parseComment`; `src/triggers.ts` rules gain `on: 'pr' | 'issue' | 'comment'` (default `pr`, existing rules unchanged), optional `label` (issues) and `mention` (comments, default `@tether`). An issue/comment run's task is the issue title + body (or the comment text) with a link; it records a delivery like PR runs. The Triggers screen gets the new kinds in its create form.
6. **Cron triggers** (dsh `schedule/schedule` `domain.ts`: `cronField*`, `parseCronInput`, next-fire; test `cron.spec.ts`). New `src/schedules.ts`: schedules `{ id, name, cron, workspace, target: { kind: 'workflow', workflow, task } | { kind: 'goal', goalId }, enabled, lastRunAt?, lastRunId?, lastError? }` stored under `<home>/schedules.json` (0600). A ticker (every 30 s while the server runs) starts what is due through `engine.start` / the goals loop; missed fires while the app was closed run **once** on start (dsh's catch-up rule, my call). Next-fire in **local time** with `Intl`; no Temporal dependency (DST edge: a fire in a skipped hour runs at the next valid minute; a repeated hour fires once — document it in the code). Routes `GET/POST/PATCH/DELETE /api/schedules`, plus `POST /api/schedules/:id/run` (run now). Web: a **Schedules** section on the Triggers screen (list with next fire, on/off, Run now, create form with a cron field plus presets: every night 02:00, weekdays 09:00, Mondays 09:00, hourly). Runs started by a schedule carry `origin: { kind: 'schedule', id }` when the run origin field exists (`feature/asks-goals-runs` adds it; if absent, skip).

## 3. Not ported, and why (state these to the owner)

- **hooks-claude-code / hooks-codex / hook-protocol**: later. The claude and codex CLIs already run the user's own hooks; only `openai.ts` would gain them, and its tool names don't match hook matchers.
- **sandbox-local / sandbox-policy** (Seatbelt): later. Wrapping claude/codex breaks their access to `~/.claude` and the network; worth doing for Tether's own approved shell commands next.
- **auto-review**: later (needs a shell tool in `openai.ts` to be useful).
- **lsp-stdio / tool-lsp**: later (~900 lines; best as a Code Mode `lsp.*` connector).
- **speech-to-text**: later (needs a transcription key and a MediaRecorder composer path; ties into the Telegram voice-note decision).
- **todo/tool-todo**: later (openai.ts only).
- **timeout-policy, plan-mode, compaction-basic, image-offload, jobs**: skipped; Tether already has the equivalent (`codemode/sandbox.ts` wallMs and `AbortSignal.timeout`; claude `--permission-mode plan` + `PlanCard`; `assistant/compact.ts`; no images in loops; no shell in `openai.ts`).

## 4. Constraints

1. Each ported file starts with a one-line provenance comment: `// Ported from deepseek-harness <package> (MIT, © 2026 DeepSeek).` Add a `THIRD_PARTY_NOTICES.md` (or extend the existing notices) with the dsh MIT license text.
2. Port the dsh tests listed above as vitest tests next to the new files, adapted to Tether's API; keep their cases.
3. No new npm dependencies.
4. Inputs validated at every new route (cron syntax, ids, enums → 400). Schedule and spill files 0600. No secrets in logs or responses.
5. Tests use temp homes only, never the real `~/.aorch`. `npm run check` (typecheck, tests, build) must pass.
6. English only in docs and UI copy. Add a short section to `docs/reference.md` for schedules, issue/comment triggers, spill and the browser presets.

## 5. Left to the builder

File layout, how the ticker is started/stopped with the server, the exact Triggers screen layout (match existing Triggers styling), and the pinned MCP versions (take dsh's).
