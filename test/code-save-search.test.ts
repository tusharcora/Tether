import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CREW } from '../src/bots.js';
import { saveCode } from '../src/code.js';
import { searchNames, searchText } from '../src/codeSearch.js';
import { HttpError } from '../src/serverkit.js';
import { rgVersion } from '../src/tools.js';
import { initWorkspace } from '../src/workspace.js';
import { enc, startHttpTestServer } from './http-helpers.js';
import { pipe, tmp } from './helpers.js';

const status = (fn: () => unknown): { status?: number; [k: string]: unknown } | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? { status: e.status, error: e.message, ...e.extra } : { thrown: String(e) };
  }
  return undefined;
};

describe('saveCode', () => {
  const root = realpathSync(tmp('save-'));
  it('replaces the file atomically, keeps its mode and leaves no temp file', () => {
    writeFileSync(join(root, 'run.sh'), 'echo 1\n');
    chmodSync(join(root, 'run.sh'), 0o755);
    const before = statSync(join(root, 'run.sh')).mtimeMs;
    const r = saveCode(root, 'run.sh', 'echo 2\n', before);
    expect(readFileSync(join(root, 'run.sh'), 'utf8')).toBe('echo 2\n');
    expect(statSync(join(root, 'run.sh')).mode & 0o777).toBe(0o755);
    expect(r).toEqual({ mtimeMs: statSync(join(root, 'run.sh')).mtimeMs, size: 7 });
    expect(readdirSync(root)).toEqual(['run.sh']);
  });
  it('refuses with 409 changed-on-disk when the file moved on since it was read; without a base it overwrites', () => {
    writeFileSync(join(root, 'a.ts'), 'one');
    const stale = statSync(join(root, 'a.ts')).mtimeMs - 1000;
    expect(status(() => saveCode(root, 'a.ts', 'mine', stale))).toEqual({ status: 409, error: 'changed-on-disk', mtimeMs: statSync(join(root, 'a.ts')).mtimeMs });
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('one');
    saveCode(root, 'a.ts', 'mine');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('mine');
  });
  it('refuses secrets (403), missing files (404) and unsafe paths', () => {
    writeFileSync(join(root, '.env'), 'K=1');
    expect(status(() => saveCode(root, '.env', 'K=2'))?.status).toBe(403);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('K=1');
    expect(status(() => saveCode(root, 'nope.ts', 'x'))?.status).toBe(404);
    expect(status(() => saveCode(root, '../x', 'x'))?.status).toBe(400);
  });
});

describe('the save route and the run-writing lock', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('saves through PUT, and answers 423 while a live run writes in this very checkout', async () => {
    const s = await startHttpTestServer({ register: false });
    close = s.close;
    const dir = realpathSync(tmp('checkout-'));
    writeFileSync(join(dir, 'a.ts'), 'one');
    initWorkspace(s.home, dir, { id: 'shop', write: false });
    const { json: file } = await s.api('GET', '/api/code/file?ws=shop&path=a.ts');
    expect(file.lock).toBeUndefined();
    const ok = await s.api('PUT', '/api/code/file', { ws: 'shop', path: 'a.ts', text: 'two', baseMtimeMs: file.mtimeMs });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ path: 'a.ts', size: 3 });

    const pl = pipe([{ id: 'plan', role: 'planner', readOnly: true }, { id: 'code', role: 'coder' }], [['plan', 'code']]);
    s.store.append('r-9', { type: 'run.started', pipeline: pl, task: 't', repo: dir, workdir: dir, baseSha: 'a', branch: 'b' });
    s.store.append('r-9', { type: 'node.started', node: 'plan', attempt: 1 });
    expect((await s.api('PUT', '/api/code/file', { ws: 'shop', path: 'a.ts', text: 'three' })).status).toBe(200);
    s.store.append('r-9', { type: 'node.finished', node: 'plan', status: 'done', output: '', durationMs: 1, attempt: 1 });
    s.store.append('r-9', { type: 'node.started', node: 'code', attempt: 1 });
    const locked = await s.api('PUT', '/api/code/file', { ws: 'shop', path: 'a.ts', text: 'four' });
    expect(locked.status).toBe(423);
    expect(locked.json).toEqual({ error: 'run-writing', runId: 'r-9', node: 'code', bot: CREW.coder!.name });
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('three');
    expect((await s.api('GET', '/api/code/file?ws=shop&path=a.ts')).json.lock).toEqual({ runId: 'r-9', node: 'code', bot: CREW.coder!.name });
  });

  it('checks the body', async () => {
    const s = await startHttpTestServer();
    close = s.close;
    expect((await s.api('PUT', '/api/code/file', { ws: 'api', path: 'README.md' })).status).toBe(400);
    expect((await s.api('PUT', '/api/code/file', { ws: 'api', path: 'README.md', text: 'x', baseMtimeMs: 'now' })).status).toBe(400);
  });
});

describe('search', () => {
  const root = realpathSync(tmp('search-'));
  mkdirSync(join(root, 'src', 'http'), { recursive: true });
  writeFileSync(join(root, 'src', 'http', 'limit.ts'), 'const MAX_CALLS = 120;\nexport function limit() {}\n');
  writeFileSync(join(root, 'src', 'server.ts'), 'import { limit } from "./http/limit.js";\n');
  writeFileSync(join(root, 'README.md'), '# Limits\n');
  writeFileSync(join(root, '.env'), 'LIMIT_KEY=secret\n');
  writeFileSync(join(root, 'many.txt'), 'limit\n'.repeat(250));

  it('finds files by a fuzzy name, best first, never secrets', async () => {
    const r = await searchNames(root, 'limit');
    expect(r.hits[0]).toEqual({ path: 'src/http/limit.ts' });
    expect(r.hits.map((h) => h.path)).not.toContain('.env');
    expect((await searchNames(root, 'shtl')).hits.map((h) => h.path)).toContain('src/http/limit.ts');
    expect((await searchNames(root, 'zzz')).hits).toEqual([]);
  });

  const textSearch = (rg: string | null) => async () => {
    const r = await searchText(root, 'MAX_CALLS', { rg });
    expect(r).toEqual({ hits: [{ path: 'src/http/limit.ts', line: 1, col: 6, text: 'const MAX_CALLS = 120;' }], truncated: false });
    const smart = await searchText(root, 'limit', { rg });
    expect(smart.hits.some((h) => h.path === 'README.md')).toBe(true);
    expect(smart.hits.some((h) => h.path === '.env')).toBe(false);
    expect(smart.hits).toHaveLength(200);
    expect(smart.truncated).toBe(true);
  };
  it.skipIf(!rgVersion())('searches text with ripgrep, skipping secrets and stopping at 200', textSearch('rg'));
  it('searches text without ripgrep the same way', textSearch(null));

  it('answers through the route', async () => {
    const s = await startHttpTestServer({ register: false });
    try {
      initWorkspace(s.home, root, { id: 'shop', write: false });
      const names = await s.api('GET', `/api/code/search?ws=shop&mode=name&q=${enc('server')}`);
      expect(names.json.hits[0]).toEqual({ path: 'src/server.ts' });
      const text = await s.api('GET', `/api/code/search?ws=shop&mode=text&q=${enc('MAX_CALLS')}`);
      expect(text.json.hits).toHaveLength(1);
      expect((await s.api('GET', '/api/code/search?ws=shop&mode=text&q=')).json).toEqual({ hits: [], truncated: false });
      expect((await s.api('GET', '/api/code/search?ws=shop&mode=regex&q=x')).status).toBe(400);
    } finally {
      await s.close();
    }
  });
});
