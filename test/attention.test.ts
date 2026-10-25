import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ATTENTION_TYPES, attentionFor, attentionItems, attentionReader, FAILED_WINDOW_MS, mayNeedAttention, STALE_MS, type AttentionRun } from '../src/attention.js';
import { Store } from '../src/store.js';
import type { Question, TeamPlan } from '../src/types.js';
import { seedRun } from './home-helpers.js';
import { startHttpTestServer } from './http-helpers.js';

const S = 'SENTINEL-attention';
const card = (id: string, o: Partial<Question> = {}): Question => ({ id, ask: `ask ${id}`, options: [{ id: 'a', label: 'A' }], recommended: 'a', ...o });
const plan: TeamPlan = { goal: 'g', success: [], assignments: [{ bot: 'coder', goal: 'c', mode: 'read' }], limits: { allowWrites: false }, answers: [] };
const runOf = (store: Store, id: string, live = false): AttentionRun => ({ state: store.state(id)!, events: store.eventsNoChunks(id), live, lastTs: store.lastTs(id) });
const kinds = (r: AttentionRun) => attentionFor(r).map((i) => i.kind);

describe('attention items', () => {
  it('plan_ready: a team plan waiting for approval links to its review', () => {
    const s = Store.open(':memory:');
    seedRun(s, 't1', { kind: 'team' });
    s.append('t1', { type: 'plan.ready', plan });
    const [item] = attentionFor(runOf(s, 't1', true));
    expect(item).toMatchObject({ id: 't1:plan_ready', kind: 'plan_ready', title: 'Plan ready for approval', actions: ['review'], meta: 'Team run · t1 · aorch/t1' });
    expect(item!.ts).toBe(s.eventsNoChunks('t1').at(-1)!.ts);
  });

  it('question: one item per pending planning card or worker question', () => {
    const s = Store.open(':memory:');
    seedRun(s, 't2', { kind: 'team' });
    s.append('t2', { type: 'plan.question', round: 1, questions: [card('q1'), card('q2', { ask: 'x'.repeat(200) })] });
    const items = attentionFor(runOf(s, 't2', true));
    expect(items.map((i) => i.id)).toEqual(['t2:question:q1', 't2:question:q2']);
    expect(items[1]!.title).toHaveLength(120);
    expect(items[0]).toMatchObject({ actions: ['answer'] });
    expect(items[0]!.node).toBeUndefined();

    seedRun(s, 'w1', { nodes: [{ id: 'code', role: 'coder', title: 'Implement' }] });
    s.append('w1', { type: 'node.started', node: 'code', attempt: 1 });
    s.append('w1', { type: 'user.ask', node: 'code', question: card('q3', { from: 'code' }), wait: true });
    const [ask] = attentionFor(runOf(s, 'w1', true));
    expect(ask).toMatchObject({ kind: 'question', node: 'code', title: 'ask q3' });
  });

  it('approval: an awaiting approval step, and no paused item on top of it', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r1', { nodes: [{ id: 'code', role: 'coder' }, { id: 'ok', kind: 'approval', title: 'Ship it' }] });
    s.append('r1', { type: 'approval.requested', node: 'ok' });
    s.append('r1', { type: 'run.finished', status: 'paused' });
    const items = attentionFor(runOf(s, 'r1'));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'r1:approval:ok', kind: 'approval', node: 'ok', title: 'Ship it waits for approval', actions: ['approve', 'open'] });
  });

  it('paused: a paused run with nothing more specific', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r2');
    s.append('r2', { type: 'run.finished', status: 'paused' });
    expect(attentionFor(runOf(s, 'r2'))).toMatchObject([{ kind: 'paused', title: 'Paused', actions: ['open'] }]);
  });

  it('planning_error: a stalled team run whose latest error is newer than its latest resume, without error text', () => {
    const s = Store.open(':memory:');
    seedRun(s, 't3', { kind: 'team' });
    s.append('t3', { type: 'team.error', message: S });
    const items = attentionFor(runOf(s, 't3'));
    expect(items).toMatchObject([{ kind: 'planning_error', title: 'Planning failed', actions: ['retry', 'open'] }]);
    expect(JSON.stringify(items)).not.toContain(S);
    s.append('t3', { type: 'run.resumed' });
    expect(kinds(runOf(s, 't3'))).toEqual(['interrupted']);
  });

  it('interrupted: running with no process driving it, only when not live', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r3');
    expect(attentionFor(runOf(s, 'r3'))).toMatchObject([{ kind: 'interrupted', title: 'Interrupted: no process is driving it', actions: ['resume', 'open'] }]);
    expect(attentionFor(runOf(s, 'r3', true))).toEqual([]);
  });

  it('failed: an error run from the last 24 hours, without error text', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r4');
    s.append('r4', { type: 'run.finished', status: 'error', error: S });
    const r = runOf(s, 'r4');
    const items = attentionFor(r);
    expect(items).toMatchObject([{ kind: 'failed', title: 'Failed', actions: ['retry', 'open'] }]);
    expect(items[0]!.ts).toBe(r.state.finishedAt);
    expect(JSON.stringify(items)).not.toContain(S);
    expect(attentionFor(r, r.state.finishedAt! + FAILED_WINDOW_MS + 1)).toEqual([]);
  });

  it('sorts newest first and skips probe runs', () => {
    const s = Store.open(':memory:');
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    seedRun(s, 'old');
    now.mockReturnValue(2_000);
    seedRun(s, 'new');
    seedRun(s, 'probe', { probe: true });
    now.mockRestore();
    const items = attentionItems([runOf(s, 'old'), runOf(s, 'new'), runOf(s, 'probe')]);
    expect(items.map((i) => i.runId)).toEqual(['new', 'old']);
    expect(mayNeedAttention({ status: 'running', probe: true })).toBe(false);
    expect(mayNeedAttention({ status: 'done' })).toBe(false);
    expect(mayNeedAttention({ status: 'error', finishedAt: Date.now() })).toBe(true);
  });
});

describe('attention reader (per-run cache)', () => {
  const notLive = () => false;

  it('reads only the event types it needs, and nothing again while no run has new events', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r1');
    seedRun(s, 't1', { kind: 'team' });
    s.append('t1', { type: 'team.error', message: S });
    seedRun(s, 'd1');
    s.append('d1', { type: 'run.finished', status: 'done' });
    const read = vi.spyOn(s, 'eventsOfTypes');
    const reader = attentionReader(s);

    expect(reader.items(notLive).map((i) => i.id).sort()).toEqual(['r1:interrupted', 't1:planning_error']);
    expect(read.mock.calls.map((c) => c[0]).sort()).toEqual(['r1', 't1']); // the finished run is never read
    expect(read.mock.calls.every((c) => c[1] === ATTENTION_TYPES)).toBe(true);

    read.mockClear();
    expect(reader.items(notLive).map((i) => i.id).sort()).toEqual(['r1:interrupted', 't1:planning_error']);
    expect(read).not.toHaveBeenCalled();

    s.append('t1', { type: 'run.resumed' });
    expect(reader.items(notLive).map((i) => i.id).sort()).toEqual(['r1:interrupted', 't1:interrupted']);
    expect(read.mock.calls).toEqual([['t1', ATTENTION_TYPES, 2]]); // only the events after the cached seq
  });

  it('starts over when a run is deleted and its id reused', () => {
    const s = Store.open(':memory:');
    seedRun(s, 't1', { kind: 'team' });
    s.append('t1', { type: 'team.error', message: S });
    const reader = attentionReader(s);
    expect(reader.items(notLive).map((i) => i.kind)).toEqual(['planning_error']);
    s.deleteRun('t1');
    seedRun(s, 't1', { kind: 'team' });
    expect(reader.items(notLive).map((i) => i.kind)).toEqual(['interrupted']);
  });

  it('ages out runs nothing has driven for 7 days without reading them', () => {
    const s = Store.open(':memory:');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    seedRun(s, 'old');
    seedRun(s, 'paused');
    s.append('paused', { type: 'run.finished', status: 'paused' });
    clock.mockRestore();
    const later = 1_000_000 + STALE_MS + 1;
    const read = vi.spyOn(s, 'eventsOfTypes');
    expect(attentionReader(s).items(notLive, later).map((i) => i.id)).toEqual(['paused:paused']);
    expect(read.mock.calls.map((c) => c[0])).toEqual(['paused']);
    expect(mayNeedAttention({ status: 'running', live: false, lastTs: 0 }, STALE_MS + 1)).toBe(false);
    expect(mayNeedAttention({ status: 'running', live: true, lastTs: 0 }, STALE_MS + 1)).toBe(true);
  });
});

describe('GET /api/attention', () => {
  let srv: Awaited<ReturnType<typeof startHttpTestServer>>;
  beforeAll(async () => {
    srv = await startHttpTestServer();
  });
  afterAll(() => srv.close());

  it('answers with the items of real runs only', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 180_000); // quiet for 3 minutes
    seedRun(srv.store, 'ra');
    seedRun(srv.store, 'rp', { probe: true });
    clock.mockRestore();
    const r = await srv.api('GET', '/api/attention');
    expect(r.status).toBe(200);
    expect(r.json.items.map((i: { id: string }) => i.id)).toEqual(['ra:interrupted']);
  });

  it('carries no task, output or error text, and a repeat poll reads no events', async () => {
    seedRun(srv.store, 'rs', { task: `${S}-task` });
    srv.store.append('rs', { type: 'node.started', node: 'code', attempt: 1 });
    srv.store.append('rs', { type: 'node.finished', node: 'code', status: 'error', output: `${S}-output`, durationMs: 1, attempt: 1 });
    srv.store.append('rs', { type: 'run.finished', status: 'error', error: `${S}-error` });
    const first = await srv.api('GET', '/api/attention');
    expect(first.json.items.find((i: { runId: string }) => i.runId === 'rs')).toMatchObject({ kind: 'failed' });
    expect(first.text).not.toContain(S);
    const db = srv.store.raw() as unknown as { prepare: (sql: string) => unknown };
    const spy = vi.spyOn(db, 'prepare');
    try {
      expect((await srv.api('GET', '/api/attention')).json).toEqual(first.json);
      expect(spy.mock.calls.map((c) => String(c[0])).filter((q) => /type IN/.test(q))).toEqual([]);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(2); // listRows only
    } finally {
      spy.mockRestore();
    }
  });

  it('does not call a run interrupted while another process drives it (an event in the last 2 minutes)', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 30_000);
    seedRun(srv.store, 'cli');
    clock.mockReturnValue(Date.now() - 180_000);
    seedRun(srv.store, 'quiet');
    clock.mockRestore();
    const ids = (await srv.api('GET', '/api/attention')).json.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain('cli:interrupted');
    expect(ids).toContain('quiet:interrupted');
  });

  it('refuses a non-loopback Host', async () => {
    const u = new URL(srv.base);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: u.hostname, port: u.port, method: 'GET', path: '/api/attention', headers: { host: 'evil.example.com' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});
