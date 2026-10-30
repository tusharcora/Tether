import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, ApiError, type AttemptsReply, type AttemptView, type ProcMessage, type RunView } from '../api';
import { Runs } from '../Runs';
import { calls, FakeEventSource, makeRow, makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Compare } from './Compare';
import { Preview } from './Preview';
import { RewindBanner } from './Rewind';
import { RunList } from './RunList';
import { applyProc, exitLine, Terminal } from './Terminal';

/** A paused run whose plan and code steps are done (code with a commit) and whose gate waits. */
const doneRun = (o: Partial<RunView> = {}) => {
  const base = makeRun();
  return makeRun({
    status: 'paused',
    live: false,
    nodes: { ...base.nodes, code: { status: 'done', attempts: 1, costUsd: 0.07, loops: 0, commit: 'c1', output: 'done' } },
    ...o,
  });
};
const page = (run: RunView, props: Partial<Parameters<typeof Runs>[0]> = {}) => {
  const p = { onSelect: vi.fn(), onSelectNode: vi.fn(), onGo: vi.fn(), ...props };
  renderApp(<Runs selected="r1" {...p} />);
  act(() => FakeEventSource.all[0]!.emit('state', run));
  return p;
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  localStorage.clear();
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

const base = {
  'GET /api/runs': [makeRow()],
  'GET /api/runs/r1/events': [],
  'GET /api/runs/r1/events?chunks=1': [],
  'GET /api/runs/r1/diff': { diff: '' },
  'GET /api/runs/r1/diff?node=code': { diff: '' },
};

describe('a step’s ⋯ menu: rewind and fork', () => {
  it('is on finished steps only, keyboard-operable, and Rewind asks first', async () => {
    routeApi({ ...base, 'POST /api/runs/r1/rewind': doneRun() });
    page(doneRun());
    const story = await screen.findByRole('navigation', { name: 'What happened' });
    expect(within(story).queryByRole('button', { name: /Step actions for Probe/ })).toBeNull();
    const dots = within(story).getByRole('button', { name: 'Step actions for Bolt made the changes' });
    fireEvent.click(dots);
    const menu = screen.getByRole('menu', { name: 'Step actions' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Rewind to before this stepundo its code and everything after', 'Fork from after this stepa new run starting from here', 'Open its changes']);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(dots);
    fireEvent.click(screen.getByRole('menuitem', { name: /Rewind to before this step/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Undo “Bolt” and everything after?' });
    expect(within(dialog).getByText('You can undo the rewind until the run moves on.')).toBeTruthy();
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Rewind' })));
    expect(calls('POST', '/api/runs/r1/rewind')[0]![2]).toEqual({ node: 'code' });
  });

  it('a live run is stopped first (Stop & rewind), the rewind tried until it lets go', async () => {
    let tries = 0;
    routeApi({ ...base, 'POST /api/runs/r1/stop': doneRun(), 'POST /api/runs/r1/rewind': () => (++tries < 2 ? new ApiError('the run is still going: stop it first', 409) : doneRun()) });
    page(doneRun({ status: 'running', live: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Step actions for Scout looked into it' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Rewind/ }));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Stop & rewind' })));
    await waitFor(() => expect(calls('POST', '/api/runs/r1/rewind')).toHaveLength(2), { timeout: 2000 });
    expect(calls('POST', '/api/runs/r1/stop')).toHaveLength(1);
  });

  it('Fork starts a new run from after the step and opens it; Open its changes shows the step’s diff', async () => {
    routeApi({ ...base, 'POST /api/runs/r1/fork': { id: 'r2' } });
    const p = page(doneRun());
    fireEvent.click(await screen.findByRole('button', { name: 'Step actions for Bolt made the changes' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: /Fork/ })));
    expect(calls('POST', '/api/runs/r1/fork')[0]![2]).toEqual({ node: 'code' });
    await waitFor(() => expect(p.onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Step actions for Bolt made the changes' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open its changes' }));
    expect(screen.getByRole('tab', { name: /Changes/ }).getAttribute('aria-selected')).toBe('true');
    expect(p.onSelectNode).toHaveBeenLastCalledWith('code');
  });

  it('after a rewind: the banner with Undo and Resume', () => {
    const onAct = vi.fn(async () => true);
    renderApp(<RewindBanner run={doneRun({ status: 'stopped', rewind: { node: 'code', ref: 'refs/tether/rewind/r1/1', base: 'b', status: 'paused', nodes: {} } })} name={() => 'Code'} onAct={onAct} />);
    expect(screen.getByText('Rewound to before “Code”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAct).toHaveBeenLastCalledWith('rewind/undo');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onAct).toHaveBeenLastCalledWith('resume');
  });
});

const attempt = (o: Partial<AttemptView>): AttemptView => ({ id: 'r1', label: 'A', status: 'paused', live: false, bot: 'coder', agent: 'claude', model: 'sonnet', free: false, files: 4, added: 96, deleted: 31, costUsd: 0.31, durationMs: 360_000, ...o });
const SET: AttemptsReply = {
  set: 'aset1',
  task: 'Faster search results',
  pick: 'r1',
  runs: [
    attempt({ check: { ok: true, passing: 41 }, review: { bot: 'reviewer', line: 'clean, adds an index' }, excerpt: { file: 'search/query.ts', lines: ['+ const idx = buildIndex(items);'] } }),
    attempt({ id: 'r2', label: 'B', agent: 'openrouter', model: 'kimi:free', free: true, check: { ok: true, passing: 41 }, files: 2, added: 38, deleted: 12, costUsd: 0 }),
    attempt({ id: 'r3', label: 'C', status: 'error', agent: 'nvidia', check: { ok: false, failing: 2 }, error: 'broke empty-query handling' }),
  ],
};

describe('try more ways', () => {
  it('the header’s Try 2 more ways pre-fills the picks, starts them and opens Compare', async () => {
    routeApi({
      ...base,
      'GET /api/runs/r1/attempts?count=4': { picks: [{ agent: 'openrouter', model: 'kimi:free' }, { agent: 'codex' }, null, null], choices: [{ agent: 'openrouter', model: 'kimi:free' }, { agent: 'codex' }], original: { agent: 'claude' } },
      'POST /api/runs/r1/attempts': { ids: ['r2', 'r3', 'r4'], set: 'aset1' },
    });
    const p = page(doneRun());
    fireEvent.click(await screen.findByRole('button', { name: 'Try 2 more ways' }));
    const dialog = await screen.findByRole('dialog', { name: 'Try more ways' });
    await within(dialog).findByLabelText('Way 1');
    expect((within(dialog).getByLabelText('Way 1') as HTMLSelectElement).value).toBe('openrouter|kimi:free');
    expect((within(dialog).getByLabelText('Way 2') as HTMLSelectElement).value).toBe('codex|');
    fireEvent.change(within(dialog).getByLabelText('How many more'), { target: { value: '3' } });
    expect((within(dialog).getByLabelText('Way 3') as HTMLSelectElement).value).toBe('claude|');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Start 3 more' })));
    expect(calls('POST', '/api/runs/r1/attempts')[0]![2]).toEqual({ count: 3, agents: [{ agent: 'openrouter', model: 'kimi:free' }, { agent: 'codex' }, { agent: 'claude' }] });
    expect(p.onGo).toHaveBeenCalledWith({ tab: 'attempts', id: 'aset1' });
  });

  it('a run in a set says which attempt it is and opens Compare', async () => {
    routeApi({ ...base, 'GET /api/attempts/aset1': SET });
    const p = page(doneRun({ attemptSet: 'aset1', attemptLabel: 'A' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Attempt A of 3 · Compare' }));
    expect(p.onGo).toHaveBeenCalledWith({ tab: 'attempts', id: 'aset1' });
  });

  it('Compare: one column per attempt, Tether’s pick, Pick and ship, Retry a failed one, Try 1 more way', async () => {
    routeApi({ 'GET /api/attempts/aset1': SET, 'POST /api/attempts/aset1/pick': SET, 'POST /api/runs/r3/resume': makeRun(), 'POST /api/runs/r1/attempts': { ids: ['r4'], set: 'aset1' } });
    const onGo = vi.fn();
    renderApp(<Compare set="aset1" onGo={onGo} />);
    const a = await screen.findByRole('region', { name: 'Attempt A' });
    expect(screen.getByRole('heading', { level: 1, name: 'Faster search results' })).toBeTruthy();
    expect(screen.getByText('3 attempts')).toBeTruthy();
    expect(screen.getByText('2 pass the check')).toBeTruthy();
    expect(within(a).getByText('Tether’s pick')).toBeTruthy();
    expect(within(a).getByText('passes · 41 tests')).toBeTruthy();
    expect(within(a).getByText('Lens: clean, adds an index')).toBeTruthy();
    expect(within(a).getByText('+ const idx = buildIndex(items);')).toBeTruthy();
    const b = screen.getByRole('region', { name: 'Attempt B' });
    expect(within(b).getByText('openrouter · kimi:free · free')).toBeTruthy();
    const c = screen.getByRole('region', { name: 'Attempt C' });
    expect(c.className).toContain('dim');
    expect(within(c).getByText('2 tests fail')).toBeTruthy();
    expect(within(c).getByText('broke empty-query handling')).toBeTruthy();
    expect(within(c).queryByRole('button', { name: /Pick C/ })).toBeNull();
    await act(async () => fireEvent.click(within(c).getByRole('button', { name: 'Retry C' })));
    expect(calls('POST', '/api/runs/r3/resume')[0]![2]).toEqual({ retryFailed: true });
    await act(async () => fireEvent.click(within(b).getByRole('button', { name: 'Pick B and ship' })));
    expect(calls('POST', '/api/attempts/aset1/pick')[0]![2]).toEqual({ run: 'r2' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try 1 more way' })));
    expect(calls('POST', '/api/runs/r1/attempts')[0]![2]).toEqual({ count: 1 });
    fireEvent.click(within(a).getByRole('button', { name: 'Open' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1' });
  });

  it('the Runs list shows a set as one "best of N" row that opens Compare', async () => {
    const t = Date.now();
    const rows = [makeRow({ id: 'r1', status: 'done', live: false, attemptSet: 'aset1', attemptLabel: 'A', startedAt: t - 9000 }), makeRow({ id: 'r2', status: 'done', live: false, attemptSet: 'aset1', attemptLabel: 'B', startedAt: t - 5000 }), makeRow({ id: 'r9', task: 'Other', status: 'done', live: false })];
    routeApi({ 'GET /api/teams': { teams: [], agents: [] }, 'GET /api/schedules': new ApiError('not found', 404) });
    const onCompare = vi.fn();
    renderApp(<RunList poll={{ data: rows, error: undefined, fails: 0, refresh: async () => {} }} probes={false} onProbes={() => {}} onSelect={() => {}} onCompare={onCompare} />);
    const set = screen.getByRole('button', { name: /^Add rate limiting, best of 2/ });
    expect(screen.getAllByRole('button', { name: /^Add rate limiting/ })).toHaveLength(1);
    fireEvent.click(set);
    expect(onCompare).toHaveBeenCalledWith('aset1');
  });
});

describe('Terminal', () => {
  it('runs a command, streams its output, and announces only the exit line', async () => {
    routeApi({ 'GET /api/runs/r1/exec': { workdir: '/wt', branch: 'aorch/r1', commands: [{ id: 1, command: 'git log --oneline -1', at: 1, output: 'a41c2e0 fix\n', running: false, code: 0, durationMs: 120 }] }, 'POST /api/runs/r1/exec': { id: 2, command: 'npm test', at: 2, output: '', running: true }, 'POST /api/runs/r1/exec/stop': { stopped: true } });
    let push: (m: ProcMessage) => void = () => {};
    const onProc = vi.fn((fn: (m: ProcMessage) => void) => ((push = fn), () => {}));
    renderApp(<Terminal run={makeRun()} onProc={onProc} />);
    expect(await screen.findByText('$ git log --oneline -1')).toBeTruthy();
    expect(screen.getByText('exit 0 · 120ms')).toBeTruthy();
    const input = screen.getByLabelText('Command');
    fireEvent.change(input, { target: { value: 'npm test' } });
    await act(async () => fireEvent.submit(screen.getByRole('form', { name: 'Run a command' })));
    expect(calls('POST', '/api/runs/r1/exec')[0]![2]).toEqual({ command: 'npm test' });
    act(() => push({ type: 'exec.output', id: 2, text: ' ✓ settings (6 tests)\n' }));
    expect(screen.getByText('✓ settings (6 tests)', { exact: false })).toBeTruthy();
    // running: Stop, and Ctrl+C in the field stops it too
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    await act(async () => fireEvent.keyDown(input, { key: 'c', ctrlKey: true }));
    expect(calls('POST', '/api/runs/r1/exec/stop')).toHaveLength(1);
    act(() => push({ type: 'exec.end', id: 2, code: 1, durationMs: 3100 }));
    expect(screen.getByText('exit 1 · 3.1s')).toBeTruthy();
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe('npm test: exit 1 · 3.1s');
    // ↑ walks back through the commands
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect((input as HTMLInputElement).value).toBe('npm test');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect((input as HTMLInputElement).value).toBe('git log --oneline -1');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('shows the worktree and branch in the tab row', async () => {
    routeApi({ ...base, 'GET /api/runs/r1/exec': { workdir: '/wt', branch: 'aorch/r1', commands: [] } });
    page(doneRun());
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Terminal' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }));
    expect(await screen.findByText('/wt · aorch/r1')).toBeTruthy();
    expect(await screen.findByText(/not an interactive shell/)).toBeTruthy();
  });

  it('folds stream messages and words exit lines', () => {
    let l = applyProc([], { type: 'exec.start', id: 1, command: 'ls', at: 1 });
    l = applyProc(l, { type: 'exec.output', id: 1, text: 'a\n' });
    l = applyProc(l, { type: 'exec.end', id: 1, code: null, signal: 'SIGTERM', durationMs: 12_000, spill: '.tether/spill/x.txt' });
    expect(l).toEqual([{ id: 1, command: 'ls', at: 1, output: 'a\n', running: false, code: null, signal: 'SIGTERM', durationMs: 12_000, spill: '.tether/spill/x.txt' }]);
    expect(exitLine(l[0]!)).toBe('stopped · 12.0s · full output in .tether/spill/x.txt');
  });
});

describe('Preview', () => {
  it('starts the detected command, then shows the page with reload, open in browser and Stop', async () => {
    let state: unknown = { preview: null, command: 'npm run dev' };
    routeApi({ 'GET /api/runs/r1/preview': () => state, 'POST /api/runs/r1/preview': () => ((state = { preview: { status: 'running', command: 'npm run dev', port: 5174, url: 'http://localhost:5174/settings', output: '' }, command: 'npm run dev' }), {}), 'DELETE /api/runs/r1/preview': { stopped: true } });
    const win = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderApp(<Preview run={makeRun()} />);
    const field = (await screen.findByDisplayValue('npm run dev')) as HTMLInputElement;
    expect(field).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start preview' })));
    expect(calls('POST', '/api/runs/r1/preview')[0]![2]).toEqual({ command: 'npm run dev' });
    const frame = (await screen.findByTitle('Preview of http://localhost:5174/settings')) as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('http://localhost:5174/settings');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(screen.getByLabelText('Preview address').textContent).toBe('localhost:5174/settings');
    expect(screen.getByText('running in the worktree')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }));
    expect(win).toHaveBeenCalledWith('http://localhost:5174/settings', '_blank', 'noopener');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })));
    expect(calls('DELETE', '/api/runs/r1/preview')).toHaveLength(1);
  });
});
