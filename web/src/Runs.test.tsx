import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { Runs } from './Runs';
import { calls, FakeEventSource, makeRow, makeRun, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const awaitingRun = makeRun({ nodes: { ...makeRun().nodes, gate: { status: 'awaiting', attempts: 0, costUsd: 0, loops: 0 } } });

beforeEach(() => {
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
    fireEvent.click(await screen.findByText('Second task'));
    expect(onSelect).toHaveBeenCalledWith('r2');
    expect(screen.getByText('? 1')).toBeTruthy();
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
    expect(await screen.findByRole('heading', { name: /plan-code-review/ })).toBeTruthy();
    act(() => FakeEventSource.all[0]!.emit('event', { seq: 1, ts: Date.now(), event: { type: 'run.started' } }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Timeline/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Timeline/ }));
    expect(await screen.findByText('run started')).toBeTruthy();
  });

  it('approves an awaiting step and shows the returned state', async () => {
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', awaitingRun));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Approve' })));
    expect(calls('POST', '/api/runs/r1/approve')[0]![2]).toEqual({ node: 'gate', approved: true });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull());
  });

  it('sends step feedback with its note and toasts failures', async () => {
    const run = makeRun({ status: 'done', live: false });
    const { container } = renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', run));
    fireEvent.pointerDown((await waitFor(() => container.querySelector('[data-id="plan"] .node-body')))!, { pointerId: 1 });
    fireEvent.change(await screen.findByLabelText('Why (optional)'), { target: { value: 'clear plan' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Good' })));
    expect(calls('POST', '/api/runs/r1/feedback')[0]![2]).toEqual({ node: 'plan', rating: 'up', note: 'clear plan' });
    expect((screen.getByLabelText('Why (optional)') as HTMLInputElement).value).toBe('');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Bad' })));
    expect(await screen.findByText('feedback store is read-only')).toBeTruthy();
  });

  it('fetches a step diff once per commit, not on every state update', async () => {
    routeApi({ 'GET /api/runs': [makeRow()], 'GET /api/runs/r1/events': [], 'GET /api/runs/r1/diff?node=plan': { diff: '+x' } });
    const withCommit = makeRun({ nodes: { ...makeRun().nodes, plan: { ...makeRun().nodes.plan!, commit: 'abc1234' } } });
    const { container } = renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', withCommit));
    fireEvent.pointerDown((await waitFor(() => container.querySelector('[data-id="plan"] .node-body')))!, { pointerId: 1 });
    await waitFor(() => expect(calls('GET', '/api/runs/r1/diff?node=plan')).toHaveLength(1));
    act(() => FakeEventSource.all[0]!.emit('state', { ...withCommit, costUsd: 0.5 }));
    act(() => FakeEventSource.all[0]!.emit('state', { ...withCommit, costUsd: 0.6 }));
    expect(calls('GET', '/api/runs/r1/diff?node=plan')).toHaveLength(1);
  });

  it('keeps the branch diff live: refetches when a step commits, not on other updates', async () => {
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    const base = makeRun();
    act(() => FakeEventSource.all[0]!.emit('state', base));
    const tab = await screen.findByRole('tab', { name: 'Branch diff' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await waitFor(() => expect(calls('GET', '/api/runs/r1/diff')).toHaveLength(1));
    act(() => FakeEventSource.all[0]!.emit('state', { ...base, costUsd: 0.5 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls('GET', '/api/runs/r1/diff')).toHaveLength(1);
    act(() => FakeEventSource.all[0]!.emit('state', { ...base, costUsd: 0.5, nodes: { ...base.nodes, code: { ...base.nodes.code!, commit: 'def5678' } } }));
    await waitFor(() => expect(calls('GET', '/api/runs/r1/diff')).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls('GET', '/api/runs/r1/diff')).toHaveLength(2);
  });
});
