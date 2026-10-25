import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSecrets, setSecret } from '../src/http/secrets.js';
import { readRequest, writeEnvironment, writeRequest } from '../src/http/store.js';
import { getWorkspace, initWorkspace, listWorkspaces } from '../src/workspace.js';
import { applyBundle, bundleFileName, exportWorkspace, parseBundle, planBundleImport, writeBundle, type Bundle } from '../src/wsexport.js';
import { startHttpTestServer } from './http-helpers.js';
import { makeRepo, tmp } from './helpers.js';

const root = new URL('..', import.meta.url).pathname;
const aorch = (home: string, cwd: string, ...args: string[]) => {
  const r = spawnSync(join(root, 'node_modules/.bin/tsx'), [join(root, 'src/cli.ts'), ...args, '--home', home], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', AORCH_NO_ANIMATION: '1' }, timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

function project() {
  const home = tmp('home-');
  const dir = makeRepo();
  initWorkspace(home, dir, { id: 'api', name: 'API Server' });
  writeRequest(dir, 'runs/list', { name: 'List runs', method: 'GET', url: '{{base}}/api/runs' });
  writeEnvironment(dir, 'local', { vars: { base: 'http://127.0.0.1:4177', tok: { secret: 'tok' } } });
  setSecret(home, 'api', 'tok', 'S3CRET-x');
  return { home, dir, w: getWorkspace(home, 'api')! };
}
const emptyBundle = (files: Record<string, unknown> = {}): Bundle => ({ v: 1, workspace: { name: 'X' }, notes: '', http: { files } });

describe('workspace bundle', () => {
  it('exports workspace.json, project.md and every .aorch/http file; secrets only when asked', () => {
    const { home, w } = project();
    const { bundle: b, skipped } = exportWorkspace(home, w);
    expect(b.v).toBe(1);
    expect(b.workspace.name).toBe('API Server');
    expect(b.notes).toContain('# API Server');
    expect(Object.keys(b.http.files).sort()).toEqual(['environments/local.json', 'runs/list.req.json']);
    expect(skipped).toEqual([]);
    expect(b.secrets).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain('S3CRET-x');
    expect(exportWorkspace(home, w, { withSecrets: true }).bundle.secrets).toEqual({ tok: 'S3CRET-x' });
    expect(bundleFileName(w)).toBe('api-server.aorch.json');
  });

  it('lists the files it could not include instead of dropping them silently', () => {
    const { home, dir, w } = project();
    const h = join(dir, '.aorch/http');
    writeFileSync(join(h, 'runs/broken.req.json'), '{ not json');
    writeFileSync(join(h, 'notes.txt'), 'hello');
    writeFileSync(join(h, 'runs/list.req.json.tmp'), '{}');
    writeFileSync(join(h, 'big.json'), JSON.stringify({ x: 'y'.repeat(1_100_000) }));
    symlinkSync(join(dir, 'README.md'), join(h, 'link.json'));
    const { bundle, skipped } = exportWorkspace(home, w);
    expect(Object.keys(bundle.http.files).sort()).toEqual(['environments/local.json', 'runs/list.req.json']);
    expect(skipped).toEqual([
      { path: '.aorch/http/big.json', reason: 'larger than 1 MB' },
      { path: '.aorch/http/link.json', reason: 'a symlink (not followed)' },
      { path: '.aorch/http/notes.txt', reason: 'not a .json file with an allowed name' },
      { path: '.aorch/http/runs/broken.req.json', reason: 'not valid JSON' },
      { path: '.aorch/http/runs/list.req.json.tmp', reason: 'not a .json file with an allowed name' },
    ]);
  });

  it('leaves out an oversized project.md (the import would refuse it) and refuses a missing folder', () => {
    const { home, dir, w } = project();
    writeFileSync(join(dir, '.aorch/project.md'), 'x'.repeat(1_100_000));
    const { bundle, skipped } = exportWorkspace(home, w);
    expect(bundle.notes).toBe('');
    expect(skipped).toEqual([{ path: '.aorch/project.md', reason: 'larger than 1 MB' }]);
    expect(() => exportWorkspace(home, { ...w, exists: false })).toThrow(/is missing/);
  });

  it('refuses to export through a symlinked .aorch', () => {
    const home = tmp('home-');
    const dir = makeRepo();
    const elsewhere = makeRepo();
    writeRequest(elsewhere, 'a', { name: 'A', method: 'GET', url: 'http://x' });
    symlinkSync(join(elsewhere, '.aorch'), join(dir, '.aorch'));
    initWorkspace(home, dir, { id: 'linked', write: false });
    expect(() => exportWorkspace(home, getWorkspace(home, 'linked')!)).toThrow(/symlinked \.aorch/);
  });

  it('writes a file with secrets as 0600', () => {
    const { home, w } = project();
    const f = join(tmp('out-'), 'api.aorch.json');
    writeBundle(f, exportWorkspace(home, w, { withSecrets: true }).bundle);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(f, 'utf8')).secrets).toEqual({ tok: 'S3CRET-x' });
  });

  it('refuses bundles with paths that leave .aorch/http or fail the store rules, and junk', () => {
    for (const p of ['../../evil.json', '../evil', '/etc/evil.json', 'a/b.sh', 'A/b.json', '.hidden.json', 'a/../b.json', 'a\\b.json', 'x/_y.json', 'a/b/c/d/e/f.json'])
      expect(() => parseBundle(emptyBundle({ [p]: {} })), p).toThrow(/refusing a file path/);
    expect(parseBundle(emptyBundle({ 'shop/_collection.json': {}, 'environments/local.json': {}, 'a/b/c/d/e.req.json': {} })).http.files).toHaveProperty(['shop/_collection.json']);
    expect(() => parseBundle({ v: 2 })).toThrow('not an aorch workspace export (v1)');
    expect(() => parseBundle(null)).toThrow('not an aorch workspace export (v1)');
    expect(() => parseBundle({ ...emptyBundle(), secrets: { '1bad': 'x' } })).toThrow(/secret key/);
    expect(() => parseBundle({ ...emptyBundle(), secrets: { ok: 7 } })).toThrow(/secret key/);
    expect(() => parseBundle(emptyBundle({ 'big.json': { x: 'y'.repeat(1_100_000) } }))).toThrow(/big\.json is larger than 1 MB/);
  });

  it('plans creates and overwrites, then applies: files, registration, secrets in the new scope', () => {
    const { home, w } = project();
    const b = exportWorkspace(home, w, { withSecrets: true }).bundle;
    const home2 = tmp('home2-');
    const target = makeRepo();
    writeRequest(target, 'runs/list', { name: 'old', method: 'GET', url: 'http://old' });
    const plan = planBundleImport(b, target);
    expect(plan.overwrite).toEqual(['.aorch/http/runs/list.req.json']);
    expect(plan.create).toEqual(['.aorch/workspace.json', '.aorch/project.md', '.aorch/http/environments/local.json']);
    expect(plan.secrets).toEqual(['tok']);
    const r = applyBundle(home2, b, target);
    expect(r.written).toEqual(['.aorch/workspace.json', '.aorch/project.md', '.aorch/http/environments/local.json', '.aorch/http/runs/list.req.json']);
    expect(readRequest(target, 'runs/list').file?.name).toBe('List runs');
    expect(readFileSync(join(target, '.aorch/project.md'), 'utf8')).toContain('# API Server');
    expect(listWorkspaces(home2).map((x) => x.id)).toEqual([r.workspace.id]);
    expect(r.workspace.name).toBe('API Server');
    expect(loadSecrets(home2, r.workspace.id)).toEqual({ tok: 'S3CRET-x' });
  });

  it('refuses a folder that does not exist', () => {
    const missing = join(tmp('gone-'), 'nope');
    expect(() => planBundleImport(emptyBundle(), missing)).toThrow(/does not exist/);
    expect(() => applyBundle(tmp('h-'), emptyBundle(), missing)).toThrow(/does not exist/);
    expect(existsSync(missing)).toBe(false);
  });

  it('does not follow a symlink in the target', () => {
    const { home, w } = project();
    const target = makeRepo();
    const outside = tmp('outside-');
    mkdirSync(join(target, '.aorch/http'), { recursive: true });
    symlinkSync(outside, join(target, '.aorch/http/runs'));
    expect(() => planBundleImport(exportWorkspace(home, w).bundle, target)).toThrow(/invalid request id/);
    expect(() => applyBundle(tmp('h-'), exportWorkspace(home, w).bundle, target)).toThrow(/invalid request id/);
    expect(existsSync(join(outside, 'list.req.json'))).toBe(false);
    // nothing at all is written when one path is refused
    expect(existsSync(join(target, '.aorch/workspace.json'))).toBe(false);
    expect(existsSync(join(target, '.aorch/http/environments/local.json'))).toBe(false);
  });

  it('a crafted bundle cannot write outside the project, even past parseBundle', () => {
    const target = makeRepo();
    const crafted = (p: string) => ({ ...emptyBundle(), http: { files: { [p]: { pwned: true } } } }) as Bundle;
    for (const p of ['../evil.json', '../../evil', '/tmp/aorch-evil.json']) {
      expect(() => applyBundle(tmp('h-'), crafted(p), target), p).toThrow(/refusing a file path/);
    }
    expect(existsSync(join(target, 'evil.json'))).toBe(false);
    expect(existsSync(join(target, '.aorch/evil.json'))).toBe(false);
    expect(existsSync('/tmp/aorch-evil.json')).toBe(false);
  });

  it('refuses a project whose .aorch is a symlink, or whose workspace.json is a (dangling) symlink', () => {
    const target = makeRepo();
    const outside = tmp('outside-');
    symlinkSync(outside, join(target, '.aorch'));
    expect(() => applyBundle(tmp('h-'), emptyBundle(), target)).toThrow(/symlinked \.aorch/);
    expect(() => planBundleImport(emptyBundle(), target)).toThrow(/symlinked \.aorch/);
    expect(existsSync(join(outside, 'workspace.json'))).toBe(false);

    const t2 = makeRepo();
    mkdirSync(join(t2, '.aorch'));
    symlinkSync(join(outside, 'nowhere.json'), join(t2, '.aorch/workspace.json'));
    expect(() => applyBundle(tmp('h-'), emptyBundle(), t2)).toThrow(/symlink/);
    expect(existsSync(join(outside, 'nowhere.json'))).toBe(false);

    const t3 = makeRepo();
    mkdirSync(join(t3, '.aorch'));
    symlinkSync(outside, join(t3, '.aorch/http'));
    expect(() => applyBundle(tmp('h-'), emptyBundle({ 'a.req.json': {} }), t3)).toThrow(/invalid request id/);
    expect(existsSync(join(outside, 'a.req.json'))).toBe(false);
  });
});

describe('aorch workspace export / import', { timeout: 120_000 }, () => {
  it('exports (with secrets after --yes) and imports only with --yes', () => {
    const { home, dir } = project();
    writeFileSync(join(dir, '.aorch/http/stray.txt'), 'x');
    const out = join(tmp('out-'), 'b.aorch.json');
    const ex = aorch(home, dir, 'workspace', 'export', 'api', '--out', out, '--with-secrets', '--yes');
    expect(ex.code, ex.err).toBe(0);
    expect(ex.err).toMatch(/secret values in plain text/);
    expect(ex.out).toContain('left out .aorch/http/stray.txt (not a .json file with an allowed name)');
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(out, 'utf8')).secrets).toEqual({ tok: 'S3CRET-x' });
    const refused = join(tmp('out-'), 'r.aorch.json');
    expect(aorch(home, dir, 'ws', 'export', 'api', '--out', refused, '--with-secrets').code).toBe(2); // no terminal, no --yes
    expect(existsSync(refused)).toBe(false);
    const plain = aorch(home, dir, 'ws', 'export', 'api');
    expect(plain.code, plain.err).toBe(0);
    expect(statSync(join(dir, 'api-server.aorch.json')).isFile()).toBe(true);
    expect(readFileSync(join(dir, 'api-server.aorch.json'), 'utf8')).not.toContain('S3CRET-x');

    const home2 = tmp('home2-');
    const target = tmp('target-');
    const dry = aorch(home2, target, 'workspace', 'import', out, '--into', target);
    expect(dry.code).toBe(2);
    expect(dry.out).toContain('+ .aorch/http/runs/list.req.json');
    expect(dry.out).toContain('1 secret(s) for this workspace: tok');
    expect(existsSync(join(target, '.aorch/http/runs/list.req.json'))).toBe(false);
    const go = aorch(home2, target, 'workspace', 'import', out, '--into', target, '--yes');
    expect(go.code, go.err).toBe(0);
    expect(existsSync(join(target, '.aorch/http/runs/list.req.json'))).toBe(true);
    const again = aorch(home2, target, 'workspace', 'import', out, '--into', target);
    expect(again.out).toContain('~ .aorch/http/runs/list.req.json (overwritten)');
    expect(again.code).toBe(2);

    const bad = join(tmp('bad-'), 'bad.json');
    writeFileSync(bad, JSON.stringify({ v: 1, workspace: {}, notes: '', http: { files: { '../evil.json': {} } } }));
    const r = aorch(home2, target, 'workspace', 'import', bad, '--into', target, '--yes');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/refusing a file path/);
  });
});

describe('workspace export / import routes', () => {
  let t: Awaited<ReturnType<typeof startHttpTestServer>>;
  beforeAll(async () => {
    t = await startHttpTestServer();
    await t.api('PUT', '/api/http/secrets/tok', { value: 'S3CRET-web' });
    await t.api('PUT', `/api/http/requests/${encodeURIComponent('runs/list')}`, { name: 'List', method: 'GET', url: 'http://h/' });
  });
  afterAll(() => t.close());

  it('export never carries secrets to the browser, and names the file like the CLI', async () => {
    writeFileSync(join(t.dir, '.aorch/http/stray.txt'), 'x');
    const r = await t.api('GET', '/api/workspaces/api/export');
    expect(r.status).toBe(200);
    expect(r.json.fileName).toBe('api.aorch.json');
    expect(Object.keys(r.json.bundle.http.files)).toEqual(['runs/list.req.json']);
    expect(r.json.bundle.secrets).toBeUndefined();
    expect(r.json.skipped).toEqual([{ path: '.aorch/http/stray.txt', reason: 'not a .json file with an allowed name' }]);
    expect(r.text).not.toContain('S3CRET-web');
    expect((await t.api('GET', '/api/workspaces/nope/export')).status).toBe(404);
  });

  it('import previews, then writes with confirm', async () => {
    const bundle = (await t.api('GET', '/api/workspaces/api/export')).json.bundle;
    const into = tmp('web-target-');
    const pv = await t.api('POST', '/api/workspaces/import', { bundle, into });
    expect(pv.status).toBe(200);
    expect(pv.json.create).toContain('.aorch/http/runs/list.req.json');
    expect(existsSync(join(into, '.aorch/http/runs/list.req.json'))).toBe(false);
    const ap = await t.api('POST', '/api/workspaces/import', { bundle, into, confirm: true });
    expect(ap.status).toBe(200);
    expect(ap.json.written).toContain('.aorch/http/runs/list.req.json');
    expect(typeof ap.json.workspace).toBe('string');
    expect(existsSync(join(into, '.aorch/http/runs/list.req.json'))).toBe(true);
    expect((await t.api('POST', '/api/workspaces/import', { bundle, into: 'relative/path' })).status).toBe(400);
    expect((await t.api('POST', '/api/workspaces/import', { bundle: { v: 9 }, into })).json.error).toBe('not an aorch workspace export (v1)');
    const evil = await t.api('POST', '/api/workspaces/import', { bundle: { ...bundle, http: { files: { '../evil.json': {} } } }, into, confirm: true });
    expect(evil.status).toBe(400);
    expect(existsSync(join(into, '.aorch/evil.json'))).toBe(false);
  });

  it('writes the secrets a bundle carries into the new workspace scope, never echoing them', async () => {
    const into = tmp('web-target-');
    const bundle = { v: 1, workspace: { name: 'Carried' }, notes: '', http: { files: {} }, secrets: { tok: 'S3CRET-carried' } };
    const pv = await t.api('POST', '/api/workspaces/import', { bundle, into });
    expect(pv.json.secrets).toEqual(['tok']);
    const ap = await t.api('POST', '/api/workspaces/import', { bundle, into, confirm: true });
    expect(ap.status).toBe(200);
    expect(pv.text + ap.text).not.toContain('S3CRET-carried');
    expect(loadSecrets(t.home, ap.json.workspace)).toEqual({ tok: 'S3CRET-carried' });
  });
});
