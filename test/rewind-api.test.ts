import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { GoalStore } from '../src/goals/store.js';
import { startServer } from '../src/server.js';
import { Vault } from '../src/vault.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const flow = () =>
  pipe(
    [
      { id: 'a', role: 'coder', mock: { writeFile: { path: 'a.txt', content: 'a\n' } } },
      { id: 'ok', kind: 'approval', title: 'You approve' },
    ],
    [['a', 'ok']],
  );

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

/** A server over a run paused at its approval. `goal`: the run is the only run of a goal capped at one run. */
async function rig(o: { goal?: boolean } = {}) {
  const s = setup();
  const repo = makeRepo();
  const id = await s.engine.start({ pipeline: flow(), task: 'add a', repo, ...(o.goal ? { origin: { kind: 'goal' as const, id: 'g1' } } : {}) });
  await s.engine.wait(id);
  if (o.goal) {
    const db = new GoalStore(s.store.raw());
    db.insert({ id: 'g1', workspace: 'w', title: 'Add a', kind: 'tracker', status: 'active', maxRuns: 1, approval: 'ask', workflow: 'test', createdAt: Date.now(), spentUsd: 0 });
    db.addItem({ goalId: 'g1', kind: 'run', text: 'add a', runId: id });
  }
  const vault = new Vault(tmp('vault-'));
  const srv = await startServer({ engine: s.engine, store: s.store, vault, registry: s.registry, cfg: { home: s.home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
  closers.push(srv.close);
  const u = new URL(srv.url);
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const q = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, 'content-type': 'application/json', ...headers } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : undefined }));
      });
      q.on('error', reject);
      q.end(body === undefined ? undefined : JSON.stringify(body));
    });
  /** The run's stream: `proc` messages until `until` says stop. */
  const procs = (runId: string, until: (m: any) => boolean) =>
    new Promise<any[]>((resolve, reject) => {
      const got: any[] = [];
      const q = request({ host: u.hostname, port: u.port, path: `/api/runs/${runId}/stream`, headers: { host: u.host } }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          buf += c;
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (!frame.startsWith('event: proc')) continue;
            const m = JSON.parse(frame.split('\ndata: ')[1]!);
            got.push(m);
            if (until(m)) return (q.destroy(), resolve(got));
          }
        });
      });
      q.on('error', (e) => (got.length ? resolve(got) : reject(e)));
      q.end();
    });
  return { ...s, repo, id, call, procs };
}

describe('rewind and fork routes', () => {
  it('validate, rewind, undo and fork', async () => {
    const r = await rig();
    expect((await r.call('POST', `/api/runs/${r.id}/rewind`, { node: 5 })).status).toBe(400);
    expect((await r.call('POST', `/api/runs/${r.id}/rewind`, { node: 'zz' })).status).toBe(400);
    expect((await r.call('POST', '/api/runs/rnope/rewind', { node: 'a' })).status).toBe(404);
    expect((await r.call('POST', `/api/runs/${r.id}/rewind`, { node: 'ok' })).status).toBe(409);
    const rw = await r.call('POST', `/api/runs/${r.id}/rewind`, { node: 'a' });
    expect(rw.status).toBe(200);
    expect(rw.json).toMatchObject({ status: 'stopped', rewind: { node: 'a' }, live: false });
    expect((await r.call('POST', `/api/runs/${r.id}/rewind/undo`)).json).toMatchObject({ status: 'paused' });
    expect((await r.call('POST', `/api/runs/${r.id}/rewind/undo`)).status).toBe(409);
    const f = await r.call('POST', `/api/runs/${r.id}/fork`, { node: 'a' });
    expect(f.status).toBe(201);
    await r.engine.wait(f.json.id);
    expect(r.store.state(f.json.id)!.origin).toEqual({ kind: 'fork', id: r.id, node: 'a' });
    // cross-origin writes are refused like every route
    expect((await r.call('POST', `/api/runs/${r.id}/fork`, { node: 'a' }, { origin: 'http://evil.example' })).status).toBe(403);
  });
});

describe('attempts routes', () => {
  it('offer picks, start more ways, show the set and validate the pick', async () => {
    const r = await rig();
    expect((await r.call('GET', `/api/runs/${r.id}/attempts?count=9`)).status).toBe(400);
    const picks = (await r.call('GET', `/api/runs/${r.id}/attempts?count=2`)).json;
    expect(picks).toMatchObject({ original: { agent: 'mock' }, choices: [] });
    expect(picks.picks).toHaveLength(2);
    expect((await r.call('POST', `/api/runs/${r.id}/attempts`, { count: 'two' })).status).toBe(400);
    expect((await r.call('POST', `/api/runs/${r.id}/attempts`, { count: 1, agents: [{ agent: 'Bad Agent' }] })).status).toBe(400);
    expect((await r.call('POST', `/api/runs/${r.id}/attempts`, { count: 1, agents: 'mock' })).status).toBe(400);
    const st = await r.call('POST', `/api/runs/${r.id}/attempts`, { count: 1, agents: [{ agent: 'mock' }] });
    expect(st.status).toBe(201);
    expect(st.json.ids).toHaveLength(1);
    await r.engine.wait(st.json.ids[0]);
    const v = await r.call('GET', `/api/attempts/${st.json.set}`);
    expect(v.json.runs.map((x: { label: string }) => x.label)).toEqual(['A', 'B']);
    expect((await r.call('GET', '/api/attempts/not-a-set!')).status).toBe(400);
    expect((await r.call('GET', '/api/attempts/anope')).status).toBe(404);
    expect((await r.call('POST', `/api/attempts/${st.json.set}/pick`, { run: 5 })).status).toBe(400);
    expect((await r.call('POST', `/api/attempts/${st.json.set}/pick`, { run: 'rnope' })).status).toBe(400);
  });

  it('a goal’s run cap counts the siblings', async () => {
    const r = await rig({ goal: true });
    const st = await r.call('POST', `/api/runs/${r.id}/attempts`, { count: 1, agents: [{ agent: 'mock' }] });
    expect(st.status).toBe(409);
    expect(st.json.error).toMatch(/allows 1 runs/);
  });
});

describe('Terminal and Preview routes', () => {
  it('run a command and stream its output over the run’s stream', async () => {
    const r = await rig();
    expect((await r.call('POST', `/api/runs/${r.id}/exec`, { command: '' })).status).toBe(400);
    expect((await r.call('POST', `/api/runs/${r.id}/exec`, { command: 'x'.repeat(2001) })).status).toBe(400);
    expect((await r.call('POST', '/api/runs/rnope/exec', { command: 'ls' })).status).toBe(404);
    const stream = r.procs(r.id, (m) => m.type === 'exec.end');
    await new Promise((x) => setTimeout(x, 100));
    const e = await r.call('POST', `/api/runs/${r.id}/exec`, { command: 'cat a.txt' });
    expect(e.status).toBe(202);
    const got = await stream;
    expect(got.map((m) => m.type)).toEqual(['exec.start', 'exec.output', 'exec.end']);
    expect(got[1].text).toBe('a\n');
    expect(got[2]).toMatchObject({ code: 0 });
    const h = await r.call('GET', `/api/runs/${r.id}/exec`);
    expect(h.json).toMatchObject({ branch: `aorch/${r.id}`, commands: [{ command: 'cat a.txt', output: 'a\n', code: 0 }] });
    expect((await r.call('POST', `/api/runs/${r.id}/exec/stop`)).json).toEqual({ stopped: false });
  });

  it('preview: the detected command, input checks, stop', async () => {
    const r = await rig();
    expect((await r.call('GET', `/api/runs/${r.id}/preview`)).json).toEqual({ preview: null, command: null });
    expect((await r.call('POST', `/api/runs/${r.id}/preview`, {})).status).toBe(400);
    expect((await r.call('POST', `/api/runs/${r.id}/preview`, { command: 3 })).status).toBe(400);
    const p = await r.call('POST', `/api/runs/${r.id}/preview`, { command: 'sleep 30' });
    expect(p.json).toMatchObject({ status: 'starting', command: 'sleep 30' });
    expect((await r.call('DELETE', `/api/runs/${r.id}/preview`)).json).toEqual({ stopped: true });
    expect((await r.call('GET', `/api/runs/${r.id}/preview`)).json.preview).toMatchObject({ status: 'stopped' });
  });

  it('deleting a run ends its command first', async () => {
    const r = await rig();
    const stream = r.procs(r.id, (m) => m.type === 'exec.end');
    await new Promise((x) => setTimeout(x, 100));
    await r.call('POST', `/api/runs/${r.id}/exec`, { command: 'sleep 30' });
    expect((await r.call('DELETE', `/api/runs/${r.id}`)).status).toBe(200);
    const got = await stream;
    expect(got.at(-1)).toMatchObject({ type: 'exec.end', signal: 'SIGTERM' });
  });
});
