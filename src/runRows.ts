/** The extra fields Home needs on each GET /api/runs row. Read-only, computed from the folded run state (no queries). */
import { realpathSync } from 'node:fs';
import { CREW, crewFor } from './bots.js';
import type { PipelineNode, RunRowExtras, RunState } from './types.js';

const real = new Map<string, string>();
/** The folder's real path (symlinks resolved: /tmp → /private/tmp on a Mac), remembered; the path itself when it is gone. */
export function realRepo(dir: string): string {
  let r = real.get(dir);
  if (r === undefined) {
    try {
      r = realpathSync(dir);
      real.set(dir, r);
    } catch {
      return dir;
    }
  }
  return r;
}

export const nodeTitle = (n: PipelineNode): string => n.title ?? n.role ?? n.id;

/** Ids, names, statuses and the branch only: no task text, prompts or outputs. */
export function rowExtras(s: RunState, lastTs: number): RunRowExtras {
  const steps = s.pipeline.nodes.map((n) => ({ id: n.id, status: s.nodes[n.id]?.status ?? 'queued', bot: crewFor(n) }));
  const cur = s.pipeline.nodes.find((n) => {
    const st = s.nodes[n.id]?.status;
    return st === 'running' || st === 'awaiting';
  });
  const bots = [...new Set(s.pipeline.nodes.filter((n) => n.kind === 'agent').map((n) => crewFor(n)))];
  return {
    branch: s.branch,
    lastTs,
    steps,
    ...(cur ? { current: { node: cur.id, bot: CREW[crewFor(cur)]?.name ?? crewFor(cur), title: nodeTitle(cur) } } : {}),
    bots,
    repoReal: realRepo(s.repo),
  };
}
