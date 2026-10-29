import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { LivePlan } from '../runs/PlanCard';
import { RunTaskCard, taskState } from './taskCards';
import { makeAwaitingRun, makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('the started run card follows its run live', () => {
  it('shows the run as a live plan card', async () => {
    routeApi({ 'GET /api/runs/r9': makeRun({ id: 'r9', costUsd: 0.4 }) });
    renderApp(<LivePlan runId="r9" />);
    const card = await screen.findByRole('region', { name: 'Plan' });
    expect(card.textContent).toContain('Add rate limiting');
    expect(card.textContent).toContain('$0.40');
    expect(screen.getAllByRole('img', { name: 'done' })).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'working' })).toBeTruthy();
  });

  it('says Tether is planning while a live team run has no steps yet', async () => {
    const r = makeRun({ id: 'r9', kind: 'team', planning: true });
    routeApi({ 'GET /api/runs/r9': { ...r, pipeline: { ...r.pipeline, nodes: [], edges: [] }, nodes: {} } });
    renderApp(<LivePlan runId="r9" />);
    await waitFor(() => expect(screen.getByText('Tether is planning…')).toBeTruthy());
  });

  it('draws nothing for a run it cannot find', async () => {
    routeApi({ 'GET /api/runs/gone': new Error('unknown run gone') });
    const { container } = renderApp(<LivePlan runId="gone" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });
});

describe('a run a chat started is a task card', () => {
  it('maps a run to a task state: finished ones as they ended, waiting on you, paused or lost as waiting, else working', () => {
    expect(taskState({ status: 'done', waiting: false })).toBe('done');
    expect(taskState({ status: 'error', waiting: false })).toBe('failed');
    expect(taskState({ status: 'stopped', waiting: true })).toBe('cancelled');
    expect(taskState({ status: 'running', waiting: true, live: true })).toBe('waiting');
    expect(taskState({ status: 'paused', waiting: false })).toBe('waiting');
    expect(taskState({ status: 'running', waiting: false, live: false })).toBe('waiting');
    expect(taskState({ status: 'running', waiting: false, live: true })).toBe('working');
  });

  it('follows the run: its task, id, state, time and spend; open, its steps; Open run goes to it', async () => {
    routeApi({ 'GET /api/runs/r9': makeRun({ id: 'r9', costUsd: 0.4 }) });
    const onOpen = vi.fn();
    renderApp(<RunTaskCard runId="r9" task="Add rate limiting" onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByText('$0.40')).toBeTruthy());
    const card = document.querySelector('[data-slot="task-card"]') as HTMLElement;
    expect(card.dataset.state).toBe('working');
    expect(screen.getByText('R-R9')).toBeTruthy();
    expect(screen.getByText('1:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add rate limiting/ }));
    expect(screen.getByText('planner')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'working' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open run' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('waits when the run needs the person, and says why a failed run failed', async () => {
    routeApi({ 'GET /api/runs/r1': makeAwaitingRun(), 'GET /api/runs/r2': makeRun({ id: 'r2', status: 'error', live: false, error: 'tests failed\nmore', finishedAt: Date.now() }) });
    renderApp(<RunTaskCard runId="r1" task="x" onOpen={() => {}} />);
    renderApp(<RunTaskCard runId="r2" task="x" onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('tests failed')).toBeTruthy());
    expect(screen.getByText('Waiting for you')).toBeTruthy();
    expect([...document.querySelectorAll('[data-slot="task-card"]')].map((c) => (c as HTMLElement).dataset.state).sort()).toEqual(['failed', 'waiting']);
  });
});
