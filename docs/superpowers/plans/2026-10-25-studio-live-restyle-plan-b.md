# Studio Live Restyle, Plan B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Builder, Graph, Crew (with the Evolve drawer), Triggers and the Team panel on the shared Studio Live parts so they match their approved boards and keep every current function, make the Graph a live, animated board, then delete the `.studio` alias and every leftover per-screen style.

**Architecture:** Each screen gets its own folder or stylesheet (`web/src/builder/`, `web/src/graph/`, `web/src/crew/`, `web/src/triggers/`, `web/src/canvas.css`, `web/src/runs/team.css`) built from Plan A's parts in `web/src/ui/studio/`; its old rules leave `web/src/styles.css` in the same task. The Graph splits into pure modules (graph model, a small hand-written force simulation, camera maths), two hooks (a requestAnimationFrame layout loop that stops when settled, and a poll of a new read-only `GET /api/vault/activity` route) and two components (the SVG board and the reader/list). The last task removes `.studio` everywhere and proves no unused rule is left in `styles.css`.

**Tech Stack:** React 19, TypeScript, Vite, vendored Arc components (Radix + motion), lucide-react, ascii-reveal, blobatar, Node 22 `node:http` + `node:sqlite`, Vitest (projects `node` and `web`, jsdom).

**Spec:** `docs/superpowers/specs/2026-10-25-studio-live-restyle-design.md` — Plan B is §9 phases 5 and 6 (§5 "Builder, Graph, Crew, Triggers, Evolve drawer", plus Team-panel parity and the `.studio` removal from §1 Cascade). The Graph follows the dated **Amendment 2026-10-25** in §5 (Graph bullet), added with this plan. Visual targets: `.mockup/redesign/project/LiveBuilder.dc.html`, `LiveGraph.dc.html`, `LiveCrew.dc.html`, `LiveTriggers.dc.html`, `LiveKit.dc.html`, `LiveRuns.dc.html`.

**Builds on:** Plan A (`docs/superpowers/plans/2026-10-25-studio-live-restyle-plan-a.md`), all 19 tasks done. Plan B uses these Plan A interfaces as they are in `web/src`:
- `web/src/ui/studio/`: `ScreenHeader({ meta?, title, summary?, actions? })` (renders the page `h1`), `SectionHeading({ id?, title, count?, action? })` (an `h2`), `Panel({ title?, count?, action?, className?, children })`, `EmptyState({ title, description, action? })`, `Kbd`, `StatusChip({ tone: 'live'|'needs'|'done'|'failed'|'neutral', label, pulse?, className? })`, `toneFor(status)`, `ListRow({ lead?, title, onOpen?, meta?, extra?, age?, actions?, className? })` inside a `ul.sl-list`, `FaceStack`, `StepTrack`, `InlineError({ message, onRetry })`, `useMediaQuery(query)` with `PHONE = '(max-width: 899px)'` and `BELOW_WIDE = '(max-width: 1199px)'`; shared classes `.sl-meta`, `.sl-note`, `.sl-alert`, `.sl-list`, `.sl-sr`, `.sl-chip`, `.sl-dot`.
- `web/src/components/Loading.tsx`: `Loading({ loading, lines?, rows?, label?, className?, children })` and `useReducedMotionPref()`.
- `web/src/hooks.ts`: `Route { tab; id?; node? }`; `#/crew/<bot>` and `#/graph/<note>` already parse into `route.id`.
- `web/src/test/css.ts`: `cssText(file)`, `cssRule(file, selector, scope?)`, `norm`; `web/src/test/fixtures.ts`: `routeApi`, `calls`, `makeRun`; `web/src/test/render.tsx`: `renderApp`.
- `web/src/rules.test.ts` (no purple, no gradient decoration, no glow, contrast, parity on `styles.css`) keeps running over every new file.
- Root tokens in `web/src/studio.css` (`--bg --s1 --s2 --s3 --line --line2 --edge --ink --mut --acc --accInk --accBg --ok --okBg --warn --warnBg --bad --badBg`, `--font-ui --font-code --ease --t-fast --t-med --t-slow`, `--radius-control/panel/surface`).

Before starting a task, open the files it lists and confirm the names above still match; if Plan A landed a name differently, use Plan A's name everywhere in that task.

## Global Constraints

Copied from the spec; every task's requirements implicitly include these.

- Standing rules: no purple or indigo, no glow or gradient decoration, primary actions are ink, colour carries meaning only (blue live/working, amber needs you, green done/pass, red failed), loading via ascii-reveal.
- Themes follow the OS setting; dark and light are both first-class and polished.
- `--acc` is a fill and stroke colour only; every accent-coloured *text* uses `--accInk` in both themes.
- "No gradient decoration" means no gradient as a visible fill, border or text colour (mask-image dot grids and stripes are allowed, as in Plan A).
- Motion: 150–280 ms with `--ease`. Loops only for live state. The root reduced-motion rule stops every loop and transition; code-driven motion (the Graph layout and camera) checks `prefers-reduced-motion` itself and jumps to rest.
- Type: Geist and Geist Mono app-wide; numbers use tabular figures.
- Every loading state goes through `web/src/components/Loading.tsx`; no spinners-as-placeholders and no grey skeletons. Inline button busy states may keep Arc's button `loading` prop.
- Both themes pass WCAG AA: 4.5:1 for text, 3:1 for UI glyphs and shapes (`--edge` is the 3:1 edge token; `--line2` is a decorative hairline).
- Faces are exempt from the no-purple rule: `Face.tsx`, the face editor swatches/slider and the built-in looks in `src/crew.ts` keep their colours.
- Breakpoints: 1200 px and wider for full layouts; 900–1199 px mid layouts; under 900 px stacked. Layouts reflow at 200% zoom and at 320 CSS px without horizontal scroll.
- Builder, Graph, Crew, Triggers, the Evolve drawer and the Team panel keep every current function listed in spec §5; nothing is removed.
- Every data panel shows its own inline error (`role="alert"`) with a retry, never a silent empty list (the roster preview and the Graph ticker are the exceptions: they hide).
- Server change (Graph signal): read-only, behind the existing loopback, Host and Origin checks, JSON errors like the other routes, Evolve probe runs never appear.
- Non-goals: no new run kinds; no TUI, CLI, engine or run-semantics changes; no component library rewrite.
- Repo rules: no new dependencies. Commits use a conventional prefix, carry no `Co-Authored-By` trailer and never mention Claude or AI. Do not push.
- Verification commands: `npx vitest run --project web <file>`, `npx vitest run --project node <file>`, `npm run typecheck`, `npm run build`. Three pre-existing node failures in the triggers tests (`/private/var` vs `/var`) are ignored; tests flaky under load (engine retryFailed, handoff depth limit, team-final cap, evolve `--json`) pass when run alone.

## Review Focus

The five uncovered inputs most likely to bite a person, each pinned by a test in its owning task:

1. **A deep link to a note that is not in the vault** (`#/graph/<renamed or deleted note>`) must say "That note is not in the vault." in the reader and leave the board usable, not crash or show another note (Task 8, test "says so when the linked note is not in the vault").
2. **Switching to another bot in Crew with unsaved editor edits** (the editor is now a persistent side panel, so a click on another card would silently drop them) must ask first (Task 10, test "asks before switching bots with unsaved edits").
3. **A run writes a note the open Graph does not have yet** must make the note appear (after the vault scan cache expires) instead of pinging nothing (Task 8, test "reloads the graph when a run writes a note it does not have").
4. **Every note type switched off** must show a hint, not an empty dark rectangle, and no layout loop keeps running (Task 7, test "says so when every type is hidden").
5. **A deep link to a bot that does not exist** (`#/crew/ghost`, e.g. an ECC bot removed since the link was made) must say so instead of showing an empty editor (Task 10, test "opens the bot a deep link names and says so when there is none").

## Rulings recorded in this plan

Places where the boards, the spec and the code disagree or are silent; each task follows the ruling below.

- **Boards never drawn (controller ruling).** The spec gates the Evolve drawer and the Team panel on boards that were never drawn. Ruling: the **Evolve drawer follows the approved Crew board** (its entry is the Crew header's Evolve button; the drawer uses the Crew board's surfaces, chips and buttons) and the **Team panel follows the LiveRuns board plus LiveKit parts** (panels, status chips, faces, ink primary, inputs).
- **Standing rules beat decorative colour in boards.** The Builder board tints palette glyph tiles blue/amber/green and the Crew board tints the ECC source chip blue; blue means live, so these are neutral (`--s2`/`--ink`). Kept: amber for fix loops and the gate's left edge (rework that needs attention). The Graph board pulses search matches forever and runs flowing dashes along hovered links; here matches pulse three times and then hold a still ring. **Controller override (2026-10-25):** the owner approved the Graph only after asking for it to be "more interactive, animated, and dynamic", so the links of the *hovered* note DO run the board's flowing dashes while the pointer is over it (interaction feedback that ends when hover ends, not a resting loop); the selected note's links are a still accent line at rest; reduced motion stops the flow. Task 7 implements and tests this (a hovered note's edges carry the flow class; un-hovering removes it). The Triggers board's Deliveries heading has a pulsing dot; here it is not shown (nothing is live). The Builder board animates fix loops always; here they move only while the fix step re-runs. The Arc switch stays ink when on (Plan A's bridge), not the boards' blue track.
- **Graph "used by a run".** Runs do not record which notes they *read* (adding that would change engine behaviour, a non-goal). They do record every note they *write* (`vault.note` events). The smallest honest version: a new read-only `GET /api/vault/activity` route over those events; pings and the ticker say "recorded", the reader says "last written by …". See the spec amendment.
- **Graph scale.** Vaults over 1,500 notes (`LIVE_MAX`) get the layout computed to rest up front, like reduced motion (a live loop over thousands of SVG nodes would stall the page). Repulsion uses a spatial grid with a smooth cut-off, so a tick is roughly linear in notes. The All notes list shows the first 300 by title with a "search to find the rest" line. Only the focused neighbourhood's notes are in the tab order (a 2,000-stop tab order is unusable); the All notes list is the keyboard path to everything, with ↑/↓ between rows.
- **Graph types.** The board drew decision/run/lesson/note; the vault has run, pipeline, role, file, lesson (`lesson`, `lesson-retired`) and other notes. Shapes: run square, pipeline hexagon, role triangle, file filled circle, lesson diamond, other hollow circle.
- **Graph deep links.** Selecting a note updates `#/graph/<path>`; Back to `#/graph` clears the selection. A stale link shows "That note is not in the vault." A Back/Forward move between Crew bots opens the target bot without the unsaved-edits question (the question guards clicks inside the screen; the API tab's route guard is the only hash-level guard, as in Plan A).
- **Graph Connected list** uses the graph's resolved edges (links-to `→`, linked-from `←`); unresolved links cannot be opened, so they are not listed (the old reader offered them and opened nothing).
- **Builder.** The board has no Save button and no name field; both are kept in the header (Save is a function, and the name is edited while a step is selected). The board's "Drag a step from the palette" becomes click-to-add (there is no drag-from-palette today). Below 900 px the Builder is view-and-run only (spec default; the board says nothing). The inspector's "Instructions" label is kept (the board's "Task" would read as the run's task).
- **Crew.** The board's persistent "Edit bot" panel replaces the editor drawer at 900 px and wider (a drawer below 900 px); each card's agent/model controls move into that panel as "Runs on", whose button is "Save agent" (two "Save" buttons in one panel would be ambiguous). "Custom" becomes "Yours" (board copy). "+ New bot" stays the ink primary (the board omits it; it is a current function); Import ECC becomes secondary. The board's header Evolve button opens the Evolve drawer for the selected bot. Switching bots with unsaved edits asks first (new, protective). Card faces keep today's Blobatar hover motion.
- **Triggers.** Board rows replace the trigger table; Test, Log and Delete stay as row actions next to the board's Edit. The trigger form opens in a right drawer (the board does not show it). Deliveries become board rows; the sortable table's column sorting becomes a "Sort by" select over the same sortable keys (when, trigger, outcome) in both directions. "+ New trigger" becomes "New trigger" (board copy).
- **`.studio` removal.** Dialogs that carried `.studio` lose its `--bg` panel fill and show Arc's surface (`--s1`), which is on-rule.

## File Structure

Created:
- `web/src/canvas.css` — the pipeline canvas look (Builder and Runs).
- `web/src/builder/{Palette,Inspector}.tsx`, `web/src/builder/builder.css`.
- `src/vaultActivity.ts`, `test/vault-activity.test.ts`.
- `web/src/graph/{graphModel,forceSim,camera}.ts` + `.test.ts` each; `web/src/graph/{useForceLayout,useVaultActivity}.ts` + `.test.tsx` each; `web/src/graph/{GraphBoard,NoteReader,NoteList}.tsx`, `web/src/graph/GraphBoard.test.tsx`, `web/src/graph/graph.css`.
- `web/src/crew/{types.ts,BotEditor.tsx,RunsOn.tsx,CrewCard.tsx,crew.css}`, `web/src/crew/BotEditor.test.tsx`, `web/src/crew/RunsOn.test.tsx`.
- `web/src/evolve.css`.
- `web/src/triggers/{types.ts,TriggerRow.tsx,TriggerForm.tsx,TriggerTest.tsx,WebhookSetup.tsx,Deliveries.tsx,triggers.css}`, `web/src/triggers/TriggerRow.test.tsx`, `web/src/triggers/TriggerForm.test.tsx`.
- `web/src/runs/team.css`.
- `web/src/leftovers.test.ts`.

Modified:
- `web/src/Canvas.tsx`, `web/src/Canvas.test.tsx`, `web/src/Builder.tsx`, `web/src/Builder.test.tsx`, `web/src/Graph.tsx` (rewrite), `web/src/Graph.test.tsx` (rewrite), `web/src/Crew.tsx` (rewrite), `web/src/Crew.test.tsx`, `web/src/Evolve.tsx`, `web/src/Evolve.test.tsx`, `web/src/Triggers.tsx` (rewrite), `web/src/Triggers.test.tsx`, `web/src/Team.tsx`, `web/src/Team.test.tsx`, `web/src/App.tsx`, `web/src/App.test.tsx`, `web/src/api.ts`, `web/src/styles.css`, `web/src/rules.test.ts` (only if Task 15 deletes a rule it asserts), `web/src/studio.css`, `web/src/studio.test.ts`, `web/src/http/{api.css,ApiTab.tsx,EnvDialog.tsx,WorkspaceDialog.tsx,SecretsDialog.tsx,ImportDialog.tsx}`, `web/src/http/{dialogs.test.tsx,WorkspaceDialog.test.tsx,ResponseView.test.tsx}`.
- `src/types.ts` (`VaultActivityItem`), `src/server.ts` (one GET route).
- `docs/superpowers/specs/2026-10-25-studio-live-restyle-design.md` (Graph amendment, already added with this plan).

Deleted: `web/src/graphLayout.ts`, `web/src/graphLayout.test.ts`.

---

## Phase 5 — Builder and Graph

### Task 1: Canvas restyle (shared by Builder and Runs)

**Files:**
- Create: `web/src/canvas.css`
- Modify: `web/src/Canvas.tsx`
- Modify: `web/src/styles.css` (delete the canvas rules)
- Test: `web/src/Canvas.test.tsx`

**Interfaces:**
- Consumes: `CanvasProps` as Plan A left it (`nodes, edges, selected?, statuses?, issueNodes?, editable?, onSelect?, onMove?, onConnect?, onDeleteEdge?, onDeleteNode?`), `StatusChip`/`toneFor` (already imported by Plan A Task 18), `cssText`, `cssRule`.
- Produces: `CanvasProps.hint?: string` (a bottom-left hint shown while the canvas has steps); zoom buttons named "Zoom in", "Zoom out", "Fit to view"; the fix-loop group gets class `live` only while its check has looped and its fix step is running; `web/src/canvas.css` owns every canvas rule (`.canvas`, `.world`, `.edges`, `.edge*`, `.edge-hit`, `.arrowhead`, `.loop*`, `.node*`, `.meta`, `.flags`, `.cmd`, `.run-line`, `.port*`, `.zoom`, `.canvas-hint`, `.empty-hint`). DOM hooks (`[data-node]`, `[data-id]`, `.node-head`, `.node-body`, `[data-port-in]`, `[data-port-out]`, `[data-edge]`, `path.edge`) are unchanged.

- [ ] **Step 1: Write the failing tests** — in `web/src/Canvas.test.tsx` add `import { cssRule, cssText } from './test/css';` to the imports and append inside `describe('Canvas', …)`:

```tsx
  it('names the zoom buttons', () => {
    const { getByRole } = render(<Canvas nodes={nodes} edges={edges} />);
    for (const name of ['Zoom in', 'Zoom out', 'Fit to view']) expect(getByRole('button', { name })).toBeTruthy();
  });

  it('moves a fix loop only while its fix step re-runs', () => {
    const st = (status: string, loops = 0) => ({ status, attempts: 1, costUsd: 0, loops }) as never;
    const { container, rerender } = render(<Canvas nodes={nodes} edges={edges} />);
    const loop = () => container.querySelector('.loop')!;
    expect(loop().classList.contains('live')).toBe(false);
    rerender(<Canvas nodes={nodes} edges={edges} statuses={{ plan: st('done'), code: st('running'), gate: st('error', 1) }} />);
    expect(loop().classList.contains('live')).toBe(true);
    rerender(<Canvas nodes={nodes} edges={edges} statuses={{ plan: st('done'), code: st('done'), gate: st('done', 1) }} />);
    expect(loop().classList.contains('live')).toBe(false);
  });

  it('shows a hint over a canvas with steps and none over an empty one', () => {
    const { container, rerender } = render(<Canvas editable nodes={nodes} edges={edges} hint="Delete removes" />);
    expect(container.querySelector('.canvas-hint')!.textContent).toBe('Delete removes');
    rerender(<Canvas editable nodes={[]} edges={[]} hint="Delete removes" />);
    expect(container.querySelector('.canvas-hint')).toBeNull();
  });

  it('is styled from tokens in its own stylesheet, and only live parts loop', () => {
    const css = cssText('canvas.css');
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(cssRule('canvas.css', '.edge')).toContain('stroke: var(--edge)');
    expect(cssRule('canvas.css', '.loop path')).toContain('stroke: var(--warn)');
    expect(cssRule('canvas.css', '.loop path')).not.toContain('animation');
    expect(cssRule('canvas.css', '.loop.live path')).toContain('animation');
    expect(cssRule('canvas.css', '.node.selected')).toContain('box-shadow: 0 0 0 3px var(--accBg)');
    expect(cssText('styles.css')).not.toMatch(/\.canvas|\.node-head|\.port\b|\.zoom\b|\.empty-hint/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/Canvas.test.tsx`
Expected: FAIL — no button named "Zoom in" (the buttons only have `title`), no `.loop.live`, no `.canvas-hint`, `canvas.css` missing.

- [ ] **Step 3: Create `web/src/canvas.css`**

```css
/* The pipeline canvas: Builder edits it, Runs shows a run on it. Tokens only; only live parts move. */
.canvas { position: relative; overflow: hidden; outline: none; touch-action: none; user-select: none; cursor: grab; background-color: var(--bg); }
/* The dot grid: a solid --grid fill cut into dots by a mask (no gradient fill). Canvas.tsx moves it with pan and zoom. */
.canvas::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; background: var(--grid);
  -webkit-mask-image: radial-gradient(circle, black 1.2px, transparent 1.4px); mask-image: radial-gradient(circle, black 1.2px, transparent 1.4px);
  -webkit-mask-size: var(--grid-size, 24px) var(--grid-size, 24px); mask-size: var(--grid-size, 24px) var(--grid-size, 24px);
  -webkit-mask-position: var(--grid-x, 0) var(--grid-y, 0); mask-position: var(--grid-x, 0) var(--grid-y, 0);
}
.canvas:active { cursor: grabbing; }
.canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--acc); }
.world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.edges { position: absolute; left: 0; top: 0; pointer-events: none; }
.edge { fill: none; stroke: var(--edge); stroke-width: 2; transition: stroke var(--t-med) var(--ease); }
.edge.sel { stroke: var(--acc); stroke-width: 3; }
.edge.preview { stroke: var(--acc); stroke-dasharray: 4 4; }
.edge.done { stroke: var(--ok); }
.edge.next { stroke-dasharray: 4 4; }
.edge.flow { stroke: var(--acc); stroke-dasharray: 6 6; animation: canvas-flow .8s linear infinite; }
.edge-hit { fill: none; stroke: transparent; stroke-width: 16; pointer-events: stroke; cursor: pointer; }
.arrowhead { fill: var(--edge); }
.loop path { fill: none; stroke: var(--warn); stroke-width: 1.5; stroke-dasharray: 5 6; }
.loop.live path { animation: canvas-loop 1.2s linear infinite; }
.loop text { fill: var(--warn); font-size: 11px; font-family: var(--font-code); paint-order: stroke; stroke: var(--bg); stroke-width: 6px; stroke-linejoin: round; }
@keyframes canvas-flow { to { stroke-dashoffset: -12; } }
@keyframes canvas-loop { to { stroke-dashoffset: -22; } }

/* Step cards: face, title and mono chips on a surface; selection is a 3px tint ring (no blur, so not a glow). */
.node {
  position: absolute; display: flex; flex-direction: column; background: var(--s1); border: 1px solid var(--line2); border-radius: 12px;
  transition: transform var(--t-med) var(--ease), border-color var(--t-med) var(--ease), box-shadow var(--t-med) var(--ease);
}
.node:hover { transform: translateY(-2px); }
.node.selected { border-color: var(--acc); box-shadow: 0 0 0 3px var(--accBg); }
.node.issue { border-color: var(--bad); }
.node.k-gate { border-left: 3px solid var(--warn); }
.node.s-running { border-color: var(--acc); }
.node.s-awaiting { border-color: var(--warn); }
.node.s-error { border-color: var(--bad); }
.node.s-done { border-color: var(--ok); }
.node.s-skipped { opacity: .6; }
.node-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px 4px 8px; cursor: move; min-width: 0; }
.node-head .face { border-radius: 8px; flex: none; }
.node-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: var(--ink); }
.node-body { padding: 0 10px 8px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.node .chip { font-family: var(--font-code); font-size: 10.5px; line-height: 16px; padding: 0 6px; border-radius: 5px; border: 0; background: var(--s2); color: var(--mut); white-space: nowrap; }
.node .chip.agent { color: var(--ink); }
.meta { display: flex; gap: 4px; flex-wrap: wrap; }
.flags { display: flex; gap: 4px; flex-wrap: wrap; }
.flags span { font-family: var(--font-code); font-size: 10.5px; line-height: 16px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--line2); color: var(--mut); }
.cmd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mut); font-family: var(--font-code); font-size: 11px; }
.run-line { display: flex; gap: 8px; align-items: center; color: var(--mut); font-family: var(--font-code); font-size: 11px; }
.port {
  position: absolute; top: 50%; width: 12px; height: 12px; margin-top: -6px; border-radius: 50%; background: var(--s1); border: 2px solid var(--edge);
  transition: background-color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
}
.port.in { left: -7px; }
.port.out { right: -7px; cursor: crosshair; }
.port:hover { border-color: var(--acc); background: var(--acc); }
.zoom { position: absolute; right: 14px; bottom: 14px; display: flex; flex-direction: column; gap: 4px; }
.zoom button {
  display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border-radius: 8px; border: 1px solid var(--edge);
  background: var(--s1); color: var(--ink); cursor: pointer; transition: background-color var(--t-fast) var(--ease);
}
.zoom button:hover { background: var(--s2); }
.canvas-hint { position: absolute; left: 14px; right: 64px; bottom: 14px; font-size: 12px; color: var(--mut); pointer-events: none; }
.empty-hint { position: absolute; inset: 0; display: grid; place-items: center; color: var(--mut); pointer-events: none; }
```

- [ ] **Step 4: Update `web/src/Canvas.tsx`**

Add the imports:

```tsx
import { Maximize2, Minus, Plus } from 'lucide-react';
import './canvas.css';
```

Add `hint?: string;` to `CanvasProps` (after `editable?: boolean;`) with the comment `/** A short how-to line in the bottom-left corner while the canvas has steps. */`.

Replace the fix-loop group opening tag `<g className="loop" key={n.id}>` with:

```tsx
                <g className={cn('loop', { live: loops > 0 && props.statuses?.[n.fixNode!]?.status === 'running' })} key={n.id}>
```

Replace the zoom block and the empty hint at the end of the component with:

```tsx
      <div className="zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.2)}>
          <Plus size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Fit to view" onClick={fit}>
          <Maximize2 size={14} aria-hidden="true" />
        </button>
      </div>
      {props.hint && props.nodes.length ? <div className="canvas-hint">{props.hint}</div> : null}
      {props.nodes.length === 0 ? <div className="empty-hint">Add a step from the palette to start building a pipeline.</div> : null}
```

- [ ] **Step 5: Delete the canvas rules from `web/src/styles.css`**

Delete every rule from `.canvas {` down to and including `.empty-hint { … }` (the block between `.form input, .form select { … }` and `/* ---------- runs ---------- */`): `.canvas`, `.canvas::before`, `.canvas:active`, `.world`, `.edges`, `.edge`, `.edge.sel`, `.edge.preview`, `.edge.flow`, `.edge.done`, `.edge.next` (Plan A Task 18), `.edge-hit`, `.arrowhead`, `.loop path`, `.loop text`, `@keyframes flow`, `.node` and every `.node.*` rule, `.node-head`, `.node-title`, `.node-head .face`, `.node-body`, `.meta`, `.flags`, `.flags span`, `.cmd`, `.run-line`, `.status-pill`, `.port`, `.port.in`, `.port.out`, `.port:hover`, `.zoom`, `.zoom button`, `.empty-hint`. **Keep** `@keyframes pulse` (`.dot.pulse` in the runs section still uses it): move it to just above `.dot.pulse`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --project web web/src/Canvas.test.tsx web/src/Runs.test.tsx web/src/Builder.test.tsx web/src/rules.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/canvas.css web/src/Canvas.tsx web/src/Canvas.test.tsx web/src/styles.css
git commit -m "feat(web): Studio Live canvas with named zoom controls and fix loops that move only while live"
```

---

### Task 2: Builder header, palette and issue list

**Files:**
- Create: `web/src/builder/Palette.tsx`, `web/src/builder/builder.css`
- Modify: `web/src/Builder.tsx`
- Modify: `web/src/styles.css` (delete the builder rules)
- Test: `web/src/Builder.test.tsx`

**Interfaces:**
- Consumes: `ScreenHeader`, `SectionHeading`, `StatusChip`, `Canvas` with `hint` (Task 1).
- Produces:
  - `web/src/builder/Palette.tsx`: `export type EccSkill = { name: string; description: string; source: string; kind?: string }`, `export const PALETTE: { label: string; glyph: string; hint: string; make: () => Partial<PipelineNode> }[]`, `export function Palette(props: { onAdd: (make: () => Partial<PipelineNode>) => void; skills: EccSkill[]; onSkill: (s: EccSkill) => void })` — an `aside` named "Steps palette".
  - Builder page classes `.bl-page`, `.bl-body` (three columns), `.bl-inspector` (the right column, an `aside` named "Step inspector").
  - Header: `h1` = pipeline name; meta `workflows / <name> · <n> steps · <n> fix loops`; the preflight toggle is a button whose name is the chip text (`valid`, `n warnings`, `n errors`); a `Saved` / `Unsaved changes` state line; Save is always labelled "Save".

- [ ] **Step 1: Write the failing tests** — in `web/src/Builder.test.tsx` add `within` to the `@testing-library/react` import and append inside `describe('Builder', …)`:

```tsx
  it('puts the workflow, step and loop counts in the header and adds steps from the palette', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'plan-code-review' })).toBeTruthy();
    expect(screen.getByText('workflows / plan-code-review · 3 steps · 1 fix loop')).toBeTruthy();
    expect(screen.getByText('Saved')).toBeTruthy();
    const palette = screen.getByRole('complementary', { name: 'Steps palette' });
    expect([...palette.querySelectorAll('.bl-item:not(.bl-skill) .bl-item-name')].map((e) => e.textContent)).toEqual(['Planner', 'Architect', 'Coder', 'Reviewer', 'Gate', 'Approval']);
    fireEvent.click(within(palette).getByRole('button', { name: /Approval/ }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByText('workflows / plan-code-review · 4 steps · 1 fix loop')).toBeTruthy();
  });

  it('selects the step an issue names', async () => {
    routeApi({
      'GET /api/doctor': {},
      'GET /api/pipelines': [{ name: 'plan-code-review', nodes: 3 }],
      'GET /api/pipelines/plan-code-review': { pipeline: pcr },
      'POST /api/preflight': { issues: [{ level: 'error', node: 'code', message: 'needs a role' }] },
    });
    renderApp(<Builder onStarted={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '1 error' }));
    expect(screen.getByText('needs a role')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'code' }));
    expect(await screen.findByLabelText('Instructions (blank = default for the role)')).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/Builder.test.tsx`
Expected: FAIL — no level-1 heading, no "Steps palette" region, no issue node button.

- [ ] **Step 3: Create `web/src/builder/Palette.tsx`**

```tsx
import { useState } from 'react';
import type { PipelineNode } from '../../../src/types';
import { SearchField } from '../components/arc/search-field/search-field';
import { SectionHeading } from '../ui/studio/SectionHeading';

export type EccSkill = { name: string; description: string; source: string; kind?: string };

/** The six built-in step kinds. The glyph tile is neutral: colour carries meaning only, and a palette entry has no status. */
export const PALETTE: { label: string; glyph: string; hint: string; make: () => Partial<PipelineNode> }[] = [
  { label: 'Planner', glyph: 'P', hint: 'read-only: plans the change', make: () => ({ kind: 'agent', role: 'planner', readOnly: true }) },
  { label: 'Architect', glyph: 'A', hint: 'read-only: reviews the plan', make: () => ({ kind: 'agent', role: 'architect', readOnly: true }) },
  { label: 'Coder', glyph: 'C', hint: 'edits files; each attempt is committed', make: () => ({ kind: 'agent', role: 'coder' }) },
  { label: 'Reviewer', glyph: 'R', hint: 'sees the diff; ends with VERDICT', make: () => ({ kind: 'agent', role: 'reviewer', readOnly: true, verdict: true, includeDiff: true }) },
  { label: 'Gate', glyph: 'G', hint: 'a command or saved request that must pass', make: () => ({ kind: 'gate', title: 'tests', command: 'npm test', maxLoops: 2 }) },
  { label: 'Approval', glyph: '✓', hint: 'pauses until a person signs off', make: () => ({ kind: 'approval', title: 'approve' }) },
];

/** Steps and ECC skills to add. A click adds the step and chains it onto the last one. */
export function Palette(props: { onAdd: (make: () => Partial<PipelineNode>) => void; skills: EccSkill[]; onSkill: (s: EccSkill) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = props.skills.filter((s) => !needle || `${s.name} ${s.description}`.toLowerCase().includes(needle)).slice(0, 30);
  return (
    <aside className="bl-palette" aria-label="Steps palette">
      <section>
        <SectionHeading title="Steps" />
        {PALETTE.map((p) => (
          <button key={p.label} type="button" className="bl-item" title={p.hint} onClick={() => props.onAdd(p.make)}>
            <span className="bl-glyph" aria-hidden="true">
              {p.glyph}
            </span>
            <span className="bl-item-text">
              <span className="bl-item-name">{p.label}</span>
              <span className="bl-item-hint">{p.hint}</span>
            </span>
          </button>
        ))}
      </section>
      {props.skills.length ? (
        <section>
          <SectionHeading title="Skills" count={props.skills.length} />
          <SearchField label="Find a skill" value={q} onValueChange={setQ} placeholder="ECC skills and commands" />
          {shown.map((s) => (
            <button key={s.name} type="button" className="bl-item bl-skill" title={s.description} onClick={() => props.onSkill(s)}>
              <span className="bl-item-text">
                <span className="bl-item-name">{s.name}</span>
                <span className="bl-item-hint">
                  {s.kind === 'command' ? 'ECC command' : 'ECC skill'} · {s.description}
                </span>
              </span>
            </button>
          ))}
        </section>
      ) : null}
    </aside>
  );
}
```

- [ ] **Step 4: Create `web/src/builder/builder.css`**

```css
/* Builder (Studio Live board): header, palette, canvas, inspector. Tokens only. */
.bl-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.bl-page > .sl-screen-header { border-bottom: 1px solid var(--line); }
.bl-name { width: 200px; font-family: var(--font-code); }
.bl-issues-toggle { padding: 0; border: 0; background: none; border-radius: 6px; cursor: pointer; }
.bl-saved { font-size: 12.5px; color: var(--mut); white-space: nowrap; }
.bl-issues {
  list-style: none; margin: 0; padding: 8px 24px; display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow: auto;
  border-bottom: 1px solid var(--line); background: var(--s1); font-size: 13px;
}
.bl-issues li { display: flex; gap: 8px; align-items: center; min-width: 0; }
.bl-issue-node { padding: 0 6px; border: 1px solid var(--line2); border-radius: 5px; background: var(--s2); color: var(--ink); font-family: var(--font-code); font-size: 11px; cursor: pointer; }
.bl-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr) 320px; }
.bl-body > .canvas { min-height: 420px; }
.bl-palette { border-right: 1px solid var(--line); padding: 16px 12px; display: flex; flex-direction: column; gap: 16px; overflow: auto; }
.bl-palette .sl-section-heading { padding: 0 6px; }
.bl-item {
  width: 100%; display: flex; gap: 10px; align-items: center; padding: 8px 6px; border: 0; border-radius: 9px; background: transparent;
  color: var(--ink); font: inherit; text-align: left; cursor: pointer; transition: background-color var(--t-fast) var(--ease);
}
.bl-item:hover { background: var(--s2); }
.bl-glyph { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--s2); color: var(--ink); font-family: var(--font-code); font-size: 12px; }
.bl-item-text { display: flex; flex-direction: column; min-width: 0; }
.bl-item-name { font-size: 13px; font-weight: 500; }
.bl-item-hint { font-size: 11.5px; color: var(--mut); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bl-inspector { border-left: 1px solid var(--line); background: var(--s1); padding: 18px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
@media (max-width: 1199px) { .bl-body { grid-template-columns: 200px minmax(0, 1fr) 280px; } }
@media (max-width: 899px) {
  .bl-body { grid-template-columns: minmax(0, 1fr); }
  .bl-body > .canvas { min-height: 60vh; }
}
```

- [ ] **Step 5: Rewire `web/src/Builder.tsx`**

Imports: remove `Badge`, `SearchField` and the local `PALETTE` constant and `EccSkill` type; add:

```tsx
import { Play } from 'lucide-react';
import { Palette, type EccSkill } from './builder/Palette';
import { ScreenHeader } from './ui/studio/ScreenHeader';
import { StatusChip } from './ui/studio/StatusChip';
import './builder/builder.css';
```

Delete the `skillQ` state and the `shownSkills` line (the palette owns its search now). Below `const saved = names.some(…)` add:

```tsx
  const loops = pl.nodes.filter((n) => n.fixNode).length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const issueTone = errors.length ? 'failed' : issues.length ? 'needs' : 'done';
  const issueLabel = errors.length ? plural(errors.length, 'error') : issues.length ? plural(issues.length, 'warning') : 'valid';
  const validName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(pl.name);
```

Replace the whole returned tree from `<div className="builder">` down to (and including) the closing `</div>` of `builder-body` with:

```tsx
    <div className="bl-page">
      <ScreenHeader
        meta={`workflows / ${pl.name || 'untitled'} · ${plural(pl.nodes.length, 'step')} · ${plural(loops, 'fix loop')}`}
        title={pl.name || 'untitled'}
        actions={
          <>
            <Select
              label="Workflow"
              options={[{ value: NONE, label: '— unsaved —' }, ...names.map((n) => ({ value: n.name, label: n.name }))]}
              value={saved ? pl.name : NONE}
              onValueChange={(v) => v !== NONE && pick(v)}
            />
            <Input className="bl-name" label="Pipeline name" value={pl.name} spellCheck={false} onChange={(e) => mut((p) => (p.name = e.target.value.trim()))} />
            <button type="button" className="bl-issues-toggle" aria-expanded={showIssues} title="Show or hide the issue list" onClick={() => setShowIssues(!showIssues)}>
              <StatusChip tone={issueTone} label={issueLabel} />
            </button>
            <span className="bl-saved">{dirty ? 'Unsaved changes' : 'Saved'}</span>
            <Button variant="secondary" onClick={fresh}>
              New
            </Button>
            <Button variant="secondary" onClick={save} disabled={!dirty || !validName}>
              Save
            </Button>
            <Button variant="primary" disabled={errors.length > 0 || pl.nodes.length === 0} onClick={() => setRunOpen(true)}>
              Run <Play size={12} aria-hidden="true" />
            </Button>
          </>
        }
      />

      {showIssues && issues.length ? (
        <ul className="bl-issues" aria-label="Preflight issues">
          {issues.map((i, k) => (
            <li key={k}>
              <StatusChip tone={i.level === 'error' ? 'failed' : 'needs'} label={i.level} />
              {i.node ? (
                <button type="button" className="bl-issue-node" onClick={() => setSelected(i.node)}>
                  {i.node}
                </button>
              ) : null}
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="bl-body">
        <Palette onAdd={addNode} skills={skills} onSkill={(s) => void addSkill(s)} />

        <Canvas
          editable
          hint="Click a palette step to add it · drag a right port to a left port to connect · Delete removes"
          nodes={pl.nodes}
          edges={pl.edges}
          selected={selected}
          issueNodes={issueNodes}
          onSelect={setSelected}
          onMove={(id, x, y) => patch(id, { x, y })}
          onConnect={connect}
          onDeleteEdge={(f, t) => mut((p) => (p.edges = p.edges.filter((e) => !(e.from === f && e.to === t))))}
          onDeleteNode={removeNode}
        />

        <aside className="bl-inspector" aria-label="Step inspector">
          {sel ? nodeForm(sel) : settingsForm}
        </aside>
      </div>
```

(The two dialogs after it are unchanged.) Change `async function addSkill(s: { name: string })` to `async function addSkill(s: EccSkill)`.

- [ ] **Step 6: Delete the builder rules from `web/src/styles.css`**

Delete `.builder`, `.toolbar .name`, `.toolbar .search`, `.issues`, `.issues .error b, .issues .warn b` (one line), `.builder-body`, `.palette, .inspector`, `.palette`, `.inspector`, `.palette-item`, `.palette-item small`, and inside `@media (max-width: 1000px)` the `.builder-body`, `.palette` and `.inspector` lines. Keep `.toolbar` (the Graph uses it until Task 8) and the `.form` rules (Task 3).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run --project web web/src/Builder.test.tsx web/src/rules.test.ts && npm run typecheck`
Expected: PASS (the existing "toggles the issue list from the status button" test still finds the button named "1 warning").

- [ ] **Step 8: Commit**

```bash
git add web/src/builder web/src/Builder.tsx web/src/Builder.test.tsx web/src/styles.css
git commit -m "feat(web): Builder header, palette and issue list on Studio parts"
```

---

### Task 3: Builder inspector and phone view

**Files:**
- Create: `web/src/builder/Inspector.tsx`
- Modify: `web/src/Builder.tsx`, `web/src/builder/builder.css`
- Modify: `web/src/styles.css` (delete `.form` rules)
- Test: `web/src/Builder.test.tsx`

**Interfaces:**
- Consumes: `Palette` (Task 2), `Face`, `crewFor`/`useCrew`, Arc `Switch` (`label`, `checked`, `onCheckedChange`), `SectionHeading`, `useMediaQuery`/`PHONE`.
- Produces: `web/src/builder/Inspector.tsx`:
  - `export type Adapters = Record<string, { ok: boolean; version?: string; detail?: string }>`
  - `export function settingsSummary(p: Pipeline): string` → e.g. `mode pipeline · 4 parallel read-only · 30 min timeout · $5 cap`
  - `export function SettingsForm(props: { pl: Pipeline; mut: (fn: (p: Pipeline) => void) => void })` — `h2` "Pipeline settings".
  - `export function StepForm(props: { node: PipelineNode; pl: Pipeline; adapters: Adapters; patch: (id: string, v: Partial<PipelineNode>) => void; onGateKind: (n: PipelineNode, kind: string) => void; onDelete: (id: string) => void; onSettings: () => void })` — `h2` = step title, kind line, four `role="switch"` toggles, a footer button "Pipeline settings: <summary>".
  - Builder below 900 px: no palette, no inspector, no name/New/Save, canvas not editable, a note "Editing needs a wider screen. You can look around and run this workflow."

- [ ] **Step 1: Write the failing tests** — append inside `describe('Builder', …)` in `web/src/Builder.test.tsx` (add `import { PHONE } from './ui/studio/useMediaQuery';` to the imports):

```tsx
  it('edits a step with switches and goes back to the pipeline settings', async () => {
    const { container } = renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(0));
    fireEvent.pointerDown(container.querySelector('[data-id="code"] .node-body')!, { pointerId: 1 });
    expect(screen.getByRole('heading', { level: 2, name: 'coder' })).toBeTruthy();
    expect(screen.getByText('Agent step')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Must end with VERDICT: PASS / FAIL' }));
    await waitFor(() => {
      const body = calls('POST', '/api/preflight').at(-1)?.[2] as typeof pcr;
      expect(body.nodes.find((n) => n.id === 'code')).toMatchObject({ verdict: true });
    });
    fireEvent.click(screen.getByRole('button', { name: /^Pipeline settings: mode pipeline · 4 parallel read-only · 30 min timeout/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Pipeline settings' })).toBeTruthy();
  });

  it('is view-and-run only at phone width', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === PHONE, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    renderApp(<Builder onStarted={() => {}} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'plan-code-review' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Steps palette' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Step inspector' })).toBeNull();
    expect(screen.queryByLabelText('Pipeline name')).toBeNull();
    expect(screen.getByText('Editing needs a wider screen. You can look around and run this workflow.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Run/ })).toBeTruthy();
  });
```

The phone test overrides the first test's assumption that the name field exists; the existing tests run at desktop width (the setup's `matchMedia` never matches).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/Builder.test.tsx`
Expected: FAIL — the step title is an `h4`, there are checkboxes not switches, no summary button, the palette shows at phone width.

- [ ] **Step 3: Create `web/src/builder/Inspector.tsx`**

```tsx
import type { Pipeline, PipelineNode } from '../../../src/types';
import { Button } from '../components/arc/button/button';
import { Input } from '../components/arc/input/input';
import SegmentedControl from '../components/arc/segmented-control/segmented-control';
import { Select } from '../components/arc/select/select';
import { Switch } from '../components/arc/switch/switch';
import { Textarea } from '../components/arc/textarea/textarea';
import { crewFor, useCrew } from '../crewStore';
import { Face } from '../Face';
import { RequestGateFields } from '../RequestGateFields';
import { NONE, fromNone } from '../ui/cn';
import { SectionHeading } from '../ui/studio/SectionHeading';

export type Adapters = Record<string, { ok: boolean; version?: string; detail?: string }>;

const ROLES = ['planner', 'architect', 'coder', 'reviewer', 'tester'];
const KIND_LINE: Record<string, string> = {
  agent: 'Agent step',
  gate: 'Gate · must pass before the next step',
  approval: 'Approval · pauses until a person signs off',
};

export const settingsSummary = (p: Pipeline): string =>
  `mode ${p.mode} · ${p.settings.parallel} parallel read-only · ${Math.round(p.settings.nodeTimeoutMs / 60000)} min timeout${p.settings.maxCostUsd ? ` · $${p.settings.maxCostUsd} cap` : ''}`;

export function SettingsForm({ pl, mut }: { pl: Pipeline; mut: (fn: (p: Pipeline) => void) => void }) {
  return (
    <div className="bl-form">
      <SectionHeading title="Pipeline settings" />
      <Select
        label="Mode"
        options={[
          { value: 'pipeline', label: 'pipeline' },
          { value: 'swarm', label: 'swarm (not built yet)', disabled: true },
          { value: 'orchestration', label: 'orchestration (not built yet)', disabled: true },
        ]}
        value={pl.mode}
        onValueChange={(v) => mut((p) => (p.mode = v as Pipeline['mode']))}
      />
      <Input label="Parallel read-only steps" type="number" min="1" max="16" value={pl.settings.parallel} onChange={(e) => mut((p) => (p.settings.parallel = Number(e.target.value) || 1))} />
      <Input label="Step timeout (minutes)" type="number" min="1" value={Math.round(pl.settings.nodeTimeoutMs / 60000)} onChange={(e) => mut((p) => (p.settings.nodeTimeoutMs = (Number(e.target.value) || 1) * 60000))} />
      <Input
        label="Spend cap (USD, optional)"
        type="number"
        min="0"
        step="0.5"
        value={pl.settings.maxCostUsd ?? ''}
        onChange={(e) => mut((p) => (p.settings.maxCostUsd = e.target.value ? Number(e.target.value) : undefined))}
      />
      <Select
        label="Upstream output"
        options={[
          { value: 'ancestors', label: 'all ancestors' },
          { value: 'direct', label: 'direct parents only' },
        ]}
        value={pl.settings.pipeMode}
        onValueChange={(v) => mut((p) => (p.settings.pipeMode = v as 'ancestors' | 'direct'))}
      />
      <Input label="Setup command (runs once in the worktree)" value={pl.settings.setup ?? ''} placeholder="npm ci" spellCheck={false} onChange={(e) => mut((p) => (p.settings.setup = e.target.value || undefined))} />
      <p className="bl-help">Click a step to edit it. Drag from a right-hand port to a left-hand port to connect. Select an edge or step and press Delete to remove it.</p>
    </div>
  );
}

export function StepForm(props: {
  node: PipelineNode;
  pl: Pipeline;
  adapters: Adapters;
  patch: (id: string, v: Partial<PipelineNode>) => void;
  onGateKind: (n: PipelineNode, kind: string) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
}) {
  const { node: n, pl, adapters, patch } = props;
  const { crew } = useCrew();
  const agentIds = Object.keys(adapters);
  const agentOptions = agentIds.includes(n.agent ?? '') || !n.agent ? agentIds : [...agentIds, n.agent];
  const fixCandidates = pl.nodes.filter((x) => x.kind === 'agent' && x.id !== n.id);
  const flag = (label: string, on: boolean, set: (on: boolean) => void) => (
    <div className="bl-switch">
      <Switch label={label} checked={on} onCheckedChange={set} />
    </div>
  );
  return (
    <div className="bl-form">
      <div className="bl-step-head">
        <Face id={crewFor(n, crew)} size={44} />
        <div>
          <h2 className="bl-step-title">{n.title ?? n.role ?? n.kind}</h2>
          <p className="bl-step-kind">
            <span>{KIND_LINE[n.kind] ?? n.kind}</span> · <code>{n.id}</code>
          </p>
        </div>
      </div>
      <Input label="Label" value={n.title ?? ''} onChange={(e) => patch(n.id, { title: e.target.value })} />
      {n.kind === 'agent' ? (
        <>
          <Input label="Role" list="roles" value={n.role ?? ''} onChange={(e) => patch(n.id, { role: e.target.value })} />
          <datalist id="roles">
            {ROLES.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <div className="bl-pair">
            <Select
              label="Agent"
              options={[
                { value: NONE, label: `follow ${crew[crewFor(n, crew)]?.name ?? 'its bot'} (set in Crew)` },
                ...agentOptions.map((a) => ({ value: a, label: a + (adapters[a] && !adapters[a].ok ? ' (not installed)' : '') })),
              ]}
              value={n.agent ?? NONE}
              onValueChange={(v) => patch(n.id, { agent: fromNone(v) || undefined })}
            />
            <Input label="Model (optional)" value={n.model ?? ''} placeholder="adapter default" spellCheck={false} onChange={(e) => patch(n.id, { model: e.target.value })} />
          </div>
          <Textarea label="Instructions (blank = default for the role)" rows={6} value={n.prompt ?? ''} onChange={(e) => patch(n.id, { prompt: e.target.value })} />
          {flag('Read-only (changes are reverted and fail the step)', !!n.readOnly, (c) => patch(n.id, { readOnly: c || undefined }))}
          {flag('Include the current diff in its prompt', !!n.includeDiff, (c) => patch(n.id, { includeDiff: c || undefined }))}
          {flag('Must end with VERDICT: PASS / FAIL', !!n.verdict, (c) => patch(n.id, { verdict: c || undefined }))}
          {flag('Use knowledge-graph context', n.vault !== false, (c) => patch(n.id, { vault: c ? undefined : false }))}
        </>
      ) : null}
      {n.kind === 'gate' ? (
        <>
          <SegmentedControl
            label="The gate runs"
            options={[
              { value: 'command', label: 'Command' },
              { value: 'request', label: 'Request' },
            ]}
            value={n.http ? 'request' : 'command'}
            onValueChange={(v) => props.onGateKind(n, v)}
          />
          {n.http ? (
            <RequestGateFields key={n.id} http={n.http} onChange={(h) => patch(n.id, { http: h })} />
          ) : (
            <Input label="Command (exit 0 = pass)" value={n.command ?? ''} spellCheck={false} onChange={(e) => patch(n.id, { command: e.target.value })} />
          )}
        </>
      ) : null}
      {n.kind !== 'approval' && (n.kind === 'gate' || n.verdict) ? (
        <>
          <Select
            label="On failure, send the output back to"
            options={[{ value: NONE, label: '— nobody (fail the run) —' }, ...fixCandidates.map((c) => ({ value: c.id, label: `${c.title ?? c.role ?? c.id} (${c.id})` }))]}
            value={n.fixNode ?? NONE}
            onValueChange={(v) => patch(n.id, { fixNode: fromNone(v) })}
          />
          {n.fixNode ? <Input label="Max fix loops" type="number" min="1" max="10" value={n.maxLoops ?? 2} onChange={(e) => patch(n.id, { maxLoops: Number(e.target.value) || 1 })} /> : null}
        </>
      ) : null}
      <Button variant="danger" onClick={() => props.onDelete(n.id)}>
        Delete step
      </Button>
      <button type="button" className="bl-settings-line" onClick={props.onSettings}>
        Pipeline settings: {settingsSummary(pl)}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Use the inspector and the phone layout in `web/src/Builder.tsx`**

Imports: remove `Badge` if still present, `Checkbox` stays (run dialog), remove `crewFor, useCrew`, `RequestGateFields`, `SegmentedControl` only if no longer used in this file (the run dialog still uses `SegmentedControl`; keep it), remove `fromNone` if unused; add:

```tsx
import { SettingsForm, StepForm, type Adapters } from './builder/Inspector';
import { PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
```

Delete the local `ROLES` constant, the local `Adapters` type, `const { crew } = useCrew();`, `agentIds`, `fixCandidates`, `settingsForm` and `nodeForm`. Add after `const notify = useNotify();`:

```tsx
  const phone = useMediaQuery(PHONE);
```

In the header actions, wrap the name field, the saved line, New and Save so they render only when `!phone`:

```tsx
            {phone ? null : <Input className="bl-name" label="Pipeline name" value={pl.name} spellCheck={false} onChange={(e) => mut((p) => (p.name = e.target.value.trim()))} />}
```

```tsx
            {phone ? null : (
              <>
                <span className="bl-saved">{dirty ? 'Unsaved changes' : 'Saved'}</span>
                <Button variant="secondary" onClick={fresh}>
                  New
                </Button>
                <Button variant="secondary" onClick={save} disabled={!dirty || !validName}>
                  Save
                </Button>
              </>
            )}
```

Replace the `bl-body` contents with:

```tsx
      {phone ? <p className="bl-phone-note">Editing needs a wider screen. You can look around and run this workflow.</p> : null}
      <div className="bl-body">
        {phone ? null : <Palette onAdd={addNode} skills={skills} onSkill={(s) => void addSkill(s)} />}

        <Canvas
          editable={!phone}
          hint={phone ? 'Drag to pan · scroll or pinch to zoom' : 'Click a palette step to add it · drag a right port to a left port to connect · Delete removes'}
          nodes={pl.nodes}
          edges={pl.edges}
          selected={selected}
          issueNodes={issueNodes}
          onSelect={setSelected}
          onMove={(id, x, y) => patch(id, { x, y })}
          onConnect={connect}
          onDeleteEdge={(f, t) => mut((p) => (p.edges = p.edges.filter((e) => !(e.from === f && e.to === t))))}
          onDeleteNode={removeNode}
        />

        {phone ? null : (
          <aside className="bl-inspector" aria-label="Step inspector">
            {sel ? (
              <StepForm node={sel} pl={pl} adapters={adapters} patch={patch} onGateKind={setGateKind} onDelete={removeNode} onSettings={() => setSelected(undefined)} />
            ) : (
              <SettingsForm pl={pl} mut={mut} />
            )}
          </aside>
        )}
      </div>
```

In the run dialog change `<form className="form"` to `<form className="bl-form"`.

- [ ] **Step 5: Append the inspector styles to `web/src/builder/builder.css`**

```css
.bl-form { display: flex; flex-direction: column; gap: 12px; }
.bl-step-head { display: flex; align-items: center; gap: 12px; }
.bl-step-head .face { border-radius: 12px; }
.bl-step-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--ink); }
.bl-step-kind { margin: 2px 0 0; font-size: 12px; color: var(--mut); }
.bl-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.bl-switch { display: flex; align-items: center; min-height: 28px; font-size: 13px; }
.bl-help { margin: 0; font-size: 12px; color: var(--mut); }
.bl-settings-line {
  margin-top: auto; padding: 12px 0 0; border: 0; border-top: 1px solid var(--line); background: none; color: var(--mut);
  font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.bl-settings-line:hover { color: var(--ink); }
.bl-phone-note { margin: 0; padding: 8px 16px; font-size: 13px; color: var(--mut); border-bottom: 1px solid var(--line); }
```

- [ ] **Step 6: Delete the `.form` rules from `web/src/styles.css`**

Run: `grep -rn 'className="form"' web/src --include=*.tsx`
Expected: no output. Then delete `.form`, `.form label` and `.form input, .form select` from `web/src/styles.css`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run --project web web/src/Builder.test.tsx web/src/rules.test.ts && npm run typecheck`
Expected: PASS (the gate test still finds the "Command" and "Request" segment buttons, "Repeat" and "Last send" in `RequestGateFields`, and the "follow … (set in Crew)" label).

- [ ] **Step 8: Commit**

```bash
git add web/src/builder web/src/Builder.tsx web/src/Builder.test.tsx web/src/styles.css
git commit -m "feat(web): Builder step inspector with switches and a view-and-run phone layout"
```

---

### Task 4: `GET /api/vault/activity` — notes runs wrote

**Files:**
- Create: `src/vaultActivity.ts`
- Modify: `src/types.ts` (add `VaultActivityItem`), `src/server.ts` (one route), `web/src/api.ts` (re-export the type)
- Test: `test/vault-activity.test.ts`

**Interfaces:**
- Consumes: `Store.feed(o: FeedOptions)` and `Store.runIds({ probes: true })` (`src/store.ts`), `parseCursor`, `cursorOf`, `SETTLE_MS` (`src/activityFeed.ts`), `runTitle` (`src/runLabels.ts`), `HttpError` (`src/serverkit.ts`), `seedRun` (`test/home-helpers.ts`), `startHttpTestServer` (`test/http-helpers.ts`).
- Produces:
  - `src/types.ts`: `export interface VaultActivityItem { id: string; ts: number; runId: string; run: string; path: string }` (`id = "<runId>:<seq>"`, `run` = the run's label).
  - `src/vaultActivity.ts`: `export const VAULT_ACTIVITY_LIMIT = 50`, `export const VAULT_ACTIVITY_MAX = 200`, `export function vaultActivity(store: Store, o: { since?: FeedCursor; limit: number; now?: number }): { items: VaultActivityItem[]; cursor: string | null }` — newest first; with `since`, the `limit` oldest after it (reversed to newest first); probe runs left out; events younger than `SETTLE_MS` held back.
  - `GET /api/vault/activity?since=<cursor>&limit=<n>` → that object; malformed `since` → 400 `{ error }`.
  - `web/src/api.ts` re-exports `VaultActivityItem`.

- [ ] **Step 1: Write the failing test** — create `test/vault-activity.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCursor, SETTLE_MS } from '../src/activityFeed.js';
import { Store } from '../src/store.js';
import { VAULT_ACTIVITY_LIMIT, VAULT_ACTIVITY_MAX, vaultActivity } from '../src/vaultActivity.js';
import { seedRun } from './home-helpers.js';
import { startHttpTestServer } from './http-helpers.js';

/** Run `fn` with the clock (and so every appended event's ts) at `ms`. */
const at = <T>(ms: number, fn: () => T): T => {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(ms);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
};

afterEach(() => vi.restoreAllMocks());

describe('vault activity', () => {
  it('lists the notes runs wrote, newest first, with the run label and no other text', () => {
    const s = Store.open(':memory:');
    at(1_000, () => {
      seedRun(s, 'r1', { name: 'ship', task: 'SENTINEL task text' });
      s.append('r1', { type: 'vault.note', path: 'Runs/2026-10-25 ship r1.md' });
      s.append('r1', { type: 'vault.note', path: 'Roles/coder.md' });
      seedRun(s, 't1', { kind: 'team', task: 'SENTINEL team task' });
      s.append('t1', { type: 'vault.note', path: 'Files/src/a.ts.md' });
    });
    const r = vaultActivity(s, { limit: 10, now: 1_000 + SETTLE_MS });
    expect(r.items.map((i) => i.path)).toEqual(['Files/src/a.ts.md', 'Roles/coder.md', 'Runs/2026-10-25 ship r1.md']);
    expect(r.items[0]).toEqual({ id: 't1:2', ts: 1000, runId: 't1', run: 'Team run', path: 'Files/src/a.ts.md' });
    expect(r.items[1]!.run).toBe('ship');
    expect(JSON.stringify(r)).not.toContain('SENTINEL');
    expect(r.cursor).toBe('1000:t1:2');
  });

  it('pages forward after a cursor, holds back unsettled events and leaves probe runs out', () => {
    const s = Store.open(':memory:');
    at(1_000, () => {
      seedRun(s, 'r1');
      s.append('r1', { type: 'vault.note', path: 'a.md' });
      seedRun(s, 'p1', { probe: true });
      s.append('p1', { type: 'vault.note', path: 'probe.md' });
    });
    const first = vaultActivity(s, { limit: 10, now: 1_000 + SETTLE_MS });
    expect(first.items.map((i) => i.path)).toEqual(['a.md']);
    at(5_000, () => {
      s.append('r1', { type: 'vault.note', path: 'b.md' });
      s.append('r1', { type: 'vault.note', path: 'c.md' });
    });
    const since = parseCursor(first.cursor!)!;
    const early = vaultActivity(s, { since, limit: 10, now: 5_000 + SETTLE_MS - 1 });
    expect(early).toEqual({ items: [], cursor: first.cursor });
    const next = vaultActivity(s, { since, limit: 1, now: 5_000 + SETTLE_MS });
    expect(next.items.map((i) => i.path)).toEqual(['b.md']);
    const rest = vaultActivity(s, { since: parseCursor(next.cursor!)!, limit: 10, now: 5_000 + SETTLE_MS });
    expect(rest.items.map((i) => i.path)).toEqual(['c.md']);
  });

  it('answers an empty log with no items and no cursor', () => {
    expect(vaultActivity(Store.open(':memory:'), { limit: 10 })).toEqual({ items: [], cursor: null });
  });

  it('serves GET /api/vault/activity with a default limit and a cap, and rejects a bad cursor', async () => {
    const srv = await startHttpTestServer();
    try {
      at(1_000, () => {
        seedRun(srv.store, 'r1');
        for (let i = 0; i < 260; i++) srv.store.append('r1', { type: 'vault.note', path: `n${i}.md` });
      });
      const r = await srv.api('GET', '/api/vault/activity');
      expect(r.status).toBe(200);
      expect(r.json.items).toHaveLength(VAULT_ACTIVITY_LIMIT);
      expect(r.json.items[0]).toMatchObject({ runId: 'r1', path: 'n259.md' });
      expect((await srv.api('GET', '/api/vault/activity?limit=999')).json.items).toHaveLength(VAULT_ACTIVITY_MAX);
      expect((await srv.api('GET', '/api/vault/activity?limit=abc')).json.items).toHaveLength(VAULT_ACTIVITY_LIMIT);
      const bad = await srv.api('GET', '/api/vault/activity?since=nope');
      expect(bad.status).toBe(400);
      expect(bad.json.error).toMatch(/cursor/);
    } finally {
      await srv.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project node test/vault-activity.test.ts`
Expected: FAIL — cannot find module `../src/vaultActivity.js`.

- [ ] **Step 3: Add the type** — in `src/types.ts`, directly after the `ActivityLine` interface, add:

```ts
/** A note a run wrote to the vault: the Graph's "used by a run" signal. `run` is the run's label, never task text. */
export interface VaultActivityItem {
  id: string;
  ts: number;
  runId: string;
  run: string;
  path: string;
}
```

- [ ] **Step 4: Create `src/vaultActivity.ts`**

```ts
/**
 * Notes runs wrote to the vault, across runs, for the Graph's live pings. Runs do not record the notes they read, only
 * the ones they write (`vault.note`), so this is the honest "used by a run" signal. Same cursor, settle and probe rules
 * as Home's activity feed.
 */
import { cursorOf, SETTLE_MS } from './activityFeed.js';
import { runTitle } from './runLabels.js';
import type { FeedCursor, Store } from './store.js';
import type { VaultActivityItem } from './types.js';

export const VAULT_ACTIVITY_LIMIT = 50;
export const VAULT_ACTIVITY_MAX = 200;

export function vaultActivity(store: Store, o: { since?: FeedCursor; limit: number; now?: number }): { items: VaultActivityItem[]; cursor: string | null } {
  const until = (o.now ?? Date.now()) - SETTLE_MS;
  const events = store.feed({ types: ['vault.note'], after: o.since, exclude: store.runIds({ probes: true }), until, limit: o.limit });
  const labels = new Map<string, string>();
  const items: VaultActivityItem[] = [];
  for (const e of events) {
    if (e.event.type !== 'vault.note') continue;
    let run = labels.get(e.runId);
    if (run === undefined) {
      const s = store.state(e.runId);
      run = s ? runTitle({ kind: s.kind, pipeline: s.pipeline.name }) : 'run';
      labels.set(e.runId, run);
    }
    items.push({ id: `${e.runId}:${e.seq}`, ts: e.ts, runId: e.runId, run, path: e.event.path });
  }
  // after a cursor the query pages forward (oldest first); the response is always newest first
  const newest = o.since ? events.at(-1) : events[0];
  if (o.since) items.reverse();
  return { items, cursor: newest ? cursorOf(newest) : o.since ? cursorOf(o.since) : null };
}
```

- [ ] **Step 5: Add the route** — in `src/server.ts` add `import { VAULT_ACTIVITY_LIMIT, VAULT_ACTIVITY_MAX, vaultActivity } from './vaultActivity.js';` with the other imports, and in the `// ---- vault ----` section, directly above the `/api/vault/graph` line:

```ts
    if (p === '/api/vault/activity' && m === 'GET') {
      const raw = url.searchParams.get('since');
      const since = raw ? parseCursor(raw) : undefined;
      if (raw && !since) throw new HttpError(400, 'malformed "since" cursor');
      const n = Number(url.searchParams.get('limit') ?? VAULT_ACTIVITY_LIMIT);
      const limit = Number.isInteger(n) && n > 0 ? Math.min(n, VAULT_ACTIVITY_MAX) : VAULT_ACTIVITY_LIMIT;
      return send(res, 200, vaultActivity(store, { since, limit })), true;
    }
```

(`parseCursor` is already imported from `./activityFeed.js` for `/api/activity`; if not, add it to that import.)

- [ ] **Step 6: Re-export the type for the web** — in `web/src/api.ts` change the second line of exports to include `VaultActivityItem`:

```ts
export type { ActivityLine, AttentionAction, AttentionItem, RosterPreview, RunStep, VaultActivityItem } from '../../src/types.js';
```

(Keep whatever other names Plan A put in that list.)

- [ ] **Step 7: Run the tests**

Run: `npx vitest run --project node test/vault-activity.test.ts test/activity-feed.test.ts test/server.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/vaultActivity.ts src/types.ts src/server.ts web/src/api.ts test/vault-activity.test.ts
git commit -m "feat(server): GET /api/vault/activity lists the notes runs wrote"
```

---
### Task 5: Graph model, force simulation and camera (pure modules)

**Files:**
- Create: `web/src/graph/graphModel.ts`, `web/src/graph/forceSim.ts`, `web/src/graph/camera.ts`
- Test: `web/src/graph/graphModel.test.ts`, `web/src/graph/forceSim.test.ts`, `web/src/graph/camera.test.ts`

**Interfaces:**
- Consumes: nothing (pure TypeScript; no React, no DOM).
- Produces:
  - `graphModel.ts`: `type GraphType = 'run' | 'pipeline' | 'role' | 'file' | 'lesson' | 'note'`; `TYPES: GraphType[]`; `TYPE_LABEL: Record<GraphType, string>` (plural words); `typeOf(t?: string): GraphType`; `nodeRadius(degree: number): number`; `shapePath(t: GraphType, r: number): string` (outline centred on 0,0); `GLYPH: Record<GraphType, string>` (12×12 legend glyphs); `adjacency(edges: { from: string; to: string }[]): Map<string, Set<string>>`; `neighbourhood(adj, focus: string | undefined, depth: number): Set<string>`; `matchLocal(nodes: { id: string; title: string; tags: string[] }[], q: string): Set<string>`.
  - `forceSim.ts`: `interface SimNode { id; x; y; vx; vy; fixed: boolean; hidden: boolean }`; `interface Sim { nodes: SimNode[]; index: Map<string, number>; links: [number, number][]; alpha: number; energy: number }`; `REST = 0.02`; `createSim(nodes: { id: string }[], edges: { from: string; to: string }[], prev?: Map<string, { x: number; y: number }>): Sim`; `tick(s: Sim): number` (returns energy); `settle(s: Sim, max?: number): number` (ticks used); `pin(s, id, x, y)`; `release(s, id)`; `reheat(s, alpha)`; `kick(s, seed: number)`; `setHidden(s, ids: ReadonlySet<string>)`; `positions(s): Map<string, { x: number; y: number }>`.
  - `camera.ts`: `interface View { x: number; y: number; k: number }` (screen = world × k + (x, y)); `K_MIN = 0.3`, `K_MAX = 3`; `clampK(k)`; `zoomAt(v, factor, cx, cy): View`; `fitView(points, w, h, pad = 60): View`; `focusView(p, k, w, h): View`; `toWorld(v, sx, sy): { x: number; y: number }`; `ease(t)`; `lerpView(a, b, t): View`.

- [ ] **Step 1: Write the failing tests**

`web/src/graph/graphModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { adjacency, matchLocal, neighbourhood, shapePath, typeOf } from './graphModel';

describe('graph model', () => {
  it('maps vault note types onto six shapes', () => {
    expect(['run', 'pipeline', 'role', 'file', 'lesson', 'lesson-retired', 'harness-adopted', undefined, 'whatever'].map((t) => typeOf(t))).toEqual([
      'run', 'pipeline', 'role', 'file', 'lesson', 'lesson', 'note', 'note', 'note',
    ]);
  });

  it('draws a distinct finite outline for every shaped type', () => {
    const d = (['run', 'pipeline', 'role', 'lesson', 'file'] as const).map((t) => shapePath(t, 8));
    expect(new Set(d).size).toBe(5);
    expect(shapePath('note', 8)).toBe(shapePath('file', 8));
    for (const p of [...d, shapePath('note', 8)]) expect(p).not.toMatch(/NaN|Infinity/);
  });

  it('collects the neighbourhood of a note up to n hops', () => {
    const adj = adjacency([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }]);
    expect([...neighbourhood(adj, 'b', 1)].sort()).toEqual(['a', 'b', 'c']);
    expect([...neighbourhood(adj, 'b', 2)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...neighbourhood(adj, 'a', 3)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(neighbourhood(adj, undefined, 2).size).toBe(0);
  });

  it('matches notes by title, path and tag, with or without #', () => {
    const nodes = [
      { id: 'Roles/coder.md', title: 'Coder', tags: [] },
      { id: 'decisions/loopback.md', title: 'Loopback-only server', tags: ['security'] },
    ];
    expect([...matchLocal(nodes, 'cod')]).toEqual(['Roles/coder.md']);
    expect([...matchLocal(nodes, '#security')]).toEqual(['decisions/loopback.md']);
    expect([...matchLocal(nodes, 'roles/')]).toEqual(['Roles/coder.md']);
    expect(matchLocal(nodes, '  ').size).toBe(0);
  });
});
```

`web/src/graph/forceSim.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSim, kick, pin, positions, release, REST, setHidden, settle, tick } from './forceSim';

const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}` }));
const edges = nodes.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id }));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('force simulation', () => {
  it('starts the same way every time and comes to rest', () => {
    const a = createSim(nodes, edges);
    expect(positions(a)).toEqual(positions(createSim(nodes, edges)));
    const ticks = settle(a);
    expect(ticks).toBeGreaterThan(1);
    expect(ticks).toBeLessThan(1000);
    expect(a.energy).toBeLessThan(REST);
    for (const p of positions(a).values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('keeps linked notes closer than distant ones', () => {
    const s = createSim(nodes, edges);
    settle(s);
    const p = positions(s);
    expect(dist(p.get('n0')!, p.get('n1')!)).toBeLessThan(dist(p.get('n0')!, p.get('n11')!));
  });

  it('holds a pinned note where it is dragged and springs its neighbours after it', () => {
    const s = createSim(nodes, edges);
    settle(s);
    const target = { x: 600, y: 600 };
    const before = dist(positions(s).get('n1')!, target);
    pin(s, 'n0', target.x, target.y);
    for (let i = 0; i < 40; i++) tick(s);
    expect(positions(s).get('n0')).toEqual(target);
    expect(dist(positions(s).get('n1')!, target)).toBeLessThan(before);
    release(s, 'n0');
    settle(s);
    expect(s.energy).toBeLessThan(REST);
  });

  it('leaves hidden notes out of the forces and where they were', () => {
    const s = createSim(nodes, edges);
    settle(s);
    const was = positions(s).get('n5');
    setHidden(s, new Set(['n5']));
    kick(s, 1);
    settle(s);
    expect(positions(s).get('n5')).toEqual(was);
  });

  it('keeps known positions and starts a new note next to a linked one', () => {
    const s = createSim(nodes, edges);
    settle(s);
    const prev = positions(s);
    const t = createSim([...nodes, { id: 'new' }], [...edges, { from: 'n3', to: 'new' }], prev);
    expect(positions(t).get('n3')).toEqual(prev.get('n3'));
    expect(dist(positions(t).get('new')!, prev.get('n3')!)).toBeLessThan(60);
  });

  it('re-runs the layout the same way for the same seed', () => {
    const a = createSim(nodes, edges);
    const b = createSim(nodes, edges);
    settle(a);
    settle(b);
    kick(a, 7);
    kick(b, 7);
    settle(a);
    settle(b);
    expect(positions(a)).toEqual(positions(b));
  });

  it('copes with no notes, self links and links to unknown notes', () => {
    expect(settle(createSim([], []))).toBe(0);
    const s = createSim([{ id: 'a' }], [{ from: 'a', to: 'a' }, { from: 'a', to: 'ghost' }]);
    expect(s.links).toEqual([]);
    settle(s);
    expect(Number.isFinite(positions(s).get('a')!.x)).toBe(true);
  });
});
```

`web/src/graph/camera.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ease, fitView, focusView, K_MAX, K_MIN, lerpView, toWorld, zoomAt } from './camera';

describe('camera', () => {
  it('zooms about a point and clamps the zoom', () => {
    const v = zoomAt({ x: 0, y: 0, k: 1 }, 2, 100, 100);
    expect(v).toEqual({ k: 2, x: -100, y: -100 });
    expect(zoomAt(v, 100, 0, 0).k).toBe(K_MAX);
    expect(zoomAt(v, 0.001, 0, 0).k).toBe(K_MIN);
  });

  it('fits points into a box and centres one note', () => {
    expect(fitView([{ x: -100, y: -50 }, { x: 100, y: 50 }], 800, 600)).toEqual({ k: 1.4, x: 400, y: 300 });
    expect(fitView([], 800, 600)).toEqual({ k: 1, x: 400, y: 300 });
    expect(focusView({ x: 10, y: 20 }, 2, 800, 600)).toEqual({ k: 2, x: 380, y: 260 });
  });

  it('maps the screen to the world and eases between views', () => {
    expect(toWorld({ x: 10, y: 20, k: 2 }, 30, 60)).toEqual({ x: 10, y: 20 });
    const a = { x: 0, y: 0, k: 1 };
    const b = { x: 100, y: -50, k: 2 };
    expect(lerpView(a, b, 0)).toEqual(a);
    expect(lerpView(a, b, 1)).toEqual(b);
    expect([ease(0), ease(1)]).toEqual([0, 1]);
    expect(ease(0.5)).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/graph`
Expected: FAIL — the three modules do not exist.

- [ ] **Step 3: Create `web/src/graph/graphModel.ts`**

```ts
/** What the Graph knows about notes: their type (drawn as a shape, never a hue), neighbourhoods and local search. */
export type GraphType = 'run' | 'pipeline' | 'role' | 'file' | 'lesson' | 'note';
export const TYPES: GraphType[] = ['run', 'pipeline', 'role', 'file', 'lesson', 'note'];
export const TYPE_LABEL: Record<GraphType, string> = { run: 'runs', pipeline: 'pipelines', role: 'roles', file: 'files', lesson: 'lessons', note: 'notes' };

export function typeOf(t?: string): GraphType {
  if (t === 'lesson-retired') return 'lesson';
  return t && (TYPES as string[]).includes(t) ? (t as GraphType) : 'note';
}

/** Busier notes are a little larger, with a ceiling so hubs never swamp the board. */
export const nodeRadius = (degree: number): number => 6 + Math.min(10, Math.sqrt(degree) * 2.2);

const f = (n: number) => Number(n.toFixed(2));
const circle = (r: number) => `M${f(-r)},0a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0`;

/** The note's outline centred on 0,0. */
export function shapePath(t: GraphType, r: number): string {
  switch (t) {
    case 'run':
      return `M${f(-r)},${f(-r)}h${f(2 * r)}v${f(2 * r)}h${f(-2 * r)}z`;
    case 'lesson': {
      const d = r * 1.25;
      return `M0,${f(-d)}L${f(d)},0L0,${f(d)}L${f(-d)},0z`;
    }
    case 'role': {
      const h = r * 1.25;
      return `M0,${f(-h)}L${f(h * 1.05)},${f(h * 0.8)}L${f(-h * 1.05)},${f(h * 0.8)}z`;
    }
    case 'pipeline': {
      const R = r * 1.15;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i;
        return `${f(Math.cos(a) * R)},${f(Math.sin(a) * R)}`;
      });
      return `M${pts.join('L')}z`;
    }
    default:
      return circle(r);
  }
}

/** 12×12 glyphs for the type filters, the reader and the note list. */
export const GLYPH: Record<GraphType, string> = {
  run: 'M2,2h8v8h-8z',
  pipeline: 'M11,6L8.5,10.3L3.5,10.3L1,6L3.5,1.7L8.5,1.7z',
  role: 'M6,1.5L11,10L1,10z',
  file: 'M2,6a4,4 0 1,0 8,0a4,4 0 1,0 -8,0',
  lesson: 'M6,1L11,6L6,11L1,6z',
  note: 'M2,6a4,4 0 1,0 8,0a4,4 0 1,0 -8,0',
};

export function adjacency(edges: { from: string; to: string }[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let s = adj.get(a);
    if (!s) adj.set(a, (s = new Set()));
    s.add(b);
  };
  for (const e of edges) {
    add(e.from, e.to);
    add(e.to, e.from);
  }
  return adj;
}

/** The focus note and everything within `depth` links of it; empty with no focus. */
export function neighbourhood(adj: Map<string, Set<string>>, focus: string | undefined, depth: number): Set<string> {
  const near = new Set<string>();
  if (!focus) return near;
  near.add(focus);
  let frontier = [focus];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const o of adj.get(id) ?? [])
        if (!near.has(o)) {
          near.add(o);
          next.push(o);
        }
    frontier = next;
  }
  return near;
}

/** Notes whose title, path or tags contain the query (a leading # searches tags only). */
export function matchLocal(nodes: { id: string; title: string; tags: string[] }[], q: string): Set<string> {
  const raw = q.trim().toLowerCase();
  const hits = new Set<string>();
  if (!raw) return hits;
  const tagOnly = raw.startsWith('#');
  const needle = tagOnly ? raw.slice(1) : raw;
  if (!needle) return hits;
  for (const n of nodes) {
    const tag = n.tags.some((t) => t.toLowerCase().includes(needle));
    if (tag || (!tagOnly && (n.title.toLowerCase().includes(needle) || n.id.toLowerCase().includes(needle)))) hits.add(n.id);
  }
  return hits;
}
```

- [ ] **Step 4: Create `web/src/graph/forceSim.ts`**

```ts
/**
 * A small hand-written force layout for the vault graph. Links pull like springs, notes push apart within a cut-off
 * (a spatial grid keeps a tick roughly linear in notes), a weak pull holds everything near the centre. Every force is
 * scaled by `alpha`, which cools a little each tick, so the layout always comes to rest; a drag, a filter change or
 * Re-run heats it again. Deterministic: the same notes start in the same places and the same seed kicks the same way.
 */
export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
  hidden: boolean;
}
export interface Sim {
  nodes: SimNode[];
  index: Map<string, number>;
  links: [number, number][];
  alpha: number;
  /** Average speed of the moving notes after the last tick. */
  energy: number;
}

/** Average speed (world units per tick) below which the layout counts as settled. */
export const REST = 0.02;
const LINK = 120;
const SPRING = 0.012;
const REPEL = 5200;
const CUTOFF = 320;
const FADE_FROM = CUTOFF * 0.75;
const GRAVITY = 0.0025;
const KEEP = 0.82;
const COOL = 0.98;

export function createSim(nodes: { id: string }[], edges: { from: string; to: string }[], prev?: Map<string, { x: number; y: number }>): Sim {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links: [number, number][] = [];
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }
  // a sunflower spiral: even density from the first tick, the same every time
  const sim: SimNode[] = nodes.map((n, i) => {
    const p = prev?.get(n.id);
    const r = 28 * Math.sqrt(i + 0.5);
    const a = i * 2.399963;
    return { id: n.id, x: p ? p.x : Math.cos(a) * r, y: p ? p.y : Math.sin(a) * r, vx: 0, vy: 0, fixed: false, hidden: false };
  });
  if (prev?.size) {
    // a note that is new to a known graph starts beside a note it links to, so it springs in from there
    nodes.forEach((n, i) => {
      if (prev.has(n.id)) return;
      const link = links.find(([a, b]) => (a === i && prev.has(nodes[b]!.id)) || (b === i && prev.has(nodes[a]!.id)));
      if (!link) return;
      const o = sim[link[0] === i ? link[1] : link[0]]!;
      sim[i]!.x = o.x + Math.cos(i * 2.4) * 30;
      sim[i]!.y = o.y + Math.sin(i * 2.4) * 30;
    });
  }
  return { nodes: sim, index, links, alpha: prev?.size ? 0.3 : 1, energy: 1 };
}

export function tick(s: Sim): number {
  const ns = s.nodes;
  const a = s.alpha;
  const grid = new Map<string, number[]>();
  ns.forEach((n, i) => {
    if (n.hidden) return;
    const k = `${Math.floor(n.x / CUTOFF)},${Math.floor(n.y / CUTOFF)}`;
    let cell = grid.get(k);
    if (!cell) grid.set(k, (cell = []));
    cell.push(i);
  });
  for (let i = 0; i < ns.length; i++) {
    const p = ns[i]!;
    if (p.hidden) continue;
    const cx = Math.floor(p.x / CUTOFF);
    const cy = Math.floor(p.y / CUTOFF);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gy = cy - 1; gy <= cy + 1; gy++)
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (j <= i) continue;
          const q = ns[j]!;
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > CUTOFF * CUTOFF) continue;
          if (d2 < 0.01) {
            dx = (((i * 7 + j * 3) % 5) - 2) * 0.1 || 0.1;
            dy = 0.1;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          // full strength up to 3/4 of the cut-off, then a smooth fade to zero (no jump to oscillate on)
          const fade = d <= FADE_FROM ? 1 : (1 - (d - FADE_FROM) / (CUTOFF - FADE_FROM)) ** 2;
          const force = ((REPEL / Math.max(d2, 400)) * fade * a) / d;
          p.vx -= dx * force;
          p.vy -= dy * force;
          q.vx += dx * force;
          q.vy += dy * force;
        }
  }
  for (const [i, j] of s.links) {
    const p = ns[i]!;
    const q = ns[j]!;
    if (p.hidden || q.hidden) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = ((d - LINK) * SPRING * a) / d;
    p.vx += dx * force;
    p.vy += dy * force;
    q.vx -= dx * force;
    q.vy -= dy * force;
  }
  let speed = 0;
  let moving = 0;
  for (const n of ns) {
    if (n.hidden || n.fixed) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx = (n.vx - n.x * GRAVITY * a) * KEEP;
    n.vy = (n.vy - n.y * GRAVITY * a) * KEEP;
    n.x += n.vx;
    n.y += n.vy;
    speed += (Math.abs(n.vx) + Math.abs(n.vy)) / 2;
    moving++;
  }
  s.alpha *= COOL;
  s.energy = moving ? speed / moving : 0;
  return s.energy;
}

/** Tick until the layout is at rest (or `max` ticks); big vaults get fewer ticks so the page never stalls. */
export function settle(s: Sim, max?: number): number {
  if (!s.nodes.length) return 0;
  const cap = max ?? (s.nodes.length > 5000 ? 150 : s.nodes.length > 1500 ? 300 : 1000);
  for (let i = 0; i < cap; i++) if (tick(s) < REST) return i + 1;
  return cap;
}

export function reheat(s: Sim, alpha: number): void {
  s.alpha = Math.max(s.alpha, alpha);
}

export function pin(s: Sim, id: string, x: number, y: number): void {
  const n = s.nodes[s.index.get(id) ?? -1];
  if (!n) return;
  Object.assign(n, { x, y, vx: 0, vy: 0, fixed: true });
  reheat(s, 0.3);
}

export function release(s: Sim, id: string): void {
  const n = s.nodes[s.index.get(id) ?? -1];
  if (!n) return;
  n.fixed = false;
  reheat(s, 0.3);
}

/** Re-run the layout: shake every visible note (the same way for the same seed) and heat fully. */
export function kick(s: Sim, seed: number): void {
  let t = seed >>> 0;
  const rnd = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  for (const n of s.nodes) {
    if (n.hidden || n.fixed) continue;
    n.vx += (rnd() - 0.5) * 30;
    n.vy += (rnd() - 0.5) * 30;
  }
  s.alpha = 1;
}

export function setHidden(s: Sim, ids: ReadonlySet<string>): void {
  for (const n of s.nodes) n.hidden = ids.has(n.id);
}

export function positions(s: Sim): Map<string, { x: number; y: number }> {
  return new Map(s.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}
```

If "starts the same way every time and comes to rest" fails on the tick bound, do not loosen the test: check that every force is multiplied by `a` and that `alpha` cools each tick (`COOL` below 1); those two guarantee rest.

- [ ] **Step 5: Create `web/src/graph/camera.ts`**

```ts
/** Pan and zoom for the Graph: screen = world × k + (x, y), in the board's CSS pixels. */
export interface View {
  x: number;
  y: number;
  k: number;
}
export const K_MIN = 0.3;
export const K_MAX = 3;
export const clampK = (k: number) => Math.min(K_MAX, Math.max(K_MIN, k));

/** Zoom by `factor`, keeping the screen point (cx, cy) over the same world point. */
export function zoomAt(v: View, factor: number, cx: number, cy: number): View {
  const k = clampK(v.k * factor);
  return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
}

/** The view that shows every point with `pad` pixels to spare, never zoomed in past 1.4. */
export function fitView(points: { x: number; y: number }[], w: number, h: number, pad = 60): View {
  if (!points.length) return { x: w / 2, y: h / 2, k: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const k = clampK(Math.min((w - 2 * pad) / Math.max(maxX - minX, 1), (h - 2 * pad) / Math.max(maxY - minY, 1), 1.4));
  return { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k };
}

/** The view that puts world point `p` in the middle of the board at zoom `k`. */
export function focusView(p: { x: number; y: number }, k: number, w: number, h: number): View {
  const kk = clampK(k);
  return { k: kk, x: w / 2 - p.x * kk, y: h / 2 - p.y * kk };
}

export const toWorld = (v: View, sx: number, sy: number) => ({ x: (sx - v.x) / v.k, y: (sy - v.y) / v.k });

/** Ease-out cubic: the glide starts quick and lands softly (pairs with --ease). */
export const ease = (t: number) => 1 - (1 - t) ** 3;

export const lerpView = (a: View, b: View, t: number): View => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, k: a.k + (b.k - a.k) * t });
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --project web web/src/graph && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/graph
git commit -m "feat(web): graph model, a small force simulation and camera maths for the live Graph"
```

---

### Task 6: Layout loop and vault activity hooks

**Files:**
- Create: `web/src/graph/useForceLayout.ts`, `web/src/graph/useVaultActivity.ts`
- Test: `web/src/graph/useForceLayout.test.tsx`, `web/src/graph/useVaultActivity.test.tsx`

**Interfaces:**
- Consumes: `forceSim.ts` (Task 5), `api` and `VaultActivityItem` (`web/src/api.ts`, Task 4), `GET /api/vault/activity` (Task 4).
- Produces:
  - `useForceLayout.ts`: `LIVE_MAX = 1500`; `interface ForceLayout { version: number; running: boolean; position(id: string): { x: number; y: number } | undefined; points(): { x: number; y: number }[]; drag(id: string, x: number, y: number): void; release(id: string): void; rerun(): void }`; `useForceLayout(graph: { nodes: { id: string }[]; edges: { from: string; to: string }[] } | undefined, hidden: ReadonlySet<string>, o: { reduced: boolean; paint?: (s: Sim) => void; onSettled?: () => void; raf?: (cb: FrameRequestCallback) => number; caf?: (h: number) => void; liveMax?: number }): ForceLayout`. One requestAnimationFrame loop while the layout moves; it stops at rest. `paint` is called once when the simulation is built and after every tick (the board writes positions straight to the SVG, so React does not re-render per frame). Under `reduced`, or with more than `liveMax` notes, the layout is computed to rest up front and no frame is ever requested. `version` bumps when the simulation is rebuilt (a new graph object). `points()` lists visible notes. `hidden` must be a stable set (memoised by the caller).
  - `useVaultActivity.ts`: `VAULT_POLL_MS = 5000`, `PING_MS = 12_000`; `interface VaultActivity { last: ReadonlyMap<string, VaultActivityItem>; fresh: ReadonlySet<string>; latest?: VaultActivityItem }`; `useVaultActivity(): VaultActivity`. The first successful call (`GET /api/vault/activity?limit=100`) fills `last` (history, no pings); later polls pass `since=<cursor>` every 5 s while the tab is visible; their items join `fresh` for 12 s and the newest becomes `latest`. Errors are swallowed (the ticker hides) and polling continues.

- [ ] **Step 1: Write the failing tests**

`web/src/graph/useForceLayout.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForceLayout } from './useForceLayout';

const graph = { nodes: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}` })), edges: Array.from({ length: 7 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })) };
const NONE: ReadonlySet<string> = new Set();

/** A hand-cranked requestAnimationFrame. */
function frames() {
  const q = new Map<number, FrameRequestCallback>();
  let id = 0;
  return {
    raf: (cb: FrameRequestCallback) => (q.set(++id, cb), id),
    caf: (h: number) => void q.delete(h),
    /** Run queued frames (and the frames they queue) until none is left or `max` ran; returns how many ran. */
    flush(max = 5000) {
      let n = 0;
      while (q.size && n < max) {
        const [k, cb] = q.entries().next().value as [number, FrameRequestCallback];
        q.delete(k);
        cb(n * 16);
        n++;
      }
      return n;
    },
    get size() {
      return q.size;
    },
  };
}

describe('useForceLayout', () => {
  it('settles at once under reduced motion and never asks for a frame', () => {
    const f = frames();
    const paint = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useForceLayout(graph, NONE, { reduced: true, paint, onSettled, raf: f.raf, caf: f.caf }));
    expect(f.size).toBe(0);
    expect(result.current.version).toBe(1);
    expect(result.current.running).toBe(false);
    expect(paint).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.points()).toHaveLength(8);
  });

  it('runs one frame loop that stops when the layout comes to rest', () => {
    const f = frames();
    const paint = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useForceLayout(graph, NONE, { reduced: false, paint, onSettled, raf: f.raf, caf: f.caf }));
    expect(result.current.running).toBe(true);
    expect(f.size).toBe(1);
    let ran = 0;
    act(() => void (ran = f.flush()));
    expect(ran).toBeGreaterThan(1);
    expect(ran).toBeLessThan(1000);
    expect(f.size).toBe(0);
    expect(result.current.running).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(paint).toHaveBeenCalledTimes(ran + 1);
  });

  it('holds a dragged note, keeps the loop awake until it is let go, then settles', () => {
    const f = frames();
    const { result } = renderHook(() => useForceLayout(graph, NONE, { reduced: false, raf: f.raf, caf: f.caf }));
    act(() => void f.flush());
    act(() => result.current.drag('n0', 500, 500));
    expect(f.size).toBe(1);
    act(() => void f.flush(60));
    expect(f.size).toBe(1);
    expect(result.current.position('n0')).toEqual({ x: 500, y: 500 });
    act(() => result.current.release('n0'));
    act(() => void f.flush());
    expect(f.size).toBe(0);
    expect(result.current.running).toBe(false);
  });

  it('treats a graph over the live limit like reduced motion', () => {
    const f = frames();
    const { result } = renderHook(() => useForceLayout(graph, NONE, { reduced: false, liveMax: 5, raf: f.raf, caf: f.caf }));
    expect(f.size).toBe(0);
    expect(result.current.running).toBe(false);
  });

  it('re-settles when notes are hidden and re-runs on request', () => {
    const f = frames();
    const paint = vi.fn();
    const { result, rerender } = renderHook(({ hidden }) => useForceLayout(graph, hidden, { reduced: true, paint, raf: f.raf, caf: f.caf }), { initialProps: { hidden: NONE } });
    const before = result.current.position('n3');
    rerender({ hidden: new Set(['n0', 'n1']) });
    expect(paint).toHaveBeenCalledTimes(2);
    expect(result.current.points()).toHaveLength(6);
    act(() => result.current.rerun());
    expect(paint).toHaveBeenCalledTimes(3);
    expect(result.current.position('n3')).not.toEqual(before);
    expect(f.size).toBe(0);
  });

  it('cancels its frame when unmounted', () => {
    const f = frames();
    const { unmount } = renderHook(() => useForceLayout(graph, NONE, { reduced: false, raf: f.raf, caf: f.caf }));
    expect(f.size).toBe(1);
    unmount();
    expect(f.size).toBe(0);
  });
});
```

`web/src/graph/useVaultActivity.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { PING_MS, useVaultActivity, VAULT_POLL_MS } from './useVaultActivity';

const item = (path: string, ts: number, seq: number) => ({ id: `r1:${seq}`, ts, runId: 'r1', run: 'ship', path });
const history = { items: [item('old.md', 1, 2)], cursor: '1:r1:2' };
const setHidden = (hidden: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

beforeEach(() => {
  vi.mocked(api).mockReset();
  setHidden(false);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

describe('useVaultActivity', () => {
  it('remembers past writes without pinging them, then pings new ones for a while', async () => {
    routeApi({
      'GET /api/vault/activity': (_b: unknown, p: string) =>
        p.includes('since=1%3Ar1%3A2') ? { items: [item('new.md', 9, 3)], cursor: '9:r1:3' } : p.includes('since=') ? { items: [], cursor: '9:r1:3' } : history,
    });
    const { result } = renderHook(() => useVaultActivity());
    await act(async () => {});
    expect(calls('GET', '/api/vault/activity?limit=100')).toHaveLength(1);
    expect(result.current.last.get('old.md')?.run).toBe('ship');
    expect(result.current.fresh.size).toBe(0);
    expect(result.current.latest).toBeUndefined();
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(result.current.fresh.has('new.md')).toBe(true);
    expect(result.current.latest?.path).toBe('new.md');
    expect(result.current.last.get('new.md')?.ts).toBe(9);
    await act(() => vi.advanceTimersByTimeAsync(PING_MS));
    expect(result.current.fresh.has('new.md')).toBe(false);
    expect(result.current.latest?.path).toBe('new.md');
  });

  it('pings the first writes of a vault that had none', async () => {
    let first = true;
    routeApi({
      'GET /api/vault/activity': () => {
        if (!first) return { items: [item('a.md', 5, 2)], cursor: '5:r1:2' };
        first = false;
        return { items: [], cursor: null };
      },
    });
    const { result } = renderHook(() => useVaultActivity());
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(result.current.fresh.has('a.md')).toBe(true);
  });

  it('keeps polling quietly after an error', async () => {
    let fail = true;
    routeApi({
      'GET /api/vault/activity': () => {
        if (!fail) return history;
        fail = false;
        return new Error('down');
      },
    });
    const { result } = renderHook(() => useVaultActivity());
    await act(async () => {});
    expect(result.current.last.size).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(result.current.last.has('old.md')).toBe(true);
  });

  it('does not poll while the tab is hidden', async () => {
    setHidden(true);
    routeApi({ 'GET /api/vault/activity': history });
    renderHook(() => useVaultActivity());
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS * 2));
    expect(vi.mocked(api)).not.toHaveBeenCalled();
    setHidden(false);
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/graph/useForceLayout.test.tsx web/src/graph/useVaultActivity.test.tsx`
Expected: FAIL — the hooks do not exist.

- [ ] **Step 3: Create `web/src/graph/useForceLayout.ts`**

```ts
import { useEffect, useRef, useState } from 'react';
import { createSim, kick, pin, positions, reheat, release as unpin, REST, setHidden, settle, tick, type Sim } from './forceSim';

/** Above this many notes the layout is computed to rest up front, as under reduced motion. */
export const LIVE_MAX = 1500;

export interface ForceLayout {
  /** Bumps when the simulation is rebuilt for a new graph; React renders positions from `position`. */
  version: number;
  running: boolean;
  position: (id: string) => { x: number; y: number } | undefined;
  /** Positions of the visible notes. */
  points: () => { x: number; y: number }[];
  drag: (id: string, x: number, y: number) => void;
  release: (id: string) => void;
  rerun: () => void;
}

type GraphLike = { nodes: { id: string }[]; edges: { from: string; to: string }[] };
type Options = { reduced: boolean; paint?: (s: Sim) => void; onSettled?: () => void; raf?: (cb: FrameRequestCallback) => number; caf?: (h: number) => void; liveMax?: number };
const keyOf = (s: ReadonlySet<string>) => [...s].sort().join('\n');

/**
 * Runs the force layout: one requestAnimationFrame loop while notes move, stopped at rest. `paint` gets every tick so
 * the board can move SVG nodes without a React render per frame.
 */
export function useForceLayout(graph: GraphLike | undefined, hidden: ReadonlySet<string>, o: Options): ForceLayout {
  const sim = useRef<Sim | undefined>(undefined);
  const frame = useRef<number | null>(null);
  const seed = useRef(1);
  const applied = useRef('');
  const opts = useRef(o);
  opts.current = o;
  const instantRef = useRef(false);
  instantRef.current = o.reduced || (graph?.nodes.length ?? 0) > (o.liveMax ?? LIVE_MAX);
  const [version, setVersion] = useState(0);
  const [running, setRunning] = useState(false);

  const raf = (cb: FrameRequestCallback) => (opts.current.raf ?? requestAnimationFrame)(cb);
  const caf = (h: number) => (opts.current.caf ?? cancelAnimationFrame)(h);
  const stop = () => {
    if (frame.current !== null) caf(frame.current);
    frame.current = null;
  };
  const step = () => {
    frame.current = null;
    const s = sim.current;
    if (!s) return;
    tick(s);
    opts.current.paint?.(s);
    if (s.energy < REST && !s.nodes.some((n) => n.fixed)) {
      setRunning(false);
      opts.current.onSettled?.();
      return;
    }
    frame.current = raf(step);
  };
  const wake = () => {
    const s = sim.current;
    if (!s) return;
    if (instantRef.current) {
      if (!s.nodes.some((n) => n.fixed)) settle(s);
      opts.current.paint?.(s);
      return;
    }
    if (frame.current === null) {
      setRunning(true);
      frame.current = raf(step);
    }
  };

  useEffect(() => {
    if (!graph) return;
    stop();
    const s = createSim(graph.nodes, graph.edges, sim.current ? positions(sim.current) : undefined);
    setHidden(s, hidden);
    applied.current = keyOf(hidden);
    sim.current = s;
    setVersion((v) => v + 1);
    if (instantRef.current) {
      settle(s);
      opts.current.paint?.(s);
      setRunning(false);
      opts.current.onSettled?.();
    } else {
      opts.current.paint?.(s);
      wake();
    }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const s = sim.current;
    const k = keyOf(hidden);
    if (!s || k === applied.current) return;
    applied.current = k;
    setHidden(s, hidden);
    reheat(s, 0.5);
    wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  return {
    version,
    running,
    position: (id) => {
      const s = sim.current;
      const n = s?.nodes[s.index.get(id) ?? -1];
      return n ? { x: n.x, y: n.y } : undefined;
    },
    points: () => (sim.current?.nodes ?? []).filter((n) => !n.hidden).map((n) => ({ x: n.x, y: n.y })),
    drag: (id, x, y) => {
      const s = sim.current;
      if (!s) return;
      pin(s, id, x, y);
      if (instantRef.current) opts.current.paint?.(s);
      else wake();
    },
    release: (id) => {
      const s = sim.current;
      if (!s) return;
      unpin(s, id);
      wake();
    },
    rerun: () => {
      const s = sim.current;
      if (!s) return;
      kick(s, ++seed.current);
      wake();
    },
  };
}
```

- [ ] **Step 4: Create `web/src/graph/useVaultActivity.ts`**

```ts
import { useEffect, useState } from 'react';
import { api, type VaultActivityItem } from '../api';

export const VAULT_POLL_MS = 5000;
/** How long a note a run just wrote keeps pinging (its "live" window). */
export const PING_MS = 12_000;

export interface VaultActivity {
  /** The newest write per note path that this screen knows of. */
  last: ReadonlyMap<string, VaultActivityItem>;
  /** Paths written since the screen opened, for PING_MS each. */
  fresh: ReadonlySet<string>;
  /** The newest write since the screen opened. */
  latest?: VaultActivityItem;
}

type Reply = { items: VaultActivityItem[]; cursor: string | null };

/** Notes runs wrote, polled from GET /api/vault/activity. A decorative signal: errors hide it quietly. */
export function useVaultActivity(): VaultActivity {
  const [last, setLast] = useState<ReadonlyMap<string, VaultActivityItem>>(new Map());
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [latest, setLatest] = useState<VaultActivityItem>();

  useEffect(() => {
    let stopped = false;
    let primed = false;
    let cursor: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiries: ReturnType<typeof setTimeout>[] = [];

    const record = (items: VaultActivityItem[], isNew: boolean) => {
      if (!items.length) return;
      // items come newest first: apply oldest to newest so the newest write wins
      setLast((cur) => {
        const next = new Map(cur);
        for (const it of [...items].reverse()) next.set(it.path, it);
        return next;
      });
      if (!isNew) return;
      setLatest(items[0]);
      const paths = items.map((i) => i.path);
      setFresh((cur) => new Set([...cur, ...paths]));
      expiries.push(
        setTimeout(() => {
          setFresh((cur) => {
            const next = new Set(cur);
            for (const p of paths) next.delete(p);
            return next;
          });
        }, PING_MS),
      );
    };

    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const r = await api<Reply>('GET', cursor ? `/api/vault/activity?since=${encodeURIComponent(cursor)}` : '/api/vault/activity?limit=100');
          if (stopped) return;
          record(r.items, primed);
          primed = true;
          cursor = r.cursor ?? cursor;
        } catch {
          /* the ticker hides; try again on the next poll */
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), VAULT_POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      expiries.forEach(clearTimeout);
    };
  }, []);

  return { last, fresh, latest };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project web web/src/graph && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/graph
git commit -m "feat(web): a layout loop that stops at rest and a poll of the notes runs wrote"
```

---

### Task 7: The live Graph board

**Files:**
- Create: `web/src/graph/GraphBoard.tsx`, `web/src/graph/graph.css`
- Test: `web/src/graph/GraphBoard.test.tsx`

**Interfaces:**
- Consumes: `useForceLayout`, `LIVE_MAX` (Task 6); `fitView`, `focusView`, `zoomAt`, `toWorld`, `lerpView`, `ease`, `View` (Task 5); `typeOf`, `nodeRadius`, `shapePath`, `GraphType`, `TYPES` (Task 5); `VaultGraph` (`web/src/api.ts`); `cn`.
- Produces: `web/src/graph/GraphBoard.tsx`:
  - `interface BoardHandle { focus(id: string): void; fit(): void }` (camera glides, 280 ms; jumps under reduced motion).
  - `interface GraphBoardProps { graph: VaultGraph; hiddenTypes: ReadonlySet<GraphType>; selected?: string; focus?: string; near: ReadonlySet<string>; hits: ReadonlySet<string>; fresh: ReadonlySet<string>; reduced: boolean; initialFocus?: string; onHover(id?: string): void; onSelect(id?: string): void; onOpen(id: string): void; children?: ReactNode }`.
  - `const GraphBoard = forwardRef<BoardHandle, GraphBoardProps>` — a `div.gb` holding an SVG (`.gb-svg`, `role="group"`): a dot pattern, edges (`line.gb-edge` with `hot`/`close`/`dim`/`hidden`), notes (`g.gb-node[data-gn=<id>]`, `role="button"`, name `"<title>, <type>, <n> link(s)"`, classes `t-<type>`, `sel`, `near`, `hit`, `dim`, `hidden`; a `circle.gb-ping` when fresh, a `circle.gb-match` when a hit, `path.gb-shape`, `text.gb-label`); tools (buttons "Zoom in", "Zoom out", "Fit all notes", "Re-run the layout"); a hint line; "All note types are hidden. Turn one back on above." when nothing is visible; `children` are overlays (the hop control and the ticker, Task 8).
  - Behaviour: click selects; double-click or Enter/Space opens (`onOpen`); dragging a note moves it (neighbours spring) and does not select it; dragging the background pans; a background click clears the selection; the wheel zooms about the pointer; hover reports `onHover`; only notes that are selected or in `near` are in the tab order; on the first settle the camera fits all notes, or glides to `initialFocus`.

- [ ] **Step 1: Write the failing tests** — create `web/src/graph/GraphBoard.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VaultGraph } from '../api';
import { cssRule, cssText } from '../test/css';
import { GraphBoard, type GraphBoardProps } from './GraphBoard';
import { TYPES, type GraphType } from './graphModel';

const graph: VaultGraph = {
  nodes: [
    { id: 'runs/r1.md', title: 'Run r1', type: 'run', tags: [], degree: 2 },
    { id: 'roles/coder.md', title: 'Coder', type: 'role', tags: [], degree: 2 },
    { id: 'files/a.md', title: 'a.ts', type: 'file', tags: [], degree: 1 },
    { id: 'notes/x.md', title: 'Loose note', tags: [], degree: 1 },
  ],
  edges: [
    { from: 'runs/r1.md', to: 'roles/coder.md' },
    { from: 'roles/coder.md', to: 'files/a.md' },
    { from: 'runs/r1.md', to: 'notes/x.md' },
  ],
  unresolved: 0,
};
const none: ReadonlySet<string> = new Set();
const props = (o: Partial<GraphBoardProps> = {}) => ({
  graph,
  hiddenTypes: new Set<GraphType>(),
  near: none,
  hits: none,
  fresh: none,
  reduced: true,
  onHover: vi.fn(),
  onSelect: vi.fn(),
  onOpen: vi.fn(),
  ...o,
});
const node = (c: HTMLElement, id: string) => c.querySelector(`[data-gn="${id}"]`)!;

describe('GraphBoard', () => {
  it('draws each type as its own shape and names notes for screen readers', async () => {
    const { container } = render(<GraphBoard {...props()} />);
    expect(await screen.findByRole('button', { name: 'Run r1, run, 2 links' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'a.ts, file, 1 link' })).toBeTruthy();
    expect(['runs/r1.md', 'roles/coder.md', 'files/a.md', 'notes/x.md'].map((id) => node(container, id).getAttribute('class'))).toEqual([
      expect.stringContaining('t-run'), expect.stringContaining('t-role'), expect.stringContaining('t-file'), expect.stringContaining('t-note'),
    ]);
    expect(node(container, 'runs/r1.md').querySelector('.gb-shape')!.getAttribute('d')).toMatch(/^M-[\d.]+,-[\d.]+h/);
  });

  it('selects on click, opens on double-click and Enter, and clears on the background', async () => {
    const p = props();
    const { container } = render(<GraphBoard {...p} />);
    const r1 = await screen.findByRole('button', { name: /^Run r1,/ });
    fireEvent.click(r1);
    expect(p.onSelect).toHaveBeenLastCalledWith('runs/r1.md');
    fireEvent.doubleClick(r1);
    fireEvent.keyDown(r1, { key: 'Enter' });
    expect(p.onOpen).toHaveBeenCalledTimes(2);
    const svg = container.querySelector('.gb-svg')!;
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 5, clientY: 5 });
    expect(p.onSelect).toHaveBeenLastCalledWith(undefined);
    fireEvent.pointerEnter(r1);
    expect(p.onHover).toHaveBeenLastCalledWith('runs/r1.md');
  });

  it('dims what is outside the focus, and outside the search hits while searching', async () => {
    const { container, rerender } = render(<GraphBoard {...props({ selected: 'runs/r1.md', focus: 'runs/r1.md', near: new Set(['runs/r1.md', 'roles/coder.md', 'notes/x.md']) })} />);
    await screen.findByRole('button', { name: /^Run r1,/ });
    const dim = () => [...container.querySelectorAll('.gb-node.dim')].map((e) => e.getAttribute('data-gn'));
    expect(dim()).toEqual(['files/a.md']);
    expect(container.querySelectorAll('.gb-edge.hot')).toHaveLength(2);
    rerender(<GraphBoard {...props({ hits: new Set(['files/a.md']) })} />);
    expect(dim()).toEqual(['runs/r1.md', 'roles/coder.md', 'notes/x.md']);
  });

  it('puts only the focused neighbourhood in the tab order', async () => {
    const { container } = render(<GraphBoard {...props({ selected: 'runs/r1.md', near: new Set(['runs/r1.md', 'roles/coder.md']) })} />);
    await screen.findByRole('button', { name: /^Run r1,/ });
    expect(['runs/r1.md', 'roles/coder.md', 'files/a.md'].map((id) => node(container, id).getAttribute('tabindex'))).toEqual(['0', '0', '-1']);
  });

  it('pings notes a run just wrote and pulses search matches', async () => {
    const { container } = render(<GraphBoard {...props({ fresh: new Set(['roles/coder.md']), hits: new Set(['files/a.md']) })} />);
    await screen.findByRole('button', { name: /^Coder,/ });
    expect(node(container, 'roles/coder.md').querySelector('.gb-ping')).toBeTruthy();
    expect(node(container, 'files/a.md').querySelector('.gb-match')).toBeTruthy();
    expect(node(container, 'runs/r1.md').querySelector('.gb-ping, .gb-match')).toBeNull();
  });

  it('zooms, fits and re-runs the layout from its tools', async () => {
    const { container } = render(<GraphBoard {...props()} />);
    const r1 = await screen.findByRole('button', { name: /^Run r1,/ });
    const world = () => container.querySelector('.gb-svg > g')!.getAttribute('transform');
    const fitted = world();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(world()).not.toBe(fitted);
    fireEvent.click(screen.getByRole('button', { name: 'Fit all notes' }));
    expect(world()).toBe(fitted);
    const at = r1.getAttribute('transform');
    fireEvent.click(screen.getByRole('button', { name: 'Re-run the layout' }));
    expect(r1.getAttribute('transform')).not.toBe(at);
  });

  it('drags a note without selecting it', async () => {
    const p = props();
    const { container } = render(<GraphBoard {...p} />);
    const coder = await screen.findByRole('button', { name: /^Coder,/ });
    const before = coder.getAttribute('transform');
    const svg = container.querySelector('.gb-svg')!;
    fireEvent.pointerDown(coder, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 80, clientY: 60 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 80, clientY: 60 });
    fireEvent.click(coder);
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(coder.getAttribute('transform')).not.toBe(before);
  });

  it('says so when every type is hidden', async () => {
    render(<GraphBoard {...props({ hiddenTypes: new Set(TYPES) })} />);
    expect(await screen.findByText('All note types are hidden. Turn one back on above.')).toBeTruthy();
  });

  it('is styled from tokens, and only the run ping loops for good', () => {
    const css = cssText('graph/graph.css');
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(cssRule('graph/graph.css', '.gb-match')).toContain('animation: gb-match 1.1s ease-in-out 3');
    expect(cssRule('graph/graph.css', '.gb-ping')).toContain('infinite');
    expect(css.match(/infinite/g)).toHaveLength(1);
    expect(cssRule('graph/graph.css', '.gb-edge.hot')).not.toContain('animation');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/graph/GraphBoard.test.tsx`
Expected: FAIL — cannot find `./GraphBoard`.

- [ ] **Step 3: Create `web/src/graph/graph.css`**

```css
/* Graph (Studio Live board, v2): a live note board, a reader and a note list. Type is a shape, never a hue.
   Loops: only the green ping of a note a run just wrote (a 12 s live window). Matches pulse three times. */
.gv-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.gv-page > .sl-screen-header { border-bottom: 1px solid var(--line); }
.gv-search { display: flex; align-items: flex-end; gap: 8px; }
.gv-found { padding-bottom: 10px; font-family: var(--font-code); font-size: 11.5px; color: var(--mut); white-space: nowrap; }
.gv-types { display: flex; flex-wrap: wrap; gap: 4px; }
.gv-types button {
  height: 32px; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; border: 1px solid var(--line);
  background: transparent; color: var(--mut); font: inherit; font-size: 12.5px; cursor: pointer;
  transition: background-color var(--t-med) var(--ease), color var(--t-med) var(--ease), border-color var(--t-med) var(--ease);
}
.gv-types button[aria-pressed='true'] { border-color: var(--edge); background: var(--s2); color: var(--ink); }
.gv-glyph { fill: currentColor; stroke: currentColor; stroke-width: 1.5; }
.gv-glyph.hollow { fill: none; }
.gv-count { font-family: var(--font-code); font-size: 11px; color: var(--mut); }
.gv-search-note { margin: 8px 24px 0; }
.gv-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 340px; }
.gv-side { border-left: 1px solid var(--line); background: var(--s1); display: flex; flex-direction: column; min-height: 0; overflow: auto; }

/* the board */
.gb { position: relative; min-height: 520px; overflow: hidden; background: var(--bg); }
.gb-svg { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: grab; }
.gb-svg:active { cursor: grabbing; }
.gb-dot { fill: var(--line2); }
.gb-edge { stroke: var(--edge); stroke-width: 1.2; stroke-linecap: round; opacity: .5; transition: opacity var(--t-slow) var(--ease), stroke var(--t-med) var(--ease); }
.gb-edge.close { opacity: .7; }
.gb-edge.hot { stroke: var(--acc); stroke-width: 2.2; opacity: .95; }
.gb-edge.dim { opacity: .15; }
.gb-edge.hidden { opacity: 0; }
.gb-node { cursor: grab; outline: none; transition: opacity var(--t-slow) var(--ease); }
.gb-node:active { cursor: grabbing; }
.gb-shape { fill: var(--s3); stroke: var(--edge); stroke-width: 1.5; transition: fill var(--t-med) var(--ease), stroke var(--t-med) var(--ease); }
.gb-node.t-note .gb-shape { fill: var(--bg); }
.gb-node.near .gb-shape { stroke: var(--ink); }
.gb-node:hover .gb-shape { fill: var(--ink); stroke: var(--ink); }
.gb-node.sel .gb-shape { fill: var(--acc); stroke: var(--acc); stroke-width: 2.5; }
.gb-node:focus-visible .gb-shape { stroke: var(--acc); stroke-width: 3; }
.gb-node.dim { opacity: .25; }
.gb-node.hidden { opacity: 0; pointer-events: none; }
.gb-label { fill: var(--mut); font-size: 12px; font-weight: 500; pointer-events: none; paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
.gb-node.near .gb-label { fill: var(--ink); }
.gb-node.sel .gb-label { fill: var(--accInk); font-size: 13.5px; font-weight: 600; }
.gb-ping { fill: none; stroke: var(--ok); stroke-width: 2; transform-box: fill-box; transform-origin: center; animation: gb-ping 1.6s var(--ease) infinite; }
.gb-match { fill: var(--accBg); stroke: var(--acc); stroke-width: 1.5; transform-box: fill-box; transform-origin: center; animation: gb-match 1.1s ease-in-out 3; }
@keyframes gb-ping { 0% { opacity: .9; transform: scale(1); } 100% { opacity: 0; transform: scale(2.6); } }
@keyframes gb-match { 50% { transform: scale(1.25); } }
.gb-tools { position: absolute; left: 14px; top: 14px; display: flex; flex-direction: column; gap: 4px; }
.gb-tools button {
  width: 34px; height: 34px; display: grid; place-items: center; padding: 0; border-radius: 9px; border: 1px solid var(--edge);
  background: var(--s1); color: var(--ink); cursor: pointer; transition: background-color var(--t-fast) var(--ease);
}
.gb-tools button:hover { background: var(--s2); }
.gb-hint { position: absolute; right: 14px; bottom: 14px; margin: 0; font-size: 12px; color: var(--mut); pointer-events: none; }
.gb-empty { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--mut); pointer-events: none; }

/* overlays from the screen */
.gv-hops {
  position: absolute; right: 14px; top: 14px; display: flex; align-items: center; gap: 8px; padding: 4px 6px 4px 12px;
  border-radius: 999px; border: 1px solid var(--line2); background: var(--s1); font-size: 12px; color: var(--mut);
}
.gv-hops button { width: 24px; height: 24px; padding: 0; border-radius: 6px; border: 1px solid var(--line2); background: transparent; color: var(--ink); cursor: pointer; }
.gv-hops button:disabled { opacity: .4; cursor: default; }
.gv-ticker {
  position: absolute; left: 14px; bottom: 14px; max-width: calc(100% - 28px); display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px;
  border-radius: 999px; border: 1px solid var(--line2); background: var(--s1); font-size: 12.5px; color: var(--ink); animation: gv-pop var(--t-slow) var(--ease) both;
}
.gv-ticker-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); flex: none; }
.gv-ticker-age { font-family: var(--font-code); font-size: 11px; color: var(--mut); }
@keyframes gv-pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* reader and list */
.gv-reader { padding: 20px; display: flex; flex-direction: column; gap: 12px; border-bottom: 1px solid var(--line); animation: gv-in var(--t-slow) var(--ease) both; }
@keyframes gv-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }
.gv-reader h2 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; color: var(--ink); }
.gv-path { margin: 0; display: flex; align-items: center; gap: 8px; font-family: var(--font-code); font-size: 12px; color: var(--mut); overflow-wrap: anywhere; }
.gv-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.gv-tags button { padding: 2px 8px; border: 0; border-radius: 999px; background: var(--s2); color: var(--mut); font: inherit; font-size: 11.5px; cursor: pointer; }
.gv-tags button:hover { color: var(--ink); }
.gv-text { margin: 0; max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-family: var(--font-ui); font-size: 13.5px; line-height: 1.6; color: var(--ink); }
.gv-reader-empty { margin: 0; padding: 20px; color: var(--mut); border-bottom: 1px solid var(--line); }
.gv-connected { display: flex; flex-direction: column; gap: 4px; }
.gv-link, .gv-list-item {
  width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent;
  color: var(--ink); font: inherit; font-size: 13px; text-align: left; cursor: pointer; transition: background-color var(--t-fast) var(--ease);
}
.gv-link:hover, .gv-list-item:hover { background: var(--s2); }
.gv-dir { width: 14px; color: var(--mut); }
.gv-link-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gv-link-kind { font-family: var(--font-code); font-size: 11px; color: var(--mut); }
.gv-list { padding: 14px 20px; display: flex; flex-direction: column; gap: 2px; }
.gv-list-item.on { background: var(--accBg); color: var(--accInk); }
.gv-list-item.off { color: var(--mut); }
@media (max-width: 1199px) { .gv-body { grid-template-columns: minmax(0, 1fr) 300px; } }
@media (max-width: 899px) {
  .gv-body { grid-template-columns: minmax(0, 1fr); }
  .gb { min-height: 60vh; }
  .gv-side { border-left: 0; border-top: 1px solid var(--line); overflow: visible; }
  .gb-hint { display: none; }
}
```

- [ ] **Step 4: Create `web/src/graph/GraphBoard.tsx`**

```tsx
import { Maximize2, Minus, Plus, RotateCw } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { VaultGraph } from '../api';
import { cn } from '../ui/cn';
import { ease, fitView, focusView, lerpView, toWorld, zoomAt, type View } from './camera';
import type { Sim } from './forceSim';
import { nodeRadius, shapePath, typeOf, type GraphType } from './graphModel';
import { useForceLayout } from './useForceLayout';
import './graph.css';

export interface BoardHandle {
  /** Glide the camera to a note. */
  focus: (id: string) => void;
  /** Glide the camera to show every visible note. */
  fit: () => void;
}

export interface GraphBoardProps {
  graph: VaultGraph;
  hiddenTypes: ReadonlySet<GraphType>;
  selected?: string;
  /** The note the highlight is about: the hovered one, else the selected one. */
  focus?: string;
  /** The focus note's neighbourhood (empty without a focus). */
  near: ReadonlySet<string>;
  hits: ReadonlySet<string>;
  /** Notes a run just wrote: they ping. */
  fresh: ReadonlySet<string>;
  reduced: boolean;
  /** On the first settle, glide to this note instead of fitting everything (a deep link). */
  initialFocus?: string;
  onHover: (id?: string) => void;
  onSelect: (id?: string) => void;
  /** Double-click, Enter or Space: select the note and glide to it. */
  onOpen: (id: string) => void;
  /** Overlays drawn over the board (the hop control, the ticker). */
  children?: ReactNode;
}

const GLIDE_MS = 280;
/** jsdom and a not-yet-laid-out board report 0×0. */
const FALLBACK = { w: 800, h: 560 };
const at = (p: { x: number; y: number }) => `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`;
const short = (t: string) => (t.length > 28 ? `${t.slice(0, 27)}…` : t);

type Drag = { kind: 'node'; id: string; moved: boolean; sx: number; sy: number } | { kind: 'pan'; moved: boolean; sx: number; sy: number; vx: number; vy: number };

export const GraphBoard = forwardRef<BoardHandle, GraphBoardProps>(function GraphBoard(p, ref) {
  const svg = useRef<SVGSVGElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef<(SVGLineElement | null)[]>([]);
  const [view, setView] = useState<View>({ x: FALLBACK.w / 2, y: FALLBACK.h / 2, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const glide = useRef<number | null>(null);
  const drag = useRef<Drag | undefined>(undefined);
  /** The last pointer gesture on a note moved it: the click that follows is not a selection. */
  const dragged = useRef(false);
  const fitted = useRef(false);

  const hiddenIds = useMemo(() => new Set(p.graph.nodes.filter((n) => p.hiddenTypes.has(typeOf(n.type))).map((n) => n.id)), [p.graph, p.hiddenTypes]);

  /** Move SVG nodes and edges straight from the simulation: no React render per frame. */
  const paint = useCallback(
    (s: Sim) => {
      for (const n of s.nodes) nodeEls.current.get(n.id)?.setAttribute('transform', at(n));
      p.graph.edges.forEach((e, i) => {
        const el = edgeEls.current[i];
        const a = s.nodes[s.index.get(e.from) ?? -1];
        const b = s.nodes[s.index.get(e.to) ?? -1];
        if (!el || !a || !b) return;
        el.setAttribute('x1', a.x.toFixed(1));
        el.setAttribute('y1', a.y.toFixed(1));
        el.setAttribute('x2', b.x.toFixed(1));
        el.setAttribute('y2', b.y.toFixed(1));
      });
    },
    [p.graph],
  );

  const size = () => {
    const r = svg.current?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { w: r.width, h: r.height } : FALLBACK;
  };
  const stopGlide = () => {
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    glide.current = null;
  };
  const glideTo = (target: View) => {
    stopGlide();
    if (p.reduced) return setView(target);
    const from = viewRef.current;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / GLIDE_MS);
      setView(lerpView(from, target, ease(t)));
      glide.current = t < 1 ? requestAnimationFrame(frame) : null;
    };
    glide.current = requestAnimationFrame(frame);
  };
  useEffect(() => stopGlide, []);

  const layout = useForceLayout(p.graph, hiddenIds, {
    reduced: p.reduced,
    paint,
    onSettled: () => {
      if (fitted.current) return;
      fitted.current = true;
      const { w, h } = size();
      const target = p.initialFocus ? layout.position(p.initialFocus) : undefined;
      glideTo(target ? focusView(target, 1.25, w, h) : fitView(layout.points(), w, h));
    },
  });

  const fit = () => {
    const { w, h } = size();
    glideTo(fitView(layout.points(), w, h));
  };
  useImperativeHandle(ref, () => ({
    focus: (id) => {
      const pt = layout.position(id);
      if (!pt) return;
      const { w, h } = size();
      glideTo(focusView(pt, Math.max(viewRef.current.k, 1.25), w, h));
    },
    fit,
  }));
  const zoomBy = (factor: number) => {
    const { w, h } = size();
    glideTo(zoomAt(viewRef.current, factor, w / 2, h / 2));
  };

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopGlide();
      const r = el.getBoundingClientRect();
      setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const onNodeDown = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    svg.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: 'node', id, moved: false, ...local(e) };
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    svg.current?.setPointerCapture(e.pointerId);
    stopGlide();
    drag.current = { kind: 'pan', moved: false, ...local(e), vx: viewRef.current.x, vy: viewRef.current.y };
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const { sx, sy } = local(e);
    if (Math.abs(sx - d.sx) + Math.abs(sy - d.sy) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + sx - d.sx, y: d.vy + sy - d.sy }));
    else {
      const w = toWorld(viewRef.current, sx, sy);
      layout.drag(d.id, w.x, w.y);
    }
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = undefined;
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.kind === 'node') {
      dragged.current = d.moved;
      if (d.moved) layout.release(d.id);
    } else if (!d.moved) p.onSelect(undefined);
  };

  const pos = (id: string) => layout.position(id);
  const anyVisible = p.graph.nodes.some((n) => !hiddenIds.has(n.id));
  const dimFor = (id: string) => (p.hits.size ? !p.hits.has(id) : p.near.size ? !p.near.has(id) : false);

  return (
    <div className="gb">
      <svg ref={svg} className="gb-svg" role="group" aria-label="Note graph. The All notes list moves between notes with the keyboard." onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <defs>
          <pattern id="gb-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" className="gb-dot" />
          </pattern>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#gb-dots)" />
          {layout.version ? (
            <>
              {p.graph.edges.map((e, i) => {
                const a = pos(e.from);
                const b = pos(e.to);
                if (!a || !b) return null;
                const hot = !!p.focus && (e.from === p.focus || e.to === p.focus) && !p.hits.size;
                const close = p.near.has(e.from) && p.near.has(e.to);
                return (
                  <line
                    key={`${e.from}→${e.to}`}
                    ref={(el) => {
                      edgeEls.current[i] = el;
                    }}
                    className={cn('gb-edge', { hot, close, dim: p.hits.size > 0 || (p.near.size > 0 && !close), hidden: hiddenIds.has(e.from) || hiddenIds.has(e.to) })}
                    x1={a.x.toFixed(1)}
                    y1={a.y.toFixed(1)}
                    x2={b.x.toFixed(1)}
                    y2={b.y.toFixed(1)}
                  />
                );
              })}
              {p.graph.nodes.map((n) => {
                const pt = pos(n.id);
                if (!pt) return null;
                const t = typeOf(n.type);
                const sel = p.selected === n.id;
                const near = p.near.has(n.id);
                const hit = p.hits.has(n.id);
                const hidden = hiddenIds.has(n.id);
                const r = nodeRadius(n.degree) + (sel ? 3 : 0);
                const label = sel || hit || (near && p.near.size > 0) || n.degree >= 3 || view.k > 1.4;
                return (
                  <g
                    key={n.id}
                    ref={(el) => {
                      if (el) nodeEls.current.set(n.id, el);
                      else nodeEls.current.delete(n.id);
                    }}
                    data-gn={n.id}
                    className={cn('gb-node', `t-${t}`, { sel, near: near && !sel, hit, dim: dimFor(n.id), hidden })}
                    transform={at(pt)}
                    role="button"
                    tabIndex={!hidden && (sel || near) ? 0 : -1}
                    aria-label={`${n.title}, ${t}, ${n.degree} link${n.degree === 1 ? '' : 's'}`}
                    aria-hidden={hidden || undefined}
                    onPointerDown={(e) => onNodeDown(e, n.id)}
                    onPointerEnter={() => p.onHover(n.id)}
                    onPointerLeave={() => p.onHover(undefined)}
                    onClick={() => {
                      if (dragged.current) {
                        dragged.current = false;
                        return;
                      }
                      p.onSelect(n.id);
                    }}
                    onDoubleClick={() => p.onOpen(n.id)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      p.onOpen(n.id);
                    }}
                  >
                    {p.fresh.has(n.id) && !hidden ? <circle className="gb-ping" r={r + 4} /> : null}
                    {hit ? <circle className="gb-match" r={r + 8} /> : null}
                    <path className="gb-shape" d={shapePath(t, r)} />
                    {label ? (
                      <text className="gb-label" y={r + 14} textAnchor="middle">
                        {short(n.title)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </>
          ) : null}
        </g>
      </svg>
      <div className="gb-tools">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          <Plus size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Fit all notes" onClick={fit}>
          <Maximize2 size={14} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Re-run the layout" onClick={layout.rerun}>
          <RotateCw size={14} aria-hidden="true" />
        </button>
      </div>
      {anyVisible ? null : <p className="gb-empty">All note types are hidden. Turn one back on above.</p>}
      {p.children}
      <p className="gb-hint">drag a note · scroll to zoom · drag the background to pan · double-click to focus</p>
    </div>
  );
});
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project web web/src/graph web/src/rules.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/graph
git commit -m "feat(web): live Graph board with spring layout, hop highlights, pings, pan and zoom"
```

---

### Task 8: Graph screen — reader, note list, search, filters, ticker and deep link

**Files:**
- Create: `web/src/graph/NoteReader.tsx`, `web/src/graph/NoteList.tsx`
- Modify: `web/src/Graph.tsx` (full rewrite), `web/src/App.tsx` (Graph props), `web/src/styles.css` (delete the graph rules)
- Delete: `web/src/graphLayout.ts`, `web/src/graphLayout.test.ts`
- Test: `web/src/Graph.test.tsx` (full rewrite), `web/src/App.test.tsx` (one case)

**Interfaces:**
- Consumes: `GraphBoard`, `BoardHandle` (Task 7); `useVaultActivity`, `VAULT_POLL_MS` (Task 6); `adjacency`, `neighbourhood`, `matchLocal`, `typeOf`, `TYPES`, `TYPE_LABEL`, `GLYPH`, `GraphType` (Task 5); `api`, `ApiError`, `ago`, `VaultGraph`, `VaultNote`, `VaultActivityItem`; `ScreenHeader`, `SectionHeading`, `EmptyState`, `InlineError`, `Loading`, `useReducedMotionPref`; Arc `SearchField`, `Button`.
- Produces:
  - `GraphView(props: { note?: string; onNote?: (path?: string) => void })` and `VAULT_SCAN_MS = 5500` from `web/src/Graph.tsx`. App passes `note={screen.id}` and maps `onNote` to `#/graph/<path>` / `#/graph`.
  - `NoteReader(props: { path?: string; note?: VaultNote; state: 'idle' | 'loading' | 'missing' | 'failed'; missing: boolean; degree?: number; touch?: VaultActivityItem; fresh: boolean; links: ReaderLink[]; onTag(tag: string): void; onGo(id: string): void; onHover(id?: string): void; onRetry(): void })` with `interface ReaderLink { id: string; title: string; type: GraphType; dir: '→' | '←' }` — a region named "Reader".
  - `NoteList(props: { nodes: VaultGraph['nodes']; selected?: string; hiddenTypes: ReadonlySet<GraphType>; onGo(id: string): void })` and `LIST_MAX = 300` — a `nav` named "All notes"; ↑/↓ move between rows.

- [ ] **Step 1: Write the failing tests** — replace `web/src/Graph.test.tsx` with:

```tsx
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api, ApiError } from './api';
import { GraphView, VAULT_SCAN_MS } from './Graph';
import { VAULT_POLL_MS } from './graph/useVaultActivity';
import { calls, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const graph = {
  nodes: [
    { id: 'runs/r1.md', title: 'Run r1', type: 'run', tags: ['aorch/run'], degree: 2 },
    { id: 'roles/coder.md', title: 'Coder', type: 'role', tags: [], degree: 1 },
    { id: 'notes/x.md', title: 'Loose note', tags: ['design'], degree: 1 },
  ],
  edges: [
    { from: 'runs/r1.md', to: 'roles/coder.md' },
    { from: 'notes/x.md', to: 'runs/r1.md' },
  ],
  unresolved: 1,
};
const noteFor = (path: string) => {
  const n = graph.nodes.find((x) => x.id === path) ?? { title: path, type: 'note' };
  return { path, title: n.title, type: n.type, tags: ['aorch/run'], body: `body of ${n.title}`, links: [], backlinks: [] };
};
const routes = {
  'GET /api/vault/graph': graph as unknown,
  'GET /api/vault/note': (_b: unknown, p: string) => {
    const path = decodeURIComponent(p.split('path=')[1]!);
    return path.startsWith('ghost') ? new ApiError('no such note', 404) : noteFor(path);
  },
  'GET /api/vault/search': [{ path: 'roles/coder.md' }],
  'GET /api/vault/activity': { items: [], cursor: null },
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  // reduced motion: the layout rests at once and the camera jumps, so positions are final on the first paint
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)', media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  routeApi(routes);
});

describe('Graph', () => {
  it('draws the vault, reads a note and lists what it connects to', async () => {
    const onNote = vi.fn();
    renderApp(<GraphView onNote={onNote} />);
    expect(await screen.findByText('vault · 3 notes · 2 links · 1 unresolved')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^Run r1, run/ }));
    expect(onNote).toHaveBeenLastCalledWith('runs/r1.md');
    expect(await screen.findByText('body of Run r1')).toBeTruthy();
    const reader = screen.getByRole('region', { name: 'Reader' });
    expect(within(reader).getByRole('heading', { name: 'Run r1' })).toBeTruthy();
    expect(within(reader).getByRole('button', { name: /links to Coder/ })).toBeTruthy();
    expect(within(reader).getByRole('button', { name: /linked from Loose note/ })).toBeTruthy();
  });

  it('navigates by a connected note and searches by a tag', async () => {
    renderApp(<GraphView />);
    fireEvent.click(await screen.findByRole('button', { name: /^Run r1, run/ }));
    const reader = await screen.findByRole('region', { name: 'Reader' });
    fireEvent.click(await within(reader).findByRole('button', { name: /links to Coder/ }));
    expect(await screen.findByText('body of Coder')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '#aorch/run' }));
    expect((screen.getByLabelText('Search the vault') as HTMLInputElement).value).toBe('#aorch/run');
    expect(screen.getByText('1 found')).toBeTruthy();
  });

  it('pulses search hits with a count and dims the rest', async () => {
    const { container } = renderApp(<GraphView />);
    await screen.findByRole('button', { name: /^Run r1,/ });
    fireEvent.change(screen.getByLabelText('Search the vault'), { target: { value: 'coder' } });
    expect(screen.getByText('1 found')).toBeTruthy();
    await waitFor(() => expect(calls('GET', '/api/vault/search?q=coder')).toHaveLength(1));
    expect(container.querySelector('[data-gn="roles/coder.md"] .gb-match')).toBeTruthy();
    expect(container.querySelectorAll('.gb-node.dim')).toHaveLength(2);
  });

  it('hides a note type from its filter button', async () => {
    const { container } = renderApp(<GraphView />);
    await screen.findByRole('button', { name: /^Run r1,/ });
    const runs = screen.getByRole('button', { name: 'runs 1' });
    expect(runs.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(runs);
    expect(runs.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-gn="runs/r1.md"]')!.classList.contains('hidden')).toBe(true);
  });

  it('moves through the All notes list with the keyboard', async () => {
    renderApp(<GraphView />);
    const list = await screen.findByRole('navigation', { name: 'All notes' });
    const items = within(list).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual(['Coder', 'Loose note', 'Run r1']);
    items[0]!.focus();
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.click(items[2]!);
    expect(await screen.findByText('body of Run r1')).toBeTruthy();
    expect(items[2]!.getAttribute('aria-current')).toBe('true');
  });

  it('opens the note a deep link names', async () => {
    renderApp(<GraphView note="roles/coder.md" onNote={() => {}} />);
    expect(await screen.findByText('body of Coder')).toBeTruthy();
  });

  it('says so when the linked note is not in the vault', async () => {
    renderApp(<GraphView note="ghost.md" onNote={() => {}} />);
    expect(await screen.findByText('That note is not in the vault.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Run r1,/ })).toBeTruthy();
  });

  it('reloads the graph when a run writes a note it does not have', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let current = graph;
    let polls = 0;
    const written = { id: 'r9:4', ts: Date.now(), runId: 'r9', run: 'ship', path: 'Runs/new.md' };
    routeApi({
      ...routes,
      'GET /api/vault/graph': () => current,
      'GET /api/vault/activity': () => (polls++ === 1 ? { items: [written], cursor: `${written.ts}:r9:4` } : { items: [], cursor: polls > 1 ? `${written.ts}:r9:4` : null }),
    });
    const { container } = renderApp(<GraphView />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('button', { name: /^Run r1,/ })).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(screen.getByText(/ship recorded Runs\/new\.md/)).toBeTruthy();
    current = { ...graph, nodes: [...graph.nodes, { id: 'Runs/new.md', title: 'New run', type: 'run', tags: [], degree: 0 }] };
    await act(() => vi.advanceTimersByTimeAsync(VAULT_SCAN_MS));
    expect(calls('GET', '/api/vault/graph')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^New run, run/ })).toBeTruthy();
    expect(container.querySelector('[data-gn="Runs/new.md"] .gb-ping')).toBeTruthy();
    expect(screen.getByText(/ship recorded New run/)).toBeTruthy();
  });

  it('shows a load failure inline and retries', async () => {
    let down = true;
    routeApi({ ...routes, 'GET /api/vault/graph': () => (down ? new Error('vault gone') : graph) });
    renderApp(<GraphView />);
    expect((await screen.findByRole('alert')).textContent).toContain('vault gone');
    down = false;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(await screen.findByRole('button', { name: /^Run r1,/ })).toBeTruthy();
  });

  it('explains an empty vault', async () => {
    routeApi({ ...routes, 'GET /api/vault/graph': { nodes: [], edges: [], unresolved: 0 } });
    renderApp(<GraphView />);
    expect(await screen.findByText(/The vault is empty/)).toBeTruthy();
  });
});
```

In `web/src/App.test.tsx` change the Graph mock to `vi.mock('./Graph', () => ({ GraphView: (p: { note?: string }) => <div>graph screen {p.note ?? ''}</div> }));` and append inside `describe('App shell', …)`:

```tsx
  it('hands the note in the hash to the Graph', () => {
    startAt('#/graph/Roles%2Fcoder.md');
    render(<App />);
    expect(screen.getByText('graph screen Roles/coder.md')).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/Graph.test.tsx web/src/App.test.tsx`
Expected: FAIL — `VAULT_SCAN_MS` is not exported, no "Reader" region, no type filter buttons, App does not pass the note.

- [ ] **Step 3: Create `web/src/graph/NoteReader.tsx`**

```tsx
import { ago, type VaultActivityItem, type VaultNote } from '../api';
import { Loading } from '../components/Loading';
import { cn } from '../ui/cn';
import { InlineError } from '../ui/studio/InlineError';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { GLYPH, typeOf, type GraphType } from './graphModel';

export interface ReaderLink {
  id: string;
  title: string;
  type: GraphType;
  /** → the note links to it; ← it links to the note. */
  dir: '→' | '←';
}

/** The selected note: path, title, tags (a click searches them), body, who wrote it last, and what it connects to. */
export function NoteReader(p: {
  path?: string;
  note?: VaultNote;
  state: 'idle' | 'loading' | 'missing' | 'failed';
  missing: boolean;
  degree?: number;
  touch?: VaultActivityItem;
  fresh: boolean;
  links: ReaderLink[];
  onTag: (tag: string) => void;
  onGo: (id: string) => void;
  onHover: (id?: string) => void;
  onRetry: () => void;
}) {
  if (!p.path) return <p className="gv-reader-empty">Select a note to read it and see what links to it.</p>;
  if (p.missing || p.state === 'missing')
    return (
      <p className="gv-reader-empty" role="status">
        That note is not in the vault.
      </p>
    );
  if (p.state === 'failed')
    return (
      <div className="gv-reader-empty">
        <InlineError message="The note could not be loaded." onRetry={p.onRetry} />
      </div>
    );
  const n = p.note;
  const t = typeOf(n?.type);
  return (
    <section className="gv-reader" aria-label="Reader" key={p.path}>
      <Loading loading={p.state === 'loading' || !n} lines={5} label="Loading the note">
        {n ? (
          <>
            <p className="gv-path">
              <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
                <path d={GLYPH[t]} className={cn('gv-glyph', { hollow: t === 'note' })} />
              </svg>
              <span>{n.path}</span>
            </p>
            <h2>{n.title}</h2>
            {n.tags.length ? (
              <div className="gv-tags">
                {n.tags.map((tag) => (
                  <button key={tag} type="button" onClick={() => p.onTag(tag)}>
                    #{tag}
                  </button>
                ))}
              </div>
            ) : null}
            <pre className="gv-text">{n.body.slice(0, 6000)}</pre>
            <p className="sl-meta">
              {p.degree ?? 0} link{p.degree === 1 ? '' : 's'}
              {p.touch ? ` · ${p.fresh ? `written by ${p.touch.run} just now` : `last written by ${p.touch.run} · ${ago(p.touch.ts)}`}` : ''}
            </p>
          </>
        ) : null}
      </Loading>
      {p.links.length ? (
        <div className="gv-connected">
          <SectionHeading title="Connected" count={p.links.length} />
          <ul className="sl-list">
            {p.links.map((l) => (
              <li key={`${l.dir}${l.id}`}>
                <button
                  type="button"
                  className="gv-link"
                  onClick={() => p.onGo(l.id)}
                  onPointerEnter={() => p.onHover(l.id)}
                  onPointerLeave={() => p.onHover(undefined)}
                  onFocus={() => p.onHover(l.id)}
                  onBlur={() => p.onHover(undefined)}
                >
                  <span className="gv-dir" aria-hidden="true">
                    {l.dir}
                  </span>
                  <span className="sl-sr">{l.dir === '→' ? 'links to ' : 'linked from '}</span>
                  <span className="gv-link-title">{l.title}</span>
                  <span className="gv-link-kind">{l.type}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Create `web/src/graph/NoteList.tsx`**

```tsx
import { useMemo, type KeyboardEvent } from 'react';
import type { VaultGraph } from '../api';
import { cn } from '../ui/cn';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { GLYPH, typeOf, type GraphType } from './graphModel';

export const LIST_MAX = 300;

/** Every note by title: the keyboard path through the vault (↑/↓ between rows, Enter opens). */
export function NoteList(p: { nodes: VaultGraph['nodes']; selected?: string; hiddenTypes: ReadonlySet<GraphType>; onGo: (id: string) => void }) {
  const sorted = useMemo(() => [...p.nodes].sort((a, b) => a.title.localeCompare(b.title)), [p.nodes]);
  const move = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  return (
    <nav className="gv-list" aria-label="All notes">
      <SectionHeading title="All notes" count={p.nodes.length} />
      <ul className="sl-list" onKeyDown={move}>
        {sorted.slice(0, LIST_MAX).map((n) => {
          const t = typeOf(n.type);
          const on = p.selected === n.id;
          return (
            <li key={n.id}>
              <button type="button" className={cn('gv-list-item', { on, off: p.hiddenTypes.has(t) })} aria-current={on ? 'true' : undefined} onClick={() => p.onGo(n.id)}>
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                  <path d={GLYPH[t]} className={cn('gv-glyph', { hollow: t === 'note' })} />
                </svg>
                <span>{n.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {p.nodes.length > LIST_MAX ? (
        <p className="sl-meta">
          Showing the first {LIST_MAX} of {p.nodes.length}. Search to find the rest.
        </p>
      ) : null}
    </nav>
  );
}
```

- [ ] **Step 5: Rewrite `web/src/Graph.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ago, api, ApiError, type VaultGraph, type VaultNote } from './api';
import { Button } from './components/arc/button/button';
import { SearchField } from './components/arc/search-field/search-field';
import { Loading, useReducedMotionPref } from './components/Loading';
import { GraphBoard, type BoardHandle } from './graph/GraphBoard';
import { adjacency, GLYPH, matchLocal, neighbourhood, TYPE_LABEL, TYPES, typeOf, type GraphType } from './graph/graphModel';
import { NoteList } from './graph/NoteList';
import { NoteReader, type ReaderLink } from './graph/NoteReader';
import { useVaultActivity } from './graph/useVaultActivity';
import { cn } from './ui/cn';
import { EmptyState } from './ui/studio/EmptyState';
import { InlineError } from './ui/studio/InlineError';
import { ScreenHeader } from './ui/studio/ScreenHeader';
import './graph/graph.css';

/** The server caches its vault scan for 5 s: a note a run just wrote is looked for again after that. */
export const VAULT_SCAN_MS = 5500;
type NoteState = 'idle' | 'loading' | 'missing' | 'failed';

/** The knowledge graph: a live board of vault notes, a reader and a list. `note` is the deep-linked path. */
export function GraphView(props: { note?: string; onNote?: (path?: string) => void }) {
  const reduced = useReducedMotionPref();
  const activity = useVaultActivity();
  const board = useRef<BoardHandle>(null);
  const opened = useRef(0);
  const [g, setG] = useState<VaultGraph>();
  const [err, setErr] = useState<string>();
  const [sel, setSel] = useState<string>();
  const [note, setNote] = useState<VaultNote>();
  const [noteState, setNoteState] = useState<NoteState>('idle');
  const [hover, setHover] = useState<string>();
  const [depth, setDepth] = useState(1);
  const [hidden, setHidden] = useState<ReadonlySet<GraphType>>(() => new Set());
  const [q, setQ] = useState('');
  const [serverHits, setServerHits] = useState<ReadonlySet<string>>(() => new Set());
  const [searchFailed, setSearchFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setErr(undefined);
      setG(await api<VaultGraph>('GET', '/api/vault/graph'));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const ids = useMemo(() => new Set((g?.nodes ?? []).map((n) => n.id)), [g]);
  const byId = useMemo(() => new Map((g?.nodes ?? []).map((n) => [n.id, n])), [g]);
  const adj = useMemo(() => adjacency(g?.edges ?? []), [g]);
  const focus = hover ?? sel;
  const near = useMemo(() => neighbourhood(adj, focus && ids.has(focus) ? focus : undefined, depth), [adj, focus, ids, depth]);
  const local = useMemo(() => matchLocal(g?.nodes ?? [], q), [g, q]);
  const hits = useMemo(() => new Set([...local, ...[...serverHits].filter((h) => ids.has(h))]), [local, serverHits, ids]);
  const fresh = useMemo(() => new Set([...activity.fresh].filter((p) => ids.has(p))), [activity.fresh, ids]);
  const counts = useMemo(() => {
    const c: Partial<Record<GraphType, number>> = {};
    for (const n of g?.nodes ?? []) c[typeOf(n.type)] = (c[typeOf(n.type)] ?? 0) + 1;
    return c;
  }, [g]);

  const open = useCallback(async (path: string) => {
    const token = ++opened.current;
    setSel(path);
    setNoteState('loading');
    try {
      const n = await api<VaultNote>('GET', `/api/vault/note?path=${encodeURIComponent(path)}`);
      if (opened.current !== token) return;
      setNote(n);
      setNoteState('idle');
    } catch (e) {
      if (opened.current !== token) return;
      setNote(undefined);
      setNoteState(e instanceof ApiError && e.status === 404 ? 'missing' : 'failed');
    }
  }, []);
  const clear = () => {
    opened.current++;
    setSel(undefined);
    setNote(undefined);
    setNoteState('idle');
  };
  const select = (path?: string) => {
    if (path === sel) return;
    props.onNote?.(path);
    if (path) void open(path);
    else clear();
  };
  /** Select a note and glide to it, turning its type back on if it was hidden. */
  const go = (path: string) => {
    const t = typeOf(byId.get(path)?.type);
    if (hidden.has(t))
      setHidden((h) => {
        const next = new Set(h);
        next.delete(t);
        return next;
      });
    select(path);
    board.current?.focus(path);
  };
  const toggleType = (t: GraphType) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  // the deep link: open the note it names; Back to #/graph clears the selection
  useEffect(() => {
    if (props.note && props.note !== sel) void open(props.note);
    else if (!props.note && sel && props.onNote) clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.note]);

  // search: title and tag matches at once, full-text hits shortly after; then fly to the first
  useEffect(() => {
    const query = q.trim();
    setSearchFailed(false);
    if (!query) {
      setServerHits(new Set());
      return;
    }
    let live = true;
    const h = setTimeout(async () => {
      let found: string[] = [];
      try {
        found = (await api<{ path: string }[]>('GET', `/api/vault/search?q=${encodeURIComponent(query)}`)).map((x) => x.path);
      } catch {
        if (live) setSearchFailed(true);
      }
      if (!live) return;
      setServerHits(new Set(found));
      const first = [...matchLocal(g?.nodes ?? [], query), ...found].find((x) => ids.has(x));
      if (first) board.current?.focus(first);
    }, 300);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [q, g, ids]);

  // a run wrote a note this graph does not have yet: look again once the server's scan cache has expired
  const latest = activity.latest;
  useEffect(() => {
    if (!g || !latest || ids.has(latest.path)) return;
    const h = setTimeout(() => void load(), VAULT_SCAN_MS);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  const links: ReaderLink[] =
    g && sel
      ? [...g.edges.filter((e) => e.from === sel).map((e) => ({ id: e.to, dir: '→' as const })), ...g.edges.filter((e) => e.to === sel).map((e) => ({ id: e.from, dir: '←' as const }))].flatMap((l) => {
          const n = byId.get(l.id);
          return n ? [{ ...l, title: n.title, type: typeOf(n.type) }] : [];
        })
      : [];

  return (
    <div className="gv-page">
      <ScreenHeader
        meta={g ? `vault · ${g.nodes.length} notes · ${g.edges.length} links${g.unresolved ? ` · ${g.unresolved} unresolved` : ''}` : 'vault'}
        title="Knowledge graph"
        actions={
          <>
            <div className="gv-search">
              <SearchField
                label="Search the vault"
                value={q}
                onValueChange={setQ}
                placeholder="Titles, tags and text"
                onKeyDown={(e) => {
                  const first = [...hits][0];
                  if (e.key === 'Enter' && first) board.current?.focus(first);
                }}
              />
              {q.trim() ? (
                <span className="gv-found" role="status">
                  {hits.size} found
                </span>
              ) : null}
            </div>
            {g ? (
              <div className="gv-types" role="group" aria-label="Show note types">
                {TYPES.filter((t) => counts[t]).map((t) => (
                  <button key={t} type="button" aria-pressed={!hidden.has(t)} onClick={() => toggleType(t)}>
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <path d={GLYPH[t]} className={cn('gv-glyph', { hollow: t === 'note' })} />
                    </svg>
                    {TYPE_LABEL[t]} <span className="gv-count">{counts[t]}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <Button variant="secondary" onClick={() => void load()}>
              Reload
            </Button>
          </>
        }
      />
      {err ? <InlineError message={err} onRetry={() => void load()} /> : null}
      {searchFailed ? (
        <p className="sl-note gv-search-note" role="status">
          Full-text search failed; showing title and tag matches.
        </p>
      ) : null}
      <Loading loading={!g && !err} lines={8} label="Loading the vault">
        {g && g.nodes.length === 0 ? (
          <EmptyState title="The vault is empty" description="Finish a run and its notes appear here, linked to the pipeline, roles and files it touched." />
        ) : g ? (
          <div className="gv-body">
            <GraphBoard
              ref={board}
              graph={g}
              hiddenTypes={hidden}
              selected={sel}
              focus={focus}
              near={near}
              hits={hits}
              fresh={fresh}
              reduced={reduced}
              initialFocus={props.note}
              onHover={setHover}
              onSelect={select}
              onOpen={go}
            >
              <div className="gv-hops" role="group" aria-label="How far highlights reach">
                <span>{depth === 1 ? 'showing direct links' : `showing ${depth} hops`}</span>
                <button type="button" aria-label="Fewer hops" disabled={depth <= 1} onClick={() => setDepth(depth - 1)}>
                  −
                </button>
                <button type="button" aria-label="More hops" disabled={depth >= 3} onClick={() => setDepth(depth + 1)}>
                  +
                </button>
              </div>
              {latest ? (
                <div key={latest.id} className="gv-ticker" role="status">
                  <span className="gv-ticker-dot" aria-hidden="true" />
                  <span>
                    {latest.run} recorded {byId.get(latest.path)?.title ?? latest.path}
                  </span>
                  <span className="gv-ticker-age">{ago(latest.ts)}</span>
                </div>
              ) : null}
            </GraphBoard>
            <aside className="gv-side" aria-label="Note">
              <NoteReader
                path={sel}
                note={note}
                state={noteState}
                missing={!!sel && !ids.has(sel)}
                degree={sel ? byId.get(sel)?.degree : undefined}
                touch={sel ? activity.last.get(sel) : undefined}
                fresh={!!sel && fresh.has(sel)}
                links={links}
                onTag={(t) => setQ(`#${t}`)}
                onGo={go}
                onHover={setHover}
                onRetry={() => sel && void open(sel)}
              />
              <NoteList nodes={g.nodes} selected={sel} hiddenTypes={hidden} onGo={go} />
            </aside>
          </div>
        ) : null}
      </Loading>
    </div>
  );
}
```

- [ ] **Step 6: Wire the deep link in `web/src/App.tsx`** — replace `{screen.tab === 'graph' ? <GraphView /> : null}` with:

```tsx
          {screen.tab === 'graph' ? <GraphView note={screen.id} onNote={(path) => go(path ? { tab: 'graph', id: path } : { tab: 'graph' })} /> : null}
```

- [ ] **Step 7: Remove the old layout and graph styles**

Run: `git rm web/src/graphLayout.ts web/src/graphLayout.test.ts`

In `web/src/styles.css` delete the whole `/* ---------- graph ---------- */` block (`.graph-view`, `.graph-main`, `.graph-svg`, `.note-panel`, `.note-body`, `.links`, `.legend`, `.node-dot`, `.g-edge`, `.g-edge.hot`, `.g-node`, `.g-node text`, `.g-node.sel circle`, `.g-node.hit circle`, `.g-node.dim`, the `.t-run … .t-note` line and the `.g-node circle, .node-dot.t-…` rule), `.toolbar`, and inside `@media (max-width: 1000px)` the `.graph-view` and `.note-panel` lines (delete the media block if it is now empty).

- [ ] **Step 8: Run the tests**

Run: `npx vitest run --project web web/src/Graph.test.tsx web/src/graph web/src/App.test.tsx web/src/rules.test.ts && npm run typecheck && npm run build`
Expected: PASS, build clean.

- [ ] **Step 9: Commit**

```bash
git add web/src/Graph.tsx web/src/Graph.test.tsx web/src/graph web/src/App.tsx web/src/App.test.tsx web/src/styles.css
git commit -m "feat(web): Graph screen with reader, note list, type filters, search, run ticker and deep links"
```

- [ ] **Step 10: Phase 5 check (controller, not a subagent step)** — the controller runs `npm run build`, serves the app, and checks in Chrome, in dark and light (OS setting) and at 390 × 844 and 1024 × 768: Builder (header, palette, canvas, inspector switches, run dialog, phone view-and-run), Runs canvas (edge and loop states), Graph (settle on load, drag springs, hover hops 1–3, double-click glide, search pulse and fly, type filter fade and re-settle, Fit, Re-run, ticker after a real run finishes, reader tags and Connected, All notes keyboard), with the OS "reduce motion" setting on and off. No violet, no blue primary, no grey skeleton, no contrast failure. Fix findings before Phase 6.

---

## Phase 6 — Crew (with the Evolve drawer), Triggers, Team panel parity, and the `.studio` removal

### Task 9: Crew editor parts — bot editor and "Runs on"

**Files:**
- Create: `web/src/crew/types.ts`, `web/src/crew/BotEditor.tsx`, `web/src/crew/RunsOn.tsx`
- Test: `web/src/crew/BotEditor.test.tsx`, `web/src/crew/RunsOn.test.tsx`

**Interfaces:**
- Consumes: `BotDef`, `FaceLook` (`web/src/crewStore.ts`), `Face`, Arc `Slider` (`label`, `min`, `max`, `step`, `value`, `format?`, `onValueChange`), `Input`, `Select`, `Textarea`, `Switch`, `Button`, `SectionHeading`, `StatusChip`, `NONE`/`fromNone`.
- Produces:
  - `web/src/crew/types.ts`: `Pack`, `Ecc`, `Meta`, `ImportReply`, `Filter = 'all' | 'builtin' | 'custom' | 'ecc'`, `AgentInfo`, `Row`, `CrewReply`, `Binding = { agent: string; model: string }`, `isEcc(b?: BotDef): boolean`, `sourceOf(b?: BotDef): Exclude<Filter, 'all'>`, `DEFAULT_HUE = 200` (same shapes as today's locals in `Crew.tsx`).
  - `BotEditor(p: { bot: BotDef; isNew: boolean; kinds: { kind: string; blurb: string }[]; personaLoad: 'ok' | 'loading' | 'failed'; onPatch(b: Partial<BotDef>): void; onFace(f: Partial<FaceLook>): void; onResetFace(): void; onPersona(text: string): void; onSave(): void; onCancel(): void; onRemove(): void })` — a region named `Edit <name>` (or `New bot`): face preview (`<name> preview`), Hue and Tone sliders, Reset to generated, Name, Kind (locked for built-ins), Title, Persona (read-only while the full text loads; limits 600, ECC 24000), a "read-only (may not edit files)" switch for custom agent bots, Save / Cancel / Remove or Reset to original.
  - `RunsOn(p: { row: Row; agents: Record<string, AgentInfo>; draft: Binding; dirty: boolean; onChange(b: Partial<Binding>): void; onSave(): void; onUnlink(): void })` — a region named "Runs on": Agent select (`default (claude)` = no link; "(not available)" marks), Model with suggestions, "Save agent" (only when changed), Unlink (only when linked); an approval bot says a person signs off; an "agent not available" chip when the chosen agent is not installed.
  - The face swatch list and `blank()` stay in `Crew.tsx` (the rules test allows the violet swatch only there).

- [ ] **Step 1: Write the failing tests**

`web/src/crew/BotEditor.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BotDef } from '../crewStore';
import { BotEditor } from './BotEditor';

const look = { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#3fb97c', accent: 'auto' };
const bolt: BotDef = { id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: 'Writes the change', look, builtin: true };
const kinds = [{ kind: 'agent', blurb: 'does a job' }, { kind: 'verdict', blurb: 'passes or fails' }];
const handlers = () => ({ onPatch: vi.fn(), onFace: vi.fn(), onResetFace: vi.fn(), onPersona: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onRemove: vi.fn() });

describe('BotEditor', () => {
  it('edits the look and fields of a built-in bot, with its kind locked', () => {
    const h = handlers();
    render(<BotEditor bot={bolt} isNew={false} kinds={kinds} personaLoad="ok" {...h} />);
    expect(screen.getByRole('region', { name: 'Edit Bolt' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Bolt preview' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('slider', { name: /Hue/ }), { key: 'ArrowRight' });
    expect(h.onFace).toHaveBeenCalledWith({ hue: expect.any(Number) });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'builder' } });
    expect(h.onPatch).toHaveBeenCalledWith({ title: 'builder' });
    expect((screen.getByRole('combobox', { name: /Kind/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('switch', { name: /read-only/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset to original' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect([h.onSave, h.onCancel].map((f) => f.mock.calls.length)).toEqual([1, 1]);
  });

  it('offers Reset to original for an edited built-in and Remove for your own bot', () => {
    const h = handlers();
    const { rerender } = render(<BotEditor bot={{ ...bolt, edited: true }} isNew={false} kinds={kinds} personaLoad="ok" {...h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to original' }));
    expect(h.onRemove).toHaveBeenCalledTimes(1);
    rerender(<BotEditor bot={{ ...bolt, id: 'quill', name: 'Quill', builtin: false }} isNew={false} kinds={kinds} personaLoad="ok" {...h} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'read-only (may not edit files)' }));
    expect(h.onPatch).toHaveBeenCalledWith({ readOnly: true });
  });

  it('keeps the persona read-only until the full text loads, and says why', () => {
    const h = handlers();
    const ecc = { ...bolt, id: 'go-reviewer', name: 'Go Reviewer', builtin: false, source: 'ecc@v2.2.3' };
    const { rerender } = render(<BotEditor bot={ecc} isNew={false} kinds={kinds} personaLoad="loading" {...h} />);
    const persona = screen.getByLabelText(/Persona/) as HTMLTextAreaElement;
    expect(persona.readOnly).toBe(true);
    expect(screen.getByText('Loading the full persona…')).toBeTruthy();
    fireEvent.change(persona, { target: { value: 'lost' } });
    expect(h.onPersona).not.toHaveBeenCalled();
    rerender(<BotEditor bot={ecc} isNew={false} kinds={kinds} personaLoad="failed" {...h} />);
    expect(screen.getByText('Showing the first 2000 characters; edits are disabled until the full text loads')).toBeTruthy();
    rerender(<BotEditor bot={ecc} isNew={false} kinds={kinds} personaLoad="ok" {...h} />);
    expect(screen.getByText('From ECC; an update replaces your edits')).toBeTruthy();
    expect(persona.maxLength).toBe(24000);
    fireEvent.change(persona, { target: { value: 'Be brief.' } });
    expect(h.onPersona).toHaveBeenCalledWith('Be brief.');
  });

  it('names a new bot "New bot" and offers no Remove', () => {
    render(<BotEditor bot={{ ...bolt, id: '', name: '', builtin: false }} isNew kinds={kinds} personaLoad="ok" {...handlers()} />);
    expect(screen.getByRole('region', { name: 'New bot' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'New bot preview' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});
```

`web/src/crew/RunsOn.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunsOn } from './RunsOn';

const agents = { claude: { ok: true, models: ['opus'] }, codex: { ok: false, models: [] } };
const row = (o = {}) => ({ role: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', binding: null, ...o });
const h = () => ({ onChange: vi.fn(), onSave: vi.fn(), onUnlink: vi.fn() });

describe('RunsOn', () => {
  it('saves only a changed link and suggests the agent’s models', () => {
    const fns = h();
    const { rerender, container } = render(<RunsOn row={row()} agents={agents} draft={{ agent: 'claude', model: '' }} dirty={false} {...fns} />);
    expect(screen.getByRole('region', { name: 'Runs on' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save agent' }) as HTMLButtonElement).disabled).toBe(true);
    expect([...container.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))).toEqual(['opus']);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
    expect(fns.onChange).toHaveBeenCalledWith({ model: 'opus' });
    rerender(<RunsOn row={row()} agents={agents} draft={{ agent: 'claude', model: 'opus' }} dirty {...fns} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(fns.onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
  });

  it('unlinks a linked bot and marks an agent that is not installed', () => {
    const fns = h();
    render(<RunsOn row={row({ binding: { agent: 'codex' } })} agents={agents} draft={{ agent: 'codex', model: '' }} dirty={false} {...fns} />);
    expect(screen.getByText('agent not available')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(fns.onUnlink).toHaveBeenCalledTimes(1);
  });

  it('has nothing to link for an approval bot', () => {
    render(<RunsOn row={row({ kind: 'approval' })} agents={agents} draft={{ agent: '', model: '' }} dirty={false} {...h()} />);
    expect(screen.getByText('A person signs off here. Nothing to link.')).toBeTruthy();
    expect(screen.queryByLabelText('Model')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/crew`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Create `web/src/crew/types.ts`**

```ts
import type { BotDef } from '../crewStore';

export interface Pack { id: string; name: string; blurb: string; bots: BotDef[] }
export interface Ecc { ref: string; at: string }
export interface Meta { kinds: { kind: string; blurb: string }[]; packs: Pack[]; ecc: Ecc | null; eccDefault: string }
export interface ImportReply { ref: string; added: string[]; updated: string[]; removed: string[]; skipped: string[]; notes: string[]; skills: number; commands: number }
export type Filter = 'all' | 'builtin' | 'custom' | 'ecc';
export interface AgentInfo { ok: boolean; version?: string; detail?: string; models: string[] }
export interface Row { role: string; name: string; title: string; kind: string; binding: { agent: string; model?: string } | null }
export type CrewReply = { bots: BotDef[]; packs: Pack[]; kinds: { kind: string; blurb: string }[]; evolve?: Record<string, { version: number; open: number }>; ecc?: Ecc | null; eccDefault?: string };
/** The agent and model a bot runs on; an empty agent means "default (claude)", i.e. no link. */
export type Binding = { agent: string; model: string };

export const isEcc = (b?: BotDef) => !!b?.source?.startsWith('ecc@');
export const sourceOf = (b?: BotDef): Exclude<Filter, 'all'> => (isEcc(b) ? 'ecc' : b?.builtin ? 'builtin' : 'custom');
/** The hue the slider shows before it is moved; not saved until then. */
export const DEFAULT_HUE = 200;
```

- [ ] **Step 4: Create `web/src/crew/BotEditor.tsx`**

```tsx
import { Button } from '../components/arc/button/button';
import { Input } from '../components/arc/input/input';
import { Select } from '../components/arc/select/select';
import { Slider } from '../components/arc/slider/slider';
import { Switch } from '../components/arc/switch/switch';
import { Textarea } from '../components/arc/textarea/textarea';
import type { BotDef, FaceLook } from '../crewStore';
import { Face } from '../Face';
import { DEFAULT_HUE, isEcc } from './types';

/** A bot's look and words. Controlled: the Crew screen owns the draft and the persona loading. */
export function BotEditor(p: {
  bot: BotDef;
  isNew: boolean;
  kinds: { kind: string; blurb: string }[];
  personaLoad: 'ok' | 'loading' | 'failed';
  onPatch: (b: Partial<BotDef>) => void;
  onFace: (f: Partial<FaceLook>) => void;
  onResetFace: () => void;
  onPersona: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const b = p.bot;
  const name = b.name || 'New bot';
  const source = p.isNew ? 'new' : isEcc(b) ? (b.source ?? 'ECC') : b.builtin ? 'built-in' : 'yours';
  return (
    <section className="cw-editor" aria-label={p.isNew ? 'New bot' : `Edit ${b.name}`}>
      <div className="cw-editor-head">
        <Face id={b.id || 'new-bot'} face={b.look.face ?? {}} size={72} animate="hover" label={`${name} preview`} />
        <div>
          <h2>{name}</h2>
          <p className="sl-meta">
            {source} · {b.kind}
          </p>
        </div>
      </div>
      <Slider label="Hue" min={0} max={359} step={1} value={b.look.face?.hue ?? DEFAULT_HUE} onValueChange={(v) => p.onFace({ hue: v })} />
      <Slider label="Tone" min={0} max={1} step={0.05} value={b.look.face?.tone ?? 0.5} format={(v) => v.toFixed(2)} onValueChange={(v) => p.onFace({ tone: v })} />
      <div>
        <Button variant="ghost" size="sm" disabled={!b.look.face} onClick={p.onResetFace}>
          Reset to generated
        </Button>
      </div>
      <div className="cw-pair">
        <Input label="Name" value={b.name} maxLength={24} onChange={(e) => p.onPatch({ name: e.target.value })} />
        <Select
          label="Kind"
          options={p.kinds.map((k) => ({ value: k.kind, label: `${k.kind}: ${k.blurb}` }))}
          value={b.kind}
          disabled={!p.isNew && !!b.builtin}
          onValueChange={(v) => p.onPatch({ kind: v })}
        />
      </div>
      <Input label="Title" value={b.title} maxLength={28} placeholder="what it is" onChange={(e) => p.onPatch({ title: e.target.value })} />
      <Textarea
        label="Persona (becomes this bot's instructions)"
        rows={5}
        maxLength={isEcc(b) ? 24000 : 600}
        value={b.persona}
        readOnly={p.personaLoad !== 'ok'}
        aria-busy={p.personaLoad === 'loading' || undefined}
        description={
          p.personaLoad === 'loading'
            ? 'Loading the full persona…'
            : p.personaLoad === 'failed'
              ? 'Showing the first 2000 characters; edits are disabled until the full text loads'
              : isEcc(b)
                ? 'From ECC; an update replaces your edits'
                : undefined
        }
        onChange={(e) => p.personaLoad === 'ok' && p.onPersona(e.target.value)}
      />
      {b.kind === 'agent' && !b.builtin ? <Switch label="read-only (may not edit files)" checked={!!b.readOnly} onCheckedChange={(c) => p.onPatch({ readOnly: c })} /> : null}
      <div className="cw-actions">
        <Button variant="primary" disabled={!b.name.trim()} onClick={p.onSave}>
          Save
        </Button>
        <Button variant="secondary" onClick={p.onCancel}>
          Cancel
        </Button>
        {!p.isNew && (!b.builtin || b.edited) ? (
          <Button variant="secondary" onClick={p.onRemove}>
            {b.builtin ? 'Reset to original' : 'Remove'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create `web/src/crew/RunsOn.tsx`**

```tsx
import { useId } from 'react';
import { Button } from '../components/arc/button/button';
import { Input } from '../components/arc/input/input';
import { Select } from '../components/arc/select/select';
import { NONE, fromNone } from '../ui/cn';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { StatusChip } from '../ui/studio/StatusChip';
import type { AgentInfo, Binding, Row } from './types';

/** Which agent and model a bot runs on. A step with no agent of its own follows its bot. */
export function RunsOn(p: { row: Row; agents: Record<string, AgentInfo>; draft: Binding; dirty: boolean; onChange: (b: Partial<Binding>) => void; onSave: () => void; onUnlink: () => void }) {
  const id = useId();
  if (p.row.kind === 'approval')
    return (
      <section className="cw-runs-on" aria-labelledby={id}>
        <SectionHeading id={id} title="Runs on" />
        <p className="sl-meta">A person signs off here. Nothing to link.</p>
      </section>
    );
  const chosen = p.agents[p.draft.agent];
  return (
    <section className="cw-runs-on" aria-labelledby={id}>
      <SectionHeading id={id} title="Runs on" action={chosen && !chosen.ok ? <StatusChip tone="needs" label="agent not available" /> : undefined} />
      <p className="sl-meta">A step with no agent of its own follows its bot; a step that names one keeps it. Changes apply to the next run you start.</p>
      <div className="cw-pair">
        <Select
          label="Agent"
          options={[{ value: NONE, label: 'default (claude)' }, ...Object.keys(p.agents).map((a) => ({ value: a, label: a + (p.agents[a]!.ok ? '' : ' (not available)') }))]}
          value={p.draft.agent || NONE}
          onValueChange={(v) => p.onChange({ agent: fromNone(v), model: '' })}
        />
        <Input label="Model" list={`models-${p.row.role}`} value={p.draft.model} placeholder="adapter default" spellCheck={false} onChange={(e) => p.onChange({ model: e.target.value })} />
      </div>
      <datalist id={`models-${p.row.role}`}>
        {(chosen?.models ?? []).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="cw-actions">
        <Button variant="secondary" size="sm" disabled={!p.dirty} onClick={p.onSave}>
          Save agent
        </Button>
        {p.row.binding ? (
          <Button variant="ghost" size="sm" onClick={p.onUnlink}>
            Unlink
          </Button>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --project web web/src/crew && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/crew
git commit -m "feat(web): Crew bot editor and Runs on parts on Studio parts"
```

---

### Task 10: Crew screen — header, source filter, search, cards, side editor and deep link

**Files:**
- Create: `web/src/crew/CrewCard.tsx`, `web/src/crew/crew.css`
- Modify: `web/src/Crew.tsx` (full rewrite), `web/src/App.tsx` (Crew props), `web/src/styles.css`
- Test: `web/src/Crew.test.tsx`, `web/src/App.test.tsx`

**Interfaces:**
- Consumes: `BotEditor`, `RunsOn`, `types.ts` (Task 9); `EvolvePanel` (unchanged props: `bot`, `name`, `onClose`, `onChange?`, `inDrawer?`); `ScreenHeader`, `SectionHeading`, `EmptyState`, `InlineError`, `StatusChip`, `useMediaQuery`/`PHONE`; Arc `Tabs`, `SearchField`, `Drawer`/`DrawerContent`/`useDrawerItem`, `Dialog`/`DialogContent`, `ConfirmButton`.
- Produces:
  - `Crew(props: { bot?: string; onBot?: (id?: string) => void })`. App passes `bot={screen.id}` and maps `onBot` to `#/crew/<id>` / `#/crew`.
  - `CrewCard(p: { row: Row; def?: BotDef; evo?: { version: number; open: number }; agentMissing: boolean; selected: boolean; onPick: () => void })` — a button named `Edit <name>` with `aria-pressed`.
  - Page: header meta `crew · <n> built-in · <n> yours[ · <n> from ECC <ref>]`, actions Find a bot, Crew packs, Evolve (for the selected agent or verdict bot), Import ECC… / Update ECC…, Remove ECC (confirm), + New bot (ink); tabs All / Built-in / Yours / ECC with counts; a card grid; an "Edit bot" side panel at 900 px and wider (a drawer below); the Discard dialog "Discard your changes to <name>?" when switching with unsaved edits; Crew packs; the local-models note; `No bot called “<id>”.` for a stale deep link.

- [ ] **Step 1: Update the existing tests and add the new ones** — in `web/src/Crew.test.tsx`:

In `'saves a link only when changed; …'` replace the first three lines of the body with:

```tsx
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Bolt/ }));
    const save = screen.getByRole('button', { name: 'Save agent' }) as HTMLButtonElement;
```

In `'shows a load failure inline and retries'` replace the last line with `expect(await screen.findByRole('button', { name: /Edit Bolt/ })).toBeTruthy();`.

Add a helper under `const routes = { … };`:

```tsx
const goBot = { id: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', persona: '', look, source: 'ecc@v2.2.3', whenToUse: 'Use for Go' };
const twoBots = () =>
  routeApi({
    ...routes,
    'GET /api/crew': { ...crewReply, bots: [...crewReply.bots, goBot], ecc: { ref: 'v2.2.3', at: '2026-10-24T00:00:00Z' } },
    'GET /api/bots': { ...botsReply, crew: [...botsReply.crew, { role: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', binding: null }] },
  });
```

and append inside `describe('Crew', …)`:

```tsx
  it('counts the crew in the header and opens Evolve for the selected bot', async () => {
    routeApi({
      ...routes,
      'GET /api/harness/coder': { bot: 'coder', evolvable: true, current: { version: 1, persona: 'Writes code', guidance: [], skills: [] }, versions: [{ version: 1, at: '2026-10-20T10:00:00Z' }], total: 1 },
      'GET /api/proposals': { proposals: [] },
      'GET /api/lessons': { lessons: [] },
    });
    const onBot = vi.fn();
    renderApp(<Crew onBot={onBot} />);
    expect(await screen.findByText('crew · 1 built-in · 0 yours')).toBeTruthy();
    const evolve = screen.getByRole('button', { name: 'Evolve' }) as HTMLButtonElement;
    expect(evolve.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Edit Bolt/ }));
    expect(onBot).toHaveBeenCalledWith('coder');
    expect(screen.getByRole('button', { name: /Edit Bolt/ }).getAttribute('aria-pressed')).toBe('true');
    expect(evolve.disabled).toBe(false);
    fireEvent.click(evolve);
    expect(await screen.findByRole('region', { name: 'Evolve Bolt' })).toBeTruthy();
  });

  it('finds bots by name or when-to-use', async () => {
    twoBots();
    renderApp(<Crew />);
    await screen.findByRole('button', { name: /Edit Go Reviewer/ });
    fireEvent.change(screen.getByLabelText('Find a bot'), { target: { value: 'use for go' } });
    expect(screen.queryByRole('button', { name: /Edit Bolt/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Edit Go Reviewer/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find a bot'), { target: { value: 'zzz' } });
    expect(screen.getByText('No bots match')).toBeTruthy();
  });

  it('asks before switching bots with unsaved edits', async () => {
    twoBots();
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Bolt/ }));
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: /Edit Go Reviewer/ }));
    expect(await screen.findByText('Discard your changes to Bolt?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('changed');
    fireEvent.click(await screen.findByRole('button', { name: /Edit Go Reviewer/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Go Reviewer'));
  });

  it('opens the bot a deep link names and says so when there is none', async () => {
    const { unmount } = renderApp(<Crew bot="coder" onBot={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Bolt'));
    unmount();
    renderApp(<Crew bot="ghost" onBot={() => {}} />);
    expect(await screen.findByText('No bot called “ghost”.')).toBeTruthy();
  });
```

In `web/src/App.test.tsx` change the Crew mock to `vi.mock('./Crew', () => ({ Crew: (p: { bot?: string }) => <div>crew screen {p.bot ?? ''}</div> }));` and append inside `describe('App shell', …)`:

```tsx
  it('hands the bot in the hash to Crew', () => {
    startAt('#/crew/coder');
    render(<App />);
    expect(screen.getByText('crew screen coder')).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/Crew.test.tsx web/src/App.test.tsx`
Expected: FAIL — no "Save agent", no header meta, no "Find a bot", no Discard dialog, App does not pass the bot.

- [ ] **Step 3: Create `web/src/crew/CrewCard.tsx`**

```tsx
import { useId } from 'react';
import type { BotDef } from '../crewStore';
import { Face } from '../Face';
import { cn } from '../ui/cn';
import { StatusChip } from '../ui/studio/StatusChip';
import { isEcc, type Row } from './types';

/** One bot in the grid. A click opens it in the editor; the chips say what it is and what waits for you. */
export function CrewCard(p: { row: Row; def?: BotDef; evo?: { version: number; open: number }; agentMissing: boolean; selected: boolean; onPick: () => void }) {
  const d = p.def;
  const desc = useId();
  const when = d?.whenToUse || d?.persona || (p.row.kind === 'approval' ? 'A person signs off here.' : '');
  return (
    <button type="button" className={cn('cw-card', { on: p.selected })} aria-label={`Edit ${p.row.name}`} aria-describedby={desc} aria-pressed={p.selected} onClick={p.onPick}>
      <span className="cw-card-head">
        <Face id={p.row.role} size={48} animate="hover" />
        <span className="cw-card-names">
          <span className="cw-card-name">{p.row.name}</span>
          <span className="cw-card-title">{p.row.title}</span>
        </span>
      </span>
      <span className="cw-card-when" id={desc}>
        {when}
      </span>
      <span className="cw-chips">
        <span className="cw-chip mono">{p.row.kind}</span>
        <span className="cw-chip mono" title={d?.source}>
          {isEcc(d) ? 'ECC' : d?.builtin ? 'built-in' : 'yours'}
        </span>
        {d?.readOnly ? <span className="cw-chip outline">read-only</span> : null}
        {p.row.kind !== 'approval' && p.evo ? (
          <span className="cw-chip mono" title="Harness version: persona, guidance and skills">
            v{p.evo.version}
          </span>
        ) : null}
        {p.row.kind !== 'approval' && p.evo?.open ? <StatusChip tone="needs" label="proposal" /> : null}
        {p.agentMissing ? <StatusChip tone="needs" label="agent not available" /> : null}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Create `web/src/crew/crew.css`**

```css
/* Crew (Studio Live board): a card grid with a side editor. Tokens only. */
.cw-page { height: 100%; overflow: auto; display: flex; flex-direction: column; }
.cw-page > .sl-screen-header { border-bottom: 1px solid var(--line); }
.cw-body { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 340px; min-height: 0; }
.cw-main { min-width: 0; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
.cw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; align-content: start; }
.cw-card {
  display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; border: 1px solid var(--line); background: var(--s1);
  color: var(--ink); font: inherit; text-align: left; cursor: pointer;
  transition: transform var(--t-med) var(--ease), border-color var(--t-med) var(--ease), box-shadow var(--t-med) var(--ease);
}
.cw-card:hover { transform: translateY(-2px); border-color: var(--line2); }
.cw-card.on { border-color: var(--acc); box-shadow: 0 0 0 3px var(--accBg); }
.cw-card-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cw-card-head .face { flex: none; border-radius: 14px; }
.cw-card-names { display: flex; flex-direction: column; min-width: 0; }
.cw-card-name { font-weight: 600; }
.cw-card-title { font-size: 12.5px; color: var(--mut); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cw-card-when { font-size: 12.5px; line-height: 1.45; color: var(--mut); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cw-chip { font-size: 11px; line-height: 18px; padding: 0 7px; border-radius: 6px; background: var(--s2); color: var(--mut); white-space: nowrap; }
.cw-chip.mono { font-family: var(--font-code); }
.cw-chip.outline { background: transparent; border: 1px solid var(--line2); }
.cw-side { border-left: 1px solid var(--line); background: var(--s1); padding: 20px; display: flex; flex-direction: column; gap: 20px; overflow: auto; }
.cw-side-empty { margin: 0; color: var(--mut); }
.cw-editor, .cw-runs-on { display: flex; flex-direction: column; gap: 12px; }
.cw-runs-on { padding-top: 16px; border-top: 1px solid var(--line); }
.cw-editor-head { display: flex; align-items: center; gap: 14px; }
.cw-editor-head h2 { margin: 0; font-size: 18px; font-weight: 600; color: var(--ink); }
.cw-editor-head .face { border-radius: 20px; }
.cw-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cw-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.cw-packs { display: flex; flex-direction: column; gap: 10px; }
.cw-pack-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.cw-pack { display: flex; flex-direction: column; gap: 10px; }
.cw-pack h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--ink); }
.cw-pack p { margin: 0; }
.cw-pack-faces { display: flex; flex-wrap: wrap; gap: 4px; }
@media (max-width: 1199px) { .cw-body { grid-template-columns: minmax(0, 1fr) 300px; } }
@media (max-width: 899px) {
  .cw-body { grid-template-columns: minmax(0, 1fr); }
  .cw-main { padding: 16px; }
  .cw-pair { grid-template-columns: 1fr; }
}
```

- [ ] **Step 5: Rewrite `web/src/Crew.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Button } from './components/arc/button/button';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { Drawer, DrawerContent, useDrawerItem } from './components/arc/drawer/drawer';
import { SearchField } from './components/arc/search-field/search-field';
import { Tabs, TabsList, TabsTrigger } from './components/arc/tabs/tabs';
import { Loading } from './components/Loading';
import { BotEditor } from './crew/BotEditor';
import { CrewCard } from './crew/CrewCard';
import { RunsOn } from './crew/RunsOn';
import { isEcc, sourceOf, type AgentInfo, type Binding, type CrewReply, type Filter, type ImportReply, type Meta, type Pack, type Row } from './crew/types';
import { applyCrew, loadCrewDefs, type BotDef, type FaceLook } from './crewStore';
import { EvolvePanel } from './Evolve';
import { Face } from './Face';
import { ConfirmButton } from './ui/ConfirmButton';
import { useNotify } from './ui/notify';
import { EmptyState } from './ui/studio/EmptyState';
import { InlineError } from './ui/studio/InlineError';
import { ScreenHeader } from './ui/studio/ScreenHeader';
import { SectionHeading } from './ui/studio/SectionHeading';
import { PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
import './crew/crew.css';

/** Face colours for a new bot. Faces are identity art, exempt from the no-purple rule (see rules.test.ts). */
const SWATCH = ['#5b9dff', '#38c5d6', '#6ee7a8', '#f2c14e', '#ff8a5b', '#ff6b8a', '#b58bff', '#c9a46a'];
const blank = (): BotDef => ({ id: '', name: '', title: '', kind: 'agent', persona: '', look: { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: SWATCH[Math.floor(Math.random() * SWATCH.length)]!, accent: 'auto' } });
const slug = (n: string) => (n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 20) || 'bot');
const NO_BINDING: Binding = { agent: '', model: '' };

export function Crew(props: { bot?: string; onBot?: (id?: string) => void }) {
  const notify = useNotify();
  const phone = useMediaQuery(PHONE);
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [draft, setDraft] = useState<Record<string, Binding>>({});
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [meta, setMeta] = useState<Meta>({ kinds: [], packs: [], ecc: null, eccDefault: '' });
  const [defs, setDefs] = useState<BotDef[]>([]);
  const [edit, setEdit] = useState<BotDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  // an imported bot's persona arrives truncated; once edited, the server must take the new one
  const [personaEdited, setPersonaEdited] = useState(false);
  // a truncated persona is replaced by the full one from GET /api/crew/:id; until then it cannot be edited
  const [personaLoad, setPersonaLoad] = useState<'ok' | 'loading' | 'failed'>('ok');
  const opening = useRef(0);
  /** The editor's draft as opened, to tell unsaved edits apart. */
  const base = useRef('');
  const [sel, setSel] = useState<string>();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [importing, setImporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [evo, setEvo] = useState<Record<string, { version: number; open: number }>>({});
  const [evolving, setEvolving] = useState<Row | null>(null);
  const [pending, setPending] = useState<null | (() => void)>(null);
  // the drawers keep showing their last item while they slide out
  const shown = useDrawerItem(edit);
  const evolveShown = useDrawerItem(evolving);
  const dirty = !!edit && JSON.stringify(edit) !== base.current;

  const patch = (p: Partial<BotDef>) => edit && setEdit({ ...edit, ...p });
  const patchFace = (p: Partial<FaceLook>) => edit && patch({ look: { ...edit.look, face: { ...edit.look.face, ...p } } });
  const resetFace = () => {
    if (!edit) return;
    const { face: _drop, ...rest } = edit.look;
    patch({ look: rest });
  };
  const open = (b: BotDef, fresh = false) => {
    const token = ++opening.current;
    const copy = JSON.parse(JSON.stringify(b)) as BotDef;
    base.current = JSON.stringify(copy);
    setEdit(copy);
    setIsNew(fresh);
    setPersonaEdited(false);
    setPersonaLoad(b.personaTruncated && b.id ? 'loading' : 'ok');
    if (!b.personaTruncated || !b.id) return;
    api<BotDef>('GET', `/api/crew/${b.id}`).then(
      (full) => {
        if (opening.current !== token) return; // another bot was opened meanwhile
        // only the persona comes from the full bot, so edits made while it loaded are kept
        const withFull = (x: BotDef): BotDef => {
          const { personaTruncated: _cut, ...rest } = x;
          return { ...rest, persona: full.persona };
        };
        base.current = JSON.stringify(withFull(JSON.parse(base.current) as BotDef));
        setEdit((cur) => (cur && cur.id === b.id ? withFull(cur) : cur));
        setPersonaLoad('ok');
      },
      () => opening.current === token && setPersonaLoad('failed'),
    );
  };

  const loadDefs = useCallback(async () => {
    const r = await api<CrewReply>('GET', '/api/crew');
    setEvo(r.evolve ?? {});
    applyCrew(r.bots);
    setDefs(r.bots);
    setMeta({ kinds: r.kinds, packs: r.packs, ecc: r.ecc ?? null, eccDefault: r.eccDefault ?? '' });
    return r.bots;
  }, []);

  const load = useCallback(async (): Promise<BotDef[] | undefined> => {
    try {
      const bots = await loadDefs();
      const r = await api<{ crew: Row[]; agents: Record<string, AgentInfo> }>('GET', '/api/bots');
      setRows(r.crew);
      setAgents(r.agents);
      setDraft(Object.fromEntries(r.crew.map((c) => [c.role, { agent: c.binding?.agent ?? '', model: c.binding?.model ?? '' }])));
      setLoadErr('');
      return bots;
    } catch (e) {
      // a load failure shows inline with a retry; action failures are toasts
      setLoadErr((e as Error).message);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [loadDefs]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Run `fn` now, or after the person agrees to drop the editor's unsaved edits. */
  const guard = (fn: () => void) => (dirty ? setPending(() => fn) : fn());
  const pick = (role: string) => {
    if (role === sel && edit && !isNew) return;
    guard(() => {
      const d = defs.find((x) => x.id === role);
      if (!d) return;
      setSel(role);
      open(d);
      props.onBot?.(role);
    });
  };
  const newBot = () =>
    guard(() => {
      setSel(undefined);
      open(blank(), true);
      props.onBot?.(undefined);
    });
  const cancelEdit = () => {
    const d = !isNew && sel ? defs.find((x) => x.id === sel) : undefined;
    if (d) open(d);
    else setEdit(null);
  };
  const closeDrawer = () =>
    guard(() => {
      setEdit(null);
      setSel(undefined);
      props.onBot?.(undefined);
    });

  // the deep link (#/crew/<bot>) opens that bot once the crew has loaded
  useEffect(() => {
    if (!props.bot || loading || props.bot === sel) return;
    const d = defs.find((x) => x.id === props.bot);
    if (d) {
      setSel(d.id);
      open(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bot, loading]);
  const missing = props.bot && !loading && !loadErr && !defs.some((d) => d.id === props.bot) ? props.bot : undefined;

  async function importEcc() {
    if (importBusy) return;
    setImportBusy(true);
    try {
      const d = await api<ImportReply>('POST', '/api/crew/import', { source: 'ecc' });
      notify.ok(`ECC ${d.ref}: ${d.added.length} added, ${d.updated.length} updated, ${d.removed.length} removed`);
      setImporting(false);
      await Promise.all([load(), loadCrewDefs(true)]);
    } catch (e) {
      notify.fail(e);
    } finally {
      setImportBusy(false);
    }
  }
  async function removeEcc() {
    try {
      const d = await api<{ removed: string[] }>('DELETE', '/api/crew?source=ecc');
      notify.ok(`Removed ${d.removed.length} ECC bots`);
      await Promise.all([load(), loadCrewDefs(true)]);
    } catch (e) {
      notify.fail(e);
    }
  }
  async function saveEdit() {
    if (!edit) return;
    // an edited persona replaces the saved one; an untouched truncated one tells the server to keep its copy
    const { personaTruncated, ...rest } = edit;
    const b: BotDef = personaEdited || personaTruncated === undefined ? rest : { ...rest, personaTruncated };
    const id = isNew ? slug(b.name) : b.id;
    const taken = new Set(defs.map((d) => d.id));
    let use = id;
    if (isNew) for (let i = 2; taken.has(use); i++) use = `${id.slice(0, 20)}${i}`;
    try {
      await api('PUT', `/api/crew/${use}`, { ...b, id: use });
      notify.ok(`${b.name} saved`);
      const saved = (await load())?.find((d) => d.id === use);
      if (saved) {
        setSel(use);
        open(saved);
        props.onBot?.(use);
      } else setEdit(null);
    } catch (e) {
      notify.fail(e);
    }
  }
  async function removeDef(b: BotDef) {
    try {
      await api('DELETE', `/api/crew/${b.id}`);
      setEdit(null);
      setSel(undefined);
      props.onBot?.(undefined);
      notify.ok(b.builtin ? `${b.name} reset to its original look` : `${b.name} removed`);
      await load();
    } catch (e) {
      notify.fail(e);
    }
  }
  async function addPack(k: Pack) {
    try {
      const r = await api<{ added: string[] }>('POST', `/api/crew/packs/${k.id}`);
      notify.ok(`${k.name}: added ${r.added.length} bots`);
      await load();
    } catch (e) {
      notify.fail(e);
    }
  }

  const setBinding = (role: string, p: Partial<Binding>) => setDraft((all) => ({ ...all, [role]: { ...(all[role] ?? NO_BINDING), ...p } }));
  const bindingDirty = (r: Row) => {
    const d = draft[r.role];
    return !!d && (d.agent !== (r.binding?.agent ?? '') || d.model !== (r.binding?.model ?? ''));
  };
  async function saveBinding(r: Row, d = draft[r.role] ?? NO_BINDING) {
    try {
      if (!d.agent) await api('DELETE', `/api/bots/${r.role}`);
      else await api('PUT', `/api/bots/${r.role}`, { agent: d.agent, model: d.model });
      notify.ok(d.agent ? `${r.name} → ${d.agent}${d.model ? ' · ' + d.model : ''}` : `${r.name} unlinked`);
      await load();
    } catch (e) {
      notify.fail(e);
    }
  }

  const defOf = (r: Row) => defs.find((d) => d.id === r.role);
  const counts: Record<Filter, number> = { all: rows.length, builtin: 0, custom: 0, ecc: 0 };
  for (const r of rows) counts[sourceOf(defOf(r))]++;
  const hasEcc = defs.some(isEcc);
  const view: Filter = filter === 'ecc' && !hasEcc ? 'all' : filter;
  const needle = q.trim().toLowerCase();
  const shownRows = rows
    .filter((r) => view === 'all' || sourceOf(defOf(r)) === view)
    .filter((r) => {
      if (!needle) return true;
      const d = defOf(r);
      return `${r.name} ${r.title} ${r.role} ${d?.whenToUse ?? ''} ${d?.persona ?? ''}`.toLowerCase().includes(needle);
    });
  const selRow = rows.find((r) => r.role === sel);
  const evolvable = !!selRow && (selRow.kind === 'agent' || selRow.kind === 'verdict');

  const editorFor = (b: BotDef) => (
    <>
      <BotEditor
        bot={b}
        isNew={isNew}
        kinds={meta.kinds}
        personaLoad={personaLoad}
        onPatch={patch}
        onFace={patchFace}
        onResetFace={resetFace}
        onPersona={(text) => {
          setPersonaEdited(true);
          patch({ persona: text });
        }}
        onSave={() => void saveEdit()}
        onCancel={cancelEdit}
        onRemove={() => void removeDef(b)}
      />
      {!isNew && selRow ? (
        <RunsOn
          row={selRow}
          agents={agents}
          draft={draft[selRow.role] ?? NO_BINDING}
          dirty={bindingDirty(selRow)}
          onChange={(p) => setBinding(selRow.role, p)}
          onSave={() => void saveBinding(selRow)}
          onUnlink={() => {
            setBinding(selRow.role, NO_BINDING);
            void saveBinding(selRow, NO_BINDING);
          }}
        />
      ) : null}
    </>
  );

  return (
    <div className="cw-page">
      <ScreenHeader
        meta={`crew · ${counts.builtin} built-in · ${counts.custom} yours${meta.ecc ? ` · ${counts.ecc} from ECC ${meta.ecc.ref}` : ''}`}
        title="Crew"
        summary="Each bot's look, persona and the agent it runs on. Changes apply to the next run you start."
        actions={
          <>
            <SearchField label="Find a bot" value={q} onValueChange={setQ} placeholder="Name or when to use" />
            <Button variant="secondary" onClick={() => document.getElementById('crew-packs')?.scrollIntoView({ block: 'start' })}>
              Crew packs
            </Button>
            <Button variant="secondary" disabled={!evolvable} title={evolvable ? 'Proposals, lessons and harness versions' : 'Select an agent or verdict bot'} onClick={() => selRow && setEvolving(selRow)}>
              Evolve
            </Button>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              {meta.ecc ? 'Update ECC…' : 'Import ECC…'}
            </Button>
            {meta.ecc ? <ConfirmButton label="Remove ECC" prompt="Remove every ECC bot and the vendored checkout?" confirmLabel="Remove" onConfirm={removeEcc} /> : null}
            <Button variant="primary" onClick={newBot}>
              + New bot
            </Button>
          </>
        }
      />
      {loadErr ? <InlineError message={loadErr} onRetry={() => void load()} /> : null}
      <Loading loading={loading} lines={6} label="Checking which agents are installed">
        {loadErr ? null : (
          <div className="cw-body">
            <div className="cw-main">
              <Tabs value={view} onValueChange={(v) => setFilter(v as Filter)}>
                <TabsList aria-label="Bot source">
                  <TabsTrigger value="all">{`All ${counts.all}`}</TabsTrigger>
                  <TabsTrigger value="builtin">{`Built-in ${counts.builtin}`}</TabsTrigger>
                  <TabsTrigger value="custom">{`Yours ${counts.custom}`}</TabsTrigger>
                  {hasEcc ? <TabsTrigger value="ecc">{`ECC ${counts.ecc}`}</TabsTrigger> : null}
                </TabsList>
              </Tabs>
              {missing ? (
                <p className="sl-note" role="status">
                  No bot called “{missing}”.
                </p>
              ) : null}
              {shownRows.length ? (
                <section className="cw-grid" aria-label="Bots">
                  {shownRows.map((r) => {
                    const b = r.binding ? agents[r.binding.agent] : undefined;
                    return <CrewCard key={r.role} row={r} def={defOf(r)} evo={evo[r.role]} agentMissing={!!b && !b.ok} selected={sel === r.role} onPick={() => pick(r.role)} />;
                  })}
                </section>
              ) : (
                <EmptyState title="No bots match" description="Try another name, or another source." />
              )}
              <section id="crew-packs" className="cw-packs" aria-labelledby="crew-packs-h">
                <SectionHeading id="crew-packs-h" title="Crew packs" count={meta.packs.length} />
                <div className="cw-pack-grid">
                  {meta.packs.map((k) => (
                    <div key={k.id} className="sl-panel cw-pack">
                      <h3>{k.name}</h3>
                      <p className="sl-summary">{k.blurb}</p>
                      <div className="cw-pack-faces">
                        {k.bots.map((b) => (
                          <span key={b.id} title={`${b.name}: ${b.persona}`}>
                            <Face id={b.id} size={34} label={b.name} />
                          </span>
                        ))}
                      </div>
                      <p className="sl-meta">{k.bots.map((b) => b.name).join(' · ')}</p>
                      <div>
                        <Button variant="secondary" size="sm" onClick={() => void addPack(k)}>
                          Add to my crew
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <p className="sl-meta">Local models (Ollama, LM Studio, llama.cpp) appear here when their server is running.</p>
            </div>
            {phone ? null : (
              <aside className="cw-side" aria-label="Edit bot">
                {edit ? editorFor(edit) : <p className="cw-side-empty">Select a bot to change its look, persona and agent, or add a new one.</p>}
              </aside>
            )}
          </div>
        )}
      </Loading>

      {phone ? (
        <Drawer open={!!edit} onOpenChange={(o) => !o && closeDrawer()}>
          <DrawerContent side="right" title={isNew ? 'New bot' : `Edit ${shown?.name ?? ''}`}>
            {shown ? <div className="cw-side">{editorFor(shown)}</div> : null}
          </DrawerContent>
        </Drawer>
      ) : null}

      <Drawer open={!!evolving} onOpenChange={(o) => !o && setEvolving(null)}>
        <DrawerContent side="right" title={`Evolve ${evolveShown?.name ?? ''}`}>
          {evolveShown ? <EvolvePanel key={evolveShown.role} inDrawer bot={evolveShown.role} name={evolveShown.name} onClose={() => setEvolving(null)} onChange={() => void loadDefs()} /> : null}
        </DrawerContent>
      </Drawer>

      <Dialog open={importing} onOpenChange={(o) => !importBusy && setImporting(o)}>
        <DialogContent
          title="Import ECC"
          description="Adds ECC's agents as crew bots and its skills and commands to the skills list. Hooks and rules are not imported. Source: github.com/affaan-m/ECC (MIT)."
        >
          <p className="sl-meta">{`Version ${meta.ecc?.ref ? `${meta.ecc.ref} → ` : ''}${meta.eccDefault}`}</p>
          <div className="cw-actions">
            <Button variant="secondary" disabled={importBusy} onClick={() => setImporting(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={importBusy} onClick={() => void importEcc()}>
              Import
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent title={`Discard your changes to ${edit?.name || 'the new bot'}?`} description="They are not saved.">
          <div className="cw-actions">
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const fn = pending;
                setPending(null);
                fn?.();
              }}
            >
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

The "shows the version change in the update dialog" test looks for the exact text `Version v2.2.3 → v2.2.3`; the `<p className="sl-meta">` keeps it.

- [ ] **Step 6: Wire the deep link in `web/src/App.tsx`** — replace `{screen.tab === 'crew' ? <Crew /> : null}` with:

```tsx
          {screen.tab === 'crew' ? <Crew bot={screen.id} onBot={(id) => go(id ? { tab: 'crew', id } : { tab: 'crew' })} /> : null}
```

- [ ] **Step 7: Move the crew rules out of `web/src/styles.css`**

Delete `.crew-page`, `.crew-head`, `.crew-head h2`, `.crew-head p`, `.crew-grid`, `.crew-card`, `.crew-main`, `.crew-main h4`, `.crew-main label`, `.sprite-btn`, `.sprite-btn:hover`, `.sprite-btn:focus-visible`, `.persona`, `.packs-h`, `.bot-editor`, `.bot-preview`, `.bot-preview > :not(.face)`, `.bot-fields`, `.bot-fields h3`, `.bot-fields label`, `.bot-fields textarea`, `.pack-sprites`, `.chip.proposal-mark`. In the face hover rules at the end of the file, replace `.sprite-btn:hover span.face .mo-root, .sprite-btn:focus-visible span.face .mo-root` with `.cw-card:hover span.face .mo-root, .cw-card:focus-visible span.face .mo-root`, and inside `@media not ((hover: hover) and (pointer: fine))` replace `.sprite-btn:hover span.face .mo-root:not(.mo-always)` with `.cw-card:hover span.face .mo-root:not(.mo-always)`. (`.triggers-page` still uses `.crew-head` until Task 13; if it does, keep `.crew-head`, `.crew-head h2`, `.crew-head p` and delete them in Task 13.)

- [ ] **Step 8: Run the tests**

Run: `npx vitest run --project web web/src/Crew.test.tsx web/src/crew web/src/App.test.tsx web/src/rules.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/Crew.tsx web/src/Crew.test.tsx web/src/crew web/src/App.tsx web/src/App.test.tsx web/src/styles.css
git commit -m "feat(web): Crew screen with a card grid, side editor, search, Evolve entry and deep links"
```

---

### Task 11: Evolve drawer on the Crew board's look

**Files:**
- Create: `web/src/evolve.css`
- Modify: `web/src/Evolve.tsx`, `web/src/styles.css` (delete the Evolve rules)
- Test: `web/src/Evolve.test.tsx`

**Interfaces:**
- Consumes: `StatusChip`, `SectionHeading`, Arc `Accordion`, `Checkbox`, `Button`, `ConfirmButton`, `cssRule`/`cssText`.
- Produces: `EvolvePanel` with the same props and every current function; the region stays `role="region"` named `Evolve <name>` with class `in-drawer` inside a drawer. Proposal labels and edit/probe/lesson states are `StatusChip`s: `open` → needs ("open"), `accepted` → done, `rejected` → failed, `superseded` → neutral; `stale` → needs; probe `kept` → done, `dropped` → failed, `unprobed` → needs; lesson `confident` → done, otherwise neutral. The status message is `.ev-msg` (`role="status"`).

- [ ] **Step 1: Write the failing tests** — add `import { cssRule, cssText } from './test/css';` and append to `web/src/Evolve.test.tsx`:

```tsx
it('shows proposal, probe and lesson states as status chips', async () => {
  routeApi({
    'GET /api/harness/coder': { ...harness, evolvable: false },
    'GET /api/proposals?bot=coder': { proposals: [proposal({ stale: true, edits: [{ ...edit(1), probe: 'dropped' }, { ...edit(2), probe: 'kept' }] })] },
    'GET /api/lessons?bot=coder': { lessons: [{ id: 'L1', text: 'Run the tests first', polarity: 'do', provenance: 'feedback', status: 'confident', runs: 3, evidence: [] }] },
  });
  const { container } = renderApp(<EvolvePanel bot="coder" name="Bolt" onClose={() => {}} />);
  expect(await screen.findByText('Run the tests first')).toBeTruthy();
  const chip = (label: string) => [...container.querySelectorAll('.sl-chip')].find((c) => c.textContent === label)!;
  expect(chip('open').classList.contains('t-needs')).toBe(true);
  expect(chip('stale').classList.contains('t-needs')).toBe(true);
  expect(chip('dropped by the probe').classList.contains('t-failed')).toBe(true);
  expect(chip('kept by the probe').classList.contains('t-done')).toBe(true);
  expect(chip('confident').classList.contains('t-done')).toBe(true);
  expect(chip('not evolvable')).toBeTruthy();
});

it('styles the drawer from tokens only', () => {
  expect(cssText('evolve.css').match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  expect(cssRule('evolve.css', '.ev-diff .del')).toContain('color: var(--bad)');
  expect(cssText('styles.css')).not.toMatch(/evolve-panel|probe-kept|proposal-mark/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/Evolve.test.tsx`
Expected: FAIL — labels are Arc badges, `evolve.css` missing.

- [ ] **Step 3: Create `web/src/evolve.css`**

```css
/* Evolve drawer (follows the Crew board): harness, proposals with picked edits, lessons. Tokens only. */
.ev-panel { display: flex; flex-direction: column; gap: 18px; padding: 16px; background: var(--s1); border: 1px solid var(--line); border-radius: var(--radius-panel); }
.ev-panel.in-drawer { padding: 0; border: 0; background: none; border-radius: 0; }
.ev-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ev-top h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--ink); }
.ev-msg { font-size: 12.5px; color: var(--mut); }
.ev-help { margin: 0; font-size: 12.5px; color: var(--mut); }
.ev-section { display: flex; flex-direction: column; gap: 10px; }
.ev-persona { margin: 0; font-size: 13px; color: var(--mut); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.ev-guidance { margin: 0; padding-left: 18px; font-size: 13px; }
.ev-versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.ev-versions li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ev-proposal { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-panel); background: var(--bg); }
.ev-proposal-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ev-edit { display: flex; flex-direction: column; gap: 6px; padding-left: 4px; }
.ev-edit-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ev-diff { margin: 0; padding: 8px 0; border-radius: 8px; background: var(--s2); font-family: var(--font-code); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.ev-diff span { display: block; padding: 0 10px; }
.ev-diff .del { color: var(--bad); background: var(--badBg); }
.ev-diff .add { color: var(--ok); background: var(--okBg); }
.ev-probe ul { margin: 6px 0 0; padding-left: 18px; }
.ev-lessons { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.ev-lessons li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.ev-actions { display: flex; flex-wrap: wrap; gap: 8px; }
```

- [ ] **Step 4: Restyle `web/src/Evolve.tsx`**

Imports: remove `Badge`; add

```tsx
import { SectionHeading } from './ui/studio/SectionHeading';
import { StatusChip, type Tone } from './ui/studio/StatusChip';
import './evolve.css';
```

Replace `LABEL_TONE` with:

```tsx
const LABEL_TONE: Record<string, Tone> = { open: 'needs', accepted: 'done', rejected: 'failed', superseded: 'neutral' };
const PROBE: Record<'kept' | 'dropped' | 'unprobed', { tone: Tone; label: (note?: string) => string }> = {
  kept: { tone: 'done', label: () => 'kept by the probe' },
  dropped: { tone: 'failed', label: () => 'dropped by the probe' },
  unprobed: { tone: 'needs', label: (note) => `not probed${note ? `: ${note}` : ''}` },
};
```

Replace the returned tree with:

```tsx
  return (
    <div className={cn('ev-panel', { 'in-drawer': !!props.inDrawer })} role="region" aria-label={`Evolve ${props.name}`}>
      <div className="ev-top">
        {props.inDrawer ? null : <h3>Evolve · {props.name}</h3>}
        <Button variant="ghost" size="sm" onClick={() => props.onClose()}>
          Close
        </Button>
        {msg ? (
          <span className="ev-msg" role="status">
            {msg}
          </span>
        ) : null}
      </div>
      <p className="ev-help">
        Proposals are made from the command line with <code>aorch evolve {props.bot}</code> (one model call). Here you review them: tick the edits you want, accept or reject. Nothing changes until you accept, and any
        version can be rolled back.
      </p>

      {h ? (
        <section className="ev-section">
          <SectionHeading title={`Harness v${h.current.version}`} action={!h.evolvable ? <StatusChip tone="neutral" label="not evolvable" /> : undefined} />
          <p className="ev-persona">{h.current.persona}</p>
          {h.current.guidance.length ? (
            <ul className="ev-guidance">
              {h.current.guidance.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          ) : (
            <p className="ev-help">No guidance notes yet.</p>
          )}
          <Accordion
            defaultOpen={-1}
            items={[
              {
                title: `Versions (${h.total})`,
                content: (
                  <ul className="ev-versions">
                    {[...h.versions].reverse().map((v) => (
                      <li key={v.version}>
                        <b>v{v.version}</b>
                        <span className="sl-meta">
                          {v.at.slice(0, 16).replace('T', ' ')}
                          {v.note ? ` · ${v.note}` : ''}
                        </span>
                        {v.version !== h.current.version ? (
                          <ConfirmButton variant="secondary" label={`Roll back to v${v.version}`} prompt={`Make a new version that copies v${v.version}?`} confirmLabel="Roll back" disabled={busy} onConfirm={() => rollback(v.version)} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
        </section>
      ) : null}

      <section className="ev-section">
        <SectionHeading title="Proposals" count={proposals.length} />
        {proposals.length ? (
          proposals.map((p) => {
            const picked = picks[p.id] ?? [];
            return (
              <div className="ev-proposal" key={p.id}>
                <div className="ev-proposal-head">
                  <code>{p.id}</code>
                  <StatusChip tone={LABEL_TONE[p.label] ?? 'neutral'} label={p.label} />
                  {p.stale ? <StatusChip tone="needs" label="stale" /> : null}
                  <span className="sl-meta">
                    based on v{p.base}
                    {p.version !== undefined ? ` · made v${p.version}` : ''}
                    {p.costUsd !== undefined ? ` · editor $${p.costUsd.toFixed(4)}` : ''}
                  </span>
                </div>
                {p.note ? <p className="ev-help">{p.note}</p> : null}
                {p.stale ? (
                  <p className="ev-help">
                    The harness moved on since this was written, so it cannot be accepted. Run <code>aorch evolve {p.bot}</code> again.
                  </p>
                ) : null}
                {p.edits.map((e) => {
                  const title = `${e.n}. ${e.roleNote ? 'role note' : `${e.field} ${e.op}`}`;
                  return (
                    <div className="ev-edit" key={e.n}>
                      <div className="ev-edit-head">
                        {p.status === 'open' ? (
                          <Checkbox label={title} checked={picked.includes(e.n)} disabled={p.stale} onCheckedChange={() => toggle(p.id, e.n)} />
                        ) : (
                          <span>
                            {p.picked?.includes(e.n) ? '✔ ' : ''}
                            <b>{e.n}.</b> {e.roleNote ? 'role note' : `${e.field} ${e.op}`}
                          </span>
                        )}
                        {e.probe ? <StatusChip tone={PROBE[e.probe].tone} label={PROBE[e.probe].label(e.probeNote)} /> : null}
                      </div>
                      {e.roleNote ? (
                        <p className="ev-help">added to the bot's role prompt; {e.before !== undefined ? 'replaces the earlier role note' : 'nothing is removed'}</p>
                      ) : null}
                      <pre className="ev-diff">
                        {e.before !== undefined ? <span className="del">- {e.before}</span> : null}
                        {e.after !== undefined ? <span className="add">+ {e.after}</span> : null}
                      </pre>
                      {e.lessons.map((l) => (
                        <p className="ev-help" key={l.id}>
                          because <code>{l.id}</code>
                          {l.text !== undefined ? ` (${l.polarity}, ${l.runs} runs, ${l.provenance}): ${l.text}` : ' (lesson no longer stored)'}
                        </p>
                      ))}
                    </div>
                  );
                })}
                {p.probe ? (
                  <div className="ev-probe ev-help">
                    <b>Probe</b> spent ${p.probe.spentUsd.toFixed(4)} of ${p.probe.budgetUsd.toFixed(2)}
                    {p.probe.stoppedBy ? ` · stopped by ${p.probe.stoppedBy}` : ''}
                    <ul>
                      {p.probe.results.slice(0, 10).map((r, i) => (
                        <li key={i}>
                          <b>{r.verdict}</b> edit {r.edit ?? 'all'} on "{r.task.slice(0, 60)}" · baseline: {r.baseline}; candidate: {r.candidate}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {p.status === 'open' && !p.stale ? (
                  <div className="ev-actions">
                    <Button variant="primary" size="sm" disabled={busy || !picked.length} onClick={() => void accept(p)}>
                      Accept {picked.length === p.edits.length ? 'all' : `${picked.length} of ${p.edits.length}`}
                    </Button>
                    {p.composed ? (
                      <Button variant="secondary" size="sm" disabled={busy || !p.composed.kept.length} onClick={() => setPicks((all) => ({ ...all, [p.id]: [...p.composed!.kept] }))}>
                        Pick the kept edits
                      </Button>
                    ) : null}
                    {rejectButton(p)}
                  </div>
                ) : null}
                {p.status === 'open' && p.stale ? <div className="ev-actions">{rejectButton(p)}</div> : null}
              </div>
            );
          })
        ) : (
          <p className="ev-help">No proposals yet.</p>
        )}
      </section>

      <section className="ev-section">
        <SectionHeading title="Lessons" count={lessons.length} />
        <p className="ev-help">A lesson is tentative until at least 3 different runs support it without conflicting evidence; only confident lessons are proposed.</p>
        {lessons.length ? (
          <ul className="ev-lessons">
            {lessons.map((l) => (
              <li key={l.id}>
                <StatusChip tone={l.status === 'confident' ? 'done' : 'neutral'} label={l.status} />
                <span>{l.text}</span>
                <span className="sl-meta">
                  {l.polarity} · {l.runs} run{l.runs === 1 ? '' : 's'} · from {l.provenance} · {l.id}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ev-help">No lessons yet: they come from runs with rework, handoff problems or your thumbs up / down.</p>
        )}
      </section>
    </div>
  );
```

- [ ] **Step 5: Delete the Evolve rules from `web/src/styles.css`** — `.evolve-panel`, `.evolve-panel h3, .evolve-panel h4`, `.bot-editor.in-drawer, .evolve-panel.in-drawer`, `.evolve-panel .proposal`, `.evolve-panel .edit`, `.evolve-panel pre.diff`, `.evolve-panel pre.diff .del`, `.evolve-panel pre.diff .add`, `.evolve-panel .versions li`, `.chip.probe-dropped`, `.chip.probe-unprobed`, `.chip.probe-kept`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --project web web/src/Evolve.test.tsx web/src/Crew.test.tsx web/src/rules.test.ts && npm run typecheck`
Expected: PASS (the existing four Evolve tests are unchanged).

- [ ] **Step 7: Commit**

```bash
git add web/src/Evolve.tsx web/src/Evolve.test.tsx web/src/evolve.css web/src/styles.css
git commit -m "feat(web): Evolve drawer with status chips and Studio sections"
```

---

### Task 12: Trigger rows and the trigger form drawer

**Files:**
- Create: `web/src/triggers/types.ts`, `web/src/triggers/TriggerRow.tsx`, `web/src/triggers/TriggerForm.tsx`, `web/src/triggers/triggers.css`
- Test: `web/src/triggers/TriggerRow.test.tsx`, `web/src/triggers/TriggerForm.test.tsx`

**Interfaces:**
- Consumes: `ago` (`web/src/api.ts`), `StatusChip`/`Tone`, Arc `Switch`, `Button`, `Input`, `Select`, `Checkbox`, `Drawer`/`DrawerContent`/`useDrawerItem`, `ConfirmButton`, `NONE`/`fromNone`, `cn`.
- Produces:
  - `web/src/triggers/types.ts`: `Delivery`, `Status`, `Trigger`, `Workspace`, `Setup`, `Form`, `TestResult` (same shapes as today's locals in `Triggers.tsx`), `EVENTS`, `DEFAULT_EVENTS = ['opened', 'synchronize', 'reopened', 'ready_for_review']`, `blank(): Form`, `fromTrigger(t: Trigger): Form`, `split(s: string): string[]`, `statusTip: Record<Status, string>`, `OUTCOME: Record<Delivery['outcome'], { tone: Tone; label: string }>` (`started` → done "run started", `ignored` → neutral "ignored", `skipped` → neutral "skipped", `error` → failed "error"), `who(t: Trigger): string`.
  - `TriggerRow(p: { t: Trigger; onToggle(): void; onTest(): void; onLog(): void; onEdit(): void; onDelete(): void | Promise<unknown> })` — an `li.tg-row` (class `paused` when disabled): status dot `.tg-dot[data-status]` (`role="img"`, named by the status), id, status word, event chips, repo → workflow (+ "comments" chip), a meta line (workspace · agent/model · filters), last delivery chip and age, the On switch (`Pause <id>` / `Enable <id>`), Test, Log, Edit, Delete (confirm "Yes, delete").
  - `TriggerForm(p: { form: Form | null; editing: boolean; workspaces: Workspace[]; agents: Record<string, { ok: boolean; models: string[] }>; workflows: string[]; onChange(p: Partial<Form>): void; onSave(): void; onClose(): void })` — a right drawer titled "New trigger" / "Edit <id>" holding a `form` named "New trigger" / "Edit trigger" with every current field.

- [ ] **Step 1: Write the failing tests**

`web/src/triggers/TriggerRow.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriggerRow } from './TriggerRow';
import type { Trigger } from './types';

const t = (o: Partial<Trigger> = {}): Trigger => ({ id: 'acme-full-review', repo: 'acme/api', workflow: 'full-review', status: 'idle', last: null, enabled: true, ...o });
const fns = () => ({ onToggle: vi.fn(), onTest: vi.fn(), onLog: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() });
const row = (trigger: Trigger, f = fns()) => render(<ul><TriggerRow t={trigger} {...f} /></ul>);

describe('TriggerRow', () => {
  it('shows the status, events, target and filters of a trigger', () => {
    const { container } = row(t({ labels: ['aorch'], comment: true, agent: 'claude', model: 'opus', workspace: 'api' }));
    expect(container.querySelector('.tg-dot')!.getAttribute('data-status')).toBe('idle');
    expect(screen.getByRole('img', { name: 'idle' })).toBeTruthy();
    expect([...container.querySelectorAll('.tg-line .tg-chip')].map((c) => c.textContent)).toEqual(['opened', 'synchronize', 'reopened', 'ready_for_review']);
    expect(screen.getByText('comments')).toBeTruthy();
    expect(screen.getByText('workspace api · claude · opus · Only with labels: aorch')).toBeTruthy();
    expect(screen.getByText('no deliveries')).toBeTruthy();
  });

  it('shows the last delivery as a status chip', () => {
    row(t({ status: 'active', last: { at: new Date().toISOString(), source: 'webhook', repo: 'acme/api', pr: 12, outcome: 'started', runId: 'r9' } }));
    expect(screen.getByText('run started').closest('.sl-chip')!.classList.contains('t-done')).toBe(true);
    expect(screen.getByText('#12 · just now')).toBeTruthy();
  });

  it('pauses, tests, opens the log, edits and deletes after confirming', async () => {
    const f = fns();
    const { container } = row(t({ enabled: false, status: 'paused' }), f);
    expect(container.querySelector('.tg-row')!.classList.contains('paused')).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable acme-full-review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })));
    expect([f.onToggle, f.onTest, f.onLog, f.onEdit, f.onDelete].map((x) => x.mock.calls.length)).toEqual([1, 1, 1, 1, 1]);
  });
});
```

`web/src/triggers/TriggerForm.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriggerForm } from './TriggerForm';
import { blank } from './types';

const agents = { claude: { ok: true, models: ['opus'] } };
const fns = () => ({ onChange: vi.fn(), onSave: vi.fn(), onClose: vi.fn() });

describe('TriggerForm', () => {
  it('opens a new trigger in a drawer and saves only with a repo and a workflow', () => {
    const f = fns();
    const { rerender } = render(<TriggerForm form={blank()} editing={false} workspaces={[]} agents={agents} workflows={['full-review']} {...f} />);
    expect(screen.getByRole('form', { name: 'New trigger' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Repo'), { target: { value: 'acme/api' } });
    expect(f.onChange).toHaveBeenCalledWith({ repo: 'acme/api' });
    expect(screen.getByPlaceholderText('workspace id (optional)')).toBeTruthy();
    rerender(<TriggerForm form={{ ...blank(), repo: 'acme/api' }} editing={false} workspaces={[]} agents={agents} workflows={['full-review']} {...f} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(f.onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(f.onClose).toHaveBeenCalledTimes(1);
  });

  it('locks the id while editing and offers the workspace picker when workspaces exist', () => {
    const ws = [{ id: 'api', name: 'API', path: '/code/api', isDefault: true, exists: true, repos: [] }];
    render(<TriggerForm form={{ ...blank(), id: 'acme-full-review', repo: 'acme/api' }} editing workspaces={ws} agents={agents} workflows={[]} {...fns()} />);
    expect(screen.getByRole('form', { name: 'Edit trigger' })).toBeTruthy();
    expect((screen.getByLabelText('Id') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('combobox', { name: /Workspace/ })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/triggers`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Create `web/src/triggers/types.ts`**

```ts
import type { Tone } from '../ui/studio/StatusChip';

export interface Delivery { at: string; trigger?: string; source: 'webhook' | 'poll' | 'test'; repo: string; pr?: number; outcome: 'started' | 'ignored' | 'skipped' | 'error'; reason?: string; runId?: string }
export type Status = 'paused' | 'error' | 'idle' | 'active';
export interface Trigger {
  id: string; repo: string; workflow: string; workspace?: string; agent?: string; model?: string; events?: string[]; labels?: string[];
  comment?: boolean; drafts?: boolean; forks?: boolean; enabled?: boolean; status: Status; last: Delivery | null; warnings?: string[];
}
export interface Workspace { id: string; name: string; path: string; isDefault: boolean; exists: boolean; repos: string[] }
export interface Setup { payloadPath: string; hasSecret: boolean; secretHint: string | null; secretSource: 'env' | 'file' | null; eventsToSelect: string[]; contentType: string }
export interface Form { id: string; repo: string; workflow: string; workspace: string; agent: string; model: string; events: string; labels: string; comment: boolean; drafts: boolean; forks: boolean }
export interface TestResult { matches: boolean; why: string; fired: boolean; runId?: string; pr: { repo: string; number: number; title: string; url: string }; note?: string }

export const EVENTS = ['opened', 'synchronize', 'reopened', 'ready_for_review', 'labeled'];
export const DEFAULT_EVENTS = ['opened', 'synchronize', 'reopened', 'ready_for_review'];
export const blank = (): Form => ({ id: '', repo: '', workflow: 'full-review', workspace: '', agent: '', model: '', events: '', labels: '', comment: false, drafts: false, forks: false });
export const fromTrigger = (t: Trigger): Form => ({ id: t.id, repo: t.repo, workflow: t.workflow, workspace: t.workspace ?? '', agent: t.agent ?? '', model: t.model ?? '', events: (t.events ?? []).join(', '), labels: (t.labels ?? []).join(', '), comment: !!t.comment, drafts: !!t.drafts, forks: !!t.forks });
export const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
export const statusTip: Record<Status, string> = { paused: 'paused: PRs are ignored until you enable it', error: 'the last delivery failed', idle: 'waiting for a pull request', active: 'started a run in the last 24 hours' };
export const OUTCOME: Record<Delivery['outcome'], { tone: Tone; label: string }> = {
  started: { tone: 'done', label: 'run started' },
  ignored: { tone: 'neutral', label: 'ignored' },
  skipped: { tone: 'neutral', label: 'skipped' },
  error: { tone: 'failed', label: 'error' },
};
export const who = (t: Trigger) => (t.agent ? `${t.agent}${t.model ? ' · ' + t.model : ''}` : t.model ? `default · ${t.model}` : 'crew defaults');
```

- [ ] **Step 4: Create `web/src/triggers/TriggerRow.tsx`**

```tsx
import { ago } from '../api';
import { Button } from '../components/arc/button/button';
import { Switch } from '../components/arc/switch/switch';
import { cn } from '../ui/cn';
import { ConfirmButton } from '../ui/ConfirmButton';
import { StatusChip } from '../ui/studio/StatusChip';
import { DEFAULT_EVENTS, OUTCOME, statusTip, who, type Trigger } from './types';

/** One trigger as a board row: what it listens to, what it starts, its last delivery, and its controls. */
export function TriggerRow(p: { t: Trigger; onToggle: () => void; onTest: () => void; onLog: () => void; onEdit: () => void; onDelete: () => void | Promise<unknown> }) {
  const t = p.t;
  const filters = [t.labels?.length ? `Only with labels: ${t.labels.join(', ')}` : '', t.drafts ? 'includes drafts' : '', t.forks ? 'includes forks' : ''].filter(Boolean);
  const meta = [`workspace ${t.workspace ?? 'none'}`, who(t), ...filters].join(' · ');
  return (
    <li className={cn('tg-row', { paused: t.enabled === false })}>
      <span className="tg-dot" data-status={t.status} role="img" aria-label={t.status} title={statusTip[t.status]} />
      <div className="tg-main">
        <div className="tg-line">
          <span className="tg-id">{t.id}</span>
          <span className="tg-status">{t.status}</span>
          {(t.events ?? DEFAULT_EVENTS).map((e) => (
            <span key={e} className="tg-chip">
              {e}
            </span>
          ))}
        </div>
        <div className="tg-target">
          {t.repo} → <code>{t.workflow}</code>
          {t.comment ? (
            <span className="tg-chip" title="posts the result on the PR">
              comments
            </span>
          ) : null}
        </div>
        <div className="tg-meta">{meta}</div>
      </div>
      <div className="tg-last">
        {t.last ? (
          <>
            <StatusChip tone={OUTCOME[t.last.outcome].tone} label={OUTCOME[t.last.outcome].label} />
            <span className="sl-age">
              {t.last.pr ? `#${t.last.pr} · ` : ''}
              {ago(Date.parse(t.last.at))}
            </span>
          </>
        ) : (
          <span className="sl-age">no deliveries</span>
        )}
      </div>
      <Switch aria-label={`${t.enabled === false ? 'Enable' : 'Pause'} ${t.id}`} checked={t.enabled !== false} onCheckedChange={p.onToggle} />
      <div className="tg-actions">
        <Button variant="ghost" size="sm" onClick={p.onTest}>
          Test
        </Button>
        <Button variant="ghost" size="sm" onClick={p.onLog}>
          Log
        </Button>
        <Button variant="secondary" size="sm" onClick={p.onEdit}>
          Edit
        </Button>
        <ConfirmButton label="Delete" prompt={`Delete ${t.id}?`} confirmLabel="Yes, delete" onConfirm={p.onDelete} />
      </div>
    </li>
  );
}
```

- [ ] **Step 5: Create `web/src/triggers/TriggerForm.tsx`**

```tsx
import { Button } from '../components/arc/button/button';
import { Checkbox } from '../components/arc/checkbox/checkbox';
import { Drawer, DrawerContent, useDrawerItem } from '../components/arc/drawer/drawer';
import { Input } from '../components/arc/input/input';
import { Select } from '../components/arc/select/select';
import { NONE, fromNone } from '../ui/cn';
import { EVENTS, type Form, type Workspace } from './types';

/** The trigger form, in a right drawer. Every field of today's form; the id is locked while editing. */
export function TriggerForm(p: {
  form: Form | null;
  editing: boolean;
  workspaces: Workspace[];
  agents: Record<string, { ok: boolean; models: string[] }>;
  workflows: string[];
  onChange: (f: Partial<Form>) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const f = useDrawerItem(p.form);
  const models = p.agents[f?.agent ?? '']?.models ?? [];
  return (
    <Drawer open={!!p.form} onOpenChange={(o) => !o && p.onClose()}>
      <DrawerContent side="right" title={p.editing ? `Edit ${f?.id ?? ''}` : 'New trigger'}>
        {f ? (
          <form
            className="tg-form"
            aria-label={p.editing ? 'Edit trigger' : 'New trigger'}
            onSubmit={(e) => {
              e.preventDefault();
              p.onSave();
            }}
          >
            <Input label="Repo" required value={f.repo} placeholder="owner/repo, or * for any mapped repo" spellCheck={false} onChange={(e) => p.onChange({ repo: e.target.value })} />
            <Input label="Workflow" required list="trig-workflows" value={f.workflow} spellCheck={false} onChange={(e) => p.onChange({ workflow: e.target.value })} />
            <datalist id="trig-workflows">
              {p.workflows.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
            {p.workspaces.length ? (
              <Select
                label="Workspace"
                value={f.workspace || NONE}
                onValueChange={(v) => p.onChange({ workspace: fromNone(v) })}
                options={[
                  { value: NONE, label: 'none' },
                  ...(f.workspace && !p.workspaces.some((w) => w.id === f.workspace) ? [{ value: f.workspace, label: `${f.workspace} (not found)` }] : []),
                  ...p.workspaces.map((w) => ({ value: w.id, label: `${w.name || w.id}${w.isDefault ? ' (default)' : ''}${w.exists ? '' : ' (folder missing)'}` })),
                ]}
              />
            ) : (
              <Input label="Workspace" value={f.workspace} placeholder="workspace id (optional)" onChange={(e) => p.onChange({ workspace: e.target.value })} />
            )}
            <div className="tg-pair">
              <Select
                label="Agent"
                value={f.agent || NONE}
                onValueChange={(v) => p.onChange({ agent: fromNone(v), model: '' })}
                options={[
                  { value: NONE, label: 'crew defaults' },
                  ...(f.agent && !(f.agent in p.agents) ? [{ value: f.agent, label: `${f.agent} (unknown)` }] : []),
                  ...Object.keys(p.agents).map((a) => ({ value: a, label: `${a}${p.agents[a]!.ok ? '' : ' (not available)'}` })),
                ]}
              />
              <Input label="Model" list="trig-models" value={f.model} placeholder="adapter default" spellCheck={false} onChange={(e) => p.onChange({ model: e.target.value })} />
            </div>
            <datalist id="trig-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <Input label="Events" list="trig-events" value={f.events} placeholder="default: opened, synchronize, reopened, ready_for_review" spellCheck={false} onChange={(e) => p.onChange({ events: e.target.value })} />
            <datalist id="trig-events">
              {EVENTS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <Input label="Only with labels" value={f.labels} placeholder="comma separated; empty = any PR" spellCheck={false} onChange={(e) => p.onChange({ labels: e.target.value })} />
            <Input label="Id" value={f.id} disabled={p.editing} placeholder="auto: repo-workflow" spellCheck={false} onChange={(e) => p.onChange({ id: e.target.value })} />
            <div className="tg-checks">
              <Checkbox label="post the result as a PR comment" checked={f.comment} onCheckedChange={(c) => p.onChange({ comment: c === true })} />
              <Checkbox label="include drafts" checked={f.drafts} onCheckedChange={(c) => p.onChange({ drafts: c === true })} />
              <Checkbox label="include forks" checked={f.forks} onCheckedChange={(c) => p.onChange({ forks: c === true })} />
            </div>
            <div className="tg-actions">
              <Button variant="primary" type="submit" disabled={!f.repo.trim() || !f.workflow.trim()}>
                Save
              </Button>
              <Button variant="secondary" type="button" onClick={p.onClose}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
```

- [ ] **Step 6: Create `web/src/triggers/triggers.css`**

```css
/* Triggers (Studio Live board): trigger rows, a test panel, webhook setup and a delivery log. Tokens only. */
.tg-page { height: 100%; overflow: auto; }
.tg-wrap { max-width: 1240px; margin: 0 auto; padding: 0 0 40px; display: flex; flex-direction: column; gap: 20px; }
.tg-body { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; padding: 0 24px; }
.tg-main-col { flex: 2 1 560px; min-width: 0; display: flex; flex-direction: column; gap: 24px; }
.tg-side { flex: 1 1 320px; min-width: 0; }
.tg-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.tg-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 14px 8px; margin: 0 -8px; border-bottom: 1px solid var(--line); border-radius: 8px;
  transition: background-color var(--t-fast) var(--ease);
}
.tg-row:hover { background: var(--s2); }
.tg-row.paused .tg-main, .tg-row.paused .tg-last { opacity: .6; }
.tg-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--edge); }
.tg-dot[data-status='active'] { background: var(--ok); }
.tg-dot[data-status='error'] { background: var(--bad); }
.tg-dot[data-status='paused'] { background: transparent; box-shadow: inset 0 0 0 2px var(--edge); }
.tg-main { flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.tg-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tg-id { font-family: var(--font-code); font-weight: 500; color: var(--ink); }
.tg-status { font-size: 12px; color: var(--mut); }
.tg-chip { font-family: var(--font-code); font-size: 11px; line-height: 18px; padding: 0 7px; border-radius: 6px; background: var(--s2); color: var(--mut); margin-left: 6px; }
.tg-line .tg-chip { margin-left: 0; }
.tg-target { font-size: 13px; color: var(--mut); overflow-wrap: anywhere; }
.tg-meta { font-size: 12px; color: var(--mut); overflow-wrap: anywhere; }
.tg-last { display: flex; align-items: center; gap: 8px; min-width: 140px; }
.tg-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tg-form { display: flex; flex-direction: column; gap: 12px; }
.tg-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tg-checks { display: flex; flex-wrap: wrap; gap: 6px 18px; }
@media (max-width: 899px) {
  .tg-body { padding: 0 16px; }
  .tg-pair { grid-template-columns: 1fr; }
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run --project web web/src/triggers && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/triggers
git commit -m "feat(web): trigger rows and a trigger form drawer on Studio parts"
```

---

### Task 13: Triggers screen — header, test panel, webhook setup and delivery log

**Files:**
- Create: `web/src/triggers/TriggerTest.tsx`, `web/src/triggers/WebhookSetup.tsx`, `web/src/triggers/Deliveries.tsx`
- Modify: `web/src/Triggers.tsx` (full rewrite), `web/src/triggers/triggers.css` (append), `web/src/styles.css` (delete the trigger rules)
- Test: `web/src/Triggers.test.tsx`

**Interfaces:**
- Consumes: `TriggerRow`, `TriggerForm`, `types.ts` (Task 12); `usePoll` and `Poll<T>` (`web/src/hooks.ts`); `api`, `ago`; `ScreenHeader`, `SectionHeading`, `Panel`, `InlineError`, `StatusChip`, `Loading`; Arc `Select`, `Input`, `Button`, `CopyButton`, `ConfirmButton`.
- Produces:
  - `Triggers()` (no props, as today): header (meta `GitHub webhooks · POST /api/webhooks/github · <n> trigger(s)`, title, summary, "Test a trigger", "New trigger" ink), trigger rows (load error with Retry, empty state), the form drawer, then `TriggerTest`, `WebhookSetup`, and `Deliveries` in a side column at 1200 px and wider (stacked below).
  - `TriggerTest(p: { triggers: Trigger[]; testId: string; onTestId(id: string): void; onFired(): Promise<void> })` — a region "Test a trigger" whose pull request field has `id="tg-pr"`; Dry run, Fire for real… (confirm "Yes, fire"), result with "Open the run".
  - `WebhookSetup()` — loads `GET /api/triggers/setup` itself; a region "Webhook setup": tunnel hint, payload URL + Copy, content type, events to select, secret (shown once with Copy, else its hint and source), Generate / Regenerate (confirm), Hide; error with Retry.
  - `Deliveries(p: { triggers: Trigger[]; logFor: string; onLogFor(id: string): void; log: Poll<Delivery[]> })` — a region "Delivery log": Show (all / one trigger), Sort by (Newest first, Oldest first, Trigger, Outcome), Refresh; rows with an outcome chip, `repo#pr`, age, trigger · source, and "Open the run →" or the reason; rows that arrive after the first load slide in once (`.fresh`, 280 ms); error with Retry; "No deliveries yet".

- [ ] **Step 1: Update and add tests** — in `web/src/Triggers.test.tsx`:
- In `'saves a new trigger with split lists'` change `'+ New trigger'` to `'New trigger'`.
- Replace the body of `'renders the status dot with the trigger status class'` after `await screen.findByRole(…)` with:

```tsx
    expect(document.querySelector('.tg-dot[data-status="idle"]')).toBeTruthy();
    expect(document.querySelector('.tg-dot[data-status="paused"]')).toBeTruthy();
```

Append inside `describe('Triggers', …)`:

```tsx
  it('lists deliveries with run links and reasons, sorts them and filters by trigger', async () => {
    const now = Date.now();
    const deliveries = [
      { at: new Date(now - 60_000).toISOString(), trigger: 'zeta', source: 'webhook', repo: 'acme/api', pr: 41, outcome: 'skipped', reason: 'draft PR (include drafts is off)' },
      { at: new Date(now - 1_000).toISOString(), trigger: 'acme-full-review', source: 'webhook', repo: 'acme/api', pr: 42, outcome: 'started', runId: 'r7' },
    ];
    routeApi({ ...baseRoutes(), 'GET /api/triggers/deliveries': deliveries });
    renderApp(<Triggers />);
    const log = await screen.findByRole('region', { name: 'Delivery log' });
    expect(await within(log).findByRole('link', { name: 'Open the run →' })).toHaveProperty('hash', '#/runs/r7');
    expect(within(log).getByText('draft PR (include drafts is off)')).toBeTruthy();
    const order = () => [...log.querySelectorAll('.tg-delivery .tg-what')].map((e) => e.textContent);
    expect(order()).toEqual(['acme/api#42', 'acme/api#41']);
    fireEvent.click(within(log).getByRole('combobox', { name: /Sort by/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Trigger' }));
    expect(order()).toEqual(['acme/api#42', 'acme/api#41']);
    fireEvent.click(within(log).getByRole('combobox', { name: /Sort by/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Oldest first' }));
    expect(order()).toEqual(['acme/api#41', 'acme/api#42']);
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(calls('GET', '/api/triggers/deliveries?trigger=acme-full-review&limit=50').length).toBeGreaterThan(0));
  });

  it('takes you to the test panel from the header', async () => {
    renderApp(<Triggers />);
    await screen.findByRole('switch', { name: /Pause acme-full-review/ });
    fireEvent.click(screen.getByRole('button', { name: 'Test a trigger' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Pull request'));
  });
```

and add `within` to the `@testing-library/react` import. Extract the `beforeEach` route table into a helper so the new test can extend it — replace the `routeApi({ … })` call inside `beforeEach` with `routeApi(baseRoutes());` and define above `beforeEach`:

```tsx
const baseRoutes = () => ({
  'GET /api/triggers': () => triggers,
  'GET /api/triggers/deliveries': [] as unknown,
  'GET /api/triggers/setup': setup(true),
  'GET /api/workspaces': [],
  'GET /api/pipelines': [{ name: 'full-review', nodes: 5 }],
  'GET /api/bots': { agents: { claude: { ok: true, models: [] } } },
  'PATCH /api/triggers/acme-full-review': {},
  'DELETE /api/triggers/acme-full-review': {},
  'POST /api/triggers': (b: unknown) => ({ ...trig(), ...(b as object), id: 'acme-full-review' }),
  'POST /api/triggers/acme-full-review/test': (b: unknown) => ({ matches: true, why: '', fired: (b as { fire: boolean }).fire, runId: (b as { fire: boolean }).fire ? 'r9' : undefined, pr: { repo: 'acme/api', number: 12, title: 'Fix bug', url: 'u' } }),
  'POST /api/triggers/setup/secret': { secret: 'new-secret-value' },
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/Triggers.test.tsx`
Expected: FAIL — no "New trigger" button, no `.tg-dot`, no "Delivery log" rows or Sort by, no "Test a trigger" header button.

- [ ] **Step 3: Create `web/src/triggers/TriggerTest.tsx`**

```tsx
import { useState } from 'react';
import { api } from '../api';
import { Button } from '../components/arc/button/button';
import { Input } from '../components/arc/input/input';
import { Select } from '../components/arc/select/select';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/studio/Panel';
import { StatusChip } from '../ui/studio/StatusChip';
import type { TestResult, Trigger } from './types';

/** Ask GitHub about a PR and say what the trigger would do (dry run), or start the run for real after confirming. */
export function TriggerTest(p: { triggers: Trigger[]; testId: string; onTestId: (id: string) => void; onFired: () => Promise<void> }) {
  const [pr, setPr] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [err, setErr] = useState('');
  async function run(fire: boolean) {
    setTesting(true);
    setErr('');
    setResult(null);
    try {
      setResult(await api<TestResult>('POST', `/api/triggers/${encodeURIComponent(p.testId)}/test`, { pr: pr.trim(), fire }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      if (fire) await p.onFired();
      setTesting(false);
    }
  }
  const blocked = testing || !pr.trim() || !p.testId;
  return (
    <Panel title="Test a trigger" className="tg-test">
      <p className="sl-summary">Paste a PR link (or a number for a single-repo trigger). A dry run only reports what would happen. Event filters are not checked, since GitHub supplies the action on real events.</p>
      {p.triggers.length ? (
        <>
          <div className="tg-test-fields">
            <Select label="Trigger to test" value={p.testId} onValueChange={p.onTestId} options={p.triggers.map((t) => ({ value: t.id, label: t.id }))} />
            <Input id="tg-pr" label="Pull request" placeholder="https://github.com/owner/repo/pull/12" value={pr} spellCheck={false} onChange={(e) => setPr(e.target.value)} />
          </div>
          <div className="tg-actions">
            <Button variant="primary" disabled={blocked} onClick={() => void run(false)}>
              Dry run
            </Button>
            {/* keyed on the PR so editing it cancels a pending "fire" question */}
            <ConfirmButton key={pr} variant="secondary" label="Fire for real…" prompt="Start a real run on this PR?" confirmLabel="Yes, fire" disabled={blocked} onConfirm={() => run(true)} />
            {testing ? <span className="sl-meta">asking GitHub…</span> : null}
          </div>
          {err ? (
            <p className="sl-alert" role="alert">
              {err}
            </p>
          ) : null}
          {result ? (
            <div className="tg-result" role="status">
              <StatusChip tone={result.matches ? 'done' : 'needs'} label={result.fired ? 'run started' : result.matches ? 'would run' : 'would be ignored'} />
              <p>
                <b>
                  {result.pr.repo}#{result.pr.number}
                </b>{' '}
                <span className="sl-meta">"{result.pr.title.slice(0, 70)}"</span>
              </p>
              <p>
                {result.fired ? `Started run ${result.runId}. ` : result.matches ? 'Would start a run. Nothing was started (dry run). ' : 'Would be ignored: '}
                {result.matches ? '' : result.why}
                {result.runId ? <a href={`#/runs/${result.runId}`}>Open the run</a> : null}
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="sl-meta">Add a trigger first.</p>
      )}
    </Panel>
  );
}
```

- [ ] **Step 4: Create `web/src/triggers/WebhookSetup.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button } from '../components/arc/button/button';
import { CopyButton } from '../components/arc/copy-button/copy-button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { Panel } from '../ui/studio/Panel';
import type { Setup } from './types';

/** How to point a GitHub webhook at this machine, and the shared secret (shown once when generated). */
export function WebhookSetup() {
  const notify = useNotify();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [err, setErr] = useState('');
  const [secret, setSecret] = useState('');
  async function load() {
    try {
      setSetup(await api<Setup>('GET', '/api/triggers/setup'));
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function regenerate() {
    try {
      const r = await api<{ secret: string }>('POST', '/api/triggers/setup/secret');
      setSecret(r.secret);
      await load();
    } catch (e) {
      notify.fail(e);
    }
  }
  const copied = () => notify.ok('copied');
  const payloadUrl = `https://<your tunnel>${setup?.payloadPath ?? '/api/webhooks/github'}`;
  return (
    <Panel title="Webhook setup" className="tg-setup">
      <p className="sl-summary">
        GitHub → repo → Settings → Webhooks → Add webhook. This server only listens on this machine, so expose just the webhook path with a tunnel (<code>cloudflared tunnel --url http://127.0.0.1:4177</code>, ngrok or tailscale
        funnel). No tunnel? <code>aorch pr watch</code> polls instead.
      </p>
      {err ? <InlineError message={err} onRetry={() => void load()} /> : null}
      <dl className="tg-dl">
        <dt>Payload URL</dt>
        <dd>
          <code className="tg-code">{payloadUrl}</code>
          <CopyButton value={payloadUrl} label="Copy" variant="outline" onCopied={copied} />
        </dd>
        <dt>Content type</dt>
        <dd>
          <code>{setup?.contentType ?? 'application/json'}</code>
        </dd>
        <dt>Events</dt>
        <dd>
          Let me select individual events → <b>{(setup?.eventsToSelect ?? ['Pull requests']).join(', ')}</b>
        </dd>
        <dt>Secret</dt>
        <dd>
          {secret ? (
            <>
              <code className="tg-code tg-secret">{secret}</code>
              <CopyButton value={secret} label="Copy" variant="outline" onCopied={copied} />
              <span className="sl-note">Copy this into GitHub now. It will not be shown again.</span>
            </>
          ) : setup?.hasSecret ? (
            <>
              <code className="tg-code">{setup.secretHint ? `••••••••${setup.secretHint}` : '••••••••'}</code>
              <span className="sl-meta">{setup.secretSource === 'env' ? 'from AORCH_WEBHOOK_SECRET' : 'stored; shown only when generated'}</span>
            </>
          ) : (
            <span className="sl-meta">none yet</span>
          )}
        </dd>
      </dl>
      <div className="tg-actions">
        {setup?.secretSource !== 'env' ? (
          setup?.hasSecret ? (
            <ConfirmButton variant="secondary" label="Regenerate secret" prompt="Existing webhooks stop working until you paste the new secret." confirmLabel="Regenerate" onConfirm={regenerate} />
          ) : (
            <Button variant="secondary" onClick={() => void regenerate()}>
              Generate secret
            </Button>
          )
        ) : null}
        {secret ? (
          <Button variant="ghost" onClick={() => setSecret('')}>
            Hide
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 5: Create `web/src/triggers/Deliveries.tsx`**

```tsx
import { useRef, useState } from 'react';
import { ago } from '../api';
import { Button } from '../components/arc/button/button';
import { Select } from '../components/arc/select/select';
import type { Poll } from '../hooks';
import { NONE, cn, fromNone } from '../ui/cn';
import { InlineError } from '../ui/studio/InlineError';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { StatusChip } from '../ui/studio/StatusChip';
import { OUTCOME, type Delivery, type Trigger } from './types';

type Sort = 'new' | 'old' | 'trigger' | 'outcome';
const time = (d: Delivery) => Date.parse(d.at);
const SORTS: Record<Sort, (a: Delivery, b: Delivery) => number> = {
  new: (a, b) => time(b) - time(a),
  old: (a, b) => time(a) - time(b),
  trigger: (a, b) => (a.trigger ?? '').localeCompare(b.trigger ?? '') || time(b) - time(a),
  outcome: (a, b) => a.outcome.localeCompare(b.outcome) || time(b) - time(a),
};
const keyOf = (d: Delivery) => `${d.at}-${d.trigger ?? ''}-${d.pr ?? ''}`;
const NONE_YET: Delivery[] = [];

/** Every delivery (including ignored ones), newest first by default; rows that arrive while you watch slide in once. */
export function Deliveries(p: { triggers: Trigger[]; logFor: string; onLogFor: (id: string) => void; log: Poll<Delivery[]> }) {
  const [sort, setSort] = useState<Sort>('new');
  const seen = useRef<Set<string> | null>(null);
  const rows = [...(p.log.data ?? NONE_YET)].sort(SORTS[sort]);
  // the first answer is history, not news: only rows after it get the slide-in
  const known = seen.current;
  const fresh = new Set(known ? rows.map(keyOf).filter((k) => !known.has(k)) : []);
  if (p.log.data) seen.current = new Set([...(known ?? []), ...rows.map(keyOf)]);
  return (
    <section className="tg-log" aria-label="Delivery log">
      <SectionHeading
        title="Deliveries"
        count={rows.length}
        action={
          <Button variant="ghost" size="sm" onClick={() => void p.log.refresh()}>
            Refresh
          </Button>
        }
      />
      <div className="tg-log-tools">
        <Select label="Show" value={p.logFor || NONE} onValueChange={(v) => p.onLogFor(fromNone(v))} options={[{ value: NONE, label: 'all triggers' }, ...p.triggers.map((t) => ({ value: t.id, label: t.id }))]} />
        <Select
          label="Sort by"
          value={sort}
          onValueChange={(v) => setSort(v as Sort)}
          options={[
            { value: 'new', label: 'Newest first' },
            { value: 'old', label: 'Oldest first' },
            { value: 'trigger', label: 'Trigger' },
            { value: 'outcome', label: 'Outcome' },
          ]}
        />
      </div>
      {p.log.error && !p.log.data ? (
        <InlineError message={p.log.error} onRetry={() => void p.log.refresh()} />
      ) : rows.length ? (
        <ul className="sl-list tg-deliveries">
          {rows.map((d) => (
            <li key={keyOf(d)} className={cn('tg-delivery', { fresh: fresh.has(keyOf(d)) })}>
              <div className="tg-delivery-top">
                <StatusChip tone={OUTCOME[d.outcome].tone} label={OUTCOME[d.outcome].label} />
                <span className="tg-what">
                  {d.repo}
                  {d.pr ? `#${d.pr}` : ''}
                </span>
                <span className="sl-age" title={d.at}>
                  {ago(time(d))}
                </span>
              </div>
              <div className="tg-delivery-sub">
                <span>
                  {d.trigger ?? '-'} · {d.source}
                  {!d.runId && d.reason ? (
                    <>
                      {' · '}
                      <span className="tg-reason">{d.reason}</span>
                    </>
                  ) : null}
                </span>
                {d.runId ? <a href={`#/runs/${d.runId}`}>Open the run →</a> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sl-meta">No deliveries yet</p>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Rewrite `web/src/Triggers.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from './api';
import { Button } from './components/arc/button/button';
import { Loading } from './components/Loading';
import { usePoll } from './hooks';
import { Deliveries } from './triggers/Deliveries';
import { TriggerForm } from './triggers/TriggerForm';
import { TriggerRow } from './triggers/TriggerRow';
import { TriggerTest } from './triggers/TriggerTest';
import { blank, fromTrigger, split, type Delivery, type Form, type Trigger, type Workspace } from './triggers/types';
import { WebhookSetup } from './triggers/WebhookSetup';
import { useNotify } from './ui/notify';
import { InlineError } from './ui/studio/InlineError';
import { ScreenHeader } from './ui/studio/ScreenHeader';
import './triggers/triggers.css';

const NO_TRIGGERS: Trigger[] = [];

export function Triggers() {
  const notify = useNotify();
  const [logFor, setLogFor] = useState('');
  // rows are keyed by id, so a 5 s poll updates them in place and a focused control keeps focus
  const list = usePoll<Trigger[]>('/api/triggers', 5000);
  const rows = list.data ?? NO_TRIGGERS;
  const log = usePoll<Delivery[]>(`/api/triggers/deliveries?${logFor ? `trigger=${encodeURIComponent(logFor)}&` : ''}limit=50`, 5000);
  const loading = list.data === undefined && !list.error;
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [agents, setAgents] = useState<Record<string, { ok: boolean; models: string[] }>>({});
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState(false);
  const [testId, setTestId] = useState('');

  useEffect(() => {
    void api<Workspace[]>('GET', '/api/workspaces').then(setWorkspaces).catch(() => undefined);
    void api<{ name: string }[]>('GET', '/api/pipelines').then((p) => setWorkflows(p.map((x) => x.name))).catch(() => undefined);
    void api<{ agents: Record<string, { ok: boolean; models: string[] }> }>('GET', '/api/bots').then((r) => setAgents(r.agents)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!testId || !rows.some((t) => t.id === testId)) setTestId(rows[0]?.id ?? '');
  }, [rows, testId]);

  async function reload() {
    await list.refresh();
    await log.refresh();
  }
  const openForm = (t?: Trigger) => {
    setForm(t ? fromTrigger(t) : blank());
    setEditing(!!t);
  };
  async function save() {
    const f = form!;
    try {
      const t = await api<Trigger>('POST', '/api/triggers', { ...f, events: split(f.events), labels: split(f.labels) });
      setForm(null);
      notify.ok(`${t.id} saved${t.warnings?.length ? '. ' + t.warnings.join(' ') : ''}`);
      await reload();
    } catch (e) {
      notify.fail(e);
    }
  }
  async function toggle(t: Trigger) {
    try {
      await api('PATCH', `/api/triggers/${encodeURIComponent(t.id)}`, { enabled: t.enabled === false });
      await reload();
    } catch (e) {
      notify.fail(e);
    }
  }
  async function remove(id: string) {
    try {
      await api('DELETE', `/api/triggers/${encodeURIComponent(id)}`);
      if (logFor === id) setLogFor('');
      notify.ok(`${id} deleted`);
      await reload();
    } catch (e) {
      notify.fail(e);
    }
  }
  const toTest = (id?: string) => {
    if (id) setTestId(id);
    const field = document.getElementById('tg-pr');
    field?.scrollIntoView?.({ block: 'center' });
    field?.focus();
  };

  return (
    <div className="tg-page">
      <div className="tg-wrap">
        <ScreenHeader
          meta={`GitHub webhooks · POST /api/webhooks/github · ${rows.length} trigger${rows.length === 1 ? '' : 's'}`}
          title="Triggers"
          summary="Start a run when a pull request opens or changes. Pause one to keep it without acting on PRs."
          actions={
            <>
              <Button variant="secondary" onClick={() => toTest()}>
                Test a trigger
              </Button>
              <Button variant="primary" onClick={() => openForm()}>
                New trigger
              </Button>
            </>
          }
        />
        <Loading loading={loading} lines={6} label="Loading triggers">
          <div className="tg-body">
            <div className="tg-main-col">
              <section aria-label="Triggers">
                {list.error && !list.data ? (
                  <InlineError message={list.error} onRetry={() => void list.refresh()} />
                ) : rows.length ? (
                  <ul className="tg-list">
                    {rows.map((t) => (
                      <TriggerRow key={t.id} t={t} onToggle={() => void toggle(t)} onTest={() => toTest(t.id)} onLog={() => setLogFor(t.id)} onEdit={() => openForm(t)} onDelete={() => remove(t.id)} />
                    ))}
                  </ul>
                ) : (
                  <p className="sl-meta">
                    No triggers yet. Add one, then set up the webhook below (or run <code>aorch pr watch</code> to poll instead).
                  </p>
                )}
              </section>
              <TriggerTest triggers={rows} testId={testId} onTestId={setTestId} onFired={reload} />
              <WebhookSetup />
            </div>
            <aside className="tg-side">
              <Deliveries triggers={rows} logFor={logFor} onLogFor={setLogFor} log={log} />
            </aside>
          </div>
        </Loading>
      </div>
      <TriggerForm
        form={form}
        editing={editing}
        workspaces={workspaces}
        agents={agents}
        workflows={workflows}
        onChange={(p) => setForm((f) => (f ? { ...f, ...p } : f))}
        onSave={() => void save()}
        onClose={() => setForm(null)}
      />
    </div>
  );
}
```

The test panel's `Input` has `id="tg-pr"`, so the header button and each row's Test focus it.

- [ ] **Step 7: Append the panel and log styles to `web/src/triggers/triggers.css`**

```css
.tg-test, .tg-setup { display: flex; flex-direction: column; gap: 12px; }
.tg-test-fields { display: grid; grid-template-columns: minmax(160px, 220px) minmax(0, 1fr); gap: 8px; align-items: end; }
.tg-result { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: var(--radius-control); background: var(--s2); font-size: 13px; line-height: 1.5; }
.tg-result p { margin: 0; }
.tg-dl { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 10px 12px; margin: 0; font-size: 13px; }
.tg-dl dt { color: var(--mut); padding-top: 6px; }
.tg-dl dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; overflow-wrap: anywhere; }
.tg-code { padding: 6px 10px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); font-family: var(--font-code); font-size: 12.5px; }
.tg-secret { user-select: all; }
.tg-log { display: flex; flex-direction: column; gap: 10px; }
.tg-log-tools { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tg-deliveries { border-top: 1px solid var(--line); }
.tg-delivery { display: flex; flex-direction: column; gap: 4px; padding: 10px 2px; border-bottom: 1px solid var(--line); }
.tg-delivery.fresh { animation: tg-fresh var(--t-slow) var(--ease) both; }
@keyframes tg-fresh { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.tg-delivery-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tg-what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-code); font-size: 12px; color: var(--ink); }
.tg-delivery-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 12.5px; color: var(--mut); }
.tg-delivery-sub > span { flex: 1; min-width: 0; }
.tg-delivery-sub a { color: var(--accInk); text-decoration: none; }
.tg-delivery-sub a:hover { text-decoration: underline; }
@media (max-width: 899px) { .tg-test-fields, .tg-log-tools, .tg-dl { grid-template-columns: 1fr; } }
```

- [ ] **Step 8: Delete the trigger rules from `web/src/styles.css`** — `.triggers-page`, `.trig-scroll`, `.trig-scroll tr:has(.dot.paused) td`, `.trig-actions`, `.trig-scroll .dot` and its four state rules, `.dlv` and its three state rules, `.trigger-form`, `.trigger-form h3`, `.trig-grid`, `.trigger-form label, .trig-panel label`, `.trig-checks`, `.trig-panels`, `.trig-panel`, `.trig-panel h3, .trig-panel p`, `.trig-log`, `.row.wrap`, `.row .grow`, `.trig-result` and its two state rules, `.trig-setup` and its `dt`/`dd`/`button` rules, `.secret`, `.trig-warn`, and `.crew-head`, `.crew-head h2`, `.crew-head p` if Task 10 left them.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run --project web web/src/Triggers.test.tsx web/src/triggers web/src/rules.test.ts && npm run typecheck`
Expected: PASS (the existing tests still find "Pause acme-full-review", "Delete" / "Yes, delete", "Pull request", "Dry run", "Fire for real…", "Yes, fire", "Regenerate secret" / "Regenerate", "new-secret-value", and the status word "active").

- [ ] **Step 10: Commit**

```bash
git add web/src/Triggers.tsx web/src/Triggers.test.tsx web/src/triggers web/src/styles.css
git commit -m "feat(web): Triggers screen with board rows, a test panel, webhook setup and a sortable delivery log"
```

---

### Task 14: Team panel parity with the Runs board

**Files:**
- Create: `web/src/runs/team.css`
- Modify: `web/src/Team.tsx`, `web/src/styles.css` (delete the team rules)
- Test: `web/src/Team.test.tsx`

**Interfaces:**
- Consumes: `StatusChip`, `SectionHeading`, `ListRow` (`lead`, `title`, `meta`, `extra`, `actions`, `className`) inside a `ul.sl-list`, `Face`, Arc `RadioCards`, `Textarea`, `Select`, `Accordion`, `ChatThread`, `Button`, `ConfirmButton`; Plan A Task 18 mounts `TeamPanel` in the Runs centre pane (unchanged props).
- Produces: `TeamPanel(props: { run: RunView; send: (path: 'answers' | 'plan' | 'mode' | 'swap', body: unknown) => Promise<boolean> })` and `ModeToggle` with the same props and every current function. Look: a mode bar with a `StatusChip` ("Team run", live and pulsing while the run is live; "Team run · paused" amber when paused), the mode toggle and its hint; an amber note "The team has n questions for you."; question cards as Studio panels (ask as `h3`, "n of m", asker, why, options with a neutral "recommended" tag, own-words box); the plan as a region named "The team's plan" with a "waits for you" chip, goal, Done when, Who does what rows (face, bot, goal, expects, why, access and "swapped by you" chips, bot swap select), limits line, Reject (confirm) / Approve and start; the "Dialogue so far" accordion. Styles in `web/src/runs/team.css`.

- [ ] **Step 1: Write the failing tests** — add `import { cssText } from './test/css';` and append inside `describe('TeamPanel', …)` in `web/src/Team.test.tsx`:

```tsx
  it('shows the run state, write access and the plan with Studio chips', () => {
    const send = vi.fn().mockResolvedValue(true);
    const plan = { goal: 'Ship', success: ['429 with Retry-After'], assignments: [{ bot: 'coder', goal: 'write it', mode: 'write' as const, expected: 'a passing gate' }], limits: { allowWrites: true }, answers: [] };
    const { container } = renderApp(<TeamPanel run={teamRun({ planning: false, plan })} send={send} />);
    expect(container.querySelector('.tm-bar .sl-chip')!.classList.contains('t-live')).toBe(true);
    const region = screen.getByRole('region', { name: "The team's plan" });
    expect(region.querySelector('.sl-chip.t-needs')!.textContent).toBe('waits for you');
    expect(screen.getByText('can edit files').closest('.sl-chip')).toBeTruthy();
    expect(screen.getByText('expects: a passing gate')).toBeTruthy();
    expect(region.querySelectorAll('li.sl-row')).toHaveLength(1);
  });

  it('tags the recommended option and numbers the cards', () => {
    renderApp(<TeamPanel run={teamRun({ pending: [q('q1'), q('q2')] })} send={vi.fn().mockResolvedValue(true)} />);
    expect(screen.getAllByText('recommended')).toHaveLength(2);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Question q1?' })).toBeTruthy();
  });

  it('is styled from tokens in its own stylesheet', () => {
    expect(cssText('runs/team.css').match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(cssText('styles.css')).not.toMatch(/\.qpanel|\.qcard|\.team-bar|\.assign/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project web web/src/Team.test.tsx`
Expected: FAIL — no `.tm-bar`, the recommended tag is an Arc badge, no `team.css`.

- [ ] **Step 3: Create `web/src/runs/team.css`**

```css
/* Team panel (follows the Runs board and the component kit): mode bar, questions, plan review, dialogue. Tokens only. */
.tm-panel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.tm-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.tm-questions { display: flex; flex-direction: column; gap: 12px; }
.tm-qcard { display: flex; flex-direction: column; gap: 8px; }
.tm-qhead { display: flex; align-items: baseline; gap: 8px; }
.tm-qhead h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--ink); }
.tm-why { margin: 0; font-size: 13px; color: var(--mut); }
.tm-rec { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 5px; background: var(--s2); color: var(--mut); font-size: 11px; line-height: 18px; vertical-align: middle; }
.tm-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.tm-plan { display: flex; flex-direction: column; gap: 12px; }
.tm-goal { margin: 0; font-size: 15px; line-height: 1.5; color: var(--ink); }
.tm-block { display: flex; flex-direction: column; gap: 6px; }
.tm-block h3 { margin: 0; font-size: 12px; font-weight: 600; color: var(--mut); }
.tm-done { margin: 0; padding-left: 18px; }
.tm-assign { --row-lead: 36px; }
.tm-assign-goal { color: var(--ink); }
.tm-dialogue { min-width: 0; }
```

- [ ] **Step 4: Restyle `web/src/Team.tsx`**

Imports: remove `Badge`; add

```tsx
import { ListRow } from './ui/studio/ListRow';
import { SectionHeading } from './ui/studio/SectionHeading';
import { StatusChip } from './ui/studio/StatusChip';
import './runs/team.css';
```

Replace `QuestionCard`'s returned tree with:

```tsx
    <div className="sl-panel tm-qcard">
      <div className="tm-qhead">
        <h3>{q.ask}</h3>
        {props.total > 1 ? (
          <span className="sl-count">
            {props.index + 1} of {props.total}
          </span>
        ) : null}
      </div>
      {props.asker ? <p className="sl-meta">asked by {props.asker}</p> : null}
      {q.why ? <p className="tm-why">{q.why}</p> : null}
      <RadioCards
        layout="list"
        aria-label={q.ask}
        options={q.options.map((o) => ({
          value: o.id,
          label:
            o.id === q.recommended ? (
              <>
                {o.label}
                <span className="tm-rec">recommended</span>
              </>
            ) : (
              o.label
            ),
          description: o.detail,
        }))}
        value={pick?.option ?? null}
        onValueChange={(v) => onPick({ option: v })}
      />
      {q.allowOther ? (
        <Textarea
          label="Or in your own words"
          rows={2}
          maxLength={2000}
          value={pick?.text ?? ''}
          onChange={(e) => onPick(e.target.value ? { text: e.target.value } : undefined)}
          placeholder="Type your answer"
        />
      ) : null}
    </div>
```

Replace `TeamPanel`'s returned tree (from `return (` to the end of the component) with:

```tsx
  return (
    <div className="tm-panel">
      {active ? (
        <div className="tm-bar">
          <StatusChip tone={r.status === 'running' ? 'live' : 'needs'} label={r.status === 'running' ? 'Team run' : 'Team run · paused'} pulse={r.status === 'running' && r.live} />
          <ModeToggle mode={r.mode} disabled={busy} onPick={(m) => void props.send('mode', { mode: m })} />
          <span className="sl-meta">{MODES.find((m) => m.id === r.mode)!.hint}</span>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <>
          <p className="sl-note" role="status">
            <b>{pending.length === 1 ? 'The team has a question for you.' : `The team has ${pending.length} questions for you.`}</b>{' '}
            {r.planning ? 'Planning continues once you answer.' : 'The asking step is paused until you answer.'}
          </p>
          <section className="tm-questions" aria-label="Questions from the team">
            {pending.map((q, i) => (
              <QuestionCard key={q.id} q={q} index={i} total={pending.length} asker={askerOf(q)} pick={picks[q.id]} onPick={(p) => setPick(q.id, p)} />
            ))}
            <div className="tm-actions">
              <Button variant="secondary" disabled={busy} onClick={() => void submit(recommendations())} title="Answer every question with the option marked recommended">
                Use recommendations
              </Button>
              <Button variant="primary" loading={busy} disabled={busy || !ready} onClick={() => void submit(mine())}>
                Send answers
              </Button>
            </div>
          </section>
        </>
      ) : null}

      {planReady && plan ? (
        <section className="sl-panel tm-plan" aria-label="The team's plan">
          <SectionHeading title="Plan ready for your approval" action={<StatusChip tone="needs" label="waits for you" />} />
          <p className="tm-goal">{plan.goal}</p>
          {plan.success.length ? (
            <div className="tm-block">
              <h3>Done when</h3>
              <ul className="tm-done">
                {plan.success.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="tm-block">
            <h3>Who does what</h3>
            <ul className="sl-list tm-assign">
              {plan.assignments.map((a, i) => (
                <ListRow
                  key={`${a.bot}-${i}`}
                  lead={<Face id={a.bot} size={32} animate="hover" />}
                  title={a.bot}
                  meta={a.expected ? `expects: ${a.expected}` : undefined}
                  extra={
                    <>
                      <span className="tm-assign-goal">{a.goal}</span>
                      {a.why ? <span className="sl-meta">Why: {a.why}</span> : null}
                    </>
                  }
                  actions={
                    <>
                      <StatusChip tone="neutral" label={a.mode === 'write' ? 'can edit files' : 'read only'} />
                      {a.swapped ? <StatusChip tone="neutral" label="swapped by you" /> : null}
                      {plan.roster?.length ? (
                        // the current bot is always first so the shown value exists among the options
                        <Select
                          label="Bot"
                          options={[...new Set([a.bot, ...plan.roster])].map((b) => ({ value: b, label: b }))}
                          value={a.bot}
                          onValueChange={(b) => b !== a.bot && void props.send('swap', { assignment: i, bot: b })}
                          disabled={busy}
                        />
                      ) : null}
                    </>
                  }
                />
              ))}
            </ul>
          </div>
          <p className="sl-meta">
            Writes {plan.limits.allowWrites ? 'allowed' : 'off'}
            {plan.limits.maxCostUsd ? ` · budget ${fmtUsd(plan.limits.maxCostUsd)} in all` : ''}
            {plan.limits.maxCostUsd && r.costUsd > 0 ? ` (planning spent ${fmtUsd(r.costUsd)}, ${fmtUsd(Math.max(0, plan.limits.maxCostUsd - r.costUsd))} left)` : ''}
            {plan.limits.wallClockMs ? ` · ${Math.round(plan.limits.wallClockMs / 60_000)} min limit` : ''}
          </p>
          <div className="tm-actions">
            {/* keyed by run so a half-asked reject does not carry over to another run */}
            <ConfirmButton key={r.id} label="Reject" prompt="Cancel this run?" confirmLabel="Yes, reject" cancelLabel="Keep plan" disabled={busy} onAskingChange={setRejecting} onConfirm={() => decide(false)} />
            {rejecting ? null : (
              <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>
                Approve and start
              </Button>
            )}
          </div>
        </section>
      ) : null}

      {showDialogue ? (
        <div className="tm-dialogue">
          <Accordion
            defaultOpen={-1}
            items={[
              {
                title: `Dialogue so far (${n} answer${n === 1 ? '' : 's'})`,
                content: <ChatThread participants={participants} currentUserId="user" messages={messages} composer={false} label="Planning dialogue" />,
              },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
```

- [ ] **Step 5: Delete the team rules from `web/src/styles.css`** — the `/* team runs */` block: `.team-bar`, `.qpanel`, `.qpanel h4, .qpanel h5, .qpanel p, .qpanel ul`, `.qpanel ul`, `.qcard`, `.qcard p`, `.dialogue`, `.dialogue p`, `.assign`, `.assign-row`, `.assign-main`, and the `@media (max-width: 640px) { .team-bar, .qpanel, .dialogue … }` line.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --project web web/src/Team.test.tsx web/src/Runs.test.tsx web/src/Builder.test.tsx web/src/rules.test.ts && npm run typecheck`
Expected: PASS (the seven existing Team tests are unchanged; Runs mounts the panel; Builder still imports `ModeToggle`).

- [ ] **Step 7: Commit**

```bash
git add web/src/Team.tsx web/src/Team.test.tsx web/src/runs/team.css web/src/styles.css
git commit -m "feat(web): Team panel questions and plan review on Studio panels, chips and rows"
```

---

### Task 15: Delete the `.studio` alias and every leftover per-screen style

**Files:**
- Test: `web/src/leftovers.test.ts` (create)
- Modify: `web/src/studio.css`, `web/src/studio.test.ts`, `web/src/App.tsx`, `web/src/http/ApiTab.tsx`, `web/src/http/EnvDialog.tsx`, `web/src/http/WorkspaceDialog.tsx`, `web/src/http/SecretsDialog.tsx`, `web/src/http/ImportDialog.tsx`, `web/src/http/api.css`, `web/src/http/dialogs.test.tsx`, `web/src/http/WorkspaceDialog.test.tsx`, `web/src/http/ResponseView.test.tsx`, `web/src/styles.css`, and `web/src/rules.test.ts` only if a rule it asserts is deleted

**Interfaces:**
- Consumes: everything above.
- Produces: no `.studio` selector in any stylesheet and no `studio` class on any element; API dialogs are marked `api-dialog` (`[role="dialog"].api-dialog` keeps the rule at specificity 0,2,0, as `.studio.api-dialog` had); the JSON viewer overrides are scoped to `.api-tab .resp-body`; `web/src/styles.css` holds only rules whose classes some component uses (plus library-applied classes on an explicit list).

- [ ] **Step 1: Write the failing test** — create `web/src/leftovers.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Read from disk: vitest blanks CSS imports. The base goes through a variable so Vite leaves the URL alone.
const here = import.meta.url;
const root = fileURLToPath(new URL('./', here));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const product = walk(root).filter((p) => /\.(tsx?|css)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.startsWith(join(root, 'test')));
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const code = product
  .filter((p) => /\.tsx?$/.test(p))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');
/** Classes that libraries put on elements (blobatar's motion wrapper), not our components. */
const FROM_LIBRARIES = new Set(['mo-root', 'mo-always']);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

describe('the .studio alias is gone', () => {
  it('no stylesheet selects .studio', () => {
    const hits = product.filter((p) => p.endsWith('.css') && /\.studio\b/.test(noComments(readFileSync(p, 'utf8')))).map((p) => relative(root, p));
    expect(hits).toEqual([]);
  });
  it('no component sets the studio class', () => {
    expect(code.match(/className=(?:"|'|\{`)[^"'`]*(?<![\w-])studio(?![\w-])/g) ?? []).toEqual([]);
  });
});

describe('styles.css keeps no leftovers', () => {
  const styles = noComments(readFileSync(join(root, 'styles.css'), 'utf8'));
  it('holds no per-screen block', () => {
    for (const retired of ['.builder', '.palette', '.inspector', '.graph-view', '.g-node', '.crew-page', '.crew-card', '.bot-editor', '.triggers-page', '.trig-', '.qpanel', '.evolve-panel', '.canvas', '.node-head', '.runs ', '.run-list'])
      expect(styles, retired).not.toContain(retired);
  });
  it('styles only classes some component uses', () => {
    const classes = [...new Set([...styles.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!))];
    const unused = classes.filter((c) => !FROM_LIBRARIES.has(c) && !new RegExp(`(?<![\\w-])${escape(c)}(?![\\w-])`).test(code));
    expect(unused).toEqual([]);
  });
});
```

A class counts as used when its name appears as a whole word anywhere in component code (a `className` string, a `cn({ … })` key, or a template); that is lenient on purpose, so the test never flags a live rule.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project web web/src/leftovers.test.ts`
Expected: FAIL — `studio.css` and `http/api.css` select `.studio`; `App.tsx` and the `http/*` dialogs set `className="studio …"`; the unused-class list names whatever Plan A's Runs rebuild and this plan left behind (for example `badge`, `chip`, `dot`, `pad`, `placeholder`, `coach`, `finding`).

- [ ] **Step 3: Remove `.studio` from the stylesheets**

In `web/src/studio.css` delete the comment line `/* Kept while screens move over (deleted at the end of Plan B): … */` and the `.studio { … }` rule under it.

In `web/src/http/api.css`:
- line 1: change `Tokens come from studio.css (.studio).` to `Tokens come from the root (studio.css).`
- the three JSON-viewer lines: replace the leading `.studio .resp-body` with `.api-tab .resp-body` (run `grep -rn "<ResponseView" web/src/http` first and confirm it renders only inside `ApiTab`);
- the dialog comment: change `The whole panel carries .studio, so its chrome takes the tokens too.` to `The whole panel carries .api-dialog.`;
- `.studio.api-dialog { … }` becomes `[role="dialog"].api-dialog { width: min(calc(100vw - 32px), 600px); }`.

- [ ] **Step 4: Remove the class from components**

Replace `className="studio api-dialog"` with `className="api-dialog"` in `web/src/App.tsx`, `web/src/http/EnvDialog.tsx`, `web/src/http/WorkspaceDialog.tsx`, `web/src/http/SecretsDialog.tsx`, `web/src/http/ImportDialog.tsx` and `web/src/http/ApiTab.tsx`; in `ApiTab.tsx` also replace `className="studio api-tab api-empty"` with `className="api-tab api-empty"` and `className="studio api-tab"` with `className="api-tab"`.

Run: `grep -rn '"studio\| studio"\|\.studio\b' web/src --include='*.tsx' --include='*.css'`
Expected: matches only in test files, which Step 5 updates.

- [ ] **Step 5: Update the tests that asserted `.studio`**

- `web/src/studio.test.ts`: rename `'drops the old aliases and keeps .studio only as a base-look alias'` to `'drops the old aliases and the .studio class'` and replace `expect(studio).toMatch(/\.studio\s*{[^}]*background: var\(--bg\)/);` with `expect(studio).not.toMatch(/\.studio\b/);` (keep the other lines).
- `web/src/http/dialogs.test.tsx`: rename `'scope the whole dialog panel to .studio'` to `'mark the whole dialog panel as an API dialog'` and change `classList.contains('studio')` to `classList.contains('api-dialog')`.
- `web/src/http/WorkspaceDialog.test.tsx`: change `classList.contains('studio')` to `classList.contains('api-dialog')`.
- `web/src/http/ResponseView.test.tsx`: in the test `"flattens the JSON viewer's gradient row actions … inside the studio response"` change the title's last words to `inside the API tab` and each of the three expected strings' `.studio .resp-body` to `.api-tab .resp-body`.

- [ ] **Step 6: Delete the leftover rules from `web/src/styles.css`**

Run: `npx vitest run --project web web/src/leftovers.test.ts`
For every class in the failure's `unused` list, delete each rule in `web/src/styles.css` whose selector names it (and its lines inside any `@media` block; drop a `@media` block left empty; drop `@keyframes pulse` if no rule uses `pulse` any more). Never add a class to `FROM_LIBRARIES` unless a library (not our code) sets it — say which library in the comment. If you delete `button.primary` or `.badge`, also delete the matching `it(…)` cases in the "parity pass on styles.css" block of `web/src/rules.test.ts` (`'paints hand-built primary buttons ink'`, `'takes badge colours from tokens as tinted fills'`); keep `'keeps no hard-coded colours'` and `'never paints text in the fill-only accent'`.

- [ ] **Step 7: Run everything**

Run: `npx vitest run --project web && npx vitest run --project node && npm run typecheck && npm run build`
Expected: web all PASS; node PASS except the three known triggers failures (`/private/var` vs `/var`); typecheck and build clean.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "refactor(web): drop the .studio alias and every leftover per-screen style"
```

- [ ] **Step 9: Phase 6 check (controller, not a subagent step)** — the controller builds and serves the app and checks in Chrome, in dark and light (OS setting), with reduce motion on and off, at full width, 1024 × 768 and 390 × 844: Crew (header counts, source tabs, search, cards and chips, side editor and phone drawer, face sliders, persona loading for an ECC bot, Runs on, unsaved-switch dialog, packs, `#/crew/<bot>`), the Evolve drawer (harness, versions and roll back, proposals with picks, probe, accept/reject, lessons), Triggers (rows, switch, Test/Log/Edit/Delete, form drawer, test panel dry run, webhook setup and secret, deliveries sort/filter/refresh and a fresh row sliding in), a team run's Team panel in Runs (mode bar, question cards, plan review, swap, dialogue), and the API tab's dialogs after the `.studio` removal. No violet, no blue primary, no grey skeleton, no contrast failure, no horizontal scroll at 320 px. Fix findings, then the branch is ready for review.

---

## Spec coverage map (self-review)

| Spec requirement (§5 and §9 phase 5–6) | Task |
| --- | --- |
| Builder toolbar: open, New, name, live preflight badge toggling the issue list, flagged steps, Save when dirty and valid, Run disabled with errors or no steps | 2 (flagged steps: Canvas `issueNodes`, kept) |
| Builder discard-unsaved dialog when switching workflows | kept in `Builder.tsx` (Task 2 leaves the dialogs unchanged; covered by the existing test) |
| Builder palette (six steps) and ECC skills with search, hidden when none | 2 |
| Builder canvas: drag, connect (no duplicates, no cycles), select/Delete steps and edges, pan, wheel zoom, zoom in/out/fit, empty hint, new steps chain | 1 (controls, look), unchanged behaviour in `Canvas.tsx`/`Builder.tsx` |
| Builder inspector: pipeline settings or step editor with every field, gate Command/Request with parked command, fix step and loops, Delete step | 3 |
| Builder run dialog: Workflow/Team, team mode, repo remembered, task, auto-approve, saved API requests, Start | kept (Task 3 restyles the form class; existing tests) |
| Builder deep link `#/builder/<name>`, request gate from the API tab | kept (existing tests) |
| Builder below 900 px: view-and-run only | 3 |
| Graph: pan, wheel zoom, types with legend and counts, search with hits and dimming, select dims to neighbours and opens the note (title, type, body ≤ 6000, linked-from / links-to that open), stats line, Reload, error state, deep link | 7, 8 |
| Graph amendment: live force layout, drag springs, 1–3 hop hover, double-click/Enter glide, search pulse + count + fly, type filters fade and re-settle, Fit, Re-run, run pings + ticker, keyboard note list, reader tags and Connected, shapes not hues, reduced motion, rAF loop that stops | 4, 5, 6, 7, 8 |
| Crew: + New bot, Import/Update ECC with version dialog, Remove ECC (confirm), filter tabs with counts, cards (face opens editor, name, title, ECC badge, harness version, proposal mark, when-to-use/persona, agent select marked when unavailable, model with suggestions, Save, Unlink, Evolve for agent/verdict bots, approval note), bot editor (preview, hue/tone, reset, name, title, kind locked for built-ins, persona with full-text loading and limits, ECC note, read-only for custom agents, Save/Cancel/Remove or Reset), packs, local-models note, load error with Retry, deep link | 9, 10 |
| Evolve drawer: Close, status message, CLI hint, harness version and not-evolvable mark, persona, guidance, Versions with roll back (confirm), proposals (id, label, stale and explanation, base/made, editor cost, note, picks with field/op or role note, probe chip, diff, lessons; probe summary ≤ 10; Accept all / n of m; Pick the kept edits; Reject confirm), lessons (status, text, polarity, runs, provenance, id) | 11 |
| Triggers: + New trigger, rows with status, id/status, repo → workflow + comments chip, workspace, agent/model, events, last delivery, On switch, Test, Log, Edit, Delete confirm; load error with Retry; form with every field; test panel (trigger, PR, Dry run, Fire confirm, result with Open the run); webhook setup (tunnel hint, payload URL + copy, content type, events, secret once + copy or hint/source, Generate/Regenerate confirm, Hide, error with Retry); deliveries (filter by trigger, Refresh, sortable, run link or reason, error with Retry) | 12, 13 |
| Team panel parity with its board (question cards, plan review, dialogue) | 14 |
| Delete the `.studio` alias and leftover per-screen styles | 15 (with the per-screen deletions in 1, 2, 3, 8, 10, 11, 13, 14) |
| Each phase: tests green, typecheck and build clean, Chrome check in both themes | 8 Step 10, 15 Steps 7 and 9 |
