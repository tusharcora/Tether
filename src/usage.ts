/** Spend and token usage from a provider that has a Spend API (Experiential Labs). Read-only. Uses the provider's own API key; `usageKey` is only an optional override. */
import type { EndpointConfig } from './adapters/openai.js';

export interface UsageRow {
  name: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** nano-USD (1 USD = 1e9) as a string: kept exact, shown rounded. */
  paid: bigint;
  byok: bigint;
  free: bigint;
}

export interface Usage {
  days: number;
  totals: UsageRow;
  groups: UsageRow[];
  /** Some usage had unknown provider accounting, so money figures are provisional. */
  provisional: boolean;
  /** The report was still being assembled when it was read. */
  complete: boolean;
}

type Fetch = typeof fetch;

export const supportsUsage = (cfg: EndpointConfig): boolean => {
  try {
    return /(^|\.)experientiallabs\.ai$/.test(new URL(cfg.baseUrl).hostname);
  } catch {
    return false;
  }
};

const origin = (cfg: EndpointConfig) => new URL(cfg.baseUrl).origin;

function keyOf(cfg: EndpointConfig): string {
  const ref = cfg.usageKey ?? cfg.apiKey;
  const key = ref?.startsWith('env:') ? process.env[ref.slice(4)] : ref;
  if (!key) throw new Error(cfg.usageKey ? `set ${cfg.usageKey.slice(4)} (the usage key you configured)` : 'no API key: set the key variable this provider was added with');
  return key;
}

const big = (v: unknown): bigint => {
  try {
    return typeof v === 'string' || typeof v === 'number' ? BigInt(v) : 0n;
  } catch {
    return 0n;
  }
};
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const toRow = (name: string, f: Record<string, unknown>): UsageRow => ({
  name,
  requests: num(f.count),
  errors: num(f.errors),
  inputTokens: num(f.input_tokens),
  outputTokens: num(f.output_tokens),
  cachedTokens: num(f.cached_input_tokens),
  paid: big(f.paid_nano_usd),
  byok: big(f.byok_nano_usd),
  free: big(f.free_nano_usd),
});

/** All-in spend: the API has no single field for it, so it is paid + BYOK + free. */
export const spendNano = (r: UsageRow): bigint => r.paid + r.byok + r.free;
export const usd = (nano: bigint): string => {
  const cents = (nano + 5_000_000n) / 10_000_000n; // round to the cent
  return `$${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
};

async function call(f: Fetch, url: string, key: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await f(url, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(70_000) });
  if (res.status === 401) throw new Error('the usage key was rejected (401)');
  if (res.status === 403) throw new Error('403: this key is not allowed to read spend. Check the key has spend access for this organisation');
  if (res.status === 404) throw new Error(`404 at ${new URL(url).pathname}: wrong organisation id, or the key belongs to another organisation`);
  if (res.status === 429) throw new Error('rate limited by the Spend API; try again in a minute');
  if (res.status === 503) throw new Error('the Spend API is warming up (503); try again shortly. This is not zero usage');
  if (!res.ok) {
    let why = '';
    try {
      const j = (await res.json()) as { detail?: unknown; error?: unknown; error_code?: unknown };
      const d = j.detail ?? j.error ?? j.error_code;
      why = typeof d === 'string' ? d : d ? JSON.stringify(d).slice(0, 300) : '';
    } catch {
      /* no body */
    }
    throw new Error(`HTTP ${res.status} from ${new URL(url).pathname}${why ? ': ' + why : ''}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** The org id: configured, or read from /api/whoami. */
export async function orgIdOf(cfg: EndpointConfig, f: Fetch = fetch): Promise<string> {
  if (cfg.orgId) return cfg.orgId;
  const j = await call(f, `${origin(cfg)}/api/whoami`, keyOf(cfg));
  const org = (j.org ?? j.organization ?? (Array.isArray(j.orgs) ? j.orgs[0] : undefined)) as Record<string, unknown> | undefined;
  const id = j.org_id ?? org?.id ?? org?.org_id ?? (Array.isArray(j.org_ids) ? j.org_ids[0] : undefined);
  if (typeof id !== 'string' || !id) throw new Error('could not find your organisation id in /api/whoami. Set it: aorch providers org-id <name> <id>');
  return id;
}

export async function fetchUsage(cfg: EndpointConfig, o: { days?: number; groupBy?: string; now?: Date; fetch?: Fetch } = {}): Promise<Usage> {
  const f = o.fetch ?? fetch;
  const days = Math.max(1, Math.min(90, Math.trunc(o.days ?? 7)));
  const key = keyOf(cfg);
  const org = await orgIdOf(cfg, f);
  const end = o.now ?? new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const query = { start: start.toISOString().replace(/\.\d+Z$/, 'Z'), end: end.toISOString().replace(/\.\d+Z$/, 'Z'), time_zone: 'UTC', scope: 'org', basis: 'requests', group_by: o.groupBy ?? 'model', grain: 'day', filters: [], tags: [], sort: 'spend', direction: 'desc', offset: 0, limit: 50 };
  const base = `${origin(cfg)}/api/orgs/${encodeURIComponent(org)}/spend`;
  // The documented flow for an unpinned query: start a load, then poll it until it is ready.
  let env = await call(f, `${base}/analytics`, key, { query, refresh: false });
  const until = Date.now() + 70_000;
  while (env.status === 'loading' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, o.fetch ? 0 : 1500));
    env = await call(f, `${base}/analytics/${encodeURIComponent(String(env.id))}`, key);
  }
  if (env.status === 'failed') throw new Error(`the Spend API could not build the report (${String(env.error_code ?? 'failed')})`);
  if (env.status !== 'ready' || !env.report) throw new Error('the report is still loading; try again in a moment');
  const rep = env.report as Record<string, unknown>;
  const totals = (rep.totals ?? {}) as Record<string, unknown>;
  const groups = (Array.isArray(rep.groups) ? rep.groups : []) as Record<string, unknown>[];
  const cov = (rep.coverage ?? {}) as Record<string, unknown>;
  const label = (g: Record<string, unknown>) => String(g.label ?? g.name ?? g.key ?? (typeof g.group === 'object' && g.group ? (g.group as Record<string, unknown>).label ?? (g.group as Record<string, unknown>).id : g.group) ?? 'unknown');
  return {
    days,
    totals: toRow('total', totals),
    groups: groups.map((g) => toRow(label(g), (g.figures as Record<string, unknown>) ?? g)),
    provisional: num(totals.unknown_usage_count) > 0,
    complete: cov.complete !== false,
  };
}
