// Ported from deepseek-harness experimental/speech-to-text-sensevoice (MIT, © 2026 DeepSeek): model source ordering.
/** Host-side comparison of Hugging Face-compatible origins for one pinned model file. */

/**
 * The first origin that answers a HEAD for the pinned file goes first; the others stay as download fallbacks. All probes
 * settle before this returns; if every probe fails, the configured order stays.
 */
export async function orderModelSources(assetUrl: string, origins: readonly string[], timeoutMs: number, signal: AbortSignal, f: typeof fetch = fetch): Promise<string[]> {
  signal.throwIfAborted();
  const path = new URL(assetUrl).pathname;
  const urls = [...new Set(origins.map((origin) => new URL(path, origin).href))];
  if (urls.length === 1) return urls;
  const finished = new AbortController();
  const probing = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs), finished.signal]);
  const requests = urls.map(async (url) => ({ url, response: await f(url, { method: 'HEAD', signal: probing }) }));
  let preferred: string | undefined;
  try {
    preferred = await Promise.any(
      requests.map(async (request) => {
        const { url, response } = await request;
        if (!response.ok) throw new Error(`Model source probe returned HTTP ${response.status}`);
        return url;
      }),
    );
  } catch {
    // a download can still work where an origin refuses HEAD or misses the probe deadline
  } finally {
    finished.abort();
    const settled = await Promise.allSettled(requests);
    await Promise.allSettled(settled.map(async (r) => r.status === 'fulfilled' && (await r.value.response.body?.cancel())));
  }
  signal.throwIfAborted();
  return preferred === undefined ? urls : [preferred, ...urls.filter((url) => url !== preferred)];
}
