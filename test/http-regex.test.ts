import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/http/assert.js';
import { redactExchange } from '../src/http/redact.js';
import { compileRegex, regexTest } from '../src/http/regex.js';

describe('compileRegex', () => {
  it('compiles a pattern of up to 200 characters', () => {
    expect(compileRegex('^ok$').test('ok')).toBe(true);
    expect(compileRegex('a'.repeat(200)).source).toHaveLength(200);
  });

  it('refuses a pattern over 200 characters or not a string', () => {
    expect(() => compileRegex('a'.repeat(201))).toThrow('a "matches" pattern must be a string of at most 200 characters');
    expect(() => compileRegex(5)).toThrow(/at most 200 characters/);
  });

  it('reports an invalid pattern', () => {
    expect(() => compileRegex('(')).toThrow(/^invalid pattern: /);
  });
});

describe('a matches check that backtracks forever', () => {
  it('stops after the time limit and fails the check with "pattern timed out"', () => {
    const body = 'a'.repeat(40) + 'b';
    const r = { status: 200, statusText: 'OK', url: 'http://x/', headers: [['x-h', body]] as [string, string][], body, size: body.length, truncated: false, ms: 1, timing: { ttfb: 1, download: 0 }, redirects: [] };
    const t0 = Date.now();
    const out = evaluate(
      [
        { kind: 'body', op: 'matches', value: '(a+)+$' },
        { kind: 'header', name: 'x-h', op: 'matches', value: '(a+)+$' },
        { kind: 'body', op: 'matches', value: 'a+b$' },
      ],
      r,
    );
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out.map((c) => [c.ok, c.actual])).toEqual([
      [false, 'pattern timed out'],
      [false, 'pattern timed out'],
      [true, body],
    ]);
    // the timed-out actual survives redaction (it is not replaced by the body head)
    expect(redactExchange({ method: 'GET', url: 'http://x/', headers: [] }, r, out, new Map()).checks[0]!.actual).toBe('pattern timed out');
  });

  it('sees at most 64 KB of the input', () => {
    expect(regexTest(compileRegex('b$'), 'a'.repeat(70_000) + 'b')).toBe(false);
    expect(regexTest(compileRegex('^a+$'), 'a'.repeat(70_000))).toBe(true);
  });
});
