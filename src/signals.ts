// Outcome signals: what happened to each finished agent step, read from the run's event log, and one score per step.
// Pure functions. Task 3 (the reflector) turns these into lessons; nothing here changes a run.
//
// Reading these signals:
// - A reviewer's FAIL is charged to the step it checked, never to the reviewer. A reviewer that fails good work is not penalised
//   by anything here (only a person's thumbs, or a check pointing at it, would), so lessons must NOT infer reviewer quality from
//   these signals. A verdict step with no fixNode and several upstream steps blames all of them equally.
// - Final verdict/gate wins: fail then pass shows pass with redos: 1.
// - node.requeued is deliberately not a redo. It re-queues steps downstream of a redone step ("<x> was redone"), or a step whose
//   question or plan approval was resolved; none of those is the requeued step's own work being sent back. Counting them would charge
//   downstream bots for an upstream bot's failure. The redo of the failing step itself is the `loop` event.
// - Note text is data from a person; cleanNote is hygiene, not fencing. Fence it when it goes into a prompt.
import { CREW } from './bots.js';
import { BUILTIN_BOTS } from './crew.js';
import type { NodeState, PipelineNode, Rating, RunState, StoredEvent } from './types.js';
export type { Rating };

export const RATINGS: readonly Rating[] = ['up', 'down'];
export const NOTE_MAX = 500;

export interface StepSignal {
  run: string;
  node: string;
  /** The bot id (the step's role, which must be exactly a known bot). */
  bot: string;
  /** Harness version the step's final attempt ran with; absent for logs from before Evolve. */
  harness?: number;
  /** Last result of the gate(s) that check this step. */
  gatePassed?: boolean;
  /** The verdict of the reviewer step that checks this step (a reviewer's own verdict is about the work it read, not about the reviewer). */
  verdict?: 'pass' | 'fail';
  /** How many times a check or manager sent this step back. */
  redos: number;
  handoffRefusals: number;
  /** A person approved or rejected the approval step after this one (automatic approvals do not count). */
  approved?: boolean;
  feedback?: Rating;
  costUsd: number;
  durationMs: number;
}

/** Feedback text is data from a person: control, bidi and zero-width characters out (newlines and tabs become spaces), trimmed, capped without splitting a character. Still data: Task 3 must fence it in prompts. */
export function cleanNote(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw
    .replace(/[\t\r\n]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '')
    .trim()
    .slice(0, NOTE_MAX)
    .replace(/[\ud800-\udbff]$/, '') // a cut through a surrogate pair leaves a lone high surrogate
    .trim();
  return t || undefined;
}

/** An exact known bot that runs as an agent step. `manager` is a bot (it emits signals) even though Evolve will not edit it. */
function botOf(n: PipelineNode): string | undefined {
  if (n.kind !== 'agent' || !n.role) return undefined;
  const def = CREW[n.role]?.def ?? BUILTIN_BOTS.find((b) => b.id === n.role);
  return def && (def.kind === 'agent' || def.kind === 'verdict') ? def.id : undefined;
}

/**
 * One signal per finished (done or error) agent step whose role is a known bot.
 * Pass the run's events to get exact per-attempt facts: the harness of the FINAL attempt (NodeState.harness is overwritten by each
 * attempt, and the final attempt is the one that produced the output), redo counts, summed duration and who resolved an approval.
 * Without events it falls back to the folded state: latest harness, redos from the checks' loop counters, last attempt's duration.
 * Consults are ignored: they never start a step.
 */
export function signalsOf(s: RunState, events?: StoredEvent[], o: { /** Probe replays are ignored unless this is set (the probe scores its own replays). */ probes?: boolean } = {}): StepSignal[] {
  if (s.probe && !o.probes) return [];
  const nodes = s.pipeline.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const preds = (id: string) => s.pipeline.edges.filter((e) => e.to === id).map((e) => e.from);
  /** The agent steps a check, gate or approval is about: the step it sends back, else what feeds it, else a spawning manager. */
  const targets = (c: PipelineNode): string[] => {
    if (c.fixNode) return [c.fixNode];
    // walk upstream through gates and approvals (an approval after a gate is about the step the gate checks)
    const t = new Set<string>();
    const seen = new Set<string>([c.id]);
    const walk = (id: string) => {
      for (const p of preds(id)) {
        if (seen.has(p)) continue;
        seen.add(p);
        const pn = byId.get(p);
        if (pn?.kind === 'agent') t.add(p);
        else if (pn) {
          if (pn.fixNode) t.add(pn.fixNode);
          else walk(p);
        }
      }
    };
    walk(c.id);
    if (!t.size && c.spawn?.parent) t.add(c.spawn.parent);
    return [...t];
  };
  const evs = events?.map((x) => x.event);
  const started = new Map<string, { bot: string; version: number; probe?: string } | undefined>();
  const loops = new Map<string, number>();
  const durations = new Map<string, number>();
  const approvedBy = new Map<string, string | undefined>();
  const refusals = new Map<string, number>();
  if (evs) {
    for (const e of evs) {
      if (e.type === 'node.started') started.set(e.node, e.harness);
      else if (e.type === 'loop') loops.set(e.fixNode, (loops.get(e.fixNode) ?? 0) + 1);
      else if (e.type === 'node.finished') durations.set(e.node, (durations.get(e.node) ?? 0) + e.durationMs);
      else if (e.type === 'approval.resolved') approvedBy.set(e.node, e.by);
      else if (e.type === 'handoff' && e.answer.startsWith('refused:')) refusals.set(e.from, (refusals.get(e.from) ?? 0) + 1);
    }
  }
  const out: StepSignal[] = [];
  for (const n of nodes) {
    const bot = botOf(n);
    const st: NodeState | undefined = s.nodes[n.id];
    if (!bot || !st || (st.status !== 'done' && st.status !== 'error') || st.finishedAt === undefined) continue;
    const checks = nodes.filter((c) => c.id !== n.id && (c.kind === 'gate' || c.kind === 'approval' || c.verdict) && targets(c).includes(n.id));
    const harness = evs ? started.get(n.id) : st.harness;

    let gatePassed: boolean | undefined;
    let verdict: 'pass' | 'fail' | undefined;
    let approved: boolean | undefined;
    for (const c of checks) {
      const cs = s.nodes[c.id];
      if (!cs) continue;
      if (c.kind === 'gate' && cs.gate) gatePassed = (gatePassed ?? true) && cs.gate.ok;
      else if (c.kind === 'approval') {
        if (cs.status !== 'done' && cs.status !== 'error') continue;
        const by = evs ? approvedBy.get(c.id) : s.autoApprove ? 'auto' : undefined;
        if (by === 'auto') continue;
        approved = (approved ?? true) && cs.status === 'done';
      } else if (c.verdict && cs.verdict) verdict = verdict === 'fail' || cs.verdict === 'FAIL' ? 'fail' : 'pass';
    }

    let redos = loops.get(n.id) ?? 0;
    if (!evs) redos = nodes.filter((c) => c.fixNode === n.id).reduce((a, c) => a + (s.nodes[c.id]?.loops ?? 0), 0);
    const duration = durations.get(n.id) ?? Math.max(0, st.finishedAt - (st.startedAt ?? st.finishedAt));
    out.push({
      run: s.id,
      node: n.id,
      bot,
      ...(harness && harness.bot === bot && !harness.probe ? { harness: harness.version } : {}),
      ...(gatePassed !== undefined ? { gatePassed } : {}),
      ...(verdict ? { verdict } : {}),
      redos,
      // events: exact (handoff events only). Without them the folded talk rows also hold consults, so this can over-count.
      handoffRefusals: evs ? (refusals.get(n.id) ?? 0) : (s.talk ?? []).filter((t) => t.from === n.id && t.answer.startsWith('refused:')).length,
      ...(approved !== undefined ? { approved } : {}),
      ...(st.feedback ? { feedback: st.feedback.rating } : {}),
      costUsd: st.costUsd,
      durationMs: duration,
    });
  }
  return out;
}

const count = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0);

/**
 * One score in [-1, 1] for a step. Weights: person's feedback +-0.5; verdict or gate +-0.3 (a failure of either is -0.3, else a pass of
 * either is +0.3); each redo -0.1 down to -0.3; a person's approval +-0.2; each refused handoff -0.05 down to -0.1. Cost and time are
 * not scored here: they only mean something against similar steps.
 */
export function scoreOf(sig: StepSignal): number {
  let v = 0;
  if (sig.feedback) v += sig.feedback === 'up' ? 0.5 : -0.5;
  const checks = [sig.verdict === undefined ? undefined : sig.verdict === 'pass', sig.gatePassed].filter((x): x is boolean => x !== undefined);
  if (checks.length) v += checks.every(Boolean) ? 0.3 : -0.3;
  v -= Math.min(0.3, 0.1 * count(sig.redos));
  if (sig.approved !== undefined) v += sig.approved ? 0.2 : -0.2;
  v -= Math.min(0.1, 0.05 * count(sig.handoffRefusals));
  return Math.max(-1, Math.min(1, Math.round(v * 1e6) / 1e6));
}
