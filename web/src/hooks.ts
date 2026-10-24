import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export const BACKOFF_MS = 15_000;
export const BACKOFF_AFTER = 3;

export interface Poll<T> {
  data: T | undefined;
  error: string | undefined;
  refresh: () => Promise<void>;
}

/** GET `path` now and every `ms`. Keeps the last good value; after three failures in a row waits 15 s between tries. `null` pauses. */
export function usePoll<T>(path: string | null, ms: number): Poll<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const fails = useRef(0);
  const current = useRef(path);
  current.current = path;

  const tick = useCallback(async () => {
    const p = current.current;
    if (!p) return;
    try {
      const d = await api<T>('GET', p);
      if (current.current !== p) return;
      fails.current = 0;
      setError(undefined);
      setData(d);
    } catch (e) {
      if (current.current !== p) return;
      fails.current++;
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await tick();
      if (!stopped) timer = setTimeout(loop, fails.current >= BACKOFF_AFTER ? BACKOFF_MS : ms);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [path, ms, tick]);

  return { data, error, refresh: tick };
}

export type Tab = 'builder' | 'runs' | 'graph' | 'crew' | 'triggers';
export const TABS: Tab[] = ['builder', 'runs', 'graph', 'crew', 'triggers'];
export const TAB_LABEL: Record<Tab, string> = { builder: 'Builder', runs: 'Runs', graph: 'Graph', crew: 'Crew', triggers: 'Triggers' };

export interface Route {
  tab: Tab;
  /** Runs: the run id. Builder: a saved workflow name to open. */
  id?: string;
}

export function parseHash(h: string): Route {
  const [t, id] = h.replace(/^#\/?/, '').split('/');
  const tab = (TABS as string[]).includes(t ?? '') ? (t as Tab) : 'builder';
  return id ? { tab, id: safeDecode(id) } : { tab };
}

/** A hand-typed or truncated link may hold a malformed escape (`%E0`): keep the raw id instead of throwing. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const hashFor = (r: Route): string => (r.id ? `#/${r.tab}/${encodeURIComponent(r.id)}` : `#/${r.tab}`);

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: Route) => {
    location.hash = hashFor(r);
    setRoute(r);
  }, []);
  return [route, go];
}
