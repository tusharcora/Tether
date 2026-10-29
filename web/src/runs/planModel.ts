import { recent } from '../../../src/activity';
import { fmtDur, fmtUsd, type RunView } from '../api';
import { badgeFor, stepDesc } from '../ui/studio/status';
import type { SegState } from '../ui/studio/steps';

export type PlanState = 'done' | 'live' | 'waiting' | 'gate' | 'todo' | 'failed' | 'skipped';
export interface PlanRow {
  id: string;
  title: string;
  state: PlanState;
  /** Time a finished step took, the live verb, "Needs you", "Asks first"… */
  right?: string;
  /** The current step's latest activity, oldest first. */
  subs: { text: string; newest: boolean }[];
}
/** A plan state drawn with the step track's dot. */
export const PLAN_DOT: Record<PlanState, SegState> = { done: 'done', live: 'working', waiting: 'waiting', gate: 'gate', todo: 'queued', failed: 'failed', skipped: 'skipped' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SAY = new Set(['say', 'note', 'think', 'tool']);

/** A run's plan (spec §6.3): its steps in pipeline order with what each is doing or took. */
export function planRows(r: RunView): PlanRow[] {
  return r.pipeline.nodes.map((n): PlanRow => {
    const s = r.nodes[n.id];
    const row = { id: n.id, title: n.title ?? n.role ?? n.kind, subs: [] };
    switch (s?.status ?? 'queued') {
      case 'done':
        return { ...row, state: 'done', ...(s!.startedAt && s!.finishedAt ? { right: fmtDur(s!.finishedAt - s!.startedAt) } : {}) };
      case 'running': {
        const acts = recent(s!.live, 3);
        return { ...row, state: 'live', right: cap(badgeFor(stepDesc(n, s)).label), subs: acts.map((a, i) => ({ text: SAY.has(a.verb) ? a.text : `${cap(a.verb)} ${a.text}`, newest: i === acts.length - 1 })) };
      }
      case 'awaiting':
        return { ...row, state: 'waiting', right: 'Needs you' };
      case 'error':
        return { ...row, state: 'failed', right: 'Failed' };
      case 'skipped':
        return { ...row, state: 'skipped', right: 'Skipped' };
      default:
        return n.kind === 'approval' ? { ...row, state: 'gate', right: 'Asks first' } : { ...row, state: 'todo' };
    }
  });
}

/** Spend so far, against the run's cap when it has one. */
export function costLine(r: RunView): string {
  const limit = r.pipeline.settings.maxCostUsd ?? r.team?.budgetUsd;
  return limit !== undefined ? `${fmtUsd(r.costUsd)} of ${fmtUsd(limit)}` : fmtUsd(r.costUsd);
}
