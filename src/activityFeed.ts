/**
 * Recent events across all runs as display lines for Home's Live activity. The feed may be on a shared screen, so a
 * line is built from a fixed template per event type and carries only ids, bot names, step titles, statuses, counts,
 * costs and durations: never task text, prompts, outputs, gate output, questions, goals or error messages.
 */
import { crewFor } from './bots.js';
import { runTitle } from './runLabels.js';
import { nodeTitle } from './runRows.js';
import type { FeedCursor, Store } from './store.js';
import type { ActivityKind, ActivityLine, RunEvent, RunState, StoredEvent } from './types.js';

/** The only event types the feed shows; every other type (node.chunk above all) is never read. */
export const ACTIVITY_TYPES: readonly RunEvent['type'][] = [
  'run.started', 'run.resumed', 'node.started', 'node.finished', 'node.skipped', 'gate.result', 'approval.requested', 'approval.resolved',
  'plan.question', 'plan.ready', 'user.ask', 'user.answer', 'handoff', 'consult', 'run.finished',
];
export const ACTIVITY_LIMIT = 30;
export const ACTIVITY_MAX = 100;
/**
 * Events younger than this are held back (neither returned nor moving the cursor). An event's ts is taken before its
 * commit, and another process can commit one stamped with the same or an earlier ms after a poll has read past it;
 * waiting until every event at or before the watermark is committed means a cursor never skips one.
 */
export const SETTLE_MS = 2000;

export function parseCursor(s: string): FeedCursor | undefined {
  const m = /^(\d+):(.+):(\d+)$/.exec(s);
  return m ? { ts: Number(m[1]), runId: m[2]!, seq: Number(m[3]) } : undefined;
}
export const cursorOf = (c: FeedCursor): string => `${c.ts}:${c.runId}:${c.seq}`;

const usd = (n: number) => `$${n.toFixed(2)}`;
const dur = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

export interface Names {
  /** The run's label: its pipeline name, or "Team run". */
  label: string;
  node: (id: string) => { name: string; bot?: string };
}

/** Step and bot names from the run's pipeline nodes (title ?? role ?? id), looked up once per run. */
export function namesFor(s: RunState | undefined): Names {
  const byId = new Map((s?.pipeline.nodes ?? []).map((n) => [n.id, n] as const));
  return {
    label: s ? runTitle({ kind: s.kind, pipeline: s.pipeline.name }) : 'run',
    node: (id) => {
      const n = byId.get(id);
      return n ? { name: nodeTitle(n), bot: crewFor(n) } : { name: id };
    },
  };
}

/** The display line for one event, or undefined for a type outside `ACTIVITY_TYPES`. */
export function activityLine(e: StoredEvent, names: Names): ActivityLine | undefined {
  const ev = e.event;
  const line = (who: string, text: string, kind: ActivityKind, bot?: string): ActivityLine => ({ id: `${e.runId}:${e.seq}`, ts: e.ts, runId: e.runId, who, text, kind, ...(bot ? { bot } : {}) });
  const step = (id: string, text: string, kind: ActivityKind) => {
    const n = names.node(id);
    return line(n.name, `${n.name} ${text}`, kind, n.bot);
  };
  switch (ev.type) {
    case 'run.started':
      return line(names.label, 'run started', 'working');
    case 'run.resumed':
      return line(names.label, 'run resumed', 'working');
    case 'node.started':
      return step(ev.node, `started${ev.attempt > 1 ? ` (attempt ${ev.attempt})` : ''}`, 'working');
    case 'node.finished': {
      const ok = ev.status === 'done' && ev.verdict !== 'FAIL';
      const text = `${ok ? 'finished' : 'failed'}${ev.verdict ? ` · VERDICT ${ev.verdict}` : ''}${ev.costUsd ? ` · ${usd(ev.costUsd)}` : ''}${ev.durationMs ? ` · ${dur(ev.durationMs)}` : ''}`;
      return step(ev.node, text, ok ? 'done' : 'failed');
    }
    case 'node.skipped':
      return step(ev.node, 'skipped', 'info');
    case 'gate.result':
      return step(ev.node, ev.ok ? 'passed' : `failed (exit ${ev.exitCode ?? '?'})`, ev.ok ? 'done' : 'failed');
    case 'approval.requested':
      return step(ev.node, 'waits for approval', 'needs');
    case 'approval.resolved':
      return step(ev.node, ev.approved ? 'approved' : 'rejected', ev.approved ? 'done' : 'failed');
    case 'plan.question':
      return line('Maestro', `the team asks ${ev.questions.length} question${ev.questions.length === 1 ? '' : 's'}`, 'needs', 'orchestrator');
    case 'plan.ready':
      return line('Maestro', 'plan ready for approval', 'needs', 'orchestrator');
    case 'user.ask':
      return step(ev.node, 'has a question', 'needs');
    case 'user.answer':
      return line('You', 'question answered', 'info');
    case 'handoff':
    case 'consult': {
      const a = names.node(ev.from);
      return line(a.name, `${a.name} → ${names.node(ev.to).name}`, 'info', a.bot);
    }
    case 'run.finished': {
      const word = ev.status === 'error' ? 'failed' : ev.status;
      return line(names.label, `run ${word}${ev.budget ? ' · budget reached' : ''}`, ev.status === 'done' ? 'done' : ev.status === 'error' ? 'failed' : 'info');
    }
    default:
      return undefined;
  }
}

/**
 * Lines newest first, with the cursor of the newest event read (or the given one echoed when nothing is new). Without
 * `since`: the newest `limit`. With it: the `limit` oldest after it, so a gap longer than `limit` fills over polls.
 * Probe runs are left out; events younger than `SETTLE_MS` are held back.
 */
export function activityFeed(store: Store, o: { since?: FeedCursor; limit: number; now?: number }): { lines: ActivityLine[]; cursor: string | null } {
  const until = (o.now ?? Date.now()) - SETTLE_MS;
  const events = store.feed({ types: ACTIVITY_TYPES, after: o.since, exclude: store.runIds({ probes: true }), until, limit: o.limit });
  const names = new Map<string, Names>();
  const lines: ActivityLine[] = [];
  for (const e of events) {
    let n = names.get(e.runId);
    if (!n) names.set(e.runId, (n = namesFor(store.state(e.runId))));
    const l = activityLine(e, n);
    if (l) lines.push(l);
  }
  // after a cursor the query pages forward (oldest first); the response is always newest first
  const newest = o.since ? events.at(-1) : events[0];
  if (o.since) lines.reverse();
  const cursor = newest ? cursorOf(newest) : o.since ? cursorOf(o.since) : null;
  return { lines, cursor };
}
