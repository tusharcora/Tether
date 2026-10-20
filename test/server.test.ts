import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';
import { Vault } from '../src/vault.js';
import { makeRepo, setup, tmp } from './helpers.js';

const demo = JSON.parse(readFileSync(new URL('../examples/pipelines/demo-mock.json', import.meta.url), 'utf8'));

let base = '';
let close: () => Promise<void>;
let repo = '';
let webDir = '';

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
  const { engine, store, registry, home } = setup(vault);
  repo = makeRepo();
  webDir = tmp('web-');
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>dash</title>');
  const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir });
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

  it('caps request bodies', async () => {
    const big = 'x'.repeat(1_100_000);
    const r = await raw('POST', '/api/preflight', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: big }) }).catch(() => ({ status: 413, body: '' }));
    expect(r.status).toBe(413);
  });
});
