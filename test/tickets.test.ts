import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { saveChat } from '../src/assistant/history.js';
import { Engine } from '../src/engine.js';
import { Goals } from '../src/goals/loop.js';
import { GoalStore, migrateTickets } from '../src/goals/store.js';
import { criteriaOf, keyOf, nextStage, prefixFrom, stageOfStatus, type TicketEvent } from '../src/goals/tickets.js';
import type { Goal, GoalStatus, Stage } from '../src/goals/types.js';
import { aliasPath, startServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { Vault } from '../src/vault.js';
import { initWorkspace } from '../src/workspace.js';
import { makeRepo, tmp } from './helpers.js';

/** The goals table as it was before tickets (2026-10-29): every column up to `origin`. */
function oldDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE goals (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, check_json TEXT, budget_usd REAL NOT NULL, max_runs INTEGER NOT NULL,
    approval TEXT NOT NULL, workflow TEXT NOT NULL, due_date TEXT, created_at INTEGER NOT NULL, spent_usd REAL NOT NULL DEFAULT 0, reason TEXT, last_check TEXT, pending TEXT,
    team TEXT, agent TEXT, type TEXT, description TEXT, assignees TEXT, ended_at INTEGER, max_minutes INTEGER, started_at INTEGER, origin TEXT);
    CREATE TABLE goal_items (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, run_id TEXT, done INTEGER NOT NULL DEFAULT 0, attempt TEXT, at INTEGER NOT NULL, assignees TEXT);`);
  const add = db.prepare('INSERT INTO goals(id, workspace, title, kind, status, check_json, budget_usd, max_runs, approval, workflow, created_at, spent_usd, reason, team, agent, type, description, assignees, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const row = (id: string, ws: string, status: GoalStatus, at: number, o: { started?: number; agent?: string; team?: string; assignees?: unknown; check?: string; ended?: number } = {}) =>
    add.run(id, ws, `Goal ${id}`, o.check ? 'loop' : 'tracker', status, o.check ? JSON.stringify({ kind: 'command', command: o.check }) : null, 5, 3, 'ask', 'team', at, 1.25, status === 'stopped' ? 'Stopped by you' : null, o.team ?? null, o.agent ?? null, 'bugfix', 'Why it matters', o.assignees ? JSON.stringify(o.assignees) : null, o.started ?? null, o.ended ?? null);
  // created out of id order on purpose: numbers follow creation time
  row('g-todo', 'web', 'paused', 30);
  row('g-backlog', 'web', 'paused', 10, { started: 11 });
  row('g-live', 'web', 'active', 20, { started: 21, agent: 'tester', team: 'core-1', check: 'npm test' });
  row('g-needs', 'api', 'needs_you', 5, { started: 6, assignees: [{ kind: 'agent', id: 'coder' }, { kind: 'agent', id: 'reviewer' }, { kind: 'team', id: 'core-1' }] });
  row('g-met', 'web', 'met', 40, { started: 41, ended: 50 });
  row('g-stopped', 'api', 'stopped', 15, { started: 16, ended: 17 });
  db.prepare("INSERT INTO goal_items(goal_id, kind, text, run_id, done, at) VALUES ('g-live', 'manual', 'Docs updated', NULL, 1, 1), ('g-live', 'run', 'fix it', 'r1', 0, 2)").run();
  return db;
}

describe('goals become tickets (spec §2.6)', () => {
  it('numbers each project in creation order, maps every status, keeps everything else, and twice changes nothing', () => {
    const db = oldDb();
    const before = db.prepare('SELECT * FROM goals ORDER BY id').all();
    const items = db.prepare('SELECT * FROM goal_items ORDER BY id').all();
    const s = new GoalStore(db as never);
    const t = (id: string) => s.must(id);
    expect(['g-backlog', 'g-live', 'g-todo', 'g-met'].map((id) => t(id).num)).toEqual([1, 2, 3, 4]);
    expect(['g-needs', 'g-stopped'].map((id) => t(id).num)).toEqual([1, 2]);
    const stages: Record<string, Stage> = { 'g-todo': 'todo', 'g-backlog': 'backlog', 'g-live': 'in_progress', 'g-needs': 'in_review', 'g-met': 'done', 'g-stopped': 'canceled' };
    for (const [id, st] of Object.entries(stages)) expect(t(id).stage, id).toBe(st);
    // assignees: the loop's agent first, then the agents in order; a team assignee is the squad
    expect(t('g-live')).toMatchObject({ assignee: { kind: 'agent', id: 'tester' }, squad: 'core-1' });
    expect(t('g-needs')).toMatchObject({ assignee: { kind: 'agent', id: 'coder' }, reviewer: { kind: 'agent', id: 'reviewer' }, squad: 'core-1' });
    expect(t('g-todo').assignee).toBeUndefined();
    // nothing else changed: the old columns and every item are as they were
    const cols = Object.keys(before[0] as object);
    const after = db.prepare(`SELECT ${cols.join(', ')} FROM goals ORDER BY id`).all();
    expect(after).toEqual(before);
    expect(db.prepare('SELECT * FROM goal_items ORDER BY id').all()).toEqual(items);
    // the check is the auto-checked criterion; manual items are the others
    expect(criteriaOf(t('g-live'), s.items('g-live'))).toEqual([{ id: 'check', text: 'npm test passes', done: false, auto: true }, { id: 'i1', text: 'Docs updated', done: true, item: 1 }]);
    // twice: harmless
    const snap = db.prepare('SELECT * FROM goals ORDER BY id').all();
    expect(migrateTickets(db as never)).toBe(0);
    new GoalStore(db as never);
    expect(db.prepare('SELECT * FROM goals ORDER BY id').all()).toEqual(snap);
  });

  it('a new ticket takes the next number, and a removed one is never reused', () => {
    const s = new GoalStore(oldDb() as never);
    const g = (id: string): Goal => ({ id, workspace: 'web', title: id, kind: 'tracker', status: 'paused', approval: 'ask', workflow: 'team', createdAt: 100, spentUsd: 0 });
    expect(s.insert(g('n1')).num).toBe(5);
    s.remove('n1');
    expect(s.insert(g('n2'))).toMatchObject({ num: 6, stage: 'todo' });
    expect(s.insert({ ...g('n3'), workspace: 'new' }).num).toBe(1);
  });
});

describe('ticket status (spec §2.5 Flow)', () => {
  const step = (cur: Stage, ev: TicketEvent, openPr = false) => nextStage(cur, ev, { openPr });
  it('moves on its work: start, ask, send back, PR, merge, finish', () => {
    expect(step('todo', { kind: 'started' })).toBe('in_progress');
    expect(step('in_progress', { kind: 'asked', what: 'ship' })).toBe('in_review');
    expect(step('in_progress', { kind: 'asked', what: 'plan' })).toBe('in_progress');
    expect(step('in_review', { kind: 'answered', approved: false })).toBe('in_progress');
    expect(step('in_review', { kind: 'answered', approved: true })).toBe('in_review');
    expect(step('in_progress', { kind: 'pr', merged: false })).toBe('in_review');
    expect(step('in_review', { kind: 'pr', merged: true })).toBe('done');
    expect(step('in_progress', { kind: 'finished' })).toBe('done');
    expect(step('in_progress', { kind: 'finished' }, true)).toBe('in_review');
    expect(step('backlog', { kind: 'finished' })).toBe('backlog');
  });
  it('a loop maps as the migration does; met with a PR open is In review', () => {
    expect(stageOfStatus('paused', false)).toBe('todo');
    expect(step('in_progress', { kind: 'loop', status: 'paused', started: true })).toBe('backlog');
    expect(step('todo', { kind: 'loop', status: 'active', started: true })).toBe('in_progress');
    expect(step('in_progress', { kind: 'loop', status: 'needs_you', started: true })).toBe('in_review');
    expect(step('in_progress', { kind: 'loop', status: 'met', started: true })).toBe('done');
    expect(step('in_progress', { kind: 'loop', status: 'met', started: true }, true)).toBe('in_review');
    expect(step('in_progress', { kind: 'loop', status: 'stopped', started: true })).toBe('canceled');
  });
  it('keys come from the project name, editable', () => {
    expect(prefixFrom('acme-web')).toBe('WEB');
    expect(prefixFrom('orchestrator')).toBe('ORCH');
    expect(prefixFrom('my app 2')).toBe('APP');
    expect(prefixFrom('---')).toBe('T');
    expect(keyOf('WEB', 142)).toBe('WEB-142');
  });
});

function rig() {
  const home = tmp('home-');
  const repo = makeRepo();
  const ws = initWorkspace(home, repo, { id: 'web', name: 'acme-web' }).workspace;
  const registry = new AdapterRegistry().register(new MockAdapter());
  const store = Store.open(':memory:');
  const engine = new Engine(store, { home, registry });
  const goals = new Goals({ home, store, engine, registry });
  return { home, ws, store, engine, goals, registry };
}

describe('the ticket service', () => {
  it('follows its loop, stamps when it ended, and a person’s move stops, pauses or ends the loop', async () => {
    const r = rig();
    const g = r.goals.create({ id: 'g1', workspace: r.ws.id, title: 'Keep main green', kind: 'loop', status: 'paused', check: { kind: 'command', command: 'false' }, approval: 'ask', workflow: 'team', createdAt: Date.now(), spentUsd: 0 });
    expect(g).toMatchObject({ num: 1, stage: 'todo' });
    expect(r.goals.key('g1')).toBe('WEB-1');
    const you = { kind: 'person' as const, id: 'owner', name: 'You' };
    expect(r.goals.setStage('g1', 'backlog', you)).toMatchObject({ stage: 'backlog', status: 'paused' });
    expect(r.goals.setStage('g1', 'canceled', you)).toMatchObject({ stage: 'canceled', status: 'stopped', reason: 'Canceled by You', endedAt: expect.any(Number) });
    expect(r.goals.db.must('g1').activity!.map((a) => a.text)).toEqual(['moved it to Backlog', 'moved it to Canceled']);
    // moved back by a person: it is open again, waiting for its Start
    const back = r.goals.setStage('g1', 'todo', you);
    expect(back).toMatchObject({ stage: 'todo', status: 'paused' });
    expect(back.endedAt).toBeUndefined();
    await r.goals.idle();
  });

  it('a ticket’s PR moves it to In review, its merge to Done; the activity says so', () => {
    const r = rig();
    r.goals.create({ id: 'g2', workspace: r.ws.id, title: 'Fix sign-in', kind: 'tracker', status: 'active', approval: 'ask', workflow: 'team', createdAt: Date.now(), spentUsd: 0, stage: 'in_progress' });
    r.store.append('r9', { type: 'run.started', pipeline: { name: 'p', version: 1, mode: 'pipeline', nodes: [], edges: [], settings: { parallel: 1 } }, task: 't', repo: '/x', workdir: '/x', baseSha: 'a', branch: 'b' } as never);
    r.goals.addItem('g2', { text: 'fix it', runId: 'r9' });
    r.store.append('r9', { type: 'run.shipped', url: 'https://github.com/o/r/pull/3', number: 3 });
    expect(r.goals.db.must('g2')).toMatchObject({ stage: 'in_review', prs: [{ number: 3, url: 'https://github.com/o/r/pull/3', runId: 'r9' }] });
    r.store.append('r9', { type: 'run.shipped', merged: true });
    const g = r.goals.db.must('g2');
    expect(g).toMatchObject({ stage: 'done', prs: [{ number: 3, merged: true }], endedAt: expect.any(Number) });
    expect(g.activity!.map((a) => a.text)).toEqual(['opened PR #3', 'PR #3 merged']);
    r.goals.dropPr('g2', 3, { kind: 'person', id: 'owner', name: 'You' });
    expect(r.goals.db.must('g2')).toMatchObject({ stage: 'in_review' });
    expect(r.goals.db.must('g2').prs).toBeUndefined();
  });
});

async function serve(r: ReturnType<typeof rig>) {
  const vault = new Vault(tmp('vault-'));
  const s = await startServer({ engine: r.engine, store: r.store, vault, registry: r.registry, cfg: { home: r.home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
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
  return { s, call };
}

describe('/api/tickets (and /api/goals, its alias)', () => {
  it('maps the old names onto the new ones', () => {
    expect(aliasPath('/api/goals')).toBe('/api/tickets');
    expect(aliasPath('/api/goals/g1/items/2')).toBe('/api/tickets/g1/items/2');
    expect(aliasPath('/api/teams/core/messages')).toBe('/api/squads/core/messages');
    expect(aliasPath('/api/goalsx')).toBe('/api/goalsx');
    expect(aliasPath('/api/teamsters')).toBe('/api/teamsters');
  });

  it('makes a ticket with its fields, edits its status and key prefix, takes comments; the alias answers the same', async () => {
    const r = rig();
    const { s, call } = await serve(r);
    try {
      const made = await call('POST', '/api/tickets', { title: 'Sign-in returns people to where they were', workspace: r.ws.id, type: 'bugfix', stage: 'todo', priority: 'high', assignee: { kind: 'agent', id: 'coder' }, reviewer: { kind: 'agent', id: 'reviewer' }, labels: ['Auth', 'auth'], criteria: ['After sign-in, people land on ?next='], description: 'Keep ?next= and follow same-site paths only.' });
      expect(made.status).toBe(201);
      const t = made.json;
      expect(t).toMatchObject({ key: 'WEB-1', stage: 'todo', status: 'paused', priority: 'high', assignee: { kind: 'agent', id: 'coder' }, labels: ['auth'], criteria: [{ text: 'After sign-in, people land on ?next=', done: false }] });
      expect(t.activity.map((a: { text: string }) => a.text)).toEqual(['created this']);
      expect((await call('POST', '/api/tickets', { title: 'x', workspace: r.ws.id, priority: 'soon' })).status).toBe(400);
      expect((await call('POST', '/api/tickets', { title: 'x', workspace: r.ws.id, assignee: { kind: 'bot', id: 'x' } })).status).toBe(400);
      const patched = (await call('PATCH', `/api/tickets/${t.id}`, { stage: 'backlog', priority: 'urgent', reviewer: null })).json;
    expect(patched).toMatchObject({ stage: 'backlog', priority: 'urgent' });
    expect(patched.reviewer).toBeUndefined();
      expect((await call('PATCH', `/api/tickets/${t.id}`, { stage: 'later' })).status).toBe(400);
      expect((await call('PUT', '/api/tickets/prefix', { workspace: r.ws.id, prefix: 'acme' })).json).toEqual({ workspace: r.ws.id, prefix: 'ACME' });
      expect((await call('PUT', '/api/tickets/prefix', { workspace: r.ws.id, prefix: '1x' })).status).toBe(400);
      expect((await call('GET', `/api/tickets/${t.id}`)).json.key).toBe('ACME-1');
      // a comment without an @agent is a comment
      const c = await call('POST', `/api/tickets/${t.id}/comments`, { text: 'Remember the mobile view.' });
      expect(c.json.activity.at(-1)).toMatchObject({ who: { name: 'You' }, text: 'Remember the mobile view.' });
      // the old name, for one release
      expect((await call('GET', '/api/goals')).json).toEqual((await call('GET', '/api/tickets')).json);
      expect((await call('GET', `/api/goals/${t.id}`)).json.key).toBe('ACME-1');
      // an @agent who is in no squad: said plainly, not dropped
      const hand = await call('POST', `/api/tickets/${t.id}/comments`, { text: '@Bolt take this one' });
      expect(hand.status).toBe(409);
      expect(hand.json.error).toMatch(/Bolt isn't in a squad for this project yet/);
      expect((await call('POST', `/api/tickets/${t.id}/ship`)).json.error).toMatch(/no run yet/);
    } finally {
      await s.close();
    }
  });
});

describe('ideas from your chats (board 10, Backlog)', () => {
  it('lists asks a chat answered "no goal" for, and "+" makes each a Backlog ticket once', async () => {
    const r = rig();
    const draft = { title: 'Add a loading state to search', type: 'feature', agents: [], workflow: 'team', approval: 'ask' };
    const prop = (id: string, status: string, goalId?: string) => ({ id, kind: 'goal', task: 'add a loading state', status, draft, ...(goalId ? { goalId } : {}) });
    saveChat(r.home, r.ws.id, { id: 'c1', title: 'Search', created: 1, updated: 2, once: [], messages: [{ id: 'm1', role: 'tether', text: 'Made it a ticket.', at: 5, proposals: [prop('p1', 'dismissed', 'ggone'), prop('p2', 'proposed'), prop('p3', 'started', 'gx')] }] } as never);
    const { s, call } = await serve(r);
    try {
      expect((await call('GET', `/api/tickets/ideas?ws=${r.ws.id}`)).json).toEqual([{ chat: 'c1', proposal: 'p1', title: 'Add a loading state to search', type: 'feature', at: 5 }]);
      const made = await call('POST', '/api/tickets/ideas', { workspace: r.ws.id, chat: 'c1', proposal: 'p1' });
      expect(made.status).toBe(201);
      expect(made.json).toMatchObject({ title: 'Add a loading state to search', stage: 'backlog', status: 'paused', origin: { kind: 'chat', chat: 'c1', message: 'm1' } });
      expect((await call('GET', `/api/tickets/ideas?ws=${r.ws.id}`)).json).toEqual([]);
      expect((await call('POST', '/api/tickets/ideas', { workspace: r.ws.id, chat: 'c1', proposal: 'p1' })).status).toBe(404);
    } finally {
      await s.close();
    }
  });
});
