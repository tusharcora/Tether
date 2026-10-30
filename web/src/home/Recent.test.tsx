import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../api';
import type { Poll } from '../hooks';
import { makeRow } from '../test/fixtures';
import { Recent } from './Recent';
import { recentRuns, stepOf, taskTitle } from './runText';

const t = Date.now();
const done = (id: string, finishedAt: number, o: Partial<RunRow> = {}) => makeRow({ id, pipeline: id, status: 'done', live: false, startedAt: finishedAt - 90_000, finishedAt, costUsd: 0.25, ...o });

describe('Recent', () => {
  it('keeps the 5 most recently finished runs, probes left out', () => {
    const rows = [done('a', t - 1), done('b', t - 7), done('c', t - 3, { status: 'error' }), done('d', t - 4, { status: 'stopped' }), done('e', t - 5), done('f', t - 6), done('p', t, { probe: true }), makeRow({ id: 'live' })];
    expect(recentRuns(rows).map((r) => r.id)).toEqual(['a', 'c', 'd', 'e', 'f']);
  });
  it('shows the task, id · result · time · cost and a badge', () => {
    const poll: Poll<RunRow[]> = { data: [done('ship', t - 1)], error: undefined, fails: 0, refresh: vi.fn(async () => {}) };
    render(<Recent poll={poll} onGo={() => {}} />);
    expect(screen.getByText('Add rate limiting')).toBeTruthy();
    expect(screen.getByText('R-SHIP · done · 1m 30s · $0.25')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Done' })).toBeTruthy();
    expect(document.querySelector('[data-status="success"]')!.textContent).toContain('done');
  });
  it('shows a failed run with a red cross and a failed badge, never a green ring', () => {
    const poll: Poll<RunRow[]> = { data: [done('bad1', t - 1, { status: 'error' })], error: undefined, fails: 0, refresh: vi.fn(async () => {}) };
    const { container } = render(<Recent poll={poll} onGo={() => {}} />);
    expect(screen.getByRole('img', { name: 'Failed' })).toBeTruthy();
    expect(container.querySelector('[data-status="danger"]')!.textContent).toContain('failed');
    expect(container.querySelector('.sl-row-meta')!.textContent).toMatch(/^R-\w+ · failed · /);
  });
  it('opens a run from its title', async () => {
    const onGo = vi.fn();
    const poll: Poll<RunRow[]> = { data: [done('ship', t - 1)], error: undefined, fails: 0, refresh: vi.fn(async () => {}) };
    render(<Recent poll={poll} onGo={onGo} />);
    screen.getByRole('button', { name: 'Add rate limiting' }).click();
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'ship' });
  });
  it('says when nothing has finished yet', () => {
    render(<Recent poll={{ data: [], error: undefined, fails: 0, refresh: async () => {} }} onGo={() => {}} />);
    expect(screen.getByText('No finished runs yet.')).toBeTruthy();
  });
});

describe('runText', () => {
  it('titles a run by the first non-empty line of its task', () => {
    expect(taskTitle({ task: '\n  Fix the login\nmore', kind: 'workflow', pipeline: 'p' })).toBe('Fix the login');
    expect(taskTitle({ task: '   \n ', kind: 'team', pipeline: 'p' })).toBe('Squad run');
    expect(taskTitle({ task: '', kind: 'workflow', pipeline: 'plan-code' })).toBe('plan-code');
  });
  it('counts the step a run is on', () => {
    const steps = [{ id: 'a', status: 'done', bot: 'x' }, { id: 'b', status: 'running', bot: 'y' }, { id: 'c', status: 'queued', bot: 'z' }] as RunRow['steps'];
    expect(stepOf(makeRow({ steps, current: { node: 'b', bot: 'Y', title: 'b' } }))).toBe('step 2 of 3');
    expect(stepOf(makeRow({ steps }))).toBe('step 2 of 3');
    expect(stepOf(makeRow({ steps: steps.map((s) => ({ ...s, status: 'done' as const })) }))).toBe('step 3 of 3');
    expect(stepOf(makeRow({ steps: [] }))).toBeUndefined();
  });

});
