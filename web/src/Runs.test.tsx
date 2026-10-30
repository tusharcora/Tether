import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { Runs } from './Runs';
import { calls, FakeEventSource, makeAwaitingRun, makeRow, makeRun, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const base = makeRun();
const awaitingRun = makeAwaitingRun();

beforeEach(() => {
  // a layout case stubs matchMedia; the next case starts wide again
  vi.unstubAllGlobals();
  vi.mocked(api).mockReset();
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  routeApi({
    'GET /api/runs': [makeRow(), makeRow({ id: 'r2', task: 'Second task', kind: 'team', pending: 1 })],
    'GET /api/runs/r1/events': [],
    'GET /api/runs/r1/diff': { diff: '+line' },
    'POST /api/runs/r1/approve': makeRun({ status: 'running' }),
    'POST /api/runs/r1/feedback': (b: unknown) => ((b as { rating: string }).rating === 'down' ? new Error('feedback store is read-only') : makeRun()),
  });
});

describe('Runs', () => {
  it('lists runs and selects one', async () => {
    const onSelect = vi.fn();
    renderApp(<Runs onSelect={onSelect} />);
    // a question waiting puts the run under Needs you, with Answer inline
    fireEvent.click(within(await screen.findByRole('group', { name: 'Second task' })).getByRole('button', { name: 'Answer' }));
    expect(onSelect).toHaveBeenCalledWith('r2');
    fireEvent.click(screen.getByRole('button', { name: 'Add rate limiting, Running' }));
    expect(onSelect).toHaveBeenCalledWith('r1');
  });

  it('shows the list alone, full width, when no run is open', async () => {
    const { container } = renderApp(<Runs onSelect={() => {}} />);
    expect(await screen.findByText('Second task')).toBeTruthy();
    expect(container.querySelector('.runs-list-page > .rl')).toBeTruthy();
    expect(screen.queryByText('No run selected')).toBeNull();
  });

  it('shows a failed run list inline with a retry', async () => {
    routeApi({ 'GET /api/runs': new Error('down') });
    renderApp(<Runs onSelect={() => {}} />);
    expect(await screen.findByText('down')).toBeTruthy();
    expect(screen.queryByText(/No runs yet/)).toBeNull();
    const before = calls('GET', '/api/runs').length;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(calls('GET', '/api/runs').length).toBe(before + 1);
  });

  it('shows a failed run load instead of the skeleton', async () => {
    routeApi({ 'GET /api/runs': [makeRow()], 'GET /api/runs/r1/events': new Error('gone') });
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    expect(await screen.findByText('gone')).toBeTruthy();
    expect(screen.queryByLabelText('Loading run')).toBeNull();
  });

  it('follows the selected run live', async () => {
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
    expect(await screen.findByRole('heading', { level: 1, name: 'Add rate limiting' })).toBeTruthy();
    act(() => FakeEventSource.all[0]!.emit('state', makeRun({ nodes: { ...makeRun().nodes, code: { ...makeRun().nodes.code!, status: 'done' } }, status: 'done', live: false })));
    expect(await screen.findByRole('button', { name: 'Bolt made the changes, done' })).toBeTruthy();
  });

  it('opens on the Timeline when the link asks for it', async () => {
    renderApp(<Runs selected="r1" pane="timeline" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
    act(() => FakeEventSource.all[0]!.emit('event', { seq: 1, ts: Date.now(), event: { type: 'run.started' } }));
    expect(await screen.findByRole('tab', { name: /Timeline/, selected: true })).toBeTruthy();
    expect((await screen.findAllByText('run started')).length).toBeGreaterThan(0);
  });

  it('an approval part way through asks Approve or Reject, and the page takes the returned state', async () => {
    // the approval comes before the gate: not the last word, so no Merge
    const mid = { ...awaitingRun, pipeline: { ...awaitingRun.pipeline, edges: [{ from: 'plan', to: 'code' }, { from: 'code', to: 'ship' }, { from: 'ship', to: 'gate' }] }, nodes: { ...awaitingRun.nodes, gate: { status: 'queued' as const, attempts: 0, costUsd: 0, loops: 0 } } };
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', mid));
    expect(await screen.findByText('Approve “Ship it”?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Merge to main' })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reject' })));
    expect(calls('POST', '/api/runs/r1/approve')[0]![2]).toEqual({ node: 'ship', approved: false });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Decision' })).toBeNull());
  });

  it('sends step feedback with its note and toasts failures', async () => {
    const run = makeRun({ status: 'done', live: false });
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', run));
    fireEvent.click(await screen.findByRole('button', { name: 'Scout looked into it, done' }));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Good' })));
    expect(calls('POST', '/api/runs/r1/feedback')[0]![2]).toEqual({ node: 'plan', rating: 'up' });
    fireEvent.change(screen.getByLabelText('Why (optional)'), { target: { value: 'clear plan' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save note' })));
    expect(calls('POST', '/api/runs/r1/feedback')[1]![2]).toEqual({ node: 'plan', rating: 'up', note: 'clear plan' });
    expect((screen.getByLabelText('Why (optional)') as HTMLInputElement).value).toBe('');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Bad' })));
    expect(await screen.findByText('feedback store is read-only')).toBeTruthy();
  });

  it('fetches a step diff once per commit, not on every state update', async () => {
    routeApi({ 'GET /api/runs': [makeRow()], 'GET /api/runs/r1/events': [], 'GET /api/runs/r1/diff?node=plan': { diff: '+x' } });
    const withCommit = makeRun({ nodes: { ...makeRun().nodes, plan: { ...makeRun().nodes.plan!, commit: 'abc1234' } } });
    renderApp(<Runs selected="r1" node="plan" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', withCommit));
    await waitFor(() => expect(calls('GET', '/api/runs/r1/diff?node=plan')).toHaveLength(1));
    act(() => FakeEventSource.all[0]!.emit('state', { ...withCommit, costUsd: 0.5 }));
    act(() => FakeEventSource.all[0]!.emit('state', { ...withCommit, costUsd: 0.6 }));
    expect(calls('GET', '/api/runs/r1/diff?node=plan')).toHaveLength(1);
  });

  it('keeps the branch files live: refetches when a step commits, not on other updates', async () => {
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    const base = makeRun();
    act(() => FakeEventSource.all[0]!.emit('state', base));
    await waitFor(() => expect(calls('GET', '/api/runs/r1/diff')).toHaveLength(1));
    act(() => FakeEventSource.all[0]!.emit('state', { ...base, costUsd: 0.5 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls('GET', '/api/runs/r1/diff')).toHaveLength(1);
    act(() => FakeEventSource.all[0]!.emit('state', { ...base, costUsd: 0.5, nodes: { ...base.nodes, code: { ...base.nodes.code!, commit: 'def5678' } } }));
    await waitFor(() => expect(calls('GET', '/api/runs/r1/diff')).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls('GET', '/api/runs/r1/diff')).toHaveLength(2);
  });

  it('shows approval banners only for approval steps', async () => {
    const gateWaits = makeRun({ nodes: { ...makeRun().nodes, gate: { status: 'awaiting', attempts: 0, costUsd: 0, loops: 0 } } });
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', gateWaits));
    await screen.findByRole('heading', { level: 1, name: 'Add rate limiting' });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Decision' })).toBeNull();
  });

  it('heads the run with its task, a badge that says interrupted, and the mono line with cost of budget', async () => {
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun({ live: false, pipeline: { ...makeRun().pipeline, settings: { ...makeRun().pipeline.settings, maxCostUsd: 5 } } })));
    await screen.findByRole('heading', { level: 1, name: 'Add rate limiting' });
    expect(screen.getAllByText('interrupted')).toHaveLength(1);
    expect(screen.getByText(/^.+ · \$0\.12 of \$5\.00$/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('selects the step named in the route and reports clicks on steps', async () => {
    const onSelectNode = vi.fn();
    renderApp(<Runs selected="r1" node="plan" onSelect={() => {}} onSelectNode={onSelectNode} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun({ status: 'done', live: false })));
    expect(await screen.findByText('How did Scout do?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Bolt / }));
    expect(onSelectNode).toHaveBeenLastCalledWith('code');
  });

  it('says so when the route names a step that is not in the run', async () => {
    renderApp(<Runs selected="r1" node="ghost" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
    expect((await screen.findByRole('note')).textContent).toContain('This step is not in this run');
  });
});
