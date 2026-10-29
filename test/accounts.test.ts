import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountError, DEVICE_SETUP, GithubAccount, ghExec, ghLogin, type DeviceState } from '../src/accounts/github.js';
import { accountKey } from '../src/accounts/keys.js';
import { OpenRouterAccount } from '../src/accounts/openrouter.js';
import { AdapterRegistry } from '../src/adapters/index.js';
import { loadConfig, type Config } from '../src/config.js';
import { authorizeUrl, challengeOf, checkCallback, loopbackRedirect, pkcePair, runPkceFlow } from '../src/accounts/pkce.js';
import { PROVIDERS, providerOf } from '../src/accounts/registry.js';
import { KEYCHAIN_SERVICE, defaultStore, fileStore, keychainStore, type SecretStore } from '../src/accounts/secretStore.js';
import { accountOf, githubClientId, setAccount, setGithubClientId } from '../src/accounts/store.js';
import type { Exec } from '../src/exec.js';
import { startHttpTestServer } from './http-helpers.js';
import { tmp } from './helpers.js';

const FAKE_SECURITY = fileURLToPath(new URL('./fixtures/fake-security.mjs', import.meta.url));
const TOKEN = 'gho_fakeDeviceToken0123456789';

/** A fake `gh`: logged in (or not), answering `gh api user`, recording every call with its env. */
function fakeGh(o: { loggedIn?: boolean; userFails?: boolean } = {}) {
  const calls: { args: string[]; env?: Record<string, string> }[] = [];
  const exec: Exec = async (cmd, args, _cwd, _stdin, env) => {
    calls.push({ args, ...(env ? { env } : {}) });
    if (cmd !== 'gh') return { code: 127, stdout: '', stderr: 'not gh' };
    const a = args.join(' ');
    if (a.startsWith('auth status'))
      return o.loggedIn === false ? { code: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login' } : { code: 0, stdout: "github.com\n  ✓ Logged in to github.com account octo (keyring)\n  - Active account: true\n  - Token: gho_************************************\n  - Token scopes: 'gist', 'read:org', 'repo'\n", stderr: '' };
    if (a === 'api user') return o.userFails ? { code: 1, stdout: '', stderr: 'HTTP 401: Bad credentials' } : { code: 0, stdout: JSON.stringify({ login: 'octo', name: 'Octo Cat', avatar_url: 'https://avatars.example/octo' }), stderr: '' };
    if (a.startsWith('auth token')) return { code: 0, stdout: 'gho_cliToken\n', stderr: '' };
    return { code: 0, stdout: '[]', stderr: '' };
  };
  return { exec, calls };
}

/** An in-memory SecretStore. */
const memStore = (): SecretStore & { items: Map<string, string> } => {
  const items = new Map<string, string>();
  return { kind: 'file', items, get: async (a) => items.get(a), set: async (a, v) => void items.set(a, v), delete: async (a) => void items.delete(a) };
};

/** A fake GitHub for the device flow: each token poll takes the next scripted answer. */
async function fakeGithub(script: Record<string, unknown>[]) {
  const seen: { path: string; body: string }[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ path: req.url ?? '', body });
      const json = (v: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
      if (req.url === '/login/device/code') return json({ device_code: 'dev-123', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
      if (req.url === '/login/oauth/access_token') return json(script.shift() ?? { error: 'authorization_pending' });
      if (req.url === '/user') return req.headers.authorization === `Bearer ${TOKEN}` ? json({ login: 'octo', name: 'Octo Cat' }) : json({ message: 'Bad credentials' }, 401);
      json({}, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { seen, endpoints: { device: `${base}/login/device/code`, token: `${base}/login/oauth/access_token`, api: base }, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const until = async (fn: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  vi.unstubAllEnvs();
});

describe('accounts registry', () => {
  it('lists OpenRouter (browser approval for a key), GitHub (device flow, gh login) and Google as registry-only with a reason', () => {
    expect(PROVIDERS.map((p) => [p.id, p.kind, p.available])).toEqual([
      ['openrouter', 'pkce-key', true],
      ['github', 'device', true],
      ['google', 'pkce', false],
    ]);
    expect(providerOf('github')!.scopes).toEqual(['repo', 'read:user', 'admin:repo_hook']);
    expect(providerOf('github')!.cli).toBe('gh');
    expect(providerOf('google')!.note).toMatch(/Coming when a feature needs it/);
    expect(providerOf('gitlab')).toBeUndefined();
  });
});

describe('gh adoption', () => {
  it('reads the logged-in account and its scopes from `gh auth status`, or nothing when logged out', async () => {
    expect(await ghLogin(fakeGh().exec)).toEqual({ login: 'octo', scopes: ['gist', 'read:org', 'repo'] });
    expect(await ghLogin(fakeGh({ loggedIn: false }).exec)).toBeUndefined();
  });

  it('adopts the CLI login after `gh api user`, stores who (never a token), and asks `gh auth token` when one is needed', async () => {
    const home = tmp('home-');
    const gh = fakeGh();
    const store = memStore();
    const a = new GithubAccount(home, { exec: gh.exec, store });
    const acc = await a.adoptCli();
    expect(acc).toMatchObject({ provider: 'github', login: 'octo', name: 'Octo Cat', via: 'gh', scopes: ['gist', 'read:org', 'repo'] });
    expect(readFileSync(join(home, 'accounts.json'), 'utf8')).not.toMatch(/gho_/);
    expect(store.items.size).toBe(0);
    expect(await a.token()).toBe('gho_cliToken');
    await a.disconnect();
    expect(accountOf(home, 'github')).toBeUndefined();
    // never logs gh out
    expect(gh.calls.some((c) => c.args[0] === 'auth' && c.args[1] === 'logout')).toBe(false);
  });

  it('refuses when gh is logged out or cannot read the user', async () => {
    await expect(new GithubAccount(tmp(), { exec: fakeGh({ loggedIn: false }).exec, store: memStore() }).adoptCli()).rejects.toMatchObject({ code: 'not_signed_in' });
    await expect(new GithubAccount(tmp(), { exec: fakeGh({ userFails: true }).exec, store: memStore() }).adoptCli()).rejects.toThrow(/Bad credentials/);
  });
});

describe('device flow against a fake GitHub', () => {
  const start = async (script: Record<string, unknown>[], home = tmp('home-')) => {
    const gh = await fakeGithub(script);
    cleanups.push(gh.close);
    setGithubClientId(home, 'Iv1.testclient');
    const store = memStore();
    const a = new GithubAccount(home, { exec: fakeGh().exec, store, endpoints: gh.endpoints, pollScale: 5 });
    cleanups.push(() => a.cancel());
    return { a, gh, store, home };
  };
  const settle = async (a: GithubAccount) => {
    await until(() => a.deviceState().state !== 'pending');
    return a.deviceState();
  };

  it('pending → connected: polls until approved, stores the token in the SecretStore and the account publicly', async () => {
    const { a, gh, store, home } = await start([{ error: 'authorization_pending' }, { access_token: TOKEN, token_type: 'bearer', scope: 'repo,read:user,admin:repo_hook' }]);
    const started = await a.startDevice();
    expect(started).toEqual({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 1 });
    expect(a.deviceState()).toMatchObject({ state: 'pending', userCode: 'ABCD-1234' });
    const s = (await settle(a)) as Extract<DeviceState, { state: 'connected' }>;
    expect(s.state).toBe('connected');
    expect(s.account).toMatchObject({ login: 'octo', via: 'device', scopes: ['repo', 'read:user', 'admin:repo_hook'] });
    expect(store.items.get('github')).toBe(TOKEN);
    expect(readFileSync(join(home, 'accounts.json'), 'utf8')).not.toContain(TOKEN);
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    expect(gh.seen[0]!.body).toContain('client_id=Iv1.testclient');
    expect(decodeURIComponent(gh.seen[0]!.body)).toContain('scope=repo+read:user+admin:repo_hook');
    expect(gh.seen.filter((x) => x.path === '/login/oauth/access_token').map((x) => x.body)).toEqual(Array(2).fill('client_id=Iv1.testclient&device_code=dev-123&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code'));
    expect(await a.token()).toBe(TOKEN);
    await a.disconnect();
    expect(store.items.size).toBe(0);
  });

  it('slow_down adds 5 s to the interval and keeps polling', async () => {
    const { a, gh } = await start([{ error: 'slow_down', interval: 2 }, { access_token: TOKEN, scope: 'repo' }]);
    await a.startDevice();
    const t0 = Date.now();
    expect((await settle(a)).state).toBe('connected');
    // 1 s, then 1 + 5 = 6 s, scaled by 5 ms per second
    expect(Date.now() - t0).toBeGreaterThanOrEqual(30);
    expect(gh.seen.filter((x) => x.path === '/login/oauth/access_token')).toHaveLength(2);
  });

  it('ends expired or denied when GitHub says so', async () => {
    const one = await start([{ error: 'expired_token' }]);
    await one.a.startDevice();
    expect((await settle(one.a)).state).toBe('expired');
    const two = await start([{ error: 'access_denied' }]);
    await two.a.startDevice();
    expect((await settle(two.a)).state).toBe('denied');
    expect(two.store.items.size).toBe(0);
  });

  it('without a client id, explains the one-time setup instead of starting', async () => {
    vi.stubEnv('TETHER_GITHUB_CLIENT_ID', '');
    const a = new GithubAccount(tmp('home-'), { exec: fakeGh().exec, store: memStore() });
    const e = await a.startDevice().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AccountError);
    expect((e as AccountError).code).toBe('setup');
    expect((e as Error).message).toBe(DEVICE_SETUP);
    expect(DEVICE_SETUP).toMatch(/Enable Device Flow/);
  });

  it('reads the client id from TETHER_GITHUB_CLIENT_ID before the saved one, and refuses a malformed one', () => {
    const home = tmp('home-');
    setGithubClientId(home, 'saved.id');
    expect(githubClientId(home)).toBe('saved.id');
    vi.stubEnv('TETHER_GITHUB_CLIENT_ID', 'env.id');
    expect(githubClientId(home)).toBe('env.id');
    expect(() => setGithubClientId(home, 'bad id with spaces')).toThrow(/client id/);
  });
});

describe('secret stores', () => {
  it('Keychain via a fake `security`: set over stdin, get, update, delete; the value never rides on argv', async () => {
    const dir = tmp('sec-');
    vi.stubEnv('FAKE_SECURITY_DB', join(dir, 'db.json'));
    vi.stubEnv('FAKE_SECURITY_LOG', join(dir, 'argv.log'));
    const k = keychainStore(FAKE_SECURITY);
    expect(await k.get('github')).toBeUndefined();
    await k.set('github', TOKEN);
    expect(await k.get('github')).toBe(TOKEN);
    await k.set('github', `${TOKEN}2`);
    expect(await k.get('github')).toBe(`${TOKEN}2`);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')))).toEqual([`${KEYCHAIN_SERVICE}/github`]);
    await k.delete('github');
    await k.delete('github'); // already gone: fine
    expect(await k.get('github')).toBeUndefined();
    const argv = readFileSync(join(dir, 'argv.log'), 'utf8');
    expect(argv).not.toContain('gho_');
    expect(argv).toContain('"-i"');
    await expect(k.set('github', 'has "quote"')).rejects.toThrow(/characters/);
    await expect(k.get('../etc')).rejects.toThrow(/invalid/);
  });

  it('a missing `security` fails without leaking anything', async () => {
    await expect(keychainStore('/nonexistent/security').get('github')).rejects.toThrow(/Keychain read failed \(security not found\)/);
  });

  it('elsewhere, a 0600 file in <home>/secrets/; the Keychain on a Mac', async () => {
    const home = tmp('home-');
    const f = fileStore(home);
    await f.set('github', TOKEN);
    const path = join(home, 'secrets', 'github');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, 'secrets')).mode & 0o777).toBe(0o700);
    expect(await f.get('github')).toBe(TOKEN);
    await f.delete('github');
    expect(existsSync(path)).toBe(false);
    expect(defaultStore(home, 'darwin').kind).toBe('keychain');
    expect(defaultStore(home, 'linux').kind).toBe('file');
  });
});

describe('GH_TOKEN for gh', () => {
  it('passes the device-flow token to `gh` only, and leaves an adopted CLI login (or none) alone', async () => {
    const home = tmp('home-');
    const store = memStore();
    const gh = fakeGh();
    const exec = ghExec(home, gh.exec, store);
    await exec('gh', ['pr', 'list']);
    expect(gh.calls.at(-1)!.env).toBeUndefined();
    setAccount(home, 'github', { provider: 'github', login: 'octo', scopes: [], via: 'gh', connectedAt: 1 });
    await exec('gh', ['pr', 'list']);
    expect(gh.calls.at(-1)!.env).toBeUndefined();
    setAccount(home, 'github', { provider: 'github', login: 'octo', scopes: [], via: 'device', connectedAt: 1 });
    await store.set('github', TOKEN);
    await exec('gh', ['pr', 'view', '1'], undefined, undefined, { X: '1' });
    expect(gh.calls.at(-1)!.env).toEqual({ X: '1', GH_TOKEN: TOKEN });
    await exec('git', ['fetch']);
    expect(gh.calls.at(-1)!.env).toBeUndefined();
  });
});

describe('PKCE loopback flow', () => {
  it('makes a verifier, its S256 challenge and a state', () => {
    const p = pkcePair();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).toBe(challengeOf(p.verifier));
    // RFC 7636 appendix B
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(pkcePair().state).not.toBe(p.state);
    const u = new URL(authorizeUrl(providerOf('google')!, { clientId: 'cid', redirectUri: loopbackRedirect(5555), challenge: p.challenge, state: p.state }));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', client_id: 'cid', redirect_uri: 'http://127.0.0.1:5555/oauth/callback', code_challenge_method: 'S256', code_challenge: p.challenge, state: p.state });
  });

  it('validates the loopback callback: path, provider error, state and code', () => {
    expect(checkCallback('/oauth/callback?code=c1&state=s1', 's1')).toEqual({ code: 'c1' });
    expect(checkCallback('/oauth/callback?code=c1&state=s2', 's1')).toEqual({ error: expect.stringMatching(/state does not match/) });
    expect(checkCallback('/oauth/callback?code=c1', 's1')).toEqual({ error: expect.stringMatching(/state/) });
    expect(checkCallback('/oauth/callback?error=access_denied&state=s1', 's1')).toEqual({ error: 'the provider refused: access_denied' });
    expect(checkCallback('/oauth/callback?state=s1', 's1')).toEqual({ error: 'the callback carries no code' });
    expect(checkCallback('/favicon.ico', 's1')).toEqual({ error: 'not the OAuth callback' });
  });

  it('runs the flow end to end: opens the page, takes the callback, exchanges the code with the verifier', async () => {
    let exchanged = '';
    const fetchFake = (async (_u: string, init: RequestInit) => {
      exchanged = String(init.body);
      return new Response(JSON.stringify({ access_token: 'ya29.fake', scope: 'openid' }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const token = await runPkceFlow(providerOf('google')!, {
      clientId: 'cid',
      fetch: fetchFake,
      open: async (url) => {
        const u = new URL(url);
        const back = new URL(u.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'the-code');
        back.searchParams.set('state', u.searchParams.get('state')!);
        await fetch(back);
      },
    });
    expect(token).toEqual({ accessToken: 'ya29.fake', scope: 'openid' });
    const body = new URLSearchParams(exchanged);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('/api/accounts', () => {
  it('lists providers with public fields only, adopts gh, refuses device flow without a client id, saves one, disconnects; never a token', async () => {
    vi.stubEnv('TETHER_GITHUB_CLIENT_ID', '');
    const store = memStore();
    const s = await startHttpTestServer({ github: (home) => new GithubAccount(home, { exec: fakeGh().exec, store }) });
    cleanups.push(s.close);
    const bodies: string[] = [];
    const call = async (m: string, p: string, b?: unknown) => {
      const r = await s.api(m, p, b);
      bodies.push(r.text);
      return r;
    };
    const list = (await call('GET', '/api/accounts')).json;
    expect(list.user).toEqual(expect.any(String));
    expect(list.providers.map((p: { id: string }) => p.id)).toEqual(['openrouter', 'github', 'google']);
    expect(list.providers[1]).toMatchObject({ account: null, cli: { login: 'octo' }, device: { ready: false, setup: DEVICE_SETUP } });
    expect(list.providers[2]).toMatchObject({ available: false, account: null });

    const dev = await call('POST', '/api/accounts/github/device');
    expect(dev.status).toBe(400);
    expect(dev.json).toMatchObject({ error: DEVICE_SETUP, code: 'setup' });

    const adopted = await call('POST', '/api/accounts/github/cli');
    expect(adopted.json.account).toMatchObject({ login: 'octo', via: 'gh' });
    expect(Object.keys(adopted.json.account).sort()).toEqual(['avatarUrl', 'connectedAt', 'login', 'name', 'provider', 'scopes', 'via']);
    expect((await call('GET', '/api/accounts')).json.providers[1].account.login).toBe('octo');

    expect((await call('PUT', '/api/accounts/github/client', { clientId: 'bad id' })).status).toBe(400);
    expect((await call('PUT', '/api/accounts/github/client', { clientId: 'Iv1.abc' })).json).toEqual({ ready: true });
    expect((await call('GET', '/api/accounts')).json.providers[1].device).toEqual({ ready: true });

    // a device-flow token sits in the store: nothing the API says ever contains it
    await store.set('github', TOKEN);
    setAccount(s.home, 'github', { provider: 'github', login: 'octo', scopes: ['repo'], via: 'device', connectedAt: 1 });
    await call('GET', '/api/accounts');
    await call('GET', '/api/accounts/github/device');
    expect((await call('DELETE', '/api/accounts/github')).json).toEqual({ ok: true });
    expect(store.items.size).toBe(0);
    expect((await call('DELETE', '/api/accounts/google')).status).toBe(404);
    for (const b of bodies) expect(b).not.toMatch(/gho_/);
  });
});

/** OpenRouter's exchange, faked: answers `key` for the expected code and verifier shape, recording the body. */
function fakeExchange(key = OR_KEY) {
  const seen: string[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    seen.push(String(init.body));
    return new Response(JSON.stringify({ key }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, seen };
}
const OR_KEY = 'sk-or-v1-fakeKey0123456789abcdef';
/** The person approving in the browser: OpenRouter sends them back to the callback with a code and the state it was given. */
const approve = (state?: string) => async (url: string) => {
  const u = new URL(url);
  const back = new URL(u.searchParams.get('callback_url')!.replace('//localhost:', '//127.0.0.1:'));
  back.searchParams.set('code', 'the-code');
  back.searchParams.set('state', state ?? u.searchParams.get('state')!);
  await fetch(back).catch(() => undefined);
};
const cfgOf = (home: string): Config => ({ home, vault: join(home, 'vault'), adapters: {}, endpoints: {} });

describe('OpenRouter account', () => {
  it('asks OpenRouter with a localhost callback, then stores the key in the SecretStore only and points the endpoint at it', async () => {
    const home = tmp('home-');
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-fromenv');
    writeFileSync(join(home, 'aorch.config.json'), JSON.stringify({ endpoints: { openrouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'env:OPENROUTER_API_KEY', model: 'x/y:free' } } }));
    const cfg = loadConfig({ home });
    const store = memStore();
    const registry = new AdapterRegistry();
    const { f, seen } = fakeExchange();
    let changed = 0;
    const acct = new OpenRouterAccount(cfg, registry, { fetch: f, store, onChange: () => changed++ });
    const { url } = await acct.start(approve());
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://openrouter.ai/auth');
    expect(u.searchParams.get('callback_url')).toMatch(/^http:\/\/localhost:\d+\/oauth\/callback$/);
    expect(u.searchParams.get('key_label')).toBe('Tether');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    await until(() => acct.flow().state === 'connected');
    expect(JSON.parse(seen[0]!)).toMatchObject({ code: 'the-code', code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: 'S256' });
    expect(store.items.get('openrouter')).toBe(OR_KEY);
    expect(await accountKey(home, 'openrouter')).toBe(OR_KEY);
    expect(acct.account()).toMatchObject({ provider: 'openrouter', via: 'browser' });
    // the env-based endpoint now reads the account's key, and keeps its other settings
    expect(cfg.endpoints.openrouter).toEqual({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'account:openrouter', model: 'x/y:free' });
    expect(registry.has('openrouter')).toBe(true);
    expect(changed).toBe(1);
    for (const f of ['accounts.json', 'aorch.config.json']) expect(readFileSync(join(home, f), 'utf8')).not.toContain(OR_KEY);
    expect(JSON.stringify(acct.flow())).not.toContain(OR_KEY);

    await acct.disconnect();
    expect(store.items.has('openrouter')).toBe(false);
    expect(acct.account()).toBeUndefined();
    expect(await accountKey(home, 'openrouter')).toBeUndefined();
    expect(loadConfig({ home }).endpoints.openrouter?.apiKey).toBe('account:openrouter');
  });

  it('refuses a callback with the wrong state: nothing is exchanged or stored', async () => {
    const home = tmp('home-');
    const store = memStore();
    const { f, seen } = fakeExchange();
    const acct = new OpenRouterAccount(cfgOf(home), new AdapterRegistry(), { fetch: f, store });
    await acct.start(approve('forged-state'));
    await until(() => acct.flow().state === 'error');
    expect(acct.flow()).toEqual({ state: 'error', error: expect.stringMatching(/state does not match/) });
    expect(seen).toHaveLength(0);
    expect(store.items.size).toBe(0);
    expect(acct.account()).toBeUndefined();
  });

  it('over /api/accounts: starts the approval, reports the flow, disconnects; never the key', async () => {
    const store = memStore();
    const { f } = fakeExchange();
    const s = await startHttpTestServer({ openrouter: { fetch: f, store } });
    cleanups.push(s.close);
    const bodies: string[] = [];
    const call = async (m: string, p: string) => {
      const r = await s.api(m, p);
      bodies.push(r.text);
      return r;
    };
    expect((await call('GET', '/api/accounts')).json.providers[0]).toMatchObject({ id: 'openrouter', name: 'OpenRouter', kind: 'pkce-key', account: null });
    const started = await call('POST', '/api/accounts/openrouter');
    expect(started.json.url).toMatch(/^https:\/\/openrouter\.ai\/auth\?/);
    expect((await call('GET', '/api/accounts/openrouter/flow')).json).toEqual({ state: 'pending', url: started.json.url });
    await approve()(started.json.url);
    await until(() => store.items.has('openrouter'));
    expect((await call('GET', '/api/accounts/openrouter/flow')).json.state).toBe('connected');
    expect((await call('GET', '/api/accounts')).json.providers[0].account).toMatchObject({ provider: 'openrouter', via: 'browser', login: 'Tether' });
    expect((await call('DELETE', '/api/accounts/openrouter')).json).toEqual({ ok: true });
    expect(store.items.size).toBe(0);
    for (const b of bodies) expect(b).not.toContain(OR_KEY);
  });
});

it('keeps accounts.json free of token fields even when handed one', () => {
  const home = tmp('home-');
  setAccount(home, 'github', { provider: 'github', login: 'octo', scopes: [], via: 'device', connectedAt: 1, token: TOKEN } as never);
  expect(readFileSync(join(home, 'accounts.json'), 'utf8')).not.toContain(TOKEN);
  writeFileSync(join(home, 'accounts.json'), '{broken');
  expect(accountOf(home, 'github')).toBeUndefined();
});
