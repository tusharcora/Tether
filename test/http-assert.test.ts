import { describe, expect, it } from 'vitest';
import { allPass, evaluate, jsonPath, passed } from '../src/http/assert.js';
import type { Check, SendResult } from '../src/http/types.js';

const res = (o: Partial<SendResult> = {}): SendResult => ({ status: 200, statusText: 'OK', url: 'http://x', headers: [['content-type', 'application/json'], ['x-rate', '10']], body: JSON.stringify({ items: [{ id: 7, tags: ['a'] }], n: 3, 'odd key': true }), size: 10, truncated: false, ms: 50, timing: { ttfb: 40, download: 10 }, redirects: [], ...o });
const one = (c: Check, r = res()) => evaluate([c], r)[0]!;

describe('jsonPath', () => {
  it('walks dots, indexes, quoted keys and length', () => {
    const d = { items: [{ id: 7 }], 'odd key': 1 };
    expect(jsonPath(d, '$')).toEqual({ found: true, value: d });
    expect(jsonPath(d, '$.items[0].id')).toEqual({ found: true, value: 7 });
    expect(jsonPath(d, '$.items.length')).toEqual({ found: true, value: 1 });
    expect(jsonPath(d, '$["odd key"]')).toEqual({ found: true, value: 1 });
    expect(jsonPath(d, '$.items[3]')).toEqual({ found: false });
    expect(jsonPath(d, '$.nope.deeper')).toEqual({ found: false });
    expect(jsonPath([{ id: 1 }], '$[0].id')).toEqual({ found: true, value: 1 });
  });
});

describe('evaluate', () => {
  it('status ops', () => {
    expect(one({ kind: 'status', op: 'eq', value: 200 }).ok).toBe(true);
    expect(one({ kind: 'status', op: 'ne', value: 200 }).ok).toBe(false);
    expect(one({ kind: 'status', op: 'in', value: [201, 200] }).ok).toBe(true);
    expect(one({ kind: 'status', op: 'lt', value: 300 }).ok).toBe(true);
    expect(one({ kind: 'status', op: 'gte', value: 400 }, res({ status: 429 })).ok).toBe(true);
    expect(one({ kind: 'status', op: 'ne', value: 200 }, res({ status: 0 })).ok).toBe(false); // a network error passes no status check
  });
  it('header ops, case-insensitive names', () => {
    expect(one({ kind: 'header', name: 'X-Rate', op: 'exists' })).toMatchObject({ ok: true, actual: '10' });
    expect(one({ kind: 'header', name: 'content-type', op: 'contains', value: 'json' }).ok).toBe(true);
    expect(one({ kind: 'header', name: 'x-rate', op: 'matches', value: '^\\d+$' }).ok).toBe(true);
    expect(one({ kind: 'header', name: 'x-none', op: 'eq', value: '' })).toMatchObject({ ok: false, actual: null });
  });
  it('json ops', () => {
    expect(one({ kind: 'json', path: '$.items[0].id', op: 'exists' })).toMatchObject({ ok: true, actual: 7 });
    expect(one({ kind: 'json', path: '$.items[0]', op: 'eq', value: { tags: ['a'], id: 7 } }).ok).toBe(true); // key order does not matter
    expect(one({ kind: 'json', path: '$.n', op: 'ne', value: 4 }).ok).toBe(true);
    expect(one({ kind: 'json', path: '$.items[0].tags', op: 'contains', value: 'a' }).ok).toBe(true);
    expect(one({ kind: 'json', path: '$.n', op: 'lt', value: 4 }).ok).toBe(true);
    expect(one({ kind: 'json', path: '$.n', op: 'gt', value: 4 }).ok).toBe(false);
    expect(one({ kind: 'json', path: '$.n', op: 'matches', value: '^3$' }).ok).toBe(true);
    expect(one({ kind: 'json', path: '$.n', op: 'exists' }, res({ body: '<html>' }))).toMatchObject({ ok: false, actual: 'response is not JSON' });
  });
  it('time and body ops', () => {
    expect(one({ kind: 'time', op: 'lt', value: 100 })).toMatchObject({ ok: true, actual: 50 });
    expect(one({ kind: 'time', op: 'lt', value: 10 }).ok).toBe(false);
    expect(one({ kind: 'body', op: 'contains', value: '"id":7' }).ok).toBe(true);
    expect(one({ kind: 'body', op: 'matches', value: 'odd\\s?key' }).ok).toBe(true);
  });
  it('an invalid or too-long matches pattern fails that check with the reason and leaves the others alone', () => {
    const cs = evaluate(
      [
        { kind: 'body', op: 'matches', value: '(' },
        { kind: 'header', name: 'x-rate', op: 'matches', value: 'a'.repeat(201) },
        { kind: 'json', path: '$.n', op: 'matches', value: '[' },
        { kind: 'status', op: 'eq', value: 200 },
      ],
      res(),
    );
    expect(cs[0]).toMatchObject({ ok: false, actual: expect.stringMatching(/^invalid pattern: .+/) });
    expect(cs[1]).toMatchObject({ ok: false, actual: 'invalid pattern: a "matches" pattern must be a string of at most 200 characters' });
    expect(cs[2]).toMatchObject({ ok: false, actual: expect.stringMatching(/^invalid pattern: .+/) });
    expect(cs[3]).toMatchObject({ ok: true, actual: 200 });
  });
  it('allPass and passed', () => {
    expect(allPass(evaluate([{ kind: 'status', op: 'eq', value: 200 }, { kind: 'time', op: 'lt', value: 10 }], res()))).toBe(false);
    expect(allPass([])).toBe(true);
    expect(passed(res(), [])).toBe(true);
    expect(passed(res({ status: 0 }), [])).toBe(false); // a network error never passes, even with no checks
    expect(passed(res(), evaluate([{ kind: 'time', op: 'lt', value: 10 }], res()))).toBe(false);
  });
});
