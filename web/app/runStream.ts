import { useEffect, useState } from 'react';
import { api, type RunView, type StoredEvent } from './api';

/** Union by seq, oldest first. */
export function mergeEvents(a: StoredEvent[], b: StoredEvent[]): StoredEvent[] {
  const bySeq = new Map<number, StoredEvent>();
  for (const e of a) bySeq.set(e.seq, e);
  for (const e of b) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((x, y) => x.seq - y.seq);
}

/** Follow one run: the event snapshot plus the live SSE stream (state snapshots and events, chunks skipped). */
export function useRunStream(id: string | undefined) {
  const [run, setRun] = useState<RunView>();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setRun(undefined);
    setEvents([]);
    setError(undefined);
    if (!id) return;
    let closed = false;
    api<StoredEvent[]>('GET', `/api/runs/${id}/events`)
      .then((snap) => !closed && setEvents((cur) => mergeEvents(snap, cur)))
      .catch((e) => !closed && setError((e as Error).message));
    const es = new EventSource(`/api/runs/${id}/stream`);
    es.addEventListener('state', (m) => {
      if (!closed) setRun(JSON.parse((m as MessageEvent).data));
    });
    es.addEventListener('event', (m) => {
      if (closed) return;
      const se = JSON.parse((m as MessageEvent).data) as StoredEvent;
      if (se.event.type === 'node.chunk') return;
      setEvents((cur) => mergeEvents(cur, [se]));
    });
    return () => {
      closed = true;
      es.close();
    };
  }, [id]);

  return { run, setRun, events, error };
}
