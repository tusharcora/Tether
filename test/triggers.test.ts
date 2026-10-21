import { chmodSync, existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSettings, matchRule, parsePr, saveSettings, startPrRun, type Exec, type Rule } from '../src/pr.js';
import { startServer } from '../src/server.js';
import { ago, applyOverrides, checkRuleRefs, checkWorkflow, classifyFailure, dryRunVerdict, planRuleAdd, ensureIds, explainMatch, findRule, formatTriggerLine, idSlug, lastDelivery, parsePrTarget, parseRuleArgs, readDeliveries, recordDelivery, refusal, reportOnce, statusText, triggerStatus } from '../src/triggers.js';
import { initWorkspace } from '../src/workspace.js';
import { Vault } from '../src/vault.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const rule = (o: Partial<Rule> = {}): Rule => ({ repo: 'acme/api', workflow: 'full-review', ...o });
const d = (o: Partial<Parameters<typeof recordDelivery>[1]> = {}) => ({ at: new Date().toISOString(), source: 'webhook' as const, repo: 'acme/api', outcome: 'started' as const, ...o });

describe('trigger ids', () => {
  it('are unique, stable and keep explicit ids', () => {
    const rs = [rule(), rule(), rule({ repo: '*' }), rule({ id: 'mine' }), rule({ id: 'mine' })];
    const a = ensureIds(rs);
    expect(a.map((r) => r.id)).toEqual(['acme-api-full-review', 'acme-api-full-review-2', 'any-full-review', 'mine', 'mine-2']);
    expect(ensureIds(a).map((r) => r.id)).toEqual(a.map((r) => r.id));
    expect(rs[0]!.id).toBeUndefined();
  });
  it('are applied on load but not written back', () => {
    const home = tmp('home-');
    writeFileSync(join(home, 'pr.json'), JSON.stringify({ rules: [rule()] }));
    expect(loadSettings(home).rules![0]!.id).toBe('acme-api-full-review');
    expect(JSON.parse(readFileSync(join(home, 'pr.json'), 'utf8')).rules[0].id).toBeUndefined();
  });
});

describe('id stability', () => {
  it('an unrelated rule added or removed does not change existing ids', () => {
    const a = rule({ repo: 'acme/api' });
    const b = rule({ repo: 'acme/web' });
    const base = ensureIds([a, b]).map((r) => r.id);
    expect(ensureIds([a, b, rule({ repo: 'other/x', workflow: 'z' })]).map((r) => r.id).slice(0, 2)).toEqual(base);
    expect(ensureIds([b])[0]!.id).toBe(base[1]);
  });
});

describe('classifyFailure', () => {
  it('only real refusals are skipped', () => {
    expect(classifyFailure('already reviewed at abc1234 (run r1)')).toBe('skipped');
    expect(classifyFailure('#4 comes from a fork and "x" would run commands')).toBe('skipped');
    expect(classifyFailure('could not clone acme/fork-tool: gh failed')).toBe('error');
    expect(classifyFailure('preflight failed: unknown fork')).toBe('error');
  });
});

describe('enabled', () => {
  it('a disabled rule never matches', () => {
    const p = { repo: 'acme/api', action: 'opened', labels: [], draft: false, fork: false };
    expect(matchRule([rule({ enabled: false })], p)).toBeUndefined();
    expect(matchRule([rule({ enabled: false }), rule({ workflow: 'b' })], p)?.workflow).toBe('b');
    expect(matchRule([rule({ enabled: true })], p)).toBeDefined();
  });
});

describe('overrides', () => {
  it('touch only agent steps that were not spawned', () => {
    const p = pipe([{ id: 'a', agent: 'claude', model: 'x' }, { id: 'g', kind: 'gate', command: 'true' }, { id: 'h', kind: 'approval' }, { id: 's' }], [['a', 'g']]);
    p.nodes.find((n) => n.id === 's')!.spawn = { parent: 'a', depth: 1, contract: {} as never };
    const o = applyOverrides(p, { agent: 'codex', model: 'm1' });
    const by = Object.fromEntries(o.nodes.map((n) => [n.id, n]));
    expect(by.a).toMatchObject({ agent: 'codex', model: 'm1' });
    expect(by.g!.agent).toBe(p.nodes.find((n) => n.id === 'g')!.agent);
    expect(by.g!.model).toBeUndefined();
    expect(by.h!.model).toBeUndefined();
    expect(by.s!.agent).toBe(p.nodes.find((n) => n.id === 's')!.agent);
    expect(by.s!.model).toBeUndefined();
    expect(p.nodes[0]!.agent).toBe('claude');
    expect(applyOverrides(p, {})).toBe(p);
  });
});

const ghView = JSON.stringify({ title: 'T', body: '', author: { login: 'sam' }, baseRefName: 'main', headRefName: 'f', headRefOid: 'abcdef1234567', isDraft: false, isCrossRepository: false, labels: [], files: [] });
const fakeExec: Exec = async (cmd, args) => ({ code: 0, stdout: cmd === 'gh' && args[1] === 'view' ? ghView : '', stderr: '' });

describe('startPrRun wiring', () => {
  it('passes workspace, agent and model to the engine and uses the workspace folder', async () => {
    const home = tmp('home-');
    const dir = tmp('wsdir-');
    initWorkspace(home, dir, { id: 'proj', write: false });
    mkdirSync(join(dir, '.aorch'), { recursive: true });
    writeFileSync(join(dir, '.aorch', 'workspace.json'), JSON.stringify({ repos: ['Acme/API'] }));
    const seen: any[] = [];
    const engine = { start: async (i: any) => (seen.push(i), 'r1'), wait: async () => ({ status: 'done', costUsd: 0, nodes: {}, pipeline: { nodes: [] } }) as never };
    const { writePipeline } = await import('../src/config.js');
    writePipeline(home, pipe([{ id: 'a', agent: 'claude' }, { id: 'g', kind: 'gate', command: 'true' }], [['a', 'g']]));
    const r = await startPrRun({ home, engine, exec: fakeExec }, parsePr('acme/api#1'), { workflow: 'test', workspace: 'proj', agent: 'codex', model: 'm9' });
    expect(r.repoDir).toBe(dir);
    expect(seen[0].workspace).toBe('proj');
    expect(seen[0].repo).toBe(dir);
    expect(seen[0].pipeline.nodes.find((n: any) => n.id === 'a')).toMatchObject({ agent: 'codex', model: 'm9' });
    expect(seen[0].pipeline.nodes.find((n: any) => n.id === 'g').model).toBeUndefined();
  });
});

describe('startPrRun workspace folder', () => {
  const run = async (repos: string[], repo: string) => {
    const home = tmp('home-');
    const dir = tmp('wsdir-');
    initWorkspace(home, dir, { id: 'proj', write: false });
    if (repos.length) {
      mkdirSync(join(dir, '.aorch'), { recursive: true });
      writeFileSync(join(dir, '.aorch', 'workspace.json'), JSON.stringify({ repos }));
    }
    const engine = { start: async () => 'r1', wait: async () => ({ status: 'done', costUsd: 0, nodes: {}, pipeline: { nodes: [] } }) as never };
    const { writePipeline } = await import('../src/config.js');
    writePipeline(home, pipe([{ id: 'a', agent: 'claude' }], []));
    const r = await startPrRun({ home, engine, exec: fakeExec }, parsePr(`${repo}#1`), { workflow: 'test', workspace: 'proj' });
    return { dir, home, repoDir: r.repoDir };
  };
  it('does not review the workspace folder for another repo (a * trigger, or a workspace without that repo)', async () => {
    for (const [repos, repo] of [[['acme/web'], 'acme/api'], [[], 'acme/api']] as const) {
      const x = await run([...repos], repo);
      expect(x.repoDir).not.toBe(x.dir);
      expect(x.repoDir).toContain(join(x.home, 'clones'));
    }
  });
  it('uses it when the workspace lists the repo, ignoring case', async () => {
    const x = await run(['ACME/api'], 'acme/api');
    expect(x.repoDir).toBe(x.dir);
  });
});

describe('workspace precedence', () => {
  const mk = () => {
    const seen: any[] = [];
    const engine = { start: async (i: any) => (seen.push(i), 'r1'), wait: async () => ({ status: 'done', costUsd: 0, nodes: {}, pipeline: { nodes: [] } }) as never };
    return { seen, engine };
  };
  const wf = async (home: string) => (await import('../src/config.js')).writePipeline(home, pipe([{ id: 'a' }], []));
  it('a mapped existing folder beats the workspace', async () => {
    const home = tmp('home-');
    const ws = tmp('wsdir-');
    const mapped = tmp('mapped-');
    initWorkspace(home, ws, { id: 'proj', write: false });
    saveSettings(home, { repos: { 'acme/api': mapped } });
    await wf(home);
    const { seen, engine } = mk();
    const r = await startPrRun({ home, engine, exec: fakeExec }, parsePr('acme/api#1'), { workflow: 'test', workspace: 'proj' });
    expect(r.repoDir).toBe(mapped);
    expect(seen[0].workspace).toBe('proj');
  });
  it('a workspace whose folder is missing falls back to the normal lookup', async () => {
    const home = tmp('home-');
    const ws = tmp('wsdir-');
    initWorkspace(home, ws, { id: 'proj', write: false });
    const { rmSync } = await import('node:fs');
    rmSync(ws, { recursive: true });
    await wf(home);
    const { engine } = mk();
    const log: string[][] = [];
    const exec: Exec = async (cmd, args, cwd, stdin) => (log.push([cmd, ...args]), fakeExec(cmd, args, cwd, stdin));
    const r = await startPrRun({ home, engine, exec }, parsePr('acme/api#1'), { workflow: 'test', workspace: 'proj' });
    expect(r.repoDir).not.toBe(ws);
    expect(log.some((l) => l[0] === 'git' && l[1] === 'remote') || log.some((l) => l.slice(0, 3).join(' ') === 'gh repo clone')).toBe(true);
  });
  it('workspace: false is passed through and does not pick a folder', async () => {
    const home = tmp('home-');
    const dir = tmp('repo-');
    await wf(home);
    const { seen, engine } = mk();
    await startPrRun({ home, engine, exec: fakeExec }, parsePr('acme/api#1'), { workflow: 'test', workspace: false, repoDir: dir });
    expect(seen[0].workspace).toBe(false);
  });
});

describe('deliveries log', () => {
  it('trims only past 600 lines, to 500, with no stray tmp files', () => {
    const home = tmp('home-');
    const lines = () => readFileSync(join(home, 'triggers-log.jsonl'), 'utf8').trim().split('\n').length;
    for (let i = 0; i < 600; i++) recordDelivery(home, d({ pr: i }));
    expect(lines()).toBe(600);
    recordDelivery(home, d({ pr: 600 }));
    expect(lines()).toBe(500);
    expect(readdirSync(home).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('reports a write failure instead of swallowing it', () => {
    const home = join(tmp('home-'), 'file');
    writeFileSync(home, 'x');
    const errs: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errs.push(a);
    try {
      recordDelivery(home, d());
    } finally {
      console.error = orig;
    }
    expect(errs).toHaveLength(1);
  });
  it('is capped to the newest 500, filtered by trigger and limited', () => {
    const home = tmp('home-');
    for (let i = 0; i < 510; i++) recordDelivery(home, d({ trigger: i % 2 ? 'odd' : 'even', pr: i }));
    const all = readDeliveries(home);
    expect(all).toHaveLength(500);
    expect(all[0]!.pr).toBe(509);
    expect(all[499]!.pr).toBe(10);
    expect(readDeliveries(home, { trigger: 'odd' }).every((x) => x.trigger === 'odd')).toBe(true);
    expect(readDeliveries(home, { limit: 3 }).map((x) => x.pr)).toEqual([509, 508, 507]);
    expect(lastDelivery(home, 'even')!.pr).toBe(508);
    expect(lastDelivery(home, 'nope')).toBeUndefined();
    expect(readDeliveries(tmp('empty-'))).toEqual([]);
  });
});

describe('triggerStatus', () => {
  it('paused, error, active, idle', () => {
    const home = tmp('home-');
    const r = rule({ id: 't1' });
    expect(triggerStatus(r, home)).toBe('idle');
    expect(triggerStatus({ ...r, enabled: false }, home)).toBe('paused');
    recordDelivery(home, d({ trigger: 't1', outcome: 'started' }));
    expect(triggerStatus(r, home)).toBe('active');
    expect(triggerStatus(r, home, Date.now() + 25 * 3_600_000)).toBe('idle');
    recordDelivery(home, d({ trigger: 't1', outcome: 'error', reason: 'boom' }));
    expect(triggerStatus(r, home)).toBe('error');
    expect(triggerStatus({ ...r, enabled: false }, home)).toBe('paused');
  });
});

describe('webhook deliveries', () => {
  const oldPath = process.env.PATH;
  afterEach(() => (process.env.PATH = oldPath));

  it('records ignored and started, and nothing for a bad signature', async () => {
    // a fake `gh` and a repo whose "origin" is itself, so the PR head can be fetched
    const repo = makeRepo();
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo }).toString().trim();
    g('remote', 'add', 'origin', repo);
    g('update-ref', 'refs/pull/42/head', 'HEAD');
    const bin = tmp('bin-');
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify({ ...JSON.parse(ghView), baseRefName: branch })}\nEOF\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    process.env.PATH = bin + delimiter + oldPath;

    const vault = new Vault(tmp('vault-'));
    const { engine, store, registry, home } = setup(vault);
    saveSettings(home, { webhookSecret: 'shh', repos: { 'acme/api': repo }, rules: [rule({ workflow: 'test' })] });
    const { writePipeline } = await import('../src/config.js');
    writePipeline(home, pipe([{ id: 'a', agent: 'mock' }], []));
    const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    const post = (event: string, body: unknown, secret = 'shh') =>
      new Promise<number>((resolve, reject) => {
        const raw = JSON.stringify(body);
        const u = new URL(s.url);
        const req = request({ host: u.hostname, port: u.port, method: 'POST', path: '/api/webhooks/github', headers: { host: u.host, 'x-github-event': event, 'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex') } }, (res) => (res.resume(), res.on('end', () => resolve(res.statusCode ?? 0))));
        req.on('error', reject);
        req.end(raw);
      });
    const pr = (action: string, repoName = 'acme/api') => ({ action, repository: { full_name: repoName }, pull_request: { number: 42, head: { sha: 'abc', repo: { full_name: repoName } }, labels: [], draft: false } });
    try {
      expect(await post('push', { repository: { full_name: 'acme/api' } })).toBe(202);
      expect(await post('pull_request', pr('closed'))).toBe(202);
      expect(await post('pull_request', pr('opened', 'other/repo'))).toBe(202);
      expect(await post('pull_request', pr('opened'), 'wrong')).toBe(401);
      // nothing covered those, so nothing is logged
      expect(readDeliveries(home)).toEqual([]);
      // a trigger for the repo that listens for "opened" but refuses a draft is worth a line
      const draft = pr('opened');
      draft.pull_request.draft = true;
      expect(await post('pull_request', draft)).toBe(202);
      expect(readDeliveries(home)).toHaveLength(1);
      expect(readDeliveries(home)[0]).toMatchObject({ source: 'webhook', repo: 'acme/api', pr: 42, outcome: 'ignored', trigger: 'acme-api-test' });
      expect(readDeliveries(home)[0]!.reason).toMatch(/draft/);
      expect(await post('pull_request', pr('opened'))).toBe(202);
      const start = Date.now();
      while (readDeliveries(home).length < 2 && Date.now() - start < 10_000) await new Promise((r) => setTimeout(r, 100));
      const last = readDeliveries(home)[0]!;
      expect(last).toMatchObject({ outcome: 'started', trigger: 'acme-api-test', pr: 42 });
      expect(last.runId).toBeTruthy();
      expect(JSON.stringify(readDeliveries(home))).not.toContain('shh');
      expect(existsSync(join(home, 'triggers-log.jsonl'))).toBe(true);
    } finally {
      await s.close();
    }
  });
});

describe('trigger helpers (CLI)', () => {
  const NOW = Date.parse('2026-10-21T12:00:00Z');
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it('idSlug makes a safe id', () => {
    expect(idSlug('Acme/API Server')).toBe('acme-api-server');
    expect(idSlug('***')).toBe('any');
  });

  it('ago() reads naturally', () => {
    expect(ago(iso(5_000), NOW)).toBe('just now');
    expect(ago(iso(3 * 60_000), NOW)).toBe('3m ago');
    expect(ago(iso(2 * 3_600_000 + 5), NOW)).toBe('2h ago');
    expect(ago(iso(3 * 86_400_000), NOW)).toBe('3d ago');
    expect(ago('garbage', NOW)).toBe('?');
    expect(ago(iso(-60_000), NOW)).toBe('just now');
  });

  it('statusText names every status', () => {
    expect(statusText('paused')).toBe('paused');
    expect(statusText('idle')).toMatch(/idle/);
    expect(statusText('error')).toMatch(/error/);
    expect(statusText('active')).toMatch(/active/);
  });

  it('formatTriggerLine shows id, status, repo, workflow, workspace, agent/model, events and last delivery', () => {
    const r = rule({ id: 'api-review', workspace: 'api', agent: 'codex', model: 'gpt-5', events: ['opened'] });
    const line = formatTriggerLine(r, 'active', d({ at: iso(120_000), outcome: 'started' }), NOW);
    for (const s of ['api-review', 'active', 'acme/api', '→ full-review', 'api', 'codex/gpt-5', 'opened', '2m ago', 'started']) expect(line).toContain(s);
    const bare = formatTriggerLine(rule({ id: 'x' }), 'idle', undefined, NOW);
    expect(bare).toContain('no deliveries');
    expect(bare).toContain('default agent');
    expect(bare).toContain('opened,reopened,synchronize,ready_for_review');
  });

  it('explainMatch mirrors matchRule and says why', () => {
    const pr = { repo: 'acme/api', labels: [] as string[], draft: false, fork: false };
    expect(explainMatch(rule(), pr)).toMatchObject({ matches: true });
    expect(explainMatch(rule({ enabled: false }), pr)).toMatchObject({ matches: false, why: expect.stringMatching(/disabled|paused/) });
    expect(explainMatch(rule({ repo: 'other/x' }), pr).why).toMatch(/other\/x/);
    expect(explainMatch(rule({ repo: '*' }), pr).matches).toBe(true);
    expect(explainMatch(rule(), { ...pr, draft: true }).why).toMatch(/draft/);
    expect(explainMatch(rule({ drafts: true }), { ...pr, draft: true }).matches).toBe(true);
    expect(explainMatch(rule(), { ...pr, fork: true }).why).toMatch(/fork/);
    expect(explainMatch(rule({ labels: ['ship'] }), pr).why).toMatch(/label/);
    expect(explainMatch(rule({ labels: ['ship'] }), { ...pr, labels: ['ship'] }).matches).toBe(true);
    expect(explainMatch(rule({ events: ['closed'] }), { ...pr, action: 'opened' }).why).toMatch(/opened/);
    expect(explainMatch(rule({ events: ['closed'] }), pr).matches).toBe(true); // no action known: events are not checked
    // agrees with matchRule
    for (const r of [rule(), rule({ drafts: true }), rule({ labels: ['a'] }), rule({ repo: '*' })]) {
      const p = { ...pr, action: 'opened' };
      expect(explainMatch(r, p).matches).toBe(!!matchRule([r], p));
    }
  });

  it('parseRuleArgs builds and validates a rule', () => {
    const ok = parseRuleArgs('acme/api', { workflow: 'w', workspace: 'api', agent: 'codex', model: 'm', events: 'opened, synchronize', labels: 'a,b', comment: true, drafts: true, forks: true, id: 'my-id' });
    expect(ok).toEqual({ repo: 'acme/api', workflow: 'w', comment: true, drafts: true, forks: true, labels: ['a', 'b'], events: ['opened', 'synchronize'], workspace: 'api', agent: 'codex', model: 'm', id: 'my-id' });
    expect(parseRuleArgs('*', {})).toEqual({ repo: '*', workflow: 'full-review' });
    expect(() => parseRuleArgs('not a repo', {})).toThrow(/owner\/repo/);
    expect(() => parseRuleArgs('acme/api', { id: 'Bad Id!' })).toThrow(/id/);
    expect(() => parseRuleArgs('acme/api', { workflow: 'bad name' })).toThrow(/workflow/);
    expect(() => parseRuleArgs('acme/api', { events: 'Opened!' })).toThrow(/event/);
    expect(() => parseRuleArgs('acme/api', { model: 'm' })).toThrow(/--model needs --agent/);
    expect(() => parseRuleArgs('acme/api', { agent: 'codex', model: 'm' })).not.toThrow();
  });

  it('checkRuleRefs warns when the workspace does not hold the trigger repo (not for *)', () => {
    const refs = (repos: string[]) => ({ hasWorkspace: () => true, hasAgent: () => true, checkWorkflow: () => ({}), workspaceRepos: () => repos });
    expect(checkRuleRefs(rule({ workspace: 'w' }), refs(['acme/web'])).warnings.join(' ')).toMatch(/acme\/web, not acme\/api/);
    expect(checkRuleRefs(rule({ workspace: 'w' }), refs([])).warnings.join(' ')).toMatch(/does not list acme\/api/);
    expect(checkRuleRefs(rule({ workspace: 'w' }), refs(['ACME/API'])).warnings).toEqual([]);
    expect(checkRuleRefs(rule({ repo: '*', workspace: 'w' }), refs(['acme/web'])).warnings).toEqual([]);
  });

  it('reportOnce says a failure once per key and signature', () => {
    const m = new Map<string, string>();
    expect(reportOnce(m, 'a#1', 'sha1|boom')).toBe(true);
    expect(reportOnce(m, 'a#1', 'sha1|boom')).toBe(false);
    expect(reportOnce(m, 'a#1', 'sha2|boom')).toBe(true);
    expect(reportOnce(m, 'a#1', 'sha2|other')).toBe(true);
    expect(reportOnce(m, 'b#1', 'sha2|other')).toBe(true);
  });

  it('refusal only speaks when a trigger covering the repo and the action said no', () => {
    const pr = { repo: 'acme/api', labels: [] as string[], draft: false, fork: false, action: 'opened' };
    expect(refusal([rule()], pr)).toBeUndefined();
    expect(refusal([], pr)).toBeUndefined();
    expect(refusal([rule({ repo: 'other/x' })], pr)).toBeUndefined();
    expect(refusal([rule()], { ...pr, action: 'closed' })).toBeUndefined();
    expect(refusal([rule({ enabled: false })], pr)).toBeUndefined();
    expect(refusal([rule({ id: 't' })], { ...pr, draft: true })?.why).toMatch(/draft/);
    expect(refusal([rule({ labels: ['x'] })], pr)?.why).toMatch(/labels/);
    expect(refusal([rule({ repo: '*', id: 'star' })], { ...pr, fork: true })?.rule.id).toBe('star');
  });

  it('checkRuleRefs reports unknown workspace, workflow and agent, and passes warnings through', () => {
    const refs = { hasWorkspace: (i: string) => i === 'api', hasAgent: (a: string) => a === 'claude', checkWorkflow: (r: Rule) => (r.workflow === 'full-review' ? {} : r.workflow === 'maybe' ? { warning: 'cannot check maybe' } : { error: `no workflow called "${r.workflow}"` }) };
    expect(checkRuleRefs(rule({ workspace: 'api', agent: 'claude' }), refs)).toEqual({ errors: [], warnings: [] });
    const bad = checkRuleRefs(rule({ workflow: 'nope', workspace: 'zzz', agent: 'ghost' }), refs);
    expect(bad.errors).toHaveLength(3);
    expect(bad.errors.join(' ')).toMatch(/workspace "zzz"/);
    expect(bad.errors.join(' ')).toMatch(/agent "ghost"/);
    expect(bad.errors.join(' ')).toMatch(/nope/);
    expect(checkRuleRefs(rule({ workflow: 'maybe' }), refs)).toEqual({ errors: [], warnings: ['cannot check maybe'] });
  });

  describe('checkWorkflow resolves like startPrRun', () => {
    const skill = (dir: string, name: string) => {
      mkdirSync(join(dir, '.claude', 'skills', name), { recursive: true });
      writeFileSync(join(dir, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\nDo it.\n`);
    };
    it('finds a project skill under the workspace folder, whatever the cwd', () => {
      const home = tmp();
      const ws = tmp();
      skill(ws, 'ws-only-skill');
      initWorkspace(home, ws, { id: 'proj', write: false });
      mkdirSync(join(ws, '.aorch'), { recursive: true });
      writeFileSync(join(ws, '.aorch', 'workspace.json'), JSON.stringify({ repos: ['acme/api'] }));
      expect(checkWorkflow(home, rule({ workspace: 'proj', workflow: 'ws-only-skill' }))).toEqual({});
      expect(checkWorkflow(home, rule({ workspace: 'proj', workflow: 'typo-skill' })).error).toMatch(/typo-skill/);
      // a * trigger can't be told apart from the PR's repo yet: the workspace folder is still searched
      expect(checkWorkflow(home, rule({ repo: '*', workspace: 'proj', workflow: 'ws-only-skill' }))).toEqual({});
    });
    it('uses the mapped folder, case-insensitively', () => {
      const home = tmp();
      const dir = tmp();
      skill(dir, 'mapped-skill');
      saveSettings(home, { repos: { 'acme/api': dir } });
      expect(checkWorkflow(home, rule({ repo: 'Acme/API', workflow: 'mapped-skill' }))).toEqual({});
    });
    it('only warns when the repo cannot be resolved', () => {
      const home = tmp();
      expect(checkWorkflow(home, rule({ repo: '*', workflow: 'some-project-skill' }))).toMatchObject({ warning: expect.stringMatching(/some-project-skill/) });
      expect(checkWorkflow(home, rule({ workflow: 'some-project-skill' })).error).toBeUndefined();
      expect(checkWorkflow(home, rule({ workflow: 'full-review' }))).toEqual({});
    });
  });

  describe('planRuleAdd', () => {
    it('replaces the same repo+workflow case-insensitively, keeping the old id and enabled:false', () => {
      const old = [rule({ id: 'custom', enabled: false })];
      const { next, prev } = planRuleAdd(old, rule({ repo: 'ACME/api', comment: true }));
      expect(prev).toBe(old[0]);
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({ id: 'custom', enabled: false, comment: true });
    });
    it('lets --id update the same trigger and uses the new id', () => {
      const { next } = planRuleAdd([rule({ id: 'a' })], rule({ id: 'b' }));
      expect(next.map((r) => r.id)).toEqual(['b']);
      expect(planRuleAdd([rule({ id: 'a' })], rule({ id: 'a' })).next).toHaveLength(1);
    });
    it('refuses an id that belongs to a different trigger', () => {
      expect(() => planRuleAdd([rule({ id: 'a' }), rule({ workflow: 'other', id: 'x' })], rule({ id: 'x' }))).toThrow(/"x" already exists/);
    });
    it('adds a new trigger alongside', () => {
      const { next, prev } = planRuleAdd([rule({ id: 'a' })], rule({ repo: 'o/p' }));
      expect(prev).toBeUndefined();
      expect(next).toHaveLength(2);
    });
  });

  it('dryRunVerdict notices an already-reviewed PR', () => {
    const pr = { repo: 'acme/api', labels: [], draft: false, fork: false };
    expect(dryRunVerdict(rule(), pr, { sha: 'abcdef123456', runId: 'r1' })).toEqual({ matches: false, why: 'already reviewed at abcdef1 (run r1)' });
    expect(dryRunVerdict(rule(), pr, undefined).matches).toBe(true);
    expect(dryRunVerdict(rule({ enabled: false }), pr, { sha: 'abcdef123456', runId: 'r1' }).why).toMatch(/disabled/);
  });

  it('resolveRuleId finds by id, and says when ambiguous or missing', () => {
    const rs = ensureIds([rule({ id: 'a' }), rule({ id: 'b' })]);
    expect(findRule(rs, 'a')).toBe(rs[0]);
    expect(() => findRule(rs, 'zz')).toThrow(/no trigger "zz"/);
  });

  it('parsePrTarget takes a link, owner/repo#n or a bare number for a concrete rule repo', () => {
    expect(parsePrTarget('42', rule()).repo).toBe('acme/api');
    expect(parsePrTarget('#42', rule()).number).toBe(42);
    expect(parsePrTarget('https://github.com/x/y/pull/7', rule()).repo).toBe('x/y');
    expect(() => parsePrTarget('42', rule({ repo: '*' }))).toThrow(/owner\/repo/);
  });
});
