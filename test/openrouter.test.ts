import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDITS_URL, FREE_DEFAULT, allowance, authUrl, exchangeKey, freeDefault, isOpenRouter, limitKind, limitMessage, nextUtcMidnight, tagModels } from '../src/openrouter.js';

const MODELS = JSON.parse(readFileSync(new URL('./fixtures/openrouter-models.json', import.meta.url), 'utf8')) as { data: { id: string }[] };

/** A fetch that answers once with `body` (JSON) and `status`, recording what it was asked. */
function once(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}

const keyBody = (remaining: number, limit = 50) => ({ data: { label: 'Tether', is_free_tier: true, limit: 0, free_model_daily_requests: { used: limit - remaining, limit, remaining } } });

describe('openrouter auth', () => {
  it('builds the authorize URL with S256, the Tether key label and the state', () => {
    const u = new URL(authUrl({ callbackUrl: 'http://localhost:51423/oauth/callback', challenge: 'chal', state: 'st8' }));
    expect(u.origin + u.pathname).toBe('https://openrouter.ai/auth');
    expect(Object.fromEntries(u.searchParams)).toEqual({ callback_url: 'http://localhost:51423/oauth/callback', code_challenge: 'chal', code_challenge_method: 'S256', key_label: 'Tether', state: 'st8' });
  });

  it('exchanges the code and verifier for a key as JSON', async () => {
    const { f, calls } = once({ key: 'sk-or-v1-abc' });
    expect(await exchangeKey('the-code', 'the-verifier', f)).toBe('sk-or-v1-abc');
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ code: 'the-code', code_verifier: 'the-verifier', code_challenge_method: 'S256' });
  });

  it('says only the HTTP status when the exchange is refused', async () => {
    const { f } = once({ error: { message: 'invalid code sk-or-v1-leak' } }, 400);
    await expect(exchangeKey('c', 'v', f)).rejects.toThrow(/HTTP 400/);
    await expect(exchangeKey('c', 'v', f)).rejects.not.toThrow(/leak/);
  });

  it('knows an OpenRouter base URL', () => {
    expect(isOpenRouter('https://openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouter('https://api.openai.com/v1')).toBe(false);
    expect(isOpenRouter('not a url')).toBe(false);
  });
});

describe('free allowance', () => {
  it('resets at the next UTC midnight', () => {
    expect(nextUtcMidnight(Date.UTC(2026, 9, 28, 23, 59))).toBe(Date.UTC(2026, 9, 29));
    expect(nextUtcMidnight(Date.UTC(2026, 9, 29))).toBe(Date.UTC(2026, 9, 30));
  });

  it('reads the daily free requests from GET /key with the key as a bearer', async () => {
    const now = Date.UTC(2026, 9, 28, 12);
    const { f, calls } = once(keyBody(32));
    expect(await allowance('sk-or-v1-abc', f, now)).toEqual({ used: 18, limit: 50, remaining: 32, resetsAt: Date.UTC(2026, 9, 29) });
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/key');
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer sk-or-v1-abc');
  });

  it('classifies a 429: requests left is per-minute, none left is daily, unknown is per-minute', async () => {
    expect(await limitKind('k', once(keyBody(5)).f)).toBe('minute');
    expect(await limitKind('k', once(keyBody(0)).f)).toBe('daily');
    expect(await limitKind('k', once({}, 500).f)).toBe('minute');
    expect(await limitKind(undefined, once(keyBody(0)).f)).toBe('minute');
  });

  it('says when the free requests come back, in local time', () => {
    const at = new Date(2026, 9, 28, 20, 5).getTime();
    expect(limitMessage(at)).toBe('Out of free requests until 20:05 · Switch model');
  });
});

describe('models list', () => {
  const models = tagModels(MODELS);

  it('tags free, tools, images and context from /models, free first', () => {
    expect(models.map((m) => m.id)).toEqual(['nvidia/nemotron-3.5-content-safety:free', 'recursive/flint-v1.0:free', 'nvidia/nemotron-3.5-super-vl:free', 'anthropic/claude-sonnet-4.5', 'openrouter/auto']);
    expect(models.find((m) => m.id === FREE_DEFAULT)).toEqual({ id: FREE_DEFAULT, name: 'Nemotron 3.5 Super VL', provider: 'nvidia', free: true, tools: true, images: true, context: 1_000_000 });
    expect(models.find((m) => m.id === 'nvidia/nemotron-3.5-content-safety:free')).toMatchObject({ free: true, tools: false });
    expect(models.find((m) => m.id === 'recursive/flint-v1.0:free')).toMatchObject({ free: true, tools: true, images: false });
  });

  it('prices paid models per million tokens, and none for a router with a variable price', () => {
    expect(models.find((m) => m.id === 'anthropic/claude-sonnet-4.5')).toMatchObject({ free: false, name: 'Claude Sonnet 4.5', provider: 'anthropic', price: { in: 3, out: 15 } });
    expect(models.find((m) => m.id === 'openrouter/auto')!.price).toBeUndefined();
    expect(tagModels({ nope: true })).toEqual([]);
  });

  it('defaults to the constant, else the first free model that can call tools', () => {
    expect(freeDefault(models)).toEqual({ id: FREE_DEFAULT, fallback: false });
    expect(freeDefault(models.filter((m) => m.id !== FREE_DEFAULT))).toEqual({ id: 'recursive/flint-v1.0:free', fallback: true });
    expect(freeDefault([])).toBeUndefined();
    expect(CREDITS_URL).toMatch(/^https:\/\/openrouter\.ai\//);
  });
});
