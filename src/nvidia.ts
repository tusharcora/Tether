/**
 * NVIDIA's hosted models (build.nvidia.com): an OpenAI-compatible API with a free tier of about 40 requests a minute,
 * account-wide, meant for trying things out. Keys are made by hand on NVIDIA's site and pasted once (there is no OAuth).
 * Pure HTTP helpers; the account, the adapter and the routes use them. A key passed in here is only ever sent to NVIDIA
 * as a bearer token, never returned or logged.
 */
export const NV_API = 'https://integrate.api.nvidia.com/v1';
export const KEYS_URL = 'https://build.nvidia.com/settings/api-keys';
/** Pinned first, in this order, when NVIDIA lists them. The first calls tools and reads images (the crew's free default on OpenRouter). */
export const NV_SUGGESTED = ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash', 'minimaxai/minimax-m3.1-flash'];
/** The model the key check asks for one token: small, and NVIDIA's own. */
const PROBE_MODEL = 'nvidia/nemotron-3.5-bolt-e4b';
export const NV_LIMIT = "NVIDIA's free limit (about 40 requests a minute) was hit; try again in a minute";

export function isNvidia(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'integrate.api.nvidia.com';
  } catch {
    return false;
  }
}

/** A key that is wrong (not an NVIDIA key, or refused by NVIDIA): the person's to fix. */
export class KeyRejected extends Error {}

/** A pasted key, trimmed. Anything else is refused, and the message never repeats what was pasted. */
export function checkKey(input: string): string {
  const k = input.trim();
  if (!/^nvapi-\S+$/.test(k)) throw new KeyRejected('that is not an NVIDIA API key: keys from build.nvidia.com start with nvapi-');
  return k;
}

/** Not chat models: embeddings and retrievers, guards and safety classifiers, reward models, parsers, CLIP, detectors, chart and grounding models. */
const NOT_CHAT = /embed|retriev|rerank|guard|safety|topic-control|reward|parse|clip|detector|deplot|kosmos/;

/** GET /models as the pickers show it: chat models only (the list says nothing else about them), the suggested ones first. */
export function chatModels(json: unknown): string[] {
  const data = (json as { data?: unknown })?.data;
  const ids = (Array.isArray(data) ? data : []).map((m: { id?: unknown }) => m?.id).filter((id): id is string => typeof id === 'string' && !NOT_CHAT.test(id));
  return [...NV_SUGGESTED.filter((id) => ids.includes(id)), ...ids.filter((id) => !NV_SUGGESTED.includes(id))];
}

/** NVIDIA's model list answers any key, so one 1-token chat is the check. Failures say the status only. */
export async function verifyKey(key: string, f: typeof fetch = fetch): Promise<void> {
  const res = await f(`${NV_API}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: PROBE_MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    signal: AbortSignal.timeout(20_000),
  });
  // a 429 is the account's per-minute limit: the key itself got through
  if (res.ok || res.status === 429) return;
  if (res.status === 401 || res.status === 403) throw new KeyRejected('NVIDIA rejected the key');
  // shortcut: a 404 means PROBE_MODEL left NVIDIA (unknown models answer 404 before the key is looked at); pick another small chat model then
  throw new Error(`NVIDIA could not check the key (HTTP ${res.status})`);
}
