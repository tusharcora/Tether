/**
 * How every screen names and classifies a run: one copy, shared by the server and the web dashboard.
 * Pure on purpose (type imports only), so `web/` can import it without pulling in server code.
 */
import type { RunState, RunStatus } from './types.js';

/** Statuses a run ends in (it will not change again unless resumed or retried). */
export const FINISHED: ReadonlySet<RunStatus> = new Set<RunStatus>(['done', 'error', 'stopped']);
export const isFinished = (status: string): boolean => FINISHED.has(status as RunStatus);

/** The run's label: its pipeline name, or "Team run". */
export const runTitle = (r: { kind: string; pipeline: string }): string => (r.kind === 'team' ? 'Team run' : r.pipeline);

/** "label · id · branch", the line under a run's title. */
export const runMeta = (r: { kind: string; pipeline: string; id: string; branch: string }): string => `${runTitle(r)} · ${r.id} · ${r.branch}`;

/** A step's name with its id, e.g. "Implement (code)"; the bare id when the step is not in the pipeline. */
export const stepLabel = (nodes: readonly { id: string; kind: string; role?: string; title?: string }[], id: string): string => {
  const n = nodes.find((x) => x.id === id);
  return n ? `${n.title ?? n.role ?? n.kind} (${id})` : id;
};

/** What the live formula needs from the engine. */
export interface LiveProbe {
  isLive(runId: string): boolean;
  isPlanning(runId: string): boolean;
}
type LiveRow = { id: string; kind: RunState['kind']; status: RunState['status']; pending: number; planReady: boolean };

/**
 * A team run before execution that waits for the person (a card or a ready plan) needs no process, so it is never
 * "interrupted": it is live as far as the dashboard goes (Stop, no Resume). So is one whose planning call is in flight.
 */
export const teamWaits = (engine: LiveProbe, r: LiveRow): boolean =>
  r.kind === 'team' && r.status === 'running' && (engine.isPlanning(r.id) || r.pending > 0 || r.planReady);

/** A run row's `live`: its process runs in this server, or it is a team run waiting on the person. */
export const rowLive = (engine: LiveProbe, r: LiveRow): boolean => engine.isLive(r.id) || teamWaits(engine, r);
