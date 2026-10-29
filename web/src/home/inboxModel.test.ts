import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '../api';
import { ACTION_WORD, groupInbox, nextSelection } from './inboxModel';

const it_ = (id: string, kind: AttentionItem['kind'], runId = 'r1', ts = 1): AttentionItem => ({ id, ts, runId, kind, title: id, meta: 'm', actions: [] });

describe('inboxModel', () => {
  it('groups a run’s questions and keeps other items apart, in order', () => {
    const g = groupInbox([it_('a', 'question', 'r1', 5), it_('b', 'approval', 'r2', 4), it_('c', 'question', 'r1', 3), it_('d', 'question', 'r3', 2)]);
    expect(g.map((e) => [e.key, e.items.length])).toEqual([['r1:questions', 2], ['b', 1], ['r3:questions', 1]]);
  });
  it('moves the selection to the neighbour when the open item goes', () => {
    const A = groupInbox([it_('a', 'failed'), it_('b', 'paused', 'r2'), it_('c', 'failed', 'r3')]);
    expect(nextSelection(A, A, 'b')).toBe('b');
    expect(nextSelection(A, A.filter((e) => e.key !== 'b'), 'b')).toBe('c');
    expect(nextSelection(A, A.slice(0, 2), 'c')).toBe('b');
    expect(nextSelection(A, [], 'a')).toBeUndefined();
    expect(nextSelection([], A, undefined)).toBe('a');
  });
  it('covers all eight kinds with an action word', () => expect(Object.keys(ACTION_WORD).sort()).toEqual(['approval', 'failed', 'free_limit', 'interrupted', 'paused', 'plan_ready', 'planning_error', 'question']));
});
