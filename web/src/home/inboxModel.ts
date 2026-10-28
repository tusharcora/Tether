import type { AttentionItem } from '../api';

export interface InboxEntry {
  key: string;
  kind: AttentionItem['kind'];
  runId: string;
  items: AttentionItem[];
}

/** What the person does with each kind, on the row's badge. */
export const ACTION_WORD: Record<AttentionItem['kind'], string> = { question: 'answer', approval: 'approve', plan_ready: 'review', interrupted: 'resume', failed: 'retry', planning_error: 'retry', paused: 'open' };

/** One entry per item, except a run's questions, which share one entry where its newest question was. Server order kept. */
export function groupInbox(items: AttentionItem[]): InboxEntry[] {
  const out: InboxEntry[] = [];
  const asks = new Map<string, InboxEntry>();
  for (const it of items) {
    if (it.kind !== 'question') {
      out.push({ key: it.id, kind: it.kind, runId: it.runId, items: [it] });
      continue;
    }
    const had = asks.get(it.runId);
    if (had) had.items.push(it);
    else {
      const e: InboxEntry = { key: `${it.runId}:questions`, kind: 'question', runId: it.runId, items: [it] };
      asks.set(it.runId, e);
      out.push(e);
    }
  }
  return out;
}

/** The open entry after a poll: the same one while it is there, else its neighbour at the same place, else the first. */
export function nextSelection(prev: InboxEntry[], next: InboxEntry[], selected?: string): string | undefined {
  if (selected && next.some((e) => e.key === selected)) return selected;
  const at = selected ? prev.findIndex((e) => e.key === selected) : -1;
  return at < 0 ? next[0]?.key : next[Math.min(at, next.length - 1)]?.key;
}
