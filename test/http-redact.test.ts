import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/http/assert.js';
import { maskHeaders, redactExchange, redactText } from '../src/http/redact.js';
import type { SendResult } from '../src/http/types.js';

const secrets = new Map([['tok', 'p@ss "w/ord"']]);
const res = (o: Partial<SendResult> = {}): SendResult => ({ status: 200, statusText: 'OK', url: 'http://x/', headers: [], body: '', size: 0, truncated: false, ms: 1, timing: { ttfb: 1, download: 0 }, redirects: [], ...o });

describe('redaction', () => {
  it('replaces raw, URL-encoded and JSON-escaped forms of a secret', () => {
    const v = 'p@ss "w/ord"';
    const text = `raw=${v} url=${encodeURIComponent(v)} json=${JSON.stringify({ t: v })}`;
    const out = redactText(text, secrets);
    expect(out).toBe('raw={{secret:tok}} url={{secret:tok}} json={"t":"{{secret:tok}}"}');
  });

  it('masks credential headers unless they are a secret ref', () => {
    expect(maskHeaders([['Authorization', 'Bearer {{secret:tok}}'], ['Cookie', 'sid=abc123'], ['X-Api-Key', 'k'], ['Accept', 'json']])).toEqual([
      ['Authorization', 'Bearer {{secret:tok}}'],
      ['Cookie', '•••• (10 chars)'],
      ['X-Api-Key', '•••• (1 chars)'],
      ['Accept', 'json'],
    ]);
  });

  it('redacts the whole exchange and cuts stored bodies at 64 KB', () => {
    const v = 'p@ss "w/ord"';
    const d = redactExchange(
      { method: 'POST', url: `http://x/?k=${encodeURIComponent(v)}`, headers: [['Authorization', `Bearer ${v}`]], body: JSON.stringify({ nested: { t: v } }) },
      res({ headers: [['set-cookie', `sid=${v}`], ['x-echo', v]], body: v + 'y'.repeat(70_000), error: undefined }),
      [{ check: { kind: 'body', op: 'contains', value: 'z' }, ok: false, actual: v }],
      secrets,
    );
    const all = JSON.stringify(d);
    expect(all).not.toContain(v);
    expect(all).not.toContain(encodeURIComponent(v));
    expect(d.request.url).toBe('http://x/?k={{secret:tok}}');
    expect(d.request.headers).toEqual([['Authorization', 'Bearer {{secret:tok}}']]);
    expect(d.response.headers).toEqual([['set-cookie', '•••• (18 chars)'], ['x-echo', '{{secret:tok}}']]);
    expect(d.response.body.length).toBe(65536);
    expect(d.response.bodyTruncated).toBe(true);
    expect(d.checks[0]!.actual).toBe('{{secret:tok}}');
    const full = redactExchange({ method: 'GET', url: 'http://x/', headers: [] }, res({ body: 'y'.repeat(70_000) }), [], secrets, { cut: false });
    expect(full.response.body.length).toBe(70_000);
  });

  it('replaces a secret only inside strings of structured values, so numbers stay intact', () => {
    const s = new Map([['code', '200']]);
    const body = JSON.stringify({ status: 200, n: [200, 1200], msg: 'got 200', '200': 'k' }, null, 2);
    const d = redactExchange(
      { method: 'POST', url: 'http://x/', headers: [], body: JSON.stringify({ count: 200, pin: '200' }) },
      res({ status: 200, size: 200, ms: 200, body }),
      [
        { check: { kind: 'status', op: 'eq', value: 200 }, ok: true, actual: 200 },
        { check: { kind: 'json', path: '$.o', op: 'exists' }, ok: true, actual: { n: 200, s: 'x200x', list: ['200', 200] } },
      ],
      s,
    );
    expect(d.response.status).toBe(200);
    expect(d.response.size).toBe(200);
    expect(d.response.ms).toBe(200);
    expect(JSON.parse(d.response.body)).toEqual({ status: 200, n: [200, 1200], msg: 'got {{secret:code}}', '{{secret:code}}': 'k' });
    expect(d.response.body).toContain('\n  "status": 200,'); // formatting kept: only string literals change
    expect(JSON.parse(d.request.body!)).toEqual({ count: 200, pin: '{{secret:code}}' });
    expect(d.checks[0]!.actual).toBe(200);
    expect(d.checks[1]!.actual).toEqual({ n: 200, s: 'x{{secret:code}}x', list: ['{{secret:code}}', 200] });
    // a raw text body is redacted as text
    expect(redactExchange({ method: 'GET', url: 'http://x/', headers: [] }, res({ body: 'code 200 ok' }), [], s).response.body).toBe('code {{secret:code}} ok');
  });

  it('masks a credential header value in a header check\'s actual unless it is a secret ref', () => {
    const d = redactExchange({ method: 'GET', url: 'http://x/', headers: [] }, res(), [
      { check: { kind: 'header', name: 'Authorization', op: 'exists' }, ok: true, actual: 'Bearer abc123' },
      { check: { kind: 'header', name: 'cookie', op: 'eq', value: 'x' }, ok: false, actual: 'sid=p@ss "w/ord"' },
      { check: { kind: 'header', name: 'X-Echo', op: 'exists' }, ok: true, actual: 'plain' },
    ], secrets);
    expect(d.checks.map((c) => c.actual)).toEqual(['•••• (13 chars)', '•••• (18 chars)', 'plain']);
    const ref = redactExchange({ method: 'GET', url: 'http://x/', headers: [] }, res(), [{ check: { kind: 'header', name: 'authorization', op: 'exists' }, ok: true, actual: 'Bearer p@ss "w/ord"' }], secrets);
    expect(ref.checks[0]!.actual).toBe('Bearer {{secret:tok}}');
  });

  it('catches a secret the URL parser lowercased (a host name in an error message or final URL)', () => {
    const s = new Map([['host', 'LeakyHost']]);
    const d = redactExchange(
      { method: 'GET', url: 'http://LeakyHost.invalid/', headers: [] },
      res({ status: 0, url: 'http://leakyhost.invalid/', error: { kind: 'dns', message: 'getaddrinfo ENOTFOUND leakyhost.invalid' } }),
      [],
      s,
    );
    expect(JSON.stringify(d).toLowerCase()).not.toContain('leakyhost');
    expect(d.response.error?.message).toBe('getaddrinfo ENOTFOUND {{secret:host}}.invalid');
  });

  it('a body check actual never keeps the prefix of a secret that straddles the 200-character cut', () => {
    const secret = 'SUPERSECRETVALUE';
    const s = new Map([['tok', secret]]);
    const r = res({ body: 'x'.repeat(190) + secret + ' tail' });
    const checks = evaluate([{ kind: 'body', op: 'contains', value: 'nope' }], r);
    const d = redactExchange({ method: 'GET', url: 'http://x/', headers: [] }, r, checks, s);
    const actual = d.checks[0]!.actual as string;
    expect(actual).not.toContain('SUPERSECRE');
    expect(actual.length).toBeLessThanOrEqual(200);
    expect(actual.startsWith('x'.repeat(190) + '{{secret:')).toBe(true);
  });

  it('drops a trailing partial secret left at the 5 MB truncation cut', () => {
    const secret = 'SUPERSECRETVALUE';
    const s = new Map([['tok', secret]]);
    const r = res({ body: 'abc ' + secret.slice(0, 9), truncated: true });
    const checks = evaluate([{ kind: 'body', op: 'contains', value: 'nope' }], r);
    const d = redactExchange({ method: 'GET', url: 'http://x/', headers: [] }, r, checks, s);
    expect(d.response.body).toBe('abc ');
    expect(JSON.stringify(d)).not.toContain('SUPERSEC');
    // a body that was not cut keeps its text as it is
    const whole = redactExchange({ method: 'GET', url: 'http://x/', headers: [] }, res({ body: 'abc SUPER' }), [], s);
    expect(whole.response.body).toBe('abc SUPER');
  });
});
