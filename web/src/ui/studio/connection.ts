import { useRef } from 'react';
import { BACKOFF_AFTER, type Poll } from '../../hooks';

export type Connection = 'connected' | 'reconnecting' | 'offline';
export const CONNECTION_LABEL: Record<Connection, string> = { connected: 'connected', reconnecting: 'reconnecting', offline: 'offline' };

/**
 * connected: the last health poll worked (one or two misses after having connected still count as connected);
 * reconnecting: three misses in a row after having connected (usePoll now backs off); offline: never connected.
 */
export function connectionOf(p: { ok: boolean; fails: number }, everConnected: boolean): Connection {
  if (p.ok) return 'connected';
  if (!everConnected) return 'offline';
  return p.fails >= BACKOFF_AFTER ? 'reconnecting' : 'connected';
}

export function useConnection(health: Poll<{ ok: boolean }>): Connection {
  const ok = !!health.data?.ok && !health.error;
  const ever = useRef(false);
  if (ok) ever.current = true;
  return connectionOf({ ok, fails: health.fails }, ever.current);
}
