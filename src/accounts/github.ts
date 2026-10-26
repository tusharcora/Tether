/**
 * The GitHub account (spec §3.2). Two ways in: adopt the GitHub CLI's login (Tether asks `gh auth token` when it needs a
 * token and stores nothing), or sign in here with the OAuth device flow (the token goes to the SecretStore). Tether's
 * `gh` calls then use the connection: unchanged for an adopted login, with GH_TOKEN for a device-flow token.
 */
import { defaultExec, type Exec } from '../exec.js';
import { providerOf, type ProviderDef } from './registry.js';
import { defaultStore, type SecretStore } from './secretStore.js';
import { accountOf, githubClientId, setAccount, type PublicAccount } from './store.js';

export const DEVICE_SETUP =
  'Signing in with GitHub needs a GitHub OAuth App with Device Flow turned on (a one-time step): on github.com open Settings → Developer settings → OAuth Apps → New OAuth App (any homepage, callback http://127.0.0.1), tick "Enable Device Flow", then paste its Client ID here or set TETHER_GITHUB_CLIENT_ID. Until then, the GitHub CLI login works.';

/** A refusal that is the caller's to fix (400), with the text to show. */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly code: 'setup' | 'not_signed_in' | 'invalid' | 'upstream' = 'invalid',
  ) {
    super(message);
  }
}

export interface GithubDeps {
  exec?: Exec;
  fetch?: typeof fetch;
  store?: SecretStore;
  endpoints?: Partial<ProviderDef['endpoints']>;
  /** Milliseconds per second of GitHub's poll interval (tests shrink it). */
  pollScale?: number;
}

export type DeviceState =
  | { state: 'idle' }
  | { state: 'pending'; userCode: string; verificationUri: string; expiresAt: number }
  | { state: 'connected'; account: PublicAccount }
  | { state: 'expired' }
  | { state: 'denied' }
  | { state: 'error'; error: string };

/** The account `gh auth status` reports as logged in to github.com, with its token's scopes. */
export async function ghLogin(exec: Exec): Promise<{ login: string; scopes: string[] } | undefined> {
  const r = await exec('gh', ['auth', 'status', '--hostname', 'github.com']);
  if (r.code !== 0) return undefined;
  const text = `${r.stdout}\n${r.stderr}`;
  const login = /Logged in to github\.com (?:account|as) ([A-Za-z0-9-]+)/.exec(text)?.[1];
  if (!login) return undefined;
  const scopes = (/Token scopes:\s*([^\n]*)/.exec(text)?.[1] ?? '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return { login, scopes };
}

const CLI_CACHE_MS = 30_000;

export class GithubAccount {
  private readonly def = providerOf('github')!;
  private flow?: { deviceCode: string; interval: number; state: DeviceState; timer?: ReturnType<typeof setTimeout> };
  private cli?: { at: number; value: Promise<{ login: string; scopes: string[] } | undefined> };

  constructor(
    private readonly home: string,
    private readonly deps: GithubDeps = {},
  ) {}

  private get exec(): Exec {
    return this.deps.exec ?? defaultExec;
  }
  private get store(): SecretStore {
    return this.deps.store ?? defaultStore(this.home);
  }
  private url(k: keyof ProviderDef['endpoints']): string {
    return (this.deps.endpoints?.[k] ?? this.def.endpoints[k])!;
  }

  account(): PublicAccount | undefined {
    return accountOf(this.home, 'github');
  }

  /** The `gh` login on this Mac, if any (cached for 30 s: Settings polls it). */
  cliLogin(): Promise<{ login: string; scopes: string[] } | undefined> {
    if (!this.cli || Date.now() - this.cli.at > CLI_CACHE_MS) this.cli = { at: Date.now(), value: ghLogin(this.exec).catch(() => undefined) };
    return this.cli.value;
  }

  /** Adopt the GitHub CLI's login: checked with `gh api user`; Tether stores who, never the token. */
  async adoptCli(): Promise<PublicAccount> {
    this.cli = undefined;
    const login = await this.cliLogin();
    if (!login) throw new AccountError('The GitHub CLI is not signed in. Run `gh auth login` in a terminal, or sign in with GitHub here.', 'not_signed_in');
    const r = await this.exec('gh', ['api', 'user']);
    if (r.code !== 0) throw new AccountError(`gh could not read your GitHub user: ${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}`, 'upstream');
    const u = parseUser(r.stdout);
    if (!u) throw new AccountError('gh returned something unreadable for your GitHub user', 'upstream');
    await this.dropDeviceToken();
    const account: PublicAccount = { provider: 'github', ...u, scopes: login.scopes, via: 'gh', connectedAt: Date.now() };
    setAccount(this.home, 'github', account);
    return account;
  }

  /** Start the device flow: GitHub hands out a one-time code for github.com/login/device; Tether then polls until it is approved. */
  async startDevice(): Promise<{ userCode: string; verificationUri: string; expiresIn: number; interval: number }> {
    const clientId = githubClientId(this.home);
    if (!clientId) throw new AccountError(DEVICE_SETUP, 'setup');
    this.cancel();
    const j = await this.post(this.url('device'), { client_id: clientId, scope: this.def.scopes.join(' ') });
    if (typeof j.device_code !== 'string' || typeof j.user_code !== 'string') throw new AccountError(`GitHub refused the device code: ${describe(j)}`, 'upstream');
    const interval = Math.max(1, Number(j.interval) || 5);
    const expiresIn = Math.max(1, Number(j.expires_in) || 900);
    const verificationUri = typeof j.verification_uri === 'string' && /^https:\/\//.test(j.verification_uri) ? j.verification_uri : this.url('verify');
    this.flow = { deviceCode: j.device_code, interval, state: { state: 'pending', userCode: j.user_code, verificationUri, expiresAt: Date.now() + expiresIn * 1000 } };
    this.schedule(clientId);
    return { userCode: j.user_code, verificationUri, expiresIn, interval };
  }

  deviceState(): DeviceState {
    return this.flow?.state ?? { state: 'idle' };
  }

  /** Forget the connection: the stored token goes; for an adopted CLI login only Tether's adoption (never `gh auth logout`). */
  async disconnect(): Promise<void> {
    this.cancel();
    this.flow = undefined;
    await this.dropDeviceToken();
    setAccount(this.home, 'github', undefined);
  }

  /** The token for GitHub calls: the stored one (device flow) or `gh auth token` (adopted CLI login). Never sent to a client. */
  async token(): Promise<string | undefined> {
    const a = this.account();
    if (!a) return undefined;
    if (a.via === 'device') return this.store.get('github');
    const r = await this.exec('gh', ['auth', 'token', '--hostname', 'github.com']);
    return r.code === 0 ? r.stdout.trim() || undefined : undefined;
  }

  cancel(): void {
    clearTimeout(this.flow?.timer);
  }

  private async dropDeviceToken(): Promise<void> {
    if (this.account()?.via === 'device') await this.store.delete('github');
  }

  private schedule(clientId: string): void {
    const f = this.flow;
    if (!f) return;
    f.timer = setTimeout(() => void this.poll(clientId), f.interval * (this.deps.pollScale ?? 1000));
    f.timer.unref?.();
  }

  private async poll(clientId: string): Promise<void> {
    const f = this.flow;
    if (!f || f.state.state !== 'pending') return;
    if (Date.now() > f.state.expiresAt) return void (f.state = { state: 'expired' });
    let j: Record<string, unknown>;
    try {
      j = await this.post(this.url('token'), { client_id: clientId, device_code: f.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    } catch (e) {
      // a network blip: keep polling until the code expires
      if (this.flow === f) this.schedule(clientId);
      return void e;
    }
    if (this.flow !== f) return;
    if (typeof j.access_token === 'string' && j.access_token) {
      try {
        f.state = { state: 'connected', account: await this.connect(j.access_token, typeof j.scope === 'string' ? j.scope : '') };
      } catch (e) {
        f.state = { state: 'error', error: (e as Error).message };
      }
      return;
    }
    if (j.error === 'authorization_pending') return this.schedule(clientId);
    if (j.error === 'slow_down') {
      f.interval = Math.max(f.interval + 5, Number(j.interval) || 0);
      return this.schedule(clientId);
    }
    f.state = j.error === 'expired_token' ? { state: 'expired' } : j.error === 'access_denied' ? { state: 'denied' } : { state: 'error', error: describe(j) };
  }

  /** A fresh device-flow token: who it belongs to, then into the SecretStore. */
  private async connect(token: string, scope: string): Promise<PublicAccount> {
    const res = await (this.deps.fetch ?? fetch)(`${this.url('api')}/user`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'tether' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new AccountError(`GitHub did not accept the new token (HTTP ${res.status})`, 'upstream');
    const u = parseUser(await res.text());
    if (!u) throw new AccountError('GitHub returned something unreadable for your user', 'upstream');
    await this.store.set('github', token);
    const account: PublicAccount = { provider: 'github', ...u, scopes: scope.split(/[,\s]+/).filter(Boolean), via: 'device', connectedAt: Date.now() };
    setAccount(this.home, 'github', account);
    return account;
  }

  private async post(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await (this.deps.fetch ?? fetch)(url, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    try {
      const j = JSON.parse(text) as unknown;
      if (j && typeof j === 'object') return j as Record<string, unknown>;
    } catch {
      /* below */
    }
    throw new AccountError(`GitHub answered HTTP ${res.status} with something unreadable`, 'upstream');
  }
}

/** login, name and avatar from a GitHub user object (as JSON text). */
function parseUser(text: string): { login: string; name?: string; avatarUrl?: string } | undefined {
  try {
    const u = JSON.parse(text) as { login?: unknown; name?: unknown; avatar_url?: unknown };
    if (typeof u.login !== 'string' || !u.login) return undefined;
    return { login: u.login, ...(typeof u.name === 'string' && u.name ? { name: u.name } : {}), ...(typeof u.avatar_url === 'string' ? { avatarUrl: u.avatar_url } : {}) };
  } catch {
    return undefined;
  }
}

const describe = (j: Record<string, unknown>) => String(j.error_description ?? j.error ?? 'no reason given').slice(0, 200);

/**
 * `exec` with the connected account applied to `gh`: a device-flow token rides along as GH_TOKEN; an adopted CLI login
 * (or no account) leaves `gh` exactly as it was. Every other command passes through untouched.
 */
export function ghExec(home: string, base: Exec = defaultExec, store?: SecretStore): Exec {
  return async (cmd, args, cwd, stdin, env) => {
    if (cmd !== 'gh' || accountOf(home, 'github')?.via !== 'device') return base(cmd, args, cwd, stdin, env);
    const token = await (store ?? defaultStore(home)).get('github').catch(() => undefined);
    return base(cmd, args, cwd, stdin, token ? { ...env, GH_TOKEN: token } : env);
  };
}
