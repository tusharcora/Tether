import { useCallback, useEffect, useState } from 'react';
import type { Assignee, CheckResult, GoalCheck, GoalStatus, GoalType, GoalView } from '../../../src/goals/types.js';
import { api, fmtUsd } from '../api';
import type { RunState } from '../ui/studio/RunGlyph';

export type { Assignee, CheckResult, GoalCheck, GoalStatus, GoalType, GoalView };

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
