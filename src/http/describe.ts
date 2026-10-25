import type { Check, CheckResult, ExchangeRequest, SendResult } from './types.js';

/** One line per check, for the CLI, gate summaries, prompts and the web. Pure: the web imports this file. */
export function describeCheck(c: Check): string {
  switch (c.kind) {
    case 'status':
      return `status ${c.op} ${JSON.stringify(c.value)}`;
    case 'header':
      return c.op === 'exists' ? `header ${c.name} exists` : `header ${c.name} ${c.op} ${JSON.stringify(c.value)}`;
    case 'json':
      return c.op === 'exists' ? `${c.path} exists` : `${c.path} ${c.op} ${JSON.stringify(c.value)}`;
    case 'time':
      return `time < ${c.value} ms`;
    case 'body':
      return `body ${c.op} ${JSON.stringify(c.value)}`;
  }
}

const ACTUAL_MAX = 200;
const actual = (v: unknown): string => {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > ACTUAL_MAX ? `${s.slice(0, ACTUAL_MAX)}…` : s;
};

/**
 * One line for a finished send: method, URL, status (or the network error), time, and every failed check with its
 * actual value (JSON, cut at 200 chars). The CLI, request gates and send-to-agent use this instead of their own format.
 * Pass the redacted request and result: this only formats, it does not redact.
 */
export function describeResult(req: Pick<ExchangeRequest, 'method' | 'url'>, r: SendResult, checks: CheckResult[]): string {
  const outcome = r.error ? `network error (${r.error.kind}): ${r.error.message}` : `${r.status}${r.statusText ? ` ${r.statusText}` : ''}`;
  const failed = checks.filter((c) => !c.ok);
  const verdict = !checks.length
    ? 'no checks'
    : !failed.length
      ? `${checks.length} check${checks.length === 1 ? '' : 's'} passed`
      : `${failed.length} of ${checks.length} check${checks.length === 1 ? '' : 's'} failed: ${failed.map((c) => `${describeCheck(c.check)} (actual: ${actual(c.actual)})`).join('; ')}`;
  return `${req.method} ${req.url} → ${outcome} · ${r.ms} ms · ${verdict}`.replace(/[\r\n]+/g, ' ');
}
