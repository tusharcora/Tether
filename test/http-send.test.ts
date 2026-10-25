import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { send } from '../src/http/send.js';

let a: Server;
let b: Server;
let A = '';
let B = '';
let seenByB: IncomingHttpHeaders = {};
const listen = (s: Server) => new Promise<string>((r) => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

beforeAll(async () => {
  b = createServer((req, res) => {
    seenByB = req.headers;
    res.end('on b');
  });
  B = await listen(b);
  a = createServer((req, res) => {
    const u = req.url ?? '/';
    if (u === '/json') return res.writeHead(200, { 'content-type': 'application/json', 'x-n': '1' }), res.end('{"items":[{"id":7}]}');
    if (u.startsWith('/hop/')) {
      const n = Number(u.split('/')[2]);
      return res.writeHead(302, { location: n > 0 ? `/hop/${n - 1}` : '/json' }), res.end();
    }
    if (u === '/away') return res.writeHead(307, { location: `${B}/landed` }), res.end();
    if (u === '/self') return res.writeHead(307, { location: '/headers' }), res.end();
    if (u === '/headers') return res.writeHead(200, { 'content-type': 'application/json' }), res.end(JSON.stringify(req.headers));
    if (u === '/post303') return res.writeHead(303, { location: '/echo' }), res.end();
    if (u === '/echo') return res.end(`${req.method} ${req.headers['content-type'] ?? '-'}`);
    if (u === '/big') return res.end('x'.repeat(50_000));
    if (u === '/hang') return; // never answers
    res.writeHead(404).end();
  });
  A = await listen(a);
});
afterAll(() => {
  a.closeAllConnections();
  a.close();
  b.close();
});

describe('send', () => {
  it('returns status, headers, body, size and ttfb/download timing', async () => {
    const r = await send({ method: 'GET', url: `${A}/json`, headers: [] });
    expect(r).toMatchObject({ status: 200, body: '{"items":[{"id":7}]}', size: 20, truncated: false, redirects: [] });
    expect(r.headers).toContainEqual(['x-n', '1']);
    expect(r.timing.ttfb).toBeGreaterThanOrEqual(0);
    expect(r.timing.download).toBeGreaterThanOrEqual(0);
    expect(r.ms).toBeGreaterThanOrEqual(r.timing.ttfb);
  });

  it('follows up to 5 redirects and reports more as an error', async () => {
    const ok = await send({ method: 'GET', url: `${A}/hop/4`, headers: [] });
    expect(ok.status).toBe(200);
    expect(ok.redirects).toHaveLength(5);
    expect(ok.url).toBe(`${A}/json`);
    const tooMany = await send({ method: 'GET', url: `${A}/hop/5`, headers: [] });
    expect(tooMany).toMatchObject({ status: 0, error: { kind: 'other', message: 'more than 5 redirects' } });
  });

  it('turns POST into GET on 303 and drops the body', async () => {
    const r = await send({ method: 'POST', url: `${A}/post303`, headers: [['Content-Type', 'application/json']], body: '{}' });
    expect(r.body).toBe('GET -');
  });

  it('does not send credentials to another origin after a redirect', async () => {
    const r = await send({
      method: 'GET',
      url: `${A}/away`,
      headers: [['Authorization', 'Bearer s3cr3t'], ['Cookie', 'sid=1'], ['Proxy-Authorization', 'Basic eA=='], ['X-Keep', 'yes']],
    });
    expect(r.body).toBe('on b');
    expect(seenByB.authorization).toBeUndefined();
    expect(seenByB.cookie).toBeUndefined();
    expect(seenByB['proxy-authorization']).toBeUndefined();
    expect(seenByB['x-keep']).toBe('yes');
  });

  it('keeps credentials on a same-origin redirect', async () => {
    const r = await send({ method: 'GET', url: `${A}/self`, headers: [['Authorization', 'Bearer s3cr3t'], ['Cookie', 'sid=1'], ['Proxy-Authorization', 'Basic eA==']] });
    expect(JSON.parse(r.body)).toMatchObject({ authorization: 'Bearer s3cr3t', cookie: 'sid=1', 'proxy-authorization': 'Basic eA==' });
  });

  it('cuts the body at the cap and says so', async () => {
    const r = await send({ method: 'GET', url: `${A}/big`, headers: [] }, { maxBytes: 1000 });
    expect(r).toMatchObject({ status: 200, size: 1000, truncated: true });
    expect(r.body).toHaveLength(1000);
  });

  it('maps timeouts, refused connections and DNS failures to error kinds', async () => {
    expect(await send({ method: 'GET', url: `${A}/hang`, headers: [] }, { timeoutMs: 200 })).toMatchObject({ status: 0, error: { kind: 'timeout', message: 'no response within 200 ms' } });
    const closed = createServer();
    const url = await listen(closed);
    await new Promise((r) => closed.close(r));
    expect((await send({ method: 'GET', url, headers: [] })).error?.kind).toBe('refused');
    expect((await send({ method: 'GET', url: 'http://no-such-host.invalid/', headers: [] })).error?.kind).toBe('dns');
  });
});
