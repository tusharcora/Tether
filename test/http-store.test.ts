import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpClientError } from '../src/http/errors.js';
import { checkPath, collectionChain, isStorePath, createRequest, deleteEnvironment, httpRoot, listEnvironments, moveRequest, readEnvironment, readRequest, readTree, slugify, writeCollection, writeEnvironment, writeRequest } from '../src/http/store.js';
import { tmp } from './helpers.js';

const req = (o: Record<string, unknown> = {}) => ({ v: 1, name: 'List runs', method: 'GET', url: '{{base}}/api/runs', ...o });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpClientError ? `${e.code}: ${e.message}` : `plain: ${(e as Error).message}`;
  }
  return 'no error';
};

describe('http store', () => {
  it('writes, reads and lists requests in a tree with collections', () => {
    const dir = tmp('proj-');
    const saved = writeRequest(dir, 'runs/list', req({ checks: [{ kind: 'status', op: 'eq', value: 200 }], notes: 'All runs\nmore' }));
    expect(saved).toMatchObject({ v: 1, method: 'GET', query: [], headers: [], body: { kind: 'none' }, vars: {} });
    writeRequest(dir, 'health', req({ name: 'Health', method: 'head', url: 'http://x/h' }));
    const t = readTree(dir);
    expect(t.root.requests.map((r) => [r.id, r.method])).toEqual([['health', 'HEAD']]);
    expect(t.root.collections[0]).toMatchObject({ path: 'runs', name: 'runs', requests: [{ id: 'runs/list', name: 'List runs', method: 'GET', url: '{{base}}/api/runs', note: 'All runs' }] });
    expect(readRequest(dir, 'runs/list').file?.checks).toEqual([{ kind: 'status', op: 'eq', value: 200 }]);
  });

  it('lists an invalid file with its error and never throws for it', () => {
    const dir = tmp('proj-');
    mkdirSync(httpRoot(dir), { recursive: true });
    writeFileSync(join(httpRoot(dir), 'bad.req.json'), '{ "name": "x", "method": "FETCH", "url": "u" }');
    writeFileSync(join(httpRoot(dir), 'broken.req.json'), '{ not json');
    const t = readTree(dir);
    expect(t.root.requests.find((r) => r.id === 'bad')).toMatchObject({ method: '?', invalid: 'unknown method "FETCH"' });
    expect(t.root.requests.find((r) => r.id === 'broken')!.invalid).toMatch(/JSON/);
    expect(readRequest(dir, 'bad').error).toBe('unknown method "FETCH"');
  });

  it('refuses bad ids: traversal, absolute, uppercase, too deep, under environments/', () => {
    for (const id of ['../x', '/abs', 'A/b', 'a b', 'a/b/c/d/e/f', 'environments/x', '', 'x/.hidden']) expect(code(() => checkPath(id, 'request'))).toBe('invalid: invalid request id');
    expect(checkPath('a/b/c/d/e', 'request')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(checkPath('', 'collection')).toEqual([]);
  });

  it('refuses symlinks that leave .aorch/http', () => {
    const dir = tmp('proj-');
    const outside = tmp('outside-');
    mkdirSync(httpRoot(dir), { recursive: true });
    symlinkSync(outside, join(httpRoot(dir), 'evil'));
    expect(code(() => writeRequest(dir, 'evil/x', req()))).toBe('invalid: invalid request id');
    writeFileSync(join(outside, 'secret.json'), '{}');
    symlinkSync(join(outside, 'secret.json'), join(httpRoot(dir), 'link.req.json'));
    expect(code(() => readRequest(dir, 'link'))).toBe('invalid: invalid request id');
    expect(readTree(dir).root.requests).toEqual([]);
  });

  it('validates the request shape with precise messages', () => {
    const dir = tmp('proj-');
    expect(code(() => writeRequest(dir, 'x', req({ name: '' })))).toBe('invalid: "name" must be one line, 1–120 characters');
    expect(code(() => writeRequest(dir, 'x', req({ body: { kind: 'file' } })))).toBe('invalid: body.kind must be none, json, text or form');
    expect(code(() => writeRequest(dir, 'x', req({ checks: [{ kind: 'body', op: 'matches', value: 'x'.repeat(201) }] })))).toMatch(/200 characters/);
    expect(code(() => writeRequest(dir, 'x', req({ checks: [{ kind: 'json', path: 'a.b', op: 'exists' }] })))).toMatch(/starting with \$/);
    expect(code(() => writeRequest(dir, 'x', req({ headers: [{ key: 'A', value: 'b\nc' }] })))).toMatch(/one line/);
  });

  it('creates with a slug from the name, unique within the collection', () => {
    const dir = tmp('proj-');
    expect(createRequest(dir, 'runs', req({ name: 'List Runs!' }))).toBe('runs/list-runs');
    expect(createRequest(dir, 'runs', req({ name: 'List Runs!' }))).toBe('runs/list-runs-2');
    expect(slugify('  ÉCHO / ping ')).toBe('echo-ping');
    expect(slugify('***')).toBe('request');
  });

  it('moves, and refuses to overwrite', () => {
    const dir = tmp('proj-');
    writeRequest(dir, 'a', req());
    writeRequest(dir, 'b', req());
    expect(code(() => moveRequest(dir, 'a', 'b'))).toBe('conflict: "b" already exists');
    moveRequest(dir, 'a', 'runs/a');
    expect(readRequest(dir, 'runs/a').file?.name).toBe('List runs');
    expect(code(() => readRequest(dir, 'a'))).toBe('not_found: no request "a"');
  });

  it('chains collection files innermost first', () => {
    const dir = tmp('proj-');
    writeCollection(dir, '', { vars: { base: 'root' }, headers: [{ key: 'X-A', value: '1' }] });
    writeCollection(dir, 'runs', { vars: { base: 'inner' } });
    writeRequest(dir, 'runs/list', req());
    expect(collectionChain(dir, 'runs/list').map((c) => [c.path, c.file.vars.base])).toEqual([['runs', 'inner'], ['', 'root']]);
  });

  it('stores environments with secret refs and refuses bad names', () => {
    const dir = tmp('proj-');
    writeEnvironment(dir, 'local', { vars: { base: 'http://127.0.0.1:4177', aorch_token: { secret: 'aorch_token' } } });
    expect(listEnvironments(dir)).toEqual(['local']);
    expect(readEnvironment(dir, 'local')).toEqual({ v: 1, vars: { base: 'http://127.0.0.1:4177', aorch_token: { secret: 'aorch_token' } } });
    expect(code(() => writeEnvironment(dir, 'Prod', { vars: {} }))).toBe('invalid: invalid environment name');
    expect(code(() => writeEnvironment(dir, 'prod', { vars: { t: { secret: '1bad' } } }))).toMatch(/secret/);
    expect(code(() => readEnvironment(dir, 'nope'))).toBe('not_found: no environment "nope"');
    expect(deleteEnvironment(dir, 'local')).toBe(true);
    expect(listEnvironments(dir)).toEqual([]);
  });

  it('refuses a symlinked .aorch or .aorch/http even when it points outside the project', () => {
    const outside = tmp('outside-');
    writeFileSync(join(outside, 'x.req.json'), JSON.stringify(req()));
    const viaHttp = tmp('proj-');
    mkdirSync(join(viaHttp, '.aorch'));
    symlinkSync(outside, httpRoot(viaHttp));
    expect(code(() => writeRequest(viaHttp, 'y', req()))).toBe('invalid: invalid request id');
    expect(code(() => readRequest(viaHttp, 'x'))).toBe('invalid: invalid request id');
    expect(code(() => writeEnvironment(viaHttp, 'local', { vars: {} }))).toBe('invalid: invalid request id');
    expect(existsSync(join(outside, 'y.req.json'))).toBe(false);
    expect(code(() => readTree(viaHttp))).toBe('invalid: symlinked .aorch');
    expect(code(() => listEnvironments(viaHttp))).toBe('invalid: symlinked .aorch');
    const viaAorch = tmp('proj-');
    mkdirSync(join(outside, 'http'));
    symlinkSync(outside, join(viaAorch, '.aorch'));
    expect(code(() => writeRequest(viaAorch, 'y', req()))).toBe('invalid: invalid request id');
    expect(existsSync(join(outside, 'http', 'y.req.json'))).toBe(false);
    expect(code(() => readTree(viaAorch))).toBe('invalid: symlinked .aorch');
    expect(code(() => listEnvironments(viaAorch))).toBe('invalid: symlinked .aorch');
  });

  it('refuses a dangling symlink anywhere on the path with the usual error, not a raw ENOENT', () => {
    const dir = tmp('proj-');
    mkdirSync(httpRoot(dir), { recursive: true });
    symlinkSync(join(tmp('gone-'), 'missing'), join(httpRoot(dir), 'dangling'));
    expect(code(() => writeRequest(dir, 'dangling/x', req()))).toBe('invalid: invalid request id');
    expect(code(() => readRequest(dir, 'dangling/x'))).toBe('invalid: invalid request id');
    expect(code(() => writeCollection(dir, 'dangling', { vars: {} }))).toBe('invalid: invalid request id');
    symlinkSync(join(tmp('gone-'), 'missing.req.json'), join(httpRoot(dir), 'stale.req.json'));
    expect(code(() => writeRequest(dir, 'stale', req()))).toBe('invalid: invalid request id');
    expect(code(() => readRequest(dir, 'stale'))).toBe('invalid: invalid request id');
  });

  it('refuses to write a file larger than 1 MB and writes nothing', () => {
    const dir = tmp('proj-');
    expect(code(() => writeRequest(dir, 'big', req({ body: { kind: 'text', value: 'x'.repeat(1_000_001) } })))).toBe('too_large: file too large');
    expect(existsSync(join(httpRoot(dir), 'big.req.json'))).toBe(false);
    expect(existsSync(join(httpRoot(dir), 'big.req.json.tmp'))).toBe(false);
    expect(code(() => writeCollection(dir, '', { vars: { big: 'x'.repeat(1_000_001) } }))).toBe('too_large: file too large');
  });
});

describe('isStorePath', () => {
  it('accepts exactly the request, collection and environment files the store reads', () => {
    for (const p of ['a.req.json', 'runs/list.req.json', 'a/b/c/d/e.req.json', '_collection.json', 'shop/_collection.json', 'a/b/c/d/_collection.json', 'environments/local.json', 'environments/stage.v2.json', 'environments/x.req.json'])
      expect(isStorePath(p), p).toBe(true);
    for (const p of ['', 'notes.json', 'a.txt', '../evil.req.json', '/abs.req.json', 'a/../b.req.json', 'A/b.req.json', 'a\\b.req.json', 'a/b/c/d/e/f.req.json', 'a/b/c/d/e/_collection.json', 'x/_y.json', 'environments/a/b.json', 'environments/_collection.json', 'environments.req.json', 'environments/.json'])
      expect(isStorePath(p), p).toBe(false);
  });
});
