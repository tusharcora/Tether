/**
 * Tether as supervisor. When a run ends in error he decides what to do next, with rules that are
 * deterministic and logged, never improvised by a model:
 *
 *   round 1   retry the failed branch once (most failures are transient)
 *   round 2+  escalate: point the step that keeps failing at a stronger model, then retry
 *   otherwise stop, and say why, so a person takes over
 *
 * A model may be asked to *explain* the failure in a sentence or two, but it never picks the action.
 */
import type { Binding } from './bindings.js';
import type { Engine } from './engine.js';
import type { NodeState, PipelineNode, RunState } from './types.js';

/** Used when no `escalate` link is configured. */
export const DEFAULT_ESCALATION: Binding = { agent: 'claude', model: 'opus' };

export interface Decision {
  action: 'retry' | 'escalate' | 'stop';
  node?: string;
  target?: Binding;
  detail: string;
}

/**
 * The agent step to blame: the failed step itself, or the writer a failing check keeps looping back to.
 * A manager that failed only because a step it spawned failed points at that step.
 */
export function culprit(s: RunState): PipelineNode | undefined {
  const failed = s.pipeline.nodes.filter((n) => s.nodes[n.id]?.status === 'error');
  for (const n of failed) {
    if (n.manager && s.nodes[n.id]?.error?.startsWith('spawned step(s) failed')) {
      const kid = failed.find((k) => k.spawn?.parent === n.id && k.kind === 'agent');
      if (kid) return kid;
    }
    if (n.kind === 'agent' && !n.verdict && !n.fixNode) return n;
    const fix = n.fixNode ? s.pipeline.nodes.find((x) => x.id === n.fixNode) : undefined;
    if (fix?.kind === 'agent') return fix;
    if (n.kind === 'agent') return n;
  }
  return undefined;
}

const HARD_STOP = /cost cap|budget|wall[- ]clock|worktree is gone|preflight/i;

export function decide(s: RunState, round: number, maxRounds: number, escalate: Binding): Decision {
  if (s.status !== 'error') return { action: 'stop', detail: `run is ${s.status}` };
  if (round > maxRounds) return { action: 'stop', detail: `gave up after ${maxRounds} round${maxRounds === 1 ? '' : 's'}` };
  if (s.error && HARD_STOP.test(s.error)) return { action: 'stop', detail: `needs a person: ${s.error.split('\n')[0]!.slice(0, 120)}` };
  const failed = Object.entries(s.nodes).filter(([, n]) => n.status === 'error');
  if (!failed.length) return { action: 'stop', detail: 'the run failed outside any step; needs a person' };
  if (round === 1) return { action: 'retry', node: failed[0]![0], detail: `retrying ${failed.map(([id]) => id).join(', ')}` };
  const c = culprit(s);
  if (!c) return { action: 'stop', detail: 'no agent step to escalate; needs a person' };
  const sameAgent = (c.agent ?? 'claude') === escalate.agent;
  if (sameAgent && (c.model ?? '') === (escalate.model ?? '')) return { action: 'stop', detail: `${c.id} already runs on ${escalate.agent}${escalate.model ? ' · ' + escalate.model : ''}; nothing stronger to try` };
  return { action: 'escalate', node: c.id, target: escalate, detail: `moving ${c.id} to ${escalate.agent}${escalate.model ? ' · ' + escalate.model : ''}` };
}

export interface SuperviseOpts {
  maxRounds?: number;
  /** The stronger link to escalate to (bots.json "escalate"). */
  escalate?: Binding;
  /** Optional: one or two sentences on why it failed. Failures here are ignored. */
  diagnose?: (s: RunState) => Promise<string | undefined>;
  onAction?: (a: { round: number; action: string; node?: string; detail: string }) => void;
  signal?: AbortSignal;
}

/** Wait for the run; while it ends in error and rounds remain, apply the next rule and resume. */
export async function supervise(engine: Engine, runId: string, o: SuperviseOpts = {}): Promise<RunState> {
  const maxRounds = o.maxRounds ?? 2;
  const escalate = o.escalate ?? DEFAULT_ESCALATION;
  let s = await engine.wait(runId);
  for (let round = 1; s.status === 'error'; round++) {
    if (o.signal?.aborted) break;
    const d = decide(s, round, maxRounds, escalate);
    let detail = d.detail;
    if (o.diagnose) {
      const why = await o.diagnose(s).catch(() => undefined);
      if (why) detail += ` — ${why.replace(/\s+/g, ' ').slice(0, 240)}`;
    }
    engine.store.append(runId, { type: 'supervisor.action', round, action: d.action, node: d.node, detail });
    o.onAction?.({ round, action: d.action, node: d.node, detail });
    if (d.action === 'stop') break;
    if (d.action === 'escalate') engine.amend(runId, d.node!, { agent: d.target!.agent, model: d.target!.model }, `supervisor round ${round}`);
    await engine.resume(runId, { retryFailed: true });
    s = await engine.wait(runId);
  }
  return engine.store.state(runId) ?? s; // fresh: includes the action just logged
}

/** A compact description of a failure for a diagnosis prompt. */
export function failureBrief(s: RunState): string {
  const parts: string[] = [`task: ${s.task.split('\n')[0]!.slice(0, 200)}`];
  for (const [id, n] of Object.entries(s.nodes) as [string, NodeState][]) {
    if (n.status !== 'error') continue;
    parts.push(`step ${id}: ${(n.error ?? '').split('\n')[0]!.slice(0, 200)}`);
    if (n.gate && !n.gate.ok) parts.push(`gate output (tail): ${n.gate.output.split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 400)}`);
  }
  if (s.error) parts.push(`run error: ${s.error.split('\n')[0]!.slice(0, 200)}`);
  return parts.join('\n');
}
