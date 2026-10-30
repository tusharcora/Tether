# Asks become goals, team room, runs remade: design

Date: 2026-10-29 · Branch: `feature/asks-goals-runs` (from main 29b66d4) · Mockup (approved by the owner, "looks good"): canvas `WvgbPqG6rR4MaPwD7BUviV`, boards copied to `docs/design/asks-goals-runs/*.dc.html`. Board 1 "An ask becomes a goal", board 2 "Team room", board 3 "Runs, remade", board 4 "Run details, remade".

## 1. Intent

When the owner asks Tether to implement a feature, fix a bug or perform an action, the work should become a **goal** right away, with the right **team, agents and workflow already attached**, so nothing has to be wired by hand. A team's runs and its chat should be **one place** where you can see the team and how the work flows between its members. The Runs list and a run's page should read as "what is happening and what needs me", not as a log.

Success: one sentence in chat gives a goal card the owner can start with one click; a team's room shows who is doing what while they talk; the Runs page answers "what needs me, what is live, what finished" at a glance; a run's page tells its story step by step and ends in Merge.

## 2. Goals

1. A chat ask to build, fix or do something produces a **goal card** (board 1): type, title, done-when check, team, agents with their role and a one-line why (each swappable), the workflow as a chain of steps, and **optional limits**. Start / Edit goal / Just answer, no goal. The goal appears on Goals immediately (status `paused` "not started" until Start).
2. **Limits are optional** everywhere a goal is made or edited: no money cap, no run cap, no time limit unless the owner adds them. Approval rules still apply ("nothing ships without you" when approval is `ask`).
3. **Delete chats from the sidebar**: each chat row in the sidebar's Chats section gets a ⋯ menu (Rename, Delete chat). Delete confirms, then removes the chat (the existing `DELETE /api/assistant/chats/:id`); if it was open, the screen goes to New chat.
4. **Team room** (board 2): the team screen becomes map + chat + runs. Team runs open inside the room instead of on a separate page.
5. **Runs page** (board 3) and **run page** (board 4) rebuilt as drawn, within §8.

## 3. Non-goals

- Rewind / checkpoints, "Try 2 more ways" (best-of-N), the Preview tab, "Fork from here" and the Terminal tab on board 4: next build. Leave them out of the UI entirely (no disabled buttons).
- Scheduled runs on board 3: shown only when the `feature/dsh-ports` cron triggers have merged (§7.4).
- Proposals for plain questions: a question stays a plain answer.
- Slack/Telegram team rooms (Teams phases 2 and 3).

## 4. Anti-goals

- A goal or run starting without the owner pressing Start (unless the goal's approval is `auto` and the owner set that).
- Tether inventing team, agent or workflow ids: everything attached must exist; unknown ids are dropped server-side.
- Silent unbounded spend on a **team** goal: team daily limits (`teams/rules.ts`) still cap it even when the goal has no limits.
- A second goals store, run store or chat store: extend the existing ones.

## 5. What exists (reuse)

- Chat proposals: `src/assistant/types.ts` `Proposal` (kinds `workflow`, `team`), parsed in `src/assistant/reply.ts`, started by `POST /api/assistant/proposals/:id` in `src/assistant/routes.ts`, rendered by `web/src/assistant/taskCards.tsx`.
- Goals: `src/goals/{types,store,loop,routes}.ts`, web `web/src/goals/*` (`goalsApi`, `GoalNode`, `AssigneePicker`, `NewGoalDialog`). Limits enforced at `src/goals/loop.ts:174-175`, defaulted at `src/goals/routes.ts:123-124`.
- Teams: `src/teams/*` (team members, specialties, project, limits, `ship.ts` PR open/merge with `prChecks`/merge helpers), web `web/src/teams/TeamScreen.tsx`.
- Runs: `web/src/Runs.tsx`, `web/src/runs/*` (`RunGraph` + `graphModel` layering, `StepInspector`, `OutputLog`, `RunFiles`, `FileBars`, `useDiff`, `ApprovalBar`, `PlanCard`), `web/src/Team.tsx` (`TeamPanel`, questions, plan review).
- Sidebar: `web/src/ui/studio/Sidebar.tsx` (chat rows at ~l.239), `CreateMenu`/menus in the bencho/beui kits, `ConfirmButton`.

## 6. Design

### 6.1 Asks become goals (server)

- New proposal kind `goal` with `draft: GoalDraft`:
  `{ title, type: GoalType, description?, check?: GoalCheck, team?: string, agents: { id: string; role: string; why?: string }[], workflow: string /* saved workflow name or 'team' */, limits?: { budgetUsd?: number; maxRuns?: number; maxMinutes?: number }, approval: 'ask' | 'auto' }` plus `goalId` once created.
- The assistant's prompt (`src/assistant/prompt.ts`) tells the model: when the person asks to build, fix, change or do something in the project, return one `goal` proposal (not `workflow`/`team`); a question gets no proposal. The prompt lists the project's teams (id, name, members with specialty), crew agents (id, specialty) and saved workflows so it picks real ids. Defaults: approval `ask`, no limits.
- `reply.ts` validates the draft: drop unknown team/agent/workflow ids, clamp limits to the existing ranges (`0.01–1000` $, `1–50` runs, `1–1440` minutes), cap 5 agents, type must be a `GoalType`. A draft with no title is dropped.
- When the reply is stored, the server **creates the goal** right away with status `paused` and a `origin: { kind: 'chat', chat, message }` field, assignees = the team + agents, owner `team`/`agent` = the team and the first agent when a team is attached. The proposal keeps `goalId`. (my call: the goal shows on Goals as soon as the card appears, as board 1's side panel shows.)
- `POST /api/assistant/proposals/:id` for a `goal` proposal applies any edits sent in the body (same validation), then starts the goal (the loop's existing start/next path), and marks the proposal `started`. **Dismiss** ("Just answer, no goal") deletes the paused goal it created and marks the proposal `dismissed`; the web then sends a follow-up turn "Just answer, don't make a goal." (my call).
- Setting `assistant.asksToGoals` (prefs, default on), toggled from the composer ("Turn asks into goals"). Off = today's behaviour.

### 6.2 Optional limits (server + web)

- `Goal.budgetUsd?`, `Goal.maxRuns?`, new `Goal.maxMinutes?` are optional. Create/patch accept `null` to clear. Routes no longer default them (remove `?? 5`).
- Loop: a missing limit is not checked. `maxMinutes` stops the goal when `now - startedAt` passes it (`startedAt` = first Start; add the field). Team goals still pass the remaining team budget the way `loop.ts:228` does; with no goal budget, the run budget is the team's remaining daily budget (or the engine default for non-team goals).
- `goalMeta`/`goalLine` and the node/detail views read "no limits" instead of "$x of $y" / "n of m runs" when unset. NewGoalDialog and goal Settings show limits behind "+ Add limits" ($ cap, max tries, time limit chips), as board 1.
- Existing goals keep their stored limits (no migration).

### 6.3 Goal card (web)

`taskCards.tsx` gets `GoalCard`, drawn as board 1: header (type tile, title, "Bug fix · new goal in <project> · not started", status chip), rows Done when / Team / Agents (face, name, role · model · why, **Swap** opens the existing assignee picker filtered to agents) / Workflow (step chips from the workflow's nodes, approval nodes in amber, the workflow's name) / Limits (optional) ; footer Start (primary), Edit goal (opens NewGoalDialog prefilled), Just answer, no goal (ghost), "Open in Goals →". After Start the card shows the live goal status and a link to its run. Edits made on the card are sent with Start.

### 6.4 Sidebar chat delete (web)

Each chat `SideRow` in the Chats section shows a ⋯ button on hover/focus (always visible for the current row and for keyboard focus) opening a menu: **Rename** (inline edit, `PATCH` existing route) and **Delete chat** (confirm, then `remove`). Keyboard reachable, `aria-label="Chat actions for <title>"`. Deleting the open chat routes to New chat. Same menu on rows in All chats if they lack one.

### 6.5 Team room (web, board 2)

`TeamScreen` becomes three regions; on narrow widths they stack (map, runs strip, chat).

- **Header**: as today plus live-run / needs-you chips and today's spend of the team limit.
- **Map** (left): a segmented control **This run** / **Whole team**.
  - *This run*: the selected run's pipeline laid out with `graphModel` (reuse `RunGraph`), with a **You** node at the start (who asked) and the approval as an amber "You approve → PR" node; edge colours as `RunGraph` (green done, blue live with the moving dot, dashed next). Clicking a step opens the step inspector in place (reuse `StepInspector` as a side sheet).
  - *Whole team*: people and agents as nodes; edges for hand-offs in the last 7 days (from team messages: who @mentioned/handed work to whom), thickness by count. Clicking a node **focuses the chat** on that member (filters messages to theirs plus cards they are on; a "Showing Bolt · Show all" bar clears it).
  - Zoom −/+/Fit controls.
- **Runs strip** (under the map): the team's runs and loop goals as small cards (status dot, title, step track or loop note, PR/merge note); picking one switches the map. Live run selected by default, else the latest.
- **Chat** (right): today's channel unchanged in behaviour (messages, @mentions, run/approval/proposal/PR cards updating in place, composer).
- A team run's own page (`#/runs/<id>` where `run.kind === 'team'` or the run belongs to a team) shows a "Open in # <team>" link; the team room is where team runs are watched (my call: keep the run page reachable, not a redirect, so deep links keep working).

### 6.6 Runs page (web, board 3)

Replace `RunList`'s table with grouped sections:

- Header: "Runs", search (task, goal title, file names already in the row model), **New run**.
- Filters: segmented All / Needs you (n) / Live (n) / Scheduled (only with cron, §7.4); chips Team, Agent, Project ("only <project>" today). Probe replays switch moves into a ⋯ menu.
- Sections: **Needs you** (pending questions, plan ready, approval waiting) as amber cards with the action inline (Approve & open PR / Review diff / Answer); **Live**; **Today**; **Earlier** (this week, then older, paged 50).
- Row: status dot, title + one muted line (what is happening now: current step and agent, or the error and "Retry from <step>"), agent faces, mini step track (one segment per step coloured by state), `+a −d` from the diff stats (add `added/deleted` to `RunRow` from the stored file stats; omit when unknown), cost · duration. Click opens the run.
- Right rail: **This week** — runs, PRs merged (runs with a merged ship), spend with the share on free models, "passed first try" (done with no retried step); a 7-day spend bar chart (today in accent); **Started from** counts (chat, goal, team, trigger, schedule) — add `origin` to runs where they start (chat proposal, goal loop, team, trigger) and to `RunRow`; old runs count as "other" and the chip is hidden when 0.

### 6.7 Run page (web, board 4)

Rebuild `RunPage` as: header (breadcrumb ← Runs / team / short id, title, status chip, goal chip "Goal · try n of m" when it belongs to a goal, time · cost of cap, Stop/Resume as today); the **decision banner** when the run waits on the owner; three columns:

- **What happened** (left): one row per step as a story ("Bolt fixed it", "Probe ran tests", "Lens reviewed", "You approve"): face, sentence, one muted line (files/±, test result, duration, cost), state mark. Planning (team runs) is the first row. Selecting a row fills the centre. Questions and plan review (`TeamPanel`) appear as a row that expands inline when pending.
- **Step** (centre): header (face, step title, model · access · worktree branch), tabs **Transcript** (tool calls as compact rows: Read/Edited/Ran with target and result, then the text) and **Changes n** (the step's diff with `FileBars`; **click a line to comment**). Comments are held locally per run and listed in the banner; **Send back** posts them with an optional reason as the rework note (the existing resume/rework path with a `note`), and marks them "sent". The full raw timeline is a link in the right rail.
- **Outcome** (right): Check (goal check result or the last gate), Branch, Started from (link), Team; Files with ± bars; Cost per agent/model as a stacked bar and list; More: Every event (raw timeline, today's `RunDetails` timeline), Open worktree in Code, Save as a workflow (existing save path if present; else omit).
- **Decision banner**: "Checks pass and <reviewer> approved. Ship it?" with **Merge to main** (open a PR with `ship.ts` helpers and merge when checks pass, as Teams ship does; for a repo without a GitHub remote, merge the branch locally the way the engine's existing finish/merge path does — use whichever exists, do not write a third), **Open PR instead**, **Send back…**.

## 7. Constraints

1. Follow the boards' layout, spacing and copy; Tether's tokens (`studio.css`), Geist; no new fonts or colours.
2. Accessibility as the boards: real buttons/links, labelled icon buttons, menus keyboard-operable, text contrast ≥ 4.5:1, reduced-motion respected for the live edge dot.
3. Every new route validates its input (400 on bad ids/limits); no secrets in responses.
4. Scheduled runs (board 3) and "Started from: schedule" depend on `feature/dsh-ports` (cron triggers). Build the section behind a check for the schedules API (`GET /api/schedules` 404 → hide).
5. Tests: unit tests for draft validation, optional-limit loop behaviour (no cap, maxMinutes stop, team cap still applies), proposal start/dismiss, sidebar delete, Runs grouping/filters, run story rows, comment → send back. Update existing snapshots/tests the change breaks. `npm run check` (typecheck, tests, build) must pass.
6. Temp homes only in tests; never the real `~/.aorch`.

## 8. Left to the builder

- Exact prompt wording for goal proposals, and how agents' "why" lines are chosen (specialty + recent files touched when cheap).
- Hand-off edges data source details for *Whole team* (team messages are enough).
- Component split and file names; reuse over new components.

## 9. My calls (owner: check)

- The goal is created (paused) when the card appears, so it shows on Goals at once; dismissing deletes it.
- Rewind, best-of-N, Preview and Terminal from board 4 are left for the next build.
- Team run pages stay reachable but point to the team room.
- Chat pinning does not exist today, so the sidebar menu is Rename + Delete only (board 1 drew Pin).
