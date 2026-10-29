/**
 * /api/accounts*: Settings → Accounts over the loopback server (Host and Origin are checked by server.ts first). Every
 * answer carries public fields only (who, scopes, how, when): a token is never serialised here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { userInfo } from 'node:os';
import { HttpError, readJson, reqObject, send } from '../serverkit.js';
import { AccountError, DEVICE_SETUP, type GithubAccount } from './github.js';
import type { OpenRouterAccount } from './openrouter.js';
import { PROVIDERS } from './registry.js';
import { githubClientId, setGithubClientId } from './store.js';

export interface AccountsRouteCtx {
  home: string;
  github: GithubAccount;
  openrouter: OpenRouterAccount;
}

const localUser = () => {
  try {
    return userInfo().username;
  } catch {
    return 'You';
  }
};

const asHttp = (e: unknown): never => {
  if (e instanceof AccountError) throw new HttpError(e.code === 'upstream' ? 502 : 400, e.message, { code: e.code });
  throw e;
};

export async function accountsRoute(c: AccountsRouteCtx, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const m = req.method ?? 'GET';

  if (p === '/api/accounts' && m === 'GET') {
    const cli = await c.github.cliLogin();
    const providers = PROVIDERS.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      available: d.available,
      scopes: d.scopes,
      ...(d.note ? { note: d.note } : {}),
      account: d.id === 'github' ? (c.github.account() ?? null) : d.id === 'openrouter' ? (c.openrouter.account() ?? null) : null,
      ...(d.id === 'github' ? { cli: cli ? { login: cli.login } : null, device: githubClientId(c.home) ? { ready: true } : { ready: false, setup: DEVICE_SETUP } } : {}),
    }));
    return send(res, 200, { user: localUser(), providers }), true;
  }
  if (p === '/api/accounts/openrouter' && m === 'POST') {
    // the page to open; the server waits for the browser to come back
    const started = await c.openrouter.start().catch((e: Error) => {
      throw new HttpError(502, e.message);
    });
    return send(res, 200, started), true;
  }
  if (p === '/api/accounts/openrouter/flow' && m === 'GET') return send(res, 200, c.openrouter.flow()), true;
  if (p === '/api/accounts/github/cli' && m === 'POST') {
    const account = await c.github.adoptCli().catch(asHttp);
    return send(res, 200, { account }), true;
  }
  if (p === '/api/accounts/github/device' && m === 'POST') {
    const started = await c.github.startDevice().catch(asHttp);
    return send(res, 200, started), true;
  }
  if (p === '/api/accounts/github/device' && m === 'GET') return send(res, 200, c.github.deviceState()), true;
  if (p === '/api/accounts/github/client' && m === 'PUT') {
    const v = reqObject(await readJson(req)).clientId;
    if (v !== null && typeof v !== 'string') throw new HttpError(400, '"clientId" must be a string or null');
    try {
      setGithubClientId(c.home, typeof v === 'string' && v.trim() ? v.trim() : undefined);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    return send(res, 200, { ready: !!githubClientId(c.home) }), true;
  }
  const g = /^\/api\/accounts\/([a-z]+)$/.exec(p);
  if (g && m === 'DELETE') {
    if (g[1] !== 'github' && g[1] !== 'openrouter') throw new HttpError(404, `no connection for "${g[1]}"`);
    await (g[1] === 'github' ? c.github : c.openrouter).disconnect();
    return send(res, 200, { ok: true }), true;
  }
  return false;
}
