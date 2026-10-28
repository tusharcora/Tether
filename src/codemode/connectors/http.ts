/**
 * `http`: the API tab's saved requests, run by id with an environment (variables and secrets resolved server-side, the
 * exchange redacted before the script sees it). The same rules as a request gate: requests come from the run's worktree,
 * environments and secrets from the workspace, and secrets only go to the host saved in the main checkout. A method that
 * changes things (not GET, HEAD or OPTIONS) needs approval.
 */
import { describeCheckResult, describeResult } from '../../http/describe.js';
import type { Db } from '../../http/history.js';
import { runRequest } from '../../http/index.js';
import { listRequests, readRequest } from '../../http/store.js';
import { mainCheckout } from '../../http/workspace.js';
import { getWorkspace } from '../../workspace.js';
import type { Connector, Method } from '../types.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const BODY_HEAD = 8192;

export function httpConnector(o: { home: string; db: Db; workdir: string; workspace?: string; runId: string }): Connector {
  const wsPath = o.workspace ? getWorkspace(o.home, o.workspace)?.path : undefined;
  const idArg = (v: unknown) => {
    if (typeof v !== 'string' || !v) throw new Error('a saved request id is "collection/name" (see http.list())');
    return v;
  };
  const methodOf = (id: string) => readRequest(o.workdir, id).file?.method;
  const methods: Method[] = [
    {
      name: 'list',
      summary: 'The saved requests: id, name, method, URL.',
      returns: '{ id: string; name: string; method: string; url: string }[]',
      run: async () => listRequests(o.workdir).filter((r) => !r.invalid).map((r) => ({ id: r.id, name: r.name, method: r.method, url: r.url })),
    },
    {
      name: 'run',
      summary: 'Send a saved request by id, optionally in an environment; returns status, timing, checks and the body head.',
      params: [
        { name: 'id', schema: { type: 'string' } },
        { name: 'opts', schema: { type: 'object', properties: { env: { type: 'string', description: "An environment name; default: the workspace's active one" } } }, optional: true },
      ],
      returns: '{ summary: string; status?: number; ms?: number; checks: { ok: boolean; name: string }[]; body: string }',
      outside: ([id]) => {
        const m = typeof id === 'string' ? methodOf(id) : undefined;
        return m && !SAFE.has(m) ? `send ${m} request "${id}"` : undefined;
      },
      run: async ([id, opts]) => {
        const env = (opts as { env?: unknown } | undefined)?.env;
        const out = await runRequest({
          home: o.home,
          db: o.db,
          workspace: o.workspace ?? 'default',
          dir: o.workdir,
          envDir: wsPath || o.workdir,
          id: idArg(id),
          ...(typeof env === 'string' ? { env } : {}),
          source: 'agent',
          runId: o.runId,
          allowSecrets: true,
          secretsOriginFrom: wsPath || mainCheckout(o.workdir) || o.workdir,
          signal: AbortSignal.timeout(8000),
        });
        const r = out.result;
        return {
          summary: describeResult(out.request, r, out.checks),
          ...(r.error ? {} : { status: r.status, ms: r.ms }),
          checks: out.checks.map((c) => ({ ok: c.ok, name: describeCheckResult(c) })),
          body: r.body.slice(0, BODY_HEAD),
        };
      },
    },
  ];
  return { name: 'http', summary: 'the saved API requests: list, run (by id, in an environment; unsafe methods need approval)', methods: async () => methods };
}
