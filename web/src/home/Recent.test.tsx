import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../api';
import type { Poll } from '../hooks';
import { makeRow } from '../test/fixtures';
import { Recent } from './Recent';
import { recentRuns } from './runText';

const t = Date.now();
const done = (id: string, finishedAt: number, o: Partial<RunRow> = {}) => makeRow({ id, pipeline: id, status: 'done', live: false, startedAt: finishedAt - 90_000, finishedAt, costUsd: 0.25, ...o });

describe('Recent', () => {
  it('keeps the 5 most recently finished runs, probes left out', () => {
    const rows = [done('a', t - 1), done('b', t - 7), done('c', t - 3, { status: 'error' }), done('d', t - 4, { status: 'stopped' }), done('e', t - 5), done('f', t - 6), done('p', t, { probe: true }), makeRow({ id: 'live' })];
    expect(recentRuns(rows).map((r) => r.id)).toEqual(['a', 'c', 'd', 'e', 'f']);
  });
  it('shows result, title, duration and cost', () => {
    const poll: Poll<RunRow[]> = { data: [done('ship', t - 1)], error: undefined, fails: 0, refresh: vi.fn(async () => {}) };
    render(<Recent poll={poll} refreshing={false} onGo={() => {}} />);
    expect(screen.getByText('ship')).toBeTruthy();
    expect(screen.getByText('1m 30s · $0.25')).toBeTruthy();
    expect(screen.getByText('done')).toBeTruthy();
  });
  it('opens a run from its title', async () => {
    const onGo = vi.fn();
    const poll: Poll<RunRow[]> = { data: [done('ship', t - 1)], error: undefined, fails: 0, refresh: vi.fn(async () => {}) };
    render(<Recent poll={poll} refreshing={false} onGo={onGo} />);
    screen.getByRole('button', { name: 'ship' }).click();
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'ship' });
  });
  it('says when nothing has finished yet', () => {
    render(<Recent poll={{ data: [], error: undefined, fails: 0, refresh: async () => {} }} refreshing={false} onGo={() => {}} />);
    expect(screen.getByText('No finished runs yet')).toBeTruthy();
  });
});
