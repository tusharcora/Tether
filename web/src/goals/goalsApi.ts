import { useCallback, useEffect, useState } from 'react';
import type { CheckResult, GoalCheck, GoalStatus, GoalView } from '../../../src/goals/types.js';
import { api, fmtUsd } from '../api';
import { shortRunId, type RunState } from '../ui/studio/RunGlyph';

export type { CheckResult, GoalCheck, GoalStatus, GoalView };

const upsert = (list: GoalView[], g: GoalView): GoalView[] => (list.some((x) => x.id === g.id) ? list.map((x) => (x.id === g.id ? g : x)) : [g, ...list]);

/**
 * The goals, live: one read, then the server's stream (the whole list on connect, then each goal that changes; the browser
 * reconnects by itself and gets the list again). `set` takes a goal an action just returned, so the screen never waits for the stream.
 */
export function useGoals() {
  const [goals, setGoals] = useState<GoalView[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let closed = false;
    api<GoalView[]>('GET', '/api/goals').then((l) => !closed && setGoals((cur) => cur ?? l), (e) => !closed && setError((e as Error).message));
    if (typeof EventSource === 'undefined') return () => void (closed = true);
    const es = new EventSource('/api/goals/stream');
    es.addEventListener('goals', (m) => !closed && setGoals(JSON.parse((m as MessageEvent).data)));
    es.addEventListener('goal', (m) => !closed && setGoals((cur) => upsert(cur ?? [], JSON.parse((m as MessageEvent).data))));
    return () => {
      closed = true;
      es.close();
    };
  }, []);
  const set = useCallback((g: GoalView) => setGoals((cur) => upsert(cur ?? [], g)), []);
  const drop = useCallback((id: string) => setGoals((cur) => cur?.filter((x) => x.id !== id)), []);
  return { goals, error, set, drop };
}

export const goalsApi = {
  create: (body: Record<string, unknown>) => api<GoalView>('POST', '/api/goals', body),
  patch: (id: string, body: Record<string, unknown>) => api<GoalView>('PATCH', `/api/goals/${id}`, body),
  remove: (id: string) => api('DELETE', `/api/goals/${id}`),
  check: (id: string) => api<GoalView>('POST', `/api/goals/${id}/check`, {}),
  next: (id: string, action: 'start' | 'skip', plan?: string) => api<GoalView>('POST', `/api/goals/${id}/next`, { action, ...(plan ? { plan } : {}) }),
  addItem: (id: string, text: string) => api('POST', `/api/goals/${id}/items`, { text }),
  toggleItem: (id: string, item: number, done: boolean) => api('PATCH', `/api/goals/${id}/items/${item}`, { done }),
};

export const STATUS_LABEL: Record<GoalStatus, string> = { active: 'Working', needs_you: 'Needs you', paused: 'Paused', met: 'Met', stopped: 'Stopped' };

/** A goal's glyph is a run's: blue working, amber needs you, green met, red stopped, grey paused (or a tracker with nothing live). */
export const glyphOf = (g: Pick<GoalView, 'status' | 'kind'>): RunState => (g.status === 'active' ? (g.kind === 'loop' ? 'running' : 'idle') : g.status === 'needs_you' ? 'needs' : g.status === 'met' ? 'done' : g.status === 'stopped' ? 'failed' : 'idle');

/** Active or waiting: not met and not stopped. */
export const isOpen = (g: Pick<GoalView, 'status'>) => g.status !== 'met' && g.status !== 'stopped';

/** The line under a goal's title in the list. */
export function goalMeta(g: GoalView): string {
  const runs = g.items.filter((i) => i.kind === 'run').length;
  if (g.kind === 'tracker') {
    const done = g.items.filter((i) => i.done || i.runStatus === 'done').length;
    return `${done} of ${g.items.length} done${g.dueDate ? ` · due ${g.dueDate}` : ''}`;
  }
  const check = g.lastCheck ? (g.lastCheck.summary ?? (g.lastCheck.ok ? 'Check passes' : g.lastCheck.value !== undefined ? `Check at ${g.lastCheck.value}` : 'Check failing')) : 'Not checked yet';
  if (g.status === 'met') return `${check} · ${fmtUsd(g.spentUsd)} · ${runs} ${runs === 1 ? 'run' : 'runs'}`;
  if (g.status === 'stopped') return `${g.reason ?? 'Stopped'} · ${runs} ${runs === 1 ? 'run' : 'runs'}`;
  const state = g.status === 'needs_you' ? `run ${runs + 1} awaiting approval` : g.status === 'paused' ? 'paused' : `${runs} of ${g.maxRuns} runs`;
  return `${check} · ${state} · ${fmtUsd(g.spentUsd)} of ${fmtUsd(g.budgetUsd)}`;
}

/** The muted line under a goal in the list: its kind and how far it has come. */
export function goalLine(g: GoalView): string {
  if (g.kind === 'tracker') return `tracker · ${g.items.filter((i) => i.done || i.runStatus === 'done').length} of ${g.items.length} done`;
  return `loop · ${g.items.filter((i) => i.kind === 'run').length} of ${g.maxRuns} runs`;
}

/** The goals of one project (every goal when none is open). */
export const inProject = <T extends { workspace: string }>(goals: T[] | undefined, ws: string | undefined): T[] => (goals ?? []).filter((g) => !ws || g.workspace === ws);

const OUT_OF = 10;
const share = (n: number, of: number) => (of > 0 ? Math.min(1, Math.max(0, n / of)) : 0);

/**
 * A goal's score out of 10 from what it really has: a loop's last check (its passing share when the output counts tests),
 * the budget and runs it has left; a tracker's items done. Equal weights: nothing says one matters more than another.
 */
export function goalScore(g: GoalView) {
  const runs = g.items.filter((i) => i.kind === 'run').length;
  const done = g.items.filter((i) => i.done || i.runStatus === 'done').length;
  const c = g.lastCheck;
  const counted = c?.passing !== undefined && c.failing !== undefined && c.passing + c.failing > 0;
  const check = !c ? 0 : counted ? share(c.passing!, c.passing! + c.failing!) : c.ok ? 1 : 0;
  const criteria =
    g.kind === 'tracker'
      ? [{ label: 'Items done', score: share(done, g.items.length) * OUT_OF, weight: 1, note: `${done} of ${g.items.length}` }]
      : [
          { label: 'Finish check', score: check * OUT_OF, weight: 1, note: c ? (c.summary ?? (c.ok ? 'passing' : 'failing')) : 'not checked yet' },
          { label: 'Budget left', score: (1 - share(g.spentUsd, g.budgetUsd)) * OUT_OF, weight: 1, note: `${fmtUsd(g.spentUsd)} of ${fmtUsd(g.budgetUsd)} spent` },
          { label: 'Runs left', score: (1 - share(runs, g.maxRuns)) * OUT_OF, weight: 1, note: `${runs} of ${g.maxRuns} runs` },
        ];
  const total = criteria.reduce((a, x) => a + x.score * x.weight, 0) / criteria.reduce((a, x) => a + x.weight, 0);
  return { verdict: g.kind === 'tracker' && g.status === 'active' ? 'Open' : STATUS_LABEL[g.status], total, outOf: OUT_OF, criteria };
}

const when = (at: number) => {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** A loop's history: created, each run and the check after it, a later check, then the next run it proposes. A run still going is now. */
export function goalEvents(g: GoalView): { id: string; when: 'past' | 'now' | 'future'; time: string; title: string; detail?: string }[] {
  const checked = (r: CheckResult) => ({ title: r.ok ? 'Check passed' : 'Check failed', ...(r.summary ? { detail: r.summary } : {}) });
  const ev: { id: string; at: number; when: 'past' | 'now'; title: string; detail?: string }[] = [{ id: 'created', at: g.createdAt, when: 'past', title: 'Goal created', ...(g.check ? { detail: `check: ${g.check.command}` } : {}) }];
  for (const i of g.items.filter((x) => x.kind === 'run')) {
    const going = !i.attempt?.after && isOpen(g);
    ev.push({ id: `r${i.id}`, at: i.at, when: going ? 'now' : 'past', title: `Run ${i.runId ? shortRunId(i.runId) : ''}${going ? ' working' : ''}`.trim(), detail: i.text.split('\n')[0] });
    if (i.attempt?.after) ev.push({ id: `c${i.id}`, at: i.attempt.after.at, when: 'past', ...checked(i.attempt.after) });
  }
  if (g.lastCheck && !ev.some((e) => e.at === g.lastCheck!.at)) ev.push({ id: 'check', at: g.lastCheck.at, when: 'past', ...checked(g.lastCheck) });
  const out = ev.sort((a, b) => a.at - b.at).map(({ at, ...e }) => ({ ...e, time: when(at) }));
  return g.pending && isOpen(g) ? [...out, { id: 'next', when: 'future', time: '', title: g.status === 'needs_you' ? 'Next run, waiting for you' : 'Next run', detail: g.pending.task.split('\n')[0] }] : out;
}
