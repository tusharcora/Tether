/**
 * The generic OAuth flow for providers without a device flow (RFC 8252, native apps): the system browser opens the
 * provider's page, which sends the person back to a one-shot loopback listener at http://127.0.0.1:<port>/oauth/callback
 * with a code. State (CSRF) and PKCE S256 guard it. Built and tested now so a provider like Google is a registry entry
 * plus the feature that uses it.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { ProviderDef } from './registry.js';

export const CALLBACK_PATH = '/oauth/callback';

/** A fresh verifier (43 base64url characters), its S256 challenge and a state value. */
export function pkcePair(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: challengeOf(verifier), state: randomBytes(16).toString('base64url') };
}

export const challengeOf = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');
export const loopbackRedirect = (port: number): string => `http://127.0.0.1:${port}${CALLBACK_PATH}`;

export function authorizeUrl(def: ProviderDef, o: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  if (!def.endpoints.authorize) throw new Error(`${def.name} has no authorization endpoint`);
  const u = new URL(def.endpoints.authorize);
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: o.clientId, redirect_uri: o.redirectUri, scope: def.scopes.join(' '), state: o.state, code_challenge: o.challenge, code_challenge_method: 'S256' })) u.searchParams.set(k, v);
  return u.toString();
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Judge a request to the loopback listener: the callback path, the provider's error, the state, and a code. */
export function checkCallback(requestUrl: string, expectedState: string): { code: string } | { error: string } {
  const u = new URL(requestUrl, 'http://127.0.0.1');
  if (u.pathname !== CALLBACK_PATH) return { error: 'not the OAuth callback' };
  const err = u.searchParams.get('error');
  if (err) return { error: `the provider refused: ${err.slice(0, 100)}` };
  const state = u.searchParams.get('state') ?? '';
  if (!state || !same(state, expectedState)) return { error: 'the state does not match (a stale or forged callback)' };
  const code = u.searchParams.get('code');
  return code ? { code } : { error: 'the callback carries no code' };
}

/**
 * The loopback half of a browser flow: listen on a free port (127.0.0.1 only), open the page `url` builds for that port,
 * and wait for the callback (5 min by default). Its state is checked; resolves to the code, the port and the PKCE
 * verifier for the exchange. One-shot: the listener closes when the callback (or the timeout) comes. Never logs.
 */
export async function loopbackCode(o: { url: (port: number, pair: { challenge: string; state: string }) => string; open: (url: string) => unknown; timeoutMs?: number }): Promise<{ code: string; port: number; verifier: string }> {
  const pair = pkcePair();
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer from the browser in time')), o.timeoutMs ?? 300_000);
      server.on('request', (req, res) => {
        const r = checkCallback(req.url ?? '/', pair.state);
        if ('error' in r && r.error === 'not the OAuth callback') return void res.writeHead(404).end();
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('error' in r ? `Tether could not connect: ${r.error}.` : 'Connected. You can close this tab and go back to Tether.');
        clearTimeout(timer);
        if ('error' in r) reject(new Error(r.error));
        else resolve(r.code);
      });
      void Promise.resolve(o.open(o.url(port, pair))).catch(reject);
    });
    return { code, port, verifier: pair.verifier };
  } finally {
    server.close();
  }
}

/** The whole standard OAuth flow: the loopback code, then the form exchange with the verifier. Resolves to the token response; never logs it. */
export async function runPkceFlow(def: ProviderDef, o: { clientId: string; open: (url: string) => unknown; fetch?: typeof fetch; timeoutMs?: number }): Promise<{ accessToken: string; refreshToken?: string; scope?: string }> {
  const { code, port, verifier } = await loopbackCode({ url: (p, pair) => authorizeUrl(def, { clientId: o.clientId, redirectUri: loopbackRedirect(p), challenge: pair.challenge, state: pair.state }), open: o.open, timeoutMs: o.timeoutMs });
  const res = await (o.fetch ?? fetch)(def.endpoints.token, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: loopbackRedirect(port), client_id: o.clientId, code_verifier: verifier }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; scope?: unknown; error?: unknown };
  if (typeof j.access_token !== 'string') throw new Error(`${def.name} did not issue a token (${typeof j.error === 'string' ? j.error : `HTTP ${res.status}`})`);
  return { accessToken: j.access_token, ...(typeof j.refresh_token === 'string' ? { refreshToken: j.refresh_token } : {}), ...(typeof j.scope === 'string' ? { scope: j.scope } : {}) };
}
