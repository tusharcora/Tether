import type { NodeState, StoredEvent } from '../api';
import { nodeOf } from './outputModel';

/** A step's events: those about it, plus fix loops sent to it, hand-offs and consults to it, and its own spawn. */
export function eventsForStep(events: StoredEvent[], id: string): StoredEvent[] {
  return events.filter(({ event: e }) => nodeOf(e) === id || (e.type === 'loop' && e.fixNode === id) || ((e.type === 'handoff' || e.type === 'consult') && e.to === id) || (e.type === 'node.spawned' && e.node.id === id));
}

export interface GateRun {
  attempt: number;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  output: string;
}

/** One row per gate run, in order; with no gate.result events, the node's last result as run 1. */
export function gateRuns(events: StoredEvent[], id: string, fallback?: NodeState['gate']): GateRun[] {
  const runs = events.flatMap(({ event: e }) => (e.type === 'gate.result' && e.node === id ? [{ ok: e.ok, exitCode: e.exitCode, durationMs: e.durationMs, output: e.output }] : []));
  if (!runs.length && fallback) runs.push({ ok: fallback.ok, exitCode: fallback.exitCode, durationMs: 0, output: fallback.output });
  return runs.map((g, i) => ({ attempt: i + 1, ...g }));
}

/** The step before or after `id` in `order`; none at the ends or when `id` is not there. */
export function neighbour(order: string[], id: string, dir: -1 | 1): string | undefined {
  const i = order.indexOf(id);
  return i < 0 ? undefined : order[i + dir];
}
