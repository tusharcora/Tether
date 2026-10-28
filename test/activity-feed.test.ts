import { afterEach, describe, expect, it, vi } from 'vitest';
import { activityFeed, activityLine, cursorOf, namesFor, parseCursor, SETTLE_MS } from '../src/activityFeed.js';
import { feedQuery, Store } from '../src/store.js';
import type { RunEvent, StoredEvent } from '../src/types.js';
import { seedRun } from './home-helpers.js';
import { startHttpTestServer } from './http-helpers.js';

const S = 'SENTINEL-activity';
const NODES = [{ id: 'code', role: 'coder', title: 'Implement' }, { id: 'gate', kind: 'gate' as const, command: 'npm test', title: 'Tests' }];
const ev = (event: RunEvent, seq = 1): StoredEvent => ({ runId: 'r1', seq, ts: 10, event });
/** Run `fn` with the clock (and so every appended event's ts) at `ms`. */
const at = <T>(ms: number, fn: () => T): T => {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(ms);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
};
const started: RunEvent = { type: 'node.started', node: 'code', attempt: 1 };

afterEach(() => vi.restoreAllMocks());

describe('activity lines', () => {
  const s = Store.open(':memory:');
  seedRun(s, 'r1', { nodes: NODES, name: 'ship' });
  const names = namesFor(s.state('r1'));
  const line = (e: RunEvent) => activityLine(ev(e), names);

  it.each<[RunEvent, string, string]>([
    [{ type: 'run.started', pipeline: s.state('r1')!.pipeline, task: S, repo: '/r', workdir: '/w', baseSha: 'a', branch: 'b' }, 'run started', 'working'],
    [{ type: 'run.resumed' }, 'run resumed', 'working'],
    [{ type: 'node.started', node: 'code', attempt: 1 }, 'Implement started', 'working'],
    [{ type: 'node.started', node: 'code', attempt: 2 }, 'Implement started (attempt 2)', 'working'],
    [{ type: 'node.finished', node: 'code', status: 'done', output: S, durationMs: 65_000, costUsd: 0.5, attempt: 1, verdict: 'PASS' }, 'Implement finished · VERDICT PASS · $0.50 · 1m 5s', 'done'],
    [{ type: 'node.finished', node: 'code', status: 'done', output: S, durationMs: 119_700, attempt: 1 }, 'Implement finished · 2m 0s', 'done'],
    [{ type: 'node.finished', node: 'code', status: 'done', output: S, durationMs: 1500, attempt: 1, verdict: 'FAIL' }, 'Implement failed · VERDICT FAIL · 1.5s', 'failed'],
    [{ type: 'node.finished', node: 'code', status: 'error', output: S, error: S, durationMs: 0, attempt: 1 }, 'Implement failed', 'failed'],
    [{ type: 'node.skipped', node: 'gate', reason: S }, 'Tests skipped', 'info'],
    [{ type: 'gate.result', node: 'gate', ok: true, exitCode: 0, output: S, durationMs: 5 }, 'Tests passed', 'done'],
    [{ type: 'gate.result', node: 'gate', ok: false, exitCode: 2, output: S, durationMs: 5 }, 'Tests failed (exit 2)', 'failed'],
    [{ type: 'approval.requested', node: 'gate' }, 'Tests waits for approval', 'needs'],
    [{ type: 'approval.resolved', node: 'gate', approved: true, by: S }, 'Tests approved', 'done'],
    [{ type: 'approval.resolved', node: 'gate', approved: false }, 'Tests rejected', 'failed'],
    [{ type: 'plan.question', round: 1, questions: [{ id: 'q', ask: S, why: S, options: [{ id: 'a', label: S }], recommended: 'a' }] }, 'the team asks 1 question', 'needs'],
    [{ type: 'plan.question', round: 1, questions: [{ id: 'q', ask: S, options: [], recommended: '' }, { id: 'q2', ask: S, options: [], recommended: '' }] }, 'the team asks 2 questions', 'needs'],
    [{ type: 'plan.ready', plan: { goal: S, success: [S], assignments: [{ bot: 'coder', goal: S, mode: 'read', why: S }], limits: { allowWrites: false }, answers: [] } }, 'plan ready for approval', 'needs'],
    [{ type: 'user.ask', node: 'code', question: { id: 'q3', ask: S, options: [], recommended: '' }, wait: true }, 'Implement has a question', 'needs'],
    [{ type: 'user.answer', question: 'q3', answer: { question: 'q3', text: S, by: 'user' } }, 'question answered', 'info'],
    [{ type: 'handoff', from: 'code', to: 'gate', goal: S, answer: S, round: 1 }, 'Implement → Tests', 'info'],
    [{ type: 'consult', from: 'code', to: 'gate', question: S, answer: S, round: 1 }, 'Implement → Tests', 'info'],
    [{ type: 'run.finished', status: 'done' }, 'run done', 'done'],
    [{ type: 'run.finished', status: 'error', error: S }, 'run failed', 'failed'],
    [{ type: 'run.finished', status: 'stopped', budget: true }, 'run stopped · budget reached', 'info'],
    [{ type: 'run.finished', status: 'paused' }, 'run paused', 'info'],
  ])('%j → %s', (e, text, kind) => {
    const l = line(e)!;
    expect(l.text).toBe(text);
    expect(l.kind).toBe(kind);
    expect(JSON.stringify(l)).not.toContain(S);
  });

  it('skips every type outside the allowlist, chunks above all', () => {
    expect(line({ type: 'node.chunk', node: 'code', text: S })).toBeUndefined();
    expect(line({ type: 'team.error', message: S })).toBeUndefined();
    expect(line({ type: 'feedback', node: 'code', rating: 'up', note: S })).toBeUndefined();
  });

  it('names who and which face from the pipeline nodes', () => {
    expect(line({ type: 'node.started', node: 'code', attempt: 1 })).toMatchObject({ id: 'r1:1', who: 'Implement', bot: 'coder' });
    expect(line({ type: 'run.started', pipeline: s.state('r1')!.pipeline, task: 't', repo: '/r', workdir: '/w', baseSha: 'a', branch: 'b' })).toMatchObject({ who: 'ship' });
    expect(line({ type: 'plan.ready', plan: { goal: 'g', success: [], assignments: [], limits: { allowWrites: false }, answers: [] } })).toMatchObject({ who: 'Tether', bot: 'orchestrator' });
    expect(line({ type: 'node.started', node: 'ghost', attempt: 1 })).toMatchObject({ who: 'ghost', text: 'ghost started' });
    const t = Store.open(':memory:');
    seedRun(t, 't1', { kind: 'team' });
    expect(activityLine(ev({ type: 'run.resumed' }), namesFor(t.state('t1')))).toMatchObject({ who: 'Team run' });
  });

  it('parses and prints cursors', () => {
    expect(parseCursor('1700:rabc123:7')).toEqual({ ts: 1700, runId: 'rabc123', seq: 7 });
    expect(parseCursor('nope')).toBeUndefined();
    expect(parseCursor('1:r:x')).toBeUndefined();
    expect(cursorOf({ ts: 1, runId: 'r', seq: 2 })).toBe('1:r:2');
  });
});

describe('activity feed', () => {
  it('never returns free text from any field', () => {
    const s = Store.open(':memory:');
    const all: RunEvent[] = [
      { type: 'node.finished', node: 'code', status: 'error', output: S, error: S, durationMs: 1, attempt: 1 },
      { type: 'gate.result', node: 'gate', ok: false, exitCode: 1, output: S, durationMs: 1 },
      { type: 'plan.question', round: 1, questions: [{ id: 'q', ask: S, why: S, options: [{ id: 'a', label: S, detail: S }], recommended: 'a' }] },
      { type: 'plan.ready', plan: { goal: S, success: [S], assignments: [{ bot: 'coder', goal: S, expected: S, mode: 'read', why: S }], limits: { allowWrites: false }, answers: [] } },
      { type: 'team.error', message: S },
      { type: 'user.ask', node: 'code', question: { id: 'q2', ask: S, why: S, options: [], recommended: '' }, wait: true },
      { type: 'user.answer', question: 'q2', answer: { question: 'q2', text: S, by: 'user' } },
      { type: 'handoff', from: 'code', to: 'gate', goal: S, answer: S, round: 1 },
      { type: 'consult', from: 'code', to: 'gate', question: S, answer: S, round: 1 },
      { type: 'node.skipped', node: 'gate', reason: S },
      { type: 'node.chunk', node: 'code', text: S },
      { type: 'run.finished', status: 'error', error: S },
    ];
    at(1_000, () => {
      seedRun(s, 'r1', { nodes: NODES, task: S });
      for (const e of all) s.append('r1', e);
    });
    const feed = activityFeed(s, { limit: 100 });
    expect(feed.lines).toHaveLength(all.length - 1); // run.started plus every event but team.error and the chunk
    expect(JSON.stringify(feed)).not.toContain(S);
  });

  it('pages with a cursor without repeats or gaps when events share a timestamp', () => {
    const s = Store.open(':memory:');
    at(5_000, () => {
      for (const id of ['ra', 'rb', 'rc']) {
        seedRun(s, id);
        s.append(id, started);
      }
    });
    const everything = activityFeed(s, { limit: 100 }).lines; // newest first
    expect(everything).toHaveLength(6);
    const oldest = [...everything].reverse();
    const first = oldest[0]!;
    let cursor: string | null = cursorOf({ ts: first.ts, runId: first.runId, seq: Number(first.id.split(':').at(-1)) });
    const seen: string[] = [];
    for (let i = 0; i < 5 && cursor; i++) {
      const page = activityFeed(s, { since: parseCursor(cursor)!, limit: 2 });
      if (!page.lines.length) break;
      seen.push(...[...page.lines].reverse().map((l) => l.id));
      cursor = page.cursor;
    }
    expect(seen).toEqual(oldest.slice(1).map((l) => l.id));
  });

  it('holds back events younger than the settle window, so a late commit at an equal timestamp is not skipped', () => {
    const s = Store.open(':memory:');
    at(1_000, () => seedRun(s, 'r0'));
    const { cursor } = activityFeed(s, { limit: 30, now: 5_000 });
    expect(cursor).toBe('1000:r0:1');
    at(10_000, () => seedRun(s, 'rb'));
    // rb is too fresh: neither returned nor allowed to move the cursor
    expect(activityFeed(s, { since: parseCursor(cursor!)!, limit: 30, now: 10_000 + SETTLE_MS - 1 })).toEqual({ lines: [], cursor });
    expect(activityFeed(s, { limit: 30, now: 10_000 + SETTLE_MS - 1 }).lines.map((l) => l.runId)).toEqual(['r0']);
    // another process commits an event stamped with the same ms, sorting before rb
    at(10_000, () => seedRun(s, 'ra'));
    const page = activityFeed(s, { since: parseCursor(cursor!)!, limit: 30, now: 10_000 + SETTLE_MS });
    expect(page.lines.map((l) => l.runId)).toEqual(['rb', 'ra']);
    expect(page.cursor).toBe('10000:rb:1');
  });

  it('defaults to 30 lines and caps at 100 through the route', async () => {
    const srv = await startHttpTestServer();
    try {
      at(1_000, () => {
        seedRun(srv.store, 'rl');
        for (let i = 0; i < 130; i++) srv.store.append('rl', started);
      });
      const first = await srv.api('GET', '/api/activity');
      expect(first.status).toBe(200);
      expect(first.json.lines).toHaveLength(30);
      expect(first.json.cursor).toBe('1000:rl:131');
      expect(first.json.lines[0]).toEqual({ id: 'rl:131', ts: 1000, runId: 'rl', who: 'Implement', text: 'Implement started', kind: 'working', bot: 'coder' });
      expect((await srv.api('GET', '/api/activity?limit=500')).json.lines).toHaveLength(100);
      expect((await srv.api('GET', '/api/activity?limit=abc')).json.lines).toHaveLength(30);
      expect((await srv.api('GET', '/api/activity?limit=0')).json.lines).toHaveLength(30);
      const since = await srv.api('GET', '/api/activity?since=1000:rl:129');
      expect(since.json).toMatchObject({ cursor: '1000:rl:131' });
      expect(since.json.lines.map((l: { id: string }) => l.id)).toEqual(['rl:131', 'rl:130']);
      const bad = await srv.api('GET', '/api/activity?since=garbage');
      expect(bad.status).toBe(400);
      expect(bad.json.error).toMatch(/cursor/);
    } finally {
      await srv.close();
    }
  });

  it('leaves probe runs out', () => {
    const s = Store.open(':memory:');
    at(1_000, () => {
      seedRun(s, 'real');
      seedRun(s, 'probe', { probe: true });
      s.append('probe', started);
    });
    expect(new Set(activityFeed(s, { limit: 100 }).lines.map((l) => l.runId))).toEqual(new Set(['real']));
    expect(activityFeed(s, { since: { ts: 0, runId: '', seq: 0 }, limit: 100 }).lines.map((l) => l.runId)).toEqual(['real']);
  });

  it('keeps paging after the cursor’s run is deleted', () => {
    const s = Store.open(':memory:');
    at(1_000, () => seedRun(s, 'gone'));
    const { cursor } = activityFeed(s, { limit: 100 });
    s.deleteRun('gone');
    at(2_000, () => seedRun(s, 'next'));
    const page = activityFeed(s, { since: parseCursor(cursor!)!, limit: 30 });
    expect(page.lines.map((l) => l.runId)).toEqual(['next']);
    expect(page.cursor).not.toBe(cursor);
  });

  it('echoes the cursor when nothing is new, and has none before any line', () => {
    const s = Store.open(':memory:');
    expect(activityFeed(s, { limit: 30 })).toEqual({ lines: [], cursor: null });
    at(1_000, () => seedRun(s, 'r1'));
    const { cursor } = activityFeed(s, { limit: 100 });
    expect(activityFeed(s, { since: parseCursor(cursor!)!, limit: 30 })).toEqual({ lines: [], cursor });
  });

  it('uses the events_type index even with many chunk rows', () => {
    const s = Store.open(':memory:');
    const db = s.raw() as unknown as { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): { detail: string }[] } };
    const ins = db.prepare('INSERT INTO events(run_id, seq, ts, type, data) VALUES (?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    for (let i = 1; i <= 10_000; i++) ins.run('rc', i, i, 'node.chunk', '{"type":"node.chunk","node":"code","text":"x"}');
    db.exec('COMMIT');
    for (const after of [undefined, { ts: 5, runId: 'rc', seq: 5 }]) {
      const q = feedQuery({ types: ['node.started', 'run.finished'], after, exclude: ['p1'], until: 20_000, limit: 30 });
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params).map((r) => r.detail).join('\n');
      expect(plan).toContain('events_type');
    }
  });
});
