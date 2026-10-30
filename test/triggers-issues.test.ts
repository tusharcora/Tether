// Issue and comment triggers. The webhook request cases are ported from deepseek-harness webhook/webhook-github tests/handler.spec.ts (MIT, © 2026 DeepSeek).
import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writePipeline } from '../src/config.js';
import { issueTask, matchRule, parseComment, parseIssue, saveSettings, startIssueRun, type Rule, type WebhookIssue } from '../src/pr.js';
import { startServer } from '../src/server.js';
import { ensureIds, explainIssue, firesOn, issueRefusal, matchIssueRule, mentions, parseRuleArgs, planRuleAdd, readDeliveries } from '../src/triggers.js';
import { Vault } from '../src/vault.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const repository = { full_name: 'acme/api' };
const issueBody = (action: string, o: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  action,
  repository,
  issue: { number: 7, title: 'Login breaks', body: 'Steps: click login', html_url: 'https://github.com/acme/api/issues/7', labels: [{ name: 'bug' }], user: { login: 'sam', type: 'User' }, author_association: 'OWNER', ...o },
  ...extra,
});
const commentBody = (text: string, o: Record<string, unknown> = {}, action = 'created') => ({
  action,
  repository,
  issue: { number: 7, title: 'Login breaks', labels: [] },
  comment: { id: 99, body: text, html_url: 'https://github.com/acme/api/issues/7#issuecomment-99', user: { login: 'kim', type: 'User' }, author_association: 'MEMBER', ...o },
});
const issue = (action = 'opened', o: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => parseIssue('issues', issueBody(action, o, extra))!;
const comment = (text: string, o: Record<string, unknown> = {}, action = 'created') => parseComment('issue_comment', commentBody(text, o, action))!;
const rule = (o: Partial<Rule> = {}): Rule => ({ repo: 'acme/api', workflow: 'fix', ...o });

describe('parsing issue and comment events', () => {
  it('reads an issue, the label just added, the author and whether GitHub trusts them', () => {
    expect(issue()).toEqual({ kind: 'issue', repo: 'acme/api', action: 'opened', number: 7, title: 'Login breaks', text: 'Steps: click login', url: 'https://github.com/acme/api/issues/7', labels: ['bug'], author: 'sam', trusted: true, bot: false });
    expect(issue('labeled', {}, { label: { name: 'tether' } }).added).toBe('tether');
    expect(issue('opened', { author_association: 'NONE' }).trusted).toBe(false);
    expect(parseIssue('pull_request', issueBody('opened'))).toBeNull();
    expect(parseIssue('issues', { action: 'opened', issue: { number: 1 } })).toBeNull();
  });

  it('reads a comment with its id, and spots bots', () => {
    expect(comment('hi @tether')).toMatchObject({ kind: 'comment', number: 7, text: 'hi @tether', commentId: 99, author: 'kim', trusted: true, bot: false, url: 'https://github.com/acme/api/issues/7#issuecomment-99' });
    expect(comment('x', { user: { login: 'ci[bot]', type: 'Bot' } }).bot).toBe(true);
    expect(parseComment('issues', commentBody('x'))).toBeNull();
    expect(parseComment('issue_comment', { ...commentBody('x'), comment: { body: 'no id' } })).toBeNull();
  });

  it('fences the issue or comment text as data, with the link', () => {
    const t = issueTask(issue());
    expect(t).toContain('Work on issue #7 in acme/api: https://github.com/acme/api/issues/7');
    expect(t).toContain('<issue-title>\nLogin breaks\n</issue-title>');
    expect(t).toContain('<issue-body>\nSteps: click login\n</issue-body>');
    expect(issueTask(comment('@tether please fix'))).toContain('<comment>\n@tether please fix\n</comment>');
  });
});

describe('matching issue and comment triggers', () => {
  it('an issue trigger without a label fires on new issues only', () => {
    expect(explainIssue(rule({ on: 'issue' }), issue()).matches).toBe(true);
    expect(explainIssue(rule({ on: 'issue' }), issue('labeled', {}, { label: { name: 'bug' } }))).toMatchObject({ matches: false, listens: false });
    expect(explainIssue(rule({ on: 'issue' }), issue('closed')).matches).toBe(false);
  });

  it('an issue trigger with a label fires when the label is added, or an issue opens with it', () => {
    const r = rule({ on: 'issue', label: 'tether' });
    expect(explainIssue(r, issue('labeled', {}, { label: { name: 'tether' } })).matches).toBe(true);
    expect(explainIssue(r, issue('labeled', {}, { label: { name: 'bug' } }))).toMatchObject({ matches: false, listens: false });
    expect(explainIssue(r, issue('opened', { labels: [{ name: 'tether' }] })).matches).toBe(true);
    expect(explainIssue(r, issue('opened')).matches).toBe(false);
  });

  it('a comment trigger fires on a new comment that mentions it as a word', () => {
    expect(explainIssue(rule({ on: 'comment' }), comment('Hey @Tether, fix this.')).matches).toBe(true);
    expect(explainIssue(rule({ on: 'comment' }), comment('@tether fix', {}, 'edited')).matches).toBe(false);
    expect(explainIssue(rule({ on: 'comment', mention: '@bolt' }), comment('@bolt go')).matches).toBe(true);
    expect(explainIssue(rule({ on: 'comment', mention: '@bolt' }), comment('@tether go')).matches).toBe(false);
    for (const t of ['@tetherbot go', 'mail me at x@tether.dev', 'no mention']) expect(mentions(t, '@tether')).toBe(false);
    for (const t of ['@tether', '(@tether)', 'cc @tether.', 'line\n@tether']) expect(mentions(t, '@tether')).toBe(true);
  });

  it('never fires for an outside author or a bot, and says so', () => {
    const r = rule({ on: 'comment' });
    expect(explainIssue(r, comment('@tether', { author_association: 'CONTRIBUTOR' }))).toMatchObject({ matches: false, listens: true, why: 'kim is not an owner, member or collaborator of acme/api' });
    expect(explainIssue(r, comment('@tether', { user: { login: 'ci', type: 'Bot' } })).why).toBe('the comment comes from a bot');
    expect(issueRefusal([r], comment('@tether', { author_association: 'NONE' }))?.rule).toBe(r);
    expect(issueRefusal([r], comment('nothing for us', { author_association: 'NONE' }))).toBeUndefined();
  });

  it('keeps the kinds apart: PR rules never see issues, issue rules never see PRs, paused rules nothing', () => {
    expect(matchIssueRule([rule()], issue())).toBeUndefined();
    expect(matchIssueRule([rule({ on: 'comment' })], issue())).toBeUndefined();
    expect(matchIssueRule([rule({ on: 'issue', enabled: false })], issue())).toBeUndefined();
    expect(matchIssueRule([rule({ on: 'issue', repo: '*' })], issue())).toBeTruthy();
    expect(matchRule([rule({ on: 'issue' })], { repo: 'acme/api', action: 'opened', labels: [], draft: false, fork: false })).toBeUndefined();
  });
});

describe('issue and comment rules', () => {
  it('parse the kind, its label or mention, and drop the pull-request filters', () => {
    expect(parseRuleArgs('acme/api', { workflow: 'fix', on: 'issue', label: ' tether ', events: 'opened', labels: 'x', comment: true, drafts: true })).toEqual({ repo: 'acme/api', workflow: 'fix', on: 'issue', label: 'tether' });
    expect(parseRuleArgs('acme/api', { workflow: 'fix', on: 'comment', mention: '@bolt', label: 'ignored' })).toEqual({ repo: 'acme/api', workflow: 'fix', on: 'comment', mention: '@bolt' });
    expect(parseRuleArgs('acme/api', { workflow: 'fix', on: 'pr' })).toEqual({ repo: 'acme/api', workflow: 'fix' });
    expect(() => parseRuleArgs('acme/api', { on: 'push' })).toThrow(/pr, issue or comment/);
    expect(() => parseRuleArgs('acme/api', { on: 'comment', mention: 'bolt' })).toThrow(/@name/);
    expect(() => parseRuleArgs('acme/api', { on: 'issue', label: 'a,b' })).toThrow(/label/);
  });

  it('sit next to a PR trigger for the same repo and workflow, with their own id', () => {
    const pr = ensureIds([rule()]);
    const { next, prev } = planRuleAdd(pr, rule({ on: 'issue' }));
    expect(prev).toBeUndefined();
    expect(ensureIds(next).map((r) => r.id)).toEqual(['acme-api-fix', 'acme-api-fix-issue']);
    expect(firesOn(rule({ on: 'issue', label: 'tether' }))).toBe('issue labeled tether');
    expect(firesOn(rule({ on: 'comment' }))).toBe('comment @tether');
  });
});

describe('startIssueRun', () => {
  it('starts the workflow in the mapped checkout with the issue as the task, once per opening, label or comment', async () => {
    const home = tmp('home-');
    const repo = makeRepo();
    saveSettings(home, { repos: { 'acme/api': repo }, rules: [] });
    writePipeline(home, pipe([{ id: 'a', agent: 'claude' }], [], {}));
    const seen: { task: string; repo: string; workspace?: unknown; pipeline: { name: string } }[] = [];
    const engine = { start: async (i: never) => (seen.push(i), `r${seen.length}`), wait: async () => ({}) as never };
    const d = { home, engine, exec: async () => ({ code: 1, stdout: '', stderr: 'no gh in tests' }) };
    expect(await startIssueRun(d, issue(), { workflow: 'test', agent: 'codex' })).toEqual({ runId: 'r1' });
    expect(seen[0]).toMatchObject({ repo, task: issueTask(issue()) });
    await expect(startIssueRun(d, issue(), { workflow: 'test' })).rejects.toThrow(/already started for this issue \(run r1\)/);
    expect((await startIssueRun(d, issue('labeled', {}, { label: { name: 'tether' } }), { workflow: 'test' })).runId).toBe('r2');
    const c: WebhookIssue = comment('@tether go');
    expect((await startIssueRun(d, c, { workflow: 'test' })).runId).toBe('r3');
    await expect(startIssueRun(d, c, { workflow: 'test' })).rejects.toThrow(/already started for this comment/);
  });
});

describe('the GitHub webhook with issue and comment triggers', () => {
  let close: () => Promise<void>;
  let url = '';
  let home = '';
  beforeAll(async () => {
    const vault = new Vault(tmp('vault-'));
    const s0 = setup(vault);
    home = s0.home;
    saveSettings(home, { webhookSecret: 'shh', repos: { 'acme/api': makeRepo() }, rules: ensureIds([rule({ workflow: 'test', on: 'issue' }), rule({ workflow: 'test', on: 'comment' })]) });
    writePipeline(home, pipe([{ id: 'a', agent: 'mock' }], []));
    const s = await startServer({ engine: s0.engine, store: s0.store, vault, registry: s0.registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    url = s.url;
    close = s.close;
  });
  afterAll(() => close());

  const post = (raw: string, o: { event?: string | null; secret?: string } = {}) =>
    new Promise<number>((resolve, reject) => {
      const u = new URL(url);
      const headers: Record<string, string> = { host: u.host, 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', o.secret ?? 'shh').update(raw).digest('hex') };
      if (o.event !== null) headers['x-github-event'] = o.event ?? 'issues';
      const req = request({ host: u.hostname, port: u.port, method: 'POST', path: '/api/webhooks/github', headers }, (res) => (res.resume(), res.on('end', () => resolve(res.statusCode ?? 0))));
      req.on('error', reject);
      req.end(raw);
    });
  const until = async (n: number) => {
    const start = Date.now();
    while (readDeliveries(home).length < n && Date.now() - start < 10_000) await new Promise((r) => setTimeout(r, 50));
    return readDeliveries(home);
  };

  it.each([
    ['signature', JSON.stringify(issueBody('opened')), { secret: 'wrong' }, 401],
    ['event header', '{}', { event: null }, 400],
    ['JSON body', '{', {}, 400],
    ['array body', '[]', {}, 400],
  ] as const)('rejects an invalid %s before anything starts', async (_label, raw, o, status) => {
    expect(await post(raw, o)).toBe(status);
    expect(readDeliveries(home)).toEqual([]);
  });

  it('starts runs for a trusted new issue and a mention, logs refusals, and never starts the same comment twice', async () => {
    expect(await post(JSON.stringify(issueBody('opened', { author_association: 'NONE', user: { login: 'eve' } })))).toBe(202);
    expect((await until(1))[0]).toMatchObject({ trigger: 'acme-api-test-issue', outcome: 'ignored', pr: 7, reason: 'eve is not an owner, member or collaborator of acme/api' });

    expect(await post(JSON.stringify(issueBody('opened')))).toBe(202);
    expect((await until(2))[0]).toMatchObject({ trigger: 'acme-api-test-issue', outcome: 'started', pr: 7, source: 'webhook' });
    expect(readDeliveries(home)[0]!.runId).toBeTruthy();

    expect(await post(JSON.stringify(commentBody('no mention here')), { event: 'issue_comment' })).toBe(202);
    expect(await post(JSON.stringify(commentBody('@tether take this')), { event: 'issue_comment' })).toBe(202);
    expect((await until(3))[0]).toMatchObject({ trigger: 'acme-api-test-comment', outcome: 'started' });

    expect(await post(JSON.stringify(commentBody('@tether take this')), { event: 'issue_comment' })).toBe(202);
    expect((await until(4))[0]).toMatchObject({ trigger: 'acme-api-test-comment', outcome: 'skipped', reason: expect.stringMatching(/already started for this comment/) });
    expect(JSON.stringify(readDeliveries(home))).not.toContain('shh');
  });
});
