import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getHistory, insertHistory, listHistory } from '../src/http/history.js';
import { activeEnv, runRequest, setActiveEnv } from '../src/http/index.js';
import { setSecret } from '../src/http/secrets.js';
import { writeEnvironment, writeRequest } from '../src/http/store.js';
import { loadPrefs } from '../src/prefs.js';
import { Store } from '../src/store.js';
import { tmp } from './helpers.js';

let srv: Server;
let base = '';
beforeAll(async () => {
  srv = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=cookie-value-xyz', 'x-api-key': 'apikey-value-xyz' });
    res.end(JSON.stringify({ auth: req.headers.authorization ?? null, url: req.url }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => srv.close());

function fixture() {
  const home = tmp('home-');
  const dir = tmp('proj-');
  const db = Store.open(':memory:').raw();
  writeEnvironment(dir, 'local', { vars: { base, tok: { secret: 'aorch_token' } } });
  writeRequest(dir, 'runs/list', { name: 'List', method: 'GET', url: '{{base}}/api/runs', headers: [{ key: 'Authorization', value: 'Bearer {{tok}}' }], checks: [{ kind: 'status', op: 'eq', value: 200 }, { kind: 'json', path: '$.auth', op: 'exists' }] });
  setSecret(home, 'api', 'aorch_token', 'S3CRET-abc');
  return { home, dir, db };
}

describe('runRequest', () => {
  it('sends a saved request with the active environment and redacts what it returns and stores', async () => {
    const { home, dir, db } = fixture();
    setActiveEnv(home, 'api', 'local');
    expect(activeEnv(home, 'api')).toBe('local');
    const out = await runRequest({ home, db, workspace: 'api', dir, id: 'runs/list', source: 'ui', allowSecrets: true });
    expect(out.result.status).toBe(200);
    expect(out.checks.map((c) => c.ok)).toEqual([true, true]);
    expect(JSON.parse(out.result.body).auth).toBe('Bearer {{secret:aorch_token}}');
    expect(out.request.headers).toContainEqual(['Authorization', 'Bearer {{secret:aorch_token}}']);
    const row = getHistory(db, 'api', out.historyId)!;
    expect(row).toMatchObject({ request: 'runs/list', source: 'ui', method: 'GET', status: 200, ok: true, url: `${base}/api/runs` });
    expect(JSON.stringify(row)).not.toContain('S3CRET-abc');
    expect(JSON.stringify(out)).not.toContain('S3CRET-abc');
  });

  it('keeps the active environment per workspace in ui.json, and clears it', () => {
    const home = tmp('home-');
    setActiveEnv(home, 'api', 'local');
    setActiveEnv(home, 'web', 'stage');
    expect(loadPrefs(home).httpActiveEnv).toEqual({ api: 'local', web: 'stage' });
    setActiveEnv(home, 'api', null);
    expect(activeEnv(home, 'api')).toBeNull();
    expect(activeEnv(home, 'web')).toBe('stage');
  });

  it('refuses secrets for a draft that is not allowed them', async () => {
    const { home, dir, db } = fixture();
    await expect(runRequest({ home, db, workspace: 'api', dir, env: 'local', draft: { name: 'x', method: 'GET', url: '{{base}}/x', headers: [{ key: 'A', value: '{{tok}}' }] }, source: 'cli', allowSecrets: false })).rejects.toThrow('secret not available for ad-hoc requests');
    const ok = await runRequest({ home, db, workspace: 'api', dir, env: 'local', draft: { name: 'x', method: 'GET', url: '{{base}}/x' }, source: 'cli', allowSecrets: false });
    expect(ok.result.status).toBe(200);
    expect(getHistory(db, 'api', ok.historyId)!.request).toBeNull();
  });

  it('a dirty send of a saved request (draft + id) keeps the request id in history', async () => {
    const { home, dir, db } = fixture();
    const out = await runRequest({ home, db, workspace: 'api', dir, id: 'runs/list', env: 'local', draft: { name: 'List', method: 'GET', url: '{{base}}/api/runs?edited=1' }, source: 'ui', allowSecrets: true });
    expect(JSON.parse(out.result.body).url).toBe('/api/runs?edited=1');
    expect(getHistory(db, 'api', out.historyId)!.request).toBe('runs/list');
    expect(listHistory(db, { workspace: 'api', request: 'runs/list' }).map((r) => r.id)).toEqual([out.historyId]);
  });

  it('masks a credential header in a header check\'s actual, in the result and in history', async () => {
    const { home, dir, db } = fixture();
    writeRequest(dir, 'hdr', {
      name: 'hdr',
      method: 'GET',
      url: `${base}/h`,
      checks: [
        { kind: 'header', name: 'Set-Cookie', op: 'exists' },
        { kind: 'header', name: 'x-api-key', op: 'contains', value: 'apikey' },
        { kind: 'header', name: 'content-type', op: 'exists' },
      ],
    });
    const out = await runRequest({ home, db, workspace: 'api', dir, id: 'hdr', env: null, source: 'cli', allowSecrets: true });
    expect(out.checks.map((c) => c.ok)).toEqual([true, true, true]);
    expect(out.checks.map((c) => c.actual)).toEqual(['•••• (20 chars)', '•••• (16 chars)', 'application/json']);
    const row = JSON.stringify(getHistory(db, 'api', out.historyId));
    for (const leak of ['cookie-value-xyz', 'apikey-value-xyz']) {
      expect(JSON.stringify(out)).not.toContain(leak);
      expect(row).not.toContain(leak);
    }
  });

  it('fails clearly on an invalid request file and on a stale active environment', async () => {
    const { home, dir, db } = fixture();
    writeRequest(dir, 'ok', { name: 'ok', method: 'GET', url: 'http://127.0.0.1:1/' });
    setActiveEnv(home, 'api', 'gone');
    await expect(runRequest({ home, db, workspace: 'api', dir, id: 'ok', source: 'ui', allowSecrets: true })).rejects.toThrow('no environment "gone"');
    await expect(runRequest({ home, db, workspace: 'api', dir, id: 'missing', env: null, source: 'ui', allowSecrets: true })).rejects.toThrow('no request "missing"');
    expect(listHistory(db, { workspace: 'api' })).toEqual([]);
  });

  it('never leaks a secret that ends up in a network error message', async () => {
    const { home, dir, db } = fixture();
    setSecret(home, 'api', 'host_secret', 'leakyhost123');
    writeRequest(dir, 'bad-host', { name: 'bad', method: 'GET', url: 'http://{{host_secret}}.invalid/' });
    const out = await runRequest({ home, db, workspace: 'api', dir, id: 'bad-host', env: null, source: 'ui', allowSecrets: true });
    expect(out.result.status).toBe(0);
    expect(out.result.error?.kind).toBe('dns');
    expect(out.result.error?.message).toContain('{{secret:host_secret}}');
    expect(JSON.stringify(out)).not.toContain('leakyhost123');
    expect(JSON.stringify(getHistory(db, 'api', out.historyId))).not.toContain('leakyhost123');
  });
});

describe('history', () => {
  it('keeps the newest rows per workspace and lists newest first', () => {
    const db = Store.open(':memory:').raw();
    const data = (n: number) => ({ request: { method: 'GET' as const, url: `u${n}`, headers: [] }, response: { status: 200, statusText: '', url: '', headers: [], body: '', size: 1, truncated: false, ms: n, timing: { ttfb: 0, download: 0 }, redirects: [] }, checks: [] });
    for (let n = 1; n <= 7; n++) insertHistory(db, { workspace: 'a', request: n % 2 ? 'r/odd' : null, source: 'ui', data: data(n), ok: null }, 5);
    insertHistory(db, { workspace: 'b', request: null, source: 'cli', data: data(99), ok: true }, 5);
    expect(listHistory(db, { workspace: 'a', limit: 100 }).map((r) => r.url)).toEqual(['u7', 'u6', 'u5', 'u4', 'u3']);
    expect(listHistory(db, { workspace: 'a', request: 'r/odd' }).map((r) => r.url)).toEqual(['u7', 'u5', 'u3']);
    expect(listHistory(db, { workspace: 'b' })[0]).toMatchObject({ source: 'cli', ok: true });
    expect(listHistory(db, { workspace: 'a', limit: 1000 }).length).toBeLessThanOrEqual(100);
    expect(getHistory(db, 'b', listHistory(db, { workspace: 'a' })[0]!.id)).toBeUndefined(); // rows stay in their workspace
  });
});
