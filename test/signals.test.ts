import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Tui } from '../src/tui.js';
import { startServer } from '../src/server.js';
import { cleanNote, scoreOf, signalsOf, type StepSignal } from '../src/signals.js';
import { foldRun, type PipelineNode, type RunEvent, type StoredEvent } from '../src/types.js';
import { Vault } from '../src/vault.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const fold = (e: StoredEvent[]) => foldRun(e)!;
const log = (nodes: Partial<PipelineNode>[], edges: [string, string][], evs: RunEvent[], opts: { autoApprove?: boolean } = {}): StoredEvent[] => {
  const p = pipe(nodes, edges);
  const all: RunEvent[] = [{ type: 'run.started', pipeline: p, task: 't', repo: '/r', workdir: '/w', baseSha: 'x', branch: 'b', autoApprove: opts.autoApprove }, ...evs];
  return all.map((event, i) => ({ runId: 'r1', seq: i + 1, ts: 1000 * (i + 1), event }));
};
const fin = (node: string, over: Record<string, unknown> = {}): RunEvent => ({ type: 'node.finished', node, status: 'done', output: 'ok', durationMs: 100, costUsd: 0.01, attempt: 1, ...over }) as RunEvent;

describe('feedback fold', () => {
  const nodes = [{ id: 'code', role: 'coder' }];
  it('records the rating and note, last wins', () => {
    const evs = log(nodes, [], [
      { type: 'feedback', node: 'code', rating: 'up', note: 'nice' },
      { type: 'feedback', node: 'code', rating: 'down' },
    ]);
    expect(fold(evs).nodes.code!.feedback).toEqual({ rating: 'down' });
    expect(fold(evs.slice(0, 2)).nodes.code!.feedback).toEqual({ rating: 'up', note: 'nice' });
  });
  it('ignores feedback for an unknown node and leaves old logs unchanged', () => {
    const s = fold(log(nodes, [], [{ type: 'feedback', node: 'ghost', rating: 'up' }]));
    expect(Object.keys(s.nodes)).toEqual(['code']);
    expect(fold(log(nodes, [], [])).nodes.code!.feedback).toBeUndefined();
  });
});

describe('hostile node ids', () => {
  it('a persisted feedback event for __proto__/constructor does not pollute', () => {
    const evs = log([{ id: 'code', role: 'coder' }], [], [
      { type: 'feedback', node: '__proto__', rating: 'down' },
      { type: 'feedback', node: 'constructor', rating: 'down' },
      { type: 'feedback', node: 'toString', rating: 'down' },
    ]);
    const s = fold(evs);
    expect(({} as any).feedback).toBeUndefined();
    expect((s.nodes as any).feedback).toBeUndefined();
    expect(s.nodes.code!.feedback).toBeUndefined();
    expect((Object as any).feedback).toBeUndefined();
    expect(Object.keys(s.nodes)).toEqual(['code']);
  });
  it('engine.feedback refuses them', async () => {
    const { engine } = setup();
    const id = await engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { output: 'hi' } }], []), task: 't', repo: makeRepo() });
    await engine.wait(id);
    for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect(() => engine.feedback(id, k, 'up')).toThrow(/no step/);
  });
});

describe('cleanNote', () => {
  it('strips bidi and zero-width characters and never splits a surrogate pair', () => {
    expect(cleanNote('a\u202Eb\u200Bc\u2066d\uFEFFe\u200F')).toBe('abcde');
    const t = cleanNote('x'.repeat(499) + '😀😀')!;
    expect(t).toBe('x'.repeat(499));
    expect(/[\ud800-\udfff]/.test(t)).toBe(false);
    expect(cleanNote('x'.repeat(498) + '😀')!.length).toBe(500);
  });
});

describe('cleanNote basics', () => {
  it('strips control chars, caps at 500, empty becomes undefined', () => {
    expect(cleanNote('a\u0000b\u001b[31mc\nd\te')).toBe('ab[31mc d e');
    expect(cleanNote('x'.repeat(900))).toHaveLength(500);
    expect(cleanNote('  \u0007 ')).toBeUndefined();
    expect(cleanNote(undefined)).toBeUndefined();
  });
});

describe('signalsOf', () => {
  const nodes: Partial<PipelineNode>[] = [
    { id: 'code', role: 'coder' },
    { id: 'test', kind: 'gate', role: 'tester', command: 'true', fixNode: 'code' },
    { id: 'ok', kind: 'approval' },
    { id: 'odd', role: 'data-cleaner' },
    { id: 'plain' },
  ];
  const edges: [string, string][] = [['code', 'test'], ['test', 'ok']];
  const evs: RunEvent[] = [
    { type: 'node.started', node: 'code', attempt: 1, harness: { bot: 'coder', version: 2 } },
    fin('code', { costUsd: 0.5, durationMs: 400 }),
    { type: 'gate.result', node: 'test', ok: false, exitCode: 1, output: 'boom', durationMs: 5 },
    { type: 'loop', check: 'test', fixNode: 'code', n: 1 },
    { type: 'node.started', node: 'code', attempt: 2, harness: { bot: 'coder', version: 3 } },
    fin('code', { costUsd: 0.25, durationMs: 300, attempt: 2 }),
    { type: 'gate.result', node: 'test', ok: true, exitCode: 0, output: '', durationMs: 5 },
    { type: 'approval.requested', node: 'ok' },
    { type: 'approval.resolved', node: 'ok', approved: false, by: 'user' },
    { type: 'feedback', node: 'code', rating: 'down', note: 'missed tests' },
    { type: 'node.started', node: 'odd', attempt: 1, harness: { bot: 'coder', version: 1 } },
    fin('odd'),
    { type: 'node.started', node: 'plain', attempt: 1 },
    fin('plain'),
  ];

  it('one signal per finished known-bot agent step, from the final attempt', () => {
    const e = log(nodes, edges, evs);
    const sigs = signalsOf(fold(e), e);
    expect(sigs.map((x) => x.node)).toEqual(['code']); // unknown role, role-less step, gate and approval give none
    expect(sigs[0]).toEqual({ run: 'r1', node: 'code', bot: 'coder', harness: 3, gatePassed: true, redos: 1, handoffRefusals: 0, approved: false, feedback: 'down', costUsd: 0.75, durationMs: 700 });
  });

  it('falls back to the folded state without events (latest harness), and treats a missing harness as undefined', () => {
    const e = log(nodes, edges, evs);
    expect(signalsOf(fold(e))[0]!.harness).toBe(3);
    const old = log([{ id: 'code', role: 'coder' }], [], [{ type: 'node.started', node: 'code', attempt: 1 }, fin('code')]);
    const [sig] = signalsOf(fold(old), old);
    expect(sig!.harness).toBeUndefined();
    expect('harness' in sig!).toBe(false);
  });

  it('ignores a harness recorded for a different bot', () => {
    const e = log([{ id: 'code', role: 'coder' }], [], [{ type: 'node.started', node: 'code', attempt: 1, harness: { bot: 'reviewer', version: 4 } }, fin('code')]);
    expect(signalsOf(fold(e), e)[0]!.harness).toBeUndefined();
  });

  it('skips unfinished steps and gives the manager signals too', () => {
    const e = log([{ id: 'a', role: 'coder' }, { id: 'm', role: 'manager', manager: true }], [], [{ type: 'node.started', node: 'a', attempt: 1 }, { type: 'node.started', node: 'm', attempt: 1 }, fin('m')]);
    expect(signalsOf(fold(e), e).map((x) => x.bot)).toEqual(['manager']);
  });

  it('judges a step by the reviewer that checks it, not the reviewer by its own verdict', () => {
    const e = log(
      [{ id: 'code', role: 'coder' }, { id: 'rev', role: 'reviewer', verdict: true, fixNode: 'code' }],
      [['code', 'rev']],
      [fin('code'), fin('rev', { status: 'error', verdict: 'FAIL' }), { type: 'loop', check: 'rev', fixNode: 'code', n: 1 }, fin('code', { attempt: 2 }), fin('rev', { verdict: 'PASS', attempt: 2 })],
    );
    const sigs = signalsOf(fold(e), e);
    const code = sigs.find((x) => x.node === 'code')!;
    expect(code.verdict).toBe('pass');
    expect(code.redos).toBe(1);
    expect(sigs.find((x) => x.node === 'rev')!.verdict).toBeUndefined();
  });

  it('counts handoff refusals against the delegating step', () => {
    const e = log([{ id: 'a', role: 'coder' }], [], [
      fin('a'),
      { type: 'handoff', from: 'a', to: 'reviewer', goal: 'g', answer: 'refused: out of budget', round: 1 },
      { type: 'handoff', from: 'a', to: 'tester', goal: 'g', answer: 'fine', round: 1 },
      { type: 'handoff', from: 'a', to: 'tester', goal: 'g2', answer: 'refused: no', round: 2 },
    ]);
    expect(signalsOf(fold(e), e)[0]!.handoffRefusals).toBe(2);
  });

  it('does not count an auto-approval as the person approving', () => {
    const base: RunEvent[] = [fin('a'), { type: 'approval.requested', node: 'ok' }, { type: 'approval.resolved', node: 'ok', approved: true, by: 'auto' }];
    const e = log([{ id: 'a', role: 'coder' }, { id: 'ok', kind: 'approval' }], [['a', 'ok']], base);
    expect(signalsOf(fold(e), e)[0]!.approved).toBeUndefined();
    const e2 = log([{ id: 'a', role: 'coder' }, { id: 'ok', kind: 'approval' }], [['a', 'ok']], [fin('a'), { type: 'approval.requested', node: 'ok' }, { type: 'approval.resolved', node: 'ok', approved: true, by: 'cli' }]);
    expect(signalsOf(fold(e2), e2)[0]!.approved).toBe(true);
  });
});

describe('signalsOf: more shapes', () => {
  it('handoff refusals come from handoff events, not consult rows', () => {
    const e = log([{ id: 'a', role: 'coder' }], [], [
      fin('a'),
      { type: 'consult', from: 'a', to: 'b', question: 'q', answer: 'refused: I will not', round: 1 },
      { type: 'handoff', from: 'a', to: 'tester', goal: 'g', answer: 'refused: no', round: 1 },
    ]);
    expect(signalsOf(fold(e), e)[0]!.handoffRefusals).toBe(1);
  });

  it('a manager-spawned child and a handoff child get signals; a plan approval falls back to spawn.parent', () => {
    const e = log([{ id: 'boss', role: 'manager', manager: true }], [], [
      { type: 'node.started', node: 'boss', attempt: 1 },
      { type: 'node.spawned', node: { id: 'boss-t1', kind: 'agent', role: 'coder', x: 0, y: 0, spawn: { parent: 'boss', depth: 1, contract: { to: 'coder', goal: 'g', context: [], mode: 'read', after: [] } } } as PipelineNode, parent: 'boss', depth: 1, after: [] },
      { type: 'node.spawned', node: { id: 'boss-h1', kind: 'agent', role: 'reviewer', x: 0, y: 0, spawn: { parent: 'boss', depth: 1, kind: 'hand', contract: { to: 'reviewer', goal: 'g', context: [], mode: 'read', after: [] } } } as PipelineNode, parent: 'boss', depth: 1, after: [] },
      { type: 'node.spawned', node: { id: 'boss-ok', kind: 'approval', x: 0, y: 0, spawn: { parent: 'boss', depth: 1, contract: { to: 'approval', goal: 'plan', context: [], mode: 'read', after: [] } } } as PipelineNode, parent: 'boss', depth: 1, after: [] },
      { type: 'node.started', node: 'boss-t1', attempt: 1, harness: { bot: 'coder', version: 2 } },
      fin('boss-t1'),
      { type: 'node.started', node: 'boss-h1', attempt: 1, harness: { bot: 'reviewer', version: 5 } },
      fin('boss-h1'),
      { type: 'approval.requested', node: 'boss-ok' },
      { type: 'approval.resolved', node: 'boss-ok', approved: true, by: 'user' },
      fin('boss'),
    ]);
    const sigs = signalsOf(fold(e), e);
    expect(sigs.map((x) => [x.node, x.bot, x.harness])).toEqual([['boss', 'manager', undefined], ['boss-t1', 'coder', 2], ['boss-h1', 'reviewer', 5]]);
    expect(sigs[0]!.approved).toBe(true);
    expect(sigs[1]!.approved).toBeUndefined();
  });

  it('an approval after a gate with no fixNode is about the step the gate checks; several gates combine', () => {
    const nodes: Partial<PipelineNode>[] = [{ id: 'code', role: 'coder' }, { id: 'g1', kind: 'gate', command: 'true' }, { id: 'g2', kind: 'gate', command: 'true' }, { id: 'ok', kind: 'approval' }];
    const edges: [string, string][] = [['code', 'g1'], ['g1', 'g2'], ['g2', 'ok']];
    const e = log(nodes, edges, [
      fin('code'),
      { type: 'gate.result', node: 'g1', ok: true, exitCode: 0, output: '', durationMs: 1 },
      { type: 'gate.result', node: 'g2', ok: false, exitCode: 1, output: 'x', durationMs: 1 },
      { type: 'approval.requested', node: 'ok' },
      { type: 'approval.resolved', node: 'ok', approved: false, by: 'user' },
    ]);
    const [sig] = signalsOf(fold(e), e);
    expect(sig!.approved).toBe(false);
    expect(sig!.gatePassed).toBe(false);
  });

  it('without events: redos from loop counters, duration from timestamps, auto-approved runs ignore approvals', () => {
    const nodes: Partial<PipelineNode>[] = [{ id: 'code', role: 'coder' }, { id: 'test', kind: 'gate', command: 'true', fixNode: 'code' }, { id: 'ok', kind: 'approval' }];
    const e = log(nodes, [['code', 'test'], ['test', 'ok']], [
      { type: 'node.started', node: 'code', attempt: 1 },
      fin('code'),
      { type: 'gate.result', node: 'test', ok: false, exitCode: 1, output: '', durationMs: 1 },
      { type: 'loop', check: 'test', fixNode: 'code', n: 1 },
      { type: 'loop', check: 'test', fixNode: 'code', n: 2 },
      { type: 'approval.requested', node: 'ok' },
      { type: 'approval.resolved', node: 'ok', approved: true, by: 'user' },
    ], { autoApprove: true });
    const [sig] = signalsOf(fold(e));
    expect(sig!.redos).toBe(2);
    expect(sig!.approved).toBeUndefined();
    expect(sig!.durationMs).toBe(1000); // started at ts 2000, finished at ts 3000
    expect(sig!.gatePassed).toBe(false);
  });

  it('does not count node.requeued as a redo (it re-queues steps downstream of a redo, not the redone step)', () => {
    const e = log([{ id: 'a', role: 'coder' }, { id: 'b', role: 'coder' }], [['a', 'b']], [
      fin('b'),
      { type: 'node.requeued', node: 'b', reason: 'a was redone' },
      fin('b', { attempt: 2 }),
    ]);
    expect(signalsOf(fold(e), e).find((x) => x.node === 'b')!.redos).toBe(0);
  });
});

describe('scoreOf', () => {
  const sig = (o: Partial<StepSignal> = {}): StepSignal => ({ run: 'r', node: 'n', bot: 'coder', redos: 0, handoffRefusals: 0, costUsd: 0, durationMs: 0, ...o });
  it('uses the documented weights', () => {
    expect(scoreOf(sig())).toBe(0);
    expect(scoreOf(sig({ feedback: 'up' }))).toBeCloseTo(0.5);
    expect(scoreOf(sig({ feedback: 'down' }))).toBeCloseTo(-0.5);
    expect(scoreOf(sig({ verdict: 'pass' }))).toBeCloseTo(0.3);
    expect(scoreOf(sig({ gatePassed: false }))).toBeCloseTo(-0.3);
    expect(scoreOf(sig({ verdict: 'fail', gatePassed: true }))).toBeCloseTo(-0.3);
    expect(scoreOf(sig({ approved: true }))).toBeCloseTo(0.2);
    expect(scoreOf(sig({ approved: false }))).toBeCloseTo(-0.2);
    expect(scoreOf(sig({ redos: 1 }))).toBeCloseTo(-0.1);
    expect(scoreOf(sig({ redos: 9 }))).toBeCloseTo(-0.3);
    expect(scoreOf(sig({ handoffRefusals: 1 }))).toBeCloseTo(-0.05);
    expect(scoreOf(sig({ handoffRefusals: 9 }))).toBeCloseTo(-0.1);
  });
  it('clamps to [-1, 1]', () => {
    expect(scoreOf(sig({ feedback: 'up', verdict: 'pass', approved: true }))).toBe(1);
    expect(scoreOf(sig({ feedback: 'down', verdict: 'fail', gatePassed: false, approved: false, redos: 5, handoffRefusals: 5 }))).toBe(-1);
    expect(scoreOf(sig({ redos: -3, handoffRefusals: Number.NaN }))).toBe(0);
  });
});

describe('engine.feedback', () => {
  it('appends a sanitised feedback event and validates input', async () => {
    const { engine, store } = setup();
    const id = await engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { output: 'hi' } }], []), task: 't', repo: makeRepo() });
    await engine.wait(id);
    engine.feedback(id, 'code', 'up', 'good\u0000 job');
    expect(store.state(id)!.nodes.code!.feedback).toEqual({ rating: 'up', note: 'good job' });
    expect(() => engine.feedback(id, 'ghost', 'up')).toThrow(/no step/);
    expect(() => engine.feedback('nope', 'code', 'up')).toThrow(/unknown run/);
    expect(() => engine.feedback(id, 'code', 'meh' as never)).toThrow(/rating/);
  });
});

describe('POST /api/runs/:id/feedback', () => {
  let base = '';
  let close: () => Promise<void>;
  let runId = '';
  let getState: (id: string) => ReturnType<typeof foldRun> | undefined;
  const raw = (method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const u = new URL(base);
      const req = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, 'content-type': 'application/json', connection: 'close', ...opts.headers } }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : undefined }));
      });
      req.on('error', reject);
      req.end(opts.body);
    });
  const post = (body: unknown, id = runId) => raw('POST', `/api/runs/${id}/feedback`, { body: JSON.stringify(body) });

  beforeAll(async () => {
    const vault = new Vault(tmp('vault-'));
    const { engine, store, registry, home } = setup(vault);
    const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    base = s.url;
    close = s.close;
    runId = await engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { output: 'hi' } }], []), task: 't', repo: makeRepo() });
    await engine.wait(runId);
    getState = (id) => store.state(id);
  });
  afterAll(() => close());

  it('records feedback', async () => {
    const r = await post({ node: 'code', rating: 'down', note: 'bad\u0001 tests' });
    expect(r.status).toBe(200);
    expect(getState(runId)!.nodes.code!.feedback).toEqual({ rating: 'down', note: 'bad tests' });
  });
  it('400 on bad input, 404 on an unknown run', async () => {
    expect((await post({ node: 'code', rating: 'meh' })).status).toBe(400);
    expect((await post({ node: 'ghost', rating: 'up' })).status).toBe(400);
    expect((await post({ rating: 'up' })).status).toBe(400);
    expect((await post({ node: 'code', rating: 'up', note: 7 })).status).toBe(400);
    expect((await raw('POST', `/api/runs/${runId}/feedback`, { body: '{nope' })).status).toBe(400);
    expect((await post({ node: 'code', rating: 'up' }, 'r-missing')).status).toBe(404);
    expect(getState(runId)!.nodes.code!.feedback!.rating).toBe('down');
  });
  it('400 for prototype-key node ids', async () => {
    for (const node of ['constructor', '__proto__', 'toString']) expect((await post({ node, rating: 'up' })).status).toBe(400);
    expect(({} as any).feedback).toBeUndefined();
  });
  it('refuses a foreign Host or Origin and an oversized body', async () => {
    expect((await raw('POST', `/api/runs/${runId}/feedback`, { headers: { host: 'evil.example.com' }, body: JSON.stringify({ node: 'code', rating: 'up' }) })).status).toBe(403);
    expect((await raw('POST', `/api/runs/${runId}/feedback`, { headers: { origin: 'http://evil.example.com' }, body: JSON.stringify({ node: 'code', rating: 'up' }) })).status).toBe(403);
    expect((await post({ node: 'code', rating: 'up', note: 'x'.repeat(1_100_000) })).status).toBe(413);
  });
  it('caps a long note at 500 chars', async () => {
    await post({ node: 'code', rating: 'up', note: 'y'.repeat(5000) });
    expect(getState(runId)!.nodes.code!.feedback!.note).toHaveLength(500);
  });
});

describe('TUI + / - on the selected step', () => {
  it('records feedback on the selected step of the run view', async () => {
    const { engine, store, home } = setup();
    const id = await engine.start({ pipeline: pipe([{ id: 'a', role: 'coder', mock: { output: 'x' } }, { id: 'b', role: 'reviewer', mock: { output: 'y' } }], [['a', 'b']]), task: 't', repo: makeRepo() });
    await engine.wait(id);
    const tui: any = new Tui({ cfg: { home, vault: tmp('v-'), adapters: {}, endpoints: {} } as never, store, engine }, { write() { return true; }, columns: 100, rows: 30 } as never);
    tui.push({ kind: 'run', runId: id, sel: 0 });
    tui.key("+");
    expect(store.state(id)!.nodes.a!.feedback).toEqual({ rating: 'up' });
    tui.key('right');
    tui.key('-');
    expect(store.state(id)!.nodes.b!.feedback).toEqual({ rating: 'down' });
    expect(store.state(id)!.nodes.a!.feedback).toEqual({ rating: 'up' });
  });
});
