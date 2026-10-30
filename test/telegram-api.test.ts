import { describe, expect, it } from 'vitest';
import { botApi, TelegramError } from '../src/teams/telegram/api.js';

const TOKEN = '123456:AAFakeTokenFakeTokenFakeToken_123';
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

/** A scripted Bot API: each call takes the next answer; every request is recorded. */
function fake(answers: (Response | Error)[]) {
  const seen: { url: string; body?: unknown }[] = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const a = answers.shift() ?? json({ ok: true, result: true });
    if (a instanceof Error) throw a;
    return a;
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}
const noSleep = async () => {};

describe('the Bot API client', () => {
  it('posts JSON to the method and returns its result', async () => {
    const f = fake([json({ ok: true, result: { id: 7, username: 'tether_bot' } })]);
    const api = botApi(TOKEN, { fetch: f.fetch });
    expect(await api.call('getMe')).toEqual({ id: 7, username: 'tether_bot' });
    await api.call('sendMessage', { chat_id: -100, text: 'hi' });
    expect(f.seen[1]).toEqual({ url: `https://api.telegram.org/bot${TOKEN}/sendMessage`, body: { chat_id: -100, text: 'hi' } });
  });

  it('waits out a 429 for its retry_after, then tries again', async () => {
    const waits: number[] = [];
    const f = fake([json({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 3', parameters: { retry_after: 3 } }, 429), json({ ok: true, result: 1 })]);
    const api = botApi(TOKEN, { fetch: f.fetch, sleep: async (ms) => void waits.push(ms) });
    expect(await api.call('editMessageText', { chat_id: 1, message_id: 2, text: 'x' })).toBe(1);
    expect(waits).toEqual([3000]);
    expect(f.seen).toHaveLength(2);
  });

  it('gives up on a long or repeated 429, and errors never carry the token', async () => {
    const long = botApi(TOKEN, { fetch: fake([json({ ok: false, error_code: 429, description: 'slow down', parameters: { retry_after: 3600 } }, 429)]).fetch, sleep: noSleep });
    await expect(long.call('sendMessage')).rejects.toMatchObject({ status: 429, retryAfter: 3600 });
    const net = botApi(TOKEN, { fetch: fake([new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/getMe`)]).fetch });
    const e = (await net.call('getMe').catch((x: unknown) => x)) as TelegramError;
    expect(e).toBeInstanceOf(TelegramError);
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).toContain('bot<token>');
    const bad = botApi(TOKEN, { fetch: fake([json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401)]).fetch });
    await expect(bad.call('getMe')).rejects.toMatchObject({ status: 401, message: 'Telegram: Unauthorized' });
  });

  it('downloads a file within a byte cap, and refuses a path that is not Telegram’s', async () => {
    const f = fake([new Response(Buffer.from('OggS-voice')), new Response(Buffer.alloc(100))]);
    const api = botApi(TOKEN, { fetch: f.fetch });
    expect((await api.download('voice/file_1.oga', 50)).toString()).toBe('OggS-voice');
    expect(f.seen[0]!.url).toBe(`https://api.telegram.org/file/bot${TOKEN}/voice/file_1.oga`);
    await expect(api.download('photos/a.jpg', 50)).rejects.toThrow(/larger than/);
    await expect(api.download('../secrets', 50)).rejects.toThrow(/file path/);
  });
});

describe('Settings → Accounts → Telegram over the API', () => {
  it('connects with a token (never echoed), shows the bot, hands out /iam and /pair codes, disconnects', async () => {
    const { startHttpTestServer } = await import('./http-helpers.js');
    const items = new Map<string, string>();
    const secrets = { kind: 'file' as const, get: async (a: string) => items.get(a), set: async (a: string, v: string) => void items.set(a, v), delete: async (a: string) => void items.delete(a) };
    const calls: string[] = [];
    const api = {
      call: async (method: string, _p?: unknown, o?: { signal?: AbortSignal }) => {
        calls.push(method);
        if (method === 'getMe') return { id: 999, username: 'tether_bot', first_name: 'Tether', can_read_all_group_messages: false };
        if (method === 'getUpdates') return new Promise((_, rej) => o?.signal?.addEventListener('abort', () => rej(new Error('stopped'))));
        return true;
      },
      download: async () => Buffer.alloc(0),
    } as unknown as import('../src/teams/telegram/api.js').BotApi;
    const t = await startHttpTestServer({ telegram: { api: () => api, secrets } });
    try {
      expect((await t.api('GET', '/api/telegram')).json).toMatchObject({ connected: false, polling: false, voice: { model: expect.any(Object), engine: expect.any(Boolean) } });
      expect((await t.api('POST', '/api/telegram/iam')).status).toBe(409);
      expect((await t.api('POST', '/api/accounts/telegram', { token: 'nope' })).status).toBe(400);
      const c = await t.api('POST', '/api/accounts/telegram', { token: TOKEN });
      expect(c.json.account).toMatchObject({ provider: 'telegram', login: 'tether_bot', via: 'key' });
      const list = await t.api('GET', '/api/accounts');
      expect(list.json.providers.find((p: { id: string }) => p.id === 'telegram')).toMatchObject({ kind: 'key', available: true, account: { login: 'tether_bot' } });
      const view = await t.api('GET', '/api/telegram');
      expect(view.json).toMatchObject({ connected: true, bot: { username: 'tether_bot', readsAll: false } });
      const iam = (await t.api('POST', '/api/telegram/iam')).json;
      expect(iam).toMatchObject({ code: expect.stringMatching(/^[A-Z2-9]{6}$/), bot: 'tether_bot' });
      const team = (await t.api('POST', '/api/teams', { name: 'Ops', place: 'telegram', project: 'api', agents: ['coder'] })).json;
      expect((await t.api('POST', `/api/teams/${team.id}/pair`)).json).toMatchObject({ code: expect.any(String), bot: 'tether_bot' });
      for (const r of [c, list, view]) expect(r.text).not.toContain(TOKEN);
      expect(calls).toContain('setMyCommands');
      expect((await t.api('DELETE', '/api/accounts/telegram')).status).toBe(200);
      expect(items.has('telegram')).toBe(false);
      expect((await t.api('GET', '/api/telegram')).json).toMatchObject({ connected: false });
    } finally {
      await t.close();
    }
  });
});
