import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../api';
import type { Poll } from '../hooks';
import { makeRow } from '../test/fixtures';
import { Elapsed } from './Elapsed';
import { fmtClock, nowLine } from './runText';
import { Running } from './Running';

const poll = (data?: RunRow[]): Poll<RunRow[]> => ({ data, error: undefined, fails: 0, refresh: vi.fn(async () => {}) });
const working = makeRow({
  id: 'r1', live: true, pipeline: 'ship', branch: 'aorch/r1',
  steps: [{ id: 'plan', status: 'done', bot: 'planner' }, { id: 'code', status: 'running', bot: 'coder' }],
  current: { node: 'code', bot: 'Bolt', title: 'Implement' }, bots: ['planner', 'coder'],
});

describe('Running', () => {
  it('shows each live run with meta, step track, faces, what is happening and a clock', () => {
    const onGo = vi.fn();
    render(<Running poll={poll([working, makeRow({ id: 'r2', live: false, status: 'running' })])} refreshing={false} onGo={onGo} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('r1 · aorch/r1 · workflow')).toBeTruthy();
    expect(screen.getByText('Bolt is working on Implement')).toBeTruthy();
    expect(screen.getByRole('img', { name: '1 of 2 steps done, 1 working' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Bolt' }).getAttribute('data-mood')).toBe('working');
    expect(screen.getByText(/^started /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ship' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1' });
  });

  it('describes planning, plans and waiting steps', () => {
    expect(nowLine(makeRow({ kind: 'team', steps: [] }))).toBe('Maestro is planning');
    expect(nowLine(makeRow({ kind: 'team', steps: [], planReady: true }))).toBe('The plan waits for your approval');
    expect(nowLine(makeRow({ kind: 'team', steps: [], pending: 2 }))).toBe('Maestro has a question for you');
    expect(nowLine(makeRow({ steps: [{ id: 'ok', status: 'awaiting', bot: 'approval' }], current: { node: 'ok', bot: 'Gate', title: 'Ship it' } }))).toBe('Ship it waits for you');
    expect(nowLine(makeRow({ steps: [{ id: 'a', status: 'done', bot: 'coder' }] }))).toBe('Between steps');
  });

  it('says when nothing is running', () => {
    render(<Running poll={poll([])} refreshing={false} onGo={() => {}} />);
    expect(screen.getByText('Nothing running')).toBeTruthy();
  });

  it('trusts the server for liveness: a running row with live false is not listed', () => {
    render(<Running poll={poll([makeRow({ id: 'r9', status: 'running', live: false, lastTs: Date.now() })])} refreshing={false} onGo={() => {}} />);
    expect(screen.getByText('Nothing running')).toBeTruthy();
  });

  it('shows a load error with retry, and keeps rows with a compact retry after a later failure', () => {
    const failing: Poll<RunRow[]> = { data: undefined, error: 'down', fails: 1, refresh: vi.fn(async () => {}) };
    const { unmount } = render(<Running poll={failing} refreshing={false} onGo={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('down');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failing.refresh).toHaveBeenCalled();
    unmount();
    render(<Running poll={{ ...failing, data: [working] }} refreshing={false} onGo={() => {}} />);
    expect(screen.getByText('Bolt is working on Implement')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't refresh");
  });
});

describe('Elapsed', () => {
  it('ticks a hidden clock and keeps a static spoken label', () => {
    vi.useFakeTimers();
    const since = Date.now() - 65_000;
    const { container } = render(<Elapsed since={since} />);
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe('1:05');
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe('1:06');
    expect(screen.getByText('started 1m ago')).toBeTruthy();
    expect(fmtClock(3_725_000)).toBe('1:02:05');
  });
});
