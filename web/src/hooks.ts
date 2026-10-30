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

/**
 * Runs `tick` now and again every `ms`; after three failures in a row (`fails()`) it waits 15 s between tries.
 * Returns the stop function (an effect cleanup). Shared by usePoll and Home's activity feed.
 */
export function pollLoop(tick: () => Promise<void>, ms: number, fails: () => number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loop = async () => {
    await tick();
    if (!stopped) timer = setTimeout(loop, fails() >= BACKOFF_AFTER ? BACKOFF_MS : ms);
  };
  void loop();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
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

  useEffect(() => (path ? pollLoop(tick, ms, () => fails.current) : undefined), [path, ms, tick]);

  return { data, error, fails: failCount, refresh: tick };
}

/** While `on`, closing or reloading the page asks first (the browser's own prompt). */
export function useUnloadWarning(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [on]);
}

export type Screen = 'home' | 'inbox' | 'runs' | 'code' | 'builder' | 'crew' | 'goals' | 'api' | 'graph' | 'triggers' | 'artifacts' | 'chats' | 'teams' | 'attempts';
export type Tab = Screen | 'settings';
/** The screens with a `G` key and a "Go to" in ⌘K (Chats has its own sidebar section). */
export const SCREENS: Screen[] = ['home', 'inbox', 'runs', 'code', 'builder', 'crew', 'goals', 'api', 'graph', 'triggers', 'artifacts'];
const TAB_IDS: readonly string[] = [...SCREENS, 'chats', 'teams', 'attempts', 'settings'];
export const TAB_LABEL: Record<Tab, string> = { home: 'Home', inbox: 'Inbox', runs: 'Runs', code: 'Code', builder: 'Builder', crew: 'Crew', goals: 'Goals', api: 'API', graph: 'Graph', triggers: 'Triggers', artifacts: 'Artifacts', chats: 'Chats', teams: 'Teams', attempts: 'Compare attempts', settings: 'Settings' };

export interface Route {
  tab: Tab;
  /** Runs: the run id. Attempts: an attempt set (Compare). Builder: a saved workflow. Crew: a bot id. Graph: a note path. Code: a file path in the project. API: a saved request. Chats: a chat id, or `new`. Teams: a team id, or `new`. */
  id?: string;
  /** Code: the line to show (`#/code/<path>:<line>`). */
  line?: number;
  /** Runs: a step of the run, selected in the Inspector. */
  node?: string;
  /** Runs: open the run on this pane instead of the step pane (a failed run opens on its Timeline). */
  pane?: 'timeline';
}

export function parseHash(h: string): Route {
  const [path = '', query = ''] = h.replace(/^#\/?/, '').split('?');
  const [t, id, node] = path.split('/');
  if (!TAB_IDS.includes(t ?? '')) return { tab: 'home' };
  if (t === 'code') return codeRoute(path.slice('code'.length + 1));
  const r: Route = { tab: t as Tab };
  if (id) r.id = safeDecode(id);
  if (id && node && (r.tab === 'runs' || r.tab === 'chats')) r.node = safeDecode(node);
  if (id && r.tab === 'runs' && new URLSearchParams(query).get('pane') === 'timeline') r.pane = 'timeline';
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

/** `#/code/src/http/limit.ts:12`: the file path keeps its slashes (each segment encoded); a raw `:<n>` at the end is the line. */
function codeRoute(raw: string): Route {
  const m = /^(.*):(\d+)$/.exec(raw);
  const path = (m ? m[1]! : raw).split('/').filter(Boolean).map(safeDecode).join('/');
  return { tab: 'code', ...(path ? { id: path } : {}), ...(path && m ? { line: Number(m[2]) } : {}) };
}
const codeHash = (r: Route) => `#/code${r.id ? `/${r.id.split('/').map(encodeURIComponent).join('/')}${r.line ? `:${r.line}` : ''}` : ''}`;

export const hashFor = (r: Route): string =>
  r.tab === 'code' ? codeHash(r) : `#/${r.tab}${r.id ? `/${encodeURIComponent(r.id)}${r.node ? `/${encodeURIComponent(r.node)}` : ''}${r.tab === 'runs' && r.pane ? `?pane=${r.pane}` : ''}` : ''}`;

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
  /** A blocked Back/Forward is being undone by stepping back to this position; browser moves landing meanwhile are not the person's choice yet. */
  const restoring = useRef<number | null>(null);

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
      if (restoring.current !== null && !mine) {
        if (at !== restoring.current) {
          // Another move landed before the undo (a rapid second Back): aim at the entry again; never ask about it.
          if (at !== undefined) history.go(restoring.current - at);
          return;
        }
        restoring.current = null;
      }
      if (!mine && hashFor(next) !== hashFor(cur) && guard.current.block?.(next, cur)) {
        if (at === undefined || at === pos.current) history.replaceState(stamped(at ?? ++pos.current), '', hashFor(cur));
        else {
          restoring.current = pos.current;
          history.go(pos.current - at);
        }
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
    restoring.current = null;
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
