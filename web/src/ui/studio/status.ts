import type { AnimatedBadgeStatus } from '../../components/beui/motion/animated-badge';
import type { NodeState, Pipeline, RunRow, RunView } from '../../api';
import type { RunState as GlyphState } from './RunGlyph';

type PNode = Pipeline['nodes'][number];
export type RunDesc = { of: 'run'; status: RunView['status']; live: boolean; waiting: boolean; planning?: boolean };
export type StepDesc = { of: 'step'; status: NodeState['status']; kind: PNode['kind']; readOnly?: boolean; attempts: number; gateOk?: boolean; verdict?: 'PASS' | 'FAIL' };
export type StatusDesc = RunDesc | StepDesc;
export interface BadgeLook {
  state: AnimatedBadgeStatus;
  label: string;
}

const look = (state: AnimatedBadgeStatus, label: string): BadgeLook => ({ state, label });

/** One status → badge state and label (spec §10, §14.3). A waiting or interrupted run reads as "needs you" before anything else. */
export function badgeFor(d: StatusDesc): BadgeLook {
  if (d.of === 'run') {
    if (d.waiting && (d.status === 'running' || d.status === 'paused')) return look('warning', 'needs you');
    if (d.status === 'running') return !d.live ? look('warning', 'interrupted') : look('loading', d.planning ? 'planning' : 'running');
    if (d.status === 'done') return look('success', 'done');
    if (d.status === 'error') return look('danger', 'failed');
    return look('neutral', d.status);
  }
  switch (d.status) {
    case 'running':
      return look('loading', d.attempts > 1 ? 'retrying' : d.kind === 'gate' ? 'testing' : d.kind === 'agent' && d.readOnly ? 'reading' : 'writing');
    case 'awaiting':
      return look('warning', 'needs you');
    case 'done':
      if (d.verdict === 'FAIL') return look('danger', 'failed');
      return look('success', d.gateOk || d.verdict === 'PASS' ? 'passed' : 'done');
    case 'error':
      return look('danger', 'failed');
    default:
      return look('neutral', d.status);
  }
}

export function rowDesc(r: Pick<RunRow, 'status' | 'live' | 'pending' | 'planReady' | 'steps'>): RunDesc {
  return { of: 'run', status: r.status, live: r.live, waiting: r.pending > 0 || r.planReady || r.steps.some((s) => s.status === 'awaiting') };
}

export function viewDesc(r: RunView): RunDesc {
  const planWaits = r.kind === 'team' && !!r.plan && !r.planning && r.pipeline.nodes.length === 0;
  const waiting = r.pending.length > 0 || planWaits || Object.values(r.nodes).some((n) => n.status === 'awaiting');
  return { of: 'run', status: r.status, live: r.live, waiting, planning: r.planning };
}

export function stepDesc(n: PNode, s: NodeState | undefined): StepDesc {
  return { of: 'step', status: s?.status ?? 'queued', kind: n.kind, readOnly: n.readOnly, attempts: s?.attempts ?? 0, gateOk: s?.gate?.ok, verdict: s?.verdict };
}

const GLYPH: Record<AnimatedBadgeStatus, GlyphState> = { loading: 'running', warning: 'needs', success: 'done', danger: 'failed', neutral: 'idle', info: 'idle' };
export const glyphFor = (state: AnimatedBadgeStatus): GlyphState => GLYPH[state];
