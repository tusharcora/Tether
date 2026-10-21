/** Numbers for the run view: cost over time, step durations, and how fast output is streaming. Pure + one small in-memory tracker. */
import type { RunState, StoredEvent } from './types.js';

/** Cumulative spend after each step that reported a cost, starting from zero. */
export function costSeries(events: StoredEvent[]): number[] {
  const out = [0];
  for (const { event: e } of events) if ((e.type === 'node.finished' || e.type === 'manager.cost') && (e.costUsd ?? 0) > 0) out.push(out[out.length - 1]! + e.costUsd!);
  return out;
}

export interface StepTime {
  id: string;
  label: string;
  role: string;
  ms: number;
  running: boolean;
}

/** How long each started step has taken (running steps measure to `now`). */
export function stepDurations(s: RunState, now: number): StepTime[] {
  const out: StepTime[] = [];
  for (const n of s.pipeline.nodes) {
    const ns = s.nodes[n.id];
    if (!ns?.startedAt) continue;
    const running = ns.status === 'running' || ns.status === 'awaiting';
    const end = running || !ns.finishedAt || ns.finishedAt < ns.startedAt ? now : ns.finishedAt;
    out.push({ id: n.id, label: n.title ?? n.role ?? n.kind, role: n.role ?? n.kind, ms: Math.max(0, end - ns.startedAt), running });
  }
  return out;
}

/** Remembers recent streamed output per run so the UI can show a rate. Memory only; never touches disk. */
export class Pulse {
  private seen = new Map<string, { t: number; n: number }[]>();
  constructor(private readonly windowMs = 10_000) {}

  observe(runId: string, e: StoredEvent['event'], now = Date.now()) {
    if (e.type !== 'node.chunk') return;
    const a = this.seen.get(runId) ?? [];
    a.push({ t: now, n: e.text.length });
    while (a.length && a[0]!.t < now - this.windowMs) a.shift();
    this.seen.set(runId, a);
  }

  /** Characters per second over the last window. */
  rate(runId: string, now = Date.now()): number {
    const a = (this.seen.get(runId) ?? []).filter((x) => x.t >= now - this.windowMs);
    if (!a.length) return 0;
    return a.reduce((t, x) => t + x.n, 0) / (this.windowMs / 1000);
  }

  /** Per-second buckets over the window, oldest first, for a sparkline. */
  series(runId: string, now = Date.now(), buckets = 20): number[] {
    const out = new Array<number>(buckets).fill(0);
    const w = this.windowMs / buckets;
    for (const x of this.seen.get(runId) ?? []) {
      const i = Math.floor((x.t - (now - this.windowMs)) / w);
      if (i >= 0 && i < buckets) out[i]! += x.n;
    }
    return out;
  }
}
