import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enc, startHttpTestServer } from './http-helpers.js';

let t: Awaited<ReturnType<typeof startHttpTestServer>>;
let echo: Server;
let echoBase = '';
const SECRET = `s3-${randomBytes(12).toString('hex')}`;

beforeAll(async () => {
  t = await startHttpTestServer();
  // echoes everything it got, and hands the secret back in headers too
  echo = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `sid=${SECRET}`, 'x-echo': String(req.headers.authorization ?? '') });
    res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
  });
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
  echoBase = `http://127.0.0.1:${(echo.address() as AddressInfo).port}`;
  await t.api('PUT', '/api/http/secrets/aorch_token', { value: SECRET });
  await t.api('PUT', '/api/http/environments/local', { vars: { base: echoBase, tok: { secret: 'aorch_token' } } });
  await t.api('PUT', '/api/http/active-env', { name: 'local' });
  await t.api('PUT', `/api/http/requests/${enc('echo/all')}`, {
    name: 'Echo all',
    method: 'POST',
    url: '{{base}}/x?k={{tok}}',
    headers: [{ key: 'Authorization', value: 'Bearer {{tok}}' }, { key: 'X-Plain', value: '{{tok}}' }],
    body: { kind: 'json', value: { nested: { t: '{{tok}}' } } },
    checks: [{ kind: 'status', op: 'eq', value: 200 }, { kind: 'json', path: '$.body', op: 'contains', value: 'nested' }],
  });
});
afterAll(async () => {
  echo.close();
  await t.close();
});

describe('/api/http send, history, import', () => {
  it('sends a saved request and returns the redacted result with checks', async () => {
    const r = await t.api('POST', '/api/http/send', { id: 'echo/all' });
    expect(r.status).toBe(200);
    expect(r.json.result.status).toBe(200);
    expect(r.json.checks.map((c: { ok: boolean }) => c.ok)).toEqual([true, true]);
    expect(typeof r.json.historyId).toBe('number');
    expect(JSON.parse(r.json.result.body).url).toBe('/x?k={{secret:aorch_token}}');
  });

  it('sends a draft (unsaved edits) with the UI allowed to use secrets', async () => {
    const r = await t.api('POST', '/api/http/send', { draft: { name: 'd', method: 'GET', url: '{{base}}/draft', headers: [{ key: 'X-T', value: '{{tok}}' }] } });
    expect(r.json.result.status).toBe(200);
  });

  it('reports unknown variables with every name', async () => {
    const r = await t.api('POST', '/api/http/send', { draft: { name: 'd', method: 'GET', url: '{{nope}}/{{also}}' } });
    expect(r).toMatchObject({ status: 400, json: { error: 'unknown variables: nope, also' } });
  });

  it('refuses a send body without a request, and a missing saved request is a 404', async () => {
    expect(await t.api('POST', '/api/http/send', {})).toMatchObject({ status: 400, json: { error: 'send needs "id" or "draft"' } });
    expect((await t.api('POST', '/api/http/send', { id: 42 })).status).toBe(400);
    expect((await t.api('POST', '/api/http/send', { id: 'echo/all', env: 7 })).status).toBe(400);
    expect((await t.api('POST', '/api/http/send', { id: 'nope/none' })).status).toBe(404);
  });

  it('a draft that is not an object is a 400, not a 500', async () => {
    for (const draft of ['x', [], 42, null]) {
      const r = await t.api('POST', '/api/http/send', { draft });
      expect(r.status, JSON.stringify(draft)).toBe(400);
      expect(typeof r.json.error).toBe('string');
    }
  });

  it('lists history, newest first, filtered by request, limit capped at 100', async () => {
    const h = await t.api('GET', `/api/http/history?request=${enc('echo/all')}&limit=500`);
    expect(h.status).toBe(200);
    expect(h.json.length).toBeGreaterThanOrEqual(1);
    expect(h.json[0]).toMatchObject({ request: 'echo/all', source: 'ui', status: 200, ok: true });
  });

  it('a limit that is not a finite number falls back to the default instead of reaching SQL', async () => {
    for (const q of ['abc', 'Infinity', '', '-5', '0', '2.7']) {
      const h = await t.api('GET', `/api/http/history?limit=${q}`);
      expect(h.status, q).toBe(200);
      expect(Array.isArray(h.json), q).toBe(true);
    }
    expect((await t.api('GET', '/api/http/history?limit=1')).json).toHaveLength(1);
  });

  it('with both id and draft, the draft is what is sent and history keeps the id', async () => {
    const r = await t.api('POST', '/api/http/send', { id: 'echo/all', draft: { name: 'dirty', method: 'PUT', url: '{{base}}/dirty' } });
    expect(r.status).toBe(200);
    const echoed = JSON.parse(r.json.result.body);
    expect(echoed).toMatchObject({ method: 'PUT', url: '/dirty' });
    const h = await t.api('GET', `/api/http/history?request=${enc('echo/all')}&limit=1`);
    expect(h.json[0]).toMatchObject({ id: r.json.historyId, request: 'echo/all', method: 'PUT' });
  });

  it('previews an import, refuses to apply without confirm, then applies', async () => {
    const text = `curl -X POST '${echoBase}/orders' -H 'Content-Type: application/json' -d '{"a":1}'`;
    const pv = await t.api('POST', '/api/http/import', { kind: 'curl', text, into: 'imported' });
    expect(pv.json.create.map((c: { id: string }) => c.id)).toEqual(['imported/post-orders']);
    expect((await t.api('POST', '/api/http/import/apply', { kind: 'curl', text, into: 'imported' })).status).toBe(400);
    expect((await t.api('POST', '/api/http/import/apply', { kind: 'curl', text, into: 'imported', confirm: true })).json).toEqual({ created: ['imported/post-orders'] });
    expect((await t.api('POST', '/api/http/import', { kind: 'curl', text: 'nope' })).json.error).toMatch(/not a curl command/);
    expect((await t.api('POST', '/api/http/import', { kind: 'soap', text })).status).toBe(400);
    expect((await t.api('POST', '/api/http/import/apply', { kind: 'curl', text: 'nope', confirm: true })).status).toBe(400);
  });

  it('a stale active environment (file removed on disk) fails the send with 409 and its name instead of sending without it', async () => {
    await t.api('PUT', '/api/http/environments/stage', { vars: { base: echoBase } });
    await t.api('PUT', '/api/http/active-env', { name: 'stage' });
    rmSync(join(t.dir, '.aorch/http/environments/stage.json'));
    expect(await t.api('POST', '/api/http/send', { id: 'echo/all' })).toMatchObject({ status: 409, json: { error: 'no environment "stage"' } });
    expect(await t.api('POST', '/api/http/send', { draft: { name: 'd', method: 'GET', url: 'http://127.0.0.1:9/' } })).toMatchObject({ status: 409, json: { error: 'no environment "stage"' } });
    await t.api('PUT', '/api/http/active-env', { name: 'local' });
  });

  it('never returns the secret value from any route', async () => {
    const curl = `curl -X POST ${echoBase}/z -H 'Authorization: Bearer ${SECRET}' -H 'X-Api-Key: ${SECRET}'`;
    // every call has its exact status, so a broken route or a broken chain (slug, move, import id) fails here
    const calls: [number, string, string, unknown?][] = [
      [200, 'GET', '/api/http/tree'],
      [201, 'POST', '/api/http/requests', { collection: 'leak', file: { name: 'Leak', method: 'GET', url: '{{base}}/l?t={{tok}}', headers: [{ key: 'Authorization', value: 'Bearer {{tok}}' }] } }],
      [200, 'GET', `/api/http/requests/${enc('echo/all')}`],
      [200, 'GET', `/api/http/requests/${enc('leak/leak')}`],
      [200, 'PUT', `/api/http/requests/${enc('leak/leak')}`, { name: 'Leak 2', method: 'GET', url: '{{base}}/l?t={{tok}}' }],
      [200, 'POST', `/api/http/requests/${enc('leak/leak')}/move`, { to: 'leak/moved' }],
      [200, 'DELETE', `/api/http/requests/${enc('leak/moved')}`],
      [200, 'PUT', '/api/http/collections/echo', { vars: { cv: 'x-{{tok}}' } }],
      [200, 'GET', '/api/http/environments/local'],
      [200, 'PUT', '/api/http/environments/local', { vars: { base: echoBase, tok: { secret: 'aorch_token' } } }],
      [200, 'PUT', '/api/http/environments/throwaway', { vars: { t: { secret: 'aorch_token' } } }],
      [200, 'DELETE', '/api/http/environments/throwaway'],
      [200, 'PUT', '/api/http/active-env', { name: 'local' }],
      [200, 'GET', '/api/http/secrets'],
      [200, 'PUT', '/api/http/secrets/aorch_token', { value: SECRET }],
      [200, 'PUT', '/api/http/secrets/spare', { value: SECRET }],
      [200, 'DELETE', '/api/http/secrets/spare'],
      [200, 'POST', '/api/http/send', { id: 'echo/all' }],
      [200, 'POST', '/api/http/send', { draft: { name: 'd', method: 'GET', url: `{{base}}/p?q={{tok}}` } }],
      [200, 'POST', '/api/http/send', { id: 'echo/all', draft: { name: 'd', method: 'POST', url: '{{base}}/e/{{tok}}', body: { kind: 'text', value: '{{tok}}' } } }],
      [200, 'POST', '/api/http/send', { draft: { name: 'd', method: 'GET', url: 'http://{{tok}}.invalid/' } }],
      [200, 'GET', '/api/http/history?limit=100'],
      [200, 'GET', `/api/http/history?request=${enc('echo/all')}&limit=100`],
      [200, 'POST', '/api/http/import', { kind: 'curl', text: curl, into: 'leakimp' }],
      [200, 'POST', '/api/http/import/apply', { kind: 'curl', text: curl, into: 'leakimp', confirm: true }],
      [200, 'GET', `/api/http/requests/${enc('leakimp/post-z')}`],
      [200, 'GET', '/api/http/tree'],
      // the web export never includes secrets (only the CLI has --with-secrets)
      [200, 'GET', '/api/workspaces/api/export'],
    ];
    for (const [status, m, path, body] of calls) {
      const r = await t.api(m, path, body);
      expect(r.status, `${m} ${path}: ${r.text.slice(0, 200)}`).toBe(status);
      expect(r.text, `${m} ${path}`).not.toContain(SECRET);
      expect(r.text, `${m} ${path}`).not.toContain(encodeURIComponent(SECRET));
    }
  });

  it('send-to-agent never puts the secret value in the route response, the prompt or the run events', async () => {
    const sent = await t.api('POST', '/api/http/send', { id: 'echo/all' });
    expect(sent.status).toBe(200);
    const r = await t.api('POST', '/api/http/send-to-agent', { historyId: sent.json.historyId, target: { kind: 'run', bot: 'coder', mode: 'solo' }, note: 'look' });
    expect(r.status, r.text).toBe(201);
    expect(r.text).not.toContain(SECRET);
    await t.engine.wait(r.json.runId);
    const prompt = t.mock.calls.find((c) => c.nodeId === 'look')!.prompt;
    expect(prompt).toContain('<http-exchange>');
    expect(prompt).toContain('{{secret:aorch_token}}');
    expect(prompt).not.toContain(SECRET);
    expect(JSON.stringify(t.store.events(r.json.runId))).not.toContain(SECRET);
  });
});
