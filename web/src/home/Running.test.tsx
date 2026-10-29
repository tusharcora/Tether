import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../api';
import type { Poll } from '../hooks';
import { makeRow } from '../test/fixtures';
import { renderApp } from '../test/render';
import { nowLine } from './runText';
import { Running } from './Running';

const poll = (data?: RunRow[]): Poll<RunRow[]> => ({ data, error: undefined, fails: 0, refresh: vi.fn(async () => {}) });
const working = makeRow({
  id: 'r1', live: true, pipeline: 'ship', branch: 'aorch/r1',
  steps: [{ id: 'plan', status: 'done', bot: 'planner' }, { id: 'code', status: 'running', bot: 'coder' }],
  current: { node: 'code', bot: 'Bolt', title: 'Implement' }, bots: ['planner', 'coder'],
});

describe('Running', () => {
  it('shows live runs as the agents running card: task, who works on what, step n of m', () => {
    const onGo = vi.fn();
    const row = makeRow({
      id: 'r1', live: true, task: 'Tune the limit window\nwith care',
      steps: [{ id: 'a', status: 'done', bot: 'planner' }, { id: 'b', status: 'running', bot: 'coder' }, { id: 'c', status: 'queued', bot: 'tester' }],
      current: { node: 'b', bot: 'Bolt', title: 'Implement' },
    });
    renderApp(<Running poll={poll([row, makeRow({ id: 'r2', live: false, status: 'running' })])} onGo={onGo} />);
    expect(screen.getByRole('region', { name: 'Running' }).querySelector('.sl-sec-count')!.textContent).toBe('1');
    expect(screen.getByRole('region', { name: 'Agents running' }).textContent).toContain('1 agentrunning');
    expect(screen.getByText('Bolt is working on Implement · step 2 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tune the limit window' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1' });
  });

  it('describes planning, plans and waiting steps', () => {
    expect(nowLine(makeRow({ kind: 'team', steps: [] }))).toBe('Tether is planning');
    expect(nowLine(makeRow({ kind: 'team', steps: [], planReady: true }))).toBe('The plan waits for your approval');
    expect(nowLine(makeRow({ kind: 'team', steps: [], pending: 2 }))).toBe('Tether has a question for you');
    expect(nowLine(makeRow({ steps: [{ id: 'ok', status: 'awaiting', bot: 'approval' }], current: { node: 'ok', bot: 'Gate', title: 'Ship it' } }))).toBe('Ship it waits for you');
    expect(nowLine(makeRow({ steps: [{ id: 'a', status: 'done', bot: 'coder' }] }))).toBe('Between steps');
  });

  it('says when nothing is running', () => {
    render(<Running poll={poll([])} onGo={() => {}} />);
    expect(screen.getByText('Nothing running.')).toBeTruthy();
  });

  it('trusts the server for liveness: a running row with live false is not listed', () => {
    render(<Running poll={poll([makeRow({ id: 'r9', status: 'running', live: false, lastTs: Date.now() })])} onGo={() => {}} />);
    expect(screen.getByText('Nothing running.')).toBeTruthy();
  });

  it('shows a load error with retry, and keeps the card with a compact retry after a later failure', () => {
    const failing: Poll<RunRow[]> = { data: undefined, error: 'down', fails: 1, refresh: vi.fn(async () => {}) };
    const { unmount } = render(<Running poll={failing} onGo={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('down');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failing.refresh).toHaveBeenCalled();
    unmount();
    renderApp(<Running poll={{ ...failing, data: [working] }} onGo={() => {}} />);
    expect(screen.getByText('Bolt is working on Implement · step 2 of 2')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't refresh");
  });
});
