import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { cssText } from '../test/css';
import { renderApp } from '../test/render';
import { Goals, type GoalsProps } from './Goals';
import { glyphOf, goalEvents, goalLine, goalMeta, goalScore, type GoalView } from './goalsApi';
import { GoalsNeedYou } from './GoalsNeedYou';
import { nextStrip, sections, sectionOf } from './GoalNode';

const fail = { ok: false, at: 1, summary: '1 failing · 11 passing', failing: 1, passing: 11, tail: 'FAIL login' };
const loop = (o: Partial<GoalView> = {}): GoalView => ({
  id: 'g1', workspace: 'w', title: 'Login tests green', kind: 'loop', status: 'needs_you', check: { kind: 'tests', command: 'npm test' }, budgetUsd: 5, maxRuns: 4, approval: 'ask', workflow: 'team', createdAt: 1, spentUsd: 1.2,
  lastCheck: fail, pending: { task: 'Fix the redirect after login', why: 'one test fails' }, progress: 11 / 12,
  items: [{ id: 1, goalId: 'g1', kind: 'run', text: 'Fix session expiry', runId: 'r1', done: false, at: 1, runStatus: 'done', attempt: { before: { ...fail, summary: '5 failing' }, after: fail, costUsd: 0.52 } }],
  ...o,
});
const tracker = (): GoalView => ({ ...loop(), id: 't1', title: 'Ship v2 auth', kind: 'tracker', status: 'active', check: undefined, pending: undefined, lastCheck: undefined, dueDate: '2026-11-15', progress: 0.5, items: [{ id: 1, goalId: 't1', kind: 'manual', text: 'Write migration plan', done: true, at: 1 }, { id: 2, goalId: 't1', kind: 'manual', text: 'Update docs', done: false, at: 1 }] });

const props = (goals: GoalView[], o: Partial<GoalsProps> = {}): GoalsProps => ({
  goals: { goals, error: undefined, set: vi.fn(), drop: vi.fn() },
  projects: [{ id: 'w', name: 'orders-api', path: '/p', isDefault: true, exists: true, repos: [] }],
  project: { id: 'w', name: 'orders-api', path: '/p', isDefault: true, exists: true, repos: [] },
  onSelect: vi.fn(),
  onGo: vi.fn(),
  ...o,
});

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('goal labels', () => {
  it('names the glyph, the meta line and the tracker count', () => {
    expect(glyphOf(loop())).toBe('needs');
    expect(glyphOf(loop({ status: 'met' }))).toBe('done');
    expect(goalMeta(loop())).toBe('1 failing · 11 passing · run 2 awaiting approval · $1.20 of $5.00');
    expect(goalMeta(tracker())).toBe('1 of 2 done · due 2026-11-15');
    expect(goalMeta(loop({ status: 'stopped', reason: 'Budget reached' }))).toBe('Budget reached · 1 run');
    expect(goalLine(loop())).toBe('loop · 1 of 4 runs');
    expect(goalLine(tracker())).toBe('tracker · 1 of 2 done');
  });
});

describe('sections', () => {
  it('puts needs you and active in Now (needs you first), paused in Up next, met and stopped in Done (newest end first)', () => {
    expect(sectionOf(loop({ status: 'needs_you' }))).toBe('now');
    expect(sectionOf(loop({ status: 'active' }))).toBe('now');
    expect(sectionOf(loop({ status: 'paused' }))).toBe('next');
    expect(sectionOf(loop({ status: 'met' }))).toBe('done');
    expect(sectionOf(loop({ status: 'stopped' }))).toBe('done');
    const s = sections([
      loop({ id: 'a', status: 'active' }),
      loop({ id: 'b', status: 'needs_you' }),
      loop({ id: 'p', status: 'paused' }),
      loop({ id: 'old', status: 'met', endedAt: 10 }),
      loop({ id: 'new', status: 'stopped', endedAt: 30 }),
      // an old goal with no endedAt falls back to its last item's time
      loop({ id: 'mid', status: 'met', endedAt: undefined, items: [{ ...loop().items[0]!, at: 20 }] }),
    ]);
    expect(s.now.map((g) => g.id)).toEqual(['b', 'a']);
    expect(s.next.map((g) => g.id)).toEqual(['p']);
    expect(s.done.map((g) => g.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('the next strip', () => {
  it('needs you with a plan: amber "Needs you:", the task and Approve', () => {
    expect(nextStrip(loop())).toEqual({ label: 'Needs you:', text: 'Fix the redirect after login', action: 'approve', tone: 'needs' });
  });
  it('an active loop: "Step n of m:", the running item and Watch', () => {
    const running = loop({ status: 'active', pending: undefined, items: [{ id: 2, goalId: 'g1', kind: 'run', text: 'Fix session expiry\nmore', runId: 'r2', done: false, at: 1, runStatus: 'running', attempt: {} }] });
    expect(nextStrip(running)).toEqual({ label: 'Step 1 of 4:', text: 'Fix session expiry', action: 'watch', tone: 'live' });
  });
  it('an active tracker: "Next:", the first unchecked item and Open', () => {
    expect(nextStrip(tracker())).toEqual({ label: 'Next:', text: 'Update docs', action: 'open', tone: 'live' });
  });
});

describe('the goals page', () => {
  it('shows Now as equal goal nodes with their next strip, Up next and Done as quiet rows, and no tabs', async () => {
    const set = vi.fn();
    routeApi({ 'POST /api/goals/g1/next': (b: unknown) => ({ ...loop({ status: 'active', pending: undefined }), b }) });
    const onSelect = vi.fn();
    const all = [loop(), tracker(), loop({ id: 'p1', title: 'Cache warmup', status: 'paused', dueDate: '2026-11-30' }), loop({ id: 'g3', title: 'README covers the CLI', status: 'met', endedAt: new Date(2026, 9, 20).getTime() })];
    renderApp(<Goals {...props(all, { onSelect, goals: { goals: all, error: undefined, set, drop: vi.fn() } })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Goals' })).toBeTruthy();
    expect(screen.getByText('orders-api')).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Show goals' })).toBeNull();
    const now = screen.getByRole('region', { name: 'Now' });
    expect(within(now).getAllByRole('toolbar').map((t) => t.getAttribute('aria-label'))).toEqual(['Login tests green actions', 'Ship v2 auth actions']);
    // a tracker's arc has Add a step; a loop's does not
    expect(within(within(now).getByRole('toolbar', { name: 'Ship v2 auth actions' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Copy link', 'Add a step', 'Duplicate', 'Settings']);
    expect(within(within(now).getByRole('toolbar', { name: 'Login tests green actions' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Copy link', 'Duplicate', 'Settings']);
    expect(within(now).getByText('Feature · Needs you')).toBeTruthy();
    expect(within(now).getByText('Feature · Open')).toBeTruthy();
    fireEvent.click(within(now).getByRole('button', { name: 'Approve run' }));
    await waitFor(() => expect(calls('POST', '/api/goals/g1/next')[0]?.[2]).toEqual({ action: 'start' }));
    await waitFor(() => expect(set).toHaveBeenCalled());
    const next = screen.getByRole('region', { name: 'Up next' });
    expect(within(next).getByText('Cache warmup')).toBeTruthy();
    expect(within(next).getByText('Due Nov 30')).toBeTruthy();
    const done = screen.getByRole('region', { name: 'Done' });
    expect(within(done).getByText('Oct 20')).toBeTruthy();
    fireEvent.click(within(done).getByRole('button', { name: 'README covers the CLI' }));
    expect(onSelect).toHaveBeenCalledWith('g3');
    // hovering a row opens it into the full node
    fireEvent.pointerEnter(within(next).getByRole('listitem'));
    expect(within(next).getByRole('toolbar', { name: 'Cache warmup actions' })).toBeTruthy();
    fireEvent.pointerLeave(within(next).getByRole('listitem'));
    expect(within(next).queryByRole('toolbar')).toBeNull();
  });

  it('clicking a node opens the detail', () => {
    routeApi({});
    const onSelect = vi.fn();
    renderApp(<Goals {...props([loop(), tracker()], { onSelect })} />);
    fireEvent.click(within(screen.getByRole('region', { name: 'Now' })).getByRole('button', { name: 'Ship v2 auth' }));
    expect(onSelect).toHaveBeenCalledWith('t1');
  });

  it('an empty Now shows a quiet line, and each empty list its own', () => {
    routeApi({});
    renderApp(<Goals {...props([loop({ status: 'paused' })])} />);
    expect(within(screen.getByRole('region', { name: 'Now' })).getByText('Nothing in progress.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Done' })).getByText('Nothing finished yet.')).toBeTruthy();
  });

  it('6 assignees show 3 avatars and +3, on the node and on a row', () => {
    routeApi({});
    const six = ['coder', 'reviewer', 'tester', 'planner', 'architect', 'approval'].map((id) => ({ kind: 'agent' as const, id }));
    const { container } = renderApp(<Goals {...props([loop({ assignees: six }), loop({ id: 'p1', status: 'paused', assignees: six })])} />);
    const stacks = container.querySelectorAll('.gav');
    expect(stacks).toHaveLength(2);
    for (const st of stacks) {
      expect(st.querySelectorAll('.gav-face')).toHaveLength(3);
      expect(st.textContent).toContain('+3');
      expect(st.getAttribute('aria-label')).toBe('Assigned to Bolt, Lens, Probe and 3 more');
    }
  });

  it('a removed assignee renders as a grey "removed" avatar', () => {
    routeApi({});
    const { container } = renderApp(<Goals {...props([loop({ assignees: [{ kind: 'agent', id: 'ghost' }, { kind: 'team', id: 'gone' }, { kind: 'team', id: 'core' }] })], { teams: { teams: [{ id: 'core', name: 'Core', place: 'tether', project: 'w', agents: [], status: 'idle' }], agents: [] } })} />);
    const faces = [...container.querySelectorAll('.gav-face')];
    expect(faces.map((f) => f.getAttribute('title'))).toEqual(['ghost (removed)', 'gone (removed)', 'Core']);
    expect(faces[0]!.className).toContain('removed');
    expect(faces[2]!.className).toContain('team');
    expect(faces[2]!.textContent).toBe('C');
  });

  it('a node keeps its fixed height with a long title or description; the strip never moves', () => {
    const css = cssText('goals/goals.css');
    expect(css).toMatch(/\.gn-node \{[^}]*height: 168px/);
    expect(css).toMatch(/\.gn-title \{[^}]*-webkit-line-clamp: 2/);
    expect(css).toMatch(/\.gn-desc \{[^}]*-webkit-line-clamp: 2/);
    expect(css).toMatch(/\.gn-strip \{[^}]*height: 48px/);
    expect(css).toMatch(/\.gn-grid \{[^}]*grid-template-columns: repeat\(3,minmax\(0,1fr\)\); gap: 16px/);
    routeApi({});
    renderApp(<Goals {...props([loop({ title: 'x'.repeat(120), description: 'y'.repeat(500) })])} />);
    const title = screen.getByRole('button', { name: 'x'.repeat(120) });
    expect(title.closest('.gn-node')).toBeTruthy();
  });

  it('takes a column off while a panel is docked, and the status shrinks rather than spill out of the node', () => {
    const css = cssText('goals/goals.css');
    expect(css).toMatch(/\.gl-screen\.docked \.gn-grid \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
    expect(css).toMatch(/\.gn-status \{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis/);
  });

  it('lifts and dims with CSS only, and not under reduced motion', () => {
    const css = cssText('goals/goals.css');
    // keyboard focus lifts and dims; a mouse click (which focuses the button in Chromium) leaves nothing stuck
    expect(css).toMatch(/\.gn-grid:has\(\.gn-mod:hover,\.gn-mod :focus-visible\) \.gn-mod:not\(:hover\):not\(:has\(:focus-visible\)\) \{ opacity: 0\.35/);
    expect(css).toMatch(/\.gn-mod:has\(:focus-visible\) > \.gn-node/);
    expect(css).not.toMatch(/\.gn-mod:focus-within/);
    expect(css).toMatch(/translateY\(-4px\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.gn-node[^}]*transform: none/);
  });
});

describe('Goals waiting for you', () => {
  it('shows Goals waiting for you on Home and the Inbox, with the same Approve', () => {
    routeApi({});
    renderApp(<GoalsNeedYou goals={[loop(), loop({ id: 'g2', status: 'active', pending: undefined })]} onGo={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Approve run' })).toHaveLength(1);
  });
});

describe('the detail page', () => {
  it('an unknown id shows the goals page', () => {
    routeApi({});
    renderApp(<Goals {...props([tracker(), loop()], { selected: 'gone' })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Goals' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Ship v2 auth' })).toBeNull();
  });

  it('goes back to the goals page', () => {
    routeApi({});
    const onSelect = vi.fn();
    renderApp(<Goals {...props([loop()], { selected: 'g1', onSelect })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to goals' }));
    expect(onSelect).toHaveBeenCalledWith();
  });

  it('puts the goal actions in the top bar and the limits at the bottom', async () => {
    const active = loop({ status: 'active', pending: undefined });
    routeApi({ 'PATCH /api/goals/g1': (b: object) => ({ ...active, ...b }) });
    renderApp(<Goals {...props([active], { selected: 'g1' })} />);
    const limits = screen.getByRole('group', { name: 'Limits' });
    expect(within(limits).getByRole('progressbar', { name: 'Budget used' }).getAttribute('aria-valuenow')).toBe('24');
    expect(within(limits).getByRole('progressbar', { name: 'Runs used' }).getAttribute('aria-valuenow')).toBe('25');
    fireEvent.click(within(limits).getByRole('button', { name: 'Auto' }));
    await waitFor(() => expect(calls('PATCH', '/api/goals/g1')[0]?.[2]).toEqual({ approval: 'auto' }));
    const bar = screen.getByRole('group', { name: 'Goal actions' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Pause goal' }));
    await waitFor(() => expect(calls('PATCH', '/api/goals/g1')[1]?.[2]).toEqual({ status: 'paused' }));
    expect(within(bar).getByRole('button', { name: 'Stop' })).toBeTruthy();
    // Duplicate shows where today offers it: a loop with a proposed next run
    expect(within(bar).queryByRole('button', { name: 'Duplicate' })).toBeNull();
    expect(within(bar).getAllByRole('button').at(-1)!.textContent).toBe('+ New goal');
    fireEvent.click(within(bar).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('complementary', { name: 'Goal settings' })).toBeTruthy();
  });

  it('deletes from the Settings dock after asking', async () => {
    const drop = vi.fn();
    const onSelect = vi.fn();
    routeApi({ 'PATCH /api/goals/g1': (b: object) => ({ ...loop(), ...b }), 'DELETE /api/goals/g1': {} });
    renderApp(<Goals {...props([loop()], { selected: 'g1', onSelect, goals: { goals: [loop()], error: undefined, set: vi.fn(), drop } })} />);
    const bar = screen.getByRole('group', { name: 'Goal actions' });
    expect(within(bar).getByRole('button', { name: 'Duplicate' })).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Settings' }));
    let dock = screen.getByRole('complementary', { name: 'Goal settings' });
    fireEvent.change(within(dock).getByLabelText('Budget ($)'), { target: { value: '8' } });
    fireEvent.click(within(dock).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('PATCH', '/api/goals/g1')[0]?.[2]).toEqual({ budgetUsd: 8, maxRuns: 4, dueDate: null }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Goal settings' })).toBeNull());
    fireEvent.click(within(bar).getByRole('button', { name: 'Settings' }));
    dock = screen.getByRole('complementary', { name: 'Goal settings' });
    fireEvent.click(within(dock).getByRole('button', { name: 'Delete goal…' }));
    expect(within(dock).getByText('Delete Login tests green?')).toBeTruthy();
    fireEvent.click(within(dock).getByRole('button', { name: 'Delete goal' }));
    await waitFor(() => expect(calls('DELETE', '/api/goals/g1')).toHaveLength(1));
    expect(drop).toHaveBeenCalledWith('g1');
    expect(onSelect).toHaveBeenCalledWith();
    expect(screen.queryByRole('complementary', { name: 'Goal settings' })).toBeNull();
  });
});

describe('a goal’s score and history', () => {
  it('scores from real factors only, with equal weights', () => {
    const s = goalScore(loop());
    expect(s.criteria.map((c) => [c.label, Math.round(c.score * 100) / 100, c.weight, c.note])).toEqual([
      ['Finish check', 9.17, 1, '1 failing · 11 passing'],
      ['Budget left', 7.6, 1, '$1.20 of $5.00 spent'],
      ['Runs left', 7.5, 1, '1 of 4 runs'],
    ]);
    expect(s).toMatchObject({ verdict: 'Needs you', outOf: 10 });
    expect(s.total).toBeCloseTo((9.1667 + 7.6 + 7.5) / 3, 2);
    expect(goalScore(loop({ lastCheck: undefined })).criteria[0]).toMatchObject({ score: 0, note: 'not checked yet' });
    expect(goalScore(loop({ lastCheck: { ok: true, at: 1, tail: '' }, spentUsd: 9 })).criteria.map((c) => c.score)).toEqual([10, 0, 7.5]);
    expect(goalScore(tracker())).toMatchObject({ verdict: 'Open', total: 5, criteria: [{ label: 'Items done', note: '1 of 2' }] });
  });

  it('tells a loop’s history in order: created, runs and their checks, the run going now, the next one proposed', () => {
    // the last check is the latest run's check: told once
    const g = loop({ createdAt: 10, lastCheck: { ...fail, at: 30 }, items: [{ ...loop().items[0]!, at: 20, attempt: { after: { ...fail, at: 30 } } }, { id: 2, goalId: 'g1', kind: 'run', text: 'Fix redirect', runId: 'rmh15a22', done: false, at: 40 }] });
    expect(goalEvents(g).map((e) => [e.when, e.title, e.detail])).toEqual([
      ['past', 'Goal created', 'check: npm test'],
      ['past', 'Run R-R1', 'Fix session expiry'],
      ['past', 'Check failed', '1 failing · 11 passing'],
      ['now', 'Run R-5A22 working', 'Fix redirect'],
      ['future', 'Next run, waiting for you', 'Fix the redirect after login'],
    ]);
    expect(goalEvents(loop({ status: 'met', pending: undefined })).map((e) => e.when)).not.toContain('now');
  });
});

describe('the loop flow', () => {
  it('draws the check, each attempt and the dashed next run, with fans that are keyboard reachable and never delete', async () => {
    routeApi({ 'POST /api/goals/g1/next': loop({ status: 'active', pending: undefined }) });
    const onGo = vi.fn();
    renderApp(<Goals {...props([loop()], { selected: 'g1', onGo })} />);
    const flow = screen.getByRole('list', { name: 'Loop flow' });
    const check = within(flow).getByRole('toolbar', { name: 'Finish check actions' });
    expect(within(check).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Run check', 'Edit command', 'Settings']);
    const attempt = within(flow).getByRole('toolbar', { name: 'Run 1 actions' });
    expect(within(attempt).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Open run', 'Retry', 'View diff']);
    const next = within(flow).getByRole('toolbar', { name: 'Next run actions' });
    expect(within(next).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Duplicate goal', 'Settings']);
    // no fan can delete
    for (const b of within(flow).getAllByRole('toolbar').flatMap((t) => [...t.querySelectorAll('button')])) expect(b.className).not.toMatch(/danger/);
    // fans are in the Tab order and the arrows move inside one
    const open = within(attempt).getByRole('button', { name: 'Open run' });
    expect(open.tabIndex).toBe(0);
    open.focus();
    fireEvent.keyDown(attempt, { key: 'ArrowRight' });
    fireEvent.click(within(attempt).getByRole('button', { name: 'Open run' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1' });
    // the next run is an approval: its buttons are out in the open, not in the fan
    expect(within(next).queryByRole('button', { name: 'Start run' })).toBeNull();
    fireEvent.click(within(flow).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(calls('POST', '/api/goals/g1/next')[0]?.[2]).toEqual({ action: 'start', plan: 'Fix the redirect after login' }));
    expect(within(flow).getByRole('button', { name: 'Edit plan' })).toBeTruthy();
    expect(within(flow).getByRole('button', { name: 'Skip' })).toBeTruthy();
    // a status dot is named, never colour alone
    expect(within(flow).getByRole('img', { name: 'Check still failing' })).toBeTruthy();
  });

  it('on auto the visible button says Start now; the plan can be edited before it starts', async () => {
    routeApi({ 'POST /api/goals/g1/next': loop() });
    renderApp(<Goals {...props([loop({ approval: 'auto' })], { selected: 'g1' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }));
    fireEvent.change(screen.getByLabelText('Plan for the next run'), { target: { value: 'Smaller change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }));
    await waitFor(() => expect(calls('POST', '/api/goals/g1/next')[0]?.[2]).toEqual({ action: 'start', plan: 'Smaller change' }));
  });

  it('moves with reduced motion honoured', () => {
    expect(cssText('goals/goals.css')).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('the tracker', () => {
  it('ticks manual items, adds one, and turns into a loop from the bar', async () => {
    routeApi({ 'PATCH /api/goals/t1/items/2': { id: 2 }, 'POST /api/goals/t1/items': { id: 3 }, 'GET /api/goals/t1': tracker() });
    renderApp(<Goals {...props([tracker()], { selected: 't1' })} />);
    expect(screen.getByText('1 of 2 done')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Update docs' }));
    await waitFor(() => expect(calls('PATCH', '/api/goals/t1/items/2')[0]?.[2]).toEqual({ done: true }));
    fireEvent.change(screen.getByLabelText('Add an item'), { target: { value: 'Announce it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls('POST', '/api/goals/t1/items')[0]?.[2]).toEqual({ text: 'Announce it' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Goal actions' })).getByRole('button', { name: 'Turn into a loop' }));
    expect(await screen.findByRole('dialog', { name: 'Add a finish check' })).toBeTruthy();
  });
});

describe('New goal', () => {
  it('creates a loop from the dock', async () => {
    routeApi({ 'GET /api/pipelines': [{ name: 'fix-and-verify' }], 'POST /api/goals': loop({ status: 'active', pending: undefined }) });
    const onSelect = vi.fn();
    renderApp(<Goals {...props([], { onSelect })} />);
    expect(screen.getByText(/No goals yet/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '+ New goal' })[0]!);
    fireEvent.click(within(await screen.findByRole('menu', { name: '+ New goal' })).getByRole('menuitem', { name: 'Feature' }));
    const dock = screen.getByRole('complementary', { name: 'New goal' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(within(dock).getByLabelText('Title'), { target: { value: 'p95 under 200 ms' } });
    fireEvent.click(within(dock).getByRole('switch', { name: 'Add a finish check' }));
    fireEvent.change(await within(dock).findByLabelText('Command'), { target: { value: 'npm run bench' } });
    fireEvent.click(within(dock).getByRole('button', { name: 'Create goal' }));
    await waitFor(() => expect(calls('POST', '/api/goals')).toHaveLength(1));
    expect(calls('POST', '/api/goals')[0]?.[2]).toMatchObject({ title: 'p95 under 200 ms', workspace: 'w', workflow: 'team', check: { kind: 'command', command: 'npm run bench' }, budgetUsd: 5, maxRuns: 5, approval: 'ask' });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('g1'));
    expect(screen.queryByRole('complementary', { name: 'New goal' })).toBeNull();
  });
});

const roster = { teams: [{ id: 'core', name: 'Core', place: 'tether' as const, project: 'w', agents: ['coder'], status: 'idle' as const }], agents: [{ id: 'coder', name: 'Bolt', specialty: 'coder' }, { id: 'reviewer', name: 'Lens', specialty: 'reviewer' }] };

describe('owner and assignees', () => {
  it('assignee picker saves via PATCH, with Teams and Agents as groups', async () => {
    const set = vi.fn();
    routeApi({ 'PATCH /api/goals/g1': (b: object) => ({ ...loop(), ...b }) });
    renderApp(<Goals {...props([loop()], { selected: 'g1', teams: roster, goals: { goals: [loop()], error: undefined, set, drop: vi.fn() } })} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Assignees' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Teams', 'Agents']);
    fireEvent.click(within(list).getByRole('option', { name: 'Core' }));
    await waitFor(() => expect(calls('PATCH', '/api/goals/g1')[0]?.[2]).toEqual({ assignees: [{ kind: 'team', id: 'core' }] }));
    await waitFor(() => expect(set).toHaveBeenCalled());
  });

  it('lists every assignee as chosen, a removed one included', () => {
    routeApi({});
    const six = [{ kind: 'team' as const, id: 'core' }, { kind: 'team' as const, id: 'gone' }, ...['coder', 'reviewer', 'tester', 'ghost'].map((id) => ({ kind: 'agent' as const, id }))];
    renderApp(<Goals {...props([loop({ assignees: six })], { selected: 'g1', teams: roster })} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Assignees' }));
    const chosen = within(screen.getByRole('listbox')).getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(chosen.map((o) => o.getAttribute('aria-label'))).toEqual(['Core', 'gone (removed)', 'Bolt', 'Lens', 'Probe', 'ghost (removed)']);
  });

  it('step picker saves via item PATCH, on a loop run and a tracker row', async () => {
    routeApi({ 'PATCH /api/goals/g1/items/1': { id: 1 }, 'GET /api/goals/g1': loop() });
    renderApp(<Goals {...props([loop()], { selected: 'g1', teams: roster })} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Who works on Run 1' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Bolt' }));
    await waitFor(() => expect(calls('PATCH', '/api/goals/g1/items/1')[0]?.[2]).toEqual({ assignees: [{ kind: 'agent', id: 'coder' }] }));
  });

  it('a tracker row has the compact step picker too', async () => {
    routeApi({ 'PATCH /api/goals/t1/items/2': { id: 2 }, 'GET /api/goals/t1': tracker() });
    renderApp(<Goals {...props([tracker()], { selected: 't1', teams: roster })} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Who works on Update docs' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Core' }));
    await waitFor(() => expect(calls('PATCH', '/api/goals/t1/items/2')[0]?.[2]).toEqual({ assignees: [{ kind: 'team', id: 'core' }] }));
  });

  it('owner pill shows team/agent when set and is read-only', () => {
    routeApi({});
    const { unmount } = renderApp(<Goals {...props([loop({ team: 'core', agent: 'coder' })], { selected: 'g1', teams: roster })} />);
    const owner = screen.getByRole('group', { name: 'Owner' });
    expect(owner.textContent).toContain('Bolt');
    expect(owner.textContent).toContain('Core');
    expect(within(owner).queryByRole('button')).toBeNull();
    expect(within(owner).queryByRole('combobox')).toBeNull();
    unmount();
    renderApp(<Goals {...props([loop()], { selected: 'g1', teams: roster })} />);
    expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull();
  });
});

describe('type and description', () => {
  it('settings changes type and description', async () => {
    routeApi({ 'PATCH /api/goals/g1': (b: object) => ({ ...loop(), ...b }) });
    renderApp(<Goals {...props([loop()], { selected: 'g1' })} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Goal actions' })).getByRole('button', { name: 'Settings' }));
    const dock = screen.getByRole('complementary', { name: 'Goal settings' });
    fireEvent.click(within(dock).getByRole('button', { name: 'Bug fix' }));
    fireEvent.change(within(dock).getByLabelText('Description'), { target: { value: 'Users get logged out after a minute.' } });
    fireEvent.click(within(dock).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('PATCH', '/api/goals/g1')[0]?.[2]).toEqual({ budgetUsd: 5, maxRuns: 4, dueDate: null, type: 'bugfix', description: 'Users get logged out after a minute.' }));
  });

  it('new goal form sends type and description', async () => {
    routeApi({ 'GET /api/pipelines': [], 'POST /api/goals': tracker() });
    renderApp(<Goals {...props([])} />);
    fireEvent.click(screen.getByRole('button', { name: '+ New goal' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Feature' }));
    const dock = screen.getByRole('complementary', { name: 'New goal' });
    fireEvent.change(within(dock).getByLabelText('Title'), { target: { value: 'Tidy auth' } });
    fireEvent.click(within(dock).getByRole('button', { name: 'Refactor' }));
    fireEvent.change(within(dock).getByLabelText('Description'), { target: { value: 'Split the session module.' } });
    fireEvent.click(within(dock).getByRole('button', { name: 'Create goal' }));
    await waitFor(() => expect(calls('POST', '/api/goals')).toHaveLength(1));
    expect(calls('POST', '/api/goals')[0]?.[2]).toMatchObject({ title: 'Tidy auth', type: 'refactor', description: 'Split the session module.' });
  });
});

describe('create menus', () => {
  it('New goal menu opens form with type preset', async () => {
    routeApi({ 'GET /api/pipelines': [], 'POST /api/goals': tracker() });
    renderApp(<Goals {...props([])} />);
    const trigger = screen.getByRole('button', { name: '+ New goal' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(trigger);
    const menu = await screen.findByRole('menu', { name: '+ New goal' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.getAttribute('aria-label'))).toEqual(['Feature', 'Bug fix', 'Refactor', 'Chore']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Bug fix' }));
    const dock = screen.getByRole('complementary', { name: 'New goal' });
    expect(within(dock).getByRole('button', { name: 'Bug fix' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(within(dock).getByLabelText('Title'), { target: { value: 'Logout bug' } });
    fireEvent.click(within(dock).getByRole('button', { name: 'Create goal' }));
    await waitFor(() => expect(calls('POST', '/api/goals')[0]?.[2]).toMatchObject({ title: 'Logout bug', type: 'bugfix' }));
  });
});
