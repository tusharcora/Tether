import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountKey, setAccountKey } from '../src/accounts/keys.js';
import { NvidiaAccount } from '../src/accounts/nvidia.js';
import type { SecretStore } from '../src/accounts/secretStore.js';
import { AdapterRegistry } from '../src/adapters/index.js';
import { OpenAICompatAdapter } from '../src/adapters/openai.js';
import { loadConfig, type Config } from '../src/config.js';
import { NV_LIMIT, NV_SUGGESTED, checkKey, chatModels, verifyKey } from '../src/nvidia.js';
import { PRESETS } from '../src/providers.js';
import type { AgentRequest } from '../src/types.js';
import { startHttpTestServer } from './http-helpers.js';
import { tmp } from './helpers.js';

const KEY = 'nvapi-fakeKey0123456789abcdefABCDEF_-xyz';
const NV = { baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: 'account:nvidia' };
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/nvidia-models.json', import.meta.url), 'utf8'));

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });
const answer = (text: string) => json({ choices: [{ message: { role: 'assistant', content: text } }] });
const memStore = (): SecretStore & { items: Map<string, string> } => {
  const items = new Map<string, string>();
  return { kind: 'file', items, get: async (a) => items.get(a), set: async (a, v) => void items.set(a, v), delete: async (a) => void items.delete(a) };
};
/** A fake NVIDIA: /models is public; a chat answers per the key it is sent (403 for any key but KEY, like the real one). */
function fakeNvidia(o: { down?: boolean; status?: number } = {}) {
  const asked: { url: string; auth: string | null; body?: string }[] = [];
  const f = (async (u: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('authorization');
    asked.push({ url: String(u), auth, ...(init?.body ? { body: String(init.body) } : {}) });
    if (o.down) throw new TypeError('fetch failed');
    if (String(u).endsWith('/models')) return json(FIXTURE);
    if (o.status) return json({ status: o.status }, o.status);
    return auth === `Bearer ${KEY}` ? answer('h') : json({ status: 403, title: 'Forbidden', detail: 'Authorization failed' }, 403);
  }) as unknown as typeof fetch;
  return { f, asked };
}
const cfgOf = (home: string): Config => ({ home, vault: join(home, 'vault'), adapters: {}, endpoints: {} });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NVIDIA helpers', () => {
  it('is a preset with its key in NVIDIA_API_KEY', () => {
    expect(PRESETS.find((p) => p.id === 'nvidia')).toEqual({ id: 'nvidia', label: 'NVIDIA (build.nvidia.com)', baseUrl: 'https://integrate.api.nvidia.com/v1', keyEnv: 'NVIDIA_API_KEY' });
  });

  it('takes a pasted nvapi- key (trimmed) and refuses anything else without echoing it', () => {
    expect(checkKey(`  ${KEY}\n`)).toBe(KEY);
    for (const bad of ['sk-or-v1-abc', 'nvapi-', 'nvapi-has space', '', 'NVAPI-abc']) expect(() => checkKey(bad)).toThrow('that is not an NVIDIA API key: keys from build.nvidia.com start with nvapi-');
  });

  it('lists chat models only, the suggested ones first in their order (those NVIDIA lists)', () => {
    const ids = chatModels(FIXTURE);
    expect(ids.slice(0, 4)).toEqual(['nvidia/nemotron-3.5-super-vl-120b-a12b', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash', 'minimaxai/minimax-m3.1-flash']);
    expect(chatModels({ data: [{ id: 'a/b' }, { id: NV_SUGGESTED[2] }, { id: 'c/embed-d' }] })).toEqual([NV_SUGGESTED[2], 'a/b']);
    const all: string[] = FIXTURE.data.map((m: { id: string }) => m.id);
    expect(all.filter((id) => !ids.includes(id)).sort()).toEqual([
      'google/deplot',
      'meta/llama-guard-4-12b',
      'microsoft/kosmos-2',
      'nvidia/ai-synthetic-video-detector',
      'nvidia/embed-qa-4',
      'nvidia/llama-3.1-nemoguard-8b-content-safety',
      'nvidia/llama-3.1-nemoguard-8b-topic-control',
      'nvidia/llama-3.1-nemotron-safety-guard-8b-v3',
      'nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1',
      'nvidia/llama-3.2-nv-embedqa-1b-v1',
      'nvidia/llama-nemotron-embed-vl-1b-v2',
      'nvidia/nemotron-3-embed-1b',
      'nvidia/nemotron-3.5-content-safety',
      'nvidia/nemotron-3.5-embed-1b',
      'nvidia/nemotron-3.5-embed-8b',
      'nvidia/nemotron-4-340b-reward',
      'nvidia/nemotron-parse',
      'nvidia/nemotron-parse-2.0',
      'nvidia/nv-embedqa-mistral-7b-v2',
      'nvidia/nvclip',
      'snowflake/arctic-embed-l',
    ]);
    for (const id of ['nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-3.5-bolt-e4b', 'minimaxai/minimax-m3.1-flash', 'nvidia/llama-3.1-nemotron-ultra-253b-v1']) expect(ids).toContain(id);
    expect(ids).toHaveLength(all.length - 21);
    expect(chatModels({})).toEqual([]);
  });

  it('checks a key with one 1-token chat: accepted, rate limited (still a good key), rejected, or unknown', async () => {
    const ok = fakeNvidia();
    await verifyKey(KEY, ok.f);
    expect(ok.asked).toHaveLength(1);
    expect(ok.asked[0]).toMatchObject({ url: 'https://integrate.api.nvidia.com/v1/chat/completions', auth: `Bearer ${KEY}` });
    expect(JSON.parse(ok.asked[0]!.body!)).toMatchObject({ max_tokens: 1, messages: [{ role: 'user' }] });
    await expect(verifyKey('nvapi-wrong', ok.f)).rejects.toThrow('NVIDIA rejected the key');
    await verifyKey(KEY, fakeNvidia({ status: 429 }).f);
    await expect(verifyKey(KEY, fakeNvidia({ status: 401 }).f)).rejects.toThrow('NVIDIA rejected the key');
    const e = await verifyKey(KEY, fakeNvidia({ status: 500 }).f).catch((x: Error) => x);
    expect((e as Error).message).toBe('NVIDIA could not check the key (HTTP 500)');
  });
});

describe('the NVIDIA endpoint', () => {
  const req = (o: Partial<AgentRequest> = {}): AgentRequest & { chunks: string[] } => {
    const chunks: string[] = [];
    return { runId: 'r1', nodeId: 'n1', prompt: 'do it', cwd: tmp(), model: NV_SUGGESTED[0]!, readOnly: true, attempt: 1, timeoutMs: 60_000, signal: new AbortController().signal, onChunk: (t) => chunks.push(t), onSession: () => {}, chunks, ...o };
  };
  /** A stubbed global fetch: chat calls take the next scripted reply. */
  function stub(chat: (() => Response)[]) {
    const calls: { url: string; headers: Headers; body?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), ...(init?.body ? { body: String(init.body) } : {}) });
      if (String(url).endsWith('/chat/completions')) return (chat.shift() ?? (() => answer('late')))();
      return json(FIXTURE);
    });
    return calls;
  }
  const limited = () => json({ status: 429, title: 'Too Many Requests' }, 429, { 'x-ratelimit-reset': String(Date.now()) });

  it('sends the connected key (account:nvidia) and no OpenRouter headers', async () => {
    const home = tmp();
    setAccountKey(home, 'nvidia', KEY);
    const calls = stub([() => answer('done')]);
    const r = req();
    const res = await new OpenAICompatAdapter('nvidia', NV, home).run(r);
    expect(res).toMatchObject({ exitCode: 0, output: 'done' });
    expect(calls[0]!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.headers.get('x-title')).toBeNull();
    expect(JSON.stringify(res) + r.chunks.join('')).not.toContain(KEY);
  });

  it('offers chat models only', async () => {
    stub([]);
    const ids = await new OpenAICompatAdapter('nvidia', NV, tmp()).listModels();
    expect(ids).toContain(NV_SUGGESTED[0]!);
    expect(ids.some((id) => /embed|safety/.test(id))).toBe(false);
  });

  it('waits out a 429 and retries, saying so in one line', async () => {
    const home = tmp();
    setAccountKey(home, 'nvidia', KEY);
    stub([limited, () => answer('second try')]);
    const r = req();
    const res = await new OpenAICompatAdapter('nvidia', NV, home).run(r);
    expect(res).toMatchObject({ exitCode: 0, output: 'second try' });
    expect(r.chunks.join('')).toContain('[nvidia] per-minute limit · retried after 0s');
  });

  it('past the retry cap, fails with the free-limit message: no pause, no limit signal', async () => {
    const home = tmp();
    setAccountKey(home, 'nvidia', KEY);
    const calls = stub([limited, limited, limited, limited, limited]);
    const res = await new OpenAICompatAdapter('nvidia', NV, home).run(req());
    expect(res).toMatchObject({ exitCode: 1, error: NV_LIMIT });
    expect(NV_LIMIT).toBe("NVIDIA's free limit (about 40 requests a minute) was hit; try again in a minute");
    expect(res.limit).toBeUndefined();
    expect(calls.filter((c) => c.url.endsWith('/chat/completions'))).toHaveLength(4);
  });

  it('takes a tool-call turn with reasoning_content and no content as a turn, not an empty reply', async () => {
    const home = tmp();
    setAccountKey(home, 'nvidia', KEY);
    const think = () => json({ choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'look first', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_files', arguments: '{}' } }] } }] });
    const calls = stub([think, () => answer('found it')]);
    const res = await new OpenAICompatAdapter('nvidia', NV, home).run(req());
    expect(res).toMatchObject({ exitCode: 0, output: 'found it' });
    const second = JSON.parse(calls.filter((c) => c.url.endsWith('/chat/completions'))[1]!.body!);
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
  });
});

describe('NVIDIA account', () => {
  it('refuses a key that is not nvapi- before asking NVIDIA; a rejected key stores nothing', async () => {
    const home = tmp('home-');
    const store = memStore();
    const nv = fakeNvidia();
    const acct = new NvidiaAccount(cfgOf(home), new AdapterRegistry(), { fetch: nv.f, store });
    await expect(acct.connect('sk-or-v1-abc')).rejects.toThrow(/start with nvapi-/);
    expect(nv.asked).toHaveLength(0);
    await expect(acct.connect('nvapi-wrong')).rejects.toThrow('NVIDIA rejected the key');
    expect(store.items.size).toBe(0);
    expect(acct.account()).toBeUndefined();
    await expect(new NvidiaAccount(cfgOf(home), new AdapterRegistry(), { fetch: fakeNvidia({ down: true }).f, store }).connect(KEY)).rejects.toThrow("can't reach NVIDIA");
  });

  it('stores a verified key in the SecretStore only, points the nvidia endpoint at it, and disconnects', async () => {
    const home = tmp('home-');
    const cfg = loadConfig({ home });
    const store = memStore();
    const registry = new AdapterRegistry();
    let changed = 0;
    const acct = new NvidiaAccount(cfg, registry, { fetch: fakeNvidia().f, store, onChange: () => changed++ });
    expect(await acct.connect(` ${KEY} `)).toMatchObject({ provider: 'nvidia', via: 'key' });
    expect(store.items.get('nvidia')).toBe(KEY);
    expect(await accountKey(home, 'nvidia')).toBe(KEY);
    expect(cfg.endpoints.nvidia).toEqual({ baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: 'account:nvidia' });
    expect(loadConfig({ home }).endpoints.nvidia?.apiKey).toBe('account:nvidia');
    expect(registry.has('nvidia')).toBe(true);
    expect(changed).toBe(1);
    for (const f of ['accounts.json', 'aorch.config.json']) expect(readFileSync(join(home, f), 'utf8')).not.toContain(KEY);

    await acct.disconnect();
    expect(store.items.has('nvidia')).toBe(false);
    expect(acct.account()).toBeUndefined();
    expect(await accountKey(home, 'nvidia')).toBeUndefined();
    expect(changed).toBe(2);
  });

  it('over /api/accounts: lists NVIDIA, serves its chat models (the last list when down), connects, disconnects; never the key', async () => {
    let down = false;
    const nv = fakeNvidia();
    const f = (async (u: string, init?: RequestInit) => {
      if (down) throw new TypeError('fetch failed');
      return nv.f(u, init);
    }) as unknown as typeof fetch;
    const store = memStore();
    const s = await startHttpTestServer({ nvidia: { fetch: f, store } });
    const bodies: string[] = [];
    const call = async (m: string, p: string, b?: unknown) => {
      const r = await s.api(m, p, b);
      bodies.push(r.text);
      return r;
    };
    try {
      const row = (await call('GET', '/api/accounts')).json.providers.find((p: { id: string }) => p.id === 'nvidia');
      expect(row).toMatchObject({ name: 'NVIDIA', kind: 'key', available: true, account: null });
      const models = (await call('GET', '/api/accounts/nvidia/models')).json.models;
      expect(models[0]).toBe(NV_SUGGESTED[0]!);
      expect(models).not.toContain('nvidia/nemotron-3.5-content-safety');

      expect(await call('POST', '/api/accounts/nvidia', { key: 'sk-nope' })).toMatchObject({ status: 400, json: { error: expect.stringMatching(/start with nvapi-/) } });
      expect(await call('POST', '/api/accounts/nvidia', { key: 'nvapi-wrong' })).toMatchObject({ status: 400, json: { error: 'NVIDIA rejected the key' } });
      expect((await call('POST', '/api/accounts/nvidia', {})).status).toBe(400);
      const ok = await call('POST', '/api/accounts/nvidia', { key: KEY });
      expect(ok.json.account).toMatchObject({ provider: 'nvidia', via: 'key' });
      expect(store.items.get('nvidia')).toBe(KEY);
      expect((await call('GET', '/api/accounts')).json.providers.find((p: { id: string }) => p.id === 'nvidia').account).toMatchObject({ via: 'key' });

      down = true;
      expect((await call('GET', '/api/accounts/nvidia/models')).json.models[0]).toBe(NV_SUGGESTED[0]!);
      expect(await call('POST', '/api/accounts/nvidia', { key: KEY })).toMatchObject({ status: 502, json: { error: "can't reach NVIDIA" } });
      expect((await call('DELETE', '/api/accounts/nvidia')).json).toEqual({ ok: true });
      expect(store.items.size).toBe(0);
      for (const b of bodies) expect(b).not.toContain(KEY);
    } finally {
      await s.close();
    }
    const fresh = await startHttpTestServer({ nvidia: { fetch: fakeNvidia({ down: true }).f, store: memStore() } });
    try {
      expect(await fresh.api('GET', '/api/accounts/nvidia/models')).toMatchObject({ status: 502, json: { error: "can't reach NVIDIA" } });
    } finally {
      await fresh.close();
    }
  });
});
