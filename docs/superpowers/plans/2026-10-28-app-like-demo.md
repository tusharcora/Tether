# The App Looks Like the Demo (Home, Run, Inbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Home, the run view and Inbox to the landing-page demo, give every run/step status one animated
badge, turn the step inspector into a slide-over, and put beui's file tree on the Code page. Behaviour, API and data
stay as they are.

**Architecture:** First come pure models (badge mapping, graph layers, output lines, activity grouping, inbox grouping) with unit
tests, then small presentational components on top of them. `Runs.tsx` is split into a full-width list (`#/runs`) and
a full-width `RunPage` (`#/runs/<id>`) with an absolutely positioned `StepInspector` over it. `Team.tsx` is split into
exported parts so the run page and Inbox share the same question and plan cards. Nothing on the server changes.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (no preflight) next to Studio CSS tokens, vendored beui
(`web/src/components/beui`), `motion/react`, lucide, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-28-app-like-demo-design.md`. §14 overrides anything earlier that conflicts.
Mockups: `docs/design/AppDemo.html` (`#win`, `.screen[data-s=home|inbox|runs]`) and `docs/design/StepInspector.html`.

## Global Constraints

- Work only in `/Users/tushar/Documents/PROJECTS/orchestrator/.claude/worktrees/app-like-demo` on `feature/app-like-demo`.
- **No behaviour, API or data changes.** No new endpoints, no new stored state (localStorage included). Existing routes keep working: `#/runs`, `#/runs/<id>`, `#/runs/<id>/<node>`, `#/runs/<id>?pane=timeline`, `#/inbox`, `#/code/<path>:<line>`.
- No new npm dependencies. Vendored beui files keep the MIT header used by `components/beui/motion/animated-badge.tsx` (full notice in `components/beui/LICENSE`).
- Tailwind v4 without preflight next to Studio tokens. Use Studio tokens (`--bg --s1 --s2 --s3 --ink --ink2 --mut --line --line2 --acc --accBg --accInk --warn --warnBg --ok --okBg --bad --badBg`) or the beui names mapped in `web/src/tw.css`. No raw hex values.
- Light and dark get equal care. Every animation stops under `prefers-reduced-motion` (motion's `useReducedMotion()` / `useReducedMotionPref()` from `components/Loading`, plus CSS `@media (prefers-reduced-motion: reduce)`).
- No purple or indigo, no glows, no bento stat tiles, no decorative sparklines. Never hide an approval or a question the person must act on.
- Page headers are the title only (plus badge and one mono line on a run). No eyebrow/meta line, no summary, no Refresh button.
- Section = 12 px muted label + optional count chip + one bordered list with hairline rows. An empty section is one quiet line.
- Status colours carry meaning only: blue live, amber needs you, green done, red failed, grey neutral.
- Commit messages are plain conventional commits. They must **not** contain `Co-Authored-By`, "Claude" or "Claude Code".
- Test command for a file: `npx vitest run web/src/<path>`. Typecheck: `npm run typecheck`. Both must be clean at the end of every task.

## Review Focus

1. **A team run before its plan is approved** (`pipeline.nodes` is empty): no graph, no inspector dots, no crash on ← →. The questions and plan review stay inline and the inspector's "not in this run" note still shows for a stale node link. Pinned in Task 10 (`renders a team run before approval without a graph`) and Task 11 (`ignores arrows with no steps`).
2. **Typing in an input while the inspector is open** (the rating note, a question's free-text box): ← → must move the caret, not the step, and Esc in the note must not close the panel mid-sentence. Pinned in Task 11 (`leaves arrow keys alone inside a text field`).
3. **A deep link `#/runs/<id>/<node>` that arrives before the run state**: the inspector opens once the state lands and closing it returns to `#/runs/<id>`. A `?pane=timeline` link opens run mode. Pinned in Task 11 (`opens from a deep link once the run loads`, `opens run mode on Timeline from ?pane=timeline`).
4. **Odd task text**: empty, whitespace-only, leading blank lines, or very long text. The title is the first non-empty line, otherwise `runTitle`, and CSS truncates it. Pinned in Task 3 (`taskTitle`).
5. **The open Inbox item disappears under the person** (answered in another window, or the run moved on): selection moves to the neighbour, nothing crashes, and a failed run fetch shows an inline error with Retry. Pinned in Task 12 (`nextSelection`, `keeps working when the open item vanishes`, `shows a failed run load with Retry`).

---

## File map

| Area | Create | Modify | Delete |
|---|---|---|---|
| Status | `ui/studio/status.ts`, `ui/studio/status.test.ts`, `ui/studio/StatusBadge.tsx`, `ui/studio/StatusBadge.test.tsx` | `ui/studio/parts.css` | `ui/studio/StatusChip.tsx`, `ui/studio/StatusChip.test.tsx` (Task 14) |
| Primitives | `ui/studio/Section.tsx`, `ui/studio/Section.test.tsx` | `ui/studio/parts.css` | |
| Home | | `home/Home.tsx`, `home/NeedsYou.tsx`, `home/Running.tsx`, `home/Recent.tsx`, `home/ActivityFeed.tsx`, `home/CrewStrip.tsx`, `home/StartRun.tsx`, `home/runText.ts`, `home/Elapsed.tsx`, `home/home.css` + their tests | `home/SavedRequests.tsx`, `home/SavedRequests.test.tsx` |
| Runs list | | `Runs.tsx`, `runs/RunList.tsx`, `runs/runs.css` + tests | `runs/ProgressRing.tsx` |
| Graph | `runs/graphModel.ts`, `runs/graphModel.test.ts`, `runs/RunGraph.tsx`, `runs/RunGraph.test.tsx`, `runs/graph.css` | | |
| Team parts | | `Team.tsx`, `Team.test.tsx`, `runs/team.css` | |
| Run page | `runs/RunPage.tsx`, `runs/RunPage.test.tsx`, `runs/RunNotices.tsx`, `runs/ApprovalBar.tsx`, `runs/OutputLog.tsx`, `runs/outputModel.ts`, `runs/outputModel.test.ts`, `runs/RunFiles.tsx`, `runs/useDiff.ts` | `runs/RunHeader.tsx`, `runs/FileBars.tsx`, `runs/runs.css`, `Runs.tsx`, `Runs.test.tsx` | `runs/RunBanners.tsx`, `runs/RunCentre.tsx` |
| Inspector | `runs/StepInspector.tsx`, `runs/StepView.tsx`, `runs/RunDetails.tsx`, `runs/Rating.tsx`, `runs/inspectorModel.ts`, `runs/inspectorModel.test.ts`, `runs/StepInspector.test.tsx`, `runs/inspector.css` | `runs/RunPage.tsx` | `runs/Inspector.tsx`, `runs/Inspector.test.tsx`, `runs/StepPane.tsx` |
| Inbox | `home/inboxModel.ts`, `home/inboxModel.test.ts` | `home/Inbox.tsx`, `home/Inbox.test.tsx`, `home/home.css` | |
| Code tree | `components/beui/motion/file-tree.tsx`, `components/beui/motion/shared-layout-bg.tsx` | `code/FileTree.tsx`, `code/treeModel.ts`, `code/treeModel.test.ts`, `code/Code.test.tsx`, `code/code.css` | |
| Adoption | | `Canvas.tsx`, `Builder.tsx`, `Evolve.tsx`, `ui/studio/SettingsDrawer.tsx`, `settings/Accounts.tsx`, `triggers/*.tsx`, `triggers/types.ts`, `code/RunsLens.tsx`, `crew/RunsOn.tsx`, `crew/CrewCard.tsx`, `components/beui/kit/controls.tsx`, `components/beui/kit/index.ts` + tests | |

All paths are under `web/src/` unless they start with `docs/`.

---

### Task 1: One status badge (descriptor → state + label) and a matching glyph

**Files:**
- Create: `web/src/ui/studio/status.ts`, `web/src/ui/studio/status.test.ts`, `web/src/ui/studio/StatusBadge.tsx`, `web/src/ui/studio/StatusBadge.test.tsx`
- Modify: `web/src/ui/studio/StatusChip.tsx` (becomes a two-line alias that renders `StatusBadge` in tone form; Task 14 deletes it)

**Interfaces:**
- Consumes: `AnimatedBadge`, `AnimatedBadgeStatus` from `components/beui/motion/animated-badge`; `RunGlyph`, `type RunState as GlyphState` from `ui/studio/RunGlyph`; `RunRow`, `RunView`, `NodeState`, `Pipeline` from `api`.
- Produces (in `status.ts`):
  ```ts
  type PNode = Pipeline['nodes'][number];
  export type RunDesc = { of: 'run'; status: RunView['status']; live: boolean; waiting: boolean; planning?: boolean };
  export type StepDesc = { of: 'step'; status: NodeState['status']; kind: PNode['kind']; readOnly?: boolean; attempts: number; gateOk?: boolean; verdict?: 'PASS' | 'FAIL' };
  export type StatusDesc = RunDesc | StepDesc;
  export interface BadgeLook { state: AnimatedBadgeStatus; label: string }
  export function badgeFor(d: StatusDesc): BadgeLook;
  export function rowDesc(r: Pick<RunRow, 'status' | 'live' | 'pending' | 'planReady' | 'steps'>): RunDesc;
  export function viewDesc(r: RunView): RunDesc;
  export function stepDesc(n: PNode, s: NodeState | undefined): StepDesc;
  export function glyphFor(state: AnimatedBadgeStatus): GlyphState;
  ```
- Produces (in `StatusBadge.tsx`):
  ```ts
  export type Tone = 'live' | 'needs' | 'done' | 'failed' | 'neutral';
  export function toneFor(status?: string): Tone; // moved verbatim from StatusChip
  export type StatusBadgeProps = { desc: StatusDesc; className?: string } | { tone: Tone; label: string; pulse?: boolean; className?: string };
  export function StatusBadge(p: StatusBadgeProps): JSX.Element;
  export function StatusGlyph(p: { desc: StatusDesc }): JSX.Element; // <RunGlyph state={glyphFor(badgeFor(desc).state)} />
  ```

Mapping (spec §10 + §14.3), checked in this order:

| Desc | State | Label |
|---|---|---|
| run, `waiting` and status `running` or `paused` | warning | `needs you` |
| run, `running`, `!live` | warning | `interrupted` |
| run, `running`, `live`, `planning` | loading | `planning` |
| run, `running`, `live` | loading | `running` |
| run, `paused` | neutral | `paused` |
| run, `done` | success | `done` |
| run, `error` | danger | `failed` |
| run, `stopped` | neutral | `stopped` |
| step, `running`, `attempts > 1` | loading | `retrying` |
| step, `running`, kind `gate` | loading | `testing` |
| step, `running`, kind `agent`, `readOnly` | loading | `reading` |
| step, `running`, other | loading | `writing` |
| step, `awaiting` | warning | `needs you` |
| step, `done`, `verdict === 'FAIL'` | danger | `failed` |
| step, `done`, `gateOk` or `verdict === 'PASS'` | success | `passed` |
| step, `done` | success | `done` |
| step, `error` | danger | `failed` |
| step, `queued` / `skipped` | neutral | `queued` / `skipped` |

`rowDesc.waiting` = `pending > 0 || planReady || steps.some(s => s.status === 'awaiting')`. `viewDesc.waiting` = `pending.length > 0 || (kind === 'team' && !!plan && !planning && pipeline.nodes.length === 0) || any node 'awaiting'`, with `planning: r.planning`. `stepDesc` sets `gateOk: s?.gate?.ok`, `verdict: s?.verdict`, `readOnly: n.readOnly`, `attempts: s?.attempts ?? 0`, `status: s?.status ?? 'queued'`. `glyphFor`: loading→`running`, warning→`needs`, success→`done`, danger→`failed`, neutral/info→`idle`.

`StatusBadge` renders `AnimatedBadge size="sm"` with `data-status={state}` and class `sl-badge`. The desc form passes `status={state}` and shows the icon. The tone form maps tone→state (live→loading, needs→warning, done→success, failed→danger, neutral→neutral) and uses `showIcon={false}`, with `pulse` passed through. A `loading` badge overrides beui's ink colours with the accent tokens: `border-[color-mix(in_srgb,var(--acc)_35%,transparent)] bg-[var(--accBg)] text-[var(--accInk)]`.

- [ ] **Step 1: Write the failing tests**

```ts
// status.test.ts
const step = (o: Partial<StepDesc>): StepDesc => ({ of: 'step', status: 'running', kind: 'agent', attempts: 1, ...o });
const run = (o: Partial<RunDesc>): RunDesc => ({ of: 'run', status: 'running', live: true, waiting: false, ...o });
it('names a running step by what it does (§14.3)', () => {
  expect(badgeFor(step({}))).toEqual({ state: 'loading', label: 'writing' });
  expect(badgeFor(step({ readOnly: true })).label).toBe('reading');
  expect(badgeFor(step({ kind: 'gate' })).label).toBe('testing');
  expect(badgeFor(step({ kind: 'gate', attempts: 2 })).label).toBe('retrying');
});
it('maps finished steps, gates and verdicts', () => {
  expect(badgeFor(step({ status: 'done', kind: 'gate', gateOk: true }))).toEqual({ state: 'success', label: 'passed' });
  expect(badgeFor(step({ status: 'done', verdict: 'PASS' })).label).toBe('passed');
  expect(badgeFor(step({ status: 'done', verdict: 'FAIL' }))).toEqual({ state: 'danger', label: 'failed' });
  expect(badgeFor(step({ status: 'done' }))).toEqual({ state: 'success', label: 'done' });
  expect(badgeFor(step({ status: 'error' }))).toEqual({ state: 'danger', label: 'failed' });
  expect(badgeFor(step({ status: 'awaiting' }))).toEqual({ state: 'warning', label: 'needs you' });
  expect(badgeFor(step({ status: 'skipped' }))).toEqual({ state: 'neutral', label: 'skipped' });
});
it('maps run states, with waiting and interrupted first', () => {
  expect(badgeFor(run({}))).toEqual({ state: 'loading', label: 'running' });
  expect(badgeFor(run({ planning: true })).label).toBe('planning');
  expect(badgeFor(run({ live: false }))).toEqual({ state: 'warning', label: 'interrupted' });
  expect(badgeFor(run({ status: 'paused', waiting: true }))).toEqual({ state: 'warning', label: 'needs you' });
  expect(badgeFor(run({ status: 'paused' }))).toEqual({ state: 'neutral', label: 'paused' });
  expect(badgeFor(run({ status: 'error', live: false }))).toEqual({ state: 'danger', label: 'failed' });
  expect(badgeFor(run({ status: 'stopped', live: false })).label).toBe('stopped');
  expect(JSON.stringify(['done', 'error', 'stopped'].map((s) => badgeFor(run({ status: s as RunDesc['status'] })).label))).not.toContain('merged');
});
it('derives waiting from a row and from a view', () => {
  expect(rowDesc(makeRow({ pending: 1 })).waiting).toBe(true);
  expect(rowDesc(makeRow({ planReady: true })).waiting).toBe(true);
  expect(rowDesc(makeRow({ steps: [{ id: 's', status: 'awaiting', bot: 'b' }] })).waiting).toBe(true);
  expect(viewDesc(makeRun()).waiting).toBe(false);
});
it('never draws a glyph that contradicts the badge', () => {
  expect(glyphFor('danger')).toBe('failed');
  expect(glyphFor('success')).toBe('done');
  expect(glyphFor('loading')).toBe('running');
  expect(glyphFor('warning')).toBe('needs');
  expect(glyphFor('neutral')).toBe('idle');
});
```

```tsx
// StatusBadge.test.tsx
it('renders a descriptor as a beui badge with its state', () => {
  const { container } = render(<StatusBadge desc={{ of: 'step', status: 'running', kind: 'gate', attempts: 1 }} />);
  const b = container.querySelector('.sl-badge')!;
  expect(b.getAttribute('data-status')).toBe('loading');
  expect(b.textContent).toContain('testing');
  expect(b.className).toContain('bg-[var(--accBg)]');
});
it('renders a plain tone label without an icon', () => {
  const { container } = render(<StatusBadge tone="needs" label="agent not available" />);
  expect(container.querySelector('[data-status="warning"]')!.textContent).toBe('agent not available');
  expect(container.querySelector('[data-badge-icon]')).toBeNull();
});
it('draws a red cross for a failed run, never a ring', () => {
  render(<StatusGlyph desc={{ of: 'run', status: 'error', live: false, waiting: false }} />);
  expect(screen.getByRole('img', { name: 'Failed' })).toBeTruthy();
});
it('keeps toneFor', () => expect(toneFor('error')).toBe('failed'));
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run web/src/ui/studio/status.test.ts web/src/ui/studio/StatusBadge.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `status.ts` and `StatusBadge.tsx`** following the signatures and table above. Make `StatusChip(props: { tone; label; pulse?; className? })` return `<StatusBadge tone=… label=… pulse=… className=… />`, and have it re-export `toneFor` and `Tone` from `StatusBadge`, so existing callers keep compiling.

- [ ] **Step 4: Run the new tests and the suite that asserts chips**

Run: `npx vitest run web/src/ui/studio web/src/runs web/src/Team.test.tsx web/src/home`
Expected: the new tests PASS. Tests that query `.sl-chip.t-<tone>` fail. Change those selectors to `[data-status="<state>"]` (live→loading, needs→warning, done→success, failed→danger) and rerun until everything passes. Delete the `StatusChip.test.tsx` case that reads `.sl-chip.t-live` CSS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` (expect no errors).
```bash
git add web/src/ui/studio web/src/runs web/src/home web/src/Team.test.tsx
git commit -m "feat(web): one StatusBadge from a status descriptor, with a matching glyph"
```

---

### Task 2: Section primitives (label + count, boxed list, quiet line, tag, disclosure)

**Files:**
- Create: `web/src/ui/studio/Section.tsx`, `web/src/ui/studio/Section.test.tsx`
- Modify: `web/src/ui/studio/parts.css`

**Interfaces:**
- Consumes: `ListRow` (unchanged, still the row), `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `components/beui/motion/collapsible`.
- Produces:
  ```ts
  export function Section(p: { title: string; count?: number; live?: boolean; action?: ReactNode; className?: string; children: ReactNode }): JSX.Element;
  // <section role="region" aria-labelledby> with <h2 class="sl-sec"><span class="sl-sec-title">title</span> <span class="sl-sec-count">n</span><span class="sl-dot pulse" aria-hidden/></h2>
  export function RowList(p: { label?: string; children: ReactNode }): JSX.Element; // <ul class="sl-rows" aria-label>
  export function QuietLine(p: { children: ReactNode }): JSX.Element;              // <p class="sl-quiet">
  export function Tag(p: { children: ReactNode; title?: string }): JSX.Element;    // <span class="sl-tag">
  export function Disclosure(p: { label: string; meta?: string; children: ReactNode; className?: string }): JSX.Element; // collapsed by default
  ```

CSS values from the demo: `.sl-sec` uses 12px/500 `var(--mut)`, flex with gap 8px and margin `22px 0 8px` (a section that comes first gets `margin-top: 0`). `.sl-sec-count` is 11px `var(--font-code)` on `var(--s2)` with radius 99px and padding `0 6px`. `.sl-rows` has a `1px solid var(--line)` border, radius 10px, `overflow: hidden`, background `var(--s1)`, and no list padding. `.sl-rows > .sl-row` uses `grid-template-columns: 18px minmax(0,1fr) auto`, gap 12px, padding `11px 14px`, and a top border `1px solid var(--line)` that the first row drops. Row titles are 500 weight with ellipsis, and the meta line is 12px `var(--mut)` with ellipsis. `.sl-quiet` is 13px `var(--mut)` with padding `6px 0`. `.sl-tag` is 11px on `var(--s2)` in `var(--mut)` with radius 6px and padding `1px 7px`. `.sl-disclosure` is a full-width row button with a 12px muted label, a chevron that turns 90° when open, and a hairline above.

- [ ] **Step 1: Write the failing tests**

```tsx
it('labels a section with its count and an optional live dot', () => {
  render(<Section title="Needs you" count={2} live><RowList label="Needs you"><li>x</li></RowList></Section>);
  const region = screen.getByRole('region', { name: /Needs you/ });
  expect(region.querySelector('.sl-sec-count')!.textContent).toBe('2');
  expect(region.querySelector('.sl-sec .sl-dot.pulse')).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Needs you' }).className).toContain('sl-rows');
});
it('shows an empty section as one quiet line', () => {
  render(<QuietLine>Nothing needs you.</QuietLine>);
  expect(screen.getByText('Nothing needs you.').className).toBe('sl-quiet');
});
it('keeps a disclosure collapsed until clicked', () => {
  render(<Disclosure label="Planning" meta="5 answers"><p>inside</p></Disclosure>);
  const b = screen.getByRole('button', { name: /Planning · 5 answers/ });
  expect(b.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(b);
  expect(b.getAttribute('aria-expanded')).toBe('true');
});
it('draws boxed lists with hairline rows', () => {
  expect(cssRule('ui/studio/parts.css', '.sl-rows')).toContain('border: 1px solid var(--line)');
  expect(cssRule('ui/studio/parts.css', '.sl-rows > .sl-row')).toContain('padding: 11px 14px');
  expect(cssRule('ui/studio/parts.css', '.sl-sec')).toContain('font-size: 12px');
});
```

- [ ] **Step 2: Run and see them fail.** Run `npx vitest run web/src/ui/studio/Section.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement `Section.tsx` and the CSS.** The disclosure label reads `${label} · ${meta}` when `meta` is set.
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/ui/studio` and expect PASS.
- [ ] **Step 5: Commit**: `git add web/src/ui/studio && git commit -m "feat(web): section, row list, quiet line, tag and disclosure primitives"`

---

### Task 3: Home shell and the Needs you, Running and Recent rows

**Files:**
- Modify: `web/src/home/Home.tsx`, `web/src/home/NeedsYou.tsx`, `web/src/home/Running.tsx`, `web/src/home/Recent.tsx`, `web/src/home/runText.ts`, `web/src/home/home.css`, `web/src/home/Home.test.tsx`, `web/src/home/NeedsYou.test.tsx`, `web/src/home/Running.test.tsx`, `web/src/home/Recent.test.tsx`
- Delete: `web/src/home/SavedRequests.tsx`, `web/src/home/SavedRequests.test.tsx`, and the `.saved-*` rules in `home.css`

**Interfaces:**
- Consumes: `Section`, `RowList`, `QuietLine` (Task 2); `StatusBadge`, `StatusGlyph`, `rowDesc`, `badgeFor` (Task 1); `RunGlyph`, `shortRunId` from `ui/studio/RunGlyph`; `StepTrack`; `Elapsed`.
- Produces:
  ```ts
  // runText.ts
  export function taskTitle(r: { task: string; kind: string; pipeline: string }): string; // first non-empty trimmed line of task, else runTitle(r)
  export function stepOf(r: RunRow): string | undefined; // "step n of m": n = index of current step + 1, else done+skipped count + 1 capped at m; undefined when no steps
  // NeedsYou / Running / Recent drop the `refreshing` prop:
  export function NeedsYou(p: { poll: Poll<{ items: AttentionItem[] }>; onGo: (r: Route) => void; onChanged: () => Promise<unknown> | void }): JSX.Element;
  export function Running(p: { poll: Poll<RunRow[]>; onGo: (r: Route) => void }): JSX.Element;
  export function Recent(p: { poll: Poll<RunRow[]>; onGo: (r: Route) => void }): JSX.Element;
  export const linkFor; // unchanged
  ```

Layout: `ScreenHeader title="Home"` with no meta, summary or actions. Below it sits `.home-cols`, a grid of `minmax(0,1fr) 270px` with gap 28px that becomes one column at `@media (max-width: 1099px)`. The main column holds composer, Needs you, Running, Recent. The side column holds Activity and Crew. Remove `refresh`, `refreshing`, `savedKey`, the Refresh button and `SavedRequests`. Keep both polls and the 2 s / 10 s switching.

Rows:
- **Needs you** (`Section title="Needs you" count`): lead is `RunGlyph state="needs"`, or `"failed"` for `failed`/`planning_error`. Then title, `meta={item.meta}`, and the action buttons from `item.actions`: `answer`, `review` and `approve` are primary, the others secondary. Labels stay `ACTION_LABEL`, and `approve` posts as today. The inline `ApprovalCard` is removed; Reject stays in Inbox and the run view. Empty state: `QuietLine` "Nothing needs you."
- **Running** (`count` of live): lead is `StatusGlyph desc={rowDesc(r)}`. The title is `taskTitle(r)` and opens the run. The meta line is `nowLine(r)` plus ` · step n of m` when `stepOf` returns one, and `age` is `<Elapsed since={r.startedAt} />`. `extra` is `<StepTrack steps={r.steps} planning={…} />`. `FaceStack` and `StepTodos` are dropped. Empty state: "Nothing running."
- **Recent**: lead is `StatusGlyph`, the title is `taskTitle(r)` and opens the run, the meta is `${shortRunId(r.id)} · ${badgeFor(rowDesc(r)).label} · ${fmtDur(end - start)} · ${fmtUsd(r.costUsd)}`, and `actions` is `<StatusBadge desc={rowDesc(r)} />`. Empty state: "No finished runs yet."

- [ ] **Step 1: Write the failing tests** (replace the layout and empty-state cases that assert the old cards)

```tsx
// runText (add to Recent.test.tsx or a new runText.test.ts)
it('titles a run by the first non-empty line of its task', () => {
  expect(taskTitle({ task: '\n  Fix the login\nmore', kind: 'workflow', pipeline: 'p' })).toBe('Fix the login');
  expect(taskTitle({ task: '   \n ', kind: 'team', pipeline: 'p' })).toBe('Team run');
  expect(taskTitle({ task: '', kind: 'workflow', pipeline: 'plan-code' })).toBe('plan-code');
});
it('counts the step a run is on', () => {
  const steps = [{ id: 'a', status: 'done', bot: 'x' }, { id: 'b', status: 'running', bot: 'y' }, { id: 'c', status: 'queued', bot: 'z' }] as RunRow['steps'];
  expect(stepOf(makeRow({ steps, current: { node: 'b', bot: 'Y', title: 'b' } }))).toBe('step 2 of 3');
  expect(stepOf(makeRow({ steps: [] }))).toBeUndefined();
});
// Home.test.tsx
it('has only a title for a header: no meta line, summary or Refresh', async () => {
  renderApp(<Home onGo={() => {}} />);
  await act(async () => {});
  expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  expect(screen.queryByText(/running · .* need/)).toBeNull();
  expect(screen.queryByRole('region', { name: /Saved requests/ })).toBeNull();
});
it('lays out a 270 px side column that stacks under 1100 px', () => {
  expect(cssRule('home/home.css', '.home-cols')).toContain('grid-template-columns: minmax(0,1fr) 270px');
  expect(cssRule('home/home.css', '.home-cols', '@media (max-width: 1099px)')).toContain('grid-template-columns: minmax(0,1fr)');
});
// NeedsYou.test.tsx
it('shows one quiet line when nothing needs you', async () => { /* attention {items: []} */ expect(await screen.findByText('Nothing needs you.')).toBeTruthy(); });
it('approves from the row with one click and refetches', async () => { /* item kind approval, actions ['approve','open'] → click 'Approve' → POST /api/runs/r1/approve {node, approved: true}; onChanged called */ });
// Running.test.tsx
it('shows the task as title, who works and step n of m, a step track and the clock', async () => {
  // row with task 'Tune the limit window', steps 3, current b → title text, meta contains 'step 2 of 3', '.sl-steptrack' present, '.elapsed' present
});
// Recent.test.tsx
it('shows a failed run with a red cross and a failed badge, never a green ring', async () => {
  // row status 'error', live false → getByRole('img', {name: 'Failed'}); '[data-status="danger"]' text 'failed'; meta matches /^R-\w+ · failed · /
});
```

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/home` and expect FAIL on the new cases.
- [ ] **Step 3: Implement** the Home shell, the three sections and `taskTitle`/`stepOf` as specified. Delete `SavedRequests.tsx`, its test and its CSS.
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/home && npm run typecheck` and expect PASS and a clean typecheck.
- [ ] **Step 5: Commit**: `git add -A web/src/home && git commit -m "feat(web): Home header, Needs you, Running and Recent as demo rows; saved requests leave Home"`

---

### Task 4: Activity with repeats collapsed (max 8) and the Crew faces

**Files:**
- Modify: `web/src/home/ActivityFeed.tsx`, `web/src/home/ActivityFeed.test.tsx`, `web/src/home/CrewStrip.tsx`, `web/src/home/CrewStrip.test.tsx`, `web/src/home/Home.tsx`, `web/src/home/home.css`

**Interfaces:**
- Consumes: `ActivityLine` from `api`, `Section`, `QuietLine`.
- Produces:
  ```ts
  export const ACTIVITY_SHOW = 8;
  export interface ActivityGroup { id: string; ts: number; runId: string; text: string; kind: ActivityLine['kind']; bot?: string; count: number }
  export function verbOf(l: ActivityLine): string;            // text minus a leading `${who} `, cut at the first ' · '
  export function collapseActivity(lines: ActivityLine[], max = ACTIVITY_SHOW): ActivityGroup[];
  export function ActivityFeed(p: { feed: ReturnType<typeof useActivity> }): JSX.Element; // no paused/onPause/refreshing/onGo
  export function CrewStrip(p: { runs: RunRow[] | undefined }): JSX.Element;            // unchanged signature
  ```

`collapseActivity` walks the lines newest first and merges neighbours whose `kind` and `verbOf` are equal. A group of one keeps its line: same `id`, `text`, `bot`. A group of n > 1 takes the newest line's `id`, `ts`, `runId` and `bot`. Its text is `${n} steps ${verb}` when every line's text starts with its `who` (step lines), otherwise `${verb} ×${n}`. The result is cut to `max` groups.

ActivityFeed: `Section title="Activity" live` with no Pause button (Home calls `useActivity(false)`; the `paused` parameter of `useActivity` stays for its own test). The rows are an `<ol role="log" aria-live="polite" aria-label="Activity">` of groups, each showing a 44px mono time column (`HH:MM` of `ts`, `aria-hidden`), then the `who` in 500 weight and the rest of the text. `.act-line` gets the 12.5px demo feed style. The ascii-reveal decode for fresh ids stays, with the same reduced-motion rule. Empty state: `QuietLine` "No activity yet."

CrewStrip: `Section title="Crew"` holding the same faces grid (`MAX` 24). A busy bot's `<li>` gets class `busy`, and `.crew-face.busy::after` draws a 9px `var(--acc)` dot with a 2px `var(--bg)` ring at the bottom right of the face. Idle faces stay dimmed.

- [ ] **Step 1: Write the failing tests**

```ts
const L = (id: string, who: string, text: string, kind: ActivityLine['kind'] = 'info'): ActivityLine => ({ id, ts: 1, runId: 'r', who, text, kind });
it('collapses consecutive repeats into one line', () => {
  const g = collapseActivity([L('1', 'Build', 'Build skipped'), L('2', 'Lint', 'Lint skipped'), L('3', 'Test', 'Test skipped'), L('4', 'Bolt', 'Bolt started', 'working')]);
  expect(g.map((x) => x.text)).toEqual(['3 steps skipped', 'Bolt started']);
  expect(g[0]!.count).toBe(3);
});
it('says ×n for repeated run lines and keeps singles as they are', () => {
  expect(collapseActivity([L('1', 'Team run', 'run started', 'working'), L('2', 'deploy', 'run started', 'working')])[0]!.text).toBe('run started ×2');
});
it('groups finished steps despite different costs', () => {
  expect(collapseActivity([L('1', 'A', 'A finished · $0.10', 'done'), L('2', 'B', 'B finished · $0.20', 'done')])[0]!.text).toBe('2 steps finished');
});
it('shows at most 8 lines', () => {
  expect(collapseActivity(Array.from({ length: 20 }, (_, i) => L(String(i), `S${i}`, `S${i} ${i % 2 ? 'started' : 'finished'}`, i % 2 ? 'working' : 'done')))).toHaveLength(8);
});
it('has no Pause button and a live dot', async () => { /* render Home → queryByRole('button', {name: 'Pause'}) null; region 'Activity' has '.sl-dot.pulse' */ });
it('marks busy bots with a dot', () => { /* runs with a live running step for bot 'coder' → '.crew-face.busy' exists */ });
```

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/home/ActivityFeed.test.tsx web/src/home/CrewStrip.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement** `verbOf`, `collapseActivity` and the two sections. Remove the Pause/Resume test and keep the `useActivity(paused)` polling test.
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/home` and expect PASS.
- [ ] **Step 5: Commit**: `git add web/src/home && git commit -m "feat(web): Home activity collapses repeats to 8 lines; crew faces with busy dots"`

---

### Task 5: Home composer (replaces the Start a run card)

**Files:**
- Modify: `web/src/home/StartRun.tsx` (the component keeps the name `StartRun`), `web/src/home/StartRun.test.tsx`, `web/src/home/home.css`

**Interfaces:**
- Consumes: `QuietLine` (Task 2), `Picker` (bencho), `useRosterPreview`, `pickWorkspace`, `INIT_COMMAND`, `CopyButton`, `Kbd`, `Button`, and a menu. Use the `useMenu` helper from `ui/studio/useMenu.ts` if it fits, otherwise a beui popover from `components/beui/motion/popover-morph.tsx`.
- Produces: `export function StartRun(p: { onGo: (r: Route) => void; onStarted: (id: string) => void; workspaces?: Poll<WorkspaceRow[]> }): JSX.Element` (props unchanged).

Shape (spec §6.1 and §14.7) is a `.composer` box with a `1px solid var(--line2)` border, radius 12px, background `var(--s1)` and padding `12px 12px 10px`:
1. A borderless textarea, `aria-label="Task"`, `placeholder="Ask the crew to…"`, `rows={1}`, that grows as you type (CSS `field-sizing: content; max-height: 40vh`). ⌘/Ctrl+Enter starts the run and plain Enter adds a newline, as today.
2. While the field is empty **and focused**, the three `EXAMPLES` show as `.start-chip` suggestions under it (mouse-down picks one before the blur).
3. A chip row (26px chips on `var(--s2)`):
   - a **workspace** chip showing `ws.name` that opens the workspace `Picker`;
   - a **run kind** chip showing `Team · live` / `Team · autonomous` that opens a menu with those two items plus `Workflow…`, which calls `onGo({ tab: 'builder' })`;
   - a plain label `Tether picks the crew` (not a button);
   - a spacer, then `<Kbd mod>↵</Kbd>` and a primary **Start run** button.
4. The roster preview (`PreviewRow`), the missing-folder note and the inline error stay under the box.

The no-workspace state becomes one `QuietLine` reading "No workspace yet. Run `tether workspace init` in the project folder." followed by the copy button. Don't add a branch picker; WorkspaceRow carries no branch, so the chip shows the project name only.

- [ ] **Step 1: Update the tests first.** Keep all 14 existing behaviours and change only the controls they use:

```tsx
it('picks autonomous from the run-kind chip and starts with Ctrl+Enter', async () => {
  // click button /Team · live/ → click menuitem 'Team · autonomous' → type in Task → Ctrl+Enter → POST /api/runs body.mode === 'autonomous'
});
it('shows suggestions only while the empty field is focused', async () => {
  const task = await screen.findByLabelText('Task');
  expect(screen.queryByText('Fix the flaky login test')).toBeNull();
  fireEvent.focus(task);
  fireEvent.mouseDown(screen.getByText('Fix the flaky login test'));
  expect((task as HTMLTextAreaElement).value).toBe('Fix the flaky login test');
});
it('hands off to the Builder from the run-kind menu', async () => { /* menuitem 'Workflow…' → onGo({ tab: 'builder' }) */ });
it('shows Tether picks the crew as a label, not a control', async () => {
  expect(screen.getByText('Tether picks the crew').closest('button')).toBeNull();
});
it('grows with its content', () => expect(cssRule('home/home.css', '.composer textarea')).toContain('field-sizing: content'));
// Home.test.tsx: once composer, Activity and Crew are converted
it('puts the composer and main sections before the side column in DOM order', async () => {
  const { container } = renderApp(<Home onGo={() => {}} />);
  await act(async () => {});
  expect(container.querySelector('.home-cols > :first-child .composer')).toBeTruthy();
  expect([...container.querySelectorAll('.sl-sec-title')].map((e) => e.textContent)).toEqual(['Needs you', 'Running', 'Recent', 'Activity', 'Crew']);
});
```
Rename the existing Start button query from `'Start'` to `'Start run'`.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/home/StartRun.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement the composer** in `StartRun.tsx` and replace the `.start-*` CSS with `.composer` rules. `SegmentedControl` and `Panel` are no longer imported here.
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/home && npm run typecheck` and expect PASS.
- [ ] **Step 5: Commit**: `git add web/src/home && git commit -m "feat(web): Home composer with project, run-kind and crew chips"`

---

### Task 6: Runs list full width with task titles and compact filters

**Files:**
- Modify: `web/src/runs/RunList.tsx`, `web/src/runs/RunList.test.tsx`, `web/src/runs/runs.css`, `web/src/Runs.tsx` (only the no-run branch: render `<RunList>` alone in `<div className="runs-list-page">`; leave the run branch as it is until Task 10)
- Delete: `web/src/runs/ProgressRing.tsx` and its `.prog-ring` CSS

**Interfaces:**
- Consumes: `taskTitle` (Task 3), `StatusBadge`, `StatusGlyph`, `rowDesc` (Task 1), `Tag` (Task 2).
- Produces: `RunList` props without `selected`. Signature: `RunList(p: { poll: Poll<RunRow[]>; probes: boolean; onProbes: (on: boolean) => void; onSelect: (id: string) => void; onStart?: () => void; project?: WorkspaceRow })`. `filterRuns` is unchanged.

Row (DataTable `bare`, keeping keyboard and row click): one line made of `StatusGlyph desc={rowDesc(r)}`, `<b>` `taskTitle(r)` (ellipsis), `<Tag>` holding `Team` for team runs or `r.pipeline` for workflows, and `<Tag title="Evolve probe replay">probe</Tag>` when `r.probe`. On the right sit `<StatusBadge desc={rowDesc(r)} />` and `fmtUsd(cost) · ago(startedAt)`. The `? n` / `plan` chips and the moving-border SVG are removed. The sort columns stay: Run sorts by `taskTitle`, Status by `byStatus`. Filters go in one `.run-list-filters` row: the All/Live/Done `SegmentedControl` and then both switches inline (probes, only <project>). The `run-list-head` h2 becomes the page title `ScreenHeader title="Runs"`. The empty list keeps its "No runs yet" quiet line plus the Start a run button, and the filtered-empty "Show all" stays.

- [ ] **Step 1: Write the failing tests**

```tsx
it('titles rows by task text with a kind tag, a badge and cost · when', async () => {
  // rows: makeRow({ task: 'Add rate limiting\nmore' }), makeRow({ id: 'r2', task: 'Second task', kind: 'team', pending: 1 })
  expect(await screen.findByText('Add rate limiting')).toBeTruthy();
  expect(screen.getByText('plan-code-review').className).toBe('sl-tag');
  expect(screen.getByText('Team').className).toBe('sl-tag');
  const r2 = screen.getByText('Second task').closest('tr')!;
  expect(r2.querySelector('[data-status="warning"]')!.textContent).toContain('needs you');
  expect(screen.queryByText('? 1')).toBeNull();
});
it('draws a failed run with the failed glyph', async () => {
  // makeRow({ status: 'error', live: false, steps: [{ id: 'a', status: 'done', bot: 'x' }] }) → getByRole('img', { name: 'Failed' }); no '.prog-ring'
});
it('keeps the filters in one compact row', async () => {
  const row = (await screen.findByRole('group', { name: 'Filter runs' })).closest('.run-list-filters')!;
  expect(within(row as HTMLElement).getByLabelText('show probe replays')).toBeTruthy();
});
```

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/runs/RunList.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement** the row cells, the filter row and the no-run branch in `Runs.tsx`. Delete `ProgressRing.tsx`. In `Runs.test.tsx`, remove the `'offers the latest run when none is selected (F14)'` case: the "No run selected" pane is gone by spec §7.
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/runs web/src/Runs.test.tsx && npm run typecheck` and expect PASS.
- [ ] **Step 5: Commit**: `git add -A web/src/runs web/src/Runs.tsx web/src/Runs.test.tsx && git commit -m "feat(web): full-width runs list titled by task, with glyphs that match the badge"`

---

### Task 7: Run graph of crew cards in dependency layers

**Files:**
- Create: `web/src/runs/graphModel.ts`, `web/src/runs/graphModel.test.ts`, `web/src/runs/RunGraph.tsx`, `web/src/runs/RunGraph.test.tsx`, `web/src/runs/graph.css`

**Interfaces:**
- Consumes: `Edge`, `NodeState`, `Pipeline`, `RunView` from `api` (`Edge` re-export: add `Edge` to the `api.ts` type re-export list, which is a type-only change); `crewFor`, `useCrew`; `Face`, `moodFor`; `badgeFor`, `stepDesc` (Task 1).
- Produces:
  ```ts
  // graphModel.ts
  export const CARD_W = 176, CARD_H = 56, COL_GAP = 44, ROW_GAP = 12, PAD = 16;
  export function layersOf(nodes: { id: string }[], edges: Edge[]): string[][];
  export function stepOrder(nodes: { id: string }[], edges: Edge[]): string[]; // layersOf(...).flat()
  export type EdgeState = 'done' | 'live' | 'failed' | 'idle';
  export function edgeState(from?: NodeState['status'], to?: NodeState['status']): EdgeState;
  export function placeCards(layers: string[][]): { pos: Record<string, { x: number; y: number }>; width: number; height: number };
  // RunGraph.tsx
  export function RunGraph(p: { run: RunView; selected?: string; onSelect: (id: string) => void }): JSX.Element | null; // null when pipeline has no nodes
  ```

`layersOf` gives each node a layer equal to the longest path from a root (a node with no incoming edge), with nodes in pipeline order inside a layer. Edges to unknown ids are ignored. An edge that would close a cycle is ignored: run a DFS with an on-stack set and drop back edges. `placeCards`: `x = PAD + col*(CARD_W+COL_GAP)`, `y = PAD + (row + (maxRows - layer.length)/2) * (CARD_H+ROW_GAP)`, `width = 2*PAD + cols*CARD_W + (cols-1)*COL_GAP`, `height = 2*PAD + maxRows*CARD_H + (maxRows-1)*ROW_GAP`. `edgeState` returns `live` when `to === 'running'` and `from === 'done'`, then `failed` when either side is `error`, then `done` when `from === 'done'`, otherwise `idle`.

RunGraph: a `.rg` scroller (`overflow-x: auto`, dotted background as in the demo `.dag`, a 1px `var(--line)` border, radius 12px, background `var(--side)`) wrapping an inner box of `width × height`. Edges are one `<svg aria-hidden>` of cubic paths from the right middle of a card to the left middle of the next, with class `rg-edge e-<state>`. The strokes are done `var(--ok)`, live `var(--acc)`, failed `var(--bad)` and idle `var(--line2)`. Each live edge also carries `<circle class="rg-dot"><animateMotion dur="1.6s" repeatCount="indefinite" path=…/></circle>`, which is left out under reduced motion. Cards are absolutely positioned `<button class="rg-card s-<badge state>" data-id aria-label="<name>, <badge label>" aria-pressed={selected}>` holding a `Face` (26px, `moodFor(status)`, `animate="always"` while running), the name (crew name, `crew[bot]?.name ?? bot`, 12.5px 500 weight) and the sub line (10.5px mono, muted, ellipsis). The sub line is `${role ?? 'agent'} · ${agent ?? 'claude'}` for agents, `command ?? 'gate'` for gates and `you approve` for approvals. Border colours: loading `var(--acc)`, warning `var(--warn)`, danger `var(--bad)`, otherwise `var(--line2)`. The selected card gets a `0 0 0 3px var(--accBg)` box-shadow ring and a `var(--ink)` border. On hover a card lifts 2px, except under reduced motion.

- [ ] **Step 1: Write the failing tests**

```ts
const N = (...ids: string[]) => ids.map((id) => ({ id }));
it('layers by longest path from a root', () => {
  expect(layersOf(N('a', 'b', 'c', 'd'), [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }])).toEqual([['a'], ['b', 'c'], ['d']]);
  expect(layersOf(N('a', 'b'), [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).toEqual([['a'], ['b']]);
  expect(layersOf(N('x', 'y'), [])).toEqual([['x', 'y']]);
});
it('colours edges by the state of their ends', () => {
  expect(edgeState('done', 'running')).toBe('live');
  expect(edgeState('done', 'error')).toBe('failed');
  expect(edgeState('done', 'queued')).toBe('done');
  expect(edgeState('queued', 'queued')).toBe('idle');
});
it('places cards in columns and centres short columns', () => {
  const { pos, width } = placeCards([['a'], ['b', 'c']]);
  expect(pos.b!.x).toBe(PAD + CARD_W + COL_GAP);
  expect(pos.a!.y).toBe(PAD + 0.5 * (CARD_H + ROW_GAP));
  expect(width).toBe(2 * PAD + 2 * CARD_W + COL_GAP);
});
```
```tsx
it('draws one card per step with name, role · agent and state, and selects on click', () => {
  const onSelect = vi.fn();
  const { container } = renderApp(<RunGraph run={makeRun()} onSelect={onSelect} />);
  const code = container.querySelector('[data-id="code"]')!;
  expect(code.className).toContain('s-loading');
  expect(code.getAttribute('aria-label')).toMatch(/writing$/);
  expect(code.textContent).toContain('coder · claude');
  fireEvent.click(code);
  expect(onSelect).toHaveBeenCalledWith('code');
  expect(container.querySelectorAll('.rg-edge')).toHaveLength(2);
  expect(container.querySelector('.rg-edge.e-live')).toBeTruthy();
});
it('renders nothing for a run with no steps yet', () => {
  const { container } = renderApp(<RunGraph run={makeRun({ pipeline: { ...makeRun().pipeline, nodes: [], edges: [] } })} onSelect={() => {}} />);
  expect(container.querySelector('.rg')).toBeNull();
});
it('scrolls wide graphs sideways', () => expect(cssRule('runs/graph.css', '.rg')).toContain('overflow-x: auto'));
```

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/runs/graphModel.test.ts web/src/runs/RunGraph.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement** `graphModel.ts`, `RunGraph.tsx` and `graph.css`. Use the cycle-safe DFS described above. `Canvas.tsx` is not touched; the Builder keeps it.
- [ ] **Step 4: Run them and see them pass.** Run the same command and expect PASS. Then run `npm run typecheck`.
- [ ] **Step 5: Commit**: `git add web/src/runs web/src/api.ts && git commit -m "feat(web): run graph of crew cards in dependency layers with state-coloured edges"`

---

### Task 8: Split the team panel into shareable parts

**Files:**
- Modify: `web/src/Team.tsx`, `web/src/Team.test.tsx`, `web/src/runs/team.css`

**Interfaces:**
- Consumes: the existing internals of `Team.tsx` (`QuestionCard`, `codeModeAsk`, submit logic, plan review, dialogue).
- Produces:
  ```ts
  export type TeamSend = (path: 'answers' | 'plan' | 'mode' | 'swap', body: unknown) => Promise<boolean>;
  export function ModeBar(p: { run: RunView; send: TeamSend }): JSX.Element | null;        // ModeToggle + hint; null when not running/paused
  export function TeamQuestions(p: { run: RunView; send: TeamSend; paged?: boolean }): JSX.Element | null; // null when no pending questions
  export function PlanReview(p: { run: RunView; send: TeamSend }): JSX.Element | null;      // null unless the plan waits
  export function PlanningDialogue(p: { run: RunView }): JSX.Element | null;                // the thread list only (no Accordion)
  export function dialogueCount(r: RunView): number;                                        // r.answers.length when cards and answers exist, else 0
  export function TeamPanel(p: { run: RunView; send: TeamSend }): JSX.Element;              // ModeBar + TeamQuestions + PlanReview
  ```

Each part owns its own `busy` state. `TeamQuestions` owns `picks`, resets them when `run.id` changes, and keeps `submit` exactly as it is: planning cards in one batch, worker asks one at a time, stopping at the first failure. It keeps **Use recommendations** and **Send answers**. With `paged`, it shows one card at a time with **Previous** / **Next** buttons and `n of m`, picks are kept across pages, and Send answers sits next to Next and is enabled once every question has a pick. Without `paged`, it shows all cards as today. Remove the duplicate pills: the `Team run` status chip in the mode bar and the `waits for you` chip on the plan heading. Keep `can edit files` / `read only` / `swapped by you` as `Tag`s.

- [ ] **Step 1: Update and add tests.** The existing cases now render `TeamPanel` and should keep passing. Remove the assertion on the `Team run` chip. Add two local helpers to `Team.test.tsx`. `teamRunWith(n)` is `makeRun({ kind: 'team', status: 'running', planning: true, pipeline: { ...makeRun().pipeline, nodes: [], edges: [] }, pending: q1…qn })`, where each `q<i>` has options `{ id: 'o1', label: 'q<i> first option' }` and `{ id: 'o2', label: 'q<i> second option' }` and `recommended: 'o1'`. `teamRunWithAnswers(n)` is `teamRunWith(0)` with `cards: [q1…qn]` and `answers` answering each one with `o1` `by: 'user'`. Then add:

```tsx
it('pages through questions with Previous and Next and sends them together', async () => {
  const send = vi.fn(async () => true);
  render(<TeamQuestions run={teamRunWith(2 /* pending cards q1, q2 */)} send={send} paged />);
  expect(screen.getByText('1 of 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: /first option of q1/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('2 of 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  expect((screen.getByRole('radio', { name: /first option of q1/ }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('radio', { name: /first option of q2/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
  await waitFor(() => expect(send).toHaveBeenCalledWith('answers', { answers: [{ question: 'q1', option: expect.any(String) }, { question: 'q2', option: expect.any(String) }] }));
});
it('counts the planning dialogue', () => expect(dialogueCount(teamRunWithAnswers(5))).toBe(5));
```

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/Team.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement the split.** It's a move, not a rewrite: the bodies are today's code.
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/Team.test.tsx web/src/Runs.test.tsx && npm run typecheck` and expect PASS.
- [ ] **Step 5: Commit**: `git add web/src/Team.tsx web/src/Team.test.tsx web/src/runs/team.css && git commit -m "refactor(web): export team questions, plan review, mode bar and dialogue as parts"`

---

### Task 9: Run header, one-line notices and the sticky approval bar

**Files:**
- Create: `web/src/runs/RunNotices.tsx`, `web/src/runs/ApprovalBar.tsx`
- Modify: `web/src/runs/RunHeader.tsx`, `web/src/home/Elapsed.tsx`, `web/src/runs/runs.css`
- Modify: `web/src/test/fixtures.ts`: add `makeAwaitingRun(): RunView`, which is `awaitingRun` from `Runs.test.tsx` moved here (approval node `ship` titled "Ship it" awaiting, gate done). `Runs.test.tsx` imports it.
- Test: `web/src/runs/RunPage.test.tsx` (created here and extended in Tasks 10–11; `const act0 = vi.fn(async () => true)`)

**Interfaces:**
- Consumes: `viewDesc`, `StatusBadge` (Task 1); `taskTitle` (Task 3); `Tag` (Task 2); `shortRunId`; `fmtClock`; `stepLabel` from `src/runLabels`; `InlineError`; `RunAct` from `Runs`.
- Produces:
  ```ts
  // Elapsed.tsx
  export function useNow(on: boolean, ms = 1000): number; // Date.now(), re-rendered every ms while on
  // RunHeader.tsx
  export function RunHeader(p: { run: RunView; onAct: RunAct; onBack: () => void; onDetails: () => void }): JSX.Element;
  // RunNotices.tsx
  export function RunNotices(p: { run: RunView; streamError?: string; onRetryStream: () => void }): JSX.Element | null;
  // ApprovalBar.tsx
  export function ApprovalBar(p: { run: RunView; onAct: RunAct; onReviewDiff: () => void }): JSX.Element | null;
  export function gateSummary(r: RunView): string;
  ```

**RunHeader** from top to bottom:
1. A small ghost `← Runs` button that calls `onBack`.
2. A row with the `<h1>` `taskTitle({ task, kind, pipeline: pipeline.name })` (ellipsis), `<StatusBadge desc={viewDesc(run)} />` and `<Tag>` holding `Team` or the pipeline name.
3. A mono 12px muted line: `${shortRunId(id)} · ${kind === 'team' ? 'team run' : pipeline.name} · ${clock} · ${fmtUsd(costUsd)}${cap ? ` of ${fmtUsd(cap)}` : ''}`. `clock` is `fmtClock((finishedAt ?? useNow(live && status === 'running')) - startedAt)`, and `cap` is `pipeline.settings.maxCostUsd`.
4. Actions on the right: **Run details** (secondary, calls `onDetails`), plus Stop / Resume / Retry failed with today's conditions.

The `interrupted` chip goes away because the badge now says it.

**RunNotices** is a list of `.run-notice` lines: a 6px dot, 12.5px `var(--ink2)` text and an optional `×` (`aria-label="Dismiss"`). It contains:
- `streamError` as `<InlineError message onRetry={onRetryStream} />`, unchanged.
- `run.error`: a red-dot line with its first line, not dismissible.
- Coach findings: an amber dot, `<b>{title}</b> {detail}`, then the muted `{action}` (§14.9, plain text, not a link), and a dismiss button. With more than two findings, only the first two show, followed by a `and N more` button that reveals the rest. Dismissed findings are kept in a **module-level** `const dismissed = new Set<string>()` keyed `${run.id}:${finding.id}`. That lasts the session in memory only and is never stored.

**ApprovalBar** gives one `.run-approve` block per approval node whose status is `awaiting`. It has `position: sticky; bottom: 12px`, a `1px solid var(--warn)` border, radius 12px and background `var(--s1)`. It shows `<b>Approve {stepLabel(nodes, id)}?</b>`, then `gateSummary(run)` as the muted line, then buttons **Review diff** (secondary, calls `onReviewDiff`), **Reject** (secondary) and **Approve** (primary). Reject and Approve call `onAct('approve', { node, approved })` and both disable while acting. `gateSummary` joins the gate nodes as `${command ?? id} ${word}` with ` · `, where `word` is `passed` when the node is `done` and `gate?.ok !== false`, `failed` when it is `error` or `gate?.ok === false`, and `not run` otherwise. It returns `No gates in this run` when there are none.

- [ ] **Step 1: Write the failing tests** (render the components directly in `RunPage.test.tsx`)

```tsx
it('heads the run with its task, badge, kind tag and one mono line', () => {
  renderApp(<RunHeader run={makeRun({ pipeline: { ...makeRun().pipeline, settings: { ...makeRun().pipeline.settings, maxCostUsd: 5 } } })} onAct={act0} onBack={() => {}} onDetails={() => {}} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Add rate limiting' })).toBeTruthy();
  expect(screen.getByText(/^R-\w+ · plan-code-review · \d+:\d{2} · \$0\.12 of \$5\.00$/)).toBeTruthy();
  expect(document.querySelector('[data-status="loading"]')!.textContent).toContain('running');
  expect(screen.getByRole('button', { name: 'Run details' })).toBeTruthy();
});
it('says interrupted in the badge, not a separate chip', () => {
  renderApp(<RunHeader run={makeRun({ live: false })} onAct={act0} onBack={() => {}} onDetails={() => {}} />);
  expect(screen.getAllByText('interrupted')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
});
it('shows coach findings as lines, two at most before "and N more", dismissible for the session', () => {
  const coach = [1, 2, 3, 4].map((i) => ({ id: `f${i}`, title: `T${i}`, detail: `d${i}`, action: `a${i}` }));
  const { unmount } = renderApp(<RunNotices run={makeRun({ coach })} onRetryStream={() => {}} />);
  expect(screen.queryByText('Coach')).toBeNull();
  expect(screen.getByText('T2')).toBeTruthy();
  expect(screen.queryByText('T3')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'and 2 more' }));
  expect(screen.getByText('T4')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
  unmount();
  renderApp(<RunNotices run={makeRun({ coach })} onRetryStream={() => {}} />);
  expect(screen.queryByText('T1')).toBeNull();
  expect(screen.getByText('a2').closest('a')).toBeNull();
});
it('shows a run error as a red line and keeps the stream retry', () => {
  const retry = vi.fn();
  renderApp(<RunNotices run={makeRun({ error: 'budget exhausted ($6.41 of $4.50)\nstack' })} streamError="stream lost" onRetryStream={retry} />);
  expect(screen.getByText('budget exhausted ($6.41 of $4.50)')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
  expect(retry).toHaveBeenCalled();
});
it('puts a waiting approval in a sticky bar with Review diff, Reject and Approve', async () => {
  const onAct = vi.fn(async () => true);
  const review = vi.fn();
  renderApp(<ApprovalBar run={makeAwaitingRun()} onAct={onAct} onReviewDiff={review} />);
  expect(screen.getByText('Approve Ship it (ship)?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review diff' }));
  expect(review).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  await waitFor(() => expect(onAct).toHaveBeenCalledWith('approve', { node: 'ship', approved: false }));
  expect(cssRule('runs/runs.css', '.run-approve')).toContain('position: sticky');
});
it('summarises gates', () => {
  expect(gateSummary(makeRun())).toBe('npm test not run');
  expect(gateSummary(makeAwaitingRun())).toBe('npm test passed');
});
```

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/runs/RunPage.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement** `useNow`, `RunHeader`, `RunNotices`, `ApprovalBar` and `gateSummary`. The old `Runs.tsx` still calls `RunHeader` without `onBack`/`onDetails`, so pass no-ops there until Task 10.
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/runs && npm run typecheck` and expect PASS.
- [ ] **Step 5: Commit**: `git add web/src/runs web/src/home/Elapsed.tsx web/src/Runs.tsx && git commit -m "feat(web): run header with mono line, one-line notices and a sticky approval bar"`

---

### Task 10: Run page (graph, inline cards, output log + files, disclosures) wired into Runs

**Files:**
- Create: `web/src/runs/RunPage.tsx`, `web/src/runs/OutputLog.tsx`, `web/src/runs/outputModel.ts`, `web/src/runs/outputModel.test.ts`, `web/src/runs/RunFiles.tsx`, `web/src/runs/useDiff.ts`
- Modify: `web/src/Runs.tsx`, `web/src/Runs.test.tsx`, `web/src/runs/FileBars.tsx`, `web/src/runs/runs.css`, `web/src/runs/RunPage.test.tsx`
- Delete: `web/src/runs/RunBanners.tsx`, `web/src/runs/RunCentre.tsx`

**Interfaces:**
- Consumes: Tasks 1–9; `describeEvent`, `StoredEvent`; `stepLabel`; `crewFor`; `StepTodos`; `Disclosure`.
- Produces:
  ```ts
  // outputModel.ts
  export interface OutputLine { seq: number; ts: number; who: string; text: string; tone: string; node?: string }
  export const OUTPUT_KEEP = 200;
  export function nodeOf(e: StoredEvent['event']): string | undefined; // the step an event is about: `node` (string) on node.*, gate.result, approval.*, user.ask, feedback, node.amended, supervisor.action; `from` on handoff/consult; `check` on loop; `parent` on node.spawned
  export function outputLines(events: StoredEvent[], nameOf: (id: string) => string): OutputLine[];
  // useDiff.ts
  export function useDiff(path: string | undefined, key: string): { path?: string; text?: string; error?: string; loading: boolean; retry: () => void };
  // FileBars.tsx: add `openTitle?: string` (default 'Open in Code') used as the button title
  // RunFiles.tsx
  export function RunFiles(p: { run: RunView; onOpen: () => void }): JSX.Element;
  // OutputLog.tsx
  export function OutputLog(p: { run: RunView; events: StoredEvent[]; onPick: (node: string) => void }): JSX.Element;
  // RunPage.tsx
  export type InspectorTarget = { mode: 'step'; node: string } | { mode: 'run'; tab: 'changes' | 'timeline' };
  export function RunPage(p: { run: RunView; events: StoredEvent[]; streamError?: string; onRetryStream: () => void; onAct: RunAct; node?: string; pane?: 'timeline'; onSelectNode: (node?: string) => void; onBack: () => void; onOpenFile?: (file: string) => void }): JSX.Element;
  ```

Here `nameOf` is the bot's display name for a step id (`crew[crewFor(pnode)]?.name ?? id`), with `tether` for events that have no step. `outputLines` keeps the events `describeEvent` describes, oldest first, and the last `OUTPUT_KEEP` of them. `who` is `nameOf(nodeOf(e))` or `'tether'`. `text` is the description with a leading `${who} ` removed when present. `node` is `nodeOf(e)`. (The web never receives `node.chunk`: `useRunStream` drops it and `/events` excludes it. A running step's streaming text lives in the inspector's Output tab, so no API change is needed.)

`useDiff` is the fetch effect moved out of `Inspector.tsx` unchanged. It refetches on `path`, `key` or `retry`, keeps the old text while the same path refetches, and treats a different path as loading.

**RunPage** layout is one scroller, `.run-page` (`position: relative`, full height, `overflow: auto`, padding `22px 24px 24px`), containing in order:
1. `RunHeader`.
2. `RunNotices`.
3. `RunGraph`, where `onSelect` opens step mode.
4. For team runs, `<TeamPanel run send={onAct} />`, so questions, the plan review and the mode bar stay inline under the graph. For a team run with no nodes that is planning (status running or paused, no pending, `planning`), a `QuietLine` reading "Tether is planning…".
5. When the pipeline has nodes, the `.run-split` grid (`minmax(0,1fr) 260px`, gap 16px, one column under 1100px): `OutputLog` and `RunFiles`. `OutputLog` is a `.term` block (`var(--side)`, 12px/1.75 mono, `min-height: 250px`, scrolls and sticks to the bottom). Each line is a `<button class="out-line" data-node>` with the `who` padded to 8ch in muted colour, then the text coloured by tone (`running` → `--accInk`, `done` → `--ok`, `error` → `--bad`, `wait` → `--warn`). Clicking a line with a `node` opens that step. With no events it shows `QuietLine` "No output yet." `RunFiles` shows the label `Files · branch {branch}` and then `FileBars` over `useDiff('/api/runs/<id>/diff', commitsKey)`. Each file opens the run mode Changes view (`openTitle="Open the run's changes"`). An empty diff shows a quiet line "No committed changes yet." and an error shows `InlineError` with Retry. `commitsKey` is `Object.values(run.nodes).map(n => n.commit ?? '').join(',')`.
6. Disclosures, all collapsed: `Planning · ${n} answers` holding `PlanningDialogue`, shown when `dialogueCount > 0`. For team runs with nodes, `Team plan · ${done} of ${total}` holding `StepTodos` of the steps, where `done` counts `done` + `skipped`.
7. `ApprovalBar`, where `onReviewDiff` opens run mode on `changes`.

For this task the inspector target is computed and rendered with the **old** `Inspector` in a beui `Drawer`. Task 11 replaces it. The target is `node ? step : pane ? run/timeline : local state`. Close calls `onSelectNode(undefined)` and clears the local state.

`Runs.tsx`: with `selected` set and `run` loaded it renders `<RunPage …/>`. `onBack` calls `props.onSelect(undefined)`, `onOpenFile` maps to `props.onOpenFile(run.repo, f)`, and `onSelectNode` is `props.onSelectNode`. While loading it shows `Loading` (label "Loading run") and on error it shows `InlineError` with Retry. Remove the three-pane, drawer and phone-switch code and the `BELOW_WIDE` / `PHONE` imports.

Team plan overflow fix: `.run-disclosure` and its `.sl-todos` get `min-width: 0` and `max-width: 100%`, and each todo title gets `overflow-wrap: anywhere`. (Spec §7.6 "fix the Team plan's right-edge overflow". The cause was not reproduced while planning; confirm it in Chrome in Task 15.)

- [ ] **Step 1: Write the failing tests**

```ts
// outputModel.test.ts
const ev = (seq: number, event: StoredEvent['event']): StoredEvent => ({ runId: 'r1', seq, ts: seq, event });
const nameOf = (id: string) => ({ code: 'Bolt', plan: 'Scout' })[id] ?? id;
it('makes one line per described event, prefixed by the bot, in order', () => {
  const lines = outputLines([ev(1, { type: 'run.started' } as never), ev(2, { type: 'node.started', node: 'code', attempt: 1 }), ev(3, { type: 'manager.cost', node: 'code', costUsd: 1 })], nameOf);
  expect(lines.map((l) => [l.who, l.text, l.node])).toEqual([['tether', 'run started', undefined], ['Bolt', 'started', 'code']]);
});
it('keeps the last 200 lines', () => {
  expect(outputLines(Array.from({ length: 250 }, (_, i) => ev(i, { type: 'node.started', node: 'code', attempt: 1 })), nameOf)).toHaveLength(OUTPUT_KEEP);
});
it('finds the step of a loop by its check and of a handoff by its sender', () => {
  expect(nodeOf({ type: 'loop', check: 'gate', fixNode: 'code', n: 1 })).toBe('gate');
  expect(nodeOf({ type: 'handoff', from: 'plan', to: 'code', goal: 'g', answer: 'a', round: 1 })).toBe('plan');
});
```
```tsx
// RunPage.test.tsx (via <Runs selected="r1" …/> and FakeEventSource as in Runs.test.tsx)
it('lays out header, graph, output and files, full width with no runs list', async () => {
  renderApp(<Runs selected="r1" onSelect={() => {}} />);
  act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
  act(() => FakeEventSource.all[0]!.emit('event', { seq: 1, ts: Date.now(), event: { type: 'node.started', node: 'code', attempt: 1 } }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Add rate limiting' })).toBeTruthy();
  expect(document.querySelector('.rg [data-id="code"]')).toBeTruthy();
  expect(screen.getByText('Files · branch aorch/r1')).toBeTruthy();
  expect(screen.queryByRole('complementary', { name: 'Runs' })).toBeNull();
  expect(document.querySelector('.out-line[data-node="code"]')!.textContent).toContain('started');
});
it('opens a step from an output line', async () => { /* click .out-line[data-node="code"] → onSelectNode('code') */ });
it('goes back to the list', async () => { /* click '← Runs' → onSelect(undefined) */ });
it('renders a team run before approval without a graph, with its questions inline', async () => {
  // makeRun({ kind: 'team', pipeline: { ...nodes: [], edges: [] }, pending: [q1] }) → no '.rg'; radio for q1 present; no '.run-split'
});
it('collapses planning and the team plan into disclosure rows', async () => {
  // team run with nodes, cards + 5 answers → button /Planning · 5 answers/ aria-expanded false; button /Team plan · 1 of 3/
});
it('keeps the team plan inside the page width', () => expect(cssRule('runs/runs.css', '.run-disclosure')).toContain('min-width: 0'));
```
In `Runs.test.tsx`, delete the cases about three panes, the 900–1199 drawer, the phone stack, "draws a step track above the graph", "replaces the graph with the Team panel" and the F24 drawer/phone cases. Their behaviour moves to Task 11 tests. Keep the cases for list, follow-live, approve, reject, feedback and diff-fetch-once, updating their selectors to the new layout.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/runs web/src/Runs.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement** `outputModel.ts`, `useDiff.ts`, `OutputLog`, `RunFiles`, `RunPage`, the `FileBars.openTitle` prop and the `Runs.tsx` wiring. Delete `RunBanners.tsx` and `RunCentre.tsx`.
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/runs web/src/Runs.test.tsx web/src/App.test.tsx && npm run typecheck` and expect PASS.
- [ ] **Step 5: Commit**: `git add -A web/src/runs web/src/Runs.tsx web/src/Runs.test.tsx && git commit -m "feat(web): full-width run page with graph, output log, files and disclosures"`

---

### Task 11: Step inspector slide-over (step mode + run mode)

**Files:**
- Create: `web/src/runs/StepInspector.tsx`, `web/src/runs/StepView.tsx`, `web/src/runs/RunDetails.tsx`, `web/src/runs/Rating.tsx`, `web/src/runs/inspectorModel.ts`, `web/src/runs/inspectorModel.test.ts`, `web/src/runs/StepInspector.test.tsx`, `web/src/runs/inspector.css`
- Modify: `web/src/runs/RunPage.tsx` (replace the temporary Drawer + old Inspector)
- Delete: `web/src/runs/Inspector.tsx`, `web/src/runs/Inspector.test.tsx`, `web/src/runs/StepPane.tsx`

**Interfaces:**
- Consumes: `InspectorTarget` (Task 10), `stepOrder` (Task 7), `useDiff`, `nodeOf` (Task 10), `StatusBadge`, `stepDesc` (Task 1), `useNow` (Task 9), `Tabs/TabsList/TabsTrigger/TabsContent` from `components/beui/kit/controls` (already has the sliding pill), `Timeline`, `JsonViewer`, `ToolResult`, `FileBars`, `RunDiff`, `Face`, `crewFor`.
- Produces:
  ```ts
  // inspectorModel.ts
  export function eventsForStep(events: StoredEvent[], id: string): StoredEvent[]; // events where nodeOf(e)===id, plus loop.fixNode===id, handoff/consult.to===id, node.spawned node.id===id
  export interface GateRun { attempt: number; ok: boolean; exitCode: number | null; durationMs: number; output: string }
  export function gateRuns(events: StoredEvent[], id: string, fallback?: NodeState['gate']): GateRun[]; // one per gate.result for id, attempt = 1-based order; [] → fallback as attempt 1 when given
  export function neighbour(order: string[], id: string, dir: -1 | 1): string | undefined;
  // StepInspector.tsx
  export function StepInspector(p: { run: RunView; events: StoredEvent[]; target: InspectorTarget; onTarget: (t: InspectorTarget) => void; onClose: () => void; onAct: RunAct; onOpenFile?: (file: string) => void }): JSX.Element;
  // StepView.tsx
  export function StepView(p: { run: RunView; events: StoredEvent[]; node: string; onAct: RunAct; onOpenFile?: (file: string) => void }): JSX.Element;
  // RunDetails.tsx
  export function RunDetails(p: { run: RunView; events: StoredEvent[]; tab: 'changes' | 'timeline'; onTab: (t: 'changes' | 'timeline') => void; onOpenFile?: (file: string) => void }): JSX.Element;
  // Rating.tsx
  export function Rating(p: { botName: string; current?: { rating: 'up' | 'down' }; onRate: (rating: 'up' | 'down', note?: string) => Promise<boolean> }): JSX.Element;
  ```

**Panel** (`inspector.css`, `docs/design/StepInspector.html` `.insp`): `<aside class="insp" aria-label="Step inspector" | "Run details">` absolutely positioned inside the RunPage container at `top: 8px; right: 8px; bottom: 8px; width: 440px; max-width: calc(100% - 16px)`, radius 14px, background `var(--bg)`, shadow `0 0 0 1px var(--line), -24px 0 60px -20px rgb(0 0 0 / .25)` (a soft shadow, not a glow). It slides in from the right with a motion spring (`x: '100%' → 0`, `stiffness: 380, damping: 36`) and has no motion under reduced motion. A `.insp-scrim` covers the run (`rgb(0 0 0 / .12)`) and clicking it closes. Under `@media (max-width: 899px)` the panel is `inset: 0; width: auto; max-width: none; border-radius: 0` (a full-height sheet). It takes focus when it opens.

**Header** (step mode): **Previous step** / **Next step** buttons (disabled at the ends), one dot button per step (`aria-label="Step i: name"`, `aria-current="step"` on the current one, the current dot 18px wide), `"${i} of ${n}"`, `Kbd` hints `← →` and `esc`, and the **Close inspector** ×. In run mode the header shows `Run details`, a muted `${branch}${notes.length ? ` · ${notes.length} vault notes` : ''}` and the ×. The step order is `stepOrder(pipeline.nodes, pipeline.edges)`.

**Keys**: a window `keydown` listener runs while the panel is open. `Escape` closes, unless the target is an `input`, `textarea`, `select` or contenteditable, in which case it only blurs the field. `ArrowLeft`/`ArrowRight` move to `neighbour(order, node, ∓1)` in step mode, unless the target is one of those fields. Moving between steps keys the content by node inside `AnimatePresence` with `custom={dir}`: it enters from `x: dir*24` and leaves to `-dir*24`, with no motion under reduced motion.

**StepView** (step mode body):
- **Identity**: `Face` (44px, mood from status, animate while running), the bot name as an h2, `<StatusBadge desc={stepDesc(pnode, node)} />`, and the mono sub line `${role ?? kind} · ${agent ?? 'claude'} · ${model ?? 'default'}` (gates show `command`). Below it, "Why Tether picked it" for team runs as today, and any `node.error` as a red alert.
- **Three figures** (`.insp-stats`, three columns, each a bordered box on `var(--side)`): **Attempts** `node.attempts` (`+ · N fix loops` when `loops > 0`), **Cost** `fmtUsd(node.costUsd)`, **Time** `fmtClock((finishedAt ?? useNow(running)) - startedAt)` or `—` before start. Cost updates from the run state stream and time ticks every second while running.
- **Tabs**: **Output**, **Changes**, then **Checks** only when `kind === 'gate' || pnode.verdict || node.verdict`, then **Timeline (n)**. Output shows `node.live` while running with the blinking caret, otherwise `node.output` (agents) or the gate output, with `metricsLine` from the step's last `node.metrics` event under it when there is one. Changes renders `FileBars(onOpen=onOpenFile)` plus `RunDiff` from `useDiff('/api/runs/<id>/diff?node=<id>', commit)` when `node.commit` is set. Otherwise it shows the quiet line "This step finished without changing any files." for a done write agent, or "No changes yet." Checks shows, for gates, one `.chk` row per `gateRuns(...)` entry (`Run ${attempt}`, passed/failed badge, `exit ${exitCode}`, `fmtDur(durationMs)`) with its output in a `ToolResult` that is collapsed by default. The rows are followed by `Fix loops: ${loops} of ${fixNode ? (maxLoops ?? 2) : 0}`. Verdict steps show `VERDICT ${verdict}` as a success/danger badge. Timeline is the `Timeline` component over `eventsForStep(...)` with JSON detail, the same mapping the old Inspector used.
- **Rating** sits at the bottom, outside the tabs. It shows only for `kind === 'agent'`, status `done`/`error`, and `!run.probe`. The copy is `How did ${botName} do?`. Thumb buttons `aria-label="Good"` / `"Bad"` have `aria-pressed` taken from `node.feedback`. A click posts `onAct('feedback', { node, rating })` and opens a note row (`Input label="Why (optional)" maxLength={500}` and a **Save note** button that posts `{ node, rating, note }`). When the post succeeds, a muted `Saved` appears. Approval steps never rate.

**RunDetails** (run mode body): Tabs **Changes** (`FileBars` + `RunDiff` over `useDiff('/api/runs/<id>/diff', commitsKey)`, with the empty text "No committed changes on this branch yet.") and **Timeline (n)** (all events, with JSON detail).

**Routing in RunPage**: the target is step mode when `node` is set. Otherwise it is run mode on timeline when `pane === 'timeline'`, otherwise local state (set by **Run details**, which opens changes, by **Review diff**, which opens changes, and by `RunFiles.onOpen`, which opens changes). Opening step mode calls `onSelectNode(node)`. Moving between steps calls `onSelectNode(next)`. Closing calls `onSelectNode(undefined)`, which App maps to `#/runs/<id>` and so drops `?pane`, and clears local state. A `node` that is not in the run shows the note "This step is not in this run." (`role="note"`) in the panel body.

- [ ] **Step 1: Write the failing tests**

```ts
// inspectorModel.test.ts
it('collects a step’s events, including loops and hand-offs to it', () => {
  const evs = [ev(1, { type: 'node.started', node: 'code', attempt: 1 }), ev(2, { type: 'loop', check: 'gate', fixNode: 'code', n: 1 }), ev(3, { type: 'node.started', node: 'plan', attempt: 1 })];
  expect(eventsForStep(evs, 'code').map((e) => e.seq)).toEqual([1, 2]);
});
it('lists one row per gate run, falling back to the node’s last result', () => {
  const evs = [ev(1, { type: 'gate.result', node: 'gate', ok: false, exitCode: 1, output: 'x', durationMs: 900 }), ev(2, { type: 'gate.result', node: 'gate', ok: true, exitCode: 0, output: 'y', durationMs: 800 })];
  expect(gateRuns(evs, 'gate').map((g) => [g.attempt, g.ok, g.exitCode])).toEqual([[1, false, 1], [2, true, 0]]);
  expect(gateRuns([], 'gate', { ok: true, exitCode: 0, output: 'z' })).toEqual([{ attempt: 1, ok: true, exitCode: 0, durationMs: 0, output: 'z' }]);
});
it('moves to neighbours and stops at the ends', () => {
  expect(neighbour(['a', 'b', 'c'], 'b', 1)).toBe('c');
  expect(neighbour(['a', 'b', 'c'], 'a', -1)).toBeUndefined();
  expect(neighbour([], 'x', 1)).toBeUndefined();
});
```
```tsx
// StepInspector.test.tsx (through <Runs …/> with FakeEventSource, as Runs.test.tsx does)
it('opens a 440 px panel when a crew card is clicked', async () => {
  const onSelectNode = vi.fn();
  renderApp(<Runs selected="r1" onSelect={() => {}} onSelectNode={onSelectNode} />);
  act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
  fireEvent.click(await screen.findByRole('button', { name: /writing$/ }));
  expect(onSelectNode).toHaveBeenCalledWith('code');
  expect(cssRule('runs/inspector.css', '.insp')).toContain('width: 440px');
  expect(cssRule('runs/inspector.css', '.insp', '@media (max-width: 899px)')).toContain('inset: 0');
});
it('opens from a deep link once the run loads, with identity, figures and tabs', async () => {
  renderApp(<Runs selected="r1" node="code" onSelect={() => {}} />);
  expect(screen.queryByRole('complementary', { name: 'Step inspector' })).toBeNull();
  act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
  const panel = await screen.findByRole('complementary', { name: 'Step inspector' });
  expect(within(panel).getByText('2 of 3')).toBeTruthy();
  expect(within(panel).getByText('Attempts')).toBeTruthy();
  expect(within(panel).getByRole('tab', { name: 'Output' })).toBeTruthy();
  expect(within(panel).queryByRole('tab', { name: 'Checks' })).toBeNull();
  expect(panel.querySelector('.caret')).toBeTruthy();
});
it('moves with ← → and closes with Esc back to the run', async () => {
  const onSelectNode = vi.fn();
  renderApp(<Runs selected="r1" node="code" onSelect={() => {}} onSelectNode={onSelectNode} />);
  act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
  await screen.findByRole('complementary', { name: 'Step inspector' });
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(onSelectNode).toHaveBeenLastCalledWith('gate');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onSelectNode).toHaveBeenLastCalledWith(undefined);
});
it('leaves arrow keys alone inside a text field', async () => {
  // done agent step 'plan' → click 'Good' → note input appears; keyDown ArrowRight on the input → onSelectNode not called with 'code'; Escape on input → panel still open
});
it('ignores arrows with no steps', async () => {
  // team run with nodes: [] and node="ghost" → note 'This step is not in this run'; ArrowRight → no throw, onSelectNode not called
});
it('shows one Checks row per gate run with the fix-loop count', async () => {
  // run with gate done, gate {ok:true}, loops 1, events two gate.result → tab 'Checks' → rows 'Run 1' failed 'exit 1', 'Run 2' passed; 'Fix loops: 1 of 2'
});
it('rates a step with a thumb, then saves an optional note through feedback', async () => {
  // plan done → click 'Good' → POST /api/runs/r1/feedback {node:'plan', rating:'up'}; type note → 'Save note' → POST {node:'plan', rating:'up', note:'nice'}; 'Bad' failing → toast shows error
});
it('shows no rating for an approval step', async () => { /* awaitingRun, node="ship" → queryByText(/How did/) null */ });
it('opens run mode on Timeline from ?pane=timeline', async () => {
  renderApp(<Runs selected="r1" pane="timeline" onSelect={() => {}} />);
  act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
  act(() => FakeEventSource.all[0]!.emit('event', { seq: 1, ts: Date.now(), event: { type: 'run.started' } }));
  const panel = await screen.findByRole('complementary', { name: 'Run details' });
  expect(within(panel).getByRole('tab', { name: 'Timeline (1)' }).getAttribute('aria-selected')).toBe('true');
});
it('opens run mode on Changes from Run details and Review diff, and keeps the branch diff live', async () => {
  // click 'Run details' → panel 'Run details', tab 'Changes' selected; GET /api/runs/r1/diff called; a later commit refetches; a cost-only update does not
});
```
Port the old `Inspector.test.tsx` cases that still apply (not-in-run note, why-Tether-picked, per-file bars for a step commit, diff error with Retry) into `StepInspector.test.tsx`, then delete `Inspector.test.tsx`.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/runs/inspectorModel.test.ts web/src/runs/StepInspector.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement** the model, `Rating`, `StepView`, `RunDetails`, `StepInspector` and `inspector.css`, then wire `StepInspector` into `RunPage`. Delete `Inspector.tsx` and `StepPane.tsx`.
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/runs web/src/Runs.test.tsx web/src/App.test.tsx && npm run typecheck` and expect PASS.
- [ ] **Step 5: Commit**: `git add -A web/src/runs && git commit -m "feat(web): step inspector slides over the run, with run mode, live figures, checks and rating"`

---

### Task 12: Inbox, two panes, all seven attention kinds

**Files:**
- Create: `web/src/home/inboxModel.ts`, `web/src/home/inboxModel.test.ts`
- Modify: `web/src/home/Inbox.tsx`, `web/src/home/Inbox.test.tsx`, `web/src/home/home.css`

**Interfaces:**
- Consumes: `AttentionItem` from `api`; `KIND_LABEL` and `linkFor` from `home/NeedsYou.tsx` (export `KIND_LABEL` there); `usePoll`; `TeamQuestions`, `PlanReview`, `TeamSend` (Task 8); `ApprovalCard`; `StatusBadge` tone form; `RowList`, `QuietLine`; `shortRunId`; `useNotify`.
- Produces:
  ```ts
  // inboxModel.ts
  export interface InboxEntry { key: string; kind: AttentionItem['kind']; runId: string; items: AttentionItem[] }
  export function groupInbox(items: AttentionItem[]): InboxEntry[];
  export function nextSelection(prev: InboxEntry[], next: InboxEntry[], selected?: string): string | undefined;
  export const ACTION_WORD: Record<AttentionItem['kind'], string>; // question 'answer', approval 'approve', plan_ready 'review', interrupted 'resume', failed 'retry', planning_error 'retry', paused 'open'
  // Inbox.tsx
  export const INBOX_MS = 3000; // unchanged
  export function Inbox(p: { onGo: (r: Route) => void }): JSX.Element; // unchanged
  ```

`groupInbox` merges all `question` items of one run into one entry with key `${runId}:questions`, placed where that run's newest question was. Every other item is its own entry with `key = item.id`. The server order (newest first) is kept. `nextSelection` keeps `selected` when it is still in `next`. Otherwise it returns `next[min(oldIndex, next.length-1)]?.key`, where `oldIndex` is `selected`'s index in `prev`, and when there was no selection it returns `next[0]?.key`.

Layout: `ScreenHeader title="Inbox"`, then `.inbox-cols` with a `280px minmax(0,1fr)` grid, gap 18px, stacking under 1100px.
- **List**: `RowList label="Inbox"` with one row per entry, as a `<button aria-current>` row. Each row has a 6px pulsing amber dot (red for `failed`/`planning_error`), the title (`items[0].title`) and the muted line (`Question 1 of ${n} · ${shortRunId(runId)}` for question entries, `${KIND_LABEL[kind]} · ${shortRunId(runId)}` otherwise). On the right sits `<StatusBadge tone={failed-ish ? 'failed' : 'needs'} label={ACTION_WORD[kind]} />`. Rows leave with a 180 ms fade/collapse through `AnimatePresence`, and not under reduced motion.
- **Detail**, for the selected entry:
  - `question`: a mono eyebrow `NEEDS YOUR ANSWER`, then `<TeamQuestions run={view} send={send} paged />` for the run fetched with `usePoll<RunView>('/api/runs/<id>', INBOX_MS)`.
  - `plan_ready`: `<PlanReview run={view} send={send} />`, the same fetch, shown in full.
  - `approval`: `<ApprovalCard title={item.title} description={item.meta} …/>`. Approve and reject post `approve` with `{ node, approved }`.
  - `planning_error` / `paused` / `interrupted` / `failed`: the title, the meta, and the item's action buttons, where `resume`/`retry` post `resume` and `open` calls `onGo(linkFor(item, 'open'))`. An **Open run** link sits at the bottom of every detail.
  - While the view loads, show `Loading`. A fetch error shows `InlineError` with Retry.
- `send: TeamSend` posts `/api/runs/<id>/<path>`, refetches attention, toasts failures through `notify.fail` and resolves to a boolean.
- After every attention poll, selection is set with `nextSelection`.
- Empty state: `QuietLine` "Nothing needs you."

- [ ] **Step 1: Write the failing tests**

```ts
const it_ = (id: string, kind: AttentionItem['kind'], runId = 'r1', ts = 1): AttentionItem => ({ id, ts, runId, kind, title: id, meta: 'm', actions: [] });
it('groups a run’s questions and keeps other items apart, in order', () => {
  const g = groupInbox([it_('a', 'question', 'r1', 5), it_('b', 'approval', 'r2', 4), it_('c', 'question', 'r1', 3)]);
  expect(g.map((e) => [e.key, e.items.length])).toEqual([['r1:questions', 2], ['b', 1]]);
});
it('moves the selection to the neighbour when the open item goes', () => {
  const A = groupInbox([it_('a', 'failed'), it_('b', 'paused', 'r2'), it_('c', 'failed', 'r3')]);
  expect(nextSelection(A, A.filter((e) => e.key !== 'b'), 'b')).toBe('c');
  expect(nextSelection(A, A.slice(0, 2), 'c')).toBe('b');
  expect(nextSelection(A, [], 'a')).toBeUndefined();
  expect(nextSelection([], A, undefined)).toBe('a');
});
it('covers all seven kinds with an action word', () => expect(Object.keys(ACTION_WORD).sort()).toEqual(['approval', 'failed', 'interrupted', 'paused', 'plan_ready', 'planning_error', 'question']));
```
```tsx
it('shows the list and the open question with Previous and Next, sending answers together', async () => {
  // attention: two question items for r1; GET /api/runs/r1 → team run with pending q1, q2 → row text 'Question 1 of 2 · R-…'; detail '1 of 2'; pick, Next, pick, 'Send answers' → POST /api/runs/r1/answers once with both
});
it('keeps Use recommendations', async () => { /* click → POST answers with recommended options */ });
it('reviews a ready plan in full, with Reject asking first', async () => { /* plan_ready → 'Approve and start'; 'Reject' → 'Yes, reject' */ });
it('approves an approval item and opens the next one', async () => { /* approval + failed items → Approve → POST approve; after refetch the failed item is open with 'Retry' */ });
it('offers Resume for an interrupted run and Retry for a failed one', async () => { /* buttons post /resume */ });
it('keeps working when the open item vanishes', async () => { /* open item b; next poll drops b → detail shows c, no error */ });
it('shows a failed run load with Retry', async () => { /* GET /api/runs/r1 → Error('gone') → 'gone' + Retry */ });
it('says when nothing needs you', async () => { expect(await screen.findByText('Nothing needs you.')).toBeTruthy(); });
```

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/home/inboxModel.test.ts web/src/home/Inbox.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement** `inboxModel.ts` and the two-pane `Inbox.tsx` with its CSS (`.inbox-cols`, `.inbox-opt` rows reuse `RadioCards` through `TeamQuestions`).
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/home web/src/App.test.tsx && npm run typecheck` and expect PASS.
- [ ] **Step 5: Commit**: `git add web/src/home && git commit -m "feat(web): two-pane Inbox for every attention kind, with paged questions"`

---

### Task 13: beui file tree on the Code page

**Files:**
- Create: `web/src/components/beui/motion/file-tree.tsx`, `web/src/components/beui/motion/shared-layout-bg.tsx`
- Modify: `web/src/code/FileTree.tsx`, `web/src/code/treeModel.ts`, `web/src/code/treeModel.test.ts`, `web/src/code/Code.test.tsx`, `web/src/code/code.css`

**Interfaces:**
- Consumes: `.superpowers/components/beui/file-tree/source.tsx` (git-ignored; copy from it); `EASE_OUT`, `SPRING_LAYOUT`, `SPRING_SWAP` from `components/beui/lib/ease`; `cn` from `components/beui/lib/utils`.
- Produces:
  ```ts
  // shared-layout-bg.tsx
  export interface SharedLayoutBgProps extends HTMLAttributes<HTMLDivElement> { inset?: number; pillClassName?: string; pillContainerClassName?: string; children: ReactNode }
  export function SharedLayoutBg(p: SharedLayoutBgProps): JSX.Element;
  // file-tree.tsx: as the source (FileTree, FileTreeFolder, FileTreeFile, props types), plus one adaptation:
  //   FileTreeFolderProps / FileTreeFileProps gain `trailing?: ReactNode`, rendered after the label span inside the row button.
  // treeModel.ts
  export interface TreeNode { path: string; name: string; kind: 'dir' | 'file'; git?: GitBadge; children: TreeNode[] }
  export function nestRows(rows: Row[]): TreeNode[];
  export function expandDiff(prev: ReadonlySet<string>, next: string[]): { expand?: string; collapse?: string };
  // FileTree.tsx: signature unchanged
  export function FileTree(p: { rows: Row[]; expanded: ReadonlySet<string>; current?: string; changed: ReadonlySet<string>; onExpand: (dir: string) => void; onCollapse: (dir: string) => void; onOpen: (path: string) => void }): JSX.Element;
  ```

Vendoring: `file-tree.tsx` is the pasted source with relative imports (`../lib/ease`, `../lib/utils`, `./shared-layout-bg`), `"use client"` removed, the header in the `animated-badge.tsx` style naming `components/motion/file-tree.tsx` and listing the adaptations (relative imports, `trailing` slot), and the body otherwise unchanged. `shared-layout-bg.tsx`: if `https://raw.githubusercontent.com/starc007/ui-components/main/components/motion/shared-layout-bg.tsx` is reachable, vendor it the same way. Otherwise write the equivalent with the props above. It renders a `div` with `{...rest}` and `position: relative`, tracks the hovered or focused **direct child** through `pointerover`/`focusin`, and draws one `motion.div` pill (`aria-hidden`, class `absolute` plus `pillContainerClassName`, an inner `pillClassName`) at that child's `offsetTop`/`offsetHeight`, inset by `inset`. The pill moves with `SPRING_LAYOUT`, is hidden on `pointerleave` and `focusout` outside, and jumps without animation under reduced motion. Its header says it is a Tether equivalent of beui's component, under the same MIT notice.

The adapter in `FileTree.tsx` maps `nestRows(rows)` recursively to `<FileTreeFolder value=path name …>` and `<FileTreeFile value=path name …>`. Folders that have not loaded get no children; beui still shows the chevron and `aria-expanded`. It passes `expandedIds={[...expanded]}`, `value={current ?? null}` and `ariaLabel="Files"`. `onExpandedChange(next)` calls `expandDiff(expanded, next)` and then `onExpand` or `onCollapse`. `onValueChange(v)` calls `onOpen(v)` only when `v` is a file. `trailing` holds today's `.code-run-dot` with its `sl-sr` "changed by runs" and the `.code-git` badge with its `sl-sr` text, both unchanged. beui's `bg-muted`, `text-muted-foreground` and `bg-border` already map through `tw.css`. Check `ring` and `foreground` too, which are mapped. Delete `keyMove` and its tests once nothing imports it.

- [ ] **Step 1: Write the failing tests**

```ts
it('nests flat depth rows into a tree', () => {
  const rows: Row[] = [{ name: 'src', path: 'src', kind: 'dir', depth: 0 }, { name: 'a.ts', path: 'src/a.ts', kind: 'file', depth: 1, git: 'M' }, { name: 'README.md', path: 'README.md', kind: 'file', depth: 0 }];
  expect(nestRows(rows)).toEqual([{ path: 'src', name: 'src', kind: 'dir', children: [{ path: 'src/a.ts', name: 'a.ts', kind: 'file', git: 'M', children: [] }] }, { path: 'README.md', name: 'README.md', kind: 'file', children: [] }]);
});
it('turns beui’s expanded list into one expand or collapse', () => {
  expect(expandDiff(new Set(['a']), ['a', 'b'])).toEqual({ expand: 'b' });
  expect(expandDiff(new Set(['a', 'b']), ['a'])).toEqual({ collapse: 'b' });
});
```
In `Code.test.tsx`, `'opens folders lazily, moves with the keyboard and opens a file with Enter'` stays as written, since beui's keys match: → opens, ↓ moves, Enter opens. Add:
```tsx
it('draws the tree with beui: branch lines and a sliding highlight', async () => {
  setup();
  const tree = await screen.findByRole('tree', { name: 'Files' });
  expect(tree.querySelectorAll('button[role="treeitem"]').length).toBeGreaterThan(0);
});
it('keeps the vendored MIT notice', () => {
  expect(readFileSync(new URL('../components/beui/motion/file-tree.tsx', import.meta.url), 'utf8')).toMatch(/MIT License, Copyright \(c\) 2026 Saurabh Chauhan/);
});
```

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run web/src/code` and expect FAIL.
- [ ] **Step 3: Vendor the two beui files and rewrite `FileTree.tsx`** as the adapter. Trim `code.css` rules for `.code-row` and `.code-caret` that no longer apply, and keep `.code-run-dot` and `.code-git`.
- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run web/src/code && npm run typecheck` and expect PASS.
- [ ] **Step 5: Commit**: `git add web/src/components/beui/motion web/src/code && git commit -m "feat(web): Code page file tree on beui's FileTree"`

---

### Task 14: StatusBadge everywhere else, and remove the duplicates

**Files:**
- Modify: `web/src/Canvas.tsx`, `web/src/Builder.tsx`, `web/src/Evolve.tsx`, `web/src/ui/studio/SettingsDrawer.tsx`, `web/src/settings/Accounts.tsx`, `web/src/triggers/Deliveries.tsx`, `web/src/triggers/TriggerRow.tsx`, `web/src/triggers/TriggerTest.tsx`, `web/src/triggers/types.ts`, `web/src/code/RunsLens.tsx`, `web/src/crew/RunsOn.tsx`, `web/src/crew/CrewCard.tsx`, `web/src/components/beui/kit/controls.tsx`, `web/src/components/beui/kit/index.ts`, `web/src/ui/studio/parts.css`, and the tests that query `.sl-chip`
- Delete: `web/src/ui/studio/StatusChip.tsx`, `web/src/ui/studio/StatusChip.test.tsx`

**Interfaces:**
- Consumes: `StatusBadge`, `toneFor`, `Tone`, `stepDesc`, `badgeFor` (Task 1).
- Produces: none. After this task `grep -rn "StatusChip\|kit/controls'.*Badge\|<Badge" web/src` is empty.

Rules:
- A run or step status becomes `<StatusBadge desc=…/>`. In `Canvas.tsx` the step chip becomes `desc={stepDesc(node, st)}`. In `RunsLens.tsx` it becomes `desc={{ of: 'run', status: r.status, live, waiting: false }}`.
- Any other label (Builder issues, Evolve labels, connection, accounts, trigger outcomes, crew "agent not available"/"proposal") becomes `<StatusBadge tone=… label=… />`, with `pulse` kept where it was.
- `triggers/types.ts` imports `Tone` from `StatusBadge`.
- Delete kit `Badge` and its `Tone`/`STATUS` from `controls.tsx` and its export from `kit/index.ts`.
- Delete the `.sl-chip*` rules from `parts.css`. Keep `.sl-dot` and `.sl-dot.pulse`, which Activity and Section use.

- [ ] **Step 1: Write the failing test** (in `StatusBadge.test.tsx`)

```ts
it('is the only status badge in the app', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const files = execSync('git ls-files web/src', { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => /\.tsx?$/.test(f) && !f.endsWith('StatusBadge.test.tsx'));
  const offenders = files.filter((f) => /StatusChip|\bBadge\b.*from '.*kit/.test(readFileSync(join(root, f), 'utf8')));
  expect(offenders).toEqual([]);
});
```
- [ ] **Step 2: Run it and see it fail.** Run `npx vitest run web/src/ui/studio/StatusBadge.test.tsx` and expect FAIL with the offender list.
- [ ] **Step 3: Migrate every caller** and delete `StatusChip.tsx`, its test, kit `Badge` and the `.sl-chip` CSS. Change any test selectors that still read `.sl-chip.t-*` to `[data-status=…]`.
- [ ] **Step 4: Run the whole web suite and typecheck.** Run `npx vitest run web/src && npm run typecheck` and expect everything to PASS with no type errors.
- [ ] **Step 5: Commit**: `git add -A web/src && git commit -m "refactor(web): StatusBadge replaces StatusChip and the kit Badge everywhere"`

---

### Task 15: Final verification (suite, typecheck, Chrome in both themes)

**Files:** none (fix-ups only, committed separately if any)

- [ ] **Step 1: Full test suite.** Run `npx vitest run` and expect all tests to pass, server and web. If a snapshot changed on purpose, update it with `npx vitest run -u <file>` and say why in the commit.
- [ ] **Step 2: Typecheck.** Run `npm run typecheck` and expect exit 0 with no output errors.
- [ ] **Step 3: Build and serve against a copy of real data.**
  ```bash
  H="$CLAUDE_JOB_DIR/tmp/tether-home"   # not /tmp: parallel jobs share it
  rm -rf "$H" && mkdir -p "$H" && rsync -a --exclude worktrees ~/.aorch/ "$H/"
  npm run build && TETHER_HOME="$H" npm run dev -- --port 4232
  ```
  Expected: the dashboard is served on http://127.0.0.1:4232 (4177 and 4199 may already be taken by other sessions;
  pick another free port if 4232 is busy). Never point it at the real `~/.aorch`.
- [ ] **Step 4: Chrome check** (claude-in-chrome), in light and dark at 1440×900, 1024×768 and 390×844, next to `docs/design/AppDemo.html` and `docs/design/StepInspector.html`:
  - Home: title only. Composer chips open their pickers and suggestions show on focus. Needs you, Running and Recent are boxed lists. Activity is at most 8 lines, with repeats collapsed and no Pause. Crew shows busy dots. The side column stacks under 1100px.
  - Runs list: task titles, kind tags, a failed run with a red ✕ and a red badge, and filters in one row.
  - A finished team run, a failed run (red notice line, Retry failed) and a run waiting for approval (sticky bar visible without scrolling, Review diff opens Run details on Changes).
  - Inspector: opens from a card and from a typed `#/runs/<id>/<node>`. ← → slide between steps. Esc and the scrim close it back to `#/runs/<id>`. Rating posts and the note saves. Checks rows show on a gate. Time ticks on a live step. It is a full-height sheet at 390px.
  - `#/runs/<id>?pane=timeline` opens Run details on Timeline.
  - Inbox: every kind present in the data opens its card. Questions page with Previous/Next. Acting removes the row and opens the next.
  - Code: the beui tree shows branch lines, the sliding highlight, changed-file dots and git letters.
  - Team plan disclosure: no right-edge overflow with long step titles.
  - DevTools → Rendering → `prefers-reduced-motion: reduce`: no motion anywhere, including badges, the graph dot, inspector slides and activity decode.
  - No purple/indigo, no glows, no stat tiles.
- [ ] **Step 5: Commit fix-ups if any**: `git commit -m "fix(web): <what the Chrome check found>"`. The message has no attribution lines.
