import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MockAdapter } from '../src/adapters/index.js';
import { agentChoices, Attempts, checkOf, defaultPicks, diffSummary, KEEP_MS, rankAttempts, type AttemptView } from '../src/attempts.js';
import type { RunState } from '../src/types.js';
import { makeRepo, pipe, setup } from './helpers.js';

const flow = (delayMs = 0) =>
  pipe(
    [
      { id: 'code', role: 'coder', mock: { writeFile: { path: 'x.txt', content: 'one\ntwo\n' }, costUsd: 0.25, delayMs } },
      { id: 'gate', kind: 'gate', command: 'test -f x.txt && echo "Tests  3 passed (3)"' },
      { id: 'review', role: 'reviewer', verdict: true, readOnly: true, mock: { output: 'Clean, adds an index\nVERDICT: PASS' } },
      { id: 'ok', kind: 'approval', title: 'You approve' },
    ],
    [
      ['code', 'gate'],
      ['gate', 'review'],
      ['review', 'ok'],
    ],
  );

/** A run waiting on its approval, with a second agent ("other") registered next to the mock. */
async function rig(o: { delayMs?: number; refusal?: string } = {}) {
  const s = setup();
  const other = new MockAdapter();
  Object.defineProperty(other, 'id', { value: 'other' });
  s.registry.register(other);
  const repo = makeRepo();
  const id = await s.engine.start({ pipeline: flow(o.delayMs), task: 'Faster search', repo });
  await s.engine.wait(id);
  const ship = { decide: vi.fn(async () => {}) };
  const adopt = vi.fn();
  const attempts = new Attempts({ home: s.home, store: s.store, engine: s.engine, registry: s.registry, ship, refusal: () => o.refusal, adopt });
  return { ...s, other, repo, id, ship, adopt, attempts };
}

describe('try more ways', () => {
  it('starts siblings from the original’s base on other agents, the original A and the siblings B, C', async () => {
    const r = await rig();
    const ids = await r.attempts.start(r.id, { count: 2, agents: [{ agent: 'other', model: 'm1' }, { agent: 'mock' }] });
    expect(ids).toHaveLength(2);
    for (const id of ids) await r.engine.wait(id);
    const [a, b, c] = [r.store.state(r.id)!, r.store.state(ids[0]!)!, r.store.state(ids[1]!)!];
    expect([a.attemptLabel, b.attemptLabel, c.attemptLabel]).toEqual(['A', 'B', 'C']);
    expect(new Set([a.attemptSet, b.attemptSet, c.attemptSet]).size).toBe(1);
    expect(b.baseSha).toBe(a.baseSha);
    expect(b.task).toBe('Faster search');
    expect(b.pipeline.nodes.filter((n) => n.kind === 'agent').map((n) => [n.agent, n.model])).toEqual([
      ['other', 'm1'],
      ['other', 'm1'],
    ]);
    expect(r.other.calls.length).toBe(2);
    expect(r.adopt).toHaveBeenCalledTimes(2);
    expect(r.attempts.members(a.attemptSet!).map((m) => m.id)).toEqual([r.id, ...ids]);
    // one more joins the same set as D
    const [d] = await r.attempts.start(ids[0]!, { count: 1, agents: [{ agent: 'mock' }] });
    expect(r.store.state(d!)!.attemptLabel).toBe('D');
  });

  it('refuses a bad count, an unknown agent, a full set and what the goal or team refuses', async () => {
    const r = await rig();
    await expect(r.attempts.start(r.id, { count: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(r.attempts.start(r.id, { count: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(r.attempts.start(r.id, { count: 1, agents: [{ agent: 'nope' }] })).rejects.toMatchObject({ status: 400 });
    await expect(r.attempts.start('rnope', { count: 1 })).rejects.toMatchObject({ status: 404 });
    const full = await rig({ refusal: 'Today’s limit is reached' });
    await expect(full.attempts.start(full.id, { count: 1 })).rejects.toMatchObject({ status: 409, message: 'Today’s limit is reached' });
  });

  it('default picks: the owner’s bindings then adapters, free last, never the original’s or a repeat', async () => {
    const r = await rig();
    for (const id of ['openrouter', 'claude']) {
      const a = new MockAdapter();
      Object.defineProperty(a, 'id', { value: id });
      r.registry.register(a);
    }
    writeFileSync(join(r.home, 'bots.json'), JSON.stringify({ coder: { agent: 'claude', model: 'sonnet' }, scout: { agent: 'openrouter', model: 'kimi:free' }, gone: { agent: 'nope' } }));
    const pool = agentChoices(r.home, r.registry);
    expect(pool).toEqual([{ agent: 'claude', model: 'sonnet' }, { agent: 'other' }, { agent: 'claude' }, { agent: 'openrouter', model: 'kimi:free' }, { agent: 'openrouter' }]);
    expect(defaultPicks(pool, [{ agent: 'claude', model: 'sonnet' }], 2)).toEqual([{ agent: 'other' }, { agent: 'claude' }]);
    expect(defaultPicks([{ agent: 'other' }], [], 2)).toEqual([{ agent: 'other' }, undefined]);
    expect(r.attempts.picks(r.id, 2).original).toEqual({ agent: 'mock' });
  });

  it('ranks: the check passes, then fewer failing tests, then a smaller diff, then a lower cost; failed and empty ones never', () => {
    const row = (id: string, o: Partial<AttemptView> = {}) => ({ id, status: 'paused' as const, live: false, added: 10, deleted: 0, costUsd: 1, ...o });
    expect(rankAttempts([row('a', { check: { ok: false, failing: 2 } }), row('b', { check: { ok: true } })])).toBe('b');
    expect(rankAttempts([row('a', { check: { ok: true, failing: 1 } }), row('b', { check: { ok: true, failing: 0 } })])).toBe('b');
    expect(rankAttempts([row('a', { added: 90 }), row('b', { added: 40 })])).toBe('b');
    expect(rankAttempts([row('a', { costUsd: 0.5 }), row('b', { costUsd: 0 })])).toBe('b');
    expect(rankAttempts([row('a', { status: 'error' }), row('b', { live: true }), row('c', { added: 0 })])).toBeUndefined();
  });

  it('reads a set: check, changes, cost, review and Tether’s pick', async () => {
    const r = await rig();
    const [b] = await r.attempts.start(r.id, { count: 1, agents: [{ agent: 'other' }] });
    await r.engine.wait(b!);
    const v = await r.attempts.view(r.store.state(r.id)!.attemptSet!);
    expect(v.task).toBe('Faster search');
    expect(v.runs.map((x) => x.label)).toEqual(['A', 'B']);
    expect(v.runs[0]).toMatchObject({ status: 'paused', agent: 'mock', check: { ok: true, passing: 3 }, files: 1, added: 2, deleted: 0, costUsd: 0.25, review: { bot: 'reviewer', line: 'Clean, adds an index' }, excerpt: { file: 'x.txt', lines: ['+one', '+two'] } });
    expect(v.pick).toBe(r.id);
    await expect(r.attempts.view('anope')).rejects.toMatchObject({ status: 404 });
  });

  it('pick ships the chosen attempt and stops the rest; a second pick is refused', async () => {
    const r = await rig();
    const [b] = await r.attempts.start(r.id, { count: 1, agents: [{ agent: 'other' }] });
    const set = r.store.state(r.id)!.attemptSet!;
    // B is still going (or waiting on you): either way it is stopped
    await r.attempts.pick(set, r.id);
    expect(r.ship.decide).toHaveBeenCalledWith(r.id, false);
    await r.engine.wait(b!);
    expect(r.store.state(b!)!.status).toBe('stopped');
    expect(r.store.state(r.id)!.attemptPicked).toMatchObject({ run: r.id });
    await expect(r.attempts.pick(set, b!)).rejects.toMatchObject({ status: 409 });
    await expect(r.attempts.pick(set, 'rnope')).rejects.toMatchObject({ status: 400 });
  });

  it('sweeps unpicked attempts’ worktrees and branches 7 days after the pick', async () => {
    const r = await rig();
    const [b] = await r.attempts.start(r.id, { count: 1, agents: [{ agent: 'other' }] });
    await r.engine.wait(b!);
    await r.attempts.pick(r.store.state(r.id)!.attemptSet!, r.id);
    const wt = r.store.state(b!)!.workdir;
    expect(await r.attempts.sweep()).toBe(0);
    expect(await r.attempts.sweep(Date.now() + KEEP_MS + 1000)).toBe(1);
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(r.store.state(r.id)!.workdir)).toBe(true);
  });

  it('summarises a diff and a run’s gates', () => {
    expect(diffSummary('diff --git a/s/q.ts b/s/q.ts\n--- a/s/q.ts\n+++ b/s/q.ts\n@@ -1 +1,2 @@\n-a\n+b\n+c\ndiff --git a/t b/t\n+++ b/t\n+d\n')).toEqual({ files: 2, added: 3, deleted: 1, excerpt: { file: 's/q.ts', lines: ['-a', '+b', '+c'] } });
    const s = { pipeline: pipe([{ id: 'g', kind: 'gate', command: 'x' }], []), nodes: { g: { status: 'error', gate: { ok: false, exitCode: 1, output: '2 failed | 39 passed' } } } } as unknown as RunState;
    expect(checkOf(s)).toEqual({ ok: false, failing: 2, passing: 39 });
  });
});
