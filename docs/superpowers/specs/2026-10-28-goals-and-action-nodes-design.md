# Goals and action nodes across the app

Date: 2026-10-28 · Branch: `feature/goals-action-nodes` (from main @ 607de0f)
Approved mockups: `docs/design/AppGoals.dc.html`, `docs/design/AppActionNodes.dc.html`.

## 1. Intent

Owner decisions, 2026-10-28:
- **Goals come in two kinds.**
  - With a finish check, a goal is an **outcome loop**. Tether proposes runs toward it and re-runs the check after each run. It continues until the check passes or a cap is hit.
  - Without a check, a goal is a **tracker**: a checklist of manual items and linked runs.
- **Lists stay rows.** The Goals list follows the Runs and Inbox style, Linear-style rows. The owner rejected a grid of node cards.
- **Action nodes appear only where the app draws connected steps on a canvas.** The places are:
  - a goal's loop
  - an **expanded** run
  - a trigger's detail
  - the Connectors map
- **Expanded runs only.** The node flow shows only when a run is expanded, meaning the run page is open or a row is expanded. Collapsed runs stay rows everywhere: Runs, Home and the sidebar.

Use the existing port `web/src/components/bencho/ActionNode.tsx` (MIT, comments kept) for every node.
- Add a compact variant: 300 px wide, 16 px corner, status dot on the mark.
- Fans hold only secondary actions, and never delete.
- A node that is an approval (a gate, or a goal's Next run) shows its primary buttons visibly.

## 2. Goals: data and engine (server)

### Store
`node:sqlite` in the existing DB, through a migration. Two tables:
- `goals`: id, workspace, title, kind (`loop` or `tracker`), status (`active`, `needs_you`, `paused`, `met`, `stopped`), check (kind `command`/`tests`/`number`, command, target), budgetUsd, maxRuns, approval (`ask` or `auto`), workflow (team or workflow id), dueDate, createdAt.
- `goal_items`: goal id, kind (`manual` or `run`), text, runId, done, and the check results per attempt.

### The loop
- **Running the check.** The check runs in the workspace through the existing command-gate runner. It records pass or fail, the parsed counts where possible (e.g. "1 failing · 11 passing") and a trimmed output tail.
- **Proposing the next run.** When the check fails and the caps allow, the default crew agent proposes the next run, reusing the assistant's lean call and proposal format. It gets the goal, the last check output and the previous attempts.
  - With approval `ask`, the goal waits as `needs_you`, and the Inbox and Home show it.
  - With approval `auto`, the run starts at once. Still never past the caps.
- **After a run finishes.** The check runs again, and the attempt records the before and after results and the run's cost.
- **Ending the loop.**
  - The check passes: the goal becomes `met`.
  - The budget or run cap is reached: the goal becomes `stopped`, with a reason.
- **Pause and Stop** are available at any time. A run already going finishes; nothing new starts.

### API
- `GET`/`POST /api/goals`
- `GET`/`PATCH`/`DELETE /api/goals/:id`
- `POST /api/goals/:id/check`
- `POST /api/goals/:id/next`, with `{action: start|skip, plan?}`
- `POST /api/goals/:id/items`
- Goal changes stream over SSE the same way runs do.

### Rules
- Nothing outward-facing happens without approval unless the goal is on `auto`. Costs count against the budget.
- Tests use a scratch home and never touch `~/.aorch`.

## 3. Goals (web)

- **Navigation:** a Goals row in the sidebar's Workspace section (lucide `target`, with a count) and route `#/goals`. It also appears in the ⌘K palette and the create menu ("New goal").
- **List:** about 400 px of rows. Each row has a RunGlyph-style status, the title, a meta line and a 3 px progress bar. A goal that needs you shows an amber "Approve run" button in the row. All / Active / Met tabs sit above the list.
- **Loop detail:**
  - Header: title, status, Pause and Stop.
  - A limits strip: budget meter, runs, and Ask each run / Auto.
  - The **loop flow**: a vertical chain of action nodes on a dot grid, joined by links.
    - **Finish check:** fan holds Run check, Edit command and Settings. The output expands.
    - **One node per attempt:** before → after and cost. Fan holds Open run, Retry and View diff.
    - **Dashed Next run:** Start run, Edit plan and Skip are visible. Fan holds Duplicate and Settings.
- **Tracker detail:** a todo-list of manual items and linked runs, an add-item input, the due date, and "Add a finish check → turn into a loop".
- **New goal dialog:** the center-morph dialog from the beui kit, with the fields from the mockup.
- **Delete** is in Settings, behind the alert-dialog.

## 4. Expanded run: node flow

- **Where it shows:** when a run is expanded (the run page, or an expanded row where that exists), its steps draw as a left-to-right flow of compact action nodes on the dot grid.
- **The flow:**
  - **Node:** the bot face, the status dot, and the live line (the current tool call).
  - **Fan:** Open logs, Retry from here, View diff, Pause/Resume, using existing actions only.
  - **Gates:** show Approve and Reject visibly.
  - **Fix loops:** amber dashed curves.
  - **Selecting a node:** opens its step log (tool-result style) in a right panel that is closed by default.
- **Where it doesn't show:** collapsed runs keep their row everywhere. The existing timeline and log views stay reachable from the run page.

## 5. Trigger detail: node flow

- **Layout:** the Triggers screen keeps its list. The selected trigger shows Event → Filter → Workflow as action nodes, with the beui data table of deliveries below.
- **Event node fan:** Test fire, Pause, Copy URL, Settings.
- **Workflow node fan:** Open workflow, Run now, Settings.
- **No filter set:** the Filter node shows "All events".

## 6. Connectors map: Settings → Connectors

- **Layout:** a Tether node in the center ("Code Mode · run_code") with the Code Mode connectors radiating out: repo, github, http, each `mcp.<server>`, and a dashed "Add connector".
- **Data:** read from the existing codemode connector registry and the accounts state.
- **Status:**
  - green: connected
  - amber: needs you (an expired token, or approval required)
  - gray dashed: off
- **Fan:** Test, Reconnect, Permissions, Settings.
- **Selecting a node:** shows its permissions and its recent calls and approvals, from the codemode logs. No secrets reach the browser.
- **Narrow widths:** leave at least 72 px between nodes and the panel, so the fans have room. Below 900 px, fall back to a list.

## 7. Testing

**Node**
- the goals store and migration
- the loop: check fails → proposal → start → re-check → met; budget and run caps → stopped; pause; `auto` vs `ask` (nothing starts on `ask` without the call)
- the routes
- SSE
- the connectors API shape, with no secrets in it

**Web**
- Goals rows and the visible Approve
- the loop flow nodes and their fans (keyboard reachable, reduced motion)
- the tracker checklist
- the New goal dialog
- the expanded run flow, shown only when expanded
- the trigger flow, and Test fire calling the existing endpoint
- connectors status colours
- `rules.test.ts` stays green

**Manual:** a Chrome check of each screen in both themes, on a scratch home.

## 8. Out of scope

Number-target checks beyond a simple "command prints a number ≤/≥ target", multi-goal dependencies, and Google accounts.
