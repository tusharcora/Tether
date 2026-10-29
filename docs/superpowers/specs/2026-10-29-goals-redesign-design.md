# Goals redesign: goal nodes, assignees, create menus, soft palette

Mockup: canvas GdPwgpVVdZssnLHUdmasJ7 (board **F** is the approved Goals page; board **A** has the detail page; "The create menu wherever you create things" has the create menus; board **G** has the hover options). Builds on `2026-10-28-goals-and-action-nodes-design.md` and Teams (`2026-10-29-teams-design.md`). Branch `feature/goals` is cut from `feature/teams`.

## 1. Intent

Goals are the units of work the owner hands to agents: features, bug fixes, refactors, chores. Today they are a plain list. The owner wants:

- each goal to read as an **action node**, the same object everywhere, which can be clicked to open a detail page;
- to **assign** a goal, and each step of it, to teams and individual agents;
- one **create menu** (bencho liq-create, `CreateMenu`) wherever something is created by picking from a few choices;
- the app's dark theme to be a **soft black and grey like Claude**, not pure black.

Success: the Goals page is easy to scan and navigate. Every goal in "Now" looks the same, shows who is on it and what happens next, and hands you one obvious action.

Anti-goals: uneven card sizes, gaps sized only to make room for buttons, buttons that disappear before the pointer reaches them, and dropdown forms where a few picks would do.

## 2. Data (server, `src/goals`)

- `Goal.type?: 'feature' | 'bugfix' | 'refactor' | 'chore'`. When missing, it reads as `feature` (my call: existing goals need no migration).
- `Goal.description?: string` (new, my call): one or two sentences, set in the New goal form and in Settings, trimmed, max 500 characters. A goal without one shows its check command or, for trackers, nothing (the node keeps its height).
- `Goal.endedAt?: number` (new, my call): set wherever status becomes `met` or `stopped` (`setStatus` and the loop's met path). Old goals without it fall back to their last item's `at`, then `createdAt`.
- `Goal.assignees?: Assignee[]` and `GoalItem.assignees?: Assignee[]`, where `Assignee = { kind: 'team' | 'agent'; id: string }`. Ids are Teams team ids and crew agent names.
- The existing `Goal.team` and `Goal.agent` (loop work in a team) keep their meaning. They show as the **Owner** on the detail page. Assignees are who works on it; they do not change how runs start.
- The create and patch routes accept `type` and `assignees`, and the item route accepts `assignees`. Validate both: an unknown `type` or an assignee `kind` is a 400. An assignee id that no longer exists is kept and shown as "removed".
- Add store columns the way existing optional fields are added (JSON in the row, or new nullable columns: match what `store.ts` already does).

## 3. Goals page (web, `web/src/goals/Goals.tsx`)

Follow board F exactly. Top to bottom:

1. **Header:** "Goals", the project name, and **+ New goal** (the create menu, §5).
2. **Now:** goals with status `needs_you` or `active`, `needs_you` first. They sit on a grid of **equal modules**: three equal columns, 16 px gaps, wrapping to more rows. Each module is identical:
   - a goal node of fixed height (168 px): type tile and title, a description cut at two lines, and avatars on the left with the status ("Bug fix · Live") on the right, always on the bottom line;
   - under it, a 48 px **next strip** with a label, a sentence and one button:
     - `needs_you` with a pending plan: amber "Needs you:", the plan's task, and a filled **Approve** (the existing `ApproveButton`);
     - an active loop: blue "Step n of m:" (attempts so far / max runs), the running item's text, and an outlined **Watch** that opens the run;
     - an active tracker: "Next:", the first unchecked item, and **Open**.
   - The border colour shows the status: amber for needs you, blue for live.
3. **Up next** and **Done**: two quiet lists side by side (16 px gap). Up next = `paused`; Done = `met` and `stopped`, newest first. A row is a type tile, title, up to 3 avatars, and a right-hand note (due date or "unscheduled" for Up next, the date it finished for Done). Hovering a row opens it into the full node, as on board F.
4. The All / Active / Met tabs go away. The lists replace them.

Clicking any node or row opens the detail page (§4).

### Hover actions: lift and dim

Every goal node has the four round buttons on an arc outside its top-right corner (the reference image): **Copy link**, **Add a step**, **Duplicate** and **Settings**.

- On hover or keyboard focus, the node rises 4 px with a soft shadow. The other nodes in the same grid fade to about 35%, so the arc reads as on top of them.
- The buttons are 40 px with an 8 px invisible hit ring. An invisible pocket covers only the arc's area, so moving to a button never closes it but the next node still responds to hover. Hiding waits 0.35 s.
- With reduced motion: no lift, no transitions; the fade stays.
- Scope (my call): the **pocket and the 0.35 s hide delay** go into the shared bencho `ActionNode`, so every fan in the app becomes forgiving. Its button size stays 28 px elsewhere; **40 px buttons and lift and dim are only for goal nodes** on the Goals page (an opt-in prop or a Goals wrapper). `inset` mode in scrolling lists keeps its current behaviour. Check every screen that uses `ActionNode` still works (Builder, Canvas, RunGraph, TriggerFlow, AllChats, Connectors, LoopFlow).
- Copy link copies the goal's in-app route (`#/goals/<id>`). Duplicate copies every field of any goal (title + " (copy)", type, description, assignees, and the loop fields for loops). Lift the existing `duplicate` out of `Detail` and widen it. **Add a step** appears only on trackers: it opens the detail page with the add-item input focused. Loops create their own steps, so it is hidden there. Settings opens `GoalSettings`.

### What board F looks like (for a builder who can't open the canvas)

- Page background `#191919`, cards `#262626` with radius 20, a 1 px border (amber `rgba(251,191,36,.45)` needs you, blue `rgba(147,197,253,.3)` live, faint white otherwise), 16–18 px padding.
- Type tile: 38 px rounded square `#383838`, coloured glyph. Title 15.5 px/500, description 13 px grey `#9a9a9a`.
- Avatars: 26 px circles with a radial highlight over the agent's colour (crew `look` colour), overlapping by 8 px, max 3 then "+N". A **team** avatar is a rounded square, not a circle, with the team's initial, so teams and agents tell apart at a glance.
- Next strip: `#222` background, radius 14, 48 px tall, label coloured by status, button on the right.
- Header: "Goals" 22 px/600, the project name in grey beside it, the create menu trigger on the right.
- Lists: rows 44 px tall, radius 12, hover `#222`. Hovering a row expands it **inline** into the full node (pushing rows down) with a 0.2 s fade and scale. Leaving collapses it.
- Owner pill (detail page): a small rounded pill "Owner" + avatar + name, in grey `#2f2f2f`, next to the status.
- Compact step picker: just the overlapping avatars (22 px) plus a "+" circle; clicking opens the same Picker.

## 4. Detail page

This keeps today's `Detail` (loop flow, tracker list, limits, approve, diff) and adds:

- a header with the type tile, title, and status, an **Owner** pill (team or agent, when set; read-only, only team chat sets it today), and an **Assignees** control: a bencho `Picker`, multi-select, with Teams and Agents as two groups. `Picker` has no groups yet: add optional group headings to it (small, backward compatible; existing callers unchanged);
- the same assignee picker, in its compact form, on every step: every `GoalItem` in the loop flow (run and manual items) and every tracker row;
- a **Type** selector in Settings (the four types).

## 5. Create menus (bencho `CreateMenu`)

Use the same liq-create menu, the one the sidebar already uses, wherever you create something by picking from a few choices. Each replaces what is there now:

| Place | Trigger (today's control) | Choices |
|---|---|---|
| Goals | "+ New goal" | Feature, Bug fix, Refactor, Chore → then the existing docked `NewGoalForm`, with the type set |
| Teams | the sidebar's New team icon (`Sidebar.tsx`) | In Tether; Slack channel and Telegram group disabled with "soon". The place radio in `NewTeam.tsx` goes away; the form opens with the picked place |
| Crew | "+ New bot" (`Crew.tsx`) | Coder, Reviewer, Planner, Tester. A preset only prefills the new-bot form's title, persona and look; the bot is always a new library bot of kind `agent` with its own new id and name (never a built-in's id or name). Planner also sets read-only |
| Chats | every New chat button (sidebar icon, assistant panel header, chat switcher) | Empty chat; About a run; About a file. The last two open New chat with the matching existing starter prefilled ("Why did run X fail?", "Explain a file"); no new chat types |
| API client | "+ New request" | Request; Import cURL (opens the Import dialog on its cURL mode) |
| Sidebar | (already uses it) | no change |

Left out on purpose (my calls, under your rule "simple selections"): **Builder Add step** stays the searchable palette (it has roles, integrations and skills, too many for a pick menu), and **Triggers** has only one trigger type today, so a menu would hold a single choice. API client's Folder is left out because there is no folder action yet. Places where you type more than you pick keep their text boxes.

## 6. Soft palette (`web/src/studio.css`, dark theme only)

Lift the dark tokens from near-black to Claude-like soft greys. The mockup uses page `#191919`, card `#262626`, raised `#2f2f2f` and tile `#383838`. Map them to `--bg`, `--s1`, `--s2`, `--s3` and the sidebar tokens so the whole app moves together. Keep the contrast notes in that file true: `--edge` at 3:1 or more and `--mut` at 4.5:1 or more on `--bg` and `--s1`. Adjust `--edge` and `--mut` if needed, and update the comments with the new ratios. Light theme is unchanged.

## 7. Testing

- Server: type, description and assignees round-trip through create, patch and item routes; bad values are 400s; old goals with no type read as `feature`; `endedAt` is set on met and on stop.
- Web (`Goals.test.tsx`): sections sort goals by status; the next strip picks the right label and action for needs-you, live loop and tracker; clicking a node opens the detail page; the assignee picker saves.
- Keep the existing tests green. `tw.test.ts` still guards the Tailwind `@source` list if new folders get classes.
- Check it by hand in the rebuilt Mac app: the hover arc on adjacent nodes, the palette across Home, Chats, Teams and Goals.

## 8. Out of scope

- Assignees changing who runs the work (Owner still does). Assignees are who's responsible, for now.
- Drag to reorder, a board or map view (boards B–D), filtering by assignee.
- The light theme.

## 9. Left to the builder

The exact component split, how the next strip finds the running item, store column layout, the type tile's glyph and colour per type (the mockup uses `+` blue, `!` red, `↻` cyan, `·` grey), and how the compact step picker looks, within the mockup's style.
