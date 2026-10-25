/** /api/http/*: the API client over the existing loopback server (Host and Origin are checked by server.ts first). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Engine } from '../engine.js';
import { HttpError, readJson, reqObject, send as reply } from '../serverkit.js';
import type { Store } from '../store.js';
import { HttpClientError, statusFor } from './errors.js';
import { activeEnv, setActiveEnv } from './index.js';
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

  return false;
}
