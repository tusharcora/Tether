import { beforeEach, describe, expect, it } from 'vitest';
import type { TeamMessage, TeamView } from '../teams/teamsApi';
import { channel, mapToday, markSeen, pinned, rightNow, seenAt, threadSummary, typing, unread } from './squadModel';

const you = { kind: 'person' as const, id: 'owner', name: 'you' };
const bolt = { kind: 'agent' as const, id: 'coder', name: 'Bolt' };
const lens = { kind: 'agent' as const, id: 'reviewer', name: 'Lens' };
const NOW = new Date(2026, 9, 30, 14, 10).getTime();
const msg = (id: string, from: TeamMessage['from'], text: string, o: Partial<TeamMessage> = {}): TeamMessage => ({ id, at: NOW - 60_000, from, text, ...o });
const members: TeamView['members'] = [
  { id: 'coder', name: 'Bolt', specialty: 'code', state: 'coding', line: 'editing Tabs.tsx', progress: 0.5 },
  { id: 'reviewer', name: 'Lens', specialty: 'review', state: 'reviewing' },
  { id: 'tester', name: 'Probe', specialty: 'tests', state: 'idle' },
];
const ship = msg('m4', bolt, '@you ready when you are.', { card: { kind: 'approval', what: 'ship', title: 'Ship “Sign-in fix”?', runId: 'r1', node: 'ship', status: 'pending' } });
const messages = [
  msg('m1', you, '@Bolt people land on /home after sign-in. can you fix it?'),
  msg('m2', bolt, 'Fixed it. 3 files, tests pass. @Lens mind checking the redirect check?', { run: 'r1', handoff: { to: 'reviewer', name: 'Lens', review: true } }),
  msg('m3', lens, 'One thing: //evil.com still counts. @Bolt can you reject those too?', { handoff: { to: 'coder', name: 'Bolt', review: false } }),
  msg('t1', bolt, 'Good catch. Now rejecting anything starting with //, plus a test.', { thread: 'm3' }),
  msg('t2', lens, 'Checked it. Good to go from me.', { thread: 'm3' }),
  ship,
];

describe('Right now (board 8)', () => {
  it('a card per busy agent, a You card when something waits, the free ones together', () => {
    expect(rightNow({ members, messages })).toEqual({ busy: [members[0], members[1]], you: { count: 1, first: 'Ship “Sign-in fix”?' }, free: [members[2]] });
    expect(rightNow({ members, messages: [] }).you).toBeUndefined();
  });

  it('a card filters the channel to that member; threads stay in their panel', () => {
    expect(channel(messages, 'all', members).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(channel(messages, 'reviewer', members).map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(channel(messages, 'coder', members).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(channel(messages, 'you', members).map((m) => m.id)).toEqual(['m1', 'm4']);
    expect(channel(messages, 'tester', members)).toEqual([]);
  });
});

describe('threads, typing, the map and the pulse', () => {
  it('a thread says how many replies, who, and the last one’s first words', () => {
    expect(threadSummary(messages, 'm3')).toEqual({ n: 2, who: ['coder', 'reviewer'], line: 'Lens checked it' });
    expect(threadSummary(messages, 'm1')).toBeUndefined();
  });

  it('the typing line comes from an agent’s message still being written', () => {
    expect(typing([...messages, msg('p', lens, "Reading Bolt's change…", { pending: true })])).toEqual({ id: 'reviewer', name: 'Lens', line: "is reading Bolt's change" });
    expect(typing([...messages, msg('p', lens, '…', { pending: true })])).toMatchObject({ line: 'is typing' });
    expect(typing([...messages, msg('p', lens, '…', { pending: true, thread: 'm3' })])).toBeUndefined();
    expect(typing(messages)).toBeUndefined();
  });

  it('the map draws today’s hand-offs; a line is live while the one it went to works', () => {
    const old = msg('o', you, '@Probe run the tests', { at: NOW - 2 * 86_400_000 });
    expect(mapToday([...messages, old], members, NOW)).toEqual([
      { from: 'you', to: 'coder', n: 1, live: true },
      { from: 'coder', to: 'reviewer', n: 1, live: true },
      { from: 'reviewer', to: 'coder', n: 1, live: true },
    ]);
  });

  it('pins read as a decision or a link, newest pin first', () => {
    const p = [msg('a', you, 'decision: redirects only follow same-site paths', { pinned: { by: 'you', at: 1 } }), msg('b', you, 'Staging: https://acme-web.dev', { pinned: { by: 'you', at: 2 } }), msg('c', you, 'not pinned')];
    expect(pinned(p)).toEqual([
      { id: 'b', kind: 'Link', text: 'Staging: https://acme-web.dev', url: 'https://acme-web.dev' },
      { id: 'a', kind: 'Decision', text: 'redirects only follow same-site paths' },
    ]);
  });
});

describe('unread (per viewer)', () => {
  beforeEach(() => localStorage.clear());
  it('counts messages from others since the squad was last looked at on this machine', () => {
    expect(unread([1, 2, 3], undefined)).toBe(3);
    markSeen('web', 2);
    expect(seenAt()).toEqual({ web: 2 });
    expect(unread([1, 2, 3], seenAt().web)).toBe(1);
  });
});
