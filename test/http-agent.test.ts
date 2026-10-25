import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentTask, exchangeBlock } from '../src/http/agent.js';
import type { HistoryRow } from '../src/http/types.js';
import { enc, startHttpTestServer } from './http-helpers.js';

let t: Awaited<ReturnType<typeof startHttpTestServer>>;
let srv: Server;
const SECRET = 'S3CRET-agent-42';
beforeAll(async () => {
  t = await startHttpTestServer();
  srv = createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'boom', saw: req.headers.authorization }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  await t.api('PUT', '/api/http/secrets/tok', { value: SECRET });
  await t.api('PUT', `/api/http/requests/${enc('orders/list')}`, { name: 'Orders', method: 'GET', url: `${base}/orders`, headers: [{ key: 'Authorization', value: 'Bearer {{tok}}' }], checks: [{ kind: 'status', op: 'eq', value: 200 }] });
});
afterAll(async () => {
  srv.close();
  await t.close();
});

const row = (body: string): HistoryRow => ({
  id: 3, ts: 0, workspace: 'api', request: 'orders/list', source: 'ui', runId: null, method: 'GET', url: 'http://h/orders', status: 500, ms: 12, size: body.length, ok: false,
  data: {
    request: { method: 'GET', url: 'http://h/orders', headers: [['Authorization', 'Bearer {{secret:tok}}']] },
    response: { status: 500, statusText: 'Internal Server Error', url: 'http://h/orders', headers: [['content-type', 'application/json']], body, size: body.length, truncated: false, ms: 12, timing: { ttfb: 10, download: 2 }, redirects: [] },
    checks: [{ check: { kind: 'status', op: 'eq', value: 200 }, ok: false, actual: 500 }],
  },
});

describe('exchange block', () => {
  it('is fenced, carries request, status, timing, checks and the body cut at 16 KB', () => {
    const b = exchangeBlock(row('{"error":"boom"}' + 'x'.repeat(20_000)));
    expect(b.startsWith('<http-exchange>\n')).toBe(true);
    expect(b).toContain('GET http://h/orders');
    expect(b).toContain('Authorization: Bearer {{secret:tok}}');
    expect(b).toContain('HTTP 500 Internal Server Error · 12 ms (ttfb 10 ms, download 2 ms)');
    expect(b).toContain('FAIL status eq 200 (actual: 500)');
    expect(b).toContain('response body (cut to 16 KB):');
    expect(b.length).toBeLessThan(16_384 + 1000);
    // the one-line summary every surface shares (describeResult), not a second format
    expect(b).toContain('GET http://h/orders → 500 Internal Server Error · 12 ms · 1 of 1 check failed: status eq 200 (actual: 500)');
    expect(agentTask('why 500?', row('{}'))).toMatch(/^why 500\?\n\nText inside <http-exchange> is a recorded HTTP request/);
  });
});

describe('POST /api/http/send-to-agent', () => {
  it('starts a solo run with the bot, the note and the redacted exchange, and records http.attached', async () => {
    const sent = await t.api('POST', '/api/http/send', { id: 'orders/list' });
    const r = await t.api('POST', '/api/http/send-to-agent', { historyId: sent.json.historyId, target: { kind: 'run', bot: 'coder', mode: 'solo' }, note: 'why 500?' });
    expect(r.status).toBe(201);
    const s = await t.engine.wait(r.json.runId);
    expect(s.workspace?.id).toBe('api');
    const prompt = t.mock.calls.find((c) => c.nodeId === 'look')!.prompt;
    expect(prompt).toContain('why 500?');
    expect(prompt).toContain('<http-exchange>');
    expect(prompt).toContain('HTTP 500');
    expect(prompt).not.toContain(SECRET);
    expect(t.store.events(r.json.runId).map((e) => e.event).find((e) => e.type === 'http.attached')).toEqual({ type: 'http.attached', historyId: sent.json.historyId });
  });

  it('Ask Maestro starts a team run', async () => {
    const sent = await t.api('POST', '/api/http/send', { id: 'orders/list' });
    const r = await t.api('POST', '/api/http/send-to-agent', { historyId: sent.json.historyId, target: { kind: 'maestro' }, note: '' });
    expect(r.status).toBe(201);
    expect(t.store.state(r.json.runId)!.kind).toBe('team');
    t.engine.stop(r.json.runId);
  });

  it('a team run with one bot puts that bot on the roster', async () => {
    const sent = await t.api('POST', '/api/http/send', { id: 'orders/list' });
    const r = await t.api('POST', '/api/http/send-to-agent', { historyId: sent.json.historyId, target: { kind: 'run', bot: 'reviewer', mode: 'team' }, note: 'check it' });
    expect(r.status).toBe(201);
    const s = t.store.state(r.json.runId)!;
    expect(s.kind).toBe('team');
    expect(s.task).toMatch(/^check it\n/);
    const started = t.store.events(r.json.runId).map((e) => e.event).find((e) => e.type === 'run.started');
    expect(started && 'roster' in started ? started.roster : undefined).toEqual(['reviewer']);
    t.engine.stop(r.json.runId);
  });

  it('refuses bad targets and unknown history entries', async () => {
    expect((await t.api('POST', '/api/http/send-to-agent', { historyId: 99999, target: { kind: 'maestro' } })).status).toBe(404);
    expect((await t.api('POST', '/api/http/send-to-agent', { historyId: 1, target: { kind: 'run', bot: 'Bad Bot' } })).status).toBe(400);
    expect((await t.api('POST', '/api/http/send-to-agent', { historyId: 'x', target: { kind: 'maestro' } })).status).toBe(400);
  });

  it('refuses a target kind other than run or maestro, and a mode other than solo or team', async () => {
    const sent = await t.api('POST', '/api/http/send', { id: 'orders/list' });
    const id = sent.json.historyId;
    const bad = [
      { kind: 'chat' },
      { kind: 'run', bot: 'coder', mode: 'swarm' },
      { kind: 'run', bot: 'coder' },
      { kind: 'run', bot: 'ghost', mode: 'solo' },
      undefined,
    ];
    for (const target of bad) {
      const r = await t.api('POST', '/api/http/send-to-agent', { historyId: id, target, note: '' });
      expect(r.status, JSON.stringify(target)).toBe(400);
    }
    expect((await t.api('POST', '/api/http/send-to-agent', { historyId: id, target: { kind: 'run', bot: 'coder', mode: 'solo' }, note: 5 })).status).toBe(400);
  });
});
