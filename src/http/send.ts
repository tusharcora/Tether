/**
 * Send one resolved request with node's fetch. Redirects are followed here (max 5) so credentials can be dropped when
 * the origin changes; the whole exchange has one timeout; the body is cut at 5 MB. Network trouble never throws: it is
 * status 0 with an error kind. fetch exposes no DNS/connect timings, so only ttfb and download are reported.
 */
import type { NetErrorKind, ResolvedRequest, SendResult } from './types.js';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** Never forwarded to a different origin on a redirect: a token should reach only the host it was saved for. */
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key']);

export interface SendOptions {
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  /** Header names whose value used a secret: dropped on a cross-origin redirect like the credential headers. */
  secretHeaders?: string[];
}

export function netErrorKind(e: unknown): NetErrorKind {
  const err = e as { name?: string; code?: string; cause?: { code?: string; name?: string } } | undefined;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.cause?.name === 'TimeoutError') return 'timeout';
  const code = err?.cause?.code ?? err?.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NONAME') return 'dns';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET' || code === 'UND_ERR_CLOSED') return 'reset';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') return 'timeout';
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return 'tls';
  return 'other';
}

async function readCapped(res: Response, max: number): Promise<{ text: string; size: number; truncated: boolean }> {
  if (!res.body) return { text: '', size: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > max) {
      chunks.push(value.subarray(0, max - size));
      size = max;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), size, truncated };
}

export async function send(req: ResolvedRequest, o: SendOptions = {}): Promise<SendResult> {
  const timeoutMs = Math.min(Math.max(1, Math.trunc(o.timeoutMs ?? DEFAULT_TIMEOUT_MS)), MAX_TIMEOUT_MS);
  const maxBytes = o.maxBytes ?? MAX_RESPONSE_BYTES;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
  const t0 = performance.now();
  const since = () => Math.round(performance.now() - t0);
  const redirects: string[] = [];
  let url = req.url;
  let method: string = req.method;
  let body = req.body;
  let headers = req.headers;
  const dropped = new Set([...CREDENTIAL_HEADERS, ...(o.secretHeaders ?? []).map((k) => k.toLowerCase())]);
  const failed = (kind: NetErrorKind, message: string): SendResult => ({ status: 0, statusText: '', url, headers: [], body: '', size: 0, truncated: false, ms: since(), timing: { ttfb: since(), download: 0 }, redirects, error: { kind, message } });
  try {
    for (;;) {
      const res = await fetch(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body, redirect: 'manual', signal });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && res.status !== 304 && loc) {
        await res.body?.cancel();
        if (redirects.length >= MAX_REDIRECTS) return failed('other', `more than ${MAX_REDIRECTS} redirects`);
        const next = new URL(loc, url);
        if (next.origin !== new URL(url).origin) headers = headers.filter(([k]) => !dropped.has(k.toLowerCase()));
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
          method = 'GET';
          body = undefined;
          headers = headers.filter(([k]) => k.toLowerCase() !== 'content-type');
        }
        redirects.push(next.href);
        url = next.href;
        continue;
      }
      const ttfb = since();
      const { text, size, truncated } = await readCapped(res, maxBytes);
      const ms = since();
      return { status: res.status, statusText: res.statusText, url, headers: [...res.headers.entries()], body: text, size, truncated, ms, timing: { ttfb, download: ms - ttfb }, redirects };
    }
  } catch (e) {
    if (o.signal?.aborted && !timeout.aborted) return failed('other', 'cancelled');
    const kind = timeout.aborted ? 'timeout' : netErrorKind(e);
    const cause = (e as { cause?: { message?: string } }).cause?.message;
    return failed(kind, kind === 'timeout' ? `no response within ${timeoutMs} ms` : String(cause ?? (e as Error).message));
  }
}
