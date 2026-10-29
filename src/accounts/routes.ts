/**
 * /api/accounts*: Settings → Accounts over the loopback server (Host and Origin are checked by server.ts first). Every
 * answer carries public fields only (who, scopes, how, when): a token is never serialised here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { userInfo } from 'node:os';
import { HttpError, readJson, reqObject, send } from '../serverkit.js';
import { AccountError, DEVICE_SETUP, type GithubAccount } from './github.js';
import type { NvidiaAccount } from './nvidia.js';
import type { OpenRouterAccount } from './openrouter.js';
import { PROVIDERS } from './registry.js';
import { githubClientId, setGithubClientId } from './store.js';

export interface AccountsRouteCtx {
  home: string;
  github: GithubAccount;
  openrouter: OpenRouterAccount;
  nvidia: NvidiaAccount;
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
    const or = c.openrouter.account();
    const orView = { setup: await c.openrouter.setupNeeded(), defaults: or ? c.openrouter.defaults() : null };
    const providers = PROVIDERS.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      available: d.available,
      scopes: d.scopes,
      ...(d.note ? { note: d.note } : {}),
      account: (d.id === 'google' ? undefined : c[d.id].account()) ?? null,
      ...(d.id === 'github' ? { cli: cli ? { login: cli.login } : null, device: githubClientId(c.home) ? { ready: true } : { ready: false, setup: DEVICE_SETUP } } : {}),
      ...(d.id === 'openrouter' ? orView : {}),
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
  if (p === '/api/accounts/openrouter/models' && m === 'GET') {
    const r = await c.openrouter.models();
    if (!r.models.length) throw new HttpError(502, r.error ?? "can't reach OpenRouter");
    return send(res, 200, r), true;
  }
  if (p === '/api/accounts/openrouter/allowance' && m === 'GET') {
    const a = await c.openrouter.allowance().catch(() => {
      throw new HttpError(502, "can't reach OpenRouter");
    });
    if (!a) throw new HttpError(409, 'OpenRouter is not connected');
    return send(res, 200, a), true;
  }
  if (p === '/api/accounts/openrouter/crew' && m === 'POST') {
    if (!c.openrouter.account()) throw new HttpError(409, 'connect OpenRouter first');
    return send(res, 200, { bound: await c.openrouter.useForCrew() }), true;
  }
  if (p === '/api/accounts/nvidia' && m === 'POST') {
    const key = reqObject(await readJson(req)).key;
    if (typeof key !== 'string') throw new HttpError(400, '"key" must be a string');
    const account = await c.nvidia.connect(key).catch(asHttp);
    return send(res, 200, { account }), true;
  }
  if (p === '/api/accounts/nvidia/models' && m === 'GET') {
    const r = await c.nvidia.models();
    if (!r.models.length) throw new HttpError(502, r.error ?? "can't reach NVIDIA");
    return send(res, 200, r), true;
  }
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
    if (g[1] !== 'github' && g[1] !== 'openrouter' && g[1] !== 'nvidia') throw new HttpError(404, `no connection for "${g[1]}"`);
    await c[g[1]].disconnect();
    return send(res, 200, { ok: true }), true;
  }
  return false;
}
