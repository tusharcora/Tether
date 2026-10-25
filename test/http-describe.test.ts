import { describe, expect, it } from 'vitest';
import { describeCheck, describeResult } from '../src/http/describe.js';
import type { CheckResult, SendResult } from '../src/http/types.js';

const res = (o: Partial<SendResult> = {}): SendResult => ({ status: 200, statusText: 'OK', url: 'http://x/a', headers: [], body: '', size: 0, truncated: false, ms: 50, timing: { ttfb: 40, download: 10 }, redirects: [], ...o });

describe('describeCheck', () => {
  it('writes one line per check kind', () => {
    expect(describeCheck({ kind: 'json', path: '$[0].id', op: 'exists' })).toBe('$[0].id exists');
    expect(describeCheck({ kind: 'json', path: '$.n', op: 'lt', value: 4 })).toBe('$.n lt 4');
    expect(describeCheck({ kind: 'status', op: 'in', value: [200, 201] })).toBe('status in [200,201]');
    expect(describeCheck({ kind: 'status', op: 'eq', value: 200 })).toBe('status eq 200');
    expect(describeCheck({ kind: 'time', op: 'lt', value: 200 })).toBe('time < 200 ms');
    expect(describeCheck({ kind: 'header', name: 'X-A', op: 'eq', value: 'b' })).toBe('header X-A eq "b"');
    expect(describeCheck({ kind: 'header', name: 'X-A', op: 'exists' })).toBe('header X-A exists');
    expect(describeCheck({ kind: 'body', op: 'contains', value: 'ok' })).toBe('body contains "ok"');
  });
});

describe('describeResult', () => {
  const req = { method: 'GET' as const, url: 'http://x/a' };
  it('names method, URL, status, time and every failed check with its actual value', () => {
    const checks: CheckResult[] = [
      { check: { kind: 'status', op: 'eq', value: 200 }, ok: true, actual: 200 },
      { check: { kind: 'time', op: 'lt', value: 10 }, ok: false, actual: 50 },
      { check: { kind: 'json', path: '$.id', op: 'eq', value: 7 }, ok: false, actual: 'seven' },
    ];
    expect(describeResult(req, res(), checks)).toBe('GET http://x/a → 200 OK · 50 ms · 2 of 3 checks failed: time < 10 ms (actual: 50); $.id eq 7 (actual: "seven")');
  });
  it('says when every check held or there were none', () => {
    expect(describeResult(req, res(), [{ check: { kind: 'status', op: 'eq', value: 200 }, ok: true, actual: 200 }])).toBe('GET http://x/a → 200 OK · 50 ms · 1 check passed');
    expect(describeResult(req, res({ statusText: '' }), [])).toBe('GET http://x/a → 200 · 50 ms · no checks');
  });
  it('reports a network error in place of the status', () => {
    const r = res({ status: 0, statusText: '', ms: 12, error: { kind: 'dns', message: 'getaddrinfo ENOTFOUND x' } });
    expect(describeResult(req, r, [])).toBe('GET http://x/a → network error (dns): getaddrinfo ENOTFOUND x · 12 ms · no checks');
  });
  it('stays one line and cuts long actual values at 200 characters', () => {
    const long = `line1\n${'y'.repeat(500)}`;
    const out = describeResult(req, res(), [{ check: { kind: 'body', op: 'contains', value: 'z' }, ok: false, actual: long }]);
    expect(out).not.toContain('\n');
    expect(out).toContain(`(actual: ${JSON.stringify(long).slice(0, 200)}…)`);
    expect(describeResult(req, res(), [{ check: { kind: 'header', name: 'x', op: 'exists' }, ok: false, actual: undefined }])).toContain('header x exists (actual: undefined)');
  });
});
