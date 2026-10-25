import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listHistory } from '../src/http/history.js';
import { writeRequest } from '../src/http/store.js';
import { makeRepo, pipe, setup } from './helpers.js';

let srv: Server;
let base = '';
let hits = 0;
beforeAll(async () => {
  srv = createServer((req, res) => {
    if (req.url === '/ok') return res.writeHead(200, { 'content-type': 'application/json' }), res.end('{"ok":true}');
    if (req.url === '/count') return hits++, res.writeHead(hits > 3 ? 429 : 200), res.end();
    if (req.url === '/slow') return void setTimeout(() => (hits++, res.writeHead(200), res.end('slow ok')), 400);
    res.writeHead(500), res.end('broken on purpose');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => srv.close());
beforeEach(() => void (hits = 0));

const commit = (dir: string) => {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'requests'], { cwd: dir });
};
const healthFile = (path: string) => JSON.stringify({ v: 1, name: 'Health', method: 'GET', url: `${base}${path}`, checks: [{ kind: 'status', op: 'eq', value: 200 }] });

describe('request gate', () => {
  it('fails, loops to the fix node, which edits the request file in the worktree, then passes', async () => {
    const { engine, store } = setup();
    const repo = makeRepo();
    writeRequest(repo, 'api/health', JSON.parse(healthFile('/broken')));
    commit(repo);
    const p = pipe(
      [
        { id: 'code', role: 'coder', mock: { writeFile: { path: '.aorch/http/api/health.req.json', content: healthFile('/ok') }, writeFileFromAttempt: 2 } },
        { id: 'gate', kind: 'gate', title: 'health', http: { run: 'api/health' }, fixNode: 'code', maxLoops: 2 },
      ],
      [['code', 'gate']],
    );
    const s = await engine.wait(await engine.start({ pipeline: p, task: 't', repo }));
    expect(s.status).toBe('done');
    expect(s.nodes.gate!.loops).toBe(1);
    expect(s.nodes.gate!.gate!.output).toMatch(/^PASS request api\/health/);
    const rows = listHistory(store.raw(), { workspace: 'default', limit: 10 });
    expect(rows.map((r) => [r.source, r.status])).toEqual([['gate', 200], ['gate', 500]]);
    expect(rows[0]!.runId).toBe(s.id);
    // the first failure's summary went to the fix node
    const events = store.events(s.id).map((e) => e.event);
    const failed = events.find((e) => e.type === 'gate.result' && !e.ok) as { output: string; exitCode: number | null };
    expect(failed.output).toContain('FAIL request api/health');
    expect(failed.output).toContain(`GET ${base}/broken → 500 Internal Server Error`);
    expect(failed.output).toContain('- status eq 200 (actual: 500)');
    expect(failed.output).toContain('broken on purpose');
    expect(failed.exitCode).toBe(1);
  });

  it('repeat with expect "last" only judges the final send (rate limits)', async () => {
    const { engine } = setup();
    const repo = makeRepo();
    writeRequest(repo, 'rate', { name: 'Rate', method: 'GET', url: `${base}/count`, checks: [{ kind: 'status', op: 'eq', value: 429 }] });
    commit(repo);
    const last = pipe([{ id: 'gate', kind: 'gate', http: { run: 'rate', repeat: 5, expect: 'last' } }], []);
    expect((await engine.wait(await engine.start({ pipeline: last, task: 't', repo }))).status).toBe('done');
    expect(hits).toBe(5);
    hits = 0;
    const all = pipe([{ id: 'gate', kind: 'gate', http: { run: 'rate', repeat: 5 } }], []);
    const s = await engine.wait(await engine.start({ pipeline: all, task: 't', repo }));
    expect(s.status).toBe('error');
    expect(hits).toBe(1); // "all" stops at the first failing send
    expect(s.nodes.gate!.gate!.output).toMatch(/^FAIL request rate \(send 1 of 5, expect all\)/);
  });

  it('a node timeout during a repeat fails the gate for "all" and "last", and says it timed out', async () => {
    const { engine } = setup();
    const repo = makeRepo();
    writeRequest(repo, 'slow', { name: 'Slow', method: 'GET', url: `${base}/slow`, checks: [{ kind: 'status', op: 'eq', value: 200 }] });
    commit(repo);
    for (const mode of ['all', 'last'] as const) {
      hits = 0;
      const p = pipe([{ id: 'gate', kind: 'gate', http: { run: 'slow', repeat: 5, expect: mode } }], [], { nodeTimeoutMs: 1000 });
      const s = await engine.wait(await engine.start({ pipeline: p, task: 't', repo }));
      expect(s.status).toBe('error');
      const out = s.nodes.gate!.gate!.output;
      expect(out).toMatch(new RegExp(`^FAIL request slow \\(send 3 of 5, expect ${mode}\\)\nstopped after 2 of 5 sends: gate timed out after 1000 ms\n`));
      expect(hits).toBeLessThan(5);
    }
  });

    it('a request missing from the commit fails the gate with a clear message instead of crashing', async () => {
    const { engine } = setup();
    const repo = makeRepo();
    const p = pipe([{ id: 'gate', kind: 'gate', http: { run: 'not/there' } }], []);
    const s = await engine.wait(await engine.start({ pipeline: p, task: 't', repo }));
    expect(s.status).toBe('error');
    expect(s.nodes.gate!.gate!.output).toBe('request gate not/there: no request "not/there"');
  });

  it('a gate with no request chosen yet refuses to start', async () => {
    const { engine } = setup();
    const repo = makeRepo();
    const p = pipe([{ id: 'gate', kind: 'gate', http: { run: '' } }], []);
    await expect(engine.start({ pipeline: p, task: 't', repo })).rejects.toThrow(/\[gate\] gate needs a request/);
  });
});
