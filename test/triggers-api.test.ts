import { chmodSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { delimiter, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { saveSettings, type Exec } from '../src/pr.js';
import { startServer } from '../src/server.js';
import { parseRuleArgs, recordDelivery } from '../src/triggers.js';
import { writePipeline } from '../src/config.js';
import { initWorkspace } from '../src/workspace.js';
import { Vault } from '../src/vault.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const view = (o: Record<string, unknown> = {}) => JSON.stringify({ title: 'Fix it', body: '', author: { login: 'sam' }, baseRefName: 'main', headRefName: 'f', headRefOid: 'abcdef1234567', isDraft: false, isCrossRepository: false, labels: [], files: [], ...o });
let prJson = view();
const exec: Exec = async (cmd, args) => (cmd === 'gh' && args[1] === 'view' ? (prJson === 'FAIL' ? { code: 1, stdout: '', stderr: 'no such PR' } : { code: 0, stdout: prJson, stderr: '' }) : { code: 0, stdout: '', stderr: '' });

let base = '';
let home = '';
let close: () => Promise<void>;
const SECRET = 'deadbeefcafebabe0123456789abcdef0123456789abcdef';

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
  return { status: r.status, text: r.body, json: r.body ? JSON.parse(r.body) : undefined };
};

beforeAll(async () => {
  const vault = new Vault(tmp('vault-'));
  const s0 = setup(vault);
  home = s0.home;
  writePipeline(home, pipe([{ id: 'a', agent: 'mock' }], []));
  const s = await startServer({ engine: s0.engine, store: s0.store, vault, registry: s0.registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-'), exec });
  base = s.url;
  close = s.close;
});
afterAll(() => close());

const reset = () => saveSettings(home, { webhookSecret: SECRET, rules: [] });
const form = (o: Record<string, unknown> = {}) => ({ repo: 'acme/api', workflow: 'test', ...o });
/** every body these tests see must not leak the stored secret */
const noSecret = (...rs: { text: string }[]) => rs.forEach((r) => expect(r.text).not.toContain(SECRET));

describe('triggers api', () => {
  afterEach(() => reset());

  it('lists, creates, edits, pauses and deletes', async () => {
    reset();
    expect((await api('GET', '/api/triggers')).json).toEqual([]);
    const c = await api('POST', '/api/triggers', form({ comment: true, events: ['opened', 'synchronize'], labels: 'ai-review, bug' }));
    expect(c.status).toBe(200);
    expect(c.json).toMatchObject({ id: 'acme-api-test', repo: 'acme/api', workflow: 'test', comment: true, events: ['opened', 'synchronize'], labels: ['ai-review', 'bug'], status: 'idle', last: null });
    const list = await api('GET', '/api/triggers');
    expect(list.json).toHaveLength(1);
    noSecret(c, list);

    // edit by id: change the repo, keep the id
    const e = await api('POST', '/api/triggers', form({ id: 'acme-api-test', repo: 'acme/web', agent: 'mock', model: 'm1' }));
    expect(e.status).toBe(200);
    expect(e.json).toMatchObject({ id: 'acme-api-test', repo: 'acme/web', agent: 'mock', model: 'm1' });
    expect((await api('GET', '/api/triggers')).json).toHaveLength(1);

    const off = await api('PATCH', '/api/triggers/acme-api-test', { enabled: false });
    expect(off.json).toMatchObject({ enabled: false, status: 'paused' });
    // editing keeps it paused
    expect((await api('POST', '/api/triggers', form({ id: 'acme-api-test', repo: 'acme/web' }))).json.enabled).toBe(false);
    const on = await api('PATCH', '/api/triggers/acme-api-test', { enabled: true });
    expect(on.json.enabled).toBeUndefined();
    expect(on.json.status).toBe('idle');

    expect((await api('DELETE', '/api/triggers/acme-api-test')).status).toBe(200);
    expect((await api('GET', '/api/triggers')).json).toEqual([]);
    // the secret survives rule edits
    expect(JSON.parse(readFileSync(join(home, 'pr.json'), 'utf8')).webhookSecret).toBe(SECRET);
  });

  it('rejects bad input with a message', async () => {
    reset();
    expect((await api('POST', '/api/triggers', {})).status).toBe(400);
    expect((await api('POST', '/api/triggers', { repo: 'not a repo!!', workflow: 'test' })).json.error).toMatch(/owner\/repo/);
    expect((await api('POST', '/api/triggers', form({ events: 'Opened!' }))).json.error).toMatch(/pull_request action/);
    expect((await api('POST', '/api/triggers', form({ workspace: 'nope' }))).json.error).toMatch(/no workspace "nope"/);
    expect((await api('POST', '/api/triggers', form({ agent: 'nope' }))).json.error).toMatch(/unknown agent/);
    expect((await api('POST', '/api/triggers', form({ id: 'Bad Id' }))).json.error).toMatch(/id/);
    expect((await api('PATCH', '/api/triggers/missing', { enabled: true })).status).toBe(404);
    expect((await api('DELETE', '/api/triggers/missing')).status).toBe(404);
    await api('POST', '/api/triggers', form());
    expect((await api('PATCH', '/api/triggers/acme-api-test', { enabled: 'yes' })).status).toBe(400);
    // a second trigger with the same repo+workflow under another id is refused when editing
    await api('POST', '/api/triggers', form({ repo: 'acme/web' }));
    expect((await api('POST', '/api/triggers', form({ id: 'acme-web-test', repo: 'acme/api' }))).json.error).toMatch(/already runs/);
    expect((await api('GET', '/api/triggers')).json).toHaveLength(2);
  });

  it('offers workspaces for the form', async () => {
    const dir = makeRepo();
    initWorkspace(home, dir, { name: 'API', id: 'api' });
    const w = await api('GET', '/api/workspaces');
    expect(w.status).toBe(200);
    // macOS: the temp dir is a symlink (/var -> /private/var) and workspaces store the real path
    expect(w.json.find((x: { id: string }) => x.id === 'api')).toMatchObject({ id: 'api', name: 'API', exists: true, path: realpathSync(dir), repos: [] });
    expect(Object.keys(w.json[0]).sort()).toEqual(['exists', 'id', 'isDefault', 'name', 'path', 'repos']);
    reset();
    expect((await api('POST', '/api/triggers', form({ workspace: 'api' }))).json.workspace).toBe('api');
  });

  it('reads the delivery log, newest first, per trigger', async () => {
    reset();
    await api('POST', '/api/triggers', form());
    const t = (n: number) => new Date(Date.now() + n).toISOString();
    recordDelivery(home, { at: t(1), trigger: 'acme-api-test', source: 'webhook', repo: 'acme/api', pr: 1, outcome: 'started', runId: 'r1' });
    recordDelivery(home, { at: t(2), source: 'webhook', repo: 'acme/other', outcome: 'ignored', reason: 'no rule matches (closed)' });
    recordDelivery(home, { at: t(3), trigger: 'acme-api-test', source: 'poll', repo: 'acme/api', pr: 2, outcome: 'error', reason: 'boom' });
    const all = await api('GET', '/api/triggers/deliveries');
    expect(all.json.map((d: { outcome: string }) => d.outcome)).toEqual(['error', 'ignored', 'started']);
    expect((await api('GET', '/api/triggers/deliveries?trigger=acme-api-test&limit=1')).json).toHaveLength(1);
    expect((await api('GET', '/api/triggers/deliveries?trigger=acme-api-test')).json.map((d: { pr: number }) => d.pr)).toEqual([2, 1]);
    const list = (await api('GET', '/api/triggers')).json[0];
    expect(list).toMatchObject({ status: 'error', last: { outcome: 'error', pr: 2 } });
  });

  it('dry-runs a PR and explains a refusal', async () => {
    reset();
    await api('POST', '/api/triggers', form({ labels: 'ai-review' }));
    prJson = view({ labels: [{ name: 'ai-review' }] });
    const ok = await api('POST', '/api/triggers/acme-api-test/test', { pr: 'https://github.com/acme/api/pull/7' });
    expect(ok.json).toMatchObject({ matches: true, fired: false, pr: { repo: 'acme/api', number: 7, title: 'Fix it' } });
    // a bare number works for a single-repo trigger
    expect((await api('POST', '/api/triggers/acme-api-test/test', { pr: '7' })).json.matches).toBe(true);
    prJson = view();
    const no = await api('POST', '/api/triggers/acme-api-test/test', { pr: '#7' });
    expect(no.json).toMatchObject({ matches: false, fired: false });
    expect(no.json.why).toMatch(/labels/);
    // asking to fire a PR that does not match starts nothing
    expect((await api('POST', '/api/triggers/acme-api-test/test', { pr: '7', fire: true })).json).toMatchObject({ matches: false, fired: false });
    expect((await api('GET', '/api/triggers/deliveries')).json.filter((d: { source: string }) => d.source === 'test')).toEqual([]);
    expect((await api('POST', '/api/triggers/acme-api-test/test', {})).status).toBe(400);
    expect((await api('POST', '/api/triggers/acme-api-test/test', { pr: 'garbage' })).status).toBe(400);
    expect((await api('POST', '/api/triggers/nope/test', { pr: '7' })).status).toBe(404);
    prJson = 'FAIL';
    expect((await api('POST', '/api/triggers/acme-api-test/test', { pr: '7' })).status).toBe(502);
    prJson = view();
  });

  it('a paused trigger would be ignored', async () => {
    reset();
    await api('POST', '/api/triggers', form());
    await api('PATCH', '/api/triggers/acme-api-test', { enabled: false });
    const r = await api('POST', '/api/triggers/acme-api-test/test', { pr: '7' });
    expect(r.json).toMatchObject({ matches: false });
    expect(r.json.why).toMatch(/disabled/);
  });
});

describe('triggers api: input checks', () => {
  afterEach(() => reset());
  it('only fires on boolean true', async () => {
    reset();
    await api('POST', '/api/triggers', form());
    prJson = view();
    const r = await api('POST', '/api/triggers/acme-api-test/test', { pr: '7', fire: 'false' });
    expect(r.status).toBe(400);
    expect((await api('POST', '/api/triggers/acme-api-test/test', { pr: '7', fire: 1 })).status).toBe(400);
    expect((await api('POST', '/api/triggers/acme-api-test/test', { pr: '7', fire: false })).json).toMatchObject({ matches: true, fired: false });
    expect((await api('GET', '/api/triggers/deliveries')).json.filter((d: { source: string }) => d.source === 'test')).toEqual([]);
  });
  it('reserves ids that clash with fixed paths', async () => {
    reset();
    for (const id of ['setup', 'deliveries', 'secret']) expect((await api('POST', '/api/triggers', form({ id }))).json.error).toMatch(/reserved/);
    expect(() => parseRuleArgs('acme/api', { id: 'setup' })).toThrow(/reserved/);
  });
  it('rejects wrongly typed or oversized bodies', async () => {
    reset();
    const bad: Record<string, unknown>[] = [
      { workflow: 5 }, { agent: 5 }, { model: 5 }, { workspace: false }, { comment: 'yes' }, { drafts: 1 }, { enabled: 'no' },
      { events: [1] }, { labels: { a: 1 } }, { events: Array(21).fill('opened') }, { labels: ['x'.repeat(65)] },
      { model: 'x'.repeat(201) }, { model: 'a\nb' }, { id: 'x'.repeat(64) },
    ];
    for (const o of bad) expect((await api('POST', '/api/triggers', form(o))).status, JSON.stringify(o).slice(0, 60)).toBe(400);
    expect((await api('POST', '/api/triggers', [1])).status).toBe(400);
    expect((await api('POST', '/api/triggers', 'x')).status).toBe(400);
    await api('POST', '/api/triggers', form());
    expect((await api('PATCH', '/api/triggers/acme-api-test', [])).status).toBe(400);
    expect((await api('PATCH', '/api/triggers/%E0%A4%A', { enabled: true })).status).toBe(400);
    expect((await api('DELETE', '/api/triggers/%zz')).status).toBe(400);
    expect((await api('POST', '/api/triggers/%zz/test', { pr: '1' })).status).toBe(400);
    expect((await api('GET', '/api/triggers')).json).toHaveLength(1);
  });
});

describe('triggers api: review fixes', () => {
  afterEach(() => reset());
  it('refuses a model without an agent', async () => {
    reset();
    const r = await api('POST', '/api/triggers', form({ model: 'm1' }));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/--model needs --agent/);
    expect((await api('GET', '/api/triggers')).json).toHaveLength(0);
  });
  it('warns when the workspace does not list the trigger repo', async () => {
    reset();
    const dir = makeRepo();
    initWorkspace(home, dir, { id: 'other-ws', write: false });
    const r = await api('POST', '/api/triggers', form({ workspace: 'other-ws' }));
    expect(r.status).toBe(200);
    expect(r.json.warnings.join(' ')).toMatch(/does not list acme\/api/);
    const star = await api('POST', '/api/triggers', form({ repo: '*', workspace: 'other-ws' }));
    expect(star.json.warnings.join(' ')).not.toMatch(/does not list/);
  });
});

describe('triggers api: fire', () => {
  const oldPath = process.env.PATH;
  afterEach(() => (process.env.PATH = oldPath));

  it('starts a run and records a test delivery', async () => {
    const repo = makeRepo();
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo }).toString().trim();
    g('remote', 'add', 'origin', repo);
    g('update-ref', 'refs/pull/9/head', 'HEAD');
    const bin = tmp('bin-');
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncat <<'EOF'\n${view({ baseRefName: branch })}\nEOF\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    process.env.PATH = bin + delimiter + oldPath;
    // a server of its own, using the real exec (the shared one above fakes gh and git)
    const vault = new Vault(tmp('vault-'));
    const s0 = setup(vault);
    writePipeline(s0.home, pipe([{ id: 'a', agent: 'mock' }], []));
    saveSettings(s0.home, { webhookSecret: SECRET, repos: { 'acme/api': repo }, rules: [{ repo: 'acme/api', workflow: 'test' }] });
    const s = await startServer({ engine: s0.engine, store: s0.store, vault, registry: s0.registry, cfg: { home: s0.home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    try {
      const u = new URL(s.url);
      const post = (path: string, body: unknown) =>
        new Promise<{ status: number; text: string }>((resolve, reject) => {
          const req = request({ host: u.hostname, port: u.port, method: 'POST', path, headers: { host: u.host, 'content-type': 'application/json' } }, (res) => {
            let b = '';
            res.on('data', (d) => (b += d));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, text: b }));
          });
          req.on('error', reject);
          req.end(JSON.stringify(body));
        });
      const r = await post('/api/triggers/acme-api-test/test', { pr: '9', fire: true });
      expect(r.status).toBe(200);
      const j = JSON.parse(r.text);
      expect(j).toMatchObject({ matches: true, fired: true });
      expect(j.runId).toBeTruthy();
      expect(s0.store.state(j.runId)).toBeTruthy();
      const log = await fetch(`${s.url}/api/triggers/deliveries`).then((x) => x.json());
      expect(log[0]).toMatchObject({ source: 'test', outcome: 'started', trigger: 'acme-api-test', pr: 9, runId: j.runId });
      // the same head again is refused and logged as skipped
      const again = await post('/api/triggers/acme-api-test/test', { pr: '9' });
      expect(JSON.parse(again.text)).toMatchObject({ matches: false });
      expect(JSON.parse(again.text).why).toMatch(/already reviewed/);
    } finally {
      await s.close();
    }
  });
});

describe('webhook setup', () => {
  afterEach(() => (delete process.env.AORCH_WEBHOOK_SECRET, reset()));

  it('reports a hint, never the secret, and shows a new one once', async () => {
    reset();
    const s = await api('GET', '/api/triggers/setup');
    expect(s.json).toMatchObject({ payloadPath: '/api/webhooks/github', hasSecret: true, secretHint: SECRET.slice(-4), eventsToSelect: ['Pull requests', 'Issues', 'Issue comments'] });
    noSecret(s, await api('GET', '/api/triggers'), await api('GET', '/api/triggers/deliveries'), await api('GET', '/api/workspaces'), await api('GET', '/api/health'));

    const r = await api('POST', '/api/triggers/setup/secret');
    expect(r.status).toBe(200);
    expect(r.json.secret).toMatch(/^[0-9a-f]{48}$/);
    expect(r.json.secret).not.toBe(SECRET);
    expect(JSON.parse(readFileSync(join(home, 'pr.json'), 'utf8')).webhookSecret).toBe(r.json.secret);
    const after = await api('GET', '/api/triggers/setup');
    expect(after.json.secretHint).toBe(r.json.secret.slice(-4));
    expect(after.text).not.toContain(r.json.secret);
    expect((await api('GET', '/api/triggers')).text).not.toContain(r.json.secret);
  });

  it('works with no secret yet, and refuses to override an env secret', async () => {
    saveSettings(home, { rules: [] });
    expect((await api('GET', '/api/triggers/setup')).json).toMatchObject({ hasSecret: false, secretHint: null });
    expect((await api('POST', '/api/triggers/setup/secret')).json.secret).toBeTruthy();
    process.env.AORCH_WEBHOOK_SECRET = 'from-env-1234';
    const s = await api('GET', '/api/triggers/setup');
    expect(s.json).toMatchObject({ hasSecret: true, secretHint: null, secretSource: 'env' });
    process.env.AORCH_WEBHOOK_SECRET = 'a-long-enough-env-secret-5678';
    expect((await api('GET', '/api/triggers/setup')).json.secretHint).toBe('5678');
    process.env.AORCH_WEBHOOK_SECRET = 'from-env-1234';
    expect(s.text).not.toContain('from-env-1234');
    expect((await api('POST', '/api/triggers/setup/secret')).status).toBe(409);
  });

  it('stays loopback only: a foreign Host or Origin is refused, the webhook path is the one exception', async () => {
    expect((await raw('GET', '/api/triggers', { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await raw('POST', '/api/triggers/setup/secret', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await raw('POST', '/api/triggers/x/test', { headers: { host: 'evil.example' }, body: '{}' })).status).toBe(403);
    expect((await raw('POST', '/api/webhooks/github', { headers: { host: 'tunnel.example' }, body: '{}' })).status).toBe(401);
  });
});
