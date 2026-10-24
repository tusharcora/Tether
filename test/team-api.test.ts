import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { Engine } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { Vault } from '../src/vault.js';
import { makeRepo, tmp } from './helpers.js';

let base = '';
let close: () => Promise<void>;
let engine: Engine;
let store: Store;
let repo = '';

/** Holds planning round 2 until released, so a test can see the HTTP answer return before the round is done. */
class GateAdapter extends MockAdapter {
  gate?: Promise<void>;
  gateNode = 'plan.2';
  override async run(req: Parameters<MockAdapter['run']>[0]) {
    if (req.nodeId === this.gateNode && this.gate) await this.gate;
    return super.run(req);
  }
}
const gateAdapter = new GateAdapter();
async function until<T>(fn: () => Promise<T | undefined>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

function raw(method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const u = new URL(base);
    const req = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, ...opts.headers } }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}
const api = async (method: string, path: string, body?: unknown) => {
  const r = await raw(method, path, { headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, json: r.body ? JSON.parse(r.body) : undefined };
};

const card = (id: string, extra: object = {}) => ({ id, ask: `ask ${id}`, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommended: 'b', ...extra });
const planScript = { goal: 'g', success: ['s'], assignments: [{ bot: 'coder', goal: 'c' }] };
const J = JSON.stringify;
const ASK1 = '@ASK user: Which database? | options: postgres; sqlite | recommended: sqlite';
const mkTeam = (mock: object, o: object = {}) => engine.startTeam({ task: 'build x', repo, workspace: false, roster: ['coder'], mock: mock as never, ...o });

beforeAll(async () => {
  const vault = new Vault(tmp('vault-'));
  const home = tmp('home-');
  const registry = new AdapterRegistry().register(gateAdapter);
  store = Store.open(':memory:');
  engine = new Engine(store, { home, registry, vault, bindings: () => ({ orchestrator: { agent: 'mock' }, manager: { agent: 'mock' } }) });
  repo = makeRepo();
  const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0 });
  base = s.url;
  close = s.close;
});
afterAll(() => close());

describe('team runs over HTTP', () => {
  it('answering returns once the answer is recorded; the next planning round runs in the background', async () => {
    const id = await mkTeam({ questions: [[card('q1')]], plan: planScript });
    let release!: () => void;
    gateAdapter.gate = new Promise<void>((r) => (release = r));
    try {
      const t0 = Date.now();
      const r = await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'q1', option: 'a' }] });
      expect(r.status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(r.json.planning).toBe(true);
      expect(r.json.plan).toBeUndefined();
      expect(r.json.pending).toEqual([]);
      expect(r.json.answers.map((a: any) => a.question)).toEqual(['q1']);
      // a duplicate while the round runs is refused, not applied twice
      expect((await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'q1', option: 'b' }] })).status).toBe(409);
    } finally {
      release();
      gateAdapter.gate = undefined;
    }
    const done = await until(async () => {
      const g = (await api('GET', `/api/runs/${id}`)).json;
      return g.plan ? g : undefined;
    });
    expect(done.planning).toBe(false);
  });

  it('a batch mixing planning cards and worker questions is refused whole', async () => {
    const id = await mkTeam({ questions: [[card('q1')]], plan: planScript });
    const r = await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'q1', option: 'a' }, { question: 'ghost', option: 'a' }] });
    expect(r.status).toBe(400);
    expect(store.state(id)!.pending).toHaveLength(1);
  });

  it('dedupes the roster', async () => {
    const r = await api('POST', '/api/runs', { kind: 'team', task: 'x', repo, roster: ['coder', 'coder', 'reviewer'], maxRounds: 1 });
    expect(r.status).toBe(201);
    expect(store.state(r.json.id)!.team!.roster).toEqual(['coder', 'reviewer']);
  });

  it('creates a team run and shows pending, mode and kind', async () => {
    const r = await api('POST', '/api/runs', { kind: 'team', task: 'build x', repo, mode: 'autonomous', roster: ['coder'], yes: false, maxRounds: 1 });
    expect(r.status).toBe(201);
    // planning runs in the background: the cards show up once its first round is done
    const v = await until(async () => {
      const g = (await api('GET', `/api/runs/${r.json.id}`)).json;
      return g.pending.length ? g : undefined;
    });
    expect(v).toMatchObject({ kind: 'team', mode: 'autonomous', planning: true });
    expect(v.plan).toBeUndefined();
  });

  it('rejects bad team start payloads', async () => {
    expect((await api('POST', '/api/runs', { kind: 'team', task: 'x', repo, mode: 'wild' })).status).toBe(400);
    expect((await api('POST', '/api/runs', { kind: 'team', task: 'x', repo, roster: 'nope-bot' })).status).toBe(400);
    expect((await api('POST', '/api/runs', { kind: 'team', task: 'x', repo: tmp('not-git-') })).status).toBe(422);
    expect((await api('POST', '/api/runs', { kind: 'team', task: 'x', repo, roster: [1] })).status).toBe(400);
    expect((await api('POST', '/api/runs', { kind: 'team', task: '', repo })).status).toBe(400);
    expect((await api('POST', '/api/runs', { kind: 'team', task: 'x', repo, budget: -1 })).status).toBe(400);
    expect((await api('POST', '/api/runs', { kind: 'team', task: 'x', repo, budget: 51 })).status).toBe(400);
    expect((await api('POST', '/api/runs', { kind: 'bogus', task: 'x', repo })).status).toBe(400);
  });

  it('answers planning cards, 409 on a duplicate, then approves the plan', async () => {
    const id = await mkTeam({ questions: [[card('q1', { allowOther: true }), card('q2')]], plan: planScript });
    const get = async () => (await api('GET', `/api/runs/${id}`)).json;
    expect((await get()).pending.map((x: any) => x.id)).toEqual(['q1', 'q2']);

    // validation
    const bad = (body: unknown) => api('POST', `/api/runs/${id}/answers`, body).then((r) => r.status);
    expect(await bad({})).toBe(400);
    expect(await bad({ answers: [] })).toBe(400);
    expect(await bad({ answers: 'a' })).toBe(400);
    expect(await bad({ answers: [{ question: 5, option: 'a' }] })).toBe(400);
    expect(await bad({ answers: [{ question: 'zzz', option: 'a' }] })).toBe(400);
    expect(await bad({ answers: [{ question: 'q1', option: 'zzz' }] })).toBe(400);
    expect(await bad({ answers: [{ question: 'q2', text: 'free' }] })).toBe(400); // q2 does not allow other
    expect(await bad({ answers: [{ question: 'q1', text: 'x'.repeat(2001) }] })).toBe(400);
    expect(await bad({ answers: [{ question: 'q1' }] })).toBe(400);
    expect(await bad({ answers: [{ question: 'q1', option: 'a' }, { question: 'q1', option: 'b' }] })).toBe(400);
    expect((await get()).pending).toHaveLength(2); // nothing applied by the bad ones

    // free text with a newline is fine, up to 2000
    expect(await bad({ answers: [{ question: 'q1', text: '  line one\n\nline two ' + 'y'.repeat(1900) + '  ', by: 'default' }] })).toBe(200);
    // newlines are kept (ends trimmed), and a client cannot claim the answer was a default
    const stored = (await get()).answers.find((a: any) => a.question === 'q1');
    expect(stored.text.startsWith('line one\n\nline two y')).toBe(true);
    expect(stored.by).toBe('user');
    expect(await bad({ answers: [{ question: 'q1', option: 'a' }] })).toBe(409);
    expect((await get()).pending.map((x: any) => x.id)).toEqual(['q2']);
    expect((await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'q2', option: 'a' }] })).status).toBe(200);
    const done = await until(async () => {
      const g = await get();
      return g.planning ? undefined : g;
    });
    expect(done.planning).toBe(false);
    expect(done.plan.goal).toBe('g');

    expect((await api('POST', `/api/runs/${id}/plan`, {})).status).toBe(400);
    expect((await api('POST', `/api/runs/${id}/plan`, { approved: 'yes' })).status).toBe(400);
    const ok = await api('POST', `/api/runs/${id}/plan`, { approved: true });
    expect(ok.status).toBe(200);
    expect(ok.json.pipeline.nodes.length).toBe(1);
    await engine.wait(id).catch(() => undefined);
    expect((await api('POST', `/api/runs/${id}/plan`, { approved: true })).status).toBe(409);
  });

  it('rejecting a plan ends the run; approving with no plan ready is 409', async () => {
    const id = await mkTeam({ questions: [[card('q1')]], plan: planScript });
    expect((await api('POST', `/api/runs/${id}/plan`, { approved: true })).status).toBe(409);
    await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'q1', option: 'a' }] });
    await until(async () => ((await api('GET', `/api/runs/${id}`)).json.plan ? true : undefined));
    const r = await api('POST', `/api/runs/${id}/plan`, { approved: false });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('stopped');
  });

  it('switches mode; bad mode is 400; a workflow run is refused', async () => {
    const id = await mkTeam({ questions: [[card('q1')]], plan: planScript });
    expect((await api('POST', `/api/runs/${id}/mode`, { mode: 'autonomous' })).json.mode).toBe('autonomous');
    expect((await api('POST', `/api/runs/${id}/mode`, { mode: 'live' })).json.mode).toBe('live');
    expect((await api('POST', `/api/runs/${id}/mode`, { mode: 'wild' })).status).toBe(400);
    expect((await api('POST', `/api/runs/${id}/mode`, {})).status).toBe(400);
    expect((await api('POST', `/api/runs/nope/mode`, { mode: 'live' })).status).toBe(404);
    expect((await api('POST', `/api/runs/nope/answers`, { answers: [{ question: 'q', option: 'a' }] })).status).toBe(404);
    expect((await api('POST', `/api/runs/nope/plan`, { approved: true })).status).toBe(404);
  });

  it('answers a mid-run ask (pending from user.ask), 409 on a duplicate, and the run finishes', async () => {
    const id = await mkTeam({
      plan: planScript,
      replies: { plan: [J({ tasks: [{ id: 'a', to: 'coder', goal: 'do it', mode: 'read', context: [], after: [] }] })], review: [J({ decision: 'accept' })] },
      spawned: { a: { output: ASK1 } },
    }, { yes: true });
    expect((await api('POST', `/api/runs/${id}/plan`, { approved: true })).status).toBe(200);
    const paused = await engine.wait(id);
    expect(paused.status).toBe('paused');
    const v = (await api('GET', `/api/runs/${id}`)).json;
    expect(v.pending.map((x: any) => x.id)).toEqual(['u1']);
    expect((await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'u1', option: 'nope' }] })).status).toBe(400);
    const r = await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'u1', option: 'o1' }] });
    expect(r.status).toBe(200);
    expect((await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'u1', option: 'o1' }] })).status).toBe(409);
    expect((await engine.wait(id)).status).toBe('done');
  });

  it('a resume failure after a mid-run answer is a 500 carrying the engine message', async () => {
    const id = await mkTeam({
      plan: planScript,
      replies: { plan: [J({ tasks: [{ id: 'a', to: 'coder', goal: 'do it', mode: 'read', context: [], after: [] }] })], review: [J({ decision: 'accept' })] },
      spawned: { a: { output: ASK1 } },
    }, { yes: true });
    await api('POST', `/api/runs/${id}/plan`, { approved: true });
    await engine.wait(id);
    const { rmSync } = await import('node:fs');
    rmSync(store.state(id)!.workdir, { recursive: true, force: true });
    const r = await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'u1', option: 'o1' }] });
    expect(r.status).toBe(500);
    expect(r.json.error).toMatch(/answered, but could not resume/);
  });

  it('the stop endpoint ends a planning run and a paused run', async () => {
    const planning = await mkTeam({ questions: [[card('q1')]], plan: planScript });
    const r = await api('POST', `/api/runs/${planning}/stop`, {});
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('stopped');
    // a stopped planning run has no cards left and cannot be answered while stopped
    expect(r.json.pending).toEqual([]);
    expect(r.json.planning).toBe(false);
    expect((await api('POST', `/api/runs/${planning}/answers`, { answers: [{ question: 'q1', option: 'a' }] })).status).toBe(409);

    const id = await mkTeam({
      plan: planScript,
      replies: { plan: [J({ tasks: [{ id: 'a', to: 'coder', goal: 'do it', mode: 'read', context: [], after: [] }] })], review: [J({ decision: 'accept' })] },
      spawned: { a: { output: ASK1 } },
    }, { yes: true });
    await api('POST', `/api/runs/${id}/plan`, { approved: true });
    expect((await engine.wait(id)).status).toBe('paused');
    const s = await api('POST', `/api/runs/${id}/stop`, {});
    expect(s.status).toBe(200);
    expect(s.json.status).toBe('stopped');
    expect((await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'u1', option: 'o1' }] })).status).toBe(409);
  });

  it('POST /api/runs for a team returns before the first planning round is done', async () => {
    let release!: () => void;
    gateAdapter.gateNode = 'plan.1';
    gateAdapter.gate = new Promise<void>((r) => (release = r));
    try {
      const t0 = Date.now();
      const r = await api('POST', '/api/runs', { kind: 'team', task: 'x', repo, roster: ['coder'] });
      expect(r.status).toBe(201);
      expect(Date.now() - t0).toBeLessThan(2000);
      const v = (await api('GET', `/api/runs/${r.json.id}`)).json;
      expect(v).toMatchObject({ planning: true, pending: [], live: true });
      release();
      await until(async () => ((await api('GET', `/api/runs/${r.json.id}`)).json.pending.length ? true : undefined));
    } finally {
      release();
      gateAdapter.gate = undefined;
      gateAdapter.gateNode = 'plan.2';
    }
  });

  it('a planning run waiting on a card, or a plan waiting for approval, is never shown as interrupted, and stop works on both', async () => {
    const waiting = await mkTeam({ questions: [[card('q1')]], plan: planScript });
    const ready = await mkTeam({ questions: [], plan: planScript }, { yes: true });
    const later = Date.now() + 10 * 60_000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      for (const id of [waiting, ready]) {
        expect((await api('GET', `/api/runs/${id}`)).json.live).toBe(true);
        expect((await api('GET', '/api/runs')).json.find((x: any) => x.id === id).live).toBe(true);
      }
    } finally {
      spy.mockRestore();
    }
    for (const id of [waiting, ready]) {
      const r = await api('POST', `/api/runs/${id}/stop`, {});
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ status: 'stopped', pending: [], live: false });
    }
    expect((await api('POST', `/api/runs/${ready}/stop`, {})).status).toBe(409);
  });

  it('resuming a stopped planning run over HTTP plans again in the background', async () => {
    const id = await mkTeam({ questions: [[card('q1')]], plan: planScript });
    await api('POST', `/api/runs/${id}/stop`, {});
    const r = await api('POST', `/api/runs/${id}/resume`, {});
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('running');
    const v = await until(async () => {
      const g = (await api('GET', `/api/runs/${id}`)).json;
      return g.pending.length ? g : undefined;
    });
    expect(v.pending.map((q: any) => q.id)).toEqual(['q1']);
  });

  it('several worker answers in one request are applied together, or none when one is bad', async () => {
    const id = await mkTeam({
      plan: planScript,
      replies: { plan: [J({ tasks: [{ id: 'a', to: 'coder', goal: 'do it', mode: 'read', context: [], after: [] }] })], review: [J({ decision: 'accept' })] },
      spawned: { a: { output: `${ASK1}\n@ASK user: Second? | options: x; y` } },
    }, { yes: true });
    await api('POST', `/api/runs/${id}/plan`, { approved: true });
    expect((await engine.wait(id)).status).toBe('paused');
    expect((await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'u1', option: 'o1' }, { question: 'u2', text: 'no options here?' }, { question: 'u2', option: 'zz' }] })).status).toBe(400);
    expect(store.state(id)!.pending).toHaveLength(2);
    const r = await api('POST', `/api/runs/${id}/answers`, { answers: [{ question: 'u1', option: 'o1' }, { question: 'u2', option: 'o2' }] });
    expect(r.status).toBe(200);
    expect((await engine.wait(id)).status).toBe('done');
  });

  it('refuses a non-loopback Host on every new route', async () => {
    const id = await mkTeam({ questions: [[card('q1')]], plan: planScript });
    for (const [m, p, b] of [
      ['POST', '/api/runs', { kind: 'team', task: 'x', repo }],
      ['POST', `/api/runs/${id}/answers`, { answers: [{ question: 'q1', option: 'a' }] }],
      ['POST', `/api/runs/${id}/plan`, { approved: true }],
      ['POST', `/api/runs/${id}/mode`, { mode: 'live' }],
    ] as const) {
      const r = await raw(m, p, { headers: { host: 'evil.example.com', 'content-type': 'application/json' }, body: J(b) });
      expect(r.status).toBe(403);
    }
    expect(store.state(id)!.pending).toHaveLength(1);
  });
  it('swaps a planned bot only while the plan waits, only to a roster bot', async () => {
    const id = await mkTeam({ plan: { ...planScript, assignments: [{ bot: 'coder', goal: 'c', why: 'writes code' }] } }, { roster: ['coder', 'reviewer'] });
    await until(async () => ((await api('GET', `/api/runs/${id}`)).json.plan ? true : undefined));
    const bad = await raw('POST', `/api/runs/${id}/swap`, { headers: { 'content-type': 'application/json' }, body: J({ assignment: 0, bot: 'nobody' }) });
    expect(bad.status).toBe(400);
    expect((await api('POST', `/api/runs/${id}/swap`, { assignment: 7, bot: 'reviewer' })).status).toBe(400);
    expect((await api('POST', `/api/runs/${id}/swap`, { assignment: '0', bot: 'reviewer' })).status).toBe(400);
    const ok = await api('POST', `/api/runs/${id}/swap`, { assignment: 0, bot: 'reviewer' });
    expect(ok.status).toBe(200);
    expect(ok.json.plan.assignments[0]).toMatchObject({ bot: 'reviewer', swapped: true, why: 'writes code' });
    expect((await api('POST', `/api/runs/${id}/plan`, { approved: true })).status).toBe(200);
    const late = await raw('POST', `/api/runs/${id}/swap`, { headers: { 'content-type': 'application/json' }, body: J({ assignment: 0, bot: 'coder' }) });
    expect(late.status).toBe(409);
    await engine.wait(id).catch(() => undefined);
  });
});
