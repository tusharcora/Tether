/**
 * Notes runs wrote to the vault, across runs, for the Graph's live pings. Runs do not record the notes they read, only
 * the ones they write (`vault.note`), so this is the honest "used by a run" signal. Same cursor, settle and probe rules
 * as Home's activity feed.
 */
import { cursorOf, SETTLE_MS } from './activityFeed.js';
import { runTitle } from './runLabels.js';
import type { FeedCursor, Store } from './store.js';
import type { VaultActivityItem } from './types.js';

export const VAULT_ACTIVITY_LIMIT = 50;
export const VAULT_ACTIVITY_MAX = 200;

export function vaultActivity(store: Store, o: { since?: FeedCursor; limit: number; now?: number }): { items: VaultActivityItem[]; cursor: string | null } {
  const until = (o.now ?? Date.now()) - SETTLE_MS;
  const events = store.feed({ types: ['vault.note'], after: o.since, exclude: store.runIds({ probes: true }), until, limit: o.limit });
  const labels = new Map<string, string>();
  const items: VaultActivityItem[] = [];
  for (const e of events) {
    if (e.event.type !== 'vault.note') continue;
    let run = labels.get(e.runId);
    if (run === undefined) {
      const s = store.state(e.runId);
      run = s ? runTitle({ kind: s.kind, pipeline: s.pipeline.name }) : 'run';
      labels.set(e.runId, run);
    }
    items.push({ id: `${e.runId}:${e.seq}`, ts: e.ts, runId: e.runId, run, path: e.event.path });
  }
  // after a cursor the query pages forward (oldest first); the response is always newest first
  const newest = o.since ? events.at(-1) : events[0];
  if (o.since) items.reverse();
  return { items, cursor: newest ? cursorOf(newest) : o.since ? cursorOf(o.since) : null };
}
