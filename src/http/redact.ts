/** Everything that leaves the engine (stored, returned to the browser, printed, put in a prompt) goes through here first. */
import { isObj, type CheckResult, type HistoryData, type ResolvedRequest, type SendResult } from './types.js';

export const MASKED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'x-api-key']);
export const HISTORY_BODY_MAX = 64 * 1024;
const SECRET_REF = /^(?:(?:Bearer|Basic|Token)\s+)?\{\{secret:[A-Za-z0-9_]+\}\}$/i;
const JSON_STRING = /"(?:[^"\\]|\\.)*"/g;

/** Replace each secret value used (raw, URL-encoded and JSON-escaped forms) with {{secret:<key>}}; longest first. */
export function redactText(text: string, secrets: Map<string, string>): string {
  const pairs: [string, string][] = [];
  for (const [key, value] of secrets) {
    if (!value) continue;
    const ref = `{{secret:${key}}}`;
    for (const form of new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])) pairs.push([form, ref]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [form, ref] of pairs) out = out.split(form).join(ref);
  return out;
}

/**
 * A body: when it is a JSON object or array, only its string literals (keys and values) are redacted, so a secret like
 * "200" never rewrites a number or the structure, and the formatting is kept. Anything else is redacted as text.
 */
function redactBody(text: string, secrets: Map<string, string>): string {
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) {
    let valid = true;
    try {
      JSON.parse(text);
    } catch {
      valid = false;
    }
    // valid JSON has quotes only around string literals, so this match finds exactly the literals
    if (valid)
      return text.replace(JSON_STRING, (lit) => {
        const v = JSON.parse(lit) as string;
        const out = redactText(v, secrets);
        return out === v ? lit : JSON.stringify(out);
      });
  }
  return redactText(text, secrets);
}

/** A structured value (a check's `actual`): secrets are replaced inside strings only; numbers and booleans stay as they are. */
function redactValue(v: unknown, secrets: Map<string, string>): unknown {
  if (typeof v === 'string') return redactText(v, secrets);
  if (Array.isArray(v)) return v.map((x) => redactValue(x, secrets));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [redactText(k, secrets), redactValue(x, secrets)]));
  return v;
}

const maskValue = (name: string, v: string) => (MASKED_HEADERS.has(name.toLowerCase()) && !SECRET_REF.test(v) ? `•••• (${v.length} chars)` : v);

export function maskHeaders(h: [string, string][]): [string, string][] {
  return h.map(([k, v]) => [k, maskValue(k, v)]);
}

const cutAt = (s: string, cut: boolean) => (cut && s.length > HISTORY_BODY_MAX ? { text: s.slice(0, HISTORY_BODY_MAX), cut: true } : { text: s, cut: false });

/** The exchange as it may leave the engine. `cut` (default true) cuts bodies at 64 KB for storage. */
export function redactExchange(req: ResolvedRequest, res: SendResult, checks: CheckResult[], secrets: Map<string, string>, o: { cut?: boolean } = {}): HistoryData {
  const cut = o.cut !== false;
  const r = (s: string) => redactText(s, secrets);
  // the URL parser lowercases host names, and DNS errors quote the host: catch a secret that was lowercased on the way
  const lower = new Map([...secrets].map(([k, v]) => [k, v.toLowerCase()]));
  const u = (s: string) => redactText(r(s), lower);
  const hdrs = (h: [string, string][]) => maskHeaders(h.map(([k, v]) => [r(k), r(v)]));
  const reqBody = req.body !== undefined ? cutAt(redactBody(req.body, secrets), cut) : undefined;
  const resBody = cutAt(redactBody(res.body, secrets), cut);
  return {
    request: { method: req.method, url: u(req.url), headers: hdrs(req.headers), ...(reqBody ? { body: reqBody.text, ...(reqBody.cut ? { bodyTruncated: true } : {}) } : {}) },
    response: {
      ...res,
      statusText: r(res.statusText),
      url: u(res.url),
      redirects: res.redirects.map(u),
      headers: hdrs(res.headers),
      body: resBody.text,
      ...(resBody.cut ? { bodyTruncated: true } : {}),
      ...(res.error ? { error: { kind: res.error.kind, message: u(res.error.message) } } : {}),
    },
    checks: checks.map((c) => {
      const actual = c.actual === undefined ? null : redactValue(c.actual, secrets);
      // a header check's actual is the raw header value: a credential header is masked here as in the header list
      return { ...c, actual: c.check.kind === 'header' && typeof actual === 'string' ? maskValue(c.check.name, actual) : actual };
    }),
  };
}
