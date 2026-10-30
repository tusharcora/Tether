# Rewind, try more ways, Terminal and Preview: design

Date: 2026-10-30 · Branch: `feature/rewind-attempts` (from main 2c4de49) · Mockup: canvas `WvgbPqG6rR4MaPwD7BUviV`. Boards 5 "Try more ways: compare attempts" and 6 "Run page: rewind, Terminal and Preview" (copied to `docs/design/next-build/`); board 4 (`docs/design/asks-goals-runs/RunDetail.dc.html`) and board 1 (`Main.dc.html`, the Goals side panel) for context. Follows `2026-10-29-asks-goals-runs-design.md` (merged in PR #27), whose §3 deferred these items.

## 1. Intent

Make trying things feel safe and cheap: undo a run back to any step, try the same task several ways at once and pick the best, and check the result without leaving Tether (a command console and a live preview of the app inside the run's worktree). These are the features the owner liked most from other harnesses (Claude Code `/rewind`, Codex/Cursor parallel attempts, Claude Code desktop preview).

## 2. Goals

1. **Rewind** a run to before any finished step: the run's branch goes back to that step's base commit, that step and everything after it return to `queued`, and the run can resume from there (board 6, step ⋯ menu).
2. **Fork** from after any finished step: a new run with the same task and workflow starting from that step's commit (`engine.start({ ref })`), linked to its parent.
3. **Try more ways** (best-of-N): from a run's header ("Try 2 more ways") or the goal card, start N (1–4) sibling runs of the same task on different agents/models, grouped as one **attempt set**. A **Compare** page (board 5) lists them side by side and **Pick X and ship** ships that one and closes the rest.
4. **Terminal tab** on the run page: run a command in the run's worktree and stream its output (board 6). Non-interactive (no PTY): each command is a child process; Ctrl+C / Stop kills it; history with ↑.
5. **Preview tab/pane**: start the project's dev command in the worktree, detect the URL from its output, and show it in an embedded view with reload / open-in-browser / stop (board 6).
6. **Goals side panel** next to a chat (board 1's "Goals · next"): the project's open goals, the chat's own goal highlighted.
7. Update `docs/HANDOFF.md` for PRs #26, #27 and this build.

## 3. Non-goals

- An interactive PTY terminal (needs `node-pty`, a native dependency): later. The console is my call for now.
- Rewinding team runs mid-plan (planning, questions): rewind applies to steps with a commit; team runs may rewind their worker steps only.
- Rewinding chat history (Tether chats keep their own edit/undo).
- Automatically choosing and shipping the best attempt without the owner.

## 4. Anti-goals

- Losing work silently: rewind keeps the discarded commits reachable (a `tether/rewind/<run>/<n>` ref) so a rewind can be undone; the UI says so.
- Commands or dev servers outliving the run or the app: every process started by Terminal/Preview is tracked and killed on run delete, app quit and Stop.
- A command running outside the run's worktree, or reachable from anything but the loopback app (the existing Host/Origin checks apply).
- Attempt sets blowing past limits: each sibling counts toward the goal's/team's limits like any run.

## 5. What exists (reuse)

- Engine (`src/engine.ts`): worktree per run (`createWorktree(repo, home, runId, ref)` in `src/git.ts`), a commit per writing step attempt (`commitAll`, the node state's `commit`), `resume`, `sendBack`, `StartInput.ref`, `origin`.
- Run page (`web/src/runs/*`, rebuilt in PR #27): story rows, step tabs, decision banner, `POST /api/runs/:id/ship` (`RunShip`).
- Goals (`src/goals/*`), proposal/goal card (`web/src/assistant/taskCards.tsx`), Runs page grouping (`web/src/runs/RunList.tsx`).
- Process helpers: `src/proc.ts`, `src/exec.ts`; Code Mode sandbox limits for output caps (`src/codemode/sandbox.ts` LIMITS); spill (`src/codemode/spill.ts`) for oversized output.

## 6. Design

### 6.1 Rewind and fork (server)

- Each node state records `base` (the worktree HEAD when the step started) alongside its `commit`. Old runs without `base`: use the previous finished step's `commit`, else the run's start ref.
- `POST /api/runs/:id/rewind { node }`: only when the run is not live (stop it first; the UI offers Stop & rewind). Saves the current HEAD as `refs/tether/rewind/<run>/<n>`, `git reset --hard <base>` in the worktree (and removes untracked files the steps created), sets `node` and every node after it (topological order) to `queued` with attempts/costs kept in history but not counted as current, appends a `rewound` event, and leaves the run `stopped` so **Resume** carries on. Spent cost stays spent.
- `POST /api/runs/:id/rewind/undo`: restores the last rewind ref while nothing has run since; otherwise 409.
- `POST /api/runs/:id/fork { node }`: starts a new run with the same pipeline, task and workspace, `ref = node's commit`, nodes up to and including `node` marked `done` (skipped as "from parent"), `origin: { kind: 'fork', id: <parent>, node }`. Returns the new run.

### 6.2 Try more ways (server)

- `RunState.attemptSet?: string` (shared id) and `attemptLabel?: 'A' | 'B' | ...`. The first run becomes A when a set is made from it.
- `POST /api/runs/:id/attempts { count: 1-4, agents?: { agent, model? }[] }`: starts `count` sibling runs (same task, pipeline, workspace, start ref as the original's start) with the agent steps overridden (`applyOverrides` in `src/triggers.ts`). Default picks: other configured agents/models the owner has, free models first, never the same binding twice. Siblings get `origin` of the original. Within a goal, each sibling is a goal run item.
- `GET /api/attempts/:set`: the set's runs with check result, diff stats, cost, duration, reviewer verdict (last review step's one-line summary), and Tether's pick: passes the check → fewer failing tests → smaller diff → lower cost (my call; shown as a chip, never auto-shipped).
- `POST /api/attempts/:set/pick { run }`: ships that run (the existing `RunShip` path, same approver rules) and stops the others still live; their branches are kept 7 days then removed by the existing worktree cleanup (or a sweep added to it).

### 6.3 Terminal and Preview (server)

- `src/runProcs.ts`: per-run process registry. `POST /api/runs/:id/exec { command }` spawns `sh -lc <command>` with `cwd` = the run's worktree, a clean env (the user's PATH, no Tether secrets), streams stdout/stderr as events over the run's existing stream (`proc-output` chunks, capped per command; bigger output spilled), ends with exit code and duration. One command at a time per run; `POST /api/runs/:id/exec/stop` kills the process group. History kept per run (last 50 commands).
- Preview: `POST /api/runs/:id/preview { command? }` starts the dev command (default: `package.json` `dev`, else `start`, else 400 asking for one) with `PORT` set to a free port; the URL is the first `http://localhost:<port>` / `127.0.0.1` seen in its output (or the assigned port after 20 s). `GET` returns `{ status, url, command }`; `DELETE` stops it. Only loopback URLs are shown.
- All processes are killed on run delete, server stop and app quit; on start, any leftover recorded pids are cleared.
- Both routes are local-only (existing Host/Origin checks), validate `command` (non-empty, ≤ 2000 chars, no NUL), and refuse runs whose worktree is gone.

### 6.4 Web

- **Story rows** (run page left column): a ⋯ menu per finished step with "Rewind to before this step" (confirm dialog: "Undo <step> and everything after? You can undo the rewind until the run moves on.") and "Fork from after this step"; after a rewind, a banner "Rewound to before <step> · Undo · Resume".
- **Header**: "Try 2 more ways" (opens a small picker: count 1–4 and which agents/models, defaults pre-filled). Runs in a set show "Attempt A of 3 · Compare".
- **Compare page** (`#/attempts/<set>`, board 5): one column per attempt: face, agent · model, check, the goal's metric when the check prints one (else omit), changes, cost · time, review line, a short diff excerpt, **Pick X and ship** / Open; failed attempts dimmed with Retry. "Try 1 more way" adds a sibling. On the Runs page a set is one row with a "best of N" chip and stacked step tracks (as board 3).
- **Terminal tab** (board 6): output area (monospace, auto-scroll unless the user scrolled up), command input with ↑/↓ history, Stop, exit code · duration lines, the worktree path and branch in the tab header.
- **Preview tab / pane** (board 6): opens as a side pane on wide screens and a tab on narrow ones: URL bar (read-only), reload, open in browser, Stop, the command and its status line, the page in an `<iframe>` (Electron: a sandboxed `webview` if iframes are blocked; builder's call). "Start preview" empty state with the detected command.
- **Goals side panel** next to a chat (board 1): open goals of the project, the chat's own goal highlighted with its team faces and "from this chat", "All goals" link; collapsible, remembered per window.

## 7. Constraints

1. Follow boards 5 and 6 (and 4 for the run page frame): layout, copy, tokens, Geist; no new colours or fonts.
2. No new npm dependencies.
3. Accessibility: menus keyboard-operable, confirm dialogs focus-trapped, icon buttons labelled, live output in an `aria-live="polite"` region only for exit lines (not every chunk).
4. Tests: rewind (reset, queued nodes, undo, refusal while live, old runs without `base`), fork (ref + done-from-parent), attempts (count limits, override, pick ships and stops the rest, pick ranking), runProcs (spawn in worktree, stop kills group, cleanup on delete, env has no secrets), preview URL detection, Compare page, Terminal tab, story-row menu, Goals panel. Temp homes only. `npm run check` passes (known flaky: `evolve.test.ts` timeouts under load).
5. Commit messages and PRs: no AI attribution.

## 8. Left to the builder

File layout, how output chunks ride the run stream, default agent picks for attempts, and Preview's iframe vs webview.

## 9. My calls (owner: check)

- Terminal is a command console, not an interactive shell, to avoid a native dependency.
- Tether's pick ranks by check → failing tests → diff size → cost, and never ships on its own.
- Attempt branches are kept 7 days after a pick.
- Rewind leaves the run stopped; you press Resume.
