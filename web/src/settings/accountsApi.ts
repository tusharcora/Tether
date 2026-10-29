/** What /api/accounts says (public fields only: the server never sends a token). */
export interface PublicAccount {
  provider: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  scopes: string[];
  via: 'gh' | 'device' | 'browser';
  connectedAt: number;
}

export interface ProviderView {
  id: string;
  name: string;
  kind: 'device' | 'pkce' | 'pkce-key' | 'cli';
  available: boolean;
  scopes: string[];
  note?: string;
  account: PublicAccount | null;
  /** GitHub: the `gh` login on this Mac, if any. */
  cli?: { login: string } | null;
  /** GitHub: the device flow is set up (an OAuth App client id), or the one-time setup to do. */
  device?: { ready: true } | { ready: false; setup: string };
  /** OpenRouter: nothing can run a step yet (no account, no healthy agent, no keyed endpoint, no local server). */
  setup?: boolean;
  /** OpenRouter, once connected: the free models the crew and ⌘J are bound to, and whether the default model is gone. */
  defaults?: { crew?: string; assistant?: string; fallback: boolean } | null;
}

/** The OpenRouter approval as the server follows it. */
export type OrFlow = { state: 'idle' } | { state: 'pending'; url: string } | { state: 'connected'; bound: string[] } | { state: 'error'; error: string };

export const ALLOWANCE_PATH = '/api/accounts/openrouter/allowance';
/** The free counter refreshes at most this often while a screen shows it (spec §7.6). */
export const ALLOWANCE_MS = 60_000;
export const MODELS_PATH = '/api/accounts/openrouter/models';
/** `vendor/model:free` → `model:free`, as chips and meta lines show it. */
export const shortModel = (id: string) => id.split('/').pop() ?? id;

export interface AccountsView {
  /** The person's name on this machine (the sidebar shows it until an account says more). */
  user: string;
  providers: ProviderView[];
}

export type DeviceState =
  | { state: 'idle' }
  | { state: 'pending'; userCode: string; verificationUri: string; expiresAt: number }
  | { state: 'connected'; account: PublicAccount }
  | { state: 'expired' }
  | { state: 'denied' }
  | { state: 'error'; error: string };

export const ACCOUNTS_PATH = '/api/accounts';
export const ACCOUNTS_MS = 30_000;

/** The sidebar's account row: the primary (GitHub) account's name and chip, else the local user with "Connect". */
export function accountChip(v: AccountsView | undefined): { name: string; provider?: string } {
  const gh = v?.providers.find((p) => p.id === 'github');
  const a = gh?.account;
  return a ? { name: a.name ?? a.login, provider: gh!.name } : { name: v?.user ?? 'You' };
}
