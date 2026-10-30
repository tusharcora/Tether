import { describe, expect, it } from 'vitest';
import type { GoalView } from '../goals/goalsApi';
import type { TeamSummary } from '../teams/teamsApi';
import { columns, filterTickets, readyFor, shippedPerDay, span, squadCounts, thisWeek, weekStart } from './ticketModel';

const DAY = 86_400_000;
// Thursday 2026-10-29 15:00 local
const NOW = new Date(2026, 9, 29, 15, 0).getTime();
let n = 0;
export const tk = (o: Partial<GoalView> = {}): GoalView =>
  ({ id: `t${++n}`, workspace: 'web', title: `Ticket ${n}`, kind: 'tracker', status: 'active', approval: 'ask', workflow: 'team', createdAt: NOW - DAY, spentUsd: 0, items: [], progress: 0, key: `WEB-${n}`, num: n, stage: 'todo', criteria: [], ...o }) as GoalView;
const squad = (o: Partial<TeamSummary> = {}): TeamSummary => ({ id: 'web', name: 'web', place: 'tether', project: 'web', agents: ['coder', 'tester', 'manager'], status: 'idle', needs: 0, recent: [], queue: [], ...o });

describe('the board', () => {
  it('a column per status, most urgent first, Done newest finished first', () => {
    const list = [tk({ id: 'a', stage: 'todo', priority: 'low' }), tk({ id: 'b', stage: 'todo', priority: 'urgent' }), tk({ id: 'c', stage: 'done', endedAt: 5 }), tk({ id: 'd', stage: 'done', endedAt: 9 }), tk({ id: 'e', stage: 'canceled' })];
    const c = columns(list);
    expect(c.todo.map((t) => t.id)).toEqual(['b', 'a']);
    expect(c.done.map((t) => t.id)).toEqual(['d', 'c']);
    expect(c.canceled.map((t) => t.id)).toEqual(['e']);
  });

  it('filters: needs me, bugs, a squad, an assignee or unassigned, canceled', () => {
    const list = [tk({ id: 'a', needs: 'Ready to ship', squad: 'web' }), tk({ id: 'b', type: 'bugfix', assignee: { kind: 'agent', id: 'coder' } }), tk({ id: 'c', stage: 'canceled' })];
    const ids = (f: Parameters<typeof filterTickets>[1]) => filterTickets(list, f).map((t) => t.id);
    expect(ids({ needs: true })).toEqual(['a']);
    expect(ids({ bugs: true })).toEqual(['b']);
    expect(ids({ squad: 'web' })).toEqual(['a']);
    expect(ids({ assignee: 'coder' })).toEqual(['b']);
    expect(ids({ assignee: '' })).toEqual(['a', 'c']);
    expect(ids({ canceled: true })).toEqual(['c']);
  });
});

describe('This week (board 10)', () => {
  it('counts what shipped since Monday with each day so far, what is in flight and who, Todo → Done, and the oldest wait on you', () => {
    expect(new Date(weekStart(NOW)).getDay()).toBe(1);
    const list = [
      tk({ stage: 'done', createdAt: NOW - 2 * DAY - 3_600_000, endedAt: NOW - 2 * DAY }), // Tuesday, 1h
      tk({ stage: 'done', createdAt: NOW - 2_000_000, endedAt: NOW - 1_000_000 }), // today
      tk({ stage: 'done', createdAt: NOW - 9 * DAY, endedAt: NOW - 8 * DAY }), // last week
      tk({ stage: 'in_progress', assignee: { kind: 'agent', id: 'coder' } }),
      tk({ id: 'old', key: 'WEB-142', stage: 'in_review', assignee: { kind: 'agent', id: 'reviewer' }, needs: 'Ready to ship', activity: [{ at: NOW - 12 * 60_000, who: { kind: 'agent', id: 'coder', name: 'Bolt' }, text: 'Done' }] }),
      tk({ stage: 'in_review', needs: 'x', activity: [{ at: NOW - 60_000, who: { kind: 'agent', id: 'coder', name: 'Bolt' }, text: 'x' }] }),
    ];
    const w = thisWeek(list, NOW);
    expect(w).toMatchObject({ shipped: 2, perDay: [0, 1, 0, 1], inFlight: 3, who: ['coder', 'reviewer'], oldest: { ticket: { id: 'old' }, since: NOW - 12 * 60_000 } });
    // (1h + 16m40s) / 2
    expect(span(w.avgMs!)).toBe('38m');
    expect(span(3_600_000)).toBe('1h');
    expect(span(3 * DAY)).toBe('3d');
    expect(thisWeek([], NOW)).toEqual({ shipped: 0, perDay: [0, 0, 0, 0], inFlight: 0, who: [] });
  });

  it('five days of shipping for the pulse, oldest first', () => {
    expect(shippedPerDay([tk({ stage: 'done', endedAt: NOW - 1000 }), tk({ stage: 'done', endedAt: NOW - 4 * DAY }), tk({ stage: 'done', endedAt: NOW - 5 * DAY })], NOW, 5)).toEqual([1, 0, 0, 0, 1]);
  });
});

describe('Ready for an agent (board 10, Todo)', () => {
  it('suggests a free agent of the squad for each unassigned Todo ticket, each agent once; queued pickups can start now', () => {
    const a = tk({ id: 'a', stage: 'todo', squad: 'web', priority: 'high' });
    const b = tk({ id: 'b', stage: 'todo', squad: 'web' });
    const c = tk({ id: 'c', stage: 'todo', squad: 'web', assignee: { kind: 'agent', id: 'coder' } });
    const d = tk({ id: 'd', stage: 'todo' }); // no squad: nobody to suggest
    const q = { id: 'q1', bot: 'tester', task: 'fix it', msg: 'm1', ticket: 'c', at: 1 };
    const r = readyFor([a, b, c, d], [squad({ queue: [q] })], [{ id: 'coder', name: 'Bolt', state: 'coding' }, { id: 'tester', name: 'Probe', state: 'idle' }, { id: 'manager', name: 'Boss' }]);
    expect(r.assign.map((x) => [x.ticket.id, x.agent])).toEqual([
      ['a', 'tester'],
      ['b', 'manager'],
    ]);
    expect(r.pickups).toEqual([{ squad: 'web', q, ticket: c }]);
    expect(readyFor([], [squad()], [])).toEqual({ assign: [], pickups: [] });
  });

  it('counts a squad’s tickets as its pulse does', () => {
    const list = [tk({ squad: 'web', stage: 'todo' }), tk({ squad: 'web', stage: 'in_progress' }), tk({ squad: 'web', stage: 'in_progress' }), tk({ squad: 'api', stage: 'done' })];
    expect(squadCounts(list, 'web')).toEqual([
      { stage: 'todo', label: 'Todo', n: 1 },
      { stage: 'in_progress', label: 'Doing', n: 2 },
      { stage: 'in_review', label: 'Review', n: 0 },
      { stage: 'done', label: 'Done', n: 0 },
    ]);
  });
});
