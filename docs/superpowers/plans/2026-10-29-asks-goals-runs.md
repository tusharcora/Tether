# Asks become goals, team room, runs remade: implementation plan

> One implementer builds the whole plan; the controller reviews at checkpoints. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-10-29-asks-goals-runs-design.md`. Boards: `docs/design/asks-goals-runs/{Main,TeamRoom,Runs,RunDetail}.dc.html`.

**Goal:** a chat ask to build, fix or do something becomes a paused goal with its team, agents and workflow attached, started by one click; limits become optional; chats can be deleted from the sidebar; a team screen becomes a room (map, runs strip, chat); the Runs list and a run's page are rebuilt as boards 3 and 4.

**Architecture:** the server extends what exists: the `goal` proposal kind rides the assistant's ```tether block (validated in `reply.ts`, the goal made by the turn, decided by the existing proposals route); goals get optional limits through the additive migration (`0` stored for "none" since the old columns are NOT NULL); runs get an `origin` on `run.started` and a per-step diff `stat` on `node.finished`, both read into `RunRow`; two run routes are added (`ship`, `sendback`) on top of `ship.ts` and the engine's amend/requeue/resume. The web rebuilds `RunList`, `RunPage`, `TeamScreen` from the existing parts (`RunGraph`, `StepInspector`, `FileBars`, `useDiff`, `StepTrack`, `FaceStack`, `TeamPanel`), with the logic in small pure models that carry the tests.

## Global constraints

- Branch `feature/asks-goals-runs`. Small commits, plain messages, no trailers. No push, no merge.
- Temp homes only in tests. No secrets in config, logs, argv, URLs or responses.
- Tokens from `studio.css` only; Geist; no new colours or fonts. Real buttons, labelled icon buttons, keyboard menus, reduced motion respected.
- Every new route validates its input (400 on bad ids or limits).
- Left out on purpose (spec §3): rewind, best-of-N, Preview, Fork, Terminal. No disabled placeholders for them.

## My calls

1. **Start approves the first run.** Pressing Start on a goal card (or the goal's Start) is the person's go-ahead for the first run, so it starts without a second click (the success line asks for one click). A loop still runs its check first; later runs follow the goal's approval as today. `Goals.begin(id, task)` is the new entry; it refuses a goal that already started (409).
2. **A goal with no check** (a tracker made from chat) gets one run on Start; when every run item is done the goal is met. Before this, afterRun needed a check and would have stopped such a goal.
3. **No limit stored as 0.** `budget_usd` and `max_runs` are NOT NULL in old databases; 0 is outside both valid ranges, so it reads back as "no limit". No migration.
4. **Team goals from chat** run through the team's existing loop path (`Teams.loopRun`), which now posts the goal's loop card in the channel when it has none, so the room shows it and the end-of-goal ship approval works as for a loop made in the channel.
5. **Merge to main on a team run** approves the waiting step and leaves the PR to the team's ship path (as today); a non-team run ships with `ship.ts` (push, `gh pr create`, wait for checks, `gh pr merge`). The engine has no local merge path, so a repo without a GitHub remote shows the push error instead of merging locally (spec: "use whichever exists, do not write a third").
6. **Send back** = the existing amend (guidance) + requeue + resume path, as a new `POST /api/runs/:id/sendback { node, note }`: the step reruns with the note as guidance and every step after it runs again. Refused (409) for a live or finished run.
7. **Diff stats** come from each step's commit (`git show --shortstat`), recorded on `node.finished` as `stat`; old runs have none, so rows omit `+a −d`.
8. **Team run page link** uses the run's `origin.team`; runs made before this build have no origin and show no link.
9. **Scheduled** shows only when `GET /api/schedules` answers (it 404s on this branch), reading `{ schedules: { id, name, when, bot?, last? }[] }`.
10. **Board 1's "Goals · next" side panel** is not built: the goal shows on Goals at once, which is what the panel illustrated (spec §6.1 note).
11. **All chats rows** keep their current actions (the chat's own ⋯ menu has Rename and Delete); the sidebar gets the new menu.
12. **Comments** are kept per run in localStorage (spec: "held locally"), keyed by run, step, file and line.

---

### Task 1: Optional limits, time limit, startedAt, origin (server)

**Files:** `src/goals/{types,store,routes,loop}.ts`, `src/teams/teams.ts`; test `test/goals.test.ts`.

- `Goal.budgetUsd?`, `Goal.maxRuns?`, `Goal.maxMinutes?`, `Goal.startedAt?`, `Goal.origin?: { kind: 'chat'; chat: string; message: string }`.
- Store: columns `max_minutes`, `started_at`, `origin`; 0 in `budget_usd`/`max_runs` reads as unset.
- Routes: no `?? 5`; `null` clears on PATCH; `maxMinutes` 1–1440.
- Loop: a missing cap is not checked; `maxMinutes` stops the goal at the next advance once `now - startedAt` passes it; `startedAt` set on create (active) and on the first resume of a paused goal; run budget = remaining goal budget, else the engine default (team goals: the team's remaining daily budget).
- `begin(id, task)`: the person's first Start (see My calls 1, 2).

- [ ] Tests: no caps → runs past 5 tries; maxMinutes stops; team goal with no budget passes the team's remaining budget; begin starts one run on a tracker and the goal is met when it is done; begin twice is 409; PATCH null clears.
- [ ] Implement, `npx vitest run test/goals.test.ts`, commit.

### Task 2: Goal drafts (server)

**Files:** `src/assistant/{types,reply,prompt,turn,routes}.ts`, `src/prefs.ts`; tests `test/assistant.test.ts`, `test/goal-drafts.test.ts`.

- `Proposal.kind` gains `'goal'` with `draft?: GoalDraft` and `goalId?`.
- `checkDraft(raw, ctx, strict)`: title required (≤200), type a `GoalType` (missing: feature), unknown team/agent/workflow dropped (strict: 400), limits clamped (strict: 400), ≤5 agents, approval `ask` unless `auto`.
- Prompt: with `asksToGoals` on and a project open, the model is told to return one `goal` proposal for build/fix/change/do asks, none for questions, and is given the project's teams (members, specialties), crew agents and saved workflows.
- Turn: a goal proposal becomes a paused goal (`origin` chat + message), the proposal keeps `goalId`; with no `goals` service or no project it is dropped.
- Route: `POST /api/assistant/proposals/:id` on a goal: `start` applies `draft` edits (strict), patches the goal and calls `begin`; `dismiss` deletes the paused goal. `PUT /api/assistant/settings { asksToGoals }`; `GET /api/assistant` returns `asksToGoals`.

- [ ] Tests: checkDraft drops unknown ids, clamps limits, caps agents, refuses a bad type; a turn with a goal block makes one paused goal; start begins it once; dismiss deletes it; bad edits 400; the setting round-trips and turns the instruction off.
- [ ] Implement, run the two test files, commit.

### Task 3: Run origin and step diff stats (server)

**Files:** `src/types.ts`, `src/engine.ts`, `src/git.ts`, `src/store.ts`, `src/runRows.ts`, callers in `src/assistant/routes.ts`, `src/goals/loop.ts`, `src/teams/teams.ts`, `src/pr.ts`/`src/triggers.ts`; tests `test/run-rows.test.ts`, `test/engine.test.ts`.

- `RunOrigin = { kind: 'chat'|'goal'|'team'|'trigger'|'schedule'; id: string; team?: string }` on `run.started`, `RunState`, `RunSummary`.
- `node.finished.stat = { files, added, deleted }` from the commit; `RunRowExtras.added/deleted` summed when any step has a stat.

- [ ] Tests: origin round-trips through the fold and the row; a step's commit stat lands on the row; a run with no commits has no stat.
- [ ] Implement, commit.

### Task 4: Ship and send back (server)

**Files:** `src/runShip.ts` (new), `src/engine.ts` (`sendBack`), `src/types.ts` (`run.shipped` event, `RunState.ship`), `src/server.ts`, `src/teams/teams.ts` (records its PRs on the run too); test `test/run-ship.test.ts`.

- `POST /api/runs/:id/ship { merge }`: approves the waiting approval steps, then (non-team runs) ships when the run is done; merge waits for checks then merges. `run.shipped { url, number, merged? }` records it.
- `POST /api/runs/:id/sendback { node, note }`: 400 bad node/note, 409 live or finished.

- [ ] Tests with a fake exec: ship opens the PR after the run finishes and merges when checks pass; send back reruns the step with the note as guidance and the steps after it.
- [ ] Implement, commit.

### Task 5: Optional limits in the web

**Files:** `web/src/goals/{goalsApi,GoalNode,Goals,NewGoalDialog}.tsx`, `web/src/teams/TeamScreen.tsx`; tests `web/src/goals/Goals.test.tsx`.

- "no limits" in `goalMeta`/`goalLine`/node/detail; `+ Add limits` chips ($ cap, max tries, time limit) in New goal and Settings; Settings sends `null` to clear.

- [ ] Tests updated and new ones for "no limits" lines and clearing a limit. Commit.

### Task 6: Goal card and composer switch (web)

**Files:** `web/src/assistant/{GoalCard.tsx (new),cards.tsx,Thread.tsx,api.ts,useAssistant.ts,Chat.tsx,assistant.css}`; test `web/src/assistant/GoalCard.test.tsx`.

- Board 1's card: header, Done when / Team / Agents (Swap: an agent picker) / Workflow (step chips, approvals amber) / Limits (optional, `+ Add limits`); Start, Edit goal (the New goal form prefilled), Just answer, no goal, Open in Goals →. After Start: the goal's live status and a link to its latest run (polled).
- Just answer: dismiss, then send "Just answer, don't make a goal."
- Composer: "Turn asks into goals" checkbox.

- [ ] Tests: renders the draft; Start sends the edits; dismiss sends the follow-up; started shows status and run link. Commit.

### Task 7: Sidebar chat menu (web)

**Files:** `web/src/ui/studio/Sidebar.tsx`, `web/src/App.tsx`, `shell.css`; test `web/src/ui/studio/Sidebar.test.tsx`.

- ⋯ on each chat row (`Chat actions for <title>`): Rename (inline field, Enter saves, Escape cancels) and Delete chat (confirm dialog). Deleting the open chat goes to New chat.

- [ ] Tests: menu by keyboard, rename calls back, delete confirms first. Commit.

### Task 8: Runs page (web, board 3)

**Files:** `web/src/runs/runsModel.ts` (new), `web/src/runs/RunList.tsx` (rewrite), `web/src/Runs.tsx`, `web/src/runs/runs.css`; tests `web/src/runs/runsModel.test.ts`, `web/src/runs/RunList.test.tsx`.

- Model: `needsYou`, `groupRuns` (Needs you / Live / Today / Earlier this week / Older, paged 50), filters (All / Needs you / Live, Team, Agent, Project), search over task, goal title and changed files, `nowLine`, `weekStats`, `spendByDay`, `startedFrom`.
- View: header (search, New run), filter bar (segmented + chips, probes in ⋯), sections with amber Needs-you cards (Approve & open PR, Review diff, Answer), rows (dot, title + line, faces, step track, ±, cost · duration), right rail (This week, 7-day spend bars, Scheduled when the API answers, Started from).

- [ ] Model tests first, then view tests. Commit.

### Task 9: Run page (web, board 4)

**Files:** `web/src/runs/storyModel.ts`, `web/src/runs/comments.ts` (new), `web/src/runs/{RunPage,StoryList,StepPane,OutcomeRail,DecisionBanner}.tsx`, `RunHeader.tsx`, `runs.css`; tests `storyModel.test.ts`, `comments.test.ts`, `RunPage.test.tsx`.

- Header: ← Runs / team / short id, title, status, goal chip ("Goal · try n of m"), time · cost of cap, Stop/Resume. Team runs: "Open in # team".
- Decision banner when the run waits on the owner: Merge to main, Open PR instead, Send back… (with the comments and an optional reason).
- Left: story rows (planning first for team runs; questions and plan review inline via `TeamPanel`). Centre: step header, Transcript (tool rows + text) and Changes n (diff by file, click a line to comment). Right: Outcome, Files, Cost per agent, More (Every event, Open worktree in Code).

- [ ] Story and comment model tests first; RunPage tests updated. Commit.

### Task 10: Team room (web, board 2)

**Files:** `web/src/teams/roomModel.ts` (new), `web/src/teams/{TeamScreen,TeamMap}.tsx`, `web/src/runs/RunGraph.tsx` (a "You" start node, zoom), `teams.css`; tests `roomModel.test.ts`, `TeamScreen.test.tsx`.

- Header chips (live runs, needs you, today's spend of the limit). Map: This run (RunGraph with You, step inspector in place) / Whole team (people and agents, hand-off edges from @mentions in the last 7 days, click focuses the chat). Zoom −/+/Fit. Runs strip (team runs and loop goals; live selected by default). Chat as today, with a "Showing X · Show all" bar.
- Team run links open in the room.

- [ ] Model tests (hand-off edges, strip order) then view tests. Commit.

### Task 11: Check

- [ ] `npm run check` passes (known Mac-only failures excepted, confirmed unrelated). Update `docs/HANDOFF.md` next steps.
