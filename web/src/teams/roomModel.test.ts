import { describe, expect, it } from 'vitest';
import type { GoalView } from '../goals/goalsApi';
import { focusOn, handoffEdges, roomCounts, runOf, stripItems } from './roomModel';
import type { TeamMessage } from './teamsApi';

const NOW = 1_000_000_000;
const you = { kind: 'person' as const, id: 'owner', name: 'you' };
const bolt = { kind: 'agent' as const, id: 'coder', name: 'Bolt' };
const run = (runId: string, status: 'running' | 'done' | 'paused', title = runId) => ({ kind: 'run' as const, runId, title, steps: [], status, costUsd: 0 });
const msgs: TeamMessage[] = [
  { id: 'm1', at: NOW - 9 * 86_400_000, from: you, text: '@Bolt old ask' },
  { id: 'm2', at: NOW - 3000, from: you, text: '@Bolt people land on /home. Fix it.' },
  { id: 'm3', at: NOW - 2900, from: bolt, text: 'Started R-8F2A.', run: 'r8f2a', card: run('r8f2a', 'running', 'Sign-in redirect') },
  { id: 'm4', at: NOW - 2000, from: bolt, text: 'Fixed. Handing to @Lens. @lens please look', run: 'r8f2a' },
  { id: 'm5', at: NOW - 1900, from: bolt, text: 'Done earlier', run: 'r0001', card: run('r0001', 'done', 'Settings dark mode') },
  { id: 'm6', at: NOW - 1800, from: bolt, text: 'Shipped.', run: 'r0001', card: { kind: 'pr', url: 'u', number: 141, title: 't', merged: true } },
  { id: 'm7', at: NOW - 1700, from: { kind: 'agent', id: 'tester', name: 'Probe' }, text: 'Loop.', card: { kind: 'loop', goalId: 'g1' } },
  { id: 'm8', at: NOW - 100, from: bolt, text: 'Ready to ship.', card: { kind: 'approval', what: 'ship', title: 'Ship?', runId: 'r8f2a', node: 'ship', status: 'pending' } },
];
const goal = { id: 'g1', title: 'Keep main green', status: 'met', items: [{ id: 1, kind: 'run', runId: 'rloop1' }, { id: 2, kind: 'run', runId: 'rloop2' }] } as unknown as GoalView;

describe('the runs strip', () => {
  it('lists each run once (with its PR) and each loop, the live run first', () => {
    const items = stripItems({ messages: msgs }, [goal]);
    expect(items.map((x) => x.title)).toEqual(['Sign-in redirect', 'Keep main green', 'Settings dark mode']);
    expect(items[2]).toMatchObject({ kind: 'run', pr: { number: 141, merged: true } });
    expect(runOf(items[0])).toBe('r8f2a');
    expect(runOf(items[1])).toBe('rloop2');
  });
  it('counts live runs and what needs you for the header', () => {
    expect(roomCounts({ messages: msgs, working: [] }, [goal])).toEqual({ live: 1, needs: 1 });
  });
});

describe('who handed work to whom', () => {
  it('counts @mentions between members in the last week, once per message', () => {
    expect(handoffEdges(msgs, [{ id: 'owner', name: 'you', kind: 'person' }, { id: 'coder', name: 'Bolt', kind: 'agent' }, { id: 'reviewer', name: 'Lens', kind: 'agent' }], NOW)).toEqual([
      { from: 'owner', to: 'coder', n: 1 },
      { from: 'coder', to: 'reviewer', n: 1 },
    ]);
  });
  it('focuses the chat on one member: theirs and the ones that mention them', () => {
    expect(focusOn(msgs, { id: 'reviewer', name: 'Lens', kind: 'agent' }).map((m) => m.id)).toEqual(['m4']);
    expect(focusOn(msgs, { id: 'coder', name: 'Bolt', kind: 'agent' }).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm8']);
  });
});
