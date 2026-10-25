import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tmp } from './helpers.js';
import { enc, startHttpTestServer } from './http-helpers.js';

let t: Awaited<ReturnType<typeof startHttpTestServer>>;
beforeAll(async () => (t = await startHttpTestServer()));
afterAll(() => t.close());

const file = { v: 1, name: 'List runs', method: 'GET', url: '{{base}}/api/runs', headers: [{ key: 'Authorization', value: 'Bearer {{tok}}', on: true }] };

describe('/api/http files', () => {
  it('answers 409 when there is no workspace at all', async () => {
    const bare = await startHttpTestServer({ register: false });
    try {
      expect(await bare.api('GET', '/api/http/tree')).toMatchObject({ status: 409, json: { error: 'no workspace' } });
    } finally {
      await bare.close();
    }
  });

  it('creates from a name, reads with resolved vars, replaces, moves and deletes', async () => {
    const c = await t.api('POST', '/api/http/requests', { collection: 'runs', file });
    expect(c).toMatchObject({ status: 201, json: { id: 'runs/list-runs' } });
    await t.api('PUT', '/api/http/collections/runs', { vars: { base: 'http://127.0.0.1:9' } });
    const got = await t.api('GET', `/api/http/requests/${enc('runs/list-runs')}?ws=api`);
    expect(got.status).toBe(200);
    expect(got.json.file.name).toBe('List runs');
    expect(got.json.vars).toEqual({ base: { source: { from: 'collection', path: 'runs' }, value: 'http://127.0.0.1:9' }, tok: null });
    expect((await t.api('PUT', `/api/http/requests/${enc('runs/list-runs')}`, { ...file, name: 'Renamed' })).json.file.name).toBe('Renamed');
    const tree = await t.api('GET', '/api/http/tree');
    expect(tree.json).toMatchObject({ workspace: 'api', activeEnv: null, environments: [] });
    expect(tree.json.root.collections[0].requests[0]).toMatchObject({ id: 'runs/list-runs', name: 'Renamed', method: 'GET' });
    expect((await t.api('POST', `/api/http/requests/${enc('runs/list-runs')}/move`, { to: 'old/list' })).json).toEqual({ id: 'old/list' });
    expect((await t.api('DELETE', `/api/http/requests/${enc('old/list')}`)).status).toBe(200);
    expect((await t.api('DELETE', `/api/http/requests/${enc('old/list')}`)).status).toBe(404);
  });

  it('returns an invalid file with its error and its text, for a read-only view', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(`${t.dir}/.aorch/http`, { recursive: true });
    writeFileSync(`${t.dir}/.aorch/http/broken.req.json`, '{ "name": "x", "method": "FETCH", "url": "u" }');
    const r = await t.api('GET', `/api/http/requests/${enc('broken')}`);
    expect(r.json).toEqual({ id: 'broken', error: 'unknown method "FETCH"', vars: {}, raw: '{ "name": "x", "method": "FETCH", "url": "u" }' });
  });

  it('refuses bad ids, bad bodies and unknown workspaces', async () => {
    expect(await t.api('GET', `/api/http/requests/${enc('../etc/passwd')}`)).toMatchObject({ status: 400, json: { error: 'invalid request id' } });
    expect(await t.api('PUT', `/api/http/requests/${enc('x')}`, { name: 'x', method: 'FETCH', url: 'u' })).toMatchObject({ status: 400, json: { error: 'unknown method "FETCH"' } });
    expect((await t.api('GET', '/api/http/tree?ws=nope')).status).toBe(404);
    expect((await t.api('GET', '/api/http/nothing-here')).status).toBe(404);
  });

  it('environments carry refs, never values; the active env is per workspace and cleared when deleted', async () => {
    expect((await t.api('PUT', '/api/http/environments/local', { vars: { base: 'http://127.0.0.1:9', tok: { secret: 'aorch_token' } } })).status).toBe(200);
    expect((await t.api('GET', '/api/http/environments/local')).json).toEqual({ name: 'local', v: 1, vars: { base: 'http://127.0.0.1:9', tok: { secret: 'aorch_token' } } });
    expect((await t.api('PUT', '/api/http/active-env', { name: 'nope' })).status).toBe(404);
    expect((await t.api('PUT', '/api/http/active-env', { name: 'local' })).json).toEqual({ activeEnv: 'local' });
    expect((await t.api('GET', '/api/http/tree')).json.activeEnv).toBe('local');
    expect(JSON.parse(readFileSync(join(t.home, 'ui.json'), 'utf8')).httpActiveEnv).toEqual({ api: 'local' });
    expect((await t.api('DELETE', '/api/http/environments/local')).status).toBe(200);
    expect((await t.api('GET', '/api/http/tree')).json.activeEnv).toBeNull();
    expect(JSON.parse(readFileSync(join(t.home, 'ui.json'), 'utf8')).httpActiveEnv ?? {}).toEqual({});
    expect((await t.api('DELETE', '/api/http/environments/local')).status).toBe(404);
  });

  it('secrets are write-only: keys listed, values never returned', async () => {
    expect((await t.api('PUT', '/api/http/secrets/aorch_token', { value: 'v4lue-XYZ' })).json).toEqual({ keys: ['aorch_token'] });
    const list = await t.api('GET', '/api/http/secrets');
    expect(list.json).toEqual({ keys: ['aorch_token'] });
    expect(list.text).not.toContain('v4lue-XYZ');
    expect((await t.api('PUT', '/api/http/secrets/1bad', { value: 'x' })).status).toBe(400);
    expect((await t.api('PUT', '/api/http/secrets/k', {})).status).toBe(400);
    expect((await t.api('DELETE', '/api/http/secrets/aorch_token')).json).toEqual({ keys: [] });
  });

  it('caps request bodies at 6 MB and refuses files over 1 MB, writing nothing', async () => {
    const big = { name: 'big', method: 'POST', url: 'http://h/', body: { kind: 'text', value: 'x'.repeat(6_100_000) } };
    // the server may close the socket before the upload finishes: only a reset or a broken pipe stands in for the 413.
    // Twice in a row: a half-read connection must not be reused for the next request (it used to hang).
    for (let i = 0; i < 2; i++) {
      const r = await t.api('PUT', `/api/http/requests/${enc('big')}`, big).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ECONNRESET' || e.code === 'EPIPE') return { status: 413, json: undefined, text: '' };
        throw e;
      });
      expect(r.status).toBe(413);
    }
    expect(existsSync(join(t.dir, '.aorch/http/big.req.json'))).toBe(false);
    // 2 MB passes the 6 MB body cap (the rest of the server keeps 1 MB) and is refused by the 1 MB file cap
    const s = await t.api('PUT', '/api/http/collections/bulk', { vars: { blob: 'x'.repeat(2_000_000) } });
    expect(s).toMatchObject({ status: 413, json: { error: 'file too large' } });
    expect(existsSync(join(t.dir, '.aorch/http/bulk/_collection.json'))).toBe(false);
    const q = await t.api('PUT', `/api/http/requests/${enc('mid')}`, { ...big, body: { kind: 'text', value: 'x'.repeat(2_000_000) } });
    expect(q).toMatchObject({ status: 413, json: { error: 'file too large' } });
    expect(existsSync(join(t.dir, '.aorch/http/mid.req.json'))).toBe(false);
  });
});

describe('/api/http load failures are reported, never hidden', () => {
  it('a secrets file other users can read answers 500 with the chmod hint', async () => {
    const s = await startHttpTestServer();
    try {
      expect((await s.api('PUT', '/api/http/secrets/tok', { value: 'v' })).status).toBe(200);
      expect((await s.api('POST', '/api/http/requests', { file })).json).toEqual({ id: 'list-runs' });
      chmodSync(join(s.home, 'secrets.json'), 0o644);
      const list = await s.api('GET', '/api/http/secrets');
      expect(list.status).toBe(500);
      expect(list.json.error).toContain('chmod 600');
      const got = await s.api('GET', `/api/http/requests/${enc('list-runs')}`);
      expect(got.status).toBe(500);
      expect(got.json.error).toContain('chmod 600');
    } finally {
      await s.close();
    }
  });

  it('an active environment gone from disk answers 409 on a read, not an empty set of vars', async () => {
    const s = await startHttpTestServer();
    try {
      await s.api('PUT', '/api/http/environments/stage', { vars: { base: 'http://127.0.0.1:9' } });
      await s.api('PUT', '/api/http/active-env', { name: 'stage' });
      await s.api('POST', '/api/http/requests', { file });
      const { rmSync } = await import('node:fs');
      rmSync(join(s.dir, '.aorch/http/environments/stage.json'));
      expect(await s.api('GET', `/api/http/requests/${enc('list-runs')}`)).toMatchObject({ status: 409, json: { error: 'no environment "stage"' } });
    } finally {
      await s.close();
    }
  });

  it('a symlinked .aorch/http is refused by the tree instead of listing as empty', async () => {
    const s = await startHttpTestServer();
    try {
      mkdirSync(join(s.dir, '.aorch'), { recursive: true });
      symlinkSync(tmp('outside-'), join(s.dir, '.aorch/http'));
      expect(await s.api('GET', '/api/http/tree')).toMatchObject({ status: 400, json: { error: 'symlinked .aorch' } });
    } finally {
      await s.close();
    }
  });
});
