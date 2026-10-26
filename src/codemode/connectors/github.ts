/**
 * `github`: repositories, pull requests, issues, comments and checks through `gh`, with the connected account applied
 * (spec §3: an adopted CLI login as is, a device-flow token as GH_TOKEN). Commenting and merging change things outside
 * the repository, so they need approval.
 */
import type { Exec } from '../../exec.js';
import type { Connector, Method } from '../types.js';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const repoArg = (v: unknown) => {
  if (typeof v !== 'string' || !REPO_RE.test(v)) throw new Error('the repository must be "owner/name"');
  return v;
};
const numArg = (v: unknown) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error('the number must be a positive integer');
  return String(v);
};
const limitArg = (v: unknown, d = 20) => String(Math.min(100, Math.max(1, typeof v === 'number' ? Math.trunc(v) : d)));
const stateArg = (v: unknown) => (v === 'closed' || v === 'all' || v === 'merged' ? v : 'open');
const opts = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

const S = { type: 'string' } as const;
const N = { type: 'integer' } as const;

export function githubConnector(exec: Exec): Connector {
  /** `gh …` as JSON; a failure carries gh's first line (never a token: gh does not print one). */
  const gh = async (args: string[], stdin?: string): Promise<unknown> => {
    const r = await exec('gh', args, undefined, stdin);
    if (r.code !== 0) throw new Error(/ENOENT|not found/i.test(r.stderr) && !r.stdout ? 'the GitHub CLI (gh) is not installed' : r.stderr.trim().split('\n')[0] || `gh exited ${r.code}`);
    const t = r.stdout.trim();
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  };
  const methods: Method[] = [
    {
      name: 'repos',
      summary: 'Repositories of the connected account (or of an owner).',
      params: [{ name: 'opts', schema: { type: 'object', properties: { owner: S, limit: N } }, optional: true }],
      returns: '{ nameWithOwner: string; description: string; updatedAt: string }[]',
      run: ([o]) => {
        const owner = opts(o).owner;
        return gh(['repo', 'list', ...(typeof owner === 'string' && /^[\w.-]+$/.test(owner) ? [owner] : []), '--limit', limitArg(opts(o).limit), '--json', 'nameWithOwner,description,updatedAt']);
      },
    },
    {
      name: 'prs',
      summary: 'Pull requests of a repository (open by default).',
      params: [
        { name: 'repo', schema: S },
        { name: 'opts', schema: { type: 'object', properties: { state: { enum: ['open', 'closed', 'merged', 'all'] }, limit: N } }, optional: true },
      ],
      returns: '{ number: number; title: string; author: { login: string }; headRefName: string; isDraft: boolean; updatedAt: string }[]',
      run: ([repo, o]) => gh(['pr', 'list', '-R', repoArg(repo), '--state', stateArg(opts(o).state), '--limit', limitArg(opts(o).limit), '--json', 'number,title,author,headRefName,isDraft,updatedAt']),
    },
    {
      name: 'pr',
      summary: 'One pull request: title, body, state, branches, files, review decision.',
      params: [
        { name: 'repo', schema: S },
        { name: 'number', schema: N },
      ],
      returns: 'Record<string, unknown>',
      run: ([repo, n]) => gh(['pr', 'view', numArg(n), '-R', repoArg(repo), '--json', 'number,title,body,author,state,headRefName,baseRefName,files,reviewDecision,mergeable,url']),
    },
    {
      name: 'issues',
      summary: 'Issues of a repository (open by default).',
      params: [
        { name: 'repo', schema: S },
        { name: 'opts', schema: { type: 'object', properties: { state: { enum: ['open', 'closed', 'all'] }, limit: N } }, optional: true },
      ],
      returns: '{ number: number; title: string; author: { login: string }; labels: { name: string }[]; updatedAt: string }[]',
      run: ([repo, o]) => gh(['issue', 'list', '-R', repoArg(repo), '--state', stateArg(opts(o).state), '--limit', limitArg(opts(o).limit), '--json', 'number,title,author,labels,updatedAt']),
    },
    {
      name: 'issue',
      summary: 'One issue: title, body, state, labels.',
      params: [
        { name: 'repo', schema: S },
        { name: 'number', schema: N },
      ],
      returns: 'Record<string, unknown>',
      run: ([repo, n]) => gh(['issue', 'view', numArg(n), '-R', repoArg(repo), '--json', 'number,title,body,author,state,labels,url']),
    },
    {
      name: 'comments',
      summary: 'Comments on an issue or pull request.',
      params: [
        { name: 'repo', schema: S },
        { name: 'number', schema: N },
      ],
      returns: '{ user: { login: string }; body: string; created_at: string }[]',
      run: async ([repo, n]) => {
        const list = (await gh(['api', `repos/${repoArg(repo)}/issues/${numArg(n)}/comments`])) as { user?: { login?: string }; body?: string; created_at?: string }[];
        return (Array.isArray(list) ? list : []).map((c) => ({ user: { login: c.user?.login ?? '' }, body: c.body ?? '', created_at: c.created_at ?? '' }));
      },
    },
    {
      name: 'checks',
      summary: 'CI checks of a pull request.',
      params: [
        { name: 'repo', schema: S },
        { name: 'number', schema: N },
      ],
      returns: '{ name: string; state: string; link: string }[]',
      run: ([repo, n]) => gh(['pr', 'checks', numArg(n), '-R', repoArg(repo), '--json', 'name,state,link']),
    },
    {
      name: 'comment',
      summary: 'Comment on an issue or pull request (needs approval).',
      params: [
        { name: 'repo', schema: S },
        { name: 'number', schema: N },
        { name: 'body', schema: S },
      ],
      returns: '{ url: string }',
      outside: ([repo, n, body]) => `comment on ${String(repo)}#${String(n)}: "${String(body ?? '').replace(/\s+/g, ' ').slice(0, 80)}"`,
      run: async ([repo, n, body]) => {
        if (typeof body !== 'string' || !body.trim()) throw new Error('the comment body must be text');
        const r = (await gh(['api', `repos/${repoArg(repo)}/issues/${numArg(n)}/comments`, '--input', '-'], JSON.stringify({ body }))) as { html_url?: string } | null;
        return { url: r?.html_url ?? '' };
      },
    },
    {
      name: 'merge',
      summary: 'Merge a pull request (needs approval).',
      params: [
        { name: 'repo', schema: S },
        { name: 'number', schema: N },
        { name: 'opts', schema: { type: 'object', properties: { method: { enum: ['squash', 'merge', 'rebase'] } } }, optional: true },
      ],
      returns: 'string',
      outside: ([repo, n, o]) => `merge ${String(repo)}#${String(n)} (${String(opts(o).method ?? 'squash')})`,
      run: async ([repo, n, o]) => {
        const how = opts(o).method === 'merge' ? '--merge' : opts(o).method === 'rebase' ? '--rebase' : '--squash';
        await gh(['pr', 'merge', numArg(n), '-R', repoArg(repo), how]);
        return 'merged';
      },
    },
  ];
  return { name: 'github', summary: 'the connected GitHub account: repos, prs/pr, issues/issue, comments, checks, comment and merge (with approval)', methods: async () => methods };
}
