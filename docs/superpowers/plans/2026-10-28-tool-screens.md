# Tool Screens (Builder, Crew, API client, Graph, Triggers, Settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the six tool screens in one frame (dotted backdrop, floating toolbars, one docked panel), give the Builder a
Canvas and an Outline mode with a shared docked editor, turn Crew into a lineup with a bench you drag from, and move the
API client, Graph, Triggers and Settings into the same frame. Behaviour, API and data stay as they are, except the Crew
drop of §15.1, which uses the existing `PUT/DELETE /api/crew/<id>`.

**Architecture:** One small shared module (`ui/studio/ToolFrame.tsx`: `ToolScreen`, `FloatBar`, `Dock`, `MenuButton`)
that every screen composes. Screens keep their state and handlers; only their layout moves into the frame. Pure helpers
(`builder/stepText.ts`, `crew/lineup.ts`) get unit tests; components get Testing Library tests. `GraphBoard` is not
touched. Phase A (Tasks 1–6) is the frame, Builder and Crew; Phase B (Tasks 7–11) is the API client, Graph, Triggers,
Settings and the final check.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (no preflight; utilities only for beui/bencho/aicss/faces/assistant
sources) next to Studio CSS tokens, vendored beui kit, `motion/react`, lucide, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-28-tool-screens-design.md` (§15 overrides earlier sections). Approved mockup:
`docs/design/Round2Screens.html` (its script shows each screen's interactions).

## Global Constraints

- Work only in `.claude/worktrees/app-like-demo` on `feature/app-like-demo-2`. Never `npm install`; `node_modules` is a symlink. No new dependencies.
- **No behaviour, API or data changes.** No new endpoints, no new stored state. Existing routes keep working (`#/builder`, `#/builder/<name>`, `#/crew`, `#/crew/<bot>`, `#/api`, `#/api/<request>`, `#/graph`, `#/graph/<note>`, `#/triggers`, `#/settings`, `#/settings/<section>`). Only addition: the Crew drop and its Undo call `PUT`/`DELETE /api/crew/<builtin-id>` (§15.1).
- Every capability on these screens today stays reachable, at most one click away.
- No purple or indigo, no glows (zero-offset blurred shadows), no bento stat tiles, no gradient backgrounds (`rules.test`): dots are a solid fill cut by a mask, as `canvas.css` and `runs/graph.css` do.
- Studio tokens only (`--bg --s1 --s2 --s3 --side --ink --mut --line --line2 --edge --acc --accBg --accInk --ok --okBg --warn --warnBg --bad --badBg`), no raw hex. Light and dark get equal care.
- Studio components style through CSS files (Tailwind classes are generated only for beui/bencho/aicss/faces/assistant). No global class named like a bare Tailwind utility (`rules.test`). beui parts that render bare `<button>`s need a reset (`border: 0; background: transparent`) where they sit in Studio CSS.
- Motion stops under `prefers-reduced-motion` (the root rule in `studio.css` zeroes durations; hover lifts also get `transform: none`).
- Commits: plain conventional messages; never `Co-Authored-By`, never "Claude" or "Claude Code". Do not push.
- Each task ends with `npx vitest run web/src/<touched paths>` and `npm run typecheck` clean.

## Decisions the spec leaves open (or gets wrong about the code)

- **"/" instead of ⌘K on the add-step bar.** ⌘K is the app's Jump to menu (`App.tsx` owns it on every screen); taking it on the Builder would change existing behaviour. The bar shows `/`, the key the Outline already uses (§6), and "/" works in both modes.
- **The bench is the library only** (ECC and your own bots, §7). Built-ins are the lineup, so the bench's tabs are All / Yours / ECC; "Built-in" is the lineup itself.
- **No canvas hint line on desktop.** The connect/delete how-to already sits in the workflow settings (`SettingsForm`'s help); a bottom-left line would collide with the add-step bar. The phone hint stays.
- **Face after a drop.** A bot's face is generated from its id, so a slot that takes a bench bot's look keeps the slot id's face shape with the bench bot's face pins (hue, tone); name, persona and look colour do change.

## Review Focus

1. **Esc inside the dock while a field or popup is in use** (typing a prompt, an open Select, Picker or menu): Esc must blur the field or close the popup, never close the dock and lose the editor. Pinned in Task 1 (`Esc in a field blurs it; with a dialog, menu or listbox open the dock stays`).
2. **A drop onto the slot whose bot is open in the dock with unsaved edits**: ask before discarding, then show the new identity in the dock. Pinned in Task 6 (`asks before a drop replaces the open bot's unsaved edits`).
3. **A drop or Undo the server refuses** (400, network): an error toast, no "now plays" note, the lineup as it was. Pinned in Task 6 (`a refused drop shows the error and no note`).
4. **Typing "/" where text goes** (name field, prompt textarea, the add menu's own search): it types a slash and never opens the add-step menu. Pinned in Task 4 (`"/" opens the add-step menu, but types a slash in fields`).
5. **Odd workflows in Outline**: no steps (quiet line, no crash), a branching graph (each step once, layer order), a gate whose `fixNode` was deleted (no loop sentence). Pinned in Task 2 (`stepText` tests) and Task 4 (`outlines an empty and a branching workflow`).

---

## File map

All paths under `web/src/` unless they start with `docs/`.

| Area | Create | Modify | Delete |
|---|---|---|---|
| Frame | `ui/studio/ToolFrame.tsx`, `ui/studio/toolframe.css`, `ui/studio/ToolFrame.test.tsx` | | |
| Builder | `builder/stepText.ts`, `builder/stepText.test.ts`, `builder/Outline.tsx` | `Builder.tsx`, `Builder.test.tsx`, `Canvas.tsx`, `canvas.css`, `Canvas.test.tsx`, `builder/Palette.tsx` (palette column → add-step bar + menu), `builder/Inspector.tsx`, `builder/builder.css` | |
| Crew | `crew/lineup.ts`, `crew/lineup.test.ts`, `crew/Lineup.tsx`, `crew/Bench.tsx`, `crew/SwapPicker.tsx` | `Crew.tsx`, `Crew.test.tsx`, `crew/crew.css`, `crew/types.ts`, `crew/RunsOn.tsx` | `crew/CrewCard.tsx` |
| API client | | `http/ApiTab.tsx`, `http/Tree.tsx`, `http/ResponseView.tsx`, `http/SendToAgent.tsx`, `http/api.css` + tests | |
| Graph | `graph/Legend.tsx` | `Graph.tsx`, `graph/graph.css`, `Graph.test.tsx` (GraphBoard.tsx and its test untouched) | |
| Triggers | `triggers/TriggerCard.tsx` | `Triggers.tsx`, `triggers/TriggerForm.tsx`, `triggers/Deliveries.tsx`, `triggers/triggers.css` + tests | `triggers/TriggerRow.tsx` (+ test, folded into TriggerCard) |
| Settings | `ui/studio/SettingsPage.tsx`, `ui/studio/settings-page.css` | `App.tsx`, `ui/studio/shell.css`, tests | `ui/studio/SettingsDrawer.tsx` (+ test moves to `SettingsPage.test.tsx`) |

---

## Phase A

### Task 1: The shared frame (backdrop, floating bars, one dock, a menu button)

**Files:**
- Create: `web/src/ui/studio/ToolFrame.tsx`, `web/src/ui/studio/toolframe.css`, `web/src/ui/studio/ToolFrame.test.tsx`

**Interfaces:**
- Consumes: `useMenu` (`ui/studio/useMenu`), `.sl-menu` styles (`shell.css`), kit `Button`/`ButtonVariant`, `isTyping` (`ui/studio/useGoKeys`).
- Produces:
  ```ts
  export function ToolScreen(p: { className?: string; children: ReactNode }): JSX.Element; // div.tf-screen: fills .shell-main, dotted backdrop
  export type BarAt = 'left' | 'center' | 'right' | 'bottom';
  export function FloatBar(p: { at: BarAt; className?: string; children: ReactNode }): JSX.Element; // div.tf-bar.tf-<at>
  export function Dock(p: { label: string; head?: ReactNode; onClose: () => void; className?: string; children: ReactNode }): JSX.Element;
  export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; current?: boolean; danger?: boolean };
  export function MenuButton(p: { title: string; label: ReactNode; items: (MenuItem | 'rule')[]; variant?: ButtonVariant; align?: 'start' | 'end'; className?: string }): JSX.Element;
  ```
- `Dock` renders `<aside class="tf-dock" aria-label={label}>`, a header row (`head`, then a close button `aria-label="Close {label}"`) and a scrolling body. It never takes focus on open (the Builder canvas keeps Delete). Esc (window listener) closes it unless: a modifier is held, the event was already handled (`defaultPrevented`), or `[role="dialog"], [role="menu"], [role="listbox"]:not([aria-hidden="true"])` is in the document; in a text field Esc only blurs the field. Closing by × or Esc puts focus back on the element that had it when the dock mounted, if focus was inside the dock and that element is still connected.
- `MenuButton`: kit `Button size="sm"` (default `variant="ghost"`) with `aria-label={title}`, `aria-haspopup="menu"`, `aria-expanded`; the menu is `div.sl-menu.tf-menu[role=menu]` with `role="menuitem"` buttons (`aria-current="true"` + a check mark on `current`, `.sl-menu-danger` on `danger`) and `.sl-menu-rule` separators. Picking an item closes the menu, then runs it.
- CSS (tokens only): `.tf-screen` `position: relative; height: 100%; overflow: hidden; background: var(--side)` and `::before` dots: `background: var(--line2)` cut by `mask-image: radial-gradient(circle at 1px 1px, black 1px, transparent 1.2px)`, `mask-size: 22px 22px`. Bars and dock: `background: var(--s1)`, `box-shadow: 0 0 0 1px var(--line2), 0 10px 30px -10px rgb(0 0 0 / .25)`, radius 12 / 14 px. Bars: left/right `top: 14px` at 16 px from their edge, center `left: 50%` translated, bottom `bottom: 16px` centred. Dock: `top: 64px; right: 16px; width: 320px; max-height: calc(100% - 80px)`, a 0.22 s pop-in. Under 899 px: bars wrap, `.tf-center` drops to `top: 62px`, the dock becomes a bottom sheet (`top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 70%`).

- [ ] **Step 1: Write the failing tests** (`ToolFrame.test.tsx`)

```tsx
it('pins bars to the edge they name', () => {
  const { container } = render(<ToolScreen><FloatBar at="left">a</FloatBar><FloatBar at="bottom">b</FloatBar></ToolScreen>);
  expect(container.querySelector('.tf-screen > .tf-bar.tf-left')!.textContent).toBe('a');
  expect(container.querySelector('.tf-bar.tf-bottom')).toBeTruthy();
});
it('docks a labelled panel that × closes, handing focus back', () => {
  const onClose = vi.fn();
  render(<button>opener</button>);
  screen.getByText('opener').focus(); // focused before the dock mounts: that is where focus goes back
  render(<Dock label="Step editor" head={<h2>Code</h2>} onClose={onClose}><input aria-label="Prompt" /></Dock>);
  const dock = screen.getByRole('complementary', { name: 'Step editor' });
  expect(within(dock).getByRole('heading', { name: 'Code' })).toBeTruthy();
  screen.getByLabelText('Prompt').focus();
  fireEvent.click(within(dock).getByRole('button', { name: 'Close Step editor' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(screen.getByText('opener'));
});
it('closes on Esc; Esc in a field blurs it; with a dialog, menu or listbox open the dock stays', () => {
  const onClose = vi.fn();
  render(<Dock label="Bot" onClose={onClose}><input aria-label="Name" /></Dock>);
  const field = screen.getByLabelText('Name');
  field.focus();
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(field);
  const pop = (html: string) => document.body.appendChild(Object.assign(document.createElement('div'), { innerHTML: html }));
  for (const html of ['<div role="dialog"></div>', '<div role="menu"></div>', '<div role="listbox"></div>']) {
    const p = pop(html);
    fireEvent.keyDown(window, { key: 'Escape' });
    p.remove();
  }
  expect(onClose).not.toHaveBeenCalled();
  const closedSelect = pop('<div role="listbox" aria-hidden="true"></div>'); // beui's Select keeps its listbox mounted, hidden
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  closedSelect.remove();
});
it('opens a menu, marks the current item, runs a pick and closes', () => {
  const pick = vi.fn();
  render(<MenuButton title="Workflows" label="▾" items={[{ label: 'a', current: true, onSelect: () => {} }, 'rule', { label: 'b', onSelect: pick }, { label: 'c', disabled: true, onSelect: pick }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
  const menu = screen.getByRole('menu', { name: 'Workflows' });
  expect(within(menu).getByRole('menuitem', { name: 'a' }).getAttribute('aria-current')).toBe('true');
  expect((within(menu).getByRole('menuitem', { name: 'c' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'b' }));
  expect(pick).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).toBeNull();
});
it('draws the backdrop dots with a mask and turns the dock into a bottom sheet on narrow screens', () => {
  expect(cssRule('ui/studio/toolframe.css', '.tf-screen::before')).toContain('mask-image');
  expect(cssRule('ui/studio/toolframe.css', '.tf-screen::before')).toContain('background: var(--line2)');
  expect(cssRule('ui/studio/toolframe.css', '.tf-dock', '@media (max-width: 899px)')).toContain('bottom: 8px');
});
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run web/src/ui/studio/ToolFrame.test.tsx` → FAIL (module not found).
- [ ] **Step 3: Implement** `ToolFrame.tsx` and `toolframe.css` to the interfaces above (`MenuButton` wraps `useMenu`; anchor `span.tf-menu-anchor { position: relative }`, `.tf-menu { top: calc(100% + 6px); max-height: 320px; overflow: auto }`, `align="end"` adds `.end { right: 0 }`).
- [ ] **Step 4: Run** `npx vitest run web/src/ui/studio web/src/rules.test.ts web/src/leftovers.test.ts` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git add web/src/ui/studio/ToolFrame.tsx web/src/ui/studio/toolframe.css web/src/ui/studio/ToolFrame.test.tsx && git commit -m "feat(web): shared tool-screen frame: dotted backdrop, floating bars, one dock, a menu button"`

---

### Task 2: Readable step cards (stepText + Canvas)

**Files:**
- Create: `web/src/builder/stepText.ts`, `web/src/builder/stepText.test.ts`
- Modify: `web/src/Canvas.tsx`, `web/src/canvas.css`, `web/src/Canvas.test.tsx`, `web/src/builder/StepOrder.tsx` (use `stepTitle` instead of its local `label`)

**Interfaces:**
- Consumes: `stepOrder(nodes, edges)` from `runs/graphModel`; `PipelineNode`, `Pipeline` from `../../src/types`.
- Produces (`stepText.ts`):
  ```ts
  export const stepTitle = (n: Pick<PipelineNode, 'title' | 'role' | 'kind'>): string; // n.title ?? n.role ?? n.kind
  export function stepPreview(n: PipelineNode): string;
  export function loopLabel(n: PipelineNode, nodes: PipelineNode[]): string | undefined;    // canvas
  export function loopSentence(n: PipelineNode, nodes: PipelineNode[]): string | undefined; // outline
  export function flowLine(pl: Pick<Pipeline, 'nodes' | 'edges'>, nameOf: (n: PipelineNode) => string): string;
  ```
- Values: `stepPreview` = agent → `prompt.trim()` or `Default instructions for the <role ?? 'step'>.`; gate → `request <http.run || 'not picked yet'>` when `http`, else `$ <command ?? '…'>`; approval → `Pauses until a person signs off.`. `loopLabel` = `if it fails · back to <stepTitle(fix)> ×<maxLoops ?? 2>`; `loopSentence` = `If it fails, the output goes back to <stepTitle(fix)>, up to <n> time(s).`; both undefined without `fixNode` or when that step is gone. `flowLine` = `No steps yet` for none, else `<n> step(s) · <names in stepOrder joined by ' → '>` (§15.3).
- Canvas card (NODE_W 212, NODE_H 92 unchanged): head = `Face` 28 px, then `span.node-names` with `span.node-title` and `span.node-sub` (`<bot name lower-cased> · <kind>`); body = `div.node-preview` (2-line clamp) and the run line when `statuses` are given. The id chip, agent/model chips and flag chips leave the card (the docked editor shows them). Without statuses the loop text is `loopLabel(...)`; with statuses it stays `fix loop <loops>/<max>`. Zoom buttons move to the bottom-left as a floating mini bar (`.zoom { left: 16px; bottom: 16px }`, `--s1` with the frame shadow); `.canvas` paints `background-color: var(--side)`.

- [ ] **Step 1: Write the failing tests**

```ts
// stepText.test.ts
const agent = { id: 'code', kind: 'agent', role: 'coder', x: 0, y: 0 } as PipelineNode;
const gate = { id: 'gate', kind: 'gate', command: 'npm test', fixNode: 'code', maxLoops: 3, x: 0, y: 0 } as PipelineNode;
it('previews what a step does', () => {
  expect(stepPreview({ ...agent, prompt: '  Make it small. ' })).toBe('Make it small.');
  expect(stepPreview(agent)).toBe('Default instructions for the coder.');
  expect(stepPreview(gate)).toBe('$ npm test');
  expect(stepPreview({ ...gate, command: undefined, http: { run: '' } })).toBe('request not picked yet');
  expect(stepPreview({ id: 'ok', kind: 'approval', x: 0, y: 0 } as PipelineNode)).toBe('Pauses until a person signs off.');
});
it('words a fix loop for the canvas and the outline, and drops it when its step is gone', () => {
  expect(loopLabel(gate, [agent, gate])).toBe('if it fails · back to coder ×3');
  expect(loopSentence({ ...gate, maxLoops: 1 }, [agent, gate])).toBe('If it fails, the output goes back to coder, up to 1 time.');
  expect(loopSentence(gate, [gate])).toBeUndefined();
  expect(loopLabel(agent, [agent])).toBeUndefined();
});
it('lines up the steps under the outline title (§15.3)', () => {
  expect(flowLine({ nodes: [], edges: [] }, () => '')).toBe('No steps yet');
  expect(flowLine({ nodes: [gate, agent], edges: [{ from: 'code', to: 'gate' }] }, (n) => (n.id === 'code' ? 'Bolt' : 'Probe'))).toBe('2 steps · Bolt → Probe');
});
```

```tsx
// Canvas.test.tsx (add)
it('shows a readable card: face, title, bot · kind and a two-line preview', () => {
  const { container } = render(<Canvas nodes={nodes} edges={edges} />);
  const code = container.querySelector('[data-id="code"]')!;
  expect(code.querySelector('.node-sub')!.textContent).toBe('bolt · agent');
  expect(container.querySelector('[data-id="gate"] .node-preview')!.textContent).toBe('$ npm test');
  expect(cssRule('canvas.css', '.node-preview')).toContain('-webkit-line-clamp: 2');
});
it('labels a fix loop with where it goes back to', () => {
  const { container } = render(<Canvas nodes={nodes} edges={edges} />);
  expect(container.querySelector('.loop text')!.textContent).toBe('if it fails · back to coder ×2');
});
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run web/src/builder/stepText.test.ts web/src/Canvas.test.tsx`
- [ ] **Step 3: Implement** `stepText.ts`, then the card and loop label in `Canvas.tsx` and `canvas.css` (bot name: `crew[crewFor(n, crew)]?.name ?? 'bot'`).
- [ ] **Step 4: Run** `npx vitest run web/src/builder web/src/Canvas.test.tsx web/src/Builder.test.tsx web/src/rules.test.ts` → PASS; in `Builder.test.tsx` change the one `.node.selected .cmd` query to `.node.selected .node-preview`. `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(web): builder canvas cards read as face, title, bot and a two-line preview; fix loops say where they go back to`

---

### Task 3: Builder in the frame: toolbars, docked editor, workflow settings, add-step bar and menu

**Files:**
- Modify: `web/src/Builder.tsx`, `web/src/builder/Palette.tsx`, `web/src/builder/Inspector.tsx`, `web/src/builder/builder.css`, `web/src/Builder.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`ToolScreen`, `FloatBar`, `Dock`, `MenuButton`); `CommandPalette` / `CommandItem` (`components/beui/motion/command-palette`); `PALETTE`, `INTEGRATIONS`, `EccSkill` (stay in `Palette.tsx`).
- Produces (`builder/Palette.tsx`, the `Palette` column component is removed):
  ```ts
  export const QUICK: { label: 'Agent' | 'Gate' | 'Approval' | 'Skill' | 'HTTP' | 'Webhook'; make?: () => Partial<PipelineNode> }[]; // Agent=PALETTE Coder, Gate, Approval, Skill (no make: opens the menu), HTTP=INTEGRATIONS 'HTTP request', Webhook
  export function AddStepBar(p: { onMenu: () => void; onAdd: (make: () => Partial<PipelineNode>) => void }): JSX.Element; // FloatBar at="bottom": "+ Add step" (kbd "/") then the six quick kinds
  export function AddStepMenu(p: { open: boolean; onOpenChange: (o: boolean) => void; selected?: string; skills: EccSkill[]; onAdd: (make: () => Partial<PipelineNode>, after?: string) => void; onSkill: (s: EccSkill) => void }): JSX.Element;
  ```
  `AddStepMenu` is a `CommandPalette` (`label="Add a step"`, `placeholder="Find a step, integration or skill"`, `shortcut={null}`) with groups `Steps` (PALETTE, description = hint), `Integrations`, `After <selected>` (only with a selection; items labelled `<label> after <selected>`, calling `onAdd(make, selected)`) and `Skills` (description `ECC skill · …` / `ECC command · …`).
- Produces (`builder/Inspector.tsx`): `export function StepHead(p: { node: PipelineNode }): JSX.Element` (face 32 px, `h2.bl-step-title`, `p.bl-step-kind` = KIND_LINE · id). `StepForm` loses its head and the "Pipeline settings: …" line (`onSettings` prop removed); `SettingsForm` loses its own heading.
- Builder layout (all inside `ToolScreen className="bl-screen"`): the `Canvas` fills it (`.bl-screen > .canvas { position: absolute; inset: 0 }`, no desktop `hint`; the phone hint stays). `FloatBar at="left"`: sr-only `h1` with the name, the name `input.bl-name[aria-label="Pipeline name"]` (phone: plain text), `MenuButton title="Workflows"` (chevron; saved workflows with `current`, then a rule and `New workflow` on desktop), `span.bl-saved` (`Saved` / `Unsaved changes`) and the issues badge toggle (unchanged). Issues list floats under it (`.bl-issues` absolute, `top: 64px; left: 16px`). `FloatBar at="right"`: `$<cap> cap` when `maxCostUsd`, `Settings` (desktop, `aria-pressed`), `Save` only while dirty (desktop), `Run`. Dock (desktop only): selected step → `Dock label="Step editor" head={<StepHead/>}` with `StepForm`; else Settings open → `Dock label="Workflow settings"` (head `h2` "Workflow settings") with `SettingsForm`. Selecting a step (or empty canvas) closes Settings; Settings clears the selection; the dock's close clears both. `AddStepBar` on desktop; `AddStepMenu` always mounted. Phone note floats at the bottom.

- [ ] **Step 1: Write the failing tests** (`Builder.test.tsx`; existing tests move to the new controls: `New` → `Workflows` menu → `New workflow`; the header meta line and the `Steps palette` / `Step inspector` regions are gone; "Pipeline settings" heading → "Workflow settings")

```tsx
const openStep = (id: string) => fireEvent.pointerDown(document.querySelector(`[data-id="${id}"] .node-body`)!, { pointerId: 1 });
it('edits a selected step in the dock and closes it with Esc', async () => {
  renderApp(<Builder onStarted={() => {}} />);
  await screen.findByDisplayValue('plan-code-review');
  openStep('code');
  const dock = screen.getByRole('complementary', { name: 'Step editor' });
  expect(within(dock).getByRole('heading', { level: 2, name: 'coder' })).toBeTruthy();
  expect(within(dock).getByText('Agent step')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('complementary', { name: 'Step editor' })).toBeNull();
});
it('opens the workflow settings in the same dock from Settings', async () => {
  renderApp(<Builder onStarted={() => {}} />);
  await screen.findByDisplayValue('plan-code-review');
  openStep('code');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.queryByRole('complementary', { name: 'Step editor' })).toBeNull();
  const dock = screen.getByRole('complementary', { name: 'Workflow settings' });
  expect(within(dock).getByLabelText('Step timeout (minutes)')).toBeTruthy();
});
it('adds steps from the bar and from the menu: steps, integrations after the selected step, skills', async () => {
  renderApp(<Builder onStarted={() => {}} />);
  await screen.findByDisplayValue('plan-code-review');
  await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('button', { name: 'Approval' }));
  expect(document.querySelectorAll('[data-node]')).toHaveLength(4);
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
  const menu = screen.getByRole('dialog', { name: 'Add a step' });
  expect(within(menu).getByText('Planner')).toBeTruthy();
  fireEvent.click(within(menu).getByText('Webhook after approve')); // the new Approval step is selected
  await waitFor(() => expect((calls('POST', '/api/preflight').at(-1)![2] as typeof pcr).edges).toContainEqual({ from: 'approve', to: 'notify' }));
  fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tdd' } });
  await act(async () => fireEvent.click(await screen.findByText('tdd-workflow')));
  await waitFor(() => expect((calls('POST', '/api/preflight').at(-1)![2] as typeof pcr).nodes.at(-1)).toMatchObject({ title: 'tdd-workflow', prompt: 'PROMPT' }));
});
it('shows Save only with unsaved changes and the spend cap when one is set', async () => {
  routeApi({ ...routes, 'GET /api/pipelines/plan-code-review': { pipeline: { ...pcr, settings: { ...pcr.settings, maxCostUsd: 5 } } } });
  renderApp(<Builder onStarted={() => {}} />);
  await screen.findByDisplayValue('plan-code-review');
  expect(screen.getByText('$5 cap')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'pcr-2' } });
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
});
it('picks a workflow and starts a new one from the name menu', async () => {
  renderApp(<Builder onStarted={() => {}} />);
  await screen.findByDisplayValue('plan-code-review');
  fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
  expect(screen.getByRole('menuitem', { name: 'plan-code-review' }).getAttribute('aria-current')).toBe('true');
  fireEvent.click(screen.getByRole('menuitem', { name: 'other' }));
  await waitFor(() => expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('other'));
  fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'New workflow' }));
  expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('untitled');
});
```

(`routes` is the `beforeEach` route table lifted into a const.) Keep every other existing Builder test, retargeted.

- [ ] **Step 2: Run and see them fail.** `npx vitest run web/src/Builder.test.tsx`
- [ ] **Step 3: Implement** the layout above in `Builder.tsx` (state: `settingsOpen`, `adding`; reuse `addNode`, `addSkill`, `guard`, `pick`, `fresh`), `AddStepBar`/`AddStepMenu` in `Palette.tsx`, `StepHead` in `Inspector.tsx`, and `builder.css` (drop `.bl-page`, `.bl-body`, `.bl-palette`, `.bl-item*`, `.bl-glyph`, `.bl-inspector`, `.bl-settings-line` rules; add `.bl-screen`, `.bl-name`, `.bl-issues` floating, `.bl-add` bar parts, `.bl-cap`).
- [ ] **Step 4: Run** `npx vitest run web/src/Builder.test.tsx web/src/builder web/src/Canvas.test.tsx web/src/App.test.tsx web/src/leftovers.test.ts web/src/rules.test.ts` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(web): builder in the tool frame: name menu, docked step editor and workflow settings, add-step bar and menu`

---

### Task 4: Outline mode, the mode switch and "/"

**Files:**
- Create: `web/src/builder/Outline.tsx`
- Modify: `web/src/Builder.tsx`, `web/src/builder/builder.css`, `web/src/Builder.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`stepTitle`, `stepPreview`, `loopSentence`, `flowLine`), `stepOrder`, `crewFor`/`useCrew`, `Face`, kit `SegmentedControl`, `isTyping`.
- Produces:
  ```ts
  export type BuilderMode = 'canvas' | 'outline';
  export function Outline(p: { pl: Pipeline; selected?: string; issueNodes: Set<string>; onSelect: (id: string) => void; onAdd: () => void }): JSX.Element;
  ```
- `Outline`: `div.bl-outline` (scrolls, right padding 352 px so the dock never covers it) → `div.bl-paper` (max 600 px): `h2` workflow name, `p.bl-desc` = `flowLine(pl, bot name)`, `ol.bl-flow` of `button.bl-blk[aria-pressed]` in `stepOrder` with `span.bl-blk-n` (1-based), face, bold title, `· <bot>` plus ` on <agent · model>` when the step names either, chips `read-only` (readOnly) and the kind (non-agent), the preview, and `loopSentence` in `--warn`; an issue step gets `.issue`; then `button.bl-slash` "＋ type / to add a step" calling `onAdd`. No steps: the desc line reads `No steps yet` and only the slash button shows.
- Builder: `FloatBar at="center"` holds `SegmentedControl label="View"` (Canvas, Outline). The mode survives remounts within the page session through a module-level `let lastMode: BuilderMode = 'canvas'` (no storage). Selection and dock are shared. `AddStepBar` shows in Canvas only. A window `keydown` "/" (no modifier, not `isTyping`, no `[role="dialog"]` open, desktop) prevents default and opens `AddStepMenu`.

- [ ] **Step 1: Write the failing tests** (`Builder.test.tsx`)

```tsx
it('switches between Canvas and Outline, keeping the selected step and its editor', async () => {
  renderApp(<Builder onStarted={() => {}} />);
  await screen.findByDisplayValue('plan-code-review');
  openStep('code');
  fireEvent.click(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Outline' }));
  expect(document.querySelector('.canvas')).toBeNull();
  expect(document.querySelector('.bl-blk[aria-pressed="true"]')!.textContent).toContain('coder');
  expect(screen.getByRole('complementary', { name: 'Step editor' })).toBeTruthy();
});
it('outlines the workflow: numbered blocks in run order, bot, chips, preview and the loop sentence', async () => {
  renderApp(<Builder onStarted={() => {}} />); // mode is still Outline from the last test: the session remembers it
  await screen.findByDisplayValue('plan-code-review');
  expect(screen.getByText('3 steps · Scout → Bolt → Probe')).toBeTruthy();
  const blocks = [...document.querySelectorAll('.bl-blk')];
  expect(blocks.map((b) => b.querySelector('.bl-blk-n')!.textContent)).toEqual(['1', '2', '3']);
  expect(blocks[2]!.textContent).toContain('If it fails, the output goes back to coder, up to 2 times.');
  fireEvent.click(blocks[0]!);
  expect(screen.getByRole('complementary', { name: 'Step editor' })).toBeTruthy();
});
it('outlines an empty and a branching workflow', async () => {
  const branchy = { ...pcr, name: 'other', nodes: [...pcr.nodes, { id: 'docs', kind: 'agent', role: 'planner', x: 520, y: 200 }], edges: [...pcr.edges, { from: 'code', to: 'docs' }] };
  routeApi({ ...routes, 'GET /api/pipelines/other': { pipeline: branchy } });
  renderApp(<Builder pipeline="other" onStarted={() => {}} />);
  await screen.findByDisplayValue('other');
  expect(document.querySelectorAll('.bl-blk')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'New workflow' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
  expect(screen.getByText('No steps yet')).toBeTruthy();
  expect(document.querySelectorAll('.bl-blk')).toHaveLength(0);
});
it('"/" opens the add-step menu, but types a slash in fields', async () => {
  renderApp(<Builder onStarted={() => {}} />);
  await screen.findByDisplayValue('plan-code-review');
  fireEvent.keyDown(screen.getByLabelText('Pipeline name'), { key: '/' });
  expect(screen.queryByRole('dialog', { name: 'Add a step' })).toBeNull();
  fireEvent.keyDown(document.body, { key: '/' });
  expect(screen.getByRole('dialog', { name: 'Add a step' })).toBeTruthy();
});
```

(The fixture's step names: plan → Scout, code → Bolt, gate → Probe through `crewFor`; adjust the expected line if `crewFor` names differ.)

- [ ] **Step 2: Run and see them fail.** `npx vitest run web/src/Builder.test.tsx`
- [ ] **Step 3: Implement** `Outline.tsx`, the switch, `lastMode` and the "/" listener; CSS `.bl-outline`, `.bl-paper`, `.bl-flow` (2 px rail on the left), `.bl-blk` (selected: `border-color: var(--ink); box-shadow: 0 0 0 3px var(--accBg)`), `.bl-blk-n`, `.bl-sent`, `.bl-slash`.
- [ ] **Step 4: Run** `npx vitest run web/src/Builder.test.tsx web/src/builder web/src/rules.test.ts web/src/leftovers.test.ts` and `npm run typecheck` → PASS. Tests that need Canvas after an Outline test click the switch back (no test-only setter).
- [ ] **Step 5: Commit** `feat(web): builder outline mode as a numbered document, a Canvas/Outline switch and "/" to add a step`

---

### Task 5: Crew lineup, bench, docked card and the actions menu

**Files:**
- Create: `web/src/crew/Lineup.tsx`, `web/src/crew/Bench.tsx`
- Modify: `web/src/Crew.tsx`, `web/src/crew/crew.css`, `web/src/crew/types.ts`, `web/src/crew/RunsOn.tsx`, `web/src/Crew.test.tsx`
- Delete: `web/src/crew/CrewCard.tsx`

**Interfaces:**
- Consumes: Task 1 frame; `busyBots` (`home/runText`); `usePoll` (`/api/runs`, 5000 ms, read only); kit `Tabs`, `SearchField`, `Dialog`, `StatusBadge`, `Face`.
- Produces:
  ```ts
  // crew/types.ts
  export type Filter = 'all' | 'custom' | 'ecc';                      // the bench's tabs; built-ins are the lineup
  export const sourceOf = (b?: BotDef): 'builtin' | 'custom' | 'ecc';
  // crew/Lineup.tsx
  export type DragFit = 'none' | 'ok' | 'no';
  export function Slot(p: { def: BotDef; row?: Row; busy: boolean; proposals: number; agentMissing: boolean; selected: boolean; fit: DragFit; onPick: () => void; onSwap?: () => void; onDrop: () => void }): JSX.Element;
  // crew/Bench.tsx
  export function Bench(p: { bots: BotDef[]; filter: Filter; onFilter: (f: Filter) => void; q: string; onQ: (q: string) => void; counts: Record<Filter, number>; hasEcc: boolean; selected?: string; onPick: (id: string) => void; onDrag: (id?: string) => void }): JSX.Element;
  ```
- `Slot`: `div.cw-slot` (drop zone; classes `on`, `over`, `ok`, `dim` from `fit`) holding `button.cw-slot-main` (`aria-label="Edit <name>"`, `aria-pressed`) with the role label (`title || role`, mono uppercase), face 40 px, name, job (`whenToUse || persona`, 2-line clamp), and a footer: model chip (`binding.agent · binding.model`, or `a person` for approval, else `claude`), proposal / agent-not-available badges, and status (`you` for approval, `StatusBadge tone="live" label="working"` when busy, else `idle`); plus `button.cw-slot-swap` "Swap…" (`aria-label="Swap <name>…"`) when `onSwap` is given. Drop wiring arrives in Task 6 (`onDrop`, `fit`): in this task Crew passes `fit="none"` and a no-op.
- `Bench`: `FloatBar at="bottom"` wide (`.cw-bench { left: 16px; right: 16px; transform: none }`; `right: 352px` while the dock is open): header `Library`, kit `Tabs` (`All n`, `Yours n`, `ECC n` when imported) and `SearchField label="Find a bot"`; a horizontal strip of `button.cw-sub` (`draggable`, `aria-label="Edit <name>"`, face 32, name, when-to-use, source chip `ECC`/`yours`); `No bots match` when the search finds none. The bench lists non-built-in bots only.
- `Crew.tsx`: `ToolScreen className={cn('cw-screen', { docked: !!edit, lib: library })}`; `div.cw-lineup` (scrolls) with the inline load error, the missing-bot note and `section.cw-slots[aria-label="Roles"]` of the built-ins in server order. `FloatBar at="left"`: `h1` Crew and `<n> roles · <m> working` (m = built-ins in `busyBots(runs)`). `FloatBar at="right"`: `Library` toggle (`aria-pressed`, bench count), `MenuButton title="More crew actions"` (`Crew packs…`, `Evolve…` disabled unless an agent/verdict bot is selected, `Import ECC…`/`Update ECC…`, `Remove ECC…` when imported, danger) and `+ New bot`. The editor (BotEditor + RunsOn + an `Evolve` button for evolvable bots) sits in `Dock label="Bot card"` with `onClose={closeDrawer}` on every width (the phone Drawer goes: the dock is the bottom sheet). Crew packs move into a `Dialog title="Crew packs"` (same pack cards). Remove ECC confirms in a `Dialog` ("Remove every ECC bot and the vendored checkout?", Cancel / Remove). After Delete/Reset focus lands on the first slot's main button. The "Local models … appear here" line moves into `RunsOn` as "Local models (Ollama, LM Studio, llama.cpp) appear in Agent when their server is running."

- [ ] **Step 1: Write the failing tests** (`Crew.test.tsx`; retarget the existing ones: header meta → the fact line, `Import ECC…`/`Update ECC…`/`Remove ECC…`/`Evolve…` through the menu, the source filter with Yours/ECC, search in the bench)

```tsx
const builtins = [bolt, { ...bolt, id: 'approval', name: 'Gate', title: 'approver', kind: 'approval', persona: 'A person.' }];
it('lines up the built-in roles with who is working, and you on Gate', async () => {
  routeApi({ ...routes, 'GET /api/crew': { ...crewReply, bots: builtins }, 'GET /api/runs': [makeRow({ live: true, steps: [{ id: 'code', status: 'running', bot: 'coder' }] })] });
  renderApp(<Crew />);
  const roles = await screen.findByRole('region', { name: 'Roles' });
  expect(within(roles).getAllByRole('button', { name: /^Edit / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Edit Bolt', 'Edit Gate']);
  expect(await screen.findByText('2 roles · 1 working')).toBeTruthy();
  expect(within(roles).getByText('working')).toBeTruthy();
  expect(within(roles).getByText('you')).toBeTruthy();
  expect(within(roles).queryByRole('button', { name: 'Swap Gate…' })).toBeNull();
});
it('opens a slot or a bench bot in the dock, and Esc closes it', async () => {
  twoBots();
  renderApp(<Crew />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Bolt' }));
  const dock = screen.getByRole('complementary', { name: 'Bot card' });
  expect((within(dock).getByLabelText('Name') as HTMLInputElement).value).toBe('Bolt');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('complementary', { name: 'Bot card' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Edit Go Reviewer/ }));
  await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Go Reviewer'));
});
it('hides and shows the bench from Library', async () => {
  renderApp(<Crew />);
  const lib = await screen.findByRole('button', { name: /Library/ });
  expect(lib.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(lib);
  expect(screen.queryByLabelText('Find a bot')).toBeNull();
  fireEvent.click(lib);
  expect(screen.getByLabelText('Find a bot')).toBeTruthy();
});
it('keeps Crew packs, Evolve, Import and Remove ECC in one menu', async () => {
  renderApp(<Crew />);
  fireEvent.click(await screen.findByRole('button', { name: 'More crew actions' }));
  expect((screen.getByRole('menuitem', { name: 'Evolve…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('menuitem', { name: 'Import ECC…' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Remove ECC…' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Crew packs…' }));
  expect(await screen.findByRole('dialog', { name: 'Crew packs' })).toBeTruthy();
});
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run web/src/Crew.test.tsx`
- [ ] **Step 3: Implement** the files above; `crew.css` drops `.cw-page`, `.cw-body`, `.cw-main`, `.cw-grid`, `.cw-card*`, `.cw-side-empty` and the phone body rules, adds `.cw-screen`, `.cw-lineup` (`position: absolute; inset: 0; overflow: auto; padding: 72px 24px 24px`; `.lib` → bottom 210 px; `.docked` → right 352 px), `.cw-slots` (`repeat(auto-fill, minmax(190px, 1fr))`, max 960 px), `.cw-slot*`, `.cw-bench`, `.cw-strip`, `.cw-sub` (148 px, `img { -webkit-user-drag: none }`), hover lifts with `transform: none` under reduced motion, and a `.cw-slot-swap` reset.
- [ ] **Step 4: Run** `npx vitest run web/src/Crew.test.tsx web/src/crew web/src/rules.test.ts web/src/leftovers.test.ts web/src/App.test.tsx` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(web): crew lineup of role slots with a library bench, a docked bot card and one actions menu`

---

### Task 6: Drag a bench bot onto a role (with Undo), kind-matched targets, Swap… picker

**Files:**
- Create: `web/src/crew/lineup.ts`, `web/src/crew/lineup.test.ts`, `web/src/crew/SwapPicker.tsx`
- Modify: `web/src/Crew.tsx`, `web/src/crew/Lineup.tsx`, `web/src/crew/crew.css`, `web/src/Crew.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`Slot`, `Bench.onDrag`), `api`, `loadCrewDefs`.
- Produces:
  ```ts
  // crew/lineup.ts
  export const canPlay = (bench: BotDef, slot: BotDef): boolean; // slot.builtin && !bench.builtin && slot.kind !== 'approval' && bench.kind === slot.kind
  export const playAs = (slot: BotDef, bench: BotDef): BotDef;   // { id: slot.id, name: bench.name, title: slot.title, kind: slot.kind, persona: bench.persona, look: bench.look, readOnly? (slot's) }
  // crew/SwapPicker.tsx
  export function SwapPicker(p: { slot?: BotDef; bots: BotDef[]; onPick: (bench: BotDef) => void; onClose: () => void }): JSX.Element;
  ```
- Crew: `dragging?: string` (from `Bench.onDrag`); each slot's `fit` = `none` when not dragging, else `ok`/`no` from `canPlay`. `Slot` accepts `dragover` (preventDefault, `.over`) only when `fit === 'ok'`; `drop` calls `onDrop`. `play(slot, bench)`: when the slot's bot is open with unsaved edits, `guard` first; `PUT /api/crew/<slot.id>` with `playAs(slot, bench)`, then `load()` and `loadCrewDefs(true)`, reopen the slot in the dock if it was open, and show `div.cw-note[role=status]` "`<bench.name> now plays <slot.title>. Applies to the next run.`" with `Undo` for 8 s. Undo: `slot.edited` → `PUT /api/crew/<id>` with the previous def; else `DELETE /api/crew/<id>`; then reload and drop the note. Any failure: `notify.fail`, no note. Agent and model are never touched (that stays `PUT /api/bots/:role` in the card). `SwapPicker` is a kit `Dialog` (`Swap <name>`, description `Bots that can play <title>. Applies to the next run.`) with `SearchField label="Find a stand-in"` and the `canPlay` bots as buttons; picking calls `play`.
- Shortcut comment on the bench card: `shortcut: <button draggable> drags in Chromium (the app and Chrome); Firefox needs a draggable wrapper, add one if Firefox matters`.

- [ ] **Step 1: Write the failing tests**

```ts
// lineup.test.ts
const slot = { id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: 'p', look, builtin: true } as BotDef;
it('matches kinds and keeps Gate and built-ins out', () => {
  expect(canPlay({ ...slot, id: 'quill', builtin: false }, slot)).toBe(true);
  expect(canPlay({ ...slot, id: 'go', kind: 'verdict', builtin: false }, slot)).toBe(false);
  expect(canPlay({ ...slot, id: 'scout', builtin: true }, slot)).toBe(false);
  expect(canPlay({ ...slot, id: 'p', kind: 'approval', builtin: false }, { ...slot, id: 'approval', kind: 'approval' })).toBe(false);
});
it('takes name, persona and look from the bench bot, and keeps the role', () => {
  const quill = { id: 'quill', name: 'Quill', title: 'poet', kind: 'agent', persona: 'Writes poems', look: { ...look, color: '#ff8a5b' } } as BotDef;
  expect(playAs({ ...slot, readOnly: true }, quill)).toEqual({ id: 'coder', name: 'Quill', title: 'coder', kind: 'agent', persona: 'Writes poems', look: quill.look, readOnly: true });
});
```

```tsx
// Crew.test.tsx
it('links a bench bot to a same-kind role by drag and drop; Undo deletes the fresh override', async () => {
  withQuill();
  renderApp(<Crew />);
  fireEvent.dragStart(await screen.findByRole('button', { name: /Edit Quill/ }));
  const slot = screen.getByRole('button', { name: 'Edit Bolt' }).closest('.cw-slot')!;
  fireEvent.dragOver(slot);
  expect(slot.classList.contains('over')).toBe(true);
  await act(async () => fireEvent.drop(slot));
  expect(calls('PUT', '/api/crew/coder')[0]![2]).toEqual({ id: 'coder', name: 'Quill', title: 'coder', kind: 'agent', persona: 'Writes poems', look });
  expect(screen.getByText('Quill now plays coder. Applies to the next run.')).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Undo' })));
  expect(calls('DELETE', '/api/crew/coder')).toHaveLength(1);
});
const dropQuillOnBolt = async () => {
  fireEvent.dragStart(await screen.findByRole('button', { name: /Edit Quill/ }));
  const slot = screen.getByRole('button', { name: 'Edit Bolt' }).closest('.cw-slot')!;
  fireEvent.dragOver(slot);
  await act(async () => fireEvent.drop(slot));
};
it('Undo puts back an earlier override', async () => {
  withQuill({ coderEdited: true }); // Bolt is an edited built-in (edited: true, name 'Bolt')
  renderApp(<Crew />);
  await dropQuillOnBolt();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Undo' })));
  expect(calls('PUT', '/api/crew/coder')[1]![2]).toMatchObject({ id: 'coder', name: 'Bolt' });
  expect(calls('DELETE', '/api/crew/coder')).toHaveLength(0);
});
it('dims other kinds and Gate while dragging and refuses their drop', async () => {
  withQuill({ gate: true }); // adds Go Reviewer (verdict) and the Gate built-in
  renderApp(<Crew />);
  fireEvent.dragStart(await screen.findByRole('button', { name: /Edit Go Reviewer/ }));
  const bolt = screen.getByRole('button', { name: 'Edit Bolt' }).closest('.cw-slot')!;
  expect(bolt.classList.contains('dim')).toBe(true);
  expect(screen.getByRole('button', { name: 'Edit Gate' }).closest('.cw-slot')!.classList.contains('dim')).toBe(true);
  await act(async () => fireEvent.drop(bolt));
  expect(calls('PUT', '/api/crew/coder')).toHaveLength(0);
});
it('Swap… picks a same-kind bot from the keyboard', async () => {
  withQuill({ gate: true });
  renderApp(<Crew />);
  fireEvent.click(await screen.findByRole('button', { name: 'Swap Bolt…' }));
  const dlg = await screen.findByRole('dialog', { name: 'Swap Bolt' });
  expect(within(dlg).queryByText('Go Reviewer')).toBeNull();
  await act(async () => fireEvent.click(within(dlg).getByRole('button', { name: /Quill/ })));
  expect(calls('PUT', '/api/crew/coder')[0]![2]).toMatchObject({ name: 'Quill', kind: 'agent' });
});
it("asks before a drop replaces the open bot's unsaved edits", async () => {
  withQuill();
  renderApp(<Crew />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Bolt' }));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'changed' } });
  await dropQuillOnBolt();
  expect(calls('PUT', '/api/crew/coder')).toHaveLength(0);
  await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Discard' })));
  expect(calls('PUT', '/api/crew/coder')).toHaveLength(1);
});
it('a refused drop shows the error and no note', async () => {
  withQuill({ refuse: new Error('too many bots; remove some first') });
  renderApp(<Crew />);
  await dropQuillOnBolt();
  expect(await screen.findByText('too many bots; remove some first')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
});
```

`withQuill(o?: { coderEdited?: boolean; gate?: boolean; refuse?: Error })` routes `/api/crew` and `/api/bots` with Bolt (built-in), Quill (`id: 'quill'`, your own agent bot, persona `Writes poems`), and on request Go Reviewer and Gate; `PUT /api/crew/coder` answers `{}` or `refuse`; `DELETE /api/crew/coder` answers `{}`.

- [ ] **Step 2: Run and see them fail.** `npx vitest run web/src/crew/lineup.test.ts web/src/Crew.test.tsx`
- [ ] **Step 3: Implement** `lineup.ts`, `SwapPicker.tsx`, the drag wiring in `Lineup.tsx`/`Crew.tsx`, the note (`.cw-note` floats at `top: 70px`, centred, ink on `--ink` bg reversed) and `.cw-slot.ok/.over/.dim` styles (`.over`: dashed `--acc` border, `--accBg` fill; `.dim`: `opacity: .4`).
- [ ] **Step 4: Run** `npx vitest run web/src/crew web/src/Crew.test.tsx web/src/rules.test.ts` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(web): drag a library bot onto a role of its kind to play it, with Undo, and a Swap… picker for the keyboard`

---

## Phase B

### Task 7: API client in the frame

**Files:** Modify `web/src/http/ApiTab.tsx`, `web/src/http/Tree.tsx`, `web/src/http/ResponseView.tsx`, `web/src/http/SendToAgent.tsx`, `web/src/http/api.css`, `web/src/http/ApiTab.test.tsx`, `web/src/http/SendToAgent.test.tsx`.

**Interfaces:**
- `ToolScreen className="api-screen"`. `FloatBar at="left"`: `h1` API client, `MenuButton title="Workspace"` (workspaces with `current`, rule, `Import workspace…`, `Export workspace`), `MenuButton title="Environment"` (environments with `current`, `Edit <env>…`). `FloatBar at="right"`: `Secrets`, `MenuButton title="Import · Export"` (`Import requests…` = today's ImportDialog: cURL/OpenAPI/Postman, `Import workspace…`, `Export workspace`), `+ New request`.
- Left dock `aside.api-dock[aria-label="Requests"]` (236 px, `top: 64px; left: 16px; bottom: 16px`): `Tree` with its filter and `New request` at its foot. `Tree` loses history, environment, import and secrets props (they moved to the bars and the response card).
- Centre `div.api-center` (left 268 px): request card (`RequestEditor`, its tabs Params / Headers / Body / Checks unchanged) and response card (`ResponseView`: status, time, size, view, check pills) with tabs `Response` / `History` (today's history table and latency strip move here, still sortable, a row opens that exchange).
- `Send to agent ▾` on the response card opens `Dock label="Send to agent"` holding `SendToAgent` (crew faces first, `Library…` opens the full bot list it has today, note, Ask Tether, team run, use as gate). The permanent right column goes.
- Empty state: one `QuietLine` plus `Import` and `New request`. Narrow: the left dock becomes a sheet behind a `Requests` button in the left bar.

- [ ] Tests first: retarget ApiTab tests (history through the `History` tab; import/secrets/env through the menus); add `opens Send to agent in the dock from the response card` and `keeps the request tree in a left dock with New request at its foot`. Run `npx vitest run web/src/http` → FAIL, implement, → PASS, `npm run typecheck`.
- [ ] Commit `feat(web): API client in the tool frame: request tree dock, request and response cards, Send to agent in the dock`

### Task 8: Graph in the frame (GraphBoard untouched)

**Files:** Create `web/src/graph/Legend.tsx`. Modify `web/src/Graph.tsx`, `web/src/graph/graph.css`, `web/src/Graph.test.tsx`. **Do not modify** `graph/GraphBoard.tsx`, `GraphBoard.test.tsx`, `camera.ts`, `forceSim.ts`, `useForceLayout.ts`, `useVaultActivity.ts`.

**Interfaces:**
- `ToolScreen className="gv-screen"` with `GraphBoard` filling it (same props and children: hops control and ticker). `FloatBar at="left"`: `h1` Graph and `<N> notes · <M> links` (`· <u> unresolved` when any). `FloatBar at="center"`: the vault `SearchField` (+ `found` count) and `MenuButton title="Note types"` with one item per type (`current` = shown, label `<Type> <count>`; picking toggles) plus a rule and `Reload` (the graph does not poll; it reloads only for unknown notes a run wrote). `FloatBar at="right"`: `Notes <N>` toggle (`aria-pressed`).
- One dock at a time: a selected note → `Dock label="Note"` with `NoteReader`; else Notes on → `Dock label="All notes"` with `NoteList`. Picking a note in the list calls today's `go` (fly-to) and shows its reader. Closing the reader clears the selection and the hash (`onNote(undefined)`).
- `Legend` (`FloatBar at="bottom"`): the four shapes from `GLYPH` with their labels. GraphBoard's own `.gb-tools` and `.gb-hint` restyle in `graph.css` as a floating bottom-left bar (CSS only).
- [ ] Tests first: retarget `Graph.test.tsx` selectors (type pills → the `Note types` menu, reader/list → the docks); add `opens the note list from Notes and a note's reader from a click, one at a time`. `npx vitest run web/src/Graph.test.tsx web/src/graph` → GraphBoard tests pass unchanged. Typecheck.
- [ ] Commit `feat(web): graph fills the frame with search and type menu on top, note reader and list in the dock`

### Task 9: Triggers as cards with a docked editor, a floating delivery log and Setup & test

**Files:** Create `web/src/triggers/TriggerCard.tsx`. Modify `web/src/Triggers.tsx`, `web/src/triggers/TriggerForm.tsx` (Drawer → plain form body), `web/src/triggers/Deliveries.tsx`, `web/src/triggers/triggers.css`, `web/src/Triggers.test.tsx`, `web/src/triggers/TriggerForm.test.tsx`. Delete `triggers/TriggerRow.tsx` and its test (its checks move to `TriggerCard`).

**Interfaces:**
- `TriggerCard(p: { t: Trigger; selected: boolean; onOpen: () => void; onToggle: () => void })`: `div.tg-card` with a `button` (source icon, name, repo/endpoint, a flow line of chips `<event> → runs <workflow> → <then>`, last fired `ago(...)`, status dot) and the on/off `Switch` (today's labels `Pause <id>` / `Enable <id>`).
- `Triggers`: `ToolScreen`; `FloatBar at="left"` `h1` Triggers and `<n> on`; `FloatBar at="right"` `Setup & test` and `+ New trigger`. Cards in `div.tg-cards` (right padding for the dock). Dock: an open trigger or a new one → `Dock label="Trigger"` with `TriggerForm` fields + Save, and for an existing one Test, Log (filters the log) and Delete (ConfirmButton); `Setup & test` → `Dock label="Setup & test"` with `WebhookSetup` (tunnel help inside a `Disclosure`) and `TriggerTest`. `Deliveries` becomes `FloatBar at="bottom"` wide (`.tg-log`), filter as `MenuButton title="Show"` (all triggers / each id), live via the existing 5 s poll. Empty: `QuietLine` with `+ New trigger` and `Setup & test`.
- [ ] Tests first: retarget Triggers tests (`New trigger` → dock, `Test a trigger` → `Setup & test`); add `opens a trigger card in the dock and toggles it from the card`. `npx vitest run web/src/Triggers.test.tsx web/src/triggers` → PASS; typecheck.
- [ ] Commit `feat(web): triggers as cards that open in the dock, a floating delivery log and Setup & test`

### Task 10: Settings as a page (§11, §15.2)

**Files:** Create `web/src/ui/studio/SettingsPage.tsx`, `web/src/ui/studio/settings-page.css`, `web/src/ui/studio/SettingsPage.test.tsx` (from `SettingsDrawer.test.tsx`). Modify `web/src/App.tsx`, `web/src/ui/studio/shell.css` (`.shell-main { position: relative }`), `web/src/App.test.tsx`. Delete `SettingsDrawer.tsx` and its test.

**Interfaces:**
- `SettingsPage(p)`: same props as `SettingsDrawer` minus `open`. Rendered by `App` inside `.shell-main` only while `route.tab === 'settings'`, as `ToolScreen className="st-page"` positioned `absolute; inset: 0; z-index: 25` over the screen, which stays mounted underneath (`screenRef`, `leaves()` unchanged). `FloatBar at="left"`: `h1` Settings, `this Mac`, and `×` (`Close settings`). `nav.st-nav` (floating, left) of section links; the current one is `aria-current="true"` as the page scrolls (IntersectionObserver on the cards; jsdom: set by click). Cards: **Accounts** (`Accounts`; its long text inside `Disclosure label="How connecting works"`), **Agents & tools** (`ToolsStrip`, `McpServers`), **Appearance** (Theme, Notifications), **Storage** (Vault path + Copy, Home path), **Server** (Connection badge; Loopback text inside `Disclosure label="Why loopback only"`), **About**. `section` deep links (`#/settings/accounts`) scroll to `set-<id>`. Esc (not typing, no dialog) or × → `onClose`, focus back to the opener as the drawer did (`returnFocus` fallback kept).
- [ ] Tests first: move every drawer test (theme, vault, connection, tools, notifications, Escape, focus return, fallback) to `SettingsPage.test.tsx`; add `keeps the screen underneath mounted with its unsaved work` in `App.test.tsx` and `highlights the section picked in the nav`. `npx vitest run web/src/ui/studio web/src/App.test.tsx` → PASS; typecheck.
- [ ] Commit `feat(web): settings is a page over the current screen, with a section list and folded help`

### Task 11: Final verification

- [ ] `npx vitest run web/src` → all pass (record totals); `npm run typecheck` clean; `npm run build:web` builds.
- [ ] `git log main..HEAD --format=%B | grep -ci 'co-authored-by\|claude'` prints `0`.
- [ ] Chrome, against a copy: `cp -R ~/.aorch /tmp/aorch-r2 && TETHER_HOME=/tmp/aorch-r2 npm run dev`. Light and dark, desktop and 800 px wide: each screen matches the mockup's layout; Builder (both modes, dock, add menu, "/", run from here, save), Crew (drag to swap + Undo, Swap…, menu actions), API client (send, history, Send to agent), Graph (drag, hover hops, search fly-to, zoom/pan, double-click focus, run pings), Triggers (card, toggle, setup, dry run, log), Settings (page, nav, Esc back with a dirty Builder intact). Note anything unverified in the report.
- [ ] Commit only if a fix was needed: `fix(web): <what>`.
