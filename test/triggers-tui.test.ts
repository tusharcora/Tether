import { chmodSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveSettings } from '../src/pr.js';
import { startServer } from '../src/server.js';
import { writePipeline } from '../src/config.js';
import { initWorkspace } from '../src/workspace.js';
import { Vault } from '../src/vault.js';
import { TABS, deliveryLines, parseKeys, setupLines, triggerLines } from '../src/tui.js';
import { readDeliveries, webhookSetupInfo } from '../src/triggers.js';
import { strip, vlen } from '../src/ui.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const plain = (ls: string[]) => ls.map(strip).join('\n');

describe('triggers tab rendering', () => {
  it('sits right after crew, before settings, and space is a key', () => {
    expect(TABS).toEqual(['chat', 'runs', 'workflows', 'crew', 'triggers', 'settings']);
    expect(parseKeys(' ')).toEqual([' ']);
  });

  it('explains how to add when empty', () => {
    const t = plain(triggerLines([], 0, 100, NOW));
    expect(t).toMatch(/No triggers yet/);
    expect(t).toContain('aorch triggers add');
    expect(t).toContain('aorch pr watch');
  });

  it('lists triggers with status, selection and detail', () => {
    const rows = [
      { rule: { id: 'api-review', repo: 'acme/api', workflow: 'full-review', workspace: 'api', agent: 'codex', model: 'gpt-5', comment: true }, status: 'active' as const, last: { at: new Date(NOW - 120_000).toISOString(), source: 'webhook' as const, repo: 'acme/api', pr: 7, outcome: 'started' as const } },
      { rule: { id: 'any-lint', repo: '*', workflow: 'lint', enabled: false, labels: ['ready'] }, status: 'paused' as const },
    ];
    const ls = triggerLines(rows, 1, 110, NOW);
    const t = plain(ls);
    for (const s of ['api-review', 'acme/api', '→ full-review', 'codex/gpt-5', '2m ago started #7', 'codex/gpt-5', 'any-lint', 'paused', 'labels ready', 'space pause/enable']) expect(t).toContain(s);
    expect(strip(ls[1]!).startsWith('▍')).toBe(true);
    expect(strip(ls[0]!).startsWith(' ')).toBe(true);
    for (const l of ls) expect(vlen(l)).toBeLessThanOrEqual(110);
  });

  it('delivery and setup views never contain the secret', () => {
    const d = deliveryLines([{ at: new Date(NOW - 60_000).toISOString(), source: 'webhook', repo: 'acme/api', pr: 3, outcome: 'ignored', reason: 'no rule matches (closed)' }], NOW);
    expect(d[0]).toContain('acme/api#3');
    expect(deliveryLines([], NOW)[0]).toMatch(/nothing has arrived/);
    const home = tmp('home-');
    const secret = 'deadbeefcafebabe0123456789abcdef0123456789abcdef';
    saveSettings(home, { webhookSecret: secret, rules: [] });
    const t = setupLines(webhookSetupInfo(home)).join('\n');
    expect(t).toContain('/api/webhooks/github');
    expect(t).toContain('ends in cdef');
    expect(t).not.toContain(secret);
    expect(setupLines(webhookSetupInfo(tmp('home-'))).join('\n')).toContain('none yet');
  });
});

describe('triggers smoke: webhook PR with workspace and agent/model override', () => {
  const oldPath = process.env.PATH;
  afterEach(() => (process.env.PATH = oldPath));

  it('starts a run that uses the override and the workspace', async () => {
    const repo = makeRepo();
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo }).toString().trim();
    g('remote', 'add', 'origin', repo);
    g('update-ref', 'refs/pull/5/head', 'HEAD');
    const bin = tmp('bin-');
    const view = JSON.stringify({ title: 'Fix it', body: '', author: { login: 'sam' }, baseRefName: branch, headRefName: 'f', headRefOid: 'abcdef1234567', isDraft: false, isCrossRepository: false, labels: [], files: [] });
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncat <<'EOF'\n${view}\nEOF\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    process.env.PATH = bin + delimiter + oldPath;

    const vault = new Vault(tmp('vault-'));
    const { engine, store, registry, home } = setup(vault);
    // two agent steps, neither pinned to a model; the rule pins one
    writePipeline(home, pipe([{ id: 'a', agent: 'other' }, { id: 'b', agent: 'other' }], [['a', 'b']]));
    initWorkspace(home, repo, { id: 'acme-ws', name: 'Acme' });
    saveSettings(home, { webhookSecret: 'shh', repos: { 'acme/api': repo }, rules: [{ repo: 'acme/api', workflow: 'test', workspace: 'acme-ws', agent: 'mock', model: 'tiny-1' }] });
    const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    try {
      const raw = JSON.stringify({ action: 'opened', repository: { full_name: 'acme/api' }, pull_request: { number: 5, head: { sha: 'abc', repo: { full_name: 'acme/api' } }, labels: [], draft: false } });
      const u = new URL(s.url);
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: u.hostname, port: u.port, method: 'POST', path: '/api/webhooks/github', headers: { host: u.host, 'x-github-event': 'pull_request', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'shh').update(raw).digest('hex') } }, (res) => (res.resume(), res.on('end', () => resolve(res.statusCode ?? 0))));
        req.on('error', reject);
        req.end(raw);
      });
      expect(status).toBe(202);
      const t0 = Date.now();
      while (!readDeliveries(home).some((d) => d.outcome === 'started') && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 100));
      const d = readDeliveries(home)[0]!;
      expect(d).toMatchObject({ outcome: 'started', trigger: 'acme-api-test', pr: 5 });
      const st = store.state(d.runId!)!;
      expect(st.workspace).toMatchObject({ id: 'acme-ws' });
      const agents = st.pipeline.nodes.filter((n) => n.kind === 'agent');
      expect(agents.length).toBeGreaterThanOrEqual(2);
      for (const n of agents) expect(n).toMatchObject({ agent: 'mock', model: 'tiny-1' });
    } finally {
      await s.close();
    }
  });
});

describe('triggers tab keys', () => {
  it('with no triggers, space, d, l and t are not swallowed', async () => {
    const { Tui } = await import('../src/tui.js');
    const { home, engine, store } = setup();
    const out = { write: () => true, columns: 120, rows: 40 } as unknown as NodeJS.WriteStream;
    const ui = new Tui({ cfg: { home, vault: tmp('v-'), adapters: {}, endpoints: {} } as never, store, engine }, out) as unknown as { key(k: string): void; screen: { tab: string }; modal?: { kind: string } };
    ui.screen.tab = 'triggers';
    for (const k of [' ', 'd', 'l']) {
      ui.key(k);
      expect(ui.modal).toBeUndefined();
      expect(ui.screen.tab).toBe(k === 'l' ? 'settings' : 'triggers'); // l is the global next-tab key again
      ui.screen.tab = 'triggers';
    }
    ui.key('t');
    expect(ui.modal).toBeUndefined(); // no test prompt: t cycles the theme as elsewhere
  });

  it('space pauses and resumes, d confirms before deleting, 5 opens the tab', async () => {
    const { Tui } = await import('../src/tui.js');
    const { loadSettings } = await import('../src/pr.js');
    const { home, engine, store } = setup();
    saveSettings(home, { rules: [{ repo: 'acme/api', workflow: 'test' }, { repo: 'acme/web', workflow: 'test' }] });
    const out = { write: () => true, columns: 120, rows: 40 } as unknown as NodeJS.WriteStream;
    const ui = new Tui({ cfg: { home, vault: tmp('v-'), adapters: {}, endpoints: {} } as never, store, engine }, out) as unknown as { key(k: string): void; screen: { tab: string; sel: Record<string, number> }; modal?: { kind: string } };
    ui.screen.tab = 'runs'; // chat takes typed digits, so start elsewhere
    ui.key('5');
    expect(ui.screen.tab).toBe('triggers');
    ui.key('down');
    expect(ui.screen.sel.triggers).toBe(1);
    ui.key(' ');
    expect(loadSettings(home).rules!.map((r) => r.enabled)).toEqual([undefined, false]);
    ui.key(' ');
    expect(loadSettings(home).rules!.map((r) => r.enabled)).toEqual([undefined, undefined]);
    ui.key('d');
    expect(ui.modal?.kind).toBe('confirm');
    ui.key('n');
    expect(loadSettings(home).rules).toHaveLength(2);
    ui.key('d');
    ui.key('y');
    expect(loadSettings(home).rules!.map((r) => r.id)).toEqual(['acme-api-test']);
    ui.key('6');
    expect(ui.screen.tab).toBe('settings');
  });
});
