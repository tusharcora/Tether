import type { Answer, Edge, NodeState, Pipeline, Question, RunRowExtras, RunState, StoredEvent, TeamMode, TeamPlan } from '../../src/types.js';

export type { Answer, Edge, NodeState, Pipeline, Question, RunState, StoredEvent, TeamMode, TeamPlan };
export type { ActivityLine, AttentionAction, AttentionItem, Pin, RosterPreview, RunStep, VaultActivityItem } from '../../src/types.js';
export type RunView = RunState & { live: boolean };
export interface RunRow extends RunRowExtras {
  id: string;
  pipeline: string;
  task: string;
  repo: string;
  status: RunState['status'];
  startedAt: number;
  finishedAt?: number;
  costUsd: number;
  live: boolean;
  nodes: Record<string, string>;
  kind: RunState['kind'];
  mode: TeamMode;
  /** Questions waiting for the person. */
  pending: number;
  /** A team run's plan is ready and waits for approval. */
  planReady: boolean;
  /** An Evolve probe replay (listed only with ?all=1). */
  probe?: true;
  /** Where it was started from (runs before 2026-10-29: none). */
  origin?: RunState['origin'];
  /** Its PR, once shipped. */
  ship?: RunState['ship'];
}
export interface Issue {
  level: 'error' | 'warn';
  node?: string;
  message: string;
}
export interface VaultGraph {
  nodes: { id: string; title: string; type?: string; tags: string[]; degree: number }[];
  edges: { from: string; to: string }[];
  unresolved: number;
}
export interface VaultNote {
  path: string;
  title: string;
  type?: string;
  tags: string[];
  body: string;
  links: string[];
  backlinks: string[];
}

/** A non-2xx reply: the server's JSON `error` text plus the HTTP status (Home tells a 409 "no workspace" apart). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new ApiError(json?.error ?? (text.slice(0, 200) || `HTTP ${res.status}`), res.status);
  return json as T;
}

export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
/** 450ms, 4.2s, 6m 12s, 3h 12m, 3d 16h: the two largest units from a minute up. */
export const fmtDur = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return m < 60 ? `${m}m ${s % 60}s` : h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
export const ago = (t: number) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

/** A time of day in local time: "20:00". */
export const clock = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const kTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
/** A step's tool-call metrics in one line: Code Mode or direct, run_code runs, connector calls, round-trips and tokens. */
export function metricsLine(e: Extract<StoredEvent['event'], { type: 'node.metrics' }>): string {
  const parts = [e.toolStyle === 'code' ? 'Code Mode' : e.fallback ? 'direct (no Code Mode route)' : 'direct'];
  if (e.toolStyle === 'code') parts.push(`${e.runCode} run_code`, `${e.connectorCalls} connector call${e.connectorCalls === 1 ? '' : 's'}`);
  if (e.roundTrips !== undefined) parts.push(`${e.roundTrips} tool round-trip${e.roundTrips === 1 ? '' : 's'}`);
  if (e.inputTokens || e.outputTokens) parts.push(`${kTokens((e.inputTokens ?? 0) + (e.outputTokens ?? 0))} tokens`);
  return parts.join(' · ');
}

/** Human description of an event for the timeline; undefined = not shown. */
export function describeEvent(e: StoredEvent['event'], nameOf: (id: string) => string): { text: string; tone: string } | undefined {
  switch (e.type) {
    case 'run.started':
      return { text: 'run started', tone: 'info' };
    case 'run.resumed':
      return { text: 'run resumed', tone: 'info' };
    case 'setup.result':
      return { text: `setup ${e.ok ? 'finished' : 'failed'}`, tone: e.ok ? 'done' : 'error' };
    case 'plan.question':
      return { text: `the team asks ${e.questions.length} question${e.questions.length === 1 ? '' : 's'}`, tone: 'wait' };
    case 'plan.answer':
      return { text: `${e.answers.length} answer${e.answers.length === 1 ? '' : 's'} recorded`, tone: 'info' };
    case 'plan.ready':
      return { text: 'the plan is ready for approval', tone: 'wait' };
    case 'plan.edit':
      return { text: `you gave assignment ${e.assignment + 1} to ${e.to} (was ${e.from})${e.mode === 'read' ? ', read only' : ''}`, tone: 'info' };
    case 'team.mode':
      return { text: `mode: ${e.mode}`, tone: 'info' };
    case 'team.error':
      return { text: e.message, tone: 'error' };
    case 'user.ask':
      return { text: `${nameOf(e.node)} asks: ${e.question.ask}`, tone: 'wait' };
    case 'user.answer':
      return { text: `answered ${e.question} (${e.answer.by})`, tone: 'info' };
    case 'node.started':
      return { text: `${nameOf(e.node)} started${e.attempt > 1 ? ` (attempt ${e.attempt})` : ''}`, tone: 'running' };
    case 'node.finished':
      return {
        text: `${nameOf(e.node)} ${e.status === 'done' && e.verdict !== 'FAIL' ? 'finished' : 'failed'}${e.verdict ? ` · VERDICT ${e.verdict}` : ''}${e.costUsd ? ` · ${fmtUsd(e.costUsd)}` : ''}`,
        tone: e.status === 'done' && e.verdict !== 'FAIL' ? 'done' : 'error',
      };
    case 'node.skipped':
      return { text: `${nameOf(e.node)} skipped — ${e.reason}`, tone: 'skipped' };
    case 'node.spawned':
      return { text: e.node.kind === 'approval' ? `${nameOf(e.parent)} asks for plan approval (${e.node.id})` : `${nameOf(e.parent)} hands ${e.node.id} to ${e.node.role ?? 'agent'}: ${e.node.spawn?.contract.goal ?? ''}`, tone: 'info' };
    case 'handoff':
      // a refused hand-off names the bot asked for (no step was spawned); otherwise `to` is the child step
      return e.answer.startsWith('refused: ')
        ? { text: `${nameOf(e.from)} → ${nameOf(e.to)}: ${e.goal} · ${e.answer}`, tone: 'wait' }
        : { text: `${nameOf(e.from)} → ${nameOf(e.to)}: ${e.goal} · ${nameOf(e.to)} answered`, tone: 'info' };
    case 'node.requeued':
      return { text: `${nameOf(e.node)} queued again — ${e.reason}`, tone: 'wait' };
    case 'node.limited':
      return { text: `${nameOf(e.node)} paused · out of free requests until ${clock(e.resetsAt)}`, tone: 'wait' };
    case 'manager.cost':
      return undefined;
    case 'node.metrics':
      return { text: `${nameOf(e.node)} · ${metricsLine(e)}`, tone: 'info' };
    case 'gate.result':
      return { text: `${nameOf(e.node)} gate ${e.ok ? 'passed' : `failed (exit ${e.exitCode})`}`, tone: e.ok ? 'done' : 'error' };
    case 'loop':
      return { text: `fix loop ${e.n}: ${nameOf(e.check)} → ${nameOf(e.fixNode)}`, tone: 'wait' };
    case 'approval.requested':
      return { text: `${nameOf(e.node)} waiting for approval`, tone: 'wait' };
    case 'approval.resolved':
      return { text: `${nameOf(e.node)} ${e.approved ? 'approved' : 'rejected'}${e.by ? ` by ${e.by}` : ''}`, tone: e.approved ? 'done' : 'error' };
    case 'node.amended':
      return { text: `${nameOf(e.node)} now runs on ${e.agent ?? '?'}${e.model ? ' · ' + e.model : ''}`, tone: 'wait' };
    case 'supervisor.action':
      return { text: `Tether ${e.action}: ${e.detail}`, tone: e.action === 'stop' ? 'error' : 'wait' };
    case 'run.coach':
      return { text: `coach: ${e.findings.length} finding(s)`, tone: 'wait' };
    case 'run.finished':
      return { text: `run ${e.status}${e.error ? ` — ${e.error.split('\n')[0]}` : ''}`, tone: e.status === 'done' ? 'done' : e.status === 'paused' ? 'wait' : 'error' };
    case 'http.attached':
      return { text: `API exchange #${e.historyId} attached`, tone: 'info' };
    default:
      return undefined;
  }
}
