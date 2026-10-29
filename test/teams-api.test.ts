import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { link, loadBindings } from '../src/bindings.js';
import { Engine } from '../src/engine.js';
import type { Exec } from '../src/exec.js';
import { addTeamLessons } from '../src/lessons.js';
import { startServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { loadTeams, OWNER, saveTeams } from '../src/teams/store.js';
import type { TeamMessage, TeamView } from '../src/teams/types.js';
import { Vault } from '../src/vault.js';
import { initWorkspace } from '../src/workspace.js';
import { makeRepo, tmp } from './helpers.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function boot() {
  const home = tmp('home-');
  const dir = makeRepo();
  initWorkspace(home, dir, { id: 'app', name: 'App' });
  for (const b of ['coder', 'reviewer']) link(home, b, { agent: 'mock' });
  const registry = new AdapterRegistry().register(new MockAdapter());
  const store = Store.open(':memory:');
  const vault = new Vault(tmp('vault-'));
  const engine = new Engine(store, { home, registry, vault, bindings: () => loadBindings(home) });
  const exec: Exec = async () => ({ code: 1, stdout: '', stderr: 'no gh here' });
  const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, exec });
  closers.push(s.close);
  const u = new URL(s.url);
  const call = (method: string, path: string, body?: unknown) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : undefined }));
      });
      req.on('error', reject);
      req.end(data);
    });
  const until = async <T>(f: () => Promise<T | undefined | false>): Promise<T> => {
    for (let i = 0; i < 200; i++) {
      const v = await f();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timed out');
  };
  const team = (await call('POST', '/api/teams', { name: 'Core', place: 'tether', project: 'app', agents: ['coder', 'reviewer'] })).json;
  const view = async () => (await call('GET', `/api/teams/${team.id}`)).json as TeamView;
  return { home, store, engine, call, until, team, view };
}

describe('/api/teams', () => {
  it('creates a Tether team (Slack waits for its phase), lists, edits and deletes it', async () => {
    const t = await boot();
    expect(t.team).toMatchObject({ name: 'Core', place: 'tether', level: 'balanced', approvers: 'any', people: [OWNER] });
    expect((await t.call('POST', '/api/teams', { name: 'S', place: 'slack', project: 'app', agents: ['coder'] })).json.error).toMatch(/later phase/);
    expect((await t.call('GET', '/api/teams')).json.teams).toEqual([{ id: t.team.id, name: 'Core', place: 'tether', project: 'app', agents: ['coder', 'reviewer'], status: 'idle' }]);
    expect(await t.view()).toMatchObject({ messages: [], members: [{ id: 'coder', name: 'Bolt', specialty: 'coder', state: 'idle' }, { id: 'reviewer', name: 'Lens', state: 'idle' }], spend: { usd: 0, runs: 0 } });
    expect((await t.call('PATCH', `/api/teams/${t.team.id}`, { level: 'loose', limits: { usdPerDay: 3, runsPerDay: 5 } })).json).toMatchObject({ level: 'loose', limits: { usdPerDay: 3, runsPerDay: 5 } });
    expect((await t.call('DELETE', `/api/teams/${t.team.id}`)).status).toBe(200);
    expect((await t.call('GET', `/api/teams/${t.team.id}`)).status).toBe(404);
  });

  it('a message pings an agent; a task’s ship card is decided through the API; the run page obeys the approver rule', async () => {
    const t = await boot();
    expect((await t.call('POST', `/api/teams/${t.team.id}/messages`, { text: '@Lens hi there' })).status).toBe(201);
    await t.until(async () => (await t.view()).messages.find((m) => m.from.kind === 'agent' && !m.pending));
    expect((await t.call('POST', `/api/teams/${t.team.id}/messages`, {})).status).toBe(400);
    await t.call('POST', `/api/teams/${t.team.id}/messages`, { text: '@Bolt fix the typo' });
    const card = await t.until(async () => (await t.view()).messages.find((m): m is TeamMessage => m.card?.kind === 'approval'));
    const runId = (card.card as { runId: string }).runId;
    expect((await t.call('GET', `/api/teams/${t.team.id}/diff/${card.id}`)).json).toEqual({ diff: '', truncated: false });
    // only Maya may approve now: the run page refuses the owner
    const f = loadTeams(t.home);
    saveTeams(t.home, { ...f, teams: f.teams.map((x) => ({ ...x, people: [OWNER, { id: 'maya', name: 'Maya' }], approvers: ['maya'] })) });
    expect((await t.call('POST', `/api/runs/${runId}/approve`, { node: 'ship' })).status).toBe(403);
    expect((await t.call('POST', `/api/teams/${t.team.id}/cards/${card.id}`, { action: 'approve' })).json.error).toMatch(/Only Maya can approve here/);
    saveTeams(t.home, f);
    const done = await t.call('POST', `/api/teams/${t.team.id}/cards/${card.id}`, { action: 'approve' });
    expect(done.json.card).toMatchObject({ status: 'approved', by: 'you' });
    expect((await t.call('POST', `/api/teams/${t.team.id}/cards/${card.id}`, { action: 'approve' })).status).toBe(409);
    await t.until(async () => (await t.view()).messages.some((m) => m.text === 'Nothing to ship: the run changed no files.'));
  });
});

describe('/api/agents/:bot', () => {
  it('shows and edits the profile, lists memory with its team, and forgets one lesson or all', async () => {
    const t = await boot();
    const a = (await t.call('GET', '/api/agents/coder')).json;
    expect(a).toMatchObject({ bot: 'coder', profile: {}, lessons: [], teams: [{ id: t.team.id, name: 'Core', place: 'tether', state: 'idle' }], recent: [] });
    expect((await t.call('PUT', '/api/agents/coder', { specialty: 'code', personality: 'Direct and brief.' })).json.profile).toEqual({ specialty: 'code', personality: 'Direct and brief.' });
    expect((await t.view()).members[0]).toMatchObject({ specialty: 'code' });
    addTeamLessons(t.home, 'coder', t.team.id, 'r1', ['Rerun failing files alone', 'Commits are plain conventional messages']);
    const lessons = (await t.call('GET', '/api/agents/coder')).json.lessons;
    expect(lessons).toHaveLength(2);
    expect(lessons[0]).toMatchObject({ team: t.team.id, teamName: 'Core', at: expect.any(String) });
    expect((await t.call('DELETE', `/api/agents/coder/lessons/${lessons[0].id}`)).json.lessons).toHaveLength(1);
    expect((await t.call('DELETE', '/api/agents/coder/lessons/coder-nope')).status).toBe(404);
    expect((await t.call('DELETE', '/api/agents/coder/lessons')).json.lessons).toEqual([]);
    expect((await t.call('GET', '/api/agents/approval')).status).toBe(404);
    expect((await t.call('PUT', '/api/agents/coder', { specialty: 'x'.repeat(30) })).status).toBe(400);
  });
});
