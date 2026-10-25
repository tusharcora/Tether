import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeEnv } from '../src/http/index.js';
import { loadSecrets } from '../src/http/secrets.js';
import { writeEnvironment, writeRequest } from '../src/http/store.js';
import { initWorkspace } from '../src/workspace.js';
import { makeRepo, tmp } from './helpers.js';

const root = new URL('..', import.meta.url).pathname;
const tsx = join(root, 'node_modules/.bin/tsx');
/** Async on purpose: the test server lives in this process and must keep answering while the CLI runs. */
function aorch(home: string, cwd: string, args: string[], input = '') {
  return new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const p = spawn(tsx, [join(root, 'src/cli.ts'), ...args, '--home', home], { cwd, env: { ...process.env, NO_COLOR: '1', AORCH_NO_ANIMATION: '1' } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
    p.stdin.end(input);
  });
}

const SECRET = 'S3CRET-cli-123';
let srv: Server;
let base = '';
let home = '';
let repo = '';
beforeAll(async () => {
  srv = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/big') return void res.end(JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) }));
    res.end(JSON.stringify({ auth: req.headers.authorization ?? null, items: [{ id: 1 }] }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  home = tmp('home-');
  repo = makeRepo();
  initWorkspace(home, repo, { id: 'api' });
  writeEnvironment(repo, 'local', { vars: { base, tok: { secret: 'aorch_token' } } });
  writeRequest(repo, 'runs/list', { name: 'List runs', method: 'GET', url: '{{base}}/api/runs', headers: [{ key: 'Authorization', value: 'Bearer {{tok}}' }], checks: [{ kind: 'status', op: 'eq', value: 200 }, { kind: 'json', path: '$.items[0].id', op: 'exists' }] });
  writeRequest(repo, 'runs/fail', { name: 'Fails', method: 'GET', url: '{{base}}/x', checks: [{ kind: 'status', op: 'eq', value: 201 }] });
  writeRequest(repo, 'big', { name: 'Big', method: 'GET', url: '{{base}}/big', checks: [{ kind: 'status', op: 'eq', value: 201 }] });
  writeRequest(repo, 'down', { name: 'Down', method: 'GET', url: 'http://127.0.0.1:1/' });
  mkdirSync(join(repo, 'src'), { recursive: true });
});
afterAll(() => srv.close());

describe('aorch http', { timeout: 120_000 }, () => {
  it('secret set reads stdin (never argv), ls shows keys only, rm removes', async () => {
    expect((await aorch(home, repo, ['http', 'secret', 'set', 'aorch_token'], `${SECRET}\n`)).code).toBe(0);
    expect(loadSecrets(home, 'api')).toEqual({ aorch_token: SECRET });
    const ls = await aorch(home, repo, ['http', 'secret', 'ls']);
    expect(ls.out).toContain('aorch_token');
    expect(ls.out + ls.err).not.toContain(SECRET);
    expect((await aorch(home, repo, ['http', 'secret', 'set', 'tmp_key'], 'x')).code).toBe(0);
    expect((await aorch(home, repo, ['http', 'secret', 'rm', 'tmp_key'])).code).toBe(0);
    expect(Object.keys(loadSecrets(home, 'api'))).toEqual(['aorch_token']);
  });

  it('env ls / use / none', async () => {
    expect((await aorch(home, repo, ['http', 'env', 'ls'])).out).toContain('local');
    expect((await aorch(home, repo, ['http', 'env', 'use', 'nope'])).code).toBe(2);
    expect((await aorch(home, repo, ['http', 'env', 'use', 'local'])).code).toBe(0);
    expect(activeEnv(home, 'api')).toBe('local');
  });

  it('ls lists saved requests', async () => {
    const r = await aorch(home, repo, ['http', 'ls', '--json']);
    expect(JSON.parse(r.out).map((x: { id: string }) => x.id)).toEqual(['big', 'down', 'runs/fail', 'runs/list']);
  });

  it('run sends a saved request with secrets, prints a redacted result; exit 1 on a failed check, 2 on a network error', async () => {
    const ok = await aorch(home, repo, ['http', 'run', 'runs/list']);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/200 OK/);
    expect(ok.out).toContain('✔ status eq 200');
    expect(ok.out).toContain('{{secret:aorch_token}}');
    expect(ok.out + ok.err).not.toContain(SECRET);
    const json = await aorch(home, repo, ['http', 'run', 'runs/list', '--json']);
    expect(JSON.parse(json.out).result.status).toBe(200);
    const fail = await aorch(home, repo, ['http', 'run', 'runs/fail']);
    expect(fail.code).toBe(1);
    expect(fail.out).toContain('✘ status eq 201 (actual: 200)');
    expect((await aorch(home, repo, ['http', 'run', 'down', '--env', 'local'])).code).toBe(2);
  });

  it('--json output of a large response reaches a pipe whole, and the exit code still holds', async () => {
    const r = await aorch(home, repo, ['http', 'run', 'big', '--json']);
    expect(r.code).toBe(1);
    const o = JSON.parse(r.out);
    expect(o.result.body.length).toBeGreaterThan(2 * 1024 * 1024);
  });

  it('works from a subfolder of the project', async () => {
    expect((await aorch(home, join(repo, 'src'), ['http', 'run', 'runs/list'])).code).toBe(0);
  });

  it('send is ad-hoc: never resolves secrets; unknown vars exit 2', async () => {
    const ok = await aorch(home, repo, ['http', 'send', 'GET', '{{base}}/x', '--env', 'local']);
    expect(ok.code).toBe(0);
    const sec = await aorch(home, repo, ['http', 'send', 'GET', '{{base}}/x', '-H', 'Authorization: Bearer {{tok}}', '--env', 'local']);
    expect(sec.code).toBe(2);
    expect(sec.err).toContain('secret not available for ad-hoc requests');
    const unk = await aorch(home, repo, ['http', 'send', 'POST', '{{nope}}/x', '-d', '{"a":1}']);
    expect(unk.code).toBe(2);
    expect(unk.err).toContain('unknown variables: nope');
  });

  it('import previews; writes only with --yes', async () => {
    const curl = `curl -X POST '${base}/orders' -d '{"a":1}'`;
    const dry = await aorch(home, repo, ['http', 'import', '-', '--kind', 'curl', '--into', 'shop'], curl);
    expect(dry.code).toBe(2);
    expect(dry.out).toContain('+ shop/post-orders');
    expect(dry.err).toContain('nothing written');
    expect(existsSync(join(repo, '.aorch/http/shop/post-orders.req.json'))).toBe(false);
    const yes = await aorch(home, repo, ['http', 'import', '-', '--kind', 'curl', '--into', 'shop', '--yes'], curl);
    expect(yes.code).toBe(0);
    expect(existsSync(join(repo, '.aorch/http/shop/post-orders.req.json'))).toBe(true);
    expect((await aorch(home, repo, ['http', 'import', '-', '--kind', 'soap'], curl)).code).toBe(2);
  });

  it('in the folder that holds the aorch home: a one-line error, exit 2, no stack trace', async () => {
    const outer = tmp('outer-');
    const h = join(outer, '.aorch');
    mkdirSync(h, { recursive: true });
    const r = await aorch(h, outer, ['http', 'ls']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('which is the aorch home, not a project');
    expect(r.err.trim().split('\n')).toHaveLength(1);
    expect(r.err).not.toMatch(/\n\s+at /);
  });

  it('a missing import file is a one-line error, exit 2', async () => {
    const r = await aorch(home, repo, ['http', 'import', join(repo, 'nope.json'), '--kind', 'openapi']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('cannot read');
  });
});
