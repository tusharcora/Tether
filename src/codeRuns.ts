/** What runs did to a project's files, for the Code screen: the run writing in this checkout right now. */
import { realpathSync } from 'node:fs';
import { CREW } from './bots.js';
import { rowLive, type LiveProbe } from './runLabels.js';
import type { Store } from './store.js';

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

export interface RunLock {
  runId: string;
  node: string;
  /** The bot doing the step, by name ("Bolt"). */
  bot: string;
}

/**
 * A live run whose worktree is this very folder (`root`, a real path) and whose running step writes files: saving from
 * the Code screen waits for it (423). Runs in their own worktrees never lock the project's checkout.
 */
export function writingRun(store: Store, engine: LiveProbe, root: string): RunLock | undefined {
  for (const { summary, state, lastTs } of store.listRows()) {
    if (!rowLive(engine, { ...summary, lastTs }) || real(state.workdir) !== root) continue;
    const step = state.pipeline.nodes.find((n) => n.kind === 'agent' && !n.readOnly && state.nodes[n.id]?.status === 'running');
    if (step) return { runId: summary.id, node: step.id, bot: (step.role && CREW[step.role]?.name) || step.title || step.id };
  }
  return undefined;
}
