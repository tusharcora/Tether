import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export const BACKOFF_MS = 15_000;
export const BACKOFF_AFTER = 3;

export interface Poll<T> {
  data: T | undefined;
  error: string | undefined;
  /** Failures in a row (0 after a success). */
  fails: number;
  refresh: () => Promise<void>;
}

/** GET `path` now and every `ms`. Keeps the last good value; after three failures in a row waits 15 s between tries. `null` pauses. */
export function usePoll<T>(path: string | null, ms: number): Poll<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const fails = useRef(0);
  const [failCount, setFailCount] = useState(0);
  const current = useRef(path);
  current.current = path;

  const tick = useCallback(async () => {
    const p = current.current;
    if (!p) return;
    try {
      const d = await api<T>('GET', p);
      if (current.current !== p) return;
      fails.current = 0;
      setFailCount(0);
      setError(undefined);
      setData(d);
    } catch (e) {
      if (current.current !== p) return;
      fails.current++;
      setFailCount(fails.current);
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

  return { data, error, fails: failCount, refresh: tick };
}

export type Screen = 'home' | 'runs' | 'builder' | 'crew' | 'api' | 'graph' | 'triggers';
export type Tab = Screen | 'settings';
export const SCREENS: Screen[] = ['home', 'runs', 'builder', 'crew', 'api', 'graph', 'triggers'];
const TAB_IDS: readonly string[] = [...SCREENS, 'settings'];
export const TAB_LABEL: Record<Tab, string> = { home: 'Home', runs: 'Runs', builder: 'Builder', crew: 'Crew', api: 'API', graph: 'Graph', triggers: 'Triggers', settings: 'Settings' };

export interface Route {
  tab: Tab;
  /** Runs: the run id. Builder: a saved workflow. Crew: a bot id. Graph: a note path. */
  id?: string;
  /** Runs: a step of the run, selected in the Inspector. */
  node?: string;
}

export function parseHash(h: string): Route {
  const [t, id, node] = h.replace(/^#\/?/, '').split('/');
  if (!TAB_IDS.includes(t ?? '')) return { tab: 'home' };
  const r: Route = { tab: t as Tab };
  if (id) r.id = safeDecode(id);
  if (id && node && r.tab === 'runs') r.node = safeDecode(node);
  return r;
}

/** A hand-typed or truncated link may hold a malformed escape (`%E0`): keep the raw id instead of throwing. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const hashFor = (r: Route): string =>
  `#/${r.tab}${r.id ? `/${encodeURIComponent(r.id)}${r.node ? `/${encodeURIComponent(r.node)}` : ''}` : ''}`;

/** Each history entry the app reaches is stamped with its position, so a blocked Back/Forward can step back to it. */
const POS = 'aorchPos';
const posOf = (s: unknown): number | undefined => {
  const v = s && typeof s === 'object' ? (s as Record<string, unknown>)[POS] : undefined;
  return typeof v === 'number' ? v : undefined;
};
const stamped = (pos: number) => ({ ...(history.state && typeof history.state === 'object' ? history.state : {}), [POS]: pos });

/**
 * The route in the URL hash. `block` is asked about every hash change the person makes outside the app (Back, Forward,
 * a typed hash): when it says yes the previous route is put back and `onBlocked` gets the destination. Back/Forward is
 * undone by stepping through history again, so no entry is overwritten; a typed hash has its own new entry set back to
 * the previous hash. Changes made with the returned `go` are never blocked (the caller has already decided).
 */
export function useHashRoute(block?: (next: Route, current: Route) => boolean, onBlocked?: (next: Route) => void): [Route, (r: Route) => void] {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  const current = useRef(route);
  current.current = route;
  const guard = useRef({ block, onBlocked });
  guard.current = { block, onBlocked };
  /** The hash `go` just set: its hashchange is ours, not the person's. Spent by the next hashchange, whatever it is. */
  const expected = useRef<string | null>(null);
  /** The position of the history entry showing `current`. */
  const pos = useRef(0);

  useEffect(() => {
    const at = posOf(history.state);
    if (at === undefined) history.replaceState(stamped(pos.current), '');
    else pos.current = at;

    const on = () => {
      const next = parseHash(location.hash);
      const mine = expected.current === location.hash;
      expected.current = null;
      const at = posOf(history.state);
      const cur = current.current;
      if (!mine && hashFor(next) !== hashFor(cur) && guard.current.block?.(next, cur)) {
        if (at === undefined || at === pos.current) history.replaceState(stamped(at ?? ++pos.current), '', hashFor(cur));
        else history.go(pos.current - at);
        guard.current.onBlocked?.(next);
        return;
      }
      if (at === undefined) history.replaceState(stamped(++pos.current), '');
      else pos.current = at;
      current.current = next;
      setRoute(next);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = useCallback((r: Route) => {
    const h = hashFor(r);
    if (location.hash !== h) {
      expected.current = h;
      location.hash = h;
      history.replaceState(stamped(++pos.current), '');
    }
    current.current = r;
    setRoute(r);
  }, []);
  return [route, go];
}
