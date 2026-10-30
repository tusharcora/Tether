import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writePipeline } from '../src/config.js';
import { loadSchedules, nextAt, Scheduler, type Schedule } from '../src/schedules.js';
import { startServer } from '../src/server.js';
import { Vault } from '../src/vault.js';
import { initWorkspace } from '../src/workspace.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const HOUR = 3_600_000;
const seed = (home: string, list: Schedule[]) => writeFileSync(join(home, 'schedules.json'), JSON.stringify({ schedules: list }), { mode: 0o600 });
const sched = (o: Partial<Schedule> = {}): Schedule => ({ id: 's-00000001', name: 'Nightly', cron: '0 2 * * *', workspace: 'proj', target: { kind: 'workflow', workflow: 'test', task: 'tidy up' }, enabled: true, ...o });

describe('Scheduler', () => {
  it('starts what is due once, then moves the next fire past now', async () => {
    const home = tmp('home-');
    const now = Date.now();
    seed(home, [sched({ nextAt: new Date(now - 1000).toISOString() }), sched({ id: 's-00000002', nextAt: new Date(now + HOUR).toISOString() }), sched({ id: 's-00000003', enabled: false, nextAt: new Date(now - HOUR).toISOString() })]);
    const started: string[] = [];
    const s = new Scheduler(home, async (x) => (started.push(x.id), `run-${started.length}`));
    await s.tick(now);
    await s.tick(now);
    expect(started).toEqual(['s-00000001']);
    const [a] = loadSchedules(home);
    expect(a).toMatchObject({ lastRunId: 'run-1', lastRunAt: new Date(now).toISOString(), nextAt: nextAt('0 2 * * *', now) });
    expect(Date.parse(a!.nextAt!)).toBeGreaterThan(now);
    expect(statSync(join(home, 'schedules.json')).mode & 0o777).toBe(0o600);
  });

  it('runs a fire missed while the app was closed once, not once per missed day', async () => {
    const home = tmp('home-');
    const now = Date.now();
    seed(home, [sched({ cron: '0 * * * *', nextAt: new Date(now - 72 * HOUR).toISOString() })]);
    let n = 0;
    const s = new Scheduler(home, async () => `r${++n}`);
    s.begin();
    s.stop();
    await new Promise((r) => setTimeout(r, 50));
    await s.tick(now);
    expect(n).toBe(1);
  });

  it('records why a start failed, and clears it after a good run', async () => {
    const home = tmp('home-');
    seed(home, [sched({ nextAt: new Date(Date.now() - 1000).toISOString() })]);
    let fail = true;
    const s = new Scheduler(home, async () => {
      if (fail) throw new Error('workspace "proj" is missing\nmore');
      return 'r1';
    });
    await s.tick();
    expect(loadSchedules(home)[0]).toMatchObject({ lastError: 'workspace "proj" is missing' });
    fail = false;
    expect(await s.fire(loadSchedules(home)[0]!)).toMatchObject({ lastRunId: 'r1' });
    expect(loadSchedules(home)[0]!.lastError).toBeUndefined();
  });

  it('never fires the same schedule twice from overlapping ticks', async () => {
    const home = tmp('home-');
    seed(home, [sched({ nextAt: new Date(Date.now() - 1000).toISOString() })]);
    let n = 0;
    let release!: () => void;
    const s = new Scheduler(home, () => new Promise((r) => ((release = () => r(`r${++n}`)), undefined)));
    const first = s.tick();
    await s.tick();
    await new Promise((r) => setTimeout(r, 10));
    release();
    await first;
    expect(n).toBe(1);
  });
});

describe('/api/schedules', () => {
  let base = '';
  let home = '';
  let close: () => Promise<void>;
  let runs: () => number;
  beforeAll(async () => {
    const vault = new Vault(tmp('vault-'));
    const s0 = setup(vault);
    home = s0.home;
    initWorkspace(home, makeRepo(), { id: 'proj' });
    writePipeline(home, pipe([{ id: 'a', agent: 'mock' }], []));
    runs = () => s0.store.listRows().length;
    const s = await startServer({ engine: s0.engine, store: s0.store, vault, registry: s0.registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    base = s.url;
    close = s.close;
  });
  afterAll(() => close());

  const api = (method: string, path: string, body?: unknown) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const u = new URL(base);
      const req = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, 'content-type': 'application/json' } }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : undefined }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const good = { name: 'Nightly tidy', cron: '0  2 * * *', workspace: 'proj', target: { kind: 'workflow', workflow: 'test', task: 'tidy up' } };

  it.each<[string, Record<string, unknown>, RegExp]>([
    ['no name', { name: '' }, /"name" is required/],
    ['no cron', { cron: '' }, /"cron" is required/],
    ['a bad cron', { cron: '0 24 * * *' }, /hour field value 24 is outside 0-23/],
    ['a cron that never fires', { cron: '0 0 30 2 *' }, /never fires/],
    ['an unknown target kind', { target: { kind: 'shell' } }, /workflow or goal/],
    ['no task', { target: { kind: 'workflow', workflow: 'test', task: ' ' } }, /"target.task" is required/],
    ['a bad workflow name', { target: { kind: 'workflow', workflow: '../x', task: 't' } }, /workflow name/],
    ['an unknown workflow', { target: { kind: 'workflow', workflow: 'nope', task: 't' } }, /no workflow or skill called "nope"/],
    ['an unknown workspace', { workspace: 'ghost' }, /no workspace "ghost"/],
    ['no workspace', { workspace: undefined }, /"workspace" is required/],
    ['an unknown goal', { target: { kind: 'goal', goalId: 'g-nope' } }, /no goal "g-nope"/],
    ['a non-boolean enabled', { enabled: 'yes' }, /"enabled" must be true or false/],
  ])('refuses %s with a 400', async (_label, patch, why) => {
    const r = await api('POST', '/api/schedules', { ...good, ...patch });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(why);
  });

  it('creates, lists, switches off and on, edits, runs now and deletes', async () => {
    const c = await api('POST', '/api/schedules', good);
    expect(c.status).toBe(200);
    expect(c.json).toMatchObject({ name: 'Nightly tidy', cron: '0 2 * * *', workspace: 'proj', enabled: true, target: { kind: 'workflow', workflow: 'test', task: 'tidy up' } });
    expect(c.json.id).toMatch(/^s-[0-9a-f]{8}$/);
    expect(Date.parse(c.json.nextAt)).toBeGreaterThan(Date.now());
    expect(new Date(c.json.nextAt).getHours()).toBe(2);
    expect(statSync(join(home, 'schedules.json')).mode & 0o777).toBe(0o600);
    const id = c.json.id as string;
    expect((await api('GET', '/api/schedules')).json).toEqual([c.json]);

    const off = await api('PATCH', `/api/schedules/${id}`, { enabled: false });
    expect(off.json.enabled).toBe(false);
    expect(off.json.nextAt).toBeUndefined();
    const on = await api('PATCH', `/api/schedules/${id}`, { enabled: true, name: 'Hourly', cron: '0 * * * *' });
    expect(on.json).toMatchObject({ enabled: true, name: 'Hourly', cron: '0 * * * *' });
    expect(Date.parse(on.json.nextAt) - Date.now()).toBeLessThanOrEqual(HOUR);
    expect((await api('PATCH', `/api/schedules/${id}`, { cron: 'nope' })).status).toBe(400);

    const before = runs();
    const ran = await api('POST', `/api/schedules/${id}/run`);
    expect(ran.status).toBe(200);
    expect(ran.json.lastRunId).toBeTruthy();
    expect(ran.json.lastError).toBeUndefined();
    expect(runs()).toBe(before + 1);

    expect((await api('DELETE', `/api/schedules/${id}`)).json).toEqual({ ok: true });
    expect((await api('GET', '/api/schedules')).json).toEqual([]);
  });

  it('gives a goal its turn, with no run id of its own', async () => {
    const g = await api('POST', '/api/goals', { title: 'Green tests', workspace: 'proj', check: { kind: 'command', command: 'true' } });
    expect(g.status).toBe(201);
    const c = await api('POST', '/api/schedules', { name: 'Goal nightly', cron: '0 3 * * *', target: { kind: 'goal', goalId: g.json.id } });
    expect(c.json).toMatchObject({ target: { kind: 'goal', goalId: g.json.id } });
    expect(c.json.workspace).toBeUndefined();
    const ran = await api('POST', `/api/schedules/${c.json.id}/run`);
    // the goal's check passed at once, so it is met and a scheduled turn says why it cannot go on
    expect(ran.json.lastRunId).toBeUndefined();
    expect(typeof ran.json.lastRunAt).toBe('string');
    await api('DELETE', `/api/schedules/${c.json.id}`);
  });

  it('checks ids: 400 for a malformed one, 404 for an unknown one', async () => {
    expect((await api('PATCH', '/api/schedules/..%2F..', { enabled: true })).status).toBe(400);
    expect((await api('DELETE', '/api/schedules/s-ffffffff')).status).toBe(404);
    expect((await api('POST', '/api/schedules/s-ffffffff/run')).status).toBe(404);
    expect(readFileSync(join(home, 'schedules.json'), 'utf8')).not.toContain('ffffffff');
  });
});
