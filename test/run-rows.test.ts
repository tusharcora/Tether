import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FINISHED, isFinished, RECENT_ACTIVITY_MS, rowLive, runMeta, runTitle, stepLabel } from '../src/runLabels.js';
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { realRepo, rowExtras } from '../src/runRows.js';
import { tmp } from './helpers.js';
import { Store } from '../src/store.js';
import { seedRun } from './home-helpers.js';
import { startHttpTestServer } from './http-helpers.js';

describe('run rows for Home', () => {
  it('carry the repo folder’s real path, so a run on a symlinked path still matches its project', () => {
    const base = realpathSync(tmp('real-'));
    const target = join(base, 'repo');
    mkdirSync(target);
    const link = join(base, 'link');
    symlinkSync(target, link);
    expect(realRepo(link)).toBe(target);
    expect(realRepo(join(base, 'gone'))).toBe(join(base, 'gone'));
    const store = Store.open(':memory:');
    seedRun(store, 'r9');
    const s = { ...store.state('r9')!, repo: link };
    expect(rowExtras(s, 0).repoReal).toBe(target);
  });

  it('lists steps in pipeline order, the first running or awaiting step as current, and the agent bots', () => {
    const store = Store.open(':memory:');
    seedRun(store, 'r1', { nodes: [{ id: 'plan', role: 'planner', title: 'Plan' }, { id: 'code', role: 'coder', title: 'Implement' }, { id: 'gate', kind: 'gate', command: 'npm test' }, { id: 'ok', kind: 'approval' }] });
    store.append('r1', { type: 'node.started', node: 'plan', attempt: 1 });
    store.append('r1', { type: 'node.finished', node: 'plan', status: 'done', output: 'x', durationMs: 5, attempt: 1 });
    store.append('r1', { type: 'node.started', node: 'code', attempt: 1 });
    const x = rowExtras(store.state('r1')!, store.lastTs('r1'));
    expect(x.steps).toEqual([
      { id: 'plan', status: 'done', bot: 'planner' },
      { id: 'code', status: 'running', bot: 'coder' },
      { id: 'gate', status: 'queued', bot: 'tester' },
      { id: 'ok', status: 'queued', bot: 'approval' },
    ]);
    expect(x.current).toEqual({ node: 'code', bot: 'Bolt', title: 'Implement' });
    expect(x.bots).toEqual(['planner', 'coder']);
    expect(x.branch).toBe('aorch/r1');
    expect(x.lastTs).toBe(store.lastTs('r1'));
  });

  it('has no current step when nothing runs or waits, and no steps for a team run before its plan', () => {
    const store = Store.open(':memory:');
    seedRun(store, 'r2');
    expect(rowExtras(store.state('r2')!, 0).current).toBeUndefined();
    seedRun(store, 't1', { kind: 'team' });
    expect(rowExtras(store.state('t1')!, 0)).toMatchObject({ steps: [], bots: [] });
  });

  it('treats an awaiting step as current', () => {
    const store = Store.open(':memory:');
    seedRun(store, 'r3', { nodes: [{ id: 'code', role: 'coder', title: 'Implement' }, { id: 'ok', kind: 'approval', title: 'Ship it' }] });
    store.append('r3', { type: 'node.started', node: 'code', attempt: 1 });
    store.append('r3', { type: 'node.finished', node: 'code', status: 'done', output: '', durationMs: 1, attempt: 1 });
    store.append('r3', { type: 'approval.requested', node: 'ok' });
    expect(rowExtras(store.state('r3')!, 0).current).toEqual({ node: 'ok', bot: 'Gate', title: 'Ship it' });
  });
});

describe('shared run labels', () => {
  it('names runs, steps and finished statuses one way for every screen', () => {
    expect(runTitle({ kind: 'team', pipeline: 'team' })).toBe('Team run');
    expect(runTitle({ kind: 'workflow', pipeline: 'flow' })).toBe('flow');
    expect(runMeta({ kind: 'workflow', pipeline: 'flow', id: 'r1', branch: 'aorch/r1' })).toBe('flow · r1 · aorch/r1');
    expect([...FINISHED].sort()).toEqual(['done', 'error', 'stopped']);
    expect(isFinished('done')).toBe(true);
    expect(isFinished('paused')).toBe(false);
    const nodes = [
      { id: 'code', kind: 'agent', role: 'coder', title: 'Implement' },
      { id: 'ok', kind: 'approval' },
    ];
    expect(stepLabel(nodes, 'code')).toBe('Implement (code)');
    expect(stepLabel(nodes, 'ok')).toBe('approval (ok)');
    expect(stepLabel(nodes, 'gone')).toBe('gone');
  });

  it('counts a run live when its process runs or a team run waits on the person', () => {
    const eng = (live: boolean, planning = false) => ({ isLive: () => live, isPlanning: () => planning });
    const team = { id: 't', kind: 'team' as const, status: 'running' as const, pending: 0, planReady: false, lastTs: 0 };
    expect(rowLive(eng(true), { ...team, kind: 'workflow' })).toBe(true);
    expect(rowLive(eng(false), team)).toBe(false);
    expect(rowLive(eng(false), { ...team, pending: 1 })).toBe(true);
    expect(rowLive(eng(false), { ...team, planReady: true })).toBe(true);
    expect(rowLive(eng(false, true), team)).toBe(true);
    expect(rowLive(eng(false), { ...team, status: 'paused', pending: 1 })).toBe(false);
    expect(rowLive(eng(false), { ...team, kind: 'workflow', pending: 1 })).toBe(false);
  });

  it('counts a running run live while it has had an event in the last 2 minutes (driven by another process)', () => {
    const eng = { isLive: () => false, isPlanning: () => false };
    const row = { id: 'w', kind: 'workflow' as const, status: 'running' as const, pending: 0, planReady: false };
    const now = 10_000_000;
    expect(RECENT_ACTIVITY_MS).toBe(120_000);
    expect(rowLive(eng, { ...row, lastTs: now - 30_000 }, now)).toBe(true);
    expect(rowLive(eng, { ...row, lastTs: now - 180_000 }, now)).toBe(false);
    expect(rowLive(eng, { ...row, status: 'paused', lastTs: now - 30_000 }, now)).toBe(false);
  });
});

describe('GET /api/runs', () => {
  let srv: Awaited<ReturnType<typeof startHttpTestServer>>;
  beforeAll(async () => {
    srv = await startHttpTestServer();
  });
  afterAll(() => srv.close());

  it('adds branch, lastTs, steps, current and bots and keeps the existing fields', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 180_000); // no event for 3 minutes: not live
    seedRun(srv.store, 'rx', { nodes: [{ id: 'code', role: 'coder', title: 'Implement' }] });
    srv.store.append('rx', { type: 'node.started', node: 'code', attempt: 1 });
    clock.mockRestore();
    const r = await srv.api('GET', '/api/runs');
    expect(r.status).toBe(200);
    const row = r.json.find((x: { id: string }) => x.id === 'rx');
    expect(row).toMatchObject({ id: 'rx', pipeline: 'flow', status: 'running', pending: 0, planReady: false, live: false, branch: 'aorch/rx', steps: [{ id: 'code', status: 'running', bot: 'coder' }], current: { node: 'code', bot: 'Bolt', title: 'Implement' }, bots: ['coder'] });
    expect(row.lastTs).toBe(srv.store.lastTs('rx'));
  });

  it('agrees with the run view on live: recent activity from another process counts, a quiet run does not', async () => {
    seedRun(srv.store, 'rl');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 180_000);
    seedRun(srv.store, 'rq');
    clock.mockRestore();
    const rows = (await srv.api('GET', '/api/runs')).json as { id: string; live: boolean }[];
    expect(rows.find((x) => x.id === 'rl')!.live).toBe(true);
    expect(rows.find((x) => x.id === 'rq')!.live).toBe(false);
    expect((await srv.api('GET', '/api/runs/rl')).json.live).toBe(true);
    expect((await srv.api('GET', '/api/runs/rq')).json.live).toBe(false);
  });

  it('carries no task text, prompts or outputs beyond the existing row fields', async () => {
    seedRun(srv.store, 'rp', { task: 'SECRET-TASK', nodes: [{ id: 'code', role: 'coder', title: 'Implement', prompt: 'SECRET-PROMPT' }] });
    srv.store.append('rp', { type: 'node.started', node: 'code', attempt: 1 });
    srv.store.append('rp', { type: 'node.finished', node: 'code', status: 'done', output: 'SECRET-OUTPUT', durationMs: 1, attempt: 1 });
    const r = await srv.api('GET', '/api/runs');
    const { task, ...rest } = r.json.find((x: { id: string }) => x.id === 'rp');
    expect(task).toBe('SECRET-TASK');
    expect(JSON.stringify(rest)).not.toMatch(/SECRET/);
  });

  it('runs a fixed number of store queries however many runs there are', async () => {
    const db = srv.store.raw() as unknown as { prepare: (sql: string) => unknown };
    const count = async () => {
      await srv.api('GET', '/api/runs'); // warm the fold cache
      const spy = vi.spyOn(db, 'prepare');
      try {
        await srv.api('GET', '/api/runs');
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    };
    seedRun(srv.store, 'q0');
    const few = await count();
    for (let i = 1; i <= 8; i++) seedRun(srv.store, `q${i}`);
    expect(await count()).toBe(few);
    expect(few).toBeLessThanOrEqual(2);
  });
});
