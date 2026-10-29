/**
 * Who is connected (<home>/accounts.json): login, name, avatar, scopes, how and when. Never a token: tokens live in the
 * SecretStore, or stay with `gh` for an adopted CLI login. The GitHub OAuth App client id the device flow needs is kept
 * here too (TETHER_GITHUB_CLIENT_ID wins).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderId } from './registry.js';

/** What the API, the sidebar and Settings see of an account. */
export interface PublicAccount {
  provider: ProviderId;
  login: string;
  name?: string;
  avatarUrl?: string;
  scopes: string[];
  /** `gh`: Tether adopted the GitHub CLI's login and asks `gh auth token` when it needs one. `device`: signed in here. `browser`: approved in the browser (OpenRouter's key). `key`: an API key pasted once (NVIDIA's). */
  via: 'gh' | 'device' | 'browser' | 'key';
  connectedAt: number;
}

interface AccountsFile {
  accounts: Partial<Record<ProviderId, PublicAccount>>;
  githubClientId?: string;
}

const file = (home: string) => join(home, 'accounts.json');
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{4,100}$/;

function load(home: string): AccountsFile {
  try {
    const j = JSON.parse(readFileSync(file(home), 'utf8')) as Partial<AccountsFile>;
    return { accounts: j.accounts && typeof j.accounts === 'object' ? j.accounts : {}, ...(typeof j.githubClientId === 'string' && CLIENT_ID_RE.test(j.githubClientId) ? { githubClientId: j.githubClientId } : {}) };
  } catch {
    return { accounts: {} };
  }
}

function save(home: string, f: AccountsFile): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(`${file(home)}.tmp`, JSON.stringify(f, null, 2) + '\n');
  renameSync(`${file(home)}.tmp`, file(home));
}

/** Only the public fields, whatever the file holds. */
const clean = (a: PublicAccount): PublicAccount => ({
  provider: a.provider,
  login: String(a.login),
  ...(typeof a.name === 'string' && a.name ? { name: a.name } : {}),
  ...(typeof a.avatarUrl === 'string' && /^https:\/\//.test(a.avatarUrl) ? { avatarUrl: a.avatarUrl } : {}),
  scopes: Array.isArray(a.scopes) ? a.scopes.filter((s): s is string => typeof s === 'string') : [],
  via: a.via === 'device' || a.via === 'browser' || a.via === 'key' ? a.via : 'gh',
  connectedAt: Number(a.connectedAt) || 0,
});

export function accountOf(home: string, provider: ProviderId): PublicAccount | undefined {
  const a = load(home).accounts[provider];
  return a && typeof a.login === 'string' ? clean({ ...a, provider }) : undefined;
}

export function setAccount(home: string, provider: ProviderId, a: PublicAccount | undefined): void {
  const f = load(home);
  if (a) f.accounts[provider] = clean(a);
  else delete f.accounts[provider];
  save(home, f);
}

/** The device flow's OAuth App client id: the environment's, else the saved one. */
export const githubClientId = (home: string): string | undefined => process.env.TETHER_GITHUB_CLIENT_ID?.trim() || load(home).githubClientId;

export function setGithubClientId(home: string, id: string | undefined): void {
  if (id !== undefined && !CLIENT_ID_RE.test(id)) throw new Error('a GitHub OAuth App client id is 4–100 letters, digits, dots, dashes or underscores');
  const f = load(home);
  if (id) f.githubClientId = id;
  else delete f.githubClientId;
  save(home, f);
}
