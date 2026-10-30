/**
 * What needs the person (Home's "Needs you"), computed from run states and a few event types. Read-only.
 * No free text beyond a question's `ask` (which the spec allows): never prompts, outputs, secrets or error messages.
 */
import { isFinished, planConflict, runMeta } from './runLabels.js';
import { nodeTitle } from './runRows.js';
import type { RunSummary, Store } from './store.js';
import { planWaiting, type AttentionAction, type AttentionItem, type AttentionKind, type RunEvent, type RunState, type StoredEvent } from './types.js';

export const FAILED_WINDOW_MS = 24 * 60 * 60_000;
/** A running run nothing has driven for this long is no longer offered (it leaves Needs you). */
export const STALE_MS = 7 * 24 * 60 * 60_000;
const ASK_MAX = 120;

/** The only event types attention reads: the triggers whose timestamps (or ids) the items need. */
export const ATTENTION_TYPES: readonly RunEvent['type'][] = ['plan.ready', 'plan.question', 'user.ask', 'approval.requested', 'node.limited', 'team.error', 'run.resumed'];

export interface AttentionRun {
  state: RunState;
  /** The run's events, oldest first; at least those of `ATTENTION_TYPES` (others are ignored). */
  events: StoredEvent[];
  /** As every screen computes it (`rowLive`): driven by this server, a team run waiting on the person, or recent activity. */
  live: boolean;
  lastTs: number;
}

/**
 * Could this run have an item? A cheap filter on a run-list row, so the reader skips the rest. `live` and `lastTs`
 * (when given) age out a running run that no process has driven for `STALE_MS`.
 */
export function mayNeedAttention(r: { status: RunState['status']; finishedAt?: number; probe?: true; live?: boolean; lastTs?: number }, now = Date.now()): boolean {
  if (r.probe) return false;
  if (r.status === 'running') return !(r.live === false && r.lastTs !== undefined && now - r.lastTs > STALE_MS);
  if (r.status === 'paused') return true;
  return r.status === 'error' && !!r.finishedAt && now - r.finishedAt <= FAILED_WINDOW_MS;
}

export function attentionFor(r: AttentionRun, now = Date.now()): AttentionItem[] {
  const s = r.state;
  if (s.probe || !mayNeedAttention({ status: s.status, finishedAt: s.finishedAt }, now)) return []; // the 7-day age-out is the reader's (it needs no event read to decide)
  const out: AttentionItem[] = [];
  const meta = runMeta({ kind: s.kind, pipeline: s.pipeline.name, id: s.id, branch: s.branch });
  const add = (kind: AttentionKind, ts: number, title: string, actions: AttentionAction[], key?: string, node?: string) =>
    out.push({ id: `${s.id}:${kind}${key ? `:${key}` : ''}`, ts, runId: s.id, kind, title, meta, actions, ...(node ? { node } : {}) });
  const last = (pred: (e: RunEvent) => boolean): StoredEvent | undefined => {
    for (let i = r.events.length - 1; i >= 0; i--) if (pred(r.events[i]!.event)) return r.events[i];
    return undefined;
  };
  const active = !isFinished(s.status);

  if (active && planWaiting(s)) {
    const ts = last((e) => e.type === 'plan.ready')?.ts ?? r.lastTs;
    // a plan that cannot do its task says why before it runs, with the fix (spec 2026-10-30 §3.5)
    const why = planConflict(s.plan!, s.task);
    if (why) add('plan_conflict', ts, `Check the plan: ${why}`, ['allow_edits', 'review']);
    else add('plan_ready', ts, 'Plan ready for approval', ['review']);
  }

  if (active) {
    for (const q of s.pending) {
      const asker = s.userAsks?.find((a) => a.question.id === q.id && !a.answer)?.node;
      const ev = last((e) => (e.type === 'plan.question' && e.questions.some((x) => x.id === q.id)) || (e.type === 'user.ask' && e.question.id === q.id));
      add('question', ev?.ts ?? r.lastTs, q.ask.slice(0, ASK_MAX), ['answer'], q.id, asker);
    }
    for (const n of s.pipeline.nodes) {
      if (n.kind !== 'approval' || s.nodes[n.id]?.status !== 'awaiting') continue;
      const ev = last((e) => e.type === 'approval.requested' && e.node === n.id);
      add('approval', ev?.ts ?? r.lastTs, `${nodeTitle(n)} waits for approval`, ['approve', 'open'], n.id, n.id);
    }
    for (const [id, ns] of Object.entries(s.nodes)) {
      if (ns.status !== 'awaiting' || !ns.limit) continue;
      const ev = last((e) => e.type === 'node.limited' && e.node === id);
      add('free_limit', ev?.ts ?? r.lastTs, 'Out of free requests for today', ['open'], id, id);
    }
  }

  let planningError = false;
  if (s.kind === 'team' && s.status === 'running' && !r.live) {
    const err = last((e) => e.type === 'team.error');
    const resumed = last((e) => e.type === 'run.resumed');
    if (err && (!resumed || err.seq > resumed.seq)) {
      planningError = true;
      add('planning_error', err.ts, 'Planning failed', ['retry', 'open']);
    }
  }
  if (s.status === 'paused' && !out.some((i) => i.kind === 'approval' || i.kind === 'question' || i.kind === 'free_limit')) add('paused', r.lastTs, 'Paused', ['open']);
  if (s.status === 'running' && !r.live && !planningError) add('interrupted', r.lastTs, 'Interrupted: no process is driving it', ['resume', 'open']);
  if (s.status === 'error' && s.autofix?.needsWrites) add('autofix_writes', s.finishedAt ?? r.lastTs, `Allow edits and retry? Auto-fix found ${s.autofix.needsWrites}`.slice(0, ASK_MAX + 40), ['allow_edits', 'open']);
  // while auto-fix works on it the run is live, not failed
  else if (s.status === 'error' && s.finishedAt && !r.live) add('failed', s.finishedAt, failedTitle(s), ['retry', 'open']);
  return out;
}

/** "Failed", or why auto-fix stopped trying: "Auto-fix gave up after 3 rounds: <why>". */
function failedTitle(s: RunState): string {
  const a = s.autofix;
  if (!a?.gaveUp) return 'Failed';
  const why = a.gaveUp.slice(0, ASK_MAX);
  return a.round ? `Auto-fix gave up after ${a.round} round${a.round === 1 ? '' : 's'}: ${why}` : `Auto-fix could not help: ${why}`;
}

/** Every run's items, newest first (ties by id, so the order is stable across polls). */
export function attentionItems(runs: AttentionRun[], now = Date.now()): AttentionItem[] {
  return runs.flatMap((r) => attentionFor(r, now)).sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id));
}

/**
 * Attention over the store, for a poll every 2 s. Run states come from the store's fold cache (`listRows`); each
 * candidate run's `ATTENTION_TYPES` events are cached by the newest seq read, so a poll reads only the events appended
 * since the last one, and nothing for a run that did not change. Runs that stop being candidates leave the cache.
 */
export function attentionReader(store: Pick<Store, 'listRows' | 'eventsOfTypes'>) {
  const cache = new Map<string, { seq: number; startedAt: number; events: StoredEvent[] }>();
  return {
    items(live: (r: RunSummary, lastTs: number) => boolean, now = Date.now()): AttentionItem[] {
      const runs: AttentionRun[] = [];
      const seen = new Set<string>();
      for (const { summary, state, lastTs, seq } of store.listRows()) {
        const isLive = live(summary, lastTs);
        if (!mayNeedAttention({ ...summary, live: isLive, lastTs }, now)) continue;
        seen.add(summary.id);
        let hit = cache.get(summary.id);
        // deleted and started again under the same id: start over
        if (!hit || hit.seq > seq || hit.startedAt !== state.startedAt) hit = { seq: 0, startedAt: state.startedAt, events: [] };
        if (hit.seq < seq) {
          const fresh = store.eventsOfTypes(summary.id, ATTENTION_TYPES, hit.seq);
          // the read may see events appended after listRows: remember the newest seq actually read
          hit = { seq: Math.max(seq, fresh.at(-1)?.seq ?? 0), startedAt: hit.startedAt, events: [...hit.events, ...fresh] };
        }
        cache.set(summary.id, hit);
        runs.push({ state, events: hit.events, live: isLive, lastTs });
      }
      for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
      return attentionItems(runs, now);
    },
  };
}
