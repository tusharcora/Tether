# Rewind, try more ways, Terminal and Preview: implementation plan

> One implementer builds the whole plan; the controller reviews at checkpoints. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-10-30-rewind-attempts-design.md`. Boards: `docs/design/next-build/{Compare,RunTools}.dc.html`; the run page frame, Runs row and Goals side panel from `docs/design/asks-goals-runs/{RunDetail,Runs,Main}.dc.html`.

**Goal:** undo a run back to before any finished step (and undo that), fork a new run from after a step, try the same task 2–4 more ways and pick one to ship from a Compare page, run commands and a dev-server preview inside the run's worktree, and show the project's open goals beside a chat.

**Architecture:** the engine gains `rewind`, `undoRewind` and `fork`, built on what it has (worktree per run, a commit per writing attempt, `resume`, `StartInput.ref`, `origin`); each `node.started` now records `base` (HEAD when the step began). Two new events fold into state: `run.rewound` (with a copy of the steps it requeued, so `run.unrewound` can put them back) and `attempt.set` / `attempt.picked`. `src/attempts.ts` starts siblings through `engine.start` with `applyOverrides`, ranks them and ships the pick through `RunShip`. `src/runProcs.ts` keeps the per-run processes (one command at a time, one preview) in memory, records their pids in `<home>/procs/<pid>.json`, and hands output to listeners; the run's SSE stream forwards them as `proc` messages. The web adds a step ⋯ menu, a rewind banner, a Try-more-ways picker, the Compare page, Terminal and Preview, and the Goals side panel.

## Global constraints

- Branch `feature/rewind-attempts`. Small commits, plain messages, no trailers, no mention of AI. No push, no merge.
- Temp homes only in tests. No secrets in config, logs, argv, URLs or responses.
- No new npm dependencies. Tokens from `studio.css`, Geist; no new colours or fonts. Real buttons, labelled icon buttons, keyboard menus, focus-trapped confirm dialogs (the kit's Radix `Dialog`), `aria-live="polite"` only on exit lines.
- Every new route validates its input (400) and refuses unknown runs (404); commands run only in the run's worktree; the existing Host/Origin checks cover the new routes.

## My calls

1. **Which steps a rewind requeues.** The step, every step after it in the graph, and any other step whose commit is no longer on the branch after the reset (a fix loop's later commits, a parallel branch that ran later). Done read-only steps elsewhere keep their result. Requeued steps keep their attempt count and cost (spent stays spent); output, commit, diff stat, verdict, gate result, loops and session are cleared, so the step starts afresh.
2. **Uncommitted work before a rewind** (a step cut short by Stop) is committed first (`aorch: uncommitted work before rewind`), so the saved `refs/tether/rewind/<run>/<n>` ref holds it too and Undo brings it back.
3. **Undo** works while the run has not moved on (no Resume, no step started) and the worktree's HEAD is still the rewind's base; otherwise 409. It restores the ref, the requeued steps' state and the run's status, then deletes the ref.
4. **Refused rewinds/forks:** a live run (409, the UI offers Stop & rewind), a run already shipped as a PR (409), a step that never finished (409), a team-kind run's planning (`kind: 'team'` runs, 409; the plan's worker steps are spawned steps, which fork refuses), a missing worktree (409).
5. **Fork** uses the pipeline the parent started with (`run.started`), not its amended one; the step and its graph ancestors are recorded `done` in the child at start (`node.finished`, output "From run <id>", the parent's commit and diff stat, attempt 0). The ref is the step's commit, else its base, else the nearest earlier commit, else the parent's base.
6. **Attempts** run on workflow runs only (a team-kind run plans first; 400). Siblings start from the original's `baseSha` with the pipeline it started with, every agent step re-pointed by `applyOverrides`, the original's workspace, autoApprove and origin. **Default picks:** the owner's crew bindings and then each registered adapter (not `mock`), free first (OpenRouter, NVIDIA, `:free` models), never the original's binding or one already in the set; when fewer distinct picks exist than asked, the rest run on the original's agents.
7. **Limits for siblings:** a goal's run cap counts each sibling as a run item and its budget must not already be spent; a team's runs-per-day and dollars-per-day count them as team tasks (they are added to the team's task list, so its ship path and approver rule hold). Refusals are 409 with the reason.
8. **Tether's pick** ranks finished, not-failed attempts (done, or paused on an approval): the check passes (all gate steps done) → fewer failing tests (parsed from gate output) → smaller diff (added + deleted) → lower cost. Shown as a chip, never shipped by itself.
9. **Pick** opens a PR for the picked run (`RunShip.decide(run, merge)`, `merge` defaults to false; same approver rule) and stops the others still live or paused. Every member gets `attempt.picked`. A sweep (server start, then every 6 hours) removes the worktrees and branches of unpicked members 7 days after the pick; their run records stay.
10. **Terminal output rides the run's SSE stream** as `event: proc` messages from an in-memory listener (not the event log, so a run's log never fills with console output). `GET /api/runs/:id/exec` returns the last 50 commands with their output for a reload. History and output live in memory and end with the server.
11. **Output caps:** each command streams up to 100 000 characters; past that, one notice line, and at the end the full output (kept up to 4 MB) is saved under the worktree's `.tether/spill/` (git-ignored) and the end line names the file.
12. **Clean env:** an allowlist (PATH, HOME, USER, LOGNAME, SHELL, LANG, LC_*, TERM, TMPDIR, TZ), plus `PORT` for a preview and `FORCE_COLOR=0`. Nothing else from Tether's environment (tokens, keys, `TETHER_*`, `AORCH_*`) reaches a command.
13. **Leftover processes:** every spawned process group is recorded in `<home>/procs/<tether pid>.json`; on server start, the files of Tether processes that are gone are read, a recorded group whose leader is still alive and started at the recorded time (`ps -o lstart=`) is killed, and the file is removed. A second Tether on the same home never ends the first one's processes. Groups are killed on Stop, run delete, server close and process exit. A run's own Stop does not end its preview (you may want to look at it after stopping the agents).
14. **Preview** default command: `npm run dev`, else `npm run start` from the worktree's `package.json`; else 400 asking for one. `PORT` is a free port; the URL is the first `http://localhost|127.0.0.1|[::1]` URL in its output (ANSI codes stripped), else `http://localhost:<PORT>` after 20 s. The page polls `GET …/preview`; the frame is an `<iframe sandbox>`; the app's CSP gains `frame-src` for loopback ports only.
15. **Compare page** route `#/attempts/<set>`; the Runs page collapses a set into one row (newest member's place) with a "best of N" chip and one track per attempt; the row opens Compare.
16. **`base` only on writing steps and gates.** A read-only step never moves HEAD, so its rewind base is found from the commits before it; probe replays are never rewound. Skipping the git call keeps probe replays as fast as before.
17. **Goals side panel** shows on a chat screen ≥ 1200 px wide, collapsible, remembered in `sessionStorage` (per window). The chat's own goal is the one whose `origin.chat` is this chat.

---

### Task 1: Rewind and undo (server)

**Files:** `src/types.ts`, `src/git.ts`, `src/engine.ts`; test `test/rewind.test.ts`.

- `node.started.base`, `NodeState.base` (first start's HEAD, kept until a rewind).
- Events `run.rewound { node, base, ref, nodes }`, `run.unrewound { ref }`; `RunState.rewind`, `rewinds`.
- `Engine.rewind(runId, node)`, `Engine.undoRewind(runId)`, `rewindBase(s, node)`; `deleteRun` drops the run's rewind refs.

- [ ] Tests: rewind resets the worktree to the step's base and removes untracked files, requeues the step and the ones after it, leaves the run stopped, keeps cost; Resume reruns from there; undo restores HEAD and states; undo after Resume is 409; refused while live; old runs without `base` fall back to the previous commit / start ref.
- [ ] Implement, run, commit.

### Task 2: Fork (server)

**Files:** `src/engine.ts`, `src/types.ts`; test `test/rewind.test.ts`.

- `RunOrigin.kind` gains `fork`, `RunOrigin.node`. `Engine.fork(runId, node)`.

- [ ] Tests: the child starts from the step's commit, has the step and its ancestors done "from parent" with the parent's commit, runs the rest, and carries `origin: fork`.
- [ ] Implement, run, commit.

### Task 3: Attempts (server)

**Files:** `src/attempts.ts`, `src/types.ts`, `src/store.ts`, `src/teams/teams.ts`; test `test/attempts.test.ts`.

- `attempt.set { set, label }`, `attempt.picked { run }`; `RunState.attemptSet`, `attemptLabel`, `attemptPicked`; summaries carry set and label.
- `Attempts.start(runId, { count, agents? })`, `defaultPicks(...)`, `view(set)`, `rankAttempts(rows)`, `pick(set, run, merge)`, `sweep(now)`.

- [ ] Tests: count 1–4 enforced; the original becomes A and siblings B…; overrides land on every agent step; defaults skip the original's binding and repeat none, free first; ranking order; pick ships the chosen run and stops the rest; goal cap refuses; sweep removes unpicked worktrees after 7 days.
- [ ] Implement, run, commit.

### Task 4: Terminal and Preview processes (server)

**Files:** `src/proc.ts` (`onStdout`, `onSpawn`), `src/codemode/spill.ts` (`saveSpill`), `src/runProcs.ts`; test `test/run-procs.test.ts`.

- [ ] Tests: a command runs in the worktree and streams its output then an exit line; Stop kills the process group (a child `sleep` dies too); one at a time (409); history keeps 50; the env has PATH but no `GH_TOKEN`/`OPENROUTER_API_KEY`/`TETHER_*`; `stopRun` ends everything; leftover pids are reaped; `detectUrl` finds loopback URLs through ANSI codes and ignores others; a preview gets `PORT` and its URL; default command from package.json; 400 without one.
- [ ] Implement, run, commit.

### Task 5: Routes (server)

**Files:** `src/server.ts`, `src/app/main.ts` (CSP `frame-src`); test `test/rewind-api.test.ts`.

- `POST /api/runs/:id/rewind { node }`, `POST /api/runs/:id/rewind/undo`, `POST /api/runs/:id/fork { node }`.
- `GET /api/runs/:id/attempts` (default picks and choices), `POST /api/runs/:id/attempts { count, agents? }`, `GET /api/attempts/:set`, `POST /api/attempts/:set/pick { run, merge? }`.
- `GET|POST /api/runs/:id/exec`, `POST /api/runs/:id/exec/stop`, `GET|POST|DELETE /api/runs/:id/preview`; the stream forwards `proc` messages; run delete and server close stop the run's processes.

- [ ] Tests: input validation (400s, 404s, 409s), a command's output over the stream, delete kills its processes, cross-origin POST refused.
- [ ] Implement, run, commit.

### Task 6: Story row menu, rewind banner, fork (web)

**Files:** `web/src/runs/{StoryList,RunPage,RewindBanner,storyModel}.tsx|ts`, `runs.css`; test `web/src/runs/RunTools.test.tsx`.

- [ ] Tests: the ⋯ menu is keyboard-operable and offers Rewind / Fork / Open its changes on finished steps only; Rewind asks in a dialog then posts; a live run offers Stop & rewind; the banner shows Undo and Resume; Fork opens the new run.
- [ ] Implement, run, commit.

### Task 7: Try more ways, Compare, Runs grouping (web)

**Files:** `web/src/runs/{RunHeader,TryMore,Compare,compareModel,RunList,runsModel}.tsx|ts`, `web/src/hooks.ts`, `web/src/App.tsx`; tests in `RunTools.test.tsx`, `runsModel.test.ts`.

- [ ] Tests: the picker pre-fills defaults and posts count + agents; a run in a set shows "Attempt A of 3 · Compare"; Compare shows one column per attempt with Tether's pick, Pick X and ship, failed dimmed with Retry, Try 1 more way; the Runs list collapses a set into one "best of N" row.
- [ ] Implement, run, commit.

### Task 8: Terminal and Preview (web)

**Files:** `web/src/runs/{Terminal,Preview,StepPane,RunPage}.tsx`, `web/src/runStream.ts`; tests in `RunTools.test.tsx`.

- [ ] Tests: Terminal posts a command, shows streamed output and the exit line (in a polite live region), ↑/↓ history, Stop and Ctrl+C; the header shows the worktree and branch; Preview's empty state starts the detected command, then shows the URL, reload, open in browser, Stop and the frame.
- [ ] Implement, run, commit.

### Task 9: Goals side panel (web)

**Files:** `web/src/chats/{GoalsPanel,Conversation}.tsx`, `chats.css`, `web/src/App.tsx`; test `web/src/chats/chats.test.tsx`.

- [ ] Tests: lists the project's open goals, highlights this chat's goal with its faces and "from this chat", All goals goes to Goals, collapse is remembered.
- [ ] Implement, run, commit.

### Task 10: Docs and check

- [ ] `docs/HANDOFF.md`: PRs #26 and #27 merged, this build, refreshed next steps. `docs/reference.md`: a short section on rewind, attempts, Terminal and Preview.
- [ ] `npm run check` (known flaky: `evolve.test.ts` timeouts under load; confirm alone), `npm run build`. Commit.
