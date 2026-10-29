import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, makeRow, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { AgentsRunning, RunningNow } from './AgentsRunning';

const working = makeRow({ id: 'r1', task: 'Fix Back after a new chat', steps: [{ id: 'code', status: 'running', bot: 'coder' }], current: { node: 'code', bot: 'Bolt', title: 'Implement' }, bots: ['coder'] });
const waiting = makeRow({ id: 'r2', task: 'Review R-5A21', steps: [{ id: 'ship', status: 'awaiting', bot: 'approval' }], current: { node: 'ship', bot: 'Gate', title: 'Ship it' } });

// a block body: a returned function would run as a cleanup hook
beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('AgentsRunning', () => {
  it('lists each run with its task and what happens now; one that waits says Ready to review and Review opens it; no made-up time left', () => {
    const onGo = vi.fn();
    renderApp(<AgentsRunning rows={[working, waiting]} onGo={onGo} />);
    const card = screen.getByRole('region', { name: 'Agents running' });
    expect(card.textContent).toContain('2 agentsrunning');
    expect(screen.getByText('Bolt is working on Implement · step 1 of 1')).toBeTruthy();
    expect(screen.getByText('Ready to review')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'working' })).toBeTruthy();
    expect(card.textContent).not.toMatch(/~|min left/);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r2' });
  });

  it('asks before Stop all, stops every listed run, and reports one that would not stop', async () => {
    routeApi({ 'POST /api/runs/r1/stop': { ok: true }, 'POST /api/runs/r2/stop': new Error('run is not live in this server') });
    const onChanged = vi.fn();
    renderApp(<AgentsRunning rows={[working, waiting]} onGo={() => {}} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
    expect(calls('POST', '/api/runs/r1/stop')).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Stop 2 runs?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls('POST', '/api/runs/r1/stop')).toHaveLength(1);
    expect(calls('POST', '/api/runs/r2/stop')).toHaveLength(1);
    expect(await screen.findByText('Could not stop r2: run is not live in this server')).toBeTruthy();
  });
});

describe('RunningNow', () => {
  it('shows the card only while something runs', async () => {
    routeApi({ 'GET /api/runs': [working, makeRow({ id: 'r3', live: false, status: 'done' })] });
    renderApp(<RunningNow onGo={() => {}} />);
    expect((await screen.findByRole('region', { name: 'Agents running' })).textContent).toContain('1 agentrunning');
  });
});
