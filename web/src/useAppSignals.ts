import { useEffect, useRef, useState } from 'react';
import type { AttentionItem, RunRow } from './api';
import { bridge } from './bridge';
import { isFinished } from './home/runText';

const NOTIFY_KEY = 'aorch.notify';

/** Whether Tether.app shows notifications (on unless switched off in Settings), remembered on this device. */
export function useNotifyPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(NOTIFY_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(NOTIFY_KEY, v ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
  };
  return [on, set];
}

const FINISHED_TITLE: Record<string, string> = { done: 'Run finished', error: 'Run failed', stopped: 'Run stopped' };
const firstLine = (s: string) => s.split('\n')[0]!.slice(0, 120);

/**
 * Tether.app's Dock badge (what needs you) and notifications: one when something new needs you, one when a run seen
 * running has finished. The first poll only sets the baseline, so opening the app never replays old news.
 */
export function useAppSignals(runs: RunRow[] | undefined, attention: AttentionItem[] | undefined, notify: boolean): void {
  const seen = useRef<{ needs: Set<string>; running: Set<string> }>(undefined);
  const needs = attention?.length ?? 0;
  useEffect(() => bridge()?.setBadge(needs), [needs]);
  useEffect(() => {
    const b = bridge();
    if (!b || !runs || !attention) return;
    const before = seen.current;
    seen.current = { needs: new Set(attention.map((a) => a.id)), running: new Set(runs.filter((r) => !isFinished(r.status)).map((r) => r.id)) };
    if (!before || !notify) return;
    for (const a of attention) if (!before.needs.has(a.id)) b.notify({ title: 'Needs you', body: firstLine(a.title), route: `#/runs/${encodeURIComponent(a.runId)}` });
    for (const r of runs) if (before.running.has(r.id) && isFinished(r.status)) b.notify({ title: FINISHED_TITLE[r.status] ?? 'Run ended', body: firstLine(r.task), route: `#/runs/${encodeURIComponent(r.id)}` });
  }, [runs, attention, notify]);
}
