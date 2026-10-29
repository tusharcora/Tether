/**
 * OpenRouter, the one place Tether gets free models (spec 2026-10-28 free models): the browser approval that hands out a
 * key (PKCE, no client id), the daily free allowance behind a key, what a 429 on a `:free` model means, and the public
 * models list with free / tools / images tags. Pure HTTP helpers; the account, the adapter and the routes use them.
 * A key passed in here is only ever sent to openrouter.ai as a bearer token, never returned or logged.
 */
export const OR_API = 'https://openrouter.ai/api/v1';
/** The free model new crews get (tool calling, images, 1M context). */
export const FREE_DEFAULT = 'nvidia/nemotron-3.5-super-vl:free';
export const CREDITS_URL = 'https://openrouter.ai/settings/credits';
/** OpenRouter's optional app attribution, sent on OpenRouter requests only. */
export const OR_HEADERS = { 'HTTP-Referer': 'https://tether.tusharcs0112.workers.dev', 'X-Title': 'Tether' };

export function isOpenRouter(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'openrouter.ai';
  } catch {
    return false;
  }
}

/** The approval page: OpenRouter sends the browser back to `callbackUrl` with `code` and our `state`. */
export function authUrl(o: { callbackUrl: string; challenge: string; state: string }): string {
  const u = new URL('https://openrouter.ai/auth');
  for (const [k, v] of Object.entries({ callback_url: o.callbackUrl, code_challenge: o.challenge, code_challenge_method: 'S256', key_label: 'Tether', state: o.state })) u.searchParams.set(k, v);
  return u.toString();
}

/** The code from the callback, with its PKCE verifier, for the new key. Failures say the status only (a body could echo secrets). */
export async function exchangeKey(code: string, verifier: string, f: typeof fetch = fetch): Promise<string> {
  const res = await f(`${OR_API}/auth/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as { key?: unknown };
  if (!res.ok || typeof j.key !== 'string' || !j.key) throw new Error(`OpenRouter did not issue a key (HTTP ${res.status})`);
  return j.key;
}

export interface Allowance {
  used: number;
  limit: number;
  remaining: number;
  /** When the free requests come back: OpenRouter's day is the UTC day. */
  resetsAt: number;
}

export const nextUtcMidnight = (now = Date.now()): number => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

/** The key's free requests today (GET /key). */
export async function allowance(key: string, f: typeof fetch = fetch, now = Date.now()): Promise<Allowance> {
  const res = await f(`${OR_API}/key`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`OpenRouter answered HTTP ${res.status}`);
  const d = ((await res.json()) as { data?: { free_model_daily_requests?: { used?: unknown; limit?: unknown; remaining?: unknown } } }).data?.free_model_daily_requests;
  if (!d || typeof d.remaining !== 'number') throw new Error('OpenRouter did not report the free requests');
  return { used: Number(d.used) || 0, limit: Number(d.limit) || 0, remaining: d.remaining, resetsAt: nextUtcMidnight(now) };
}

/** A 429 on a `:free` model: per-minute (wait and retry) or the daily allowance is gone. They look the same, so ask GET /key. */
export async function limitKind(key: string | undefined, f: typeof fetch = fetch): Promise<'minute' | 'daily'> {
  if (!key) return 'minute';
  try {
    return (await allowance(key, f)).remaining > 0 ? 'minute' : 'daily';
  } catch {
    return 'minute'; // unknown: retry; the retry cap turns it into daily
  }
}

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** What a call outside a run step says when the free requests ran out (a step pauses instead). */
export const limitMessage = (resetsAt: number): string => `Out of free requests until ${hhmm(resetsAt)} · Switch model`;

export interface OrModel {
  id: string;
  name: string;
  /** The vendor, from the id (`nvidia/…`). */
  provider: string;
  free: boolean;
  tools: boolean;
  images: boolean;
  context: number;
  /** Dollars per million tokens in and out; absent for free models and routers with a variable price. */
  price?: { in: number; out: number };
}

/** GET /models as the picker shows it: free models first, then paid, each in OpenRouter's order. */
export function tagModels(json: unknown): OrModel[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: OrModel[] = [];
  for (const m of data as { id?: unknown; name?: unknown; context_length?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; supported_parameters?: unknown; architecture?: { input_modalities?: unknown } }[]) {
    if (typeof m?.id !== 'string') continue;
    const free = m.id.endsWith(':free');
    const pin = Number(m.pricing?.prompt);
    const pout = Number(m.pricing?.completion);
    const name = (typeof m.name === 'string' ? m.name : m.id).replace(/^[^:]+:\s*/, '').replace(/\s*\(free\)$/i, '');
    out.push({
      id: m.id,
      name,
      provider: m.id.split('/')[0]!,
      free,
      tools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'),
      images: Array.isArray(m.architecture?.input_modalities) && m.architecture.input_modalities.includes('image'),
      context: Number(m.context_length) || 0,
      ...(!free && pin >= 0 && pout >= 0 ? { price: { in: +(pin * 1e6).toFixed(4), out: +(pout * 1e6).toFixed(4) } } : {}),
    });
  }
  return [...out.filter((m) => m.free), ...out.filter((m) => !m.free)];
}

/** The free model new crews get: the constant while OpenRouter still lists it, else the first free model that calls tools. */
export function freeDefault(models: OrModel[]): { id: string; fallback: boolean } | undefined {
  if (models.some((m) => m.id === FREE_DEFAULT)) return { id: FREE_DEFAULT, fallback: false };
  const alt = models.find((m) => m.free && m.tools);
  return alt ? { id: alt.id, fallback: true } : undefined;
}
