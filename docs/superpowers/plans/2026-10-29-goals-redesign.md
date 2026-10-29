# Goals Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (one implementer builds the whole plan; the controller reviews at checkpoints). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Goals become equal-size action nodes with assignees, a detail page with an Owner and per-step assignees, the bencho create menu in five more places, and a soft-grey dark palette.

**Architecture:** Server adds four optional goal fields and one item field through the existing additive migration and route validators. Web reworks `Goals.tsx` into Now / Up next / Done, extends the shared `Picker` (groups) and `ActionNode` (hover pocket, hide delay, large size), and swaps five create buttons for `CreateMenu`.

**Tech Stack:** Node 24 (node:sqlite), TypeScript, React 19, Vite, Tailwind v4, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-29-goals-redesign-design.md`. Read it fully; §3 "What board F looks like" holds the exact visual values.

## Global Constraints

- Branch `feature/goals` (cut from `feature/teams`). Commit after each task. No Co-Authored-By trailers or Claude mentions in commits.
- Never touch the real `~/.aorch`: tests use temp homes only. No pushes, no PRs.
- Migration only adds columns (`ensureGoals` pattern); an older database must open unchanged.
- Assignee = `{ kind: 'team' | 'agent'; id: string }`. Goal type = `'feature' | 'bugfix' | 'refactor' | 'chore'`, missing reads as `'feature'`.
- `description`: trimmed, max 500 chars. Up to 3 avatars, then "+N".
- Goal nodes: 168 px node + 48 px next strip, 3 equal columns, 16 px gaps. Fan buttons 40 px on goal nodes only; 28 px (`DOT`) elsewhere. Hide delay 0.35 s everywhere. Lift 4 px; others fade to 0.35.
- Dark palette: `--bg #191919`, cards `#262626`, raised `#2f2f2f`, tile `#383838`; `--edge` ≥ 3:1 and `--mut` ≥ 4.5:1 on `--bg` and `--s1`. Light theme unchanged.
- Reduced motion: no lift, no transitions.
- New Tailwind class folders must be listed in `web/src/tw.css` `@source` (guarded by `tw.test.ts`).

## Review Focus

1. An assignee whose team or agent was deleted: shows a grey "removed" avatar, never crashes the page or picker.
2. No goals in Now (or none at all): a quiet empty line per section, not a blank gap or a broken grid.
3. A 120-character title or a 500-char description: clamped inside the fixed 168 px node; the next strip never moves.
4. Keyboard only: Tab to a goal node shows its arc (focus-within) and every arc button is reachable and labelled; Enter opens the detail page.
5. A goal with 6 assignees: 3 avatars + "+3" on node and row; the picker still lists all six as selected.

---

### Task 1: Server fields (type, description, assignees, endedAt)

**Files:** Modify `src/goals/types.ts`, `src/goals/store.ts`, `src/goals/routes.ts`, `src/goals/loop.ts` (met/stop paths); web mirror `web/src/goals/goalsApi.ts` if it re-declares types. Test: `test/goals.test.ts`.

**Interfaces — Produces:**
- `export type GoalType = 'feature' | 'bugfix' | 'refactor' | 'chore'`
- `export interface Assignee { kind: 'team' | 'agent'; id: string }`
- `Goal.type?: GoalType; Goal.description?: string; Goal.assignees?: Assignee[]; Goal.endedAt?: number`
- `GoalItem.assignees?: Assignee[]`
- Create and PATCH `/api/goals/:id` accept `type`, `description`, `assignees`; the item PATCH accepts `assignees`.

- [ ] Write failing tests in `test/goals.test.ts`: `type/description/assignees round-trip on create and patch`; `item assignees round-trip`; `rejects bad type (400)`; `rejects assignee kind "user" (400) and >20 assignees (400)`; `description over 500 chars is 400`; `old row without new columns reads type undefined and opens`; `endedAt is set when a goal is met and when stopped`.
- [ ] Run `npx vitest run test/goals.test.ts` → those fail.
- [ ] Add columns `type TEXT, description TEXT, assignees TEXT (JSON), ended_at INTEGER` to `goals` and `assignees TEXT` to `goal_items` via the existing `PRAGMA table_info` loop. Map them in `toGoal` / item mapper. Validators in `routes.ts` next to `text()`/`oneOf`. Set `ended_at` wherever status becomes `met` or `stopped`.
- [ ] Run tests → pass; run `npm test` → green.
- [ ] Commit `feat(goals): type, description, assignees and endedAt`.

### Task 2: Picker groups

**Files:** Modify `web/src/components/bencho/Picker.tsx`; Test `web/src/components/bencho/Picker.test.tsx`.

**Produces:** `PickerOption.group?: string`. Options sharing a group render under a small heading in first-seen order; options without a group render first with no heading. Existing callers unchanged.

- [ ] Failing test `renders group headings in order and keeps keyboard order across groups`; and existing Picker tests stay green.
- [ ] Implement; run `npx vitest run web/src/components/bencho/Picker.test.tsx` → pass. Commit `feat(picker): option groups`.

### Task 3: ActionNode forgiving hover

**Files:** Modify `web/src/components/bencho/ActionNode.tsx`, `ActionNode.css`; Test `ActionNode.test.tsx`.

**Produces:** every fan keeps its buttons for 350 ms after the pointer leaves (CSS `transition-delay` on hide, 0 on show) and has an invisible pocket over the fan's area only (not the whole node). New prop `size?: 'md' | 'lg'` (`lg` = 40 px buttons with an 8 px invisible hit ring; `md` = today's `DOT`). `inset` mode unchanged.

- [ ] Failing tests: `lg size renders 40px buttons`; `fan buttons have accessible labels and are reachable by Tab when tabbable`; existing tests green.
- [ ] Implement in CSS where possible (no JS timers). Run ActionNode tests → pass. Open Builder, RunGraph, TriggerFlow, LoopFlow, AllChats, Connectors in `npm run dev` and confirm fans still open and nothing is clipped. Commit `feat(action-node): forgiving hover pocket and hide delay`.

### Task 4: Goals page (Now / Up next / Done)

**Files:** Modify `web/src/goals/Goals.tsx`, `web/src/goals/goals.css`; Create `web/src/goals/GoalNode.tsx` (node + next strip + arc), `web/src/goals/Avatars.tsx` (circle for agents, rounded square with initial for teams, "removed" grey, "+N"); Test `web/src/goals/Goals.test.tsx`.

**Consumes:** Task 1 fields, Task 3 `ActionNode size="lg"` (or its CSS) for the arc.
**Produces:** `GoalNode({ goal, onOpen, actions })`, `Avatars({ who: Assignee[], size: 22 | 26 })`, `sectionOf(g: GoalView): 'now' | 'next' | 'done'`, `nextStrip(g: GoalView): { label: string; text: string; action: 'approve' | 'watch' | 'open'; tone: 'needs' | 'live' }`.

- [ ] Failing tests: `sectionOf` (needs_you/active → now, paused → next, met/stopped → done; needs_you sorts before active; done newest `endedAt` first); `nextStrip` (needs_you + pending → "Needs you:" + task + approve; active loop → "Step n of m:" + running item text + watch; active tracker → "Next:" + first unchecked item + open); `clicking a node opens the detail`; `empty Now shows a quiet line`; `6 assignees show 3 avatars and +3`; `removed assignee renders`; `node keeps fixed height with long title` (style/class check).
- [ ] Implement per spec §3 and its board F values: 3-column grid with 16 px gap, lift and dim (CSS `:hover`/`:focus-within` on the grid), arc with Copy link / Add a step (trackers only) / Duplicate (all fields, widened from `Detail.duplicate`) / Settings. Rows expand inline on hover. Remove the All/Active/Met tabs.
- [ ] Tests pass; `npm test` green. Commit `feat(goals): equal goal nodes, next strip, quiet lists`.

### Task 5: Detail page, Settings, New goal form

**Files:** Modify `web/src/goals/Goals.tsx` (`Detail`, `GoalSettings`), `web/src/goals/LoopFlow.tsx`, `web/src/goals/Tracker.tsx`, `web/src/goals/NewGoalDialog.tsx`; Create `web/src/goals/AssigneePicker.tsx`; Test `Goals.test.tsx`.

**Consumes:** Task 2 groups, Task 4 `Avatars`. Teams list and crew agents from the existing web APIs used by `Team.tsx` / `Crew.tsx`.
**Produces:** `AssigneePicker({ value: Assignee[], onChange, compact?: boolean })` — groups "Teams" and "Agents", multi; compact = avatars + "+" circle that opens it.

- [ ] Failing tests: `assignee picker saves via PATCH`; `step picker saves via item PATCH`; `owner pill shows team/agent when set and is read-only`; `settings changes type and description`; `new goal form sends type and description`.
- [ ] Implement per spec §4. Tests pass. Commit `feat(goals): owner, assignees, type and description on detail`.

### Task 6: Create menus

**Files:** Modify `web/src/goals/Goals.tsx`, `web/src/ui/studio/Sidebar.tsx` + `web/src/teams/NewTeam.tsx` (or wherever `NewTeam` lives), `web/src/Crew.tsx`, the three New chat buttons (sidebar, assistant panel header, chat switcher) + `web/src/chats/NewChat.tsx`, the API client "+ New request". Tests: next to each touched component's existing test file.

**Consumes:** `CreateMenu` as `Sidebar.tsx` uses it today.

- [ ] Failing tests, one per place: `New goal menu opens form with type preset`; `New team menu: In Tether opens form with place set, Slack/Telegram disabled "soon", no place radio`; `New bot presets prefill title/persona/look, never a built-in id or name; Planner sets read-only`; `New chat "About a run" prefills the run starter`; `API New: Import cURL opens Import on cURL mode`.
- [ ] Implement per spec §5 table (Builder and Triggers untouched). Tests pass; `npm test` green. Commit `feat(ui): create menu in goals, teams, crew, chats, api`.

### Task 7: Soft palette

**Files:** Modify `web/src/studio.css` (dark block only), any hardcoded near-black in `web/src/**/*.css` that bypasses tokens.

- [ ] Set dark `--bg/--s1/--s2/--s3` and `--side*` per Global Constraints; compute and update the contrast comments for `--edge` and `--mut` (adjust values until ≥ 3:1 / ≥ 4.5:1). Grep for `#0a0a0b|#111113|#0f0f11` leftovers and replace with tokens.
- [ ] `npm test` and `npm run -s build` (or the repo's web build) green. Commit `style: soft grey dark palette`.

### Task 8: Verify in the Mac app

- [ ] `npm test` and typecheck green.
- [ ] Rebuild: `pkill -9 -f "Tether.app/Contents"; TETHER_APP_OUT=/Users/tushar/dev/tether-app npm run -s app` (controller opens it). Report anything that could not be checked.
