import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { cssText } from '../test/css';
import { renderApp } from '../test/render';
import { Goals, type GoalsProps } from './Goals';
import { glyphOf, goalMeta, type GoalView } from './goalsApi';
import { GoalsNeedYou } from './GoalsNeedYou';

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
  });
});

describe('the rows', () => {
  it('lists goals as rows with a visible amber Approve that starts the proposed run, and filters by tab', async () => {
    const set = vi.fn();
    routeApi({ 'POST /api/goals/g1/next': (b: unknown) => ({ ...loop({ status: 'active', pending: undefined }), b }) });
    const onSelect = vi.fn();
    renderApp(<Goals {...props([loop(), tracker(), loop({ id: 'g3', title: 'README covers the CLI', status: 'met' })], { onSelect, goals: { goals: [loop(), tracker(), loop({ id: 'g3', title: 'README covers the CLI', status: 'met' })], error: undefined, set, drop: vi.fn() } })} />);
    expect(screen.getByText('Login tests green')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve run' }));
    await waitFor(() => expect(calls('POST', '/api/goals/g1/next')[0]?.[2]).toEqual({ action: 'start' }));
    await waitFor(() => expect(set).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Login tests green' }));
    expect(onSelect).toHaveBeenCalledWith('g1');
    fireEvent.click(screen.getByRole('button', { name: /^Met/ }));
    expect(screen.queryByText('Ship v2 auth')).toBeNull();
    expect(screen.getByText('README covers the CLI')).toBeTruthy();
  });

  it('shows Goals waiting for you on Home and the Inbox, with the same Approve', () => {
    routeApi({});
    renderApp(<GoalsNeedYou goals={[loop(), loop({ id: 'g2', status: 'active', pending: undefined })]} onGo={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Approve run' })).toHaveLength(1);
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
  it('ticks manual items, adds one, and offers to become a loop', async () => {
    routeApi({ 'PATCH /api/goals/t1/items/2': { id: 2 }, 'POST /api/goals/t1/items': { id: 3 }, 'GET /api/goals/t1': tracker() });
    renderApp(<Goals {...props([tracker()], { selected: 't1' })} />);
    expect(screen.getByText('1 of 2 done')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Update docs' }));
    await waitFor(() => expect(calls('PATCH', '/api/goals/t1/items/2')[0]?.[2]).toEqual({ done: true }));
    fireEvent.change(screen.getByLabelText('Add an item'), { target: { value: 'Announce it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls('POST', '/api/goals/t1/items')[0]?.[2]).toEqual({ text: 'Announce it' }));
    expect(screen.getByRole('button', { name: /turn into a loop/ })).toBeTruthy();
  });
});

describe('New goal', () => {
  it('creates a loop from the dialog', async () => {
    routeApi({ 'GET /api/pipelines': [{ name: 'fix-and-verify' }], 'POST /api/goals': loop({ status: 'active', pending: undefined }) });
    renderApp(<Goals {...props([])} />);
    expect(screen.getByText('No goals yet')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'New goal' })[0]!);
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'p95 under 200 ms' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Add a finish check' }));
    fireEvent.change(await screen.findByLabelText('Command'), { target: { value: 'npm run bench' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create goal' }));
    await waitFor(() => expect(calls('POST', '/api/goals')).toHaveLength(1));
    expect(calls('POST', '/api/goals')[0]?.[2]).toMatchObject({ title: 'p95 under 200 ms', workspace: 'w', workflow: 'team', check: { kind: 'command', command: 'npm run bench' }, budgetUsd: 5, maxRuns: 5, approval: 'ask' });
  });
});
