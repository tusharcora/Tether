# Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the known risks stages 1 and 2 left, before stage 3 builds on them. This is the bottom PR of the stack that later carries stages 3 to 6.

**Architecture:** Each task is a separate fix with its own test. No new subsystem. Landing work keeps stage 1's one-base rule in `landingBase` (`src/runShip.ts`) and `landBranch` (`src/history.ts`), and adds no per-path baselines.

**Tech Stack:** TypeScript (ESM), Node 22 locally and Node 24 in CI (Linux), vitest, React in `web/`.

**Spec:** `docs/superpowers/specs/2026-11-01-agent-first-design.md` §6.4 and §6.9; the owner's answers of 2026-11-02 and 2026-11-03 (Preview asks for trust; Codex keeps its sandbox); the known-limits list in `docs/HANDOFF.md`.

## Global Constraints

- Plain folders show no git words: no branch, merge, PR, commit or repository.
- A chat turn stays read-only.
- Trust notice, verbatim: **Trust this folder?** "Agents can run commands here, like tests and installs. Undo restores files, but it can't reverse everything a command does. Some things always stop and ask first. Files in a downloaded project can try to steer an agent, so only trust folders you know."
- Real repos behave as today unless a person's choice says otherwise. Nothing pushes by surprise.
- Every failure a person can see is plain text, with no home path.
- Tests must pass on macOS and Linux. Test folders sit in the system temp folder, outside any git repo.
- No model tokens in tests.

## Review Focus

1. A file a person edits while landing is in progress must stop that landing and name the file, never be overwritten. (Task 3)
2. A file name that differs only by Unicode form (NFC vs NFD) or by case must land and Undo without deleting either version. (Task 3)
3. A folder answered "Not now" must not let OpenCode or a custom agent start there. (Task 1)
4. Preview in a folder that isn't trusted must not run the project's own script before the person says yes. (Task 4)
5. A full test run must leave no worktree or branch behind in the developer's repo. (Task 6)

---

### Task 1: Agents with their own shell need a trusted folder

**Files:**
- Modify: `src/assistant/routes.ts`, `src/assistant/turn.ts`, `web/src/assistant/RouteCard.tsx`
- Test: `test/assistant-route.test.ts`, `web/src/assistant/cards.test.tsx`

**Interfaces:**
- Consumes: `CliAdapter.ownShell` (`src/adapters/cli.ts:45`), `trustState`.
- Produces: `POST /api/assistant/routes/:id` answers 409 `{ needsTrust: true, folder, ownShell: true }` for a route whose agent is OpenCode or a custom CLI agent when the folder isn't `trusted`, including with `trust: false`. Codex is exempt: it keeps its folder sandbox.

- [ ] **Step 1: Write the failing tests**: `an OpenCode route in an unknown folder asks for trust and Not now doesn't start it`; `a Codex route keeps today's Not now`; the card shows "This agent runs commands on its own, so it needs this folder trusted." with **Trust** and no **Not now**.
- [ ] **Step 2: Run them and see them fail.** `npx vitest run test/assistant-route.test.ts web/src/assistant/cards.test.tsx`
- [ ] **Step 3: Implement** by resolving each route's agent through the registry, the same way the run will.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** "OpenCode and custom agents need a trusted folder"

### Task 2: Claude's process doesn't carry Tether's secrets

**Files:**
- Modify: `src/adapters/claude.ts`, `src/permissions.ts` (export the existing name and value patterns)
- Test: `test/openrouter-adapter.test.ts` or the fake-claude adapter test that already checks `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`

**Interfaces:**
- Produces: `claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv`, which drops names and values matching the scrub's secret patterns, except names starting `ANTHROPIC_` or `CLAUDE_` and the variables Claude Code reads to log in. It applies to every Claude step with `commands`.

- [ ] **Step 1: Write the failing test**: with `GITHUB_TOKEN`, `MY_SECRET` and `DATABASE_URL=postgres://u:p@h/d` set, the fake claude sees none of them, while it still sees `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, `PATH`, `HOME` and `SSH_AUTH_SOCK`.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement** `claudeEnv`, and pass it to `runProcess` when `commands` is set.
- [ ] **Step 4: Run it and see it pass**, then one real `claude -p` check on haiku in a temp folder, which the owner has approved: an exported `GITHUB_TOKEN=x` prints empty from Bash. Put the command and output in the report.
- [ ] **Step 5: Commit** "Claude's commands get no secrets from Tether's environment"

### Task 3: An agent's work always lands

**Files:**
- Modify: the step commit in the hidden worktree (`src/git.ts` or `src/history.ts`; find where a plain run's step is committed), `src/runShip.ts` only for the message
- Test: `test/history-land.test.ts`, `test/solo.test.ts`

**Interfaces:**
- Produces: in a plain folder, a step commit includes files under paths the folder's `.gitignore` ignores, and case-only renames, except the names stage 1 leaves out at any depth (`node_modules`, `.venv`, `venv`, `__pycache__`, `.DS_Store`). A run that wrote only left-out files says which, in plain words, for example "It changed node_modules, which Undo can't restore, so it wasn't put in your folder." Real repos are unchanged.

- [ ] **Step 1: Write the failing tests**, each landing and then Undoing:
  - `out/report.txt` with `.gitignore` containing `out/`;
  - a case-only rename `Readme.md` to `README.md`;
  - an NFC name renamed to its NFD form on macOS; the NFD-to-Undo case deletes the file today;
  - a run that changes only `node_modules/x`, which names it and lands nothing;
  - a person's edit to a landed file during landing, which stops and names it.
- [ ] **Step 2: Run them and see them fail.** `npx vitest run test/history-land.test.ts test/solo.test.ts`
- [ ] **Step 3: Implement** with `add -f` of the run's own changed paths, as stage 1's snapshot does. Snapshots already pass the explicit list on stdin, so reuse that. Don't use `add -A`. Get case and Unicode-form renames from the filesystem, not git's `core.ignorecase` guess.
- [ ] **Step 4: Run them and see them pass**, on macOS and in a Linux `node:24` container if Docker is available.
- [ ] **Step 5: Commit** "A plain folder gets all of an agent's work, and is told what was left out"

### Task 4: Preview asks before running the project's script

**Files:**
- Modify: `src/runProcs.ts` (`preview`), its route in `src/server.ts`, and the run page's Preview button and dialog in `web/src/runs/`
- Test: `test/run-procs.test.ts`, the run page's test

**Interfaces:**
- Consumes: `trustState`, and the trust dialog component from Task 6 of stage 2.
- Produces: starting a preview in a folder that isn't `trusted` answers 409 `{ needsTrust: true, folder }`. With `trust: true` it saves the answer and starts. With Not now it doesn't start, and says why. Terminal is unchanged.

- [ ] **Step 1: Write the failing tests**: in an unknown folder, the `dev` script doesn't run (a marker file is absent) and the dialog appears with the verbatim notice; Trust starts it; a trusted folder starts it straight away.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** "Preview asks Trust this folder? before running the project's script"

### Task 5: The card tells the truth after a yes

**Files:**
- Modify: `web/src/assistant/RouteCard.tsx`
- Test: `web/src/assistant/cards.test.tsx`

**Interfaces:**
- Produces: the "ran without commands, so this wasn't checked" line shows only while the run's gates and setup are still unrun for that reason. After a yes, a resume and a passing gate, it's gone. The "can't run commands" line follows the folder's current trust.

- [ ] **Step 1: Write the failing test** `after a yes and a resume with a passing gate, the card no longer says it wasn't checked`.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement** from the run's node states, which already carry the trust stop text.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Commit** "A card stops saying not checked once the check ran"

### Task 6: Tests that can be trusted

**Files:**
- Modify: `src/codeSearch.ts` or `test/code-save-search.test.ts`; the test that leaks a worktree into the developer's repo; `web/src/hooks.test.tsx`
- Test: those files

- [ ] **Step 1: Find the leak.** Record `git worktree list` before and after each test file, and find the file whose run adds an entry. Fix it so the test makes its repo in the system temp folder and removes it.
- [ ] **Step 2: Search race.** ripgrep stops at 200 hits in its own order, so a file with many matches can push others out. Make the result deterministic in the product: a file's matches past a fair share don't push out other files, and README.md is found while `many.txt` holds 250 matches. Keep the 200 cap. Run the test 50 times with no failure.
- [ ] **Step 3: `web/src/hooks.test.tsx` "ignores browser moves…"** fails under load with `expected '#/graph' to be '#/api'`. Find the cause, fix it, and run it 50 times under CPU load.
- [ ] **Step 4: Remove the leaked entries.** List `git worktree list` entries whose path is under the system temp folder and whose branch is `aorch/*`. Check each has no commits that aren't on another ref. Remove those with `git worktree remove` and `git branch -D`, and report the count. Leave everything else alone.
- [ ] **Step 5: Commit** "Tests leave the repo as they found it, and search results don't depend on order"

### Task 7: Docs and the whole check

**Files:**
- Modify: `README.md`, `docs/HANDOFF.md`, `docs/superpowers/handoffs/2026-11-02-agent-first.md`

- [ ] **Step 1: Update the docs.** Remove the limits fixed here; keep the rest; say that hardening is the stack's bottom PR and stage 3 comes next.
- [ ] **Step 2: Run the whole check.** `npm run typecheck && npm run build && npx vitest run --testTimeout=30000`, then push, open the PR against `main`, and wait for CI on Linux.
- [ ] **Step 3: Commit** "Docs: what hardening fixed, and what's left"
