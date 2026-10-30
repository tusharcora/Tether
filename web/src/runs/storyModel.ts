/**
 * A run's page (board 4) as data: its steps told as a story ("Bolt made the changes", "Probe ran npm test", "You
 * approve"), the decision it waits on, what it cost per agent, and which step a Send back reruns. Pure.
 */
import { fmtDur, fmtUsd, type RunView } from '../api';
import type { PipelineNode } from '../../../src/types';
import { planConflict } from '../../../src/runLabels';
import { stepOrder } from './graphModel';

export type StoryState = 'done' | 'working' | 'waiting' | 'failed' | 'queued' | 'skipped';
export interface StoryRow {
  id: string;
  /** The step the row is; none for planning and the person's questions. */
  node?: string;
  /** Whose face: a crew bot id, or 'tether' (planning), or none for the person. */
  bot?: string;
  sentence: string;
  line: string;
  state: StoryState;
  /** It waits on the person (a question, the plan, an approval). */
  you?: boolean;
}

const STATE: Record<string, StoryState> = { done: 'done', running: 'working', awaiting: 'waiting', error: 'failed', queued: 'queued', skipped: 'skipped' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const took = (s: RunView['nodes'][string]) => (s.startedAt !== undefined && s.finishedAt !== undefined ? fmtDur(s.finishedAt - s.startedAt) : '');

/** What an agent step did, said the way a person would: by what kind of step it is and where it stands. */
function agentSentence(name: string, n: PipelineNode, st: StoryState, verdict?: 'PASS' | 'FAIL'): string {
  const review = !!n.verdict;
  if (st === 'done') return `${name} ${review ? 'reviewed' : n.readOnly ? 'looked into it' : 'made the changes'}`;
  if (st === 'working') return `${name} ${review ? 'is reviewing' : n.readOnly ? 'is looking into it' : 'is making the changes'}`;
  if (st === 'failed') return review && verdict === 'FAIL' ? `${name} found problems` : `${name} failed`;
  if (st === 'skipped') return `${name} was skipped`;
  if (st === 'waiting') return `${name} waits on you`;
  return `${name} ${review ? 'reviews' : n.readOnly ? 'looks into it' : 'makes the changes'} next`;
}

/** The run's steps in graph order as story rows; a team run's planning (and its questions or plan for you) first. */
export function storyRows(r: RunView, botOf: (n: PipelineNode) => string, nameOf: (bot: string) => string): StoryRow[] {
  const rows: StoryRow[] = [];
  if (r.kind === 'team') {
    const picked = [...new Set((r.plan?.assignments ?? []).map((a) => nameOf(a.bot)))];
    rows.push(
      r.plan
        ? { id: 'planning', bot: 'tether', sentence: 'Tether planned', line: [picked.length ? `picked ${picked.join(', ')}` : '', r.answers.length ? plural(r.answers.length, 'answer') : ''].filter(Boolean).join(' · '), state: 'done' }
        : { id: 'planning', bot: 'tether', sentence: 'Tether is planning', line: r.round ? `round ${r.round}` : '', state: r.status === 'error' ? 'failed' : 'working' },
    );
  }
  if (r.pending.length || (r.kind === 'team' && r.plan && !r.pipeline.nodes.length && r.status === 'running' && !r.planning)) {
    rows.push(r.pending.length ? { id: 'questions', sentence: 'Tether asks you', line: plural(r.pending.length, 'question'), state: 'waiting', you: true } : { id: 'questions', sentence: 'You review the plan', line: r.plan && planConflict(r.plan, r.task) ? `check it: ${planConflict(r.plan, r.task)}` : 'the plan is ready', state: 'waiting', you: true });
  }
  const byId = new Map(r.pipeline.nodes.map((n) => [n.id, n]));
  for (const id of stepOrder(r.pipeline.nodes, r.pipeline.edges)) {
    const n = byId.get(id)!;
    const s = r.nodes[id] ?? { status: 'queued', attempts: 0, costUsd: 0, loops: 0 };
    const st = STATE[s.status] ?? 'queued';
    const title = n.title ?? n.role ?? n.id;
    if (n.kind === 'approval') {
      rows.push({ id, node: id, sentence: /^(you )?approv/i.test(title) || title === n.id ? 'You approve' : `You approve: ${title}`, line: st === 'waiting' ? 'waiting on you' : st === 'done' ? 'approved' : st === 'failed' ? 'rejected' : 'after the steps above', state: st, you: true });
      continue;
    }
    const bot = botOf(n);
    const name = nameOf(bot);
    if (n.kind === 'gate') {
      const cmd = n.command ?? title;
      const result = s.gate ? (s.gate.ok ? 'passed' : `failed (exit ${s.gate.exitCode ?? '?'})`) : '';
      rows.push({ id, node: id, bot, sentence: st === 'done' ? `${name} ran ${title}` : st === 'failed' ? `${title} failed` : st === 'working' ? `${name} is running ${title}` : `${name} runs ${title}`, line: [cmd !== title ? cmd : '', result, s.loops ? plural(s.loops, 'fix loop') : '', took(s)].filter(Boolean).join(' · '), state: st });
      continue;
    }
    const stat = s.stat ? `${plural(s.stat.files, 'file')} · +${s.stat.added} −${s.stat.deleted}` : '';
    rows.push({ id, node: id, bot, sentence: agentSentence(name, n, st, s.verdict), line: [title !== n.role ? title : '', stat, s.verdict ? `verdict ${s.verdict}` : '', took(s), s.costUsd ? fmtUsd(s.costUsd) : ''].filter(Boolean).join(' · '), state: st });
  }
  // auto-fix's rounds after the steps they ran again (spec 2026-10-30 §3.4)
  const a = r.autofix;
  if (a) {
    a.rounds.forEach((x, i) => rows.push({ id: `autofix-${x.round}`, bot: 'tether', sentence: `Tether auto-fixed: round ${x.round} of ${a.of}`, line: roundLine(r, x, botOf, nameOf), state: i === a.rounds.length - 1 && r.status === 'running' ? 'working' : 'done' }));
    if (a.gaveUp) rows.push({ id: 'autofix-gave-up', bot: 'tether', sentence: a.round ? `Auto-fix gave up after ${plural(a.round, 'round')}` : 'Auto-fix could not help', line: a.gaveUp, state: 'failed' });
    else if (a.needsWrites) rows.push({ id: 'autofix-writes', sentence: 'Tether asks: allow edits and retry?', line: a.needsWrites, state: 'waiting', you: true });
  }
  return rows;
}

type Round = NonNullable<RunView['autofix']>['rounds'][number];
/** What one auto-fix round did, said plainly: "moved Lens to opus", "retried with the diagnosis attached". */
function roundLine(r: RunView, x: Round, botOf: (n: PipelineNode) => string, nameOf: (bot: string) => string): string {
  if (x.action === 'escalate') {
    const n = r.pipeline.nodes.find((y) => y.id === x.node);
    return `moved ${n ? nameOf(botOf(n)) : (x.node ?? 'the step')} to ${x.to?.model ?? x.to?.agent ?? 'a stronger model'}`;
  }
  return /diagnosis/.test(x.detail) ? 'retried with the diagnosis attached' : /edits allowed/.test(x.detail) ? 'retried with edits allowed' : 'retried the failed steps';
}

/** The run header's auto-fix line: "Auto-fixing · round 2 of 3 · moved Lens to opus", how it ended, or nothing. */
export function autofixLine(r: RunView, nameOf: (bot: string) => string, botOf: (n: PipelineNode) => string): string | undefined {
  const a = r.autofix;
  if (!a) return undefined;
  if (r.status === 'done') return a.round ? `Fixed by auto-fix in round ${a.round}` : undefined;
  if (a.gaveUp) return a.round ? `Auto-fix gave up after ${plural(a.round, 'round')}` : 'Auto-fix could not help';
  if (a.needsWrites) return 'Auto-fix waits on you: allow edits and retry?';
  if (r.status !== 'running' && r.status !== 'error') return undefined;
  const last = a.rounds.at(-1);
  return a.round ? `Auto-fixing · round ${a.round} of ${a.of}${last ? ` · ${roundLine(r, last, botOf, nameOf)}` : ''}` : 'Auto-fixing · working out what went wrong';
}

/** The step the page opens on: the route's, the one working, the last one that changed files, else the first. */
export function defaultStep(r: RunView, rows: StoryRow[]): string | undefined {
  const steps = rows.filter((x) => x.node);
  return (steps.find((x) => x.state === 'working') ?? [...steps].reverse().find((x) => x.node && r.nodes[x.node]?.commit) ?? steps.find((x) => x.state === 'waiting') ?? steps[0])?.id;
}

/** The approval the run waits on and whether it is the last word before shipping (nothing but approvals after it). */
export function decisionOf(r: RunView): { node: string; title: string; final: boolean } | undefined {
  const n = r.pipeline.nodes.find((x) => x.kind === 'approval' && r.nodes[x.id]?.status === 'awaiting');
  if (!n) return undefined;
  const after = new Set<string>();
  const stack = [n.id];
  while (stack.length) {
    const from = stack.pop();
    for (const e of r.pipeline.edges) if (e.from === from && !after.has(e.to)) (after.add(e.to), stack.push(e.to));
  }
  const final = [...after].every((id) => r.pipeline.nodes.find((x) => x.id === id)?.kind === 'approval');
  return { node: n.id, title: n.title ?? 'Approve', final };
}

/** "Checks pass and Lens approved. Ship it?": what the gates and reviewers say before the person ships. */
export function decisionLine(r: RunView, nameOf: (n: PipelineNode) => string): string {
  const gates = r.pipeline.nodes.filter((n) => n.kind === 'gate');
  const passed = gates.length > 0 && gates.every((n) => r.nodes[n.id]?.status === 'done');
  const failed = gates.some((n) => r.nodes[n.id]?.status === 'error');
  const reviewers = r.pipeline.nodes.filter((n) => n.verdict && r.nodes[n.id]?.verdict === 'PASS').map(nameOf);
  const who = reviewers.length > 1 ? `${reviewers.slice(0, -1).join(', ')} and ${reviewers.at(-1)}` : reviewers[0];
  if (failed) return 'A check failed. Ship it anyway?';
  if (passed && who) return `Checks pass and ${who} approved. Ship it?`;
  if (passed) return 'Checks pass. Ship it?';
  if (who) return `${who} approved. Ship it?`;
  return 'Ship it?';
}

/** What the run cost per agent and model (and Tether's planning, the rest), dearest first. */
export function costParts(r: RunView, botOf: (n: PipelineNode) => string, nameOf: (bot: string) => string): { label: string; usd: number; bot?: string }[] {
  const parts = new Map<string, { label: string; usd: number; bot?: string }>();
  let steps = 0;
  for (const n of r.pipeline.nodes) {
    const usd = r.nodes[n.id]?.costUsd ?? 0;
    steps += usd;
    if (n.kind !== 'agent') continue;
    const bot = botOf(n);
    const label = `${nameOf(bot)} · ${n.agent === 'openrouter' || n.agent === 'nvidia' ? 'free' : (n.model ?? n.agent ?? 'claude')}`;
    const p = parts.get(label) ?? { label, usd: 0, bot };
    p.usd += usd;
    parts.set(label, p);
  }
  const planning = r.costUsd - steps;
  if (planning > 0.0001) parts.set('planning', { label: 'Tether · planning', usd: planning, bot: 'tether' });
  return [...parts.values()].sort((a, b) => b.usd - a.usd);
}
