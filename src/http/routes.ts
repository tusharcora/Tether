/** /api/http/*: the API client over the existing loopback server (Host and Origin are checked by server.ts first). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Engine } from '../engine.js';
import { rosterOf } from '../handoff.js';
import { normalizePipeline } from '../pipeline.js';
import { HttpError, readJson, reqObject, send as reply } from '../serverkit.js';
import type { Store } from '../store.js';
import { TeamError } from '../team.js';
import { agentTask } from './agent.js';
import { HttpClientError, statusFor } from './errors.js';
import { getHistory, HISTORY_LIST_MAX, listHistory } from './history.js';
import { applyImport, previewImport, type ImportKind } from './import.js';
import { activeEnv, runRequest, setActiveEnv } from './index.js';
import { describeVars } from './resolve.js';
import { deleteSecret, loadSecrets, secretKeys, setSecret } from './secrets.js';
import * as hs from './store.js';
import type { Environment } from './types.js';
import { projectFor, type HttpProject } from './workspace.js';

export interface HttpRouteCtx {
  home: string;
  store: Store;
  engine: Engine;
}

export const MAX_HTTP_BODY = 6_000_000;

const dec = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'invalid request id');
  }
};

export async function httpRoute(c: HttpRouteCtx, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  try {
    return await handle(c, req, res, url);
  } catch (e) {
    if (e instanceof HttpClientError) throw new HttpError(statusFor(e.code), e.message);
    throw e;
  }
}

async function handle(c: HttpRouteCtx, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const m = req.method ?? 'GET';
  const proj = (): HttpProject => {
    const pr = projectFor(c.home, url.searchParams.get('ws'));
    if (!pr) throw new HttpError(409, 'no workspace');
    return pr;
  };
  const body = async () => reqObject(await readJson(req, MAX_HTTP_BODY));
  /** The active environment, read like a send reads it: one gone from disk is a 409 with its name, never "no environment". */
  const envFor = (pr: HttpProject): { name: string; file: Environment } | undefined => {
    const name = activeEnv(c.home, pr.scope);
    if (!name) return undefined;
    try {
      return { name, file: hs.readEnvironment(pr.envDir, name) };
    } catch (e) {
      if (e instanceof HttpClientError && e.code === 'not_found') throw new HttpError(409, e.message);
      throw e;
    }
  };
  let g: RegExpMatchArray | null;

  if (p === '/api/http/tree' && m === 'GET') {
    const pr = proj();
    return reply(res, 200, { ...hs.readTree(pr.dir), activeEnv: activeEnv(c.home, pr.scope), workspace: pr.scope }), true;
  }

  if (p === '/api/http/requests' && m === 'POST') {
    const pr = proj();
    const b = await body();
    const collection = typeof b.collection === 'string' ? b.collection : '';
    return reply(res, 201, { id: hs.createRequest(pr.dir, collection, b.file) }), true;
  }
  if ((g = p.match(/^\/api\/http\/requests\/([^/]+)\/move$/)) && m === 'POST') {
    const pr = proj();
    const b = await body();
    if (typeof b.to !== 'string') throw new HttpError(400, '"to" must be a request id');
    hs.moveRequest(pr.dir, dec(g[1]!), b.to);
    return reply(res, 200, { id: b.to }), true;
  }
  if ((g = p.match(/^\/api\/http\/requests\/([^/]+)$/))) {
    const pr = proj();
    const id = dec(g[1]!);
    if (m === 'GET') {
      const r = hs.readRequest(pr.dir, id);
      // a secrets file that cannot be read (too open, not JSON) is reported here (500 with the fix), not shown as unset vars
      const vars = r.file ? describeVars(r.file, { collections: hs.collectionChain(pr.dir, id), env: envFor(pr), secrets: loadSecrets(c.home, pr.scope) }) : {};
      // an invalid file is shown read-only in the UI: send its text (capped) along with the error
      return reply(res, 200, { ...r, vars, ...(r.file ? {} : { raw: hs.readRawRequest(pr.dir, id) }) }), true;
    }
    if (m === 'PUT') return reply(res, 200, { id, file: hs.writeRequest(pr.dir, id, await body()) }), true;
    if (m === 'DELETE') {
      if (!hs.deleteRequest(pr.dir, id)) throw new HttpError(404, `no request "${id}"`);
      return reply(res, 200, { deleted: id }), true;
    }
  }

  if ((g = p.match(/^\/api\/http\/collections\/([^/]*)$/)) && m === 'PUT') {
    const pr = proj();
    const path = dec(g[1]!);
    return reply(res, 200, { path, file: hs.writeCollection(pr.dir, path, await body()) }), true;
  }

  if ((g = p.match(/^\/api\/http\/environments\/([^/]+)$/))) {
    const pr = proj();
    const name = dec(g[1]!);
    if (m === 'GET') return reply(res, 200, { name, ...hs.readEnvironment(pr.envDir, name) }), true;
    if (m === 'PUT') return reply(res, 200, { name, ...hs.writeEnvironment(pr.envDir, name, await body()) }), true;
    if (m === 'DELETE') {
      if (!hs.deleteEnvironment(pr.envDir, name)) throw new HttpError(404, `no environment "${name}"`);
      if (activeEnv(c.home, pr.scope) === name) setActiveEnv(c.home, pr.scope, null);
      return reply(res, 200, { deleted: name }), true;
    }
  }

  if (p === '/api/http/active-env' && m === 'PUT') {
    const pr = proj();
    const b = await body();
    if (b.name !== null && typeof b.name !== 'string') throw new HttpError(400, '"name" must be an environment name or null');
    if (typeof b.name === 'string') hs.readEnvironment(pr.envDir, b.name); // 404 for an unknown one
    setActiveEnv(c.home, pr.scope, (b.name as string | null) || null);
    return reply(res, 200, { activeEnv: activeEnv(c.home, pr.scope) }), true;
  }

  if (p === '/api/http/secrets' && m === 'GET') return reply(res, 200, { keys: secretKeys(c.home, proj().scope) }), true;
  if ((g = p.match(/^\/api\/http\/secrets\/([^/]+)$/))) {
    const pr = proj();
    const key = dec(g[1]!);
    if (m === 'PUT') {
      const b = await body();
      if (typeof b.value !== 'string') throw new HttpError(400, '"value" must be a string');
      setSecret(c.home, pr.scope, key, b.value);
      return reply(res, 200, { keys: secretKeys(c.home, pr.scope) }), true;
    }
    if (m === 'DELETE') {
      deleteSecret(c.home, pr.scope, key);
      return reply(res, 200, { keys: secretKeys(c.home, pr.scope) }), true;
    }
  }

  if (p === '/api/http/send' && m === 'POST') {
    const pr = proj();
    const b = await body();
    if (b.id !== undefined && typeof b.id !== 'string') throw new HttpError(400, '"id" must be a request id');
    if (b.id === undefined && b.draft === undefined) throw new HttpError(400, 'send needs "id" or "draft"');
    if (b.env !== undefined && b.env !== null && typeof b.env !== 'string') throw new HttpError(400, '"env" must be an environment name or null');
    // the active environment gone from disk is a 409 with its name (as on a read), never a send without it
    const env = b.env === undefined ? (envFor(pr)?.name ?? null) : (b.env as string | null);
    const out = await runRequest({ home: c.home, db: c.store.raw(), workspace: pr.scope, dir: pr.dir, envDir: pr.envDir, id: b.id as string | undefined, draft: b.draft, env, source: 'ui', allowSecrets: true });
    return reply(res, 200, out), true;
  }

  if (p === '/api/http/history' && m === 'GET') {
    const pr = proj();
    const raw = Number(url.searchParams.get('limit') || 20);
    // never let NaN or Infinity reach SQL LIMIT
    const limit = Number.isFinite(raw) ? Math.min(Math.max(1, Math.trunc(raw)), HISTORY_LIST_MAX) : 20;
    return reply(res, 200, listHistory(c.store.raw(), { workspace: pr.scope, request: url.searchParams.get('request') || undefined, limit })), true;
  }

  if ((p === '/api/http/import' || p === '/api/http/import/apply') && m === 'POST') {
    const pr = proj();
    const b = await body();
    if (b.kind !== 'curl' && b.kind !== 'openapi' && b.kind !== 'postman') throw new HttpError(400, '"kind" must be curl, openapi or postman');
    if (typeof b.text !== 'string' || !b.text.trim()) throw new HttpError(400, '"text" is required');
    if (b.into !== undefined && typeof b.into !== 'string') throw new HttpError(400, '"into" must be a collection path');
    // the preview is always recomputed here: apply never trusts a preview sent by the client
    const preview = previewImport(b.kind as ImportKind, b.text, { into: (b.into as string | undefined) ?? '', exists: (id) => hs.requestExists(pr.dir, id) });
    if (p === '/api/http/import') return reply(res, 200, preview), true;
    if (b.confirm !== true) throw new HttpError(400, 'add "confirm": true to write the files');
    if (preview.error) throw new HttpError(400, preview.error);
    return reply(res, 200, { created: applyImport(pr.dir, preview) }), true;
  }

  if (p === '/api/http/send-to-agent' && m === 'POST') {
    const pr = proj();
    const b = await body();
    if (!Number.isInteger(b.historyId)) throw new HttpError(400, '"historyId" must be a history id');
    if (b.note !== undefined && typeof b.note !== 'string') throw new HttpError(400, '"note" must be a string');
    const target = parseAgentTarget(b.target);
    const row = getHistory(c.store.raw(), pr.scope, b.historyId as number);
    if (!row) throw new HttpError(404, 'no such history entry');
    const task = agentTask(typeof b.note === 'string' ? b.note.slice(0, NOTE_MAX) : '', row);
    let runId: string;
    try {
      if (target.kind === 'maestro') runId = await c.engine.startTeam({ task, repo: pr.dir, mode: 'live', workspace: pr.workspaceId, background: true });
      else if (target.mode === 'team') runId = await c.engine.startTeam({ task, repo: pr.dir, mode: 'live', roster: [target.bot], workspace: pr.workspaceId, background: true });
      else {
        const pipeline = normalizePipeline({ name: 'api-exchange', nodes: [{ id: 'look', kind: 'agent', role: target.bot, title: 'Look into this API exchange' }], edges: [] });
        runId = await c.engine.start({ pipeline, task, repo: pr.dir, workspace: pr.workspaceId });
      }
    } catch (e) {
      if (e instanceof TeamError && e.code === 'invalid') throw new HttpError(400, e.message);
      if (e instanceof TeamError && e.code === 'conflict') throw new HttpError(409, e.message);
      throw new HttpError(500, (e as Error).message);
    }
    // The engine has no hook to record an event before its first step starts, so this lands right after run.started and may
    // follow the first node.started (solo) or planning event (team). It can never follow run.finished: no step finishes in this tick.
    c.store.append(runId, { type: 'http.attached', historyId: row.id });
    return reply(res, 201, { runId }), true;
  }

  return false;
}

const NOTE_MAX = 4000;
const BOT_ID = /^[a-z][a-z0-9_-]{0,23}$/;
type AgentTarget = { kind: 'run'; bot: string; mode: 'solo' | 'team' } | { kind: 'maestro' };

/** `{ kind: "run", bot, mode: "solo" | "team" }` with a crew bot, or `{ kind: "maestro" }`; anything else is a 400. */
function parseAgentTarget(v: unknown): AgentTarget {
  const shape = '"target" must be { kind: "run", bot, mode: "solo" | "team" } or { kind: "maestro" }';
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, shape);
  const t = v as { kind?: unknown; bot?: unknown; mode?: unknown };
  if (t.kind === 'maestro') return { kind: 'maestro' };
  if (t.kind !== 'run') throw new HttpError(400, shape);
  if (t.mode !== 'solo' && t.mode !== 'team') throw new HttpError(400, '"target.mode" must be "solo" or "team"');
  if (typeof t.bot !== 'string' || !BOT_ID.test(t.bot)) throw new HttpError(400, '"target.bot" must be a bot id');
  const crew = rosterOf({} as Parameters<typeof rosterOf>[0]);
  if (!crew.includes(t.bot)) throw new HttpError(400, `unknown bot "${t.bot}" (crew: ${crew.join(', ')})`);
  return { kind: 'run', bot: t.bot, mode: t.mode };
}
