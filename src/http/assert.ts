/** Evaluate a request's checks against a send result: one `{ check, ok, actual }` per check, never throwing. */
import { compileRegex } from './regex.js';
import type { Check, CheckResult, SendResult } from './types.js';

/** A small path syntax: `$`, `$.a.b`, `$[0].id`, `$.items.length`, `$["odd key"]`. found=false when a step is missing. */
export function jsonPath(data: unknown, path: string): { found: boolean; value?: unknown } {
  if (!path.startsWith('$')) return { found: false };
  const steps: (string | number)[] = [];
  const re = /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/y;
  for (let i = 1; i < path.length; ) {
    re.lastIndex = i;
    const m = re.exec(path);
    if (!m) return { found: false };
    steps.push(m[1] ?? (m[2] !== undefined ? Number(m[2]) : (JSON.parse(`"${m[3]}"`) as string)));
    i = re.lastIndex;
  }
  let cur: unknown = data;
  for (const s of steps) {
    if (s === 'length' && (Array.isArray(cur) || typeof cur === 'string')) {
      cur = cur.length;
      continue;
    }
    if (cur === null || typeof cur !== 'object') return { found: false };
    if (typeof s === 'number') {
      if (!Array.isArray(cur) || s >= cur.length) return { found: false };
      cur = cur[s];
      continue;
    }
    if (!Object.hasOwn(cur, s)) return { found: false };
    cur = (cur as Record<string, unknown>)[s];
  }
  return { found: true, value: cur };
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
const contains = (hay: unknown, needle: unknown) => (typeof hay === 'string' ? hay.includes(String(needle)) : Array.isArray(hay) ? hay.some((x) => same(x, needle)) : false);
const asText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** A `matches` pattern, or the reason it cannot be used (`invalid pattern: …`), which becomes the check's actual value. */
function pattern(src: unknown): RegExp | string {
  try {
    return compileRegex(src);
  } catch (e) {
    const m = (e as Error).message;
    return m.startsWith('invalid pattern: ') ? m : `invalid pattern: ${m}`;
  }
}

export function evaluate(checks: Check[], r: SendResult): CheckResult[] {
  let parsed: { ok: boolean; value?: unknown } | undefined;
  const json = () => {
    if (!parsed) {
      try {
        parsed = { ok: true, value: JSON.parse(r.body) };
      } catch {
        parsed = { ok: false };
      }
    }
    return parsed;
  };
  return checks.map((c): CheckResult => {
    // compiled once up front so a bad pattern fails only its own check, with the reason as the actual value
    const re = c.op === 'matches' ? pattern(c.value) : /(?:)/;
    if (typeof re === 'string') return { check: c, ok: false, actual: re };
    switch (c.kind) {
      case 'status': {
        const a = r.status;
        const ok = c.op === 'in' ? c.value.includes(a) : c.op === 'eq' ? a === c.value : c.op === 'ne' ? a !== c.value : c.op === 'lt' ? a < c.value : a >= c.value;
        return { check: c, ok: a !== 0 && ok, actual: a };
      }
      case 'header': {
        const h = r.headers.find(([k]) => k.toLowerCase() === c.name.toLowerCase())?.[1];
        if (c.op === 'exists') return { check: c, ok: h !== undefined, actual: h ?? null };
        const ok = h !== undefined && (c.op === 'eq' ? h === c.value : c.op === 'contains' ? h.includes(c.value) : re.test(h));
        return { check: c, ok, actual: h ?? null };
      }
      case 'json': {
        const j = json();
        if (!j.ok) return { check: c, ok: false, actual: 'response is not JSON' };
        const { found, value } = jsonPath(j.value, c.path);
        if (c.op === 'exists') return { check: c, ok: found, actual: found ? value : null };
        if (!found) return { check: c, ok: false, actual: null };
        const n = Number(c.value);
        const ok =
          c.op === 'eq' ? same(value, c.value)
          : c.op === 'ne' ? !same(value, c.value)
          : c.op === 'contains' ? contains(value, c.value)
          : c.op === 'matches' ? re.test(asText(value))
          : c.op === 'lt' ? typeof value === 'number' && value < n
          : typeof value === 'number' && value > n;
        return { check: c, ok, actual: value };
      }
      case 'time':
        return { check: c, ok: r.status !== 0 && r.ms < c.value, actual: r.ms };
      case 'body':
        return { check: c, ok: c.op === 'contains' ? r.body.includes(c.value) : re.test(r.body), actual: r.body.slice(0, 200) };
    }
  });
}

export const allPass = (cs: CheckResult[]): boolean => cs.every((c) => c.ok);
/** A send passes when it got a response and every check held. */
export const passed = (r: SendResult, cs: CheckResult[]): boolean => r.status !== 0 && allPass(cs);
