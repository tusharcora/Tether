import { useEffect, useRef, useState } from 'react';
import { api, type RosterPreview } from '../api';

export const PREVIEW_DELAY_MS = 400;
export const PREVIEW_MIN = 8;
export const PREVIEW_MAX = 2000;

/**
 * "Maestro would pick": asked 400 ms after typing stops, for tasks of 8 to 2000 characters, with at most one request in
 * flight (newer text waits and only the latest is sent). Undefined hides the row: nothing to show yet, or any error.
 */
export function useRosterPreview(task: string, ws: string | undefined): RosterPreview | undefined {
  const [preview, setPreview] = useState<RosterPreview>();
  const inFlight = useRef(false);
  const queued = useRef<{ task: string; ws?: string } | null>(null);
  const latest = useRef({ task: task.trim(), ws });
  latest.current = { task: task.trim(), ws };
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const ask = useRef(async (q: { task: string; ws?: string }): Promise<void> => {
    if (inFlight.current) {
      queued.current = q;
      return;
    }
    inFlight.current = true;
    try {
      const r = await api<RosterPreview>('GET', `/api/roster/preview?task=${encodeURIComponent(q.task)}${q.ws ? `&ws=${encodeURIComponent(q.ws)}` : ''}`);
      // a reply for text that has changed since is dropped
      if (alive.current && latest.current.task === q.task && latest.current.ws === q.ws) setPreview(r);
    } catch {
      if (alive.current) setPreview(undefined);
    } finally {
      inFlight.current = false;
      const next = queued.current;
      queued.current = null;
      if (next) void ask.current(next);
    }
  });

  useEffect(() => {
    const t = task.trim();
    if (t.length < PREVIEW_MIN || t.length > PREVIEW_MAX) {
      setPreview(undefined);
      return;
    }
    const timer = setTimeout(() => void ask.current({ task: t, ws }), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [task, ws]);

  return preview;
}
