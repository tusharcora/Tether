import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentRequest, AgentResult } from '../src/types.js';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { link } from '../src/bindings.js';
import { writePipeline } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { Goals, judge, parseCounts, type GoalHooks } from '../src/goals/loop.js';
import { ensureGoals, GoalStore } from '../src/goals/store.js';
import type { Goal } from '../src/goals/types.js';
import { startServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { Vault } from '../src/vault.js';
import { initWorkspace } from '../src/workspace.js';
import { makeRepo, pipe, tmp } from './helpers.js';

/** The default crew agent, scripted: it proposes one run and costs nothing. */
class Planner implements AgentAdapter {
  readonly id = 'planner';
  readonly reportsCost = true;
  readonly supportsResume = false;
  prompts: string[] = [];
  async detect() {
    return { ok: true, version: 'fake' };
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    this.prompts.push(req.prompt);
    return { output: 'Add the file.\n```tether\n{"proposals":[{"kind":"team","task":"create done.txt","why":"the check wants it"}]}\n```', exitCode: 0, costUsd: 0 };
  }
}

function rig(mock: Record<string, unknown> = { writeFile: { path: 'done.txt', content: 'ok\n' } }, hooks?: GoalHooks) {
  const home = tmp('home-');
  const repo = makeRepo();
  const ws = initWorkspace(home, repo).workspace;
  const planner = new Planner();
  const registry = new AdapterRegistry().register(new MockAdapter()).register(planner);
  link(home, 'orchestrator', { agent: 'planner' });
  const store = Store.open(':memory:');
  const engine = new Engine(store, { home, registry });
  writePipeline(home, pipe([{ id: 'code', role: 'coder', mock }], []));
  const goals = new Goals({ home, store, engine, registry, hooks });
  const goal = (o: Partial<Goal> = {}): Goal => ({ id: `g${Math.random().toString(36).slice(2, 8)}`, workspace: ws.id, title: 'Add done.txt', kind: 'loop', status: 'active', check: { kind: 'command', command: 'test -f done.txt' }, budgetUsd: 5, maxRuns: 3, approval: 'ask', workflow: 'test', createdAt: Date.now(), spentUsd: 0, ...o });
  return { home, store, goals, goal, planner, ws, engine, repo };
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 300 && !f(); i++) await new Promise((r) => setTimeout(r, 50));
  expect(f()).toBe(true);
};

describe('goals store', () => {
  it('migrates an older database without losing anything, and twice is harmless', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE events (run_id TEXT, seq INTEGER)');
    db.exec("INSERT INTO events VALUES ('r1', 1)");
    const s = new GoalStore(db as never);
    s.insert({ id: 'g1', workspace: 'w', title: 'T', kind: 'tracker', status: 'active', budgetUsd: 5, maxRuns: 3, approval: 'ask', workflow: 'team', createdAt: 1, spentUsd: 0 });
    s.addItem({ goalId: 'g1', kind: 'manual', text: 'one' });
    ensureGoals(db as never);
    expect(s.get('g1')?.title).toBe('T');
    expect(s.items('g1').map((i) => i.text)).toEqual(['one']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 1 });
  });

  it('adds the team and agent columns to a goals table made before teams', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE goals (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, check_json TEXT, budget_usd REAL NOT NULL,
      max_runs INTEGER NOT NULL, approval TEXT NOT NULL, workflow TEXT NOT NULL, due_date TEXT, created_at INTEGER NOT NULL, spent_usd REAL NOT NULL DEFAULT 0, reason TEXT, last_check TEXT, pending TEXT)`);
    db.exec("INSERT INTO goals (id, workspace, title, kind, status, budget_usd, max_runs, approval, workflow, created_at) VALUES ('old', 'w', 'Old', 'tracker', 'active', 5, 3, 'ask', 'team', 1)");
    const s = new GoalStore(db as never);
    expect(s.get('old')).not.toHaveProperty('team');
    s.insert({ id: 'g2', workspace: 'w', title: 'T', kind: 'loop', status: 'active', budgetUsd: 5, maxRuns: 3, approval: 'auto', workflow: 'team', createdAt: 2, spentUsd: 0, team: 'core', agent: 'coder' });
    expect(s.get('g2')).toMatchObject({ team: 'core', agent: 'coder' });
    ensureGoals(db as never);
  });
});

describe('a goal owned by a team agent', () => {
  it('starts its runs through the team hook and pauses when the team is blocked', async () => {
    let blocked: string | undefined;
    const started: string[] = [];
    const r = rig(
      {},
      {
        blocked: () => blocked,
        start: async (g, plan) => {
          started.push(plan.task);
          if (started.length === 2) blocked = "Today's limit is reached";
          return r.engine.start({ pipeline: pipe([{ id: 'code', role: 'coder' }], []), task: plan.task, repo: r.repo });
        },
      },
    );
    // the agent proposes on its own binding, not Tether's
    link(r.home, 'coder', { agent: 'planner' });
    link(r.home, 'orchestrator', { agent: 'nope' });
    const g = r.goals.create(r.goal({ approval: 'auto', maxRuns: 5, team: 'core', agent: 'coder' }));
    await until(() => r.goals.db.must(g.id).status === 'paused');
    expect(r.goals.db.must(g.id).reason).toBe("Today's limit is reached");
    expect(started).toEqual(['create done.txt', 'create done.txt']);
    expect(r.goals.db.items(g.id)).toHaveLength(2);
  });
});

describe('the finish check', () => {
  it('reads counts from test output and judges a number against its target', () => {
    expect(parseCounts('Tests  1 failed | 11 passed (12)')).toMatchObject({ failing: 1, passing: 11, summary: '1 failing · 11 passing' });
    expect(parseCounts('nothing here')).toEqual({});
    const n = { kind: 'number' as const, command: 'x', target: '<=5' };
    expect(judge(n, 0, 'total 4\n')).toEqual({ ok: true, value: 4 });
    expect(judge(n, 0, 'total 9\n').ok).toBe(false);
    expect(judge({ kind: 'command', command: 'x' }, 1, '').ok).toBe(false);
  });
});

describe('the loop', () => {
  it('on ask: the check fails, Tether proposes, nothing starts until Start, then re-checks and is met', async () => {
    const r = rig();
    const g = r.goals.create(r.goal());
    await r.goals.idle();
    const waiting = r.goals.db.must(g.id);
    expect(waiting.status).toBe('needs_you');
    expect(waiting.pending).toMatchObject({ task: 'create done.txt' });
    expect(waiting.lastCheck?.ok).toBe(false);
    expect(r.store.listRows()).toHaveLength(0); // ask: no run without the call
    await expect(r.goals.next(g.id, 'start')).resolves.toMatchObject({ status: 'active' });
    await expect(r.goals.next(g.id, 'start')).rejects.toThrow(/no run is waiting/); // decided once
    await until(() => r.goals.db.must(g.id).status === 'met');
    const [item] = r.goals.db.items(g.id);
    expect(item?.attempt?.before?.ok).toBe(false);
    expect(item?.attempt?.after?.ok).toBe(true);
    expect(item?.done).toBe(true);
  });

  it('skip asks for another proposal', async () => {
    const r = rig();
    const g = r.goals.create(r.goal());
    await r.goals.idle();
    await r.goals.next(g.id, 'skip');
    await r.goals.idle();
    expect(r.goals.db.must(g.id).status).toBe('needs_you');
    expect(r.planner.prompts).toHaveLength(2);
    expect(r.store.listRows()).toHaveLength(0);
  });

  it('on auto: runs start by themselves, and the run cap stops the goal', async () => {
    const r = rig({});
    const g = r.goals.create(r.goal({ approval: 'auto', maxRuns: 2 }));
    await until(() => r.goals.db.must(g.id).status === 'stopped');
    expect(r.goals.db.must(g.id).reason).toMatch(/Run cap reached \(2 of 2\)/);
    expect(r.store.listRows()).toHaveLength(2);
  });

  it('the budget caps spend, counting the runs', async () => {
    const r = rig({ costUsd: 0.05 });
    const g = r.goals.create(r.goal({ approval: 'auto', budgetUsd: 0.04, maxRuns: 5 }));
    await until(() => r.goals.db.must(g.id).status === 'stopped');
    const done = r.goals.db.must(g.id);
    expect(done.reason).toMatch(/Budget reached/);
    expect(done.spentUsd).toBeCloseTo(0.05);
    expect(r.store.listRows()).toHaveLength(1);
  });

  it('pause drops the waiting proposal and starts nothing; resume checks again', async () => {
    const r = rig();
    const g = r.goals.create(r.goal());
    await r.goals.idle();
    expect(r.goals.setStatus(g.id, 'paused')).toMatchObject({ status: 'paused', pending: undefined });
    await r.goals.idle();
    expect(r.store.listRows()).toHaveLength(0);
    r.goals.setStatus(g.id, 'active');
    await r.goals.idle();
    expect(r.goals.db.must(g.id)).toMatchObject({ status: 'needs_you' });
    expect(r.goals.setStatus(g.id, 'stopped')).toMatchObject({ status: 'stopped', reason: 'Stopped by you' });
  });
});

describe('/api/goals', () => {
  it('validates, serves and streams goals', async () => {
    const r = rig();
    const vault = new Vault(tmp('vault-'));
    const registry = new AdapterRegistry().register(new MockAdapter());
    const s = await startServer({ engine: new Engine(r.store, { home: r.home, registry }), store: r.store, vault, registry, cfg: { home: r.home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    try {
      const u = new URL(s.url);
      const call = (method: string, path: string, body?: unknown) =>
        new Promise<{ status: number; json: any }>((resolve, reject) => {
          const q = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, 'content-type': 'application/json' } }, (res) => {
            let t = '';
            res.on('data', (d) => (t += d));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, json: t ? JSON.parse(t) : undefined }));
          });
          q.on('error', reject);
          q.end(body === undefined ? undefined : JSON.stringify(body));
        });
      expect((await call('POST', '/api/goals', { title: '' })).status).toBe(400);
      expect((await call('POST', '/api/goals', { title: 'x', workspace: 'nope' })).status).toBe(404);
      expect((await call('POST', '/api/goals', { title: 'x', workspace: r.ws.id, kind: 'loop' })).status).toBe(400);
      expect((await call('POST', '/api/goals', { title: 'x', workspace: r.ws.id, check: { kind: 'number', command: 'echo 1', target: 'soon' } })).status).toBe(400);
      expect((await call('POST', '/api/goals', { title: 'x', workspace: r.ws.id, budgetUsd: -1 })).status).toBe(400);
      const made = await call('POST', '/api/goals', { title: 'Ship docs', workspace: r.ws.id, dueDate: '2026-11-30' });
      expect(made.status).toBe(201);
      expect(made.json).toMatchObject({ kind: 'tracker', status: 'active', approval: 'ask', progress: 0 });
      const id = made.json.id as string;
      const item = await call('POST', `/api/goals/${id}/items`, { text: 'Write intro' });
      expect(item.status).toBe(201);
      expect((await call('PATCH', `/api/goals/${id}/items/${item.json.id}`, { done: true })).json.done).toBe(true);
      expect((await call('GET', `/api/goals/${id}`)).json.progress).toBe(1);
      expect((await call('POST', `/api/goals/${id}/next`, { action: 'start' })).status).toBe(409);
      expect((await call('PATCH', `/api/goals/${id}`, { status: 'paused' })).json.status).toBe('paused');
      expect((await call('GET', '/api/goals')).json).toHaveLength(1);
      expect((await call('DELETE', `/api/goals/${id}`)).status).toBe(200);
      expect((await call('GET', `/api/goals/${id}`)).status).toBe(404);
      // the stream opens with the list
      const first = await new Promise<string>((resolve) => {
        const q = request({ host: u.hostname, port: u.port, path: '/api/goals/stream', headers: { host: u.host } }, (res) => {
          res.once('data', (d) => (resolve(String(d)), q.destroy()));
        });
        q.end();
      });
      expect(first).toMatch(/^event: goals\ndata: \[\]/);
    } finally {
      await s.close();
    }
  });
});
