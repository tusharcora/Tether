import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../api';
import { eventsForStep, gateRuns, neighbour } from './inspectorModel';

const ev = (seq: number, event: StoredEvent['event']): StoredEvent => ({ runId: 'r1', seq, ts: seq, event }) as StoredEvent;

describe('inspectorModel', () => {
  it('collects a step’s events, including loops and hand-offs to it', () => {
    const evs = [
      ev(1, { type: 'node.started', node: 'code', attempt: 1 }),
      ev(2, { type: 'loop', check: 'gate', fixNode: 'code', n: 1 }),
      ev(3, { type: 'node.started', node: 'plan', attempt: 1 }),
      ev(4, { type: 'handoff', from: 'plan', to: 'code', goal: 'g', answer: 'a', round: 1 }),
    ];
    expect(eventsForStep(evs, 'code').map((e) => e.seq)).toEqual([1, 2, 4]);
  });
  it('lists one row per gate run, falling back to the node’s last result', () => {
    const evs = [ev(1, { type: 'gate.result', node: 'gate', ok: false, exitCode: 1, output: 'x', durationMs: 900 }), ev(2, { type: 'gate.result', node: 'gate', ok: true, exitCode: 0, output: 'y', durationMs: 800 })];
    expect(gateRuns(evs, 'gate').map((g) => [g.attempt, g.ok, g.exitCode])).toEqual([[1, false, 1], [2, true, 0]]);
    expect(gateRuns([], 'gate', { ok: true, exitCode: 0, output: 'z' })).toEqual([{ attempt: 1, ok: true, exitCode: 0, durationMs: 0, output: 'z' }]);
    expect(gateRuns([], 'gate')).toEqual([]);
  });
  it('moves to neighbours and stops at the ends', () => {
    expect(neighbour(['a', 'b', 'c'], 'b', 1)).toBe('c');
    expect(neighbour(['a', 'b', 'c'], 'a', -1)).toBeUndefined();
    expect(neighbour([], 'x', 1)).toBeUndefined();
  });
});
