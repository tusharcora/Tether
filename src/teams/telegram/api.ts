/**
 * A small Telegram Bot API client over `fetch` (no dependency). The Bot API takes the token only in the request URL, so
 * that URL never leaves this module: every error is scrubbed of the token, and nothing here logs. A 429 waits out its
 * `retry_after` (a minute at most, twice), then fails like any other error.
 */
import { setTimeout as sleepMs } from 'node:timers/promises';

export const TG_API = 'https://api.telegram.org';
/** The longest 429 wait this client sits through; longer ones are the caller's to back off from. */
const MAX_RETRY_S = 60;
const RETRIES = 2;
const CALL_MS = 30_000;
const FILE_PATH_RE = /^(?!.*\.\.)[\w./-]{1,256}$/;

export class TelegramError extends Error {
  constructor(
    message: string,
    /** Telegram's error_code (0: the request never got an answer). */
    readonly status: number,
    readonly retryAfter?: number,
    readonly migrateTo?: number,
  ) {
    super(message);
  }
}

export interface BotApi {
  /** One Bot API method; resolves to its `result`. `timeoutMs` for long polls. */
  call<T = unknown>(method: string, params?: Record<string, unknown>, o?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T>;
  /** A file from `getFile`'s `file_path`, refused past `maxBytes`. */
  download(filePath: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer>;
}

export function botApi(token: string, o: { fetch?: typeof fetch; base?: string; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {}): BotApi {
  const f = o.fetch ?? fetch;
  const base = o.base ?? TG_API;
  const sleep = o.sleep ?? ((ms: number, signal?: AbortSignal) => sleepMs(ms, undefined, { signal }));
  const scrub = (s: string) => s.split(token).join('<token>');
  const signalOf = (signal: AbortSignal | undefined, ms: number) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

  return {
    async call<T>(method: string, params: Record<string, unknown> = {}, c: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
      for (let tries = 0; ; tries++) {
        let j: { ok?: boolean; result?: unknown; description?: string; error_code?: number; parameters?: { retry_after?: number; migrate_to_chat_id?: number } };
        try {
          const res = await f(`${base}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: signalOf(c.signal, c.timeoutMs ?? CALL_MS) });
          j = (await res.json().catch(() => ({ ok: false, error_code: res.status, description: `HTTP ${res.status}` }))) as typeof j;
        } catch (e) {
          throw new TelegramError(`Telegram: ${scrub((e as Error).message)}`, 0);
        }
        if (j.ok) return j.result as T;
        const wait = j.parameters?.retry_after;
        if (j.error_code === 429 && wait !== undefined && wait <= MAX_RETRY_S && tries < RETRIES) {
          await sleep(wait * 1000, c.signal);
          continue;
        }
        throw new TelegramError(`Telegram: ${scrub(String(j.description ?? 'request failed')).slice(0, 300)}`, j.error_code ?? 0, wait, j.parameters?.migrate_to_chat_id);
      }
    },

    async download(filePath, maxBytes, signal) {
      if (!FILE_PATH_RE.test(filePath)) throw new TelegramError('Telegram: not a file path it gave', 0);
      let res: Response;
      try {
        res = await f(`${base}/file/bot${token}/${filePath}`, { signal: signalOf(signal, CALL_MS) });
      } catch (e) {
        throw new TelegramError(`Telegram: ${scrub((e as Error).message)}`, 0);
      }
      if (!res.ok || !res.body) throw new TelegramError(`Telegram: file download failed (HTTP ${res.status})`, res.status);
      const chunks: Buffer[] = [];
      let n = 0;
      for await (const c of res.body) {
        n += (c as Uint8Array).length;
        if (n > maxBytes) throw new TelegramError(`Telegram: the file is larger than ${Math.round(maxBytes / 1e6)} MB`, 413);
        chunks.push(Buffer.from(c as Uint8Array));
      }
      return Buffer.concat(chunks);
    },
  };
}
