import { describe, expect, it } from 'vitest';
import type { Chat } from '../src/assistant/history.js';
import { matches, summarize } from '../src/assistant/summary.js';
import type { ChatMessage, Proposal } from '../src/assistant/types.js';
import { Store } from '../src/store.js';
import { seedRun } from './home-helpers.js';

const you = (text: string, at = 1): ChatMessage => ({ id: `y${at}`, role: 'you', text, at });
const tether = (text: string, o: Partial<ChatMessage> = {}, at = 2): ChatMessage => ({ id: `t${at}`, role: 'tether', text, at, ...o });
const prop = (o: Partial<Proposal> = {}): Proposal => ({ id: 'p1', kind: 'team', task: 'Fix the README CLI section\nin detail', status: 'proposed', ...o });
const chat = (messages: ChatMessage[]): Chat => ({ id: 'c1', title: 'Why did it fail?', created: 1, updated: 9, messages, once: [] });

function world(live: string[] = []) {
  const store = Store.open(':memory:');
  const engine = { isLive: (id: string) => live.includes(id), isPlanning: () => false };
  const rows = () => new Map(store.listRows().map((r) => [r.summary.id, r]));
  return { store, engine, rows };
}
const finish = (store: Store, id: string, status: 'done' | 'error', costUsd = 0) => {
  store.append(id, { type: 'node.started', node: 'code', attempt: 1 });
  store.append(id, { type: 'node.finished', node: 'code', status, output: 'x', durationMs: 5, attempt: 1, costUsd });
  store.append(id, { type: 'run.finished', status });
};

describe('chat summaries', () => {
  it('an answer only: asked and answered, the first line of the last reply', () => {
    const w = world();
    const s = summarize(chat([you('Why did it fail?'), tether('Lens failed it.\n\nMore detail.')]), w.rows(), w.engine);
    expect(s).toMatchObject({ id: 'c1', title: 'Why did it fail?', updated: 9, count: 2, last: 'Lens failed it.', kind: 'answer', faces: [], cites: [] });
    expect(s.outcome).toEqual([{ kind: 'Asked', label: 'Why did it fail?', state: 'answered', tone: 'done' }]);
  });

  it('a proposal waiting is a chat that needs you', () => {
    const w = world();
    const s = summarize(chat([you('q'), tether('I can.', { proposals: [prop()] })]), w.rows(), w.engine);
    expect(s.kind).toBe('needs');
    expect(s.outcome[1]).toEqual({ kind: 'Proposal', label: 'Fix the README CLI section', state: 'waiting on you', tone: 'needs' });
  });

  it('a started run follows its proposal with its live state, and its crew are the faces', () => {
    const w = world(['r1']);
    seedRun(w.store, 'r1');
    const s = summarize(chat([you('q'), tether('ok', { proposals: [prop({ status: 'started', runId: 'r1' })] })]), w.rows(), w.engine);
    expect(s.kind).toBe('live');
    expect(s.outcome.slice(1)).toEqual([
      { kind: 'Proposal', label: 'Fix the README CLI section', state: 'approved', tone: 'done' },
      { kind: 'Run', label: 'r1', runId: 'r1', state: 'running', tone: 'live' },
    ]);
    expect(s.faces).toEqual(['coder']);
  });

  it('a run waiting on an approval needs you; a finished run says how it ended and what it cost', () => {
    const w = world(['r1']);
    seedRun(w.store, 'r1', { nodes: [{ id: 'ok', kind: 'approval' }] });
    w.store.append('r1', { type: 'approval.requested', node: 'ok' });
    seedRun(w.store, 'r2');
    finish(w.store, 'r2', 'done', 0.12);
    seedRun(w.store, 'r3');
    finish(w.store, 'r3', 'error');
    const one = (runId: string) => summarize(chat([you('q'), tether('ok', { proposals: [prop({ status: 'started', runId })] })]), w.rows(), w.engine);
    expect(one('r1')).toMatchObject({ kind: 'needs', outcome: [{}, {}, { state: 'waiting on you', tone: 'needs' }] });
    expect(one('r2')).toMatchObject({ kind: 'done', outcome: [{}, {}, { state: 'done · $0.12', tone: 'done' }] });
    expect(one('r3')).toMatchObject({ kind: 'failed', outcome: [{}, {}, { state: 'failed', tone: 'failed' }] });
    // the latest run decides: an older failure, then a success
    const both = summarize(chat([you('q'), tether('a', { proposals: [prop({ id: 'p1', status: 'started', runId: 'r3' })] }), you('again', 3), tether('b', { proposals: [prop({ id: 'p2', status: 'started', runId: 'r2' })] }, 4)]), w.rows(), w.engine);
    expect(both.kind).toBe('done');
    expect(both.outcome.map((n) => n.kind)).toEqual(['Asked', 'Proposal', 'Run', 'Proposal', 'Run']);
  });

  it('lists each cited source once', () => {
    const w = world();
    const cite = { n: 1, label: 'limit.ts', kind: 'file' as const, path: 'src/limit.ts', line: 3 };
    const s = summarize(chat([you('q'), tether('a', { cites: [cite] }), you('q2', 3), tether('b', { cites: [{ ...cite, n: 2 }, { n: 1, label: 'run r9', kind: 'run', id: 'r9' }] }, 4)]), w.rows(), w.engine);
    expect(s.cites.map((c) => c.label)).toEqual(['limit.ts', 'run r9']);
  });
});

describe('chat search', () => {
  const c = chat([you('How is the rate limit set?'), tether('In limit.ts.', { cites: [{ n: 1, label: 'limit.ts', kind: 'file', path: 'src/limit.ts' }], proposals: [prop({ status: 'started', runId: 'r1abc' })] })]);
  it('finds a chat by title, message text, a run it started or a file it cites', () => {
    for (const q of ['why did', 'RATE LIMIT', 'r1abc', 'src/limit']) expect(matches(c, q)).toBe(true);
    expect(matches(c, 'zzz')).toBe(false);
  });
});
