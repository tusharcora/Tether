# Code and Goals in the Tool-Screen Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Code and Goals into the PR #12 frame (dotted backdrop, floating bars, a left dock for the list, the right
`Dock` on demand) and add the Code polish the owner approved (editor card, gutter marks for every run, status bar).

**Architecture:** Both screens keep their state and handlers; only layout moves into `ToolScreen` / `FloatBar` / `Dock`.
Goals' two dialogs (Settings, New goal) become forms rendered in the `Dock`. Code's runs lens moves into the `Dock`; the
editor card gains a path line, strips and a status bar; `Editor` takes every run's hunks for the gutter and reports the
cursor. One vendored beui change: the file tree draws a guide line for every ancestor level.

**Tech Stack:** React 19, TypeScript, CodeMirror 6, vendored beui (Tailwind utilities only in beui/bencho/aicss/faces/
assistant sources), Studio CSS tokens, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-28-code-goals-frame-design.md`. Approved mockup: `docs/design/CodeGoals.html`.

## Global Constraints

- Work only in `.claude/worktrees/app-like-demo` on `feature/code-goals-frame`. Never `npm install`; no new dependencies.
- No behaviour, API, data or server changes. Routes `#/code/<path>:<line>` and `#/goals/<id>` keep working.
- Nothing the screens do today may be lost: every action stays reachable.
- No purple or indigo, no glows, no gradient backgrounds (`rules.test`); tokens only; light and dark; reduced motion respected.
- Studio components style through CSS files; beui bare buttons get the reset where they sit in Studio CSS.
- Bottom bars clear the assistant launcher (`--tf-launcher`).
- Commits: plain conventional messages; never `Co-Authored-By`, never "Claude". Do not push.
- Each task ends with `npx vitest run web/src/<touched paths>` and `npm run typecheck` clean.

## Calls (where the spec leaves a gap or disagrees with today's code)

- **Code has no project switch** (projects switch in the sidebar), so the bar shows the project name as a label chip
  (title = its folder). **No branch**: no Code endpoint returns one; the bar and status bar omit it (spec §3.5 rule).
- **Search results stay in the left dock** (the tree's place, as today). The spec's "in the editor card's place, as today"
  contradicts itself; keeping them on the left keeps hit-after-hit browsing with the editor visible.
- **The Code filter stays today's All files / Changed by runs control**; no new text filter.
- **The lock strip keeps today's words** ("… is editing files in this folder in run R. Saving is paused until the step
  finishes.") because the lock is per folder and only pauses saving; the mockup's "Read-only until the run finishes" would
  describe behaviour the app does not have. The face is looked up by the lock's bot name in the crew; none if not found.
- **Words stay "runs"** (list line "loop · 1 of 4 runs", limits "Runs"), matching LoopFlow's "Run 1" and "Max runs".
- **Goals keeps its All / Active / Met filter** (left dock head), the row Approve button, and the Approval switch (in the
  limits bar, where it sits today). Turn into a loop stays a dialog (`CheckDialog`); so does View diff.
- **No goal picked → the first listed goal shows without a route change** (no history entry, so Back still works).
- **Settings shows for trackers too** (spec lists it unconditionally; the form already handles trackers: due date, delete).
  **Duplicate shows in the bar only when today offers it** (a loop with a proposed next run).

## Review Focus

1. **A line touched by a live and a finished run**: the gutter shows blue (live wins); picking the finished run tints its
   lines green while the gutter stays blue. Pinned in Task 4 (`marks every run in the gutter; live wins; the picked run is tinted`).
2. **Hunks outside the file on disk** (a run's version was longer; a pure deletion has 0 lines): ignored, no crash.
   Pinned in Task 4 (same test, a hunk at line 9 of a 4-line file and a 0-line hunk).
3. **Switching files or closing the runs panel with a run picked**: the pick clears (no stray tint), the panel follows the
   open file. Pinned in Task 3 (`closing the runs panel or switching files clears the picked run`).
4. **The open goal deleted from the Settings dock, or a route id not in the list**: the dock closes, the first goal
   shows, nothing crashes. Pinned in Task 1 (`deletes from the Settings dock after asking`, `an unknown id shows the first goal`).
5. **Long paths and many open tabs**: tabs scroll inside the card header, Edit and Save stay visible. Pinned in Task 3
   (`keeps Edit and Save visible with many tabs`, CSS: `.code-tablist` `overflow-x: auto`, `.code-tab-actions` `flex: none`).

---

## File map (under `web/src/`)

| Area | Modify | Create / Delete |
|---|---|---|
| Goals | `goals/Goals.tsx`, `goals/NewGoalDialog.tsx`, `goals/Tracker.tsx`, `goals/goalsApi.ts`, `goals/goals.css`, `goals/Goals.test.tsx` | — |
| Code frame | `code/Code.tsx`, `code/RunsLens.tsx`, `code/code.css`, `code/Code.test.tsx`, `components/beui/motion/file-tree.tsx` | — |
| Editor | `code/Editor.tsx`, `code/cmTheme.ts`, `code/Editor.test.tsx` | — |

---

### Task 1: Goals in the frame

**Files:** Modify `goals/Goals.tsx`, `goals/NewGoalDialog.tsx`, `goals/Tracker.tsx`, `goals/goalsApi.ts`, `goals/goals.css`; Test `goals/Goals.test.tsx`

**Interfaces:**
- Consumes: `ToolScreen`, `FloatBar`, `Dock` (`ui/studio/ToolFrame`), `ListRow`, `QuietLine`, `StatusBadge`.
- Produces:
  ```ts
  export function goalLine(g: GoalView): string; // goalsApi.ts: 'loop · 1 of 4 runs' | 'tracker · 1 of 2 done'
  export function NewGoalForm(p: { projects: WorkspaceRow[]; current?: string; workflows: string[]; onCreated: (g: GoalView) => void; onCancel: () => void }): JSX.Element; // replaces NewGoalDialog
  // Goals.tsx (internal): GoalSettings(p: { goal: GoalView; onClose: () => void; onSaved: (g: GoalView) => void; onDeleted: () => void }) replaces SettingsDialog
  // Tracker loses onToLoop (the bar has Turn into a loop)
  ```
- Layout (`ToolScreen className="gl-screen"` + `docked` while the Dock is open):
  - `<aside className="gl-list" aria-label="Goals">` at top 64 / left 16 / bottom 16, width 236: `<h1>Goals</h1>` + today's filter, the alert, `ListRow`s (no lead; title; meta `goalLine(g)`; actions `StatusBadge`; extra: progress bar — `spentUsd / budgetUsd` for loops (`aria-label="<title> budget used"`), items done for trackers (`"<title> progress"`), `.met` green — then `ApproveButton` when `needs_you && pending`), a `QuietLine` when empty (`No goals yet. A goal is an outcome Tether works toward: …` / `No goals here.`), and a `+ New goal` row button.
  - Open goal = `mine.find(id === selected) ?? shown[0]`. `FloatBar at="left"` (offset to `left: 268px`): `<h2>` title, `StatusBadge` (today's tone/label), muted kind line (`Outcome loop · Team` / `Outcome loop · Workflow x` / `Tracker`, plus today's met summary). `FloatBar at="right"`: Pause/Resume goal + Stop (loop, not met/stopped), Turn into a loop (tracker), Settings, Duplicate (loop with `pending`), `+ New goal` (primary) last.
  - `.gl-canvas` (top 64 / left 268 / right 16, bottom 84 for loops, 16 for trackers; `docked` → right 352): the stopped reason note, then `LoopFlow` or the `Tracker` as a floating card (`.gl-canvas .gt`, width 480).
  - Loops: `FloatBar at="bottom" className="gl-limits"` holding `role="group" aria-label="Limits"`: Budget (`$x of $y`, bar "Budget used"), Runs (`n of max`, bar "Runs used"), today's Approval control; `max-width: calc(100% - 2 * var(--tf-launcher))`.
  - `Dock` "Goal settings" (`GoalSettings` keyed by goal id; Delete asks inline: "Delete <title>?" + "The goal and its checklist go. Its runs stay in Runs." + Cancel / Delete goal) or "New goal" (`NewGoalForm`). LoopFlow's Settings fan items and the bar open the settings dock; `useCreateIntent` and both New goal buttons open the new-goal dock.
  - Phone (≤899 px): bars, list and canvas go back into the flow, stacked (as `api.css` does).

- [ ] **Step 1: Write the failing tests** (`Goals.test.tsx`; update the existing ones to the new frame)

```tsx
expect(goalLine(loop())).toBe('loop · 1 of 4 runs');
expect(goalLine(tracker())).toBe('tracker · 1 of 2 done');

it('docks the list left and shows the first goal when none is picked, without a route change', () => {
  renderApp(<Goals {...props([loop(), tracker()], { onSelect })} />);
  const list = screen.getByRole('complementary', { name: 'Goals' });
  expect(within(list).getByRole('progressbar', { name: 'Login tests green budget used' }).getAttribute('aria-valuenow')).toBe('24');
  expect(within(list).getByText('tracker · 1 of 2 done')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2, name: 'Login tests green' })).toBeTruthy();
  expect(onSelect).not.toHaveBeenCalled();
});
it('an unknown id shows the first goal', () => { /* selected: 'gone' → heading 'Login tests green' */ });
it('puts the goal actions in the top bar and the limits at the bottom', async () => {
  // loop active: Pause goal → PATCH {status:'paused'}; Stop present; Settings opens complementary 'Goal settings'
  // group 'Limits': progressbar 'Budget used' = 24, 'Runs used' = 25, radio/segment 'Auto' → PATCH {approval:'auto'}
});
it('deletes from the Settings dock after asking', async () => {
  // Settings → change 'Budget ($)' to 8 → Save → PATCH {budgetUsd: 8, maxRuns: 4, dueDate: null}
  // Settings → 'Delete goal…' → text 'Delete Login tests green?' → 'Delete goal' → DELETE /api/goals/g1; drop('g1'); onSelect(); dock gone
});
it('turns a tracker into a loop from the bar', () => { /* 'Turn into a loop' → dialog 'Add a finish check' */ });
// New goal: '+ New goal' (first of several) opens complementary 'New goal' (no dialog); Create goal → POST; dock closes; onSelect(g.id)
```

- [ ] **Step 2:** `npx vitest run web/src/goals` → FAIL (`goalLine` missing, no complementary 'Goals').
- [ ] **Step 3:** Implement the layout above; dialogs → dock forms; rewrite `goals.css` for the frame (tokens only, keep `@media (prefers-reduced-motion: reduce)`).
- [ ] **Step 4:** `npx vitest run web/src/goals web/src/home web/src/inbox` → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): goals in the tool-screen frame: list dock, goal bars, centred flow, limits bar, settings and new goal in the dock"`

### Task 2: Code in the frame, and the tree's polish

**Files:** Modify `code/Code.tsx`, `code/RunsLens.tsx`, `code/code.css`, `components/beui/motion/file-tree.tsx`; Test `code/Code.test.tsx`

**Interfaces:**
- `RunsLens(p: { runs?: RunTouch[]; error?: string; onRetry: () => void; selected?: string; onSelect: (runId?: string) => void; onOpenRun: (runId: string) => void })` — no `idle`, no own heading (the Dock names it); root `div.code-lens`.
- Code layout (`ToolScreen className={cn('code', { docked: runsOpen, phone })}`):
  - `FloatBar at="left"`: `<h1 className="code-title">Code</h1>`, `<span className="code-chip" title={project.path}>{project.name}</span>`, when git `<span className="code-fact">{files} files · {n} changed by runs</span>`, on a phone the Files button (drawer as today).
  - `FloatBar at="right"`: today's search field (`aria-label="Search code"`, ⌘⇧F).
  - `<aside className="code-tree" aria-label="Project files">` (desktop; inside the Files drawer on a phone) at top 64 / left 16 / bottom 16, width 236: filter, not-git note, `.code-pane`, and when git a legend `<p className="code-legend"><span className="code-run-dot" />changed by a run in 30 days</p>`.
  - `section.code-main[aria-label=Editor]` as the floating card (top 64 / left 268 / right 16 / bottom 16; `.code.docked` → right 352). Inner parts as today for now; the file bar gets the runs chip: `<button className="code-runs-chip" aria-expanded={runsOpen}>{n} run(s) touched it</button>` when `runs.data.length`, `Runs did not load` on an error.
  - `Dock label="Runs on this file" head={<h2>Runs on this file</h2> <span>{name}</span>}` holding `RunsLens`; the phone's Runs drawer and button go (the Dock is a bottom sheet there).
- Tree polish (CSS + one vendored change): beui already draws file/folder icons; `file-tree.tsx` draws a guide `span` for every ancestor level (`left: 16 + i * indent`, i in 0..depth-1) instead of the parent's only; `.code-git` is a small tinted letter (`padding: 1px 5px; border-radius: 4px; background: var(--s2)`; `.g-mod` warn on warnBg, `.g-add` ok on okBg, others neutral — the red `.g-del` rule goes); `.code-run-dot` is `var(--acc)`.

- [ ] **Step 1: Write the failing tests** (update the existing Code tests to the frame)

```tsx
// 'says where it is': heading 1 'Code'; chip 'shop' with title '/code/shop'; text '4 files · 1 changed by runs'; legend 'changed by a run in 30 days'
// 'draws a guide line for every level': deep link src/http/c.ts → its treeitem has 2 guide spans (`:scope > span.w-px`), src/a.ts has 1
// git badge CSS: cssRule('.code-git.g-mod') has 'background: var(--warnBg)'; '.code-run-dot' has 'background: var(--acc)'
// runs: button /2 runs touched it/ → complementary 'Runs on this file' holds the runs (pick, diff, Open run as today)
// not git: no /touched it/ button, no legend
// bounded: '.code-tree' and '.code-main' have 'position: absolute', 'min-height: 0', 'overflow: hidden'; '.code.docked .code-main' has 'right: 352px'; '.code-pane' 'flex: 1','min-height: 0','overflow: auto'; editor wrap/editor as today; tree sits in '.code-tree > .code-pane'
```

- [ ] **Step 2:** `npx vitest run web/src/code` → FAIL.
- [ ] **Step 3:** Implement as above; `code.css` frame rules replace the grid (`.code-grid` goes).
- [ ] **Step 4:** `npx vitest run web/src/code web/src/rules.test.ts` → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): code in the tool-screen frame: tree dock with guides, badges and legend, runs in the dock"`

### Task 3: The editor card

**Files:** Modify `code/Code.tsx`, `code/Editor.tsx`, `code/code.css`; Test `code/Code.test.tsx`, `code/Editor.test.tsx`

**Interfaces:**
- `EditorProps.onCursor?: (line: number, col: number) => void` — 1-based line and column of the main selection head; called on selection changes and when a document is shown.
- Card, top to bottom:
  1. `.code-tabs` header (background `var(--side)`): tabs with a lucide `File` icon, the name, the amber `.code-dirty` dot (sr "unsaved"), × (`opacity: 0` unless the tab is hovered, current or has focus within); then Edit (`readOnly ? 'Read-only' : editing ? 'Done' : 'Edit'`, no `aria-pressed`) and Save ⌘S.
  2. `.code-path`: the path as crumbs (`›` between, last part bold), the runs chip on the right (moved from the file bar).
  3. `.code-lock` strip (`var(--accBg)`, radius 10, margin 10px 14px 0): bot `Face` (crew entry whose name is `lock.bot`; none if not found), today's sentence, Open run. `.code-banner` (secrets) the same strip in `var(--s2)`.
  4. `.code-editor-wrap` as today.
  5. `.code-status` (mono 11.5 px, `var(--side)`, padded right by `--tf-launcher` unless docked): `unsaved` (amber) / `read-only` (file is read-only) / `saved`; then `Ln L, Col C`, `N lines`, the language label, `UTF-8` (the server reads files as UTF-8). The old `.code-filebar` goes.
- Switching files (existing) and closing the Dock (`× / Esc`) clear the picked run.

- [ ] **Step 1: Write the failing tests**

```tsx
// Editor: 'reports the cursor line and column' — dispatch selection at TEXT.indexOf('two') → onCursor(2, 4); shown on mount → onCursor(1, 1)
// Code: 'the card: crumbs, status bar and the Done label' — openA: text 'src', 'a.ts' crumbs; status has 'saved','Ln 1, Col 1','3 lines','TypeScript','UTF-8'; Edit → button 'Done'; type → status 'unsaved'
// Code: lock test — the strip also holds img 'Bolt'; secrets test — the banner is a .code-strip sibling, status 'read-only'
// Code: 'closing the runs panel or switching files clears the picked run' — pick Tune → .cm-run-line present; close 'Close Runs on this file' → none; reopen, pick, open src/b.ts tab → none
// Code: 'keeps Edit and Save visible with many tabs' — cssRule('.code-tablist') has 'overflow-x: auto', '.code-tab-actions' has 'flex: none'
```

- [ ] **Step 2:** `npx vitest run web/src/code` → FAIL.
- [ ] **Step 3:** Implement the card parts; `Editor` adds an `updateListener` branch for `selectionSet` and reports after `setState`.
- [ ] **Step 4:** `npx vitest run web/src/code` → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): code editor card: tabs in the header, path crumbs with the runs chip, lock and secrets strips, status bar"`

### Task 4: Gutter marks for every run

**Files:** Modify `code/Editor.tsx`, `code/cmTheme.ts`, `code/Code.tsx`; Test `code/Editor.test.tsx`, `code/Code.test.tsx`

**Interfaces:**
- `EditorProps.runs?: { hunks: Hunk[]; live: boolean; picked?: boolean }[]` replaces `marks`. Every run's changed lines get a gutter class on their line number: `cm-run-live` (inset 3 px bar `var(--acc)`) where any live run touches the line, else `cm-run-done` (`var(--ok)`). The picked run's lines get `cm-run-line` (green tint, as today) plus `cm-run-line-live` (`var(--accBg)`) when it is live.
- `highlightActiveLine()` on; `.cm-activeLine` a neutral tint (`color-mix(in srgb, var(--ink) 4%, transparent)`), declared before the run and flash rules so they win.
- Code passes `runs?.data?.map((r) => ({ hunks: r.hunks, live: r.live, picked: r.runId === run }))`.

- [ ] **Step 1: Write the failing tests**

```tsx
// Editor: 'marks every run in the gutter; live wins; the picked run is tinted'
//   runs=[{hunks:[{start:1,lines:2}], live:true}, {hunks:[{start:2,lines:2},{start:9,lines:1},{start:4,lines:0}], live:false, picked:true}]
//   gutter: line 1,2 → cm-run-live; line 3 → cm-run-done; line 4 unmarked; tinted: ['// two','let b = "s";'] without cm-run-line-live
//   rerender runs=[] → no marks
// Code: on open (no pick) line 3 'let c = 3;' gutter is cm-run-live, lines 1–2 cm-run-done
```

- [ ] **Step 2:** `npx vitest run web/src/code` → FAIL.
- [ ] **Step 3:** Implement in `Editor.tsx` / `cmTheme.ts`.
- [ ] **Step 4:** `npx vitest run web/src/code` → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): code gutter marks every run that touched the file, live over done, picked run tinted"`

### Task 5: Verify

- [ ] `npx vitest run web/src` → all pass; `npm run typecheck` clean; `npm run build` succeeds.
- [ ] Serve the build with `TETHER_HOME` on a fresh copy of `~/.aorch` under the job's tmp folder; headless Chromium at 1440×900, light and dark: Code (tabs, edit + save on a throwaway repo only, search, filter, runs chip → dock, pick → marks + diff, lock strip with a mock run if cheap) and Goals (create with the mock agent, loop actions, tracker toggle/add, Settings and New goal in the dock). Screenshots to the job's `shots-cg/`. Stop every server.
- [ ] Write `.superpowers/tether/code-goals-report.md`.
