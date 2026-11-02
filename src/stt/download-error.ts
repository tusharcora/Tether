// Ported from deepseek-harness experimental/speech-to-text-sensevoice (MIT, © 2026 DeepSeek): download failure classification.
/** Download failures keep their cause locally and say only a safe, structured reason (never raw messages, URLs or paths). */

export type DownloadReason = 'dns' | 'timeout' | 'certificate' | 'storage' | 'network' | 'http' | 'integrity' | 'unknown';
export interface DownloadFailure {
  resource: string;
  source: string;
  reason: DownloadReason;
  code?: string;
  status?: number;
}

const codes: readonly [DownloadReason, RegExp][] = [
  ['dns', /^(ENOTFOUND|EAI_AGAIN)$/],
  ['timeout', /^(ETIMEDOUT|ERR_SOCKET_CONNECTION_TIMEOUT|UND_ERR_(CONNECT|HEADERS|BODY)_TIMEOUT)$/],
  ['certificate', /^(CERT_[A-Z_]+|ERR_TLS_CERT_ALTNAME_INVALID|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY)$/],
  ['storage', /^(ENOSPC|EDQUOT|EACCES|EPERM|EROFS)$/],
  ['network', /^(ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_SOCKET)$/],
];

/** Walks fetch causes (aggregate connection attempts included) without publishing their messages. */
export function classifyDownloadFailure(failure: unknown): { reason: DownloadReason; code?: string } {
  const pending: unknown[] = [failure];
  const visited = new Set<Error>();
  let reason: DownloadReason = 'unknown';
  while (pending.length > 0) {
    const error = pending.shift();
    if (!(error instanceof Error) || visited.has(error)) continue;
    visited.add(error);
    if (error.name === 'TimeoutError') return { reason: 'timeout' };
    if ('code' in error && typeof error.code === 'string') {
      for (const [kind, pattern] of codes) if (pattern.test(error.code)) return { reason: kind, code: error.code };
    }
    if (error instanceof TypeError && error.message === 'fetch failed') reason = 'network';
    pending.push(error.cause);
    if (error instanceof AggregateError) pending.push(...(error.errors as unknown[]));
  }
  return { reason };
}

/** A preparation error whose message leaves out raw causes, signed URLs and local paths. */
export class SpeechDownloadError extends Error {
  constructor(
    readonly download: DownloadFailure,
    options?: ErrorOptions,
  ) {
    super(`Could not download ${download.resource} from ${download.source}: ${download.reason}${download.code ? ` (${download.code})` : ''}${download.status === undefined ? '' : ` (HTTP ${download.status})`}`, options);
  }
}
