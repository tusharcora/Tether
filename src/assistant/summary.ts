/**
 * A chat as the lists show it (All chats, the sidebar, the mini chat's switcher): what it led to, from the question
 * through each proposal to the run it started, with that run's live state from the store, read on every request.
 */
import { crewFor } from '../bots.js';
import { rowLive, type LiveProbe } from '../runLabels.js';
import type { Store } from '../store.js';
import { titleOf, type Chat } from './history.js';
import type { ChatSummary, Cite, OutcomeNode, Proposal } from './types.js';

type Row = ReturnType<Store['listRows']>[number];

const firstLine = (t: string, max: number) => (t.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, max);

const PROPOSAL: Record<Proposal['status'], [string, OutcomeNode['tone']]> = { proposed: ['waiting on you', 'needs'], started: ['approved', 'done'], dismissed: ['dismissed', 'idle'], failed: ['could not start', 'failed'] };

function runNode(id: string, row: Row | undefined, engine: LiveProbe): OutcomeNode {
  if (!row) return { kind: 'Run', label: id, runId: id, state: 'deleted', tone: 'idle' };
  const r = row.summary;
  const live = rowLive(engine, { ...r, lastTs: row.lastTs });
  const waits = r.pending > 0 || r.planReady || Object.values(row.state.nodes).some((n) => n.status === 'awaiting');
  const [state, tone]: [string, OutcomeNode['tone']] = waits
    ? ['waiting on you', 'needs']
    : live
      ? ['running', 'live']
      : r.status === 'done'
        ? [`done · $${r.costUsd.toFixed(2)}`, 'done']
        : r.status === 'error'
          ? ['failed', 'failed']
          : [r.status === 'running' ? 'interrupted' : r.status, 'idle'];
  return { kind: 'Run', label: id, runId: id, state, tone };
}

export function summarize(c: Chat, rows: Map<string, Row>, engine: LiveProbe): ChatSummary {
  const asked = c.messages.find((m) => m.role === 'you');
  // a compaction's summary is not a reply
  const replies = c.messages.filter((m) => m.role === 'tether' && !m.compact);
  const outcome: OutcomeNode[] = asked ? [{ kind: 'Asked', label: titleOf(asked.text), state: replies.length ? 'answered' : 'asked', tone: replies.length ? 'done' : 'idle' }] : [];
  const faces = new Set<string>();
  for (const p of replies.flatMap((m) => m.proposals ?? [])) {
    const [state, tone] = PROPOSAL[p.status];
    outcome.push({ kind: 'Proposal', label: firstLine(p.task, 60) || `Run ${p.workflow ?? 'a team'}`, state, tone });
    if (p.status !== 'started' || !p.runId) continue;
    const row = rows.get(p.runId);
    outcome.push(runNode(p.runId, row, engine));
    for (const n of row?.state.pipeline.nodes ?? []) if (n.kind === 'agent') faces.add(crewFor(n));
  }
  const runs = outcome.filter((n) => n.kind === 'Run');
  const kind: ChatSummary['kind'] = outcome.some((n) => n.tone === 'needs')
    ? 'needs'
    : runs.some((n) => n.tone === 'live')
      ? 'live'
      : runs.length
        ? runs.at(-1)!.tone === 'failed'
          ? 'failed'
          : 'done'
        : 'answer';
  const cites: Cite[] = [];
  const seen = new Set<string>();
  for (const x of replies.flatMap((m) => m.cites ?? [])) {
    const key = JSON.stringify([x.kind, x.kind === 'run' ? x.id : x.path, x.kind === 'file' ? x.line : undefined]);
    if (!seen.has(key) && cites.length < 8) (seen.add(key), cites.push(x));
  }
  const lastReply = replies.at(-1);
  return { id: c.id, title: c.title, updated: c.updated, count: c.messages.length, last: lastReply ? firstLine(lastReply.text, 140) || (lastReply.error ?? '') : '', kind, outcome, faces: [...faces], cites };
}

/** Search: the title, any message, a run the chat started or a source it cites (case-insensitive). */
export function matches(c: Chat, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  const hay = [c.title, ...c.messages.flatMap((m) => [m.text, ...(m.proposals ?? []).map((p) => p.runId ?? ''), ...(m.cites ?? []).map((x) => (x.kind === 'run' ? x.id : x.path))])];
  return hay.some((h) => h.toLowerCase().includes(n));
}
