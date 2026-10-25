import { useEffect, useState } from 'react';
import { api, type VaultActivityItem } from '../api';

export const VAULT_POLL_MS = 5000;
/** How long a note a run just wrote keeps pinging (its "live" window). */
export const PING_MS = 12_000;

export interface VaultActivity {
  /** The newest write per note path that this screen knows of. */
  last: ReadonlyMap<string, VaultActivityItem>;
  /** Paths written since the screen opened, for PING_MS each. */
  fresh: ReadonlySet<string>;
  /** The newest write since the screen opened. */
  latest?: VaultActivityItem;
}

type Reply = { items: VaultActivityItem[]; cursor: string | null };

/** Notes runs wrote, polled from GET /api/vault/activity. A decorative signal: errors hide it quietly. */
export function useVaultActivity(): VaultActivity {
  const [last, setLast] = useState<ReadonlyMap<string, VaultActivityItem>>(new Map());
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [latest, setLatest] = useState<VaultActivityItem>();

  useEffect(() => {
    let stopped = false;
    let primed = false;
    let cursor: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiries: ReturnType<typeof setTimeout>[] = [];

    const record = (items: VaultActivityItem[], isNew: boolean) => {
      if (!items.length) return;
      // items come newest first: apply oldest to newest so the newest write wins
      setLast((cur) => {
        const next = new Map(cur);
        for (const it of [...items].reverse()) next.set(it.path, it);
        return next;
      });
      if (!isNew) return;
      setLatest(items[0]);
      const paths = items.map((i) => i.path);
      setFresh((cur) => new Set([...cur, ...paths]));
      expiries.push(
        setTimeout(() => {
          setFresh((cur) => {
            const next = new Set(cur);
            for (const p of paths) next.delete(p);
            return next;
          });
        }, PING_MS),
      );
    };

    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const r = await api<Reply>('GET', cursor ? `/api/vault/activity?since=${encodeURIComponent(cursor)}` : '/api/vault/activity?limit=100');
          if (stopped) return;
          record(r.items, primed);
          primed = true;
          cursor = r.cursor ?? cursor;
        } catch {
          /* the ticker hides; try again on the next poll */
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), VAULT_POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      expiries.forEach(clearTimeout);
    };
  }, []);

  return { last, fresh, latest };
}
