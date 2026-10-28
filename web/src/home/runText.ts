import { isFinished, runTitle } from '../../../src/runLabels';
import type { RunRow } from '../api';

/** The run's label and finished statuses come from the one shared copy (`src/runLabels.ts`). */
export { isFinished, runTitle } from '../../../src/runLabels';

/** A run's title: the first non-empty line of its task (CSS truncates it), else its label. */
export function taskTitle(r: { task: string; kind: string; pipeline: string }): string {
  return r.task.split('\n').map((l) => l.trim()).find(Boolean) ?? runTitle(r);
}

/** "step n of m": the current step's place, else the one after the finished and skipped steps; undefined without steps. */
export function stepOf(r: RunRow): string | undefined {
  const m = r.steps.length;
  if (!m) return undefined;
  const i = r.current ? r.steps.findIndex((s) => s.id === r.current!.node) : -1;
  const n = i >= 0 ? i + 1 : Math.min(r.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length + 1, m);
  return `step ${n} of ${m}`;
}

/** "What's happening now" for a live run, from its current step (no free text). */
export function nowLine(r: RunRow): string {
  if (r.kind === 'team' && !r.steps.length) return r.planReady ? 'The plan waits for your approval' : r.pending ? 'Tether has a question for you' : 'Tether is planning';
  if (!r.current) return 'Between steps';
  const status = r.steps.find((s) => s.id === r.current!.node)?.status;
  return status === 'awaiting' ? `${r.current.title} waits for you` : `${r.current.bot} is working on ${r.current.title}`;
}

/** The 5 most recently finished runs, Evolve probes left out. */
export function recentRuns(rows: RunRow[]): RunRow[] {
  return rows
    .filter((r) => !r.probe && isFinished(r.status))
    .sort((a, b) => (b.finishedAt ?? b.lastTs) - (a.finishedAt ?? a.lastTs))
    .slice(0, 5);
}

/** Bots of running steps in live runs (liveness is the server's `live` flag). */
export function busyBots(rows: RunRow[]): Set<string> {
  return new Set(rows.filter((r) => r.live).flatMap((r) => r.steps.filter((s) => s.status === 'running').map((s) => s.bot)));
}

/** An elapsed clock: m:ss, or h:mm:ss from an hour. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
