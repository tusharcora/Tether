import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';
import { BUILTIN_BOTS, loadCrew, saveBot } from '../src/crew.js';
import { Vault } from '../src/vault.js';
import { makeRepo, setup, tmp } from './helpers.js';

const demo = JSON.parse(readFileSync(new URL('../examples/pipelines/demo-mock.json', import.meta.url), 'utf8'));
const ECC_FIXTURE = new URL('./fixtures/ecc/', import.meta.url).pathname;

let base = '';
let close: () => Promise<void>;
let repo = '';
let webDir = '';
let home = '';

/** Raw request so tests can set Host/Origin and an unnormalised path. */
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
  const r = await raw(method, path, { headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: r.body ? JSON.parse(r.body) : undefined };
};
async function until<T>(fn: () => Promise<T | undefined>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  const vault = new Vault(tmp('vault-'));
  const s0 = setup(vault);
  const { engine, store, registry } = s0;
  home = s0.home;
  repo = makeRepo();
  webDir = tmp('web-');
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>dash</title>');
  const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir, eccFetch: async (dest) => void cpSync(ECC_FIXTURE, dest, { recursive: true }) });
  base = s.url;
  close = s.close;
});
afterAll(() => close());

describe('http api', () => {
  it('saves a pipeline, runs it, pauses at approval, approves over HTTP and finishes', async () => {
    expect((await api('GET', '/api/health')).json.ok).toBe(true);
    const put = await api('PUT', '/api/pipelines/demo-mock', demo);
    expect(put.status).toBe(200);
    expect((await api('GET', '/api/pipelines')).json.map((p: any) => p.name)).toContain('demo-mock');

    const started = await api('POST', '/api/runs', { pipeline: 'demo-mock', task: 'rate limit demo', repo });
    expect(started.status).toBe(201);
    const id = started.json.id as string;

    const paused = await until(async () => {
      const r = (await api('GET', `/api/runs/${id}`)).json;
      return r.status === 'paused' ? r : undefined;
    });
    expect(paused.nodes.approve.status).toBe('awaiting');
    expect(paused.nodes.tests.loops).toBe(1);

    const diff = (await api('GET', `/api/runs/${id}/diff?node=code`)).json;
    expect(diff.diff).toContain('HELLO.md');
    expect((await api('GET', `/api/runs/${id}/diff`)).json.diff).toContain('hello from the demo pipeline');

    const ok = await api('POST', `/api/runs/${id}/approve`, { node: 'approve', approved: true });
    expect(ok.status).toBe(200);
    await until(async () => ((await api('GET', `/api/runs/${id}`)).json.status === 'done' ? true : undefined));

    const events = (await api('GET', `/api/runs/${id}/events`)).json;
    expect(events.some((e: any) => e.event.type === 'loop')).toBe(true);
    expect(events.every((e: any) => e.event.type !== 'node.chunk')).toBe(true);

    const g = (await api('GET', '/api/vault/graph')).json;
    expect(g.nodes.some((n: any) => n.id.startsWith('Runs/'))).toBe(true);
    expect(g.unresolved).toBe(0);
    const note = (await api('GET', `/api/vault/note?path=${encodeURIComponent(g.nodes.find((n: any) => n.id.startsWith('Pipelines/')).id)}`)).json;
    expect(note.backlinks.some((b: string) => b.startsWith('Runs/'))).toBe(true);
  });

  it('streams run state over SSE', async () => {
    const started = await api('POST', '/api/runs', { pipeline: demo, task: 'sse', repo, autoApprove: true });
    const id = started.json.id as string;
    const text = await new Promise<string>((resolve, reject) => {
      const u = new URL(base);
      const req = request({ host: u.hostname, port: u.port, path: `/api/runs/${id}/stream?after=0`, headers: { host: u.host } }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (d) => {
          buf += d;
          if (buf.includes('"status":"done"')) (req.destroy(), resolve(buf));
        });
      });
      req.on('error', (e) => (buf_done ? undefined : reject(e)));
      let buf_done = false;
      setTimeout(() => reject(new Error('sse timeout')), 10_000).unref();
      req.on('close', () => (buf_done = true));
      req.end();
    });
    expect(text).toContain('event: state');
    expect(text).toContain('event: event');
    expect(text).toContain('node.finished');
  });

  it('POST /api/runs with endpoints: false leaves the saved API requests out of the run', async () => {
    const proj = makeRepo();
    mkdirSync(join(proj, '.aorch/http'), { recursive: true });
    writeFileSync(join(proj, '.aorch/project.md'), '# Demo\n');
    writeFileSync(join(proj, '.aorch/http/ping.req.json'), JSON.stringify({ name: 'Ping', method: 'GET', url: 'http://h/ping' }));
    execFileSync('git', ['add', '-A'], { cwd: proj });
    execFileSync('git', ['commit', '-q', '-m', 'aorch'], { cwd: proj });
    const ws = async (body: object) => {
      const started = await api('POST', '/api/runs', { pipeline: demo, task: 't', repo: proj, autoApprove: true, ...body });
      expect(started.status).toBe(201);
      return (await api('GET', `/api/runs/${started.json.id}`)).json.workspace;
    };
    expect((await ws({})).endpoints).toContain('ping');
    expect((await ws({ endpoints: false })).endpoints).toBeUndefined();
  });

  it('rejects bad input with useful errors', async () => {
    expect((await api('POST', '/api/runs', { pipeline: 'demo-mock', repo })).status).toBe(400); // no task
    expect((await api('POST', '/api/runs', { pipeline: 'demo-mock', task: 't', repo: '/no/such/dir' })).status).toBe(400);
    expect((await api('POST', '/api/runs', { pipeline: 'nope', task: 't', repo })).status).toBe(400);
    expect((await api('PUT', '/api/pipelines/..%2Fevil', demo)).status).toBe(400);
    expect((await api('GET', '/api/runs/zzz')).status).toBe(404);
    const swarm = { ...demo, mode: 'swarm' };
    const r = await api('POST', '/api/runs', { pipeline: swarm, task: 't', repo });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatch(/no scheduler/);
  });
});

describe('http security', () => {
  it('refuses a foreign Host header (DNS rebinding)', async () => {
    const r = await raw('GET', '/api/runs', { headers: { host: 'evil.example.com' } });
    expect(r.status).toBe(403);
  });

  it('refuses cross-origin state changes but allows same-origin and header-less clients', async () => {
    const body = JSON.stringify({ pipeline: 'demo-mock', task: 't', repo });
    const evil = await raw('POST', '/api/runs', { headers: { origin: 'http://evil.example.com', 'content-type': 'application/json' }, body });
    expect(evil.status).toBe(403);
    const u = new URL(base);
    const same = await raw('POST', '/api/preflight', { headers: { origin: `http://${u.host}`, 'content-type': 'application/json' }, body: JSON.stringify(demo) });
    expect(same.status).toBe(200);
  });

  it('does not serve files outside the dashboard directory', async () => {
    for (const p of ['/%2e%2e/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2f..%2fetc%2fpasswd', '/../../../../etc/passwd']) {
      const r = await raw('GET', p);
      expect(r.body).not.toContain('root:');
    }
    expect((await raw('GET', '/some/spa/route')).body).toContain('<title>dash</title>'); // SPA fallback
  });

  it('refuses to bind a non-loopback interface without explicit opt-in', async () => {
    const { engine, store, registry, home } = setup();
    const vault = new Vault(tmp('v-'));
    expect(() => startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, host: '0.0.0.0', port: 0 })).toThrow(/refusing to bind/);
  });

  it('links, lists and unlinks bots, and rejects bad input', { timeout: 30_000 }, async () => {
    const before = await api('GET', '/api/bots');
    expect(before.status).toBe(200);
    expect(before.json.crew.map((c: any) => c.role)).toContain('coder');
    expect(before.json.agents.mock.ok).toBe(true);
    expect((await api('PUT', '/api/bots/coder', { agent: 'mock', model: 'm1' })).status).toBe(200);
    expect((await api('GET', '/api/bots')).json.crew.find((c: any) => c.role === 'coder').binding).toEqual({ agent: 'mock', model: 'm1' });
    expect((await api('PUT', '/api/bots/coder', { agent: 'nope' })).status).toBe(400);
    expect((await api('PUT', '/api/bots/approval', { agent: 'mock' })).status).toBe(400);
    expect((await api('PUT', '/api/bots/stranger', { agent: 'mock' })).status).toBe(404);
    expect((await api('DELETE', '/api/bots/coder')).status).toBe(200);
    expect((await api('GET', '/api/bots')).json.crew.find((c: any) => c.role === 'coder').binding).toBeNull();
  });

  it('saves the crew style and sends the marks the web needs', async () => {
    const first = await api('GET', '/api/crew');
    expect(first.json.style).toBe('pebble');
    expect(first.json.styles.map((x: any) => x.id)).toEqual(expect.arrayContaining(['sigil', 'tile', 'ticker', 'orbit']));
    expect(first.json.bots.find((b: any) => b.id === 'planner').mark).toEqual({ shape: 'diamond', symbol: 'SCT', initials: 'SC' });
    expect(Object.keys(first.json.shapes)).toContain('triangle');
    expect(Object.keys(first.json.glyphs)).toContain('triangle');
    expect((await api('PUT', '/api/crew/style', { style: 'nope' })).status).toBe(400);
    expect((await api('PUT', '/api/crew/style', { style: 'orbit' })).status).toBe(200);
    expect((await api('GET', '/api/crew')).json.style).toBe('orbit');
    await api('PUT', '/api/crew/style', { style: 'pebble' });
  });

  it('caps request bodies', async () => {
    const big = 'x'.repeat(1_100_000);
    const r = await raw('POST', '/api/preflight', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: big }) }).catch(() => ({ status: 413, body: '' }));
    expect(r.status).toBe(413);
  });
});

describe('crew import and skills', () => {
  it('imports ECC, exposes it on /api/crew and /api/skills, and removes it', async () => {
    const d = (await api('POST', '/api/crew/import', { source: 'ecc' })).json;
    expect(d.added).toHaveLength(5);
    const crew = (await api('GET', '/api/crew')).json;
    expect(crew.ecc.ref).toBe('v2.2.3');
    expect(crew.eccDefault).toBe('v2.2.3');
    expect(crew.bots.find((b: { id: string }) => b.id === 'go-reviewer')).toMatchObject({ source: 'ecc@v2.2.3', whenToUse: expect.stringMatching(/Go/) });
    const skills = (await api('GET', '/api/skills?source=ecc')).json;
    expect(skills.map((s: { name: string }) => s.name)).toEqual(['tdd-workflow', 'plan']);
    expect((await api('GET', '/api/skills/ecc/tdd-workflow')).json.prompt).toMatch(/<skill>/);
    expect((await api('DELETE', '/api/crew?source=ecc')).json.removed).toHaveLength(5);
    expect((await api('GET', '/api/crew')).json.ecc).toBeNull();
  });

  it('refuses unknown sources and cross-origin imports', async () => {
    const json = { 'content-type': 'application/json' };
    expect((await raw('POST', '/api/crew/import', { headers: json, body: JSON.stringify({ source: 'x' }) })).status).toBe(400);
    expect((await raw('POST', '/api/crew/import', { headers: { ...json, origin: 'https://evil.example' }, body: JSON.stringify({ source: 'ecc' }) })).status).toBe(403);
    expect((await raw('GET', '/api/skills/ecc/nope')).status).toBe(404);
    expect((await api('DELETE', '/api/crew?source=x')).status).toBe(400);
  });

  it('keeps an imported bot imported when edited, truncates long personas in the list, and saves them back whole', async () => {
    await api('POST', '/api/crew/import', { source: 'ecc' });
    try {
      const go = loadCrew(home).find((b) => b.id === 'go-reviewer')!;
      const long = 'p'.repeat(5000);
      saveBot(home, { ...go, persona: long, modelHint: 'opus' });
      const listed = (await api('GET', '/api/crew')).json.bots.find((b: { id: string }) => b.id === 'go-reviewer');
      expect(listed.persona).toHaveLength(2000);
      expect(listed.personaTruncated).toBe(true);
      // the editor PUTs the listed bot back with only the name changed: the full persona survives
      expect((await api('PUT', '/api/crew/go-reviewer', { ...listed, name: 'Gopher' })).status).toBe(200);
      let saved = loadCrew(home).find((b) => b.id === 'go-reviewer')!;
      expect(saved).toMatchObject({ name: 'Gopher', source: 'ecc@v2.2.3', modelHint: 'opus' });
      expect(saved.persona).toBe(long);
      // a bare edit that sends no source, whenToUse or persona keeps them
      expect((await api('PUT', '/api/crew/go-reviewer', { name: 'Go2', kind: 'verdict' })).status).toBe(200);
      saved = loadCrew(home).find((b) => b.id === 'go-reviewer')!;
      expect(saved).toMatchObject({ name: 'Go2', source: 'ecc@v2.2.3', whenToUse: go.whenToUse, modelHint: 'opus' });
      expect(saved.persona.length).toBeGreaterThan(600);
      // a new persona sent without the truncation flag is taken as sent
      await api('PUT', '/api/crew/go-reviewer', { name: 'Go3', kind: 'verdict', persona: 'short' });
      expect(loadCrew(home).find((b) => b.id === 'go-reviewer')!.persona).toBe('short');
    } finally {
      await api('DELETE', '/api/crew?source=ecc');
    }
  });

  it('returns one full bot by id for the editor', async () => {
    await api('POST', '/api/crew/import', { source: 'ecc' });
    try {
      const go = loadCrew(home).find((b) => b.id === 'go-reviewer')!;
      saveBot(home, { ...go, persona: 'p'.repeat(5000) });
      const r = await api('GET', '/api/crew/go-reviewer');
      expect(r.status).toBe(200);
      expect(r.json.persona).toHaveLength(5000);
      expect(r.json.personaTruncated).toBeUndefined();
      expect(r.json.source).toBe('ecc@v2.2.3');
      expect((await api('GET', '/api/crew/nobody')).status).toBe(404);
    } finally {
      await api('DELETE', '/api/crew?source=ecc');
    }
  });

  it('cannot create an imported bot through PUT', async () => {
    try {
      expect((await api('PUT', '/api/crew/sneaky', { name: 'Sneaky', kind: 'agent', persona: 'x'.repeat(5000), source: 'ecc@x', modelHint: 'opus' })).status).toBe(200);
      const saved = loadCrew(home).find((b) => b.id === 'sneaky')!;
      expect(saved.source).toBeUndefined();
      expect(saved.modelHint).toBeUndefined();
      expect(saved.persona).toHaveLength(600);
    } finally {
      await api('DELETE', '/api/crew/sneaky');
    }
  });

  it('lets you edit an existing bot at the 67-bot limit but not add one', async () => {
    const look = BUILTIN_BOTS[0]!.look;
    const ids = Array.from({ length: 67 - BUILTIN_BOTS.length }, (_, i) => `mine${i}`);
    for (const id of ids) saveBot(home, { id, name: id, title: '', kind: 'agent', persona: '', look });
    try {
      expect(loadCrew(home).filter((b) => !b.source)).toHaveLength(67);
      expect((await api('PUT', '/api/crew/mine0', { name: 'Renamed', kind: 'agent' })).status).toBe(200);
      expect((await api('PUT', '/api/crew/coder', { name: 'Bolt', kind: 'agent' })).status).toBe(200);
      expect((await api('PUT', '/api/crew/brandnew', { name: 'New', kind: 'agent' })).status).toBe(400);
    } finally {
      for (const id of ids) rmSync(join(home, 'crew', `${id}.json`), { force: true });
      await api('DELETE', '/api/crew/coder');
    }
  });
});
