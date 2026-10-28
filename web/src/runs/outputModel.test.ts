import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../api';
import { nodeOf, OUTPUT_KEEP, outputLines } from './outputModel';

const ev = (seq: number, event: StoredEvent['event']): StoredEvent => ({ runId: 'r1', seq, ts: seq, event }) as StoredEvent;
const nameOf = (id: string) => ({ code: 'Bolt', plan: 'Scout' })[id] ?? id;

describe('outputModel', () => {
  it('makes one line per described event, prefixed by the bot, in order', () => {
    const lines = outputLines([ev(1, { type: 'run.started' } as never), ev(2, { type: 'node.started', node: 'code', attempt: 1 }), ev(3, { type: 'manager.cost', node: 'code', costUsd: 1 } as never)], nameOf);
    expect(lines.map((l) => [l.who, l.text, l.node])).toEqual([['tether', 'run started', undefined], ['Bolt', 'started', 'code']]);
    expect(lines[1]!.tone).toBe('running');
  });
  it('keeps the last 200 lines', () => {
    expect(outputLines(Array.from({ length: 250 }, (_, i) => ev(i, { type: 'node.started', node: 'code', attempt: 1 })), nameOf)).toHaveLength(OUTPUT_KEEP);
  });
  it('finds the step of a loop by its check and of a handoff by its sender', () => {
    expect(nodeOf({ type: 'loop', check: 'gate', fixNode: 'code', n: 1 })).toBe('gate');
    expect(nodeOf({ type: 'handoff', from: 'plan', to: 'code', goal: 'g', answer: 'a', round: 1 })).toBe('plan');
    expect(nodeOf({ type: 'run.started' } as never)).toBeUndefined();
  });
});
