import { describe, expect, it } from 'vitest';
import { makeRow } from '../test/fixtures';
import { filterRows, groupRuns, needsYou, nowLine, spendByDay, startedFrom, weekStats } from './runsModel';

const NOW = new Date(2026, 9, 29, 15, 0).getTime();
const H = 3_600_000;
const D = 24 * H;

describe('Runs grouped', () => {
  it('needs you first (a question, a plan, an approval), then live, then today, this week and older; newest first', () => {
    const rows = [
      makeRow({ id: 'q', pending: 1, live: true, status: 'running', startedAt: NOW - 2 * H }),
      makeRow({ id: 'ok', status: 'paused', live: false, steps: [{ id: 'a', status: 'done', bot: 'coder' }, { id: 'ship', status: 'awaiting', bot: 'approval', kind: 'approval' }], startedAt: NOW - 3 * H }),
      makeRow({ id: 'live', live: true, status: 'running', startedAt: NOW - H }),
      makeRow({ id: 'today', live: false, status: 'done', startedAt: NOW - 4 * H }),
      makeRow({ id: 'mon', live: false, status: 'done', startedAt: NOW - 3 * D }),
      makeRow({ id: 'old', live: false, status: 'error', startedAt: NOW - 20 * D }),
      makeRow({ id: 'gone', live: false, status: 'done', pending: 1, startedAt: NOW - 5 * H }),
    ];
    const g = groupRuns(rows, NOW);
    expect(g.needs.map((r) => r.id)).toEqual(['q', 'ok']);
    expect(g.live.map((r) => r.id)).toEqual(['live']);
    expect(g.today.map((r) => r.id)).toEqual(['today', 'gone']);
    expect(g.week.map((r) => r.id)).toEqual(['mon']);
    expect(g.older.map((r) => r.id)).toEqual(['old']);
    expect(needsYou(makeRow({ planReady: true }))).toBe(true);
  });
});

describe('Runs filtered', () => {
  const rows = [
    makeRow({ id: 'r1', task: 'Fix sign-in', pending: 1, bots: ['coder'], origin: { kind: 'goal', id: 'g1', team: 'web' } }),
    makeRow({ id: 'r2', task: 'Dark mode', live: true, bots: ['coder', 'reviewer'], origin: { kind: 'chat', id: 'c1' } }),
    makeRow({ id: 'r3', task: 'Bump deps', live: false, status: 'done', bots: ['tester'], repo: '/code/blog' }),
  ];
  it('by tab, team, agent, project and search over the task, the goal’s title and the id', () => {
    expect(filterRows(rows, { tab: 'needs' }).map((r) => r.id)).toEqual(['r1']);
    expect(filterRows(rows, { tab: 'live' }).map((r) => r.id)).toEqual(['r2']);
    expect(filterRows(rows, { tab: 'all', team: 'web' }).map((r) => r.id)).toEqual(['r1']);
    expect(filterRows(rows, { tab: 'all', agent: 'reviewer' }).map((r) => r.id)).toEqual(['r2']);
    expect(filterRows(rows, { tab: 'all', project: { id: 'blog', name: 'blog', path: '/code/blog', isDefault: false, exists: true, repos: [] } }).map((r) => r.id)).toEqual(['r3']);
    expect(filterRows(rows, { tab: 'all', q: 'redirect' }, (id) => (id === 'g1' ? 'Sign-in redirect keeps ?next=' : undefined)).map((r) => r.id)).toEqual(['r1']);
    expect(filterRows(rows, { tab: 'all', q: 'DARK' }).map((r) => r.id)).toEqual(['r2']);
    expect(filterRows(rows, { tab: 'all', q: 'R-R3' }).map((r) => r.id)).toEqual(['r3']);
  });
});

describe('the line under a run', () => {
  it('says what waits on you, who is working on what, where it failed, or how it ended', () => {
    expect(nowLine(makeRow({ pending: 2 })).text).toBe('2 questions wait for you');
    expect(nowLine(makeRow({ status: 'paused', live: false, steps: [{ id: 'ship', status: 'awaiting', bot: 'approval', title: 'You approve' }] })).text).toBe('You approve waits on you');
    expect(nowLine(makeRow({ current: { node: 'b', bot: 'Bolt', title: 'Implement' } })).text).toBe('Bolt on Implement');
    expect(nowLine(makeRow({ status: 'error', live: false, steps: [{ id: 'a', status: 'done', bot: 'coder' }, { id: 't', status: 'error', bot: 'tester', title: 'Tests' }] }))).toEqual({ text: 'Tests failed · Retry from Tests', bad: true });
    expect(nowLine(makeRow({ status: 'done', live: false, ship: { url: 'u', number: 141, merged: true } })).text).toBe('PR #141 merged');
    expect(nowLine(makeRow({ status: 'done', live: false })).text).toBe('Done');
  });
});

describe('this week', () => {
  const rows = [
    makeRow({ id: 'a', status: 'done', costUsd: 1, startedAt: NOW - H, ship: { url: 'u', number: 1, merged: true }, steps: [{ id: 'x', status: 'done', bot: 'coder', kind: 'agent', free: true }, { id: 'y', status: 'done', bot: 'tester', kind: 'gate' }] }),
    makeRow({ id: 'b', status: 'done', costUsd: 2, startedAt: NOW - 2 * D, retried: true, steps: [{ id: 'x', status: 'done', bot: 'coder', kind: 'agent' }] }),
    makeRow({ id: 'c', status: 'error', costUsd: 0.5, startedAt: NOW - 6 * D, origin: { kind: 'chat', id: 'c1' } }),
    makeRow({ id: 'd', status: 'done', costUsd: 9, startedAt: NOW - 30 * D, origin: { kind: 'goal', id: 'g' } }),
  ];
  it('counts runs, merged PRs, spend, the free share and runs that passed first try', () => {
    expect(weekStats(rows, NOW)).toEqual({ runs: 3, merged: 1, spent: 3.5, freeShare: 0.5, firstTry: 0.5 });
  });
  it('spends by day, today last; and counts where runs started from, old ones as other', () => {
    expect(spendByDay(rows, NOW)).toEqual([0.5, 0, 0, 0, 2, 0, 1]);
    expect(startedFrom(rows)).toEqual([{ key: 'chat', n: 1 }, { key: 'goal', n: 1 }, { key: 'other', n: 2 }]);
  });
});
