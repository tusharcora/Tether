import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProcMessage, type RunView, type StoredEvent } from './api';

/** Union by seq, oldest first. */
export function mergeEvents(a: StoredEvent[], b: StoredEvent[]): StoredEvent[] {
  const bySeq = new Map<number, StoredEvent>();
  for (const e of a) bySeq.set(e.seq, e);
  for (const e of b) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((x, y) => x.seq - y.seq);
}

/** Follow one run: the event snapshot plus the live SSE stream (state snapshots and events, chunks skipped). */
export function useRunStream(id: string | undefined) {
  const [run, setRunState] = useState<RunView>();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [error, setError] = useState<string>();
  // bumped by retry(): re-reads the snapshot and re-subscribes, keeping what is already shown
  const [attempt, setAttempt] = useState(0);
  const shown = useRef<string | undefined>(undefined);
  /** The Terminal's listeners: its output rides the same stream as `proc` messages. */
  const procs = useRef(new Set<(m: ProcMessage) => void>());
  const followed = useRef(id);
  followed.current = id;
  /** Adopt a view (e.g. an action's reply) only while its run is still the one followed. */
  const setRun = useCallback((r: RunView) => {
    if (r.id === followed.current) setRunState(r);
  }, []);

  useEffect(() => {
    if (shown.current !== id) {
      shown.current = id;
      setRunState(undefined);
      setEvents([]);
    }
    setError(undefined);
    if (!id) return;
    let closed = false;
    api<StoredEvent[]>('GET', `/api/runs/${id}/events`)
      .then((snap) => !closed && setEvents((cur) => mergeEvents(snap, cur)))
      .catch((e) => !closed && setError((e as Error).message));
    const es = new EventSource(`/api/runs/${id}/stream`);
    es.addEventListener('state', (m) => {
      if (!closed) setRunState(JSON.parse((m as MessageEvent).data));
    });
    es.addEventListener('event', (m) => {
      if (closed) return;
      const se = JSON.parse((m as MessageEvent).data) as StoredEvent;
      if (se.event.type === 'node.chunk') return;
      setEvents((cur) => mergeEvents(cur, [se]));
    });
    es.addEventListener('proc', (m) => {
      if (closed) return;
      const msg = JSON.parse((m as MessageEvent).data) as ProcMessage;
      for (const fn of procs.current) fn(msg);
    });
    return () => {
      closed = true;
      es.close();
    };
  }, [id, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  /** Follow the Terminal's output; returns the unsubscribe. */
  const onProc = useCallback((fn: (m: ProcMessage) => void) => (procs.current.add(fn), () => void procs.current.delete(fn)), []);

  return { run, setRun, events, error, retry, onProc };
}
