import { describe, expect, it } from 'vitest';
import { fetchUsage, spendNano, supportsUsage, usd } from '../src/usage.js';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('usage (Spend API)', () => {
  it('reads whoami then the spend report, with exact money', async () => {
    process.env.T_USAGE_KEY = 'xpl_test';
    const calls: { url: string; auth: string | null; body?: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('authorization'), body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/api/whoami')) return json({ org_id: 'org_1' });
      if (url.endsWith('/spend/analytics')) return json({ id: 'ld1', status: 'loading', report: null });
      return json({ id: 'ld1', status: 'ready', report: { totals: { count: 3, errors: 1, input_tokens: 100, output_tokens: 50, cached_input_tokens: 10, paid_nano_usd: '1234567890', byok_nano_usd: '0', free_nano_usd: '5000000', unknown_usage_count: 1 }, groups: [{ label: 'flash', figures: { count: 3, paid_nano_usd: '1234567890' } }], coverage: { complete: true } } });
    }) as unknown as typeof fetch;
    const cfg = { baseUrl: 'https://api.experientiallabs.ai/v1', usageKey: 'env:T_USAGE_KEY' };
    expect(supportsUsage(cfg)).toBe(true);
    const u = await fetchUsage(cfg, { fetch: f, days: 7, now: new Date('2026-10-21T00:00:00Z') });
    expect(calls[1]!.url).toBe('https://api.experientiallabs.ai/api/orgs/org_1/spend/analytics');
    expect(calls[2]!.url).toBe('https://api.experientiallabs.ai/api/orgs/org_1/spend/analytics/ld1');
    expect(calls[1]!.auth).toBe('Bearer xpl_test');
    expect((calls[1]!.body as { query: { start: string } }).query.start).toBe('2026-10-14T00:00:00Z');
    expect(usd(spendNano(u.totals))).toBe('$1.24');
    expect(u.groups[0]!.name).toBe('flash');
    expect(u.provisional).toBe(true);
  });

  it('explains a 403 and ignores other hosts', async () => {
    process.env.T_USAGE_KEY = 'sk-inference';
    const f = (async () => json({}, 403)) as unknown as typeof fetch;
    await expect(fetchUsage({ baseUrl: 'https://api.experientiallabs.ai/v1', usageKey: 'env:T_USAGE_KEY', orgId: 'o' }, { fetch: f })).rejects.toThrow(/not allowed to read spend|no API key/);
    expect(supportsUsage({ baseUrl: 'https://api.openai.com/v1' })).toBe(false);
    await expect(fetchUsage({ baseUrl: 'https://api.experientiallabs.ai/v1' }, { fetch: f })).rejects.toThrow(/not allowed to read spend|no API key/);
  });
});
