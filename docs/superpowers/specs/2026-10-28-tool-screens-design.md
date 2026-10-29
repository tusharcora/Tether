# Tool screens redesign: Builder, Crew, API client, Graph, Triggers, Settings (round 2)

Date: 2026-10-28 · Branch: `feature/app-like-demo-2` (from `main` 71e5523, after PR #10)

## 1. Intent

Round 1 (PR #10) made Home, the run view and Inbox calm and clean. The six tool screens are still dense: several
permanent panels at once, long lists, unreadable canvas nodes, help paragraphs in the way. The owner rejected making
them look like the landing-page demo ("redesign it completely, do not use the demo"), picked a mix of three mocked
directions, and approved the result for all six screens: "these look good, write the spec and build it".

Owner decisions (2026-10-28):
- **One language for the tool screens:** the work fills the window on a quiet dotted backdrop; tools **float** at the
  edges as small toolbars; editors and readers **dock on the right** only when something is opened, instead of
  permanent columns.
- **Builder** = Canvas **and** Outline as **two view modes** of the same workflow.
- **Crew** = the **Lineup** (role slots + a bench you drag from) inside the floating-tools frame.
- **API client, Graph, Triggers, Settings** follow the approved mockups.
- **The Graph must stay as animated and interactive as it is today.** Only its frame changes.
- Same features and behaviour as today. Nothing a screen can do today is removed; less-used things move behind a click.

## 2. References

- `docs/design/Round2Screens.html` — **approved mockup of all six screens** (open in a browser; every window is
  clickable: Builder mode switch and step selection, Crew drag-to-swap and role cards, API picker, Graph hover/click,
  Trigger cards and Setup, Settings section nav). Artifact `8iRteppy5SBzAKpJyaMK3f`.
- Rejected alternatives for context: the demo-based proposals (`ACrbGpqCia2i7zuaHWortz`) and the three separate
  directions (`7o9WDDTkSFV7CGarXwgXrL`).
- Round 1 shared pieces to reuse: `StatusBadge`/`status.ts`, `Section`/`RowList`/`QuietLine`/`Tag`/`Disclosure`
  (`ui/studio/Section.tsx`), the slide-over pattern of `runs/StepInspector.tsx`, crew faces, beui kit.

## 3. Goals

1. Each screen shows its main object large and readable, with at most one docked panel open at a time.
2. Every capability on these screens today is still reachable, at most one click away.
3. The six screens share one frame: backdrop, floating toolbars, docked panel, keyboard Esc to close.
4. The Graph keeps every animation and interaction it has today.

## 4. Non-goals and anti-goals

- Not in scope: Home, runs, Inbox, Code (done in round 1), the sidebar, the assistant.
- **No behaviour, API or data changes.** No new endpoints, no new stored state. Existing routes keep working
  (`#/builder`, `#/crew`, `#/api`, `#/graph`, `#/triggers`, `#/settings`, and any sub-routes they use today).
- **Anti-goals:** no purple or indigo, no glows, no bento stat tiles. Don't hide an action behind more than one click.
  Don't simplify the Graph's motion or interaction "for consistency".

## 5. The shared frame

- **Backdrop:** the screen's content area gets the dotted backdrop (Studio tokens; the same dot technique as the run
  graph, mask-based, since gradients are disallowed by `rules.test`).
- **Floating toolbars:** small rounded bars with a soft shadow, pinned to the top-left (screen title + one or two facts,
  e.g. "plan-code-review · saved", "Crew · 8 roles · 2 working") and top-right (the screen's actions, primary last).
- **Docked panel:** a 290–320 px panel floating at the top-right under the toolbar (same visual family as the step
  inspector), opened by selecting something; Esc or × closes it. One shared component for all six screens.
- **Left dock** (API client only): a floating panel on the left for the request tree.
- Phone/narrow widths: docks become bottom sheets; floating toolbars wrap.

## 6. Builder

Two modes of the same workflow, switched by a segmented control floating at the top centre. The selected step and
the docked editor survive the switch. Remember the last mode per session only.

- **Canvas mode:** the workflow as readable step cards (face, title, bot · kind, two-line prompt preview) joined by
  curves; a gate's fix loop drawn as a dashed curve back to its `fixNode` labelled "if it fails · back to <step> ×<maxLoops>".
  Keep today's canvas interactions: drag cards, connect ports, delete, zoom/pan, the action-node corner actions
  (run from here, edit, duplicate, delete). An **"+ Add step ⌘K" bar** floats at the bottom centre with quick kinds
  (Agent, Gate, Approval, Skill, HTTP, Webhook); it opens the palette as a searchable menu (steps, integrations and the
  387 skills) instead of a permanent left column.
- **Outline mode:** the same workflow as a numbered document: workflow title, description, then one block per step in
  order (face, title, "· <bot> on <model>", read-only/kind chips, prompt), gate loops written as a sentence ("If it
  fails, the output goes back to Code, up to 2 times."). Clicking a block selects it; typing "/" in the outline opens the
  same add-step menu.
- **Docked editor (shared by both modes):** bot, model, read-only, tools (Code Mode/direct), prompt, and the gate fields
  (command or http, fixNode, maxLoops). It replaces today's node `Inspector`.
- **Workflow settings** (mode, parallel read-only steps, step timeout, spend cap, upstream output, step order, setup
  command) open in the same docked panel from a "Settings" button in the top-right toolbar.
- Top-left toolbar: workflow name (editable) and saved/valid state; the workflow picker and New move into a menu on the
  name. Top-right: cap, Settings, Save (when dirty), Run.

## 7. Crew

- **Lineup:** the eight built-in roles as slots in a grid (role label, face, name, job, model chip, working/idle/you),
  on the backdrop. Clicking a slot opens the bot's card in the docked panel (today's `BotEditor` content: look, persona,
  agent and model, tools, write access, Evolve proposals).
- **Bench:** a floating dock along the bottom with the library (ECC and your own bots), searchable. **Dragging a bench
  bot onto a role slot links it to that role**, using today's link action (`PUT /api/bots/:role` or whatever the Crew tab
  uses today). Gate (a person) is not a drop target. A short note confirms "<bot> now plays <role>. Applies to the next
  run." Keyboard alternative: a "Swap…" action on each slot opens a picker.
- A "Library" toggle in the top-right shows or hides the bench. Crew packs, Evolve, Update ECC and Remove ECC move
  into one menu next to "+ New bot". Today's All / Built-in / Yours / ECC filtering lives in the bench's search/filter.

## 8. API client

- **Left dock:** the request tree grouped by folder, with a filter field; New request at its foot.
- **Centre:** two floating cards. Request: method + URL + Send, tabs Params / Headers / Body / Checks. Response:
  status pill, time and size, the response view, check results as pills, and history (today's sortable history) behind
  a "History" tab or disclosure.
- **Send to agent** is one button on the response card that opens a picker of crew faces (+ "Library…"), replacing the
  permanent column of bot tiles.
- Top-left toolbar: "API client", workspace chip (menu), environment chip (menu). Top-right: Secrets, Import · Export
  menu (import workspace, cURL/OpenAPI/Postman import, export), + New request. Empty state: one quiet line plus Import.

## 9. Graph

- **Keep `GraphBoard` and its behaviour unchanged:** force layout, dragging notes, hover lighting links with the 1–3 hop
  control, search pulse and fly-to, eased zoom/pan camera, double-click to focus, run pings on freshly written notes,
  the activity ticker, reduced-motion handling. Its tests must keep passing unchanged except for selectors the new frame
  moves.
- The graph fills the content area. Floating at top-left: "Graph · N notes · M links". Top centre: the search field and a
  type filter menu (runs / pipelines / roles / files with counts) instead of the row of pills. Top-right: a "Notes N"
  toggle. Remove the Reload button only if the data already refreshes on its own (it polls/streams today); otherwise keep
  it inside the filter menu.
- **The note reader and the notes list open in the docked panel** (one at a time) instead of a permanent right column.
  Clicking a note in the graph opens its reader; the "Notes" toggle opens the list; picking a note in the list focuses
  it in the graph (existing fly-to) and opens its reader.
- Zoom controls and the hint stay, restyled as a small floating toolbar at the bottom-left; a small legend of shapes at
  the bottom centre.

## 10. Triggers

- **Trigger cards** in a column: source icon, name, the source detail (repo or endpoint), a flow line of chips
  ("pull request opened → runs full-review → comments on the PR"), an on/off switch (today's enable/disable) and when it
  last fired. Clicking a card opens it in the docked panel (today's `TriggerForm`/row details: repo, events, workflow,
  then-action, on/off, remove). "+ New trigger" opens an empty one there.
- **Deliveries** become a floating log along the bottom (time, what arrived, status code coloured, outcome), with
  today's filter as a small menu in its header and live refresh.
- **Setup & test** (top-right button) opens the docked panel with today's webhook setup (payload URL with copy, content
  type, events, secret generate/rotate), the tunnel help folded away, and today's "Test a trigger" dry run.
- Empty state: one quiet line with "+ New trigger" and "Setup & test".

## 11. Settings

- **A full page at `#/settings`**, not a drawer. Remove the drawer-over-the-current-screen behaviour.
- A floating section list on the left that highlights as the page scrolls; sections are cards:
  - **Accounts** (today's GitHub gh/device flow and Google rows; the long instructions fold into "How connecting works").
  - **Agents & tools** (today's Agent tools and MCP servers sections).
  - **Appearance** (Theme; and today's Notifications).
  - **Storage** (Vault path with copy; anything else today shows about storage).
  - **Server** (Loopback only, Connection; webhook secret if today shows it here). Long text folds into a disclosure.
  - **About** (today's About).
- Every control keeps today's behaviour and copy where it is instructions; shorten only labels.

## 12. Constraints

- Web app in `web/` (React 19, Tailwind v4 without preflight next to Studio tokens; beui kit; motion; lucide). Same
  build ships in the Electron app.
- Tailwind classes are only generated for beui/bencho/aicss/faces/assistant sources (see `tw.css`/`tw.test`); new
  Studio components style through CSS files. beui components that render bare `<button>`s need the button reset added
  in round 1.
- No new npm dependencies; never `npm install` in this worktree (`node_modules` is a symlink).
- Web tests and typecheck must stay green; update tests that assert the old layouts.
- Commits: plain conventional messages, no Co-Authored-By or any Claude mention.

## 13. Left to the builder

Component boundaries; the shared frame component's API; exact spacing within the mockup's feel; the Builder canvas
layout algorithm (reuse what the Builder canvas does today, restyled, unless a readable layered layout is simpler);
how the add-step menu is built (reuse an existing menu/command component); the keyboard path for Crew swaps.

## 14. Done means

- In Chrome, against a copy of `~/.aorch` (never the real one), light and dark: each screen matches the mockup's
  layout; every action listed above works; the Graph's drag, hover hops, search fly-to, zoom/pan, double-click focus
  and run pings all still work.
- Web tests and typecheck pass.

## 15. Questions from the builder check, settled

The owner asked for this to be specced and built without another review round, so these were decided by Claude
under "same features and behaviour, no data changes" and are marked **(my call)**; the owner can overturn any.

1. **What a Crew drop does.** Nothing today lets one bot "play" another's role, and workflow steps point at bot ids.
   A drop therefore uses the existing identity override for built-ins: `PUT /api/crew/<builtin-id>` with the bench
   bot's name, persona and look (built-ins keep their kind; see `loadCrew` in `src/crew.ts`). The confirmation note
   has **Undo**, which restores the previous override (or `DELETE`s it if there was none). Only bench bots of the
   **same kind** as the slot are valid drop targets (agent → agent roles, verdict → Lens, etc.); other slots dim while
   dragging and refuse the drop. Gate takes no drops. Agent and model are not changed by a drop; the docked card still
   sets them through `PUT /api/bots/:role` as today. **(my call)**
2. **Settings as a page.** It covers the whole content area like a page, but the screen you came from stays mounted
   underneath (today's `screenRef` behaviour), so unsaved work survives, `leaves()` keeps skipping the dirty check for
   `settings`, and Esc / × return to that screen with focus restored, as the drawer does today. Only the presentation
   changes. **(my call)**
3. **Outline title and description.** `Pipeline` has only `name`, so the Outline's title is the workflow name and the
   line under it is generated from the steps (e.g. "6 steps · Scout → Brick → Bolt → Probe → Lens → Gate"), not stored
   and not editable. No schema change. **(my call)**
