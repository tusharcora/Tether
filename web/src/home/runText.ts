import { isFinished } from '../../../src/runLabels';
import type { RunRow } from '../api';

/** The run's label and finished statuses come from the one shared copy (`src/runLabels.ts`). */
export { isFinished, runTitle } from '../../../src/runLabels';

/** "What's happening now" for a live run, from its current step (no free text). */
export function nowLine(r: RunRow): string {
  if (r.kind === 'team' && !r.steps.length) return r.planReady ? 'The plan waits for your approval' : r.pending ? 'Maestro has a question for you' : 'Maestro is planning';
  if (!r.current) return 'Between steps';
  const status = r.steps.find((s) => s.id === r.current!.node)?.status;
  return status === 'awaiting' ? `${r.current.title} waits for you` : `${r.current.bot} is working on ${r.current.title}`;
}

/** The face that breathes: the current step's bot, or Maestro while a team plans. */
export function workingBot(r: RunRow): string | undefined {
  if (r.current) return r.steps.find((s) => s.id === r.current!.node)?.bot;
  return r.kind === 'team' && !r.steps.length ? 'orchestrator' : undefined;
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
