/**
 * Fill in {{name}} variables. Lookup order, first hit wins: the request's own vars, each collection from the innermost
 * folder out to the root, the environment (whose value may be a secret ref), then the secrets store by key. Secrets are
 * only resolved when the caller allows it (the UI, a gate, `aorch http run <id>`).
 */
import { HttpClientError } from './errors.js';
import { isObj, type CollectionFile, type Environment, type HttpRequestFile, type KV, type ResolvedRequest, type VarInfo, type VarSource } from './types.js';

export interface ResolveContext {
  /** Collection files that apply, innermost first. */
  collections: { path: string; file: CollectionFile }[];
  env?: { name: string; file: Environment };
  secrets: Record<string, string>;
  allowSecrets: boolean;
}

export const VAR_IN_TEXT = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*\}\}/g;
const MAX_NEST = 5;

interface Hit {
  source: VarSource;
  value: string;
  secret?: string;
}

function lookup(req: Pick<HttpRequestFile, 'vars'>, ctx: Omit<ResolveContext, 'allowSecrets'>, name: string): Hit | undefined {
  if (Object.hasOwn(req.vars, name)) return { source: { from: 'request' }, value: req.vars[name]! };
  for (const c of ctx.collections) if (Object.hasOwn(c.file.vars, name)) return { source: { from: 'collection', path: c.path }, value: c.file.vars[name]! };
  const ev = ctx.env && Object.hasOwn(ctx.env.file.vars, name) ? ctx.env.file.vars[name] : undefined;
  if (ev !== undefined) {
    if (typeof ev === 'string') return { source: { from: 'env', env: ctx.env!.name }, value: ev };
    const s = ctx.secrets[ev.secret];
    return s === undefined ? undefined : { source: { from: 'secret', key: ev.secret }, value: s, secret: ev.secret };
  }
  if (Object.hasOwn(ctx.secrets, name)) return { source: { from: 'secret', key: name }, value: ctx.secrets[name]!, secret: name };
  return undefined;
}

export function resolveRequest(req: HttpRequestFile, ctx: ResolveContext): { request: ResolvedRequest; secretsUsed: Map<string, string> } {
  const missing = new Set<string>();
  const used = new Map<string, string>();
  const expand = (text: string, depth = 0): string =>
    text.replace(VAR_IN_TEXT, (whole, name: string) => {
      const hit = lookup(req, ctx, name);
      if (!hit) {
        missing.add(name);
        return whole;
      }
      if (hit.secret !== undefined) {
        if (!ctx.allowSecrets) throw new HttpClientError('secret_adhoc', 'secret not available for ad-hoc requests');
        used.set(hit.secret, hit.value);
        return hit.value; // a secret is taken literally, never expanded further
      }
      if (depth >= MAX_NEST) throw new HttpClientError('invalid', `variables nest too deep at "${name}"`);
      return expand(hit.value, depth + 1);
    });
  const on = (kv: KV[]) => kv.filter((x) => x.on);

  // headers: the root collection first, inner collections override it, the request overrides all (names compared case-insensitively)
  const merged = new Map<string, [string, string]>();
  for (const c of [...ctx.collections].reverse()) for (const h of on(c.file.headers)) merged.set(h.key.toLowerCase(), [h.key, h.value]);
  for (const h of on(req.headers)) merged.set(h.key.toLowerCase(), [h.key, h.value]);
  const headers: [string, string][] = [...merged.values()].map(([k, v]) => [expand(k), expand(v)]);
  const has = (name: string) => headers.some(([k]) => k.toLowerCase() === name);

  let url = expand(req.url);
  const q = on(req.query).map((x) => [expand(x.key), expand(x.value)] as const);
  if (q.length) url += (url.includes('?') ? '&' : '?') + q.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  let body: string | undefined;
  const walk = (v: unknown): unknown =>
    typeof v === 'string' ? expand(v) : Array.isArray(v) ? v.map(walk) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [expand(k), walk(x)])) : v;
  switch (req.body.kind) {
    case 'json':
      body = JSON.stringify(walk(req.body.value));
      if (!has('content-type')) headers.push(['Content-Type', 'application/json']);
      break;
    case 'text':
      body = expand(req.body.value);
      if (!has('content-type')) headers.push(['Content-Type', req.body.contentType ?? 'text/plain; charset=utf-8']);
      break;
    case 'form':
      body = on(req.body.fields).map((f) => `${encodeURIComponent(expand(f.key))}=${encodeURIComponent(expand(f.value))}`).join('&');
      if (!has('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
      break;
  }
  if (missing.size) throw new HttpClientError('unknown_vars', `unknown variables: ${[...missing].join(', ')}`);
  // never echo the URL here: it may hold a secret value
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) throw new HttpClientError('invalid', 'the URL is not valid after variables were filled in');
  return { request: { method: req.method, url, headers, ...(body !== undefined ? { body } : {}) }, secretsUsed: used };
}

/** Every {{name}} the request mentions, with its value and where it came from; secrets show only their key. */
export function describeVars(req: HttpRequestFile, ctx: Omit<ResolveContext, 'allowSecrets'>): Record<string, VarInfo | null> {
  const names = new Set<string>();
  const scan = (t: string) => {
    for (const m of t.matchAll(VAR_IN_TEXT)) names.add(m[1]!);
  };
  scan(req.url);
  for (const kv of [...req.query, ...req.headers]) scan(kv.key + ' ' + kv.value);
  for (const c of ctx.collections) for (const h of c.file.headers) scan(h.value);
  if (req.body.kind === 'json') scan(JSON.stringify(req.body.value));
  else if (req.body.kind === 'text') scan(req.body.value);
  else if (req.body.kind === 'form') for (const f of req.body.fields) scan(f.key + ' ' + f.value);
  const out: Record<string, VarInfo | null> = {};
  for (const n of names) {
    const hit = lookup(req, ctx, n);
    out[n] = !hit ? null : hit.secret !== undefined ? { source: hit.source } : { source: hit.source, value: hit.value };
  }
  return out;
}
