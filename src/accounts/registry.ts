/**
 * The providers Settings → Accounts lists (spec §3). OpenRouter is built: one browser approval hands Tether a key for
 * free models (accounts/openrouter.ts). GitHub is built: the `gh` login or the device flow. Google is listed
 * with the generic PKCE loopback flow ready (pkce.ts), but stays "coming" until a Tether feature uses it. Adding GitLab,
 * Linear or Slack later is an entry here plus the feature that needs it.
 */
export type ProviderId = 'openrouter' | 'github' | 'google';

export interface ProviderDef {
  id: ProviderId;
  name: string;
  /** How a connection is made: OAuth device flow, PKCE in the system browser (an OAuth token, or `pkce-key`: an API key), or an installed CLI's own login. */
  kind: 'device' | 'pkce' | 'pkce-key' | 'cli';
  endpoints: { device?: string; verify?: string; authorize?: string; token: string; api?: string };
  scopes: string[];
  /** Can be connected now. False: listed only, with `note` saying why. */
  available: boolean;
  note?: string;
  /** A CLI whose login can be adopted instead (GitHub: `gh`). */
  cli?: 'gh';
}

export const PROVIDERS: readonly ProviderDef[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'pkce-key',
    endpoints: { authorize: 'https://openrouter.ai/auth', token: 'https://openrouter.ai/api/v1/auth/keys', api: 'https://openrouter.ai/api/v1' },
    scopes: [],
    available: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    kind: 'device',
    cli: 'gh',
    endpoints: { device: 'https://github.com/login/device/code', verify: 'https://github.com/login/device', token: 'https://github.com/login/oauth/access_token', api: 'https://api.github.com' },
    // webhooks for PR triggers need admin:repo_hook
    scopes: ['repo', 'read:user', 'admin:repo_hook'],
    available: true,
  },
  {
    id: 'google',
    name: 'Google',
    kind: 'pkce',
    endpoints: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token' },
    scopes: ['openid', 'email', 'profile'],
    available: false,
    note: 'Coming when a feature needs it: nothing in Tether uses Google yet, so a connection would store a token no feature reads.',
  },
];

export const providerOf = (id: string): ProviderDef | undefined => PROVIDERS.find((p) => p.id === id);
