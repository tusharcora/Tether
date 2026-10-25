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
    const calls: [string, string, unknown?][] = [
      ['GET', '/api/http/tree'],
      ['POST', '/api/http/requests', { collection: 'leak', file: { name: 'Leak', method: 'GET', url: '{{base}}/l?t={{tok}}', headers: [{ key: 'Authorization', value: 'Bearer {{tok}}' }] } }],
      ['GET', `/api/http/requests/${enc('echo/all')}`],
      ['GET', `/api/http/requests/${enc('leak/leak')}`],
      ['PUT', `/api/http/requests/${enc('leak/leak')}`, { name: 'Leak 2', method: 'GET', url: '{{base}}/l?t={{tok}}' }],
      ['POST', `/api/http/requests/${enc('leak/leak')}/move`, { to: 'leak/moved' }],
      ['DELETE', `/api/http/requests/${enc('leak/moved')}`],
      ['PUT', '/api/http/collections/echo', { vars: { ctok: { secret: 'aorch_token' } } }],
      ['GET', '/api/http/environments/local'],
      ['PUT', '/api/http/environments/local', { vars: { base: echoBase, tok: { secret: 'aorch_token' } } }],
      ['PUT', '/api/http/environments/throwaway', { vars: { t: { secret: 'aorch_token' } } }],
      ['DELETE', '/api/http/environments/throwaway'],
      ['PUT', '/api/http/active-env', { name: 'local' }],
      ['GET', '/api/http/secrets'],
      ['PUT', '/api/http/secrets/aorch_token', { value: SECRET }],
      ['PUT', '/api/http/secrets/spare', { value: SECRET }],
      ['DELETE', '/api/http/secrets/spare'],
      ['POST', '/api/http/send', { id: 'echo/all' }],
      ['POST', '/api/http/send', { draft: { name: 'd', method: 'GET', url: `{{base}}/p?q={{tok}}` } }],
      ['POST', '/api/http/send', { id: 'echo/all', draft: { name: 'd', method: 'POST', url: '{{base}}/e/{{tok}}', body: { kind: 'text', value: '{{tok}}' } } }],
      ['POST', '/api/http/send', { draft: { name: 'd', method: 'GET', url: 'http://{{tok}}.invalid/' } }],
      ['GET', '/api/http/history?limit=100'],
      ['GET', `/api/http/history?request=${enc('echo/all')}&limit=100`],
      ['POST', '/api/http/import', { kind: 'curl', text: curl, into: 'leakimp' }],
      ['POST', '/api/http/import/apply', { kind: 'curl', text: curl, into: 'leakimp', confirm: true }],
      ['GET', `/api/http/requests/${enc('leakimp/post-z')}`],
      ['GET', '/api/http/tree'],
    ];
    for (const [m, path, body] of calls) {
      const r = await t.api(m, path, body);
      expect(r.status, `${m} ${path}`).toBeLessThan(500);
      expect(r.text, `${m} ${path}`).not.toContain(SECRET);
      expect(r.text, `${m} ${path}`).not.toContain(encodeURIComponent(SECRET));
    }
  });
});
