import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatAdapter } from '../src/adapters/openai.js';
import { accountKey, setAccountKey } from '../src/accounts/keys.js';
import type { SecretStore } from '../src/accounts/secretStore.js';
import { limitMessage, nextUtcMidnight } from '../src/openrouter.js';
import type { AgentRequest } from '../src/types.js';
import { tmp } from './helpers.js';

const KEY = 'sk-or-v1-secretkey0123456789';
const OR = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'account:openrouter' };

const req = (o: Partial<AgentRequest> = {}): AgentRequest & { chunks: string[] } => {
  const chunks: string[] = [];
  return { runId: 'r1', nodeId: 'n1', prompt: 'do it', cwd: tmp(), model: 'nvidia/nemotron-3.5-super-vl:free', readOnly: true, attempt: 1, timeoutMs: 60_000, signal: new AbortController().signal, onChunk: (t) => chunks.push(t), onSession: () => {}, chunks, ...o };
};

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });
const answer = (text: string) => json({ choices: [{ message: { role: 'assistant', content: text } }] });
const rateLimited = (headers: Record<string, string> = {}) => json({ error: { code: 429, message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } } }, 429, headers);
const keyInfo = (remaining: number) => json({ data: { free_model_daily_requests: { used: 50 - remaining, limit: 50, remaining } } });

/** A stubbed global fetch: chat calls take the next scripted reply; GET /key answers `remaining`. */
function stub(chat: (() => Response)[], remaining = 5) {
  const calls: { url: string; headers: Headers }[] = [];
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    if (String(url).endsWith('/key')) return keyInfo(remaining);
    if (String(url).endsWith('/chat/completions')) return (chat.shift() ?? (() => answer('late')))();
    return json({ data: [{ id: 'm' }] });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('account: keys', () => {
  it('reads an account key from the secret store once, then from memory', async () => {
    const home = tmp();
    let reads = 0;
    const store: SecretStore = { kind: 'file', get: async () => (reads++, KEY), set: async () => {}, delete: async () => {} };
    expect(await accountKey(home, 'openrouter', store)).toBe(KEY);
    expect(await accountKey(home, 'openrouter', store)).toBe(KEY);
    expect(reads).toBe(1);
    setAccountKey(home, 'openrouter', undefined);
    expect(await accountKey(home, 'openrouter', store)).toBeUndefined();
  });

  it('sends the connected key and the attribution headers to OpenRouter, and the account wins over OPENROUTER_API_KEY', async () => {
    const home = tmp();
    setAccountKey(home, 'openrouter', KEY);
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-fromenv');
    const calls = stub([() => answer('done')]);
    const r = req();
    const res = await new OpenAICompatAdapter('openrouter', OR, home).run(r);
    expect(res).toMatchObject({ exitCode: 0, output: 'done' });
    const chat = calls.find((c) => c.url.endsWith('/chat/completions'))!;
    expect(chat.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(chat.headers.get('http-referer')).toBe('https://tether.tusharcs0112.workers.dev');
    expect(chat.headers.get('x-title')).toBe('Tether');
    expect(JSON.stringify(res) + r.chunks.join('')).not.toContain(KEY);
  });

  it('sends no attribution headers to other endpoints', async () => {
    const calls = stub([() => answer('ok')]);
    await new OpenAICompatAdapter('local', { baseUrl: 'http://127.0.0.1:9/v1' }, tmp()).run(req({ model: 'm' }));
    expect(calls[0]!.headers.get('x-title')).toBeNull();
    expect(calls[0]!.headers.get('authorization')).toBeNull();
  });

  it('reports an account endpoint with no stored key as not connected', async () => {
    const home = tmp();
    setAccountKey(home, 'openrouter', undefined);
    stub([]);
    expect(await new OpenAICompatAdapter('openrouter', OR, home).detect()).toMatchObject({ ok: false, detail: expect.stringMatching(/not connected/) });
  });
});

describe('429 on a free model', () => {
  it('waits out a per-minute limit and retries, saying so in one line', async () => {
    const home = tmp();
    setAccountKey(home, 'openrouter', KEY);
    stub([() => rateLimited({ 'x-ratelimit-reset': String(Date.now()) }), () => answer('second try')], 5);
    const r = req();
    const res = await new OpenAICompatAdapter('openrouter', OR, home).run(r);
    expect(res).toMatchObject({ exitCode: 0, output: 'second try' });
    expect(res.limit).toBeUndefined();
    expect(r.chunks.join('')).toContain('per-minute limit · retried after 0s');
  });

  it('turns the daily limit into a limit signal with the reset time, not a plain failure', async () => {
    const home = tmp();
    setAccountKey(home, 'openrouter', KEY);
    stub([() => rateLimited()], 0);
    const res = await new OpenAICompatAdapter('openrouter', OR, home).run(req());
    const resetsAt = nextUtcMidnight();
    expect(res).toMatchObject({ exitCode: 1, limit: { resetsAt }, error: limitMessage(resetsAt) });
  });

  it('leaves a paid model’s 429 as the plain HTTP error', async () => {
    const home = tmp();
    setAccountKey(home, 'openrouter', KEY);
    stub([() => rateLimited()], 0);
    const res = await new OpenAICompatAdapter('openrouter', OR, home).run(req({ model: 'anthropic/claude-sonnet-4.5' }));
    expect(res.limit).toBeUndefined();
    expect(res.error).toMatch(/^openrouter: HTTP 429/);
  });
});
