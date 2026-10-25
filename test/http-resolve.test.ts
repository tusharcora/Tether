import { describe, expect, it } from 'vitest';
import { HttpClientError } from '../src/http/errors.js';
import { describeVars, resolveRequest, type ResolveContext } from '../src/http/resolve.js';
import { parseRequest } from '../src/http/store.js';

const file = (o: Record<string, unknown> = {}) => parseRequest({ name: 'r', method: 'GET', url: '{{base}}/api/runs', ...o });
const ctx = (o: Partial<ResolveContext> = {}): ResolveContext => ({
  collections: [
    { path: 'runs', file: { vars: { limit: '5' }, headers: [{ key: 'X-Team', value: 'inner', on: true }] } },
    { path: '', file: { vars: { base: 'http://root', limit: '1' }, headers: [{ key: 'X-Team', value: 'root', on: true }, { key: 'Accept', value: 'application/json', on: true }] } },
  ],
  env: { name: 'local', file: { v: 1, vars: { base: 'http://env', tok: { secret: 'aorch_token' } } } },
  secrets: { aorch_token: 's3cr3t', direct: 'd1rect' },
  allowSecrets: true,
  ...o,
});
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return `${(e as HttpClientError).code}: ${(e as Error).message}`;
  }
  return 'none';
};

describe('resolve', () => {
  it('looks up request → collections (innermost first) → environment → secrets', () => {
    const r = resolveRequest(file({ url: '{{base}}/x?l={{limit}}&own={{own}}&d={{direct}}', vars: { own: 'mine' } }), ctx({ env: undefined }));
    expect(r.request.url).toBe('http://root/x?l=5&own=mine&d=d1rect');
    const withEnv = resolveRequest(file(), ctx());
    expect(withEnv.request.url).toBe('http://root/api/runs'); // a collection var beats the environment
    expect(resolveRequest(file({ vars: { base: 'http://req' } }), ctx()).request.url).toBe('http://req/api/runs');
  });

  it('lists every unknown variable at once', () => {
    expect(err(() => resolveRequest(file({ url: '{{nope}}/{{base}}/{{also}}', headers: [{ key: 'A', value: '{{nope}}' }] }), ctx()))).toBe('unknown_vars: unknown variables: nope, also');
  });

  it('refuses secrets for ad-hoc requests, through the environment or directly', () => {
    expect(err(() => resolveRequest(file({ headers: [{ key: 'Authorization', value: 'Bearer {{tok}}' }] }), ctx({ allowSecrets: false })))).toBe('secret_adhoc: secret not available for ad-hoc requests');
    expect(err(() => resolveRequest(file({ url: 'http://h/{{direct}}' }), ctx({ allowSecrets: false })))).toBe('secret_adhoc: secret not available for ad-hoc requests');
    // a disabled header is never resolved
    expect(resolveRequest(file({ headers: [{ key: 'Authorization', value: '{{tok}}', on: false }] }), ctx({ allowSecrets: false })).request.headers.some(([k]) => k === 'Authorization')).toBe(false);
  });

  it('records the secrets a request used', () => {
    const r = resolveRequest(file({ headers: [{ key: 'Authorization', value: 'Bearer {{tok}}' }] }), ctx());
    expect(r.request.headers).toContainEqual(['Authorization', 'Bearer s3cr3t']);
    expect([...r.secretsUsed]).toEqual([['aorch_token', 's3cr3t']]);
  });

  it('merges headers root → inner → request, case-insensitively', () => {
    const r = resolveRequest(file({ headers: [{ key: 'accept', value: 'text/plain' }] }), ctx());
    expect(r.request.headers).toEqual([['X-Team', 'inner'], ['accept', 'text/plain']]);
  });

  it('builds bodies: JSON strings stay valid with quotes, form is urlencoded, query is appended', () => {
    const j = resolveRequest(file({ method: 'POST', vars: { q: 'say "hi"' }, body: { kind: 'json', value: { msg: '{{q}}', n: 1 } } }), ctx());
    expect(JSON.parse(j.request.body!)).toEqual({ msg: 'say "hi"', n: 1 });
    expect(j.request.headers).toContainEqual(['Content-Type', 'application/json']);
    const f = resolveRequest(file({ method: 'POST', query: [{ key: 'a b', value: '{{limit}}' }, { key: 'off', value: 'x', on: false }], body: { kind: 'form', fields: [{ key: 'n', value: 'a&b' }] } }), ctx());
    expect(f.request.url).toBe('http://root/api/runs?a%20b=5');
    expect(f.request.body).toBe('n=a%26b');
  });

  it('expands variables inside variables, and stops a loop', () => {
    expect(resolveRequest(file({ vars: { base: '{{host}}/v1', host: 'http://h' } }), ctx()).request.url).toBe('http://h/v1/api/runs');
    expect(err(() => resolveRequest(file({ vars: { base: '{{base}}' } }), ctx()))).toMatch(/nest too deep/);
  });

  it('does not echo the URL (which may hold a secret) when it is invalid after substitution', () => {
    const m = err(() => resolveRequest(file({ url: '{{tok}}' }), ctx()));
    expect(m).toBe('invalid: the URL is not valid after variables were filled in');
    expect(m).not.toContain('s3cr3t');
  });

  it('never takes an Object.prototype member for a secret', () => {
    const env = { name: 'local', file: { v: 1 as const, vars: { a: { secret: 'constructor' }, b: { secret: 'toString' } } } };
    const r = err(() => resolveRequest(file({ url: 'http://h/{{a}}/{{b}}' }), ctx({ env, secrets: {} })));
    expect(r).toBe('unknown_vars: unknown variables: a, b');
    expect(describeVars(file({ url: 'http://h/{{a}}' }), ctx({ env, secrets: {} }))).toEqual({ a: null });
  });

  it('describes vars for the UI without secret values', () => {
    const d = describeVars(file({ url: '{{base}}/{{tok}}/{{missing}}', vars: { own: 'x' } }), ctx());
    expect(d).toEqual({ base: { source: { from: 'collection', path: '' }, value: 'http://root' }, tok: { source: { from: 'secret', key: 'aorch_token' } }, missing: null });
    expect(JSON.stringify(d)).not.toContain('s3cr3t');
  });
});
