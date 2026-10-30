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
