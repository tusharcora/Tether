import { describe, expect, it } from 'vitest';
import { parseClaudeLine } from '../src/adapters/claude.js';
import { capPrompt } from '../src/adapters/cli.js';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { ancestorsOf, normalizePipeline, preflight, topoLayers } from '../src/pipeline.js';
import { foldRun } from '../src/types.js';
import { pipe } from './helpers.js';

const reg = () => new AdapterRegistry().register(new MockAdapter());
const errs = (p: ReturnType<typeof pipe>) => preflight(p, reg()).filter((i) => i.level === 'error').map((i) => i.message);

describe('pipeline', () => {
  it('layers a diamond and rejects cycles', () => {
    const p = pipe([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]);
    expect(topoLayers(p)).toEqual([['a'], ['b', 'c'], ['d']]);
    expect(ancestorsOf(p, 'd')).toEqual(['a', 'b', 'c']);
    const cyc = pipe([{ id: 'a' }, { id: 'b' }], [['a', 'b'], ['b', 'a']]);
    expect(errs(cyc).join()).toMatch(/cycle/);
  });

  it('refuses modes without a scheduler', () => {
    const p = normalizePipeline({ name: 'x', mode: 'swarm', nodes: [{ id: 'a', agent: 'mock' }] });
    expect(errs(p).join()).toMatch(/no scheduler/);
  });

  it('validates fixNode, gates, unknown adapters and bad edges', () => {
    expect(errs(pipe([{ id: 'g', kind: 'gate' }], [])).join()).toMatch(/needs a command/);
    expect(errs(pipe([{ id: 'a' }, { id: 'g', kind: 'gate', command: 'true', fixNode: 'a' }], [])).join()).toMatch(/upstream/);
    expect(errs(pipe([{ id: 'a', agent: 'nope' }], [])).join()).toMatch(/unknown agent adapter/);
    expect(errs(pipe([{ id: 'a' }], [['a', 'zzz']])).join()).toMatch(/missing node/);
    expect(errs(pipe([{ id: 'g', kind: 'gate', command: 'true', verdict: true }], [])).join()).toMatch(/only agent nodes/);
  });

  it('a gate runs a command or a saved request, exactly one', () => {
    expect(errs(pipe([{ id: 'g', kind: 'gate' }], [])).join()).toMatch(/needs a command or a saved request/);
    expect(errs(pipe([{ id: 'g', kind: 'gate', command: 'true', http: { run: 'runs/list' } }], [])).join()).toMatch(/not both/);
    expect(errs(pipe([{ id: 'g', kind: 'gate', http: { run: 'runs/list', repeat: 130, expect: 'last' } }], []))).toEqual([]);
    expect(errs(pipe([{ id: 'g', kind: 'gate', http: { run: '../x' } }], [])).join()).toMatch(/not a valid saved request id/);
    expect(errs(pipe([{ id: 'a', http: { run: 'x' } }], [])).join()).toMatch(/only gates/);
    expect(() => normalizePipeline({ name: 'x', nodes: [{ id: 'g', kind: 'gate', http: { run: 'a', repeat: 501 } }] })).toThrow(/1 to 500/);
    expect(() => normalizePipeline({ name: 'x', nodes: [{ id: 'g', kind: 'gate', http: { run: 'a', expect: 'some' } }] })).toThrow(/"all" or "last"/);
    expect(normalizePipeline({ name: 'x', nodes: [{ id: 'g', kind: 'gate', http: { run: 'a', env: 'local' } }] }).nodes[0]!.http).toEqual({ run: 'a', env: 'local' });
  });

  it('a half-filled request gate saves but is an error issue, never a throw', () => {
    const p = normalizePipeline({ name: 'x', nodes: [{ id: 'g', kind: 'gate', http: { run: '' } }] });
    expect(p.nodes[0]!.http).toEqual({ run: '' });
    expect(preflight(p, reg()).filter((i) => i.level === 'error')).toEqual([{ level: 'error', node: 'g', message: 'gate needs a request' }]);
    expect(() => normalizePipeline({ name: 'x', nodes: [{ id: 'g', kind: 'gate', http: { run: 7 } }] })).toThrow(/http needs "run"/);
  });

  it('warns when nothing independent verifies the work', () => {
    const w = preflight(pipe([{ id: 'a' }], []), reg()).filter((i) => i.level === 'warn');
    expect(w.map((x) => x.message).join()).toMatch(/no gate node/);
  });

  it('normalizes untrusted input defensively', () => {
    expect(() => normalizePipeline({ name: '../../etc', nodes: [] })).toThrow(/invalid pipeline name/);
    expect(() => normalizePipeline({ name: 'ok', nodes: [{ id: 'a b' }] })).toThrow(/id must match/);
    expect(() => normalizePipeline({ name: 'ok', nodes: [{ id: 'a', kind: 'wizard' }] })).toThrow(/unknown kind/);
    const p = normalizePipeline({ name: 'ok', nodes: [{ id: 'a' }], settings: { parallel: 9999 } });
    expect(p.settings.parallel).toBe(16);
  });
});

describe('claude stream parsing', () => {
  it('extracts session, text, cost and final result', () => {
    const acc: Parameters<typeof parseClaudeLine>[1] = { text: '' };
    const chunks: string[] = [];
    let sess = '';
    const feed = (o: unknown) => parseClaudeLine(JSON.stringify(o), acc, (t) => chunks.push(t), (s) => (sess = s));
    feed({ type: 'system', subtype: 'init', session_id: 'abc' });
    feed({ type: 'assistant', session_id: 'abc', message: { content: [{ type: 'text', text: 'hello' }, { type: 'tool_use', name: 'Edit' }] } });
    parseClaudeLine('not json', acc, () => {}, () => {});
    feed({ type: 'result', subtype: 'success', is_error: false, result: 'final answer', total_cost_usd: 0.0421, session_id: 'abc' });
    expect(sess).toBe('abc');
    expect(chunks.join('')).toContain('hello');
    expect(chunks.join('')).toContain('[tool] Edit');
    expect(acc.result).toBe('final answer');
    expect(acc.costUsd).toBeCloseTo(0.0421);
    expect(acc.isError).toBeFalsy();
    feed({ type: 'result', subtype: 'error_max_turns', result: 'x' });
    expect(acc.isError).toBe(true);
  });

  it('caps oversized argv prompts, keeping head and tail', () => {
    const big = 'H'.repeat(80_000) + 'M'.repeat(80_000) + 'T'.repeat(80_000);
    const c = capPrompt(big, 100_000);
    expect(c.length).toBeLessThan(100_500);
    expect(c.startsWith('HHH')).toBe(true);
    expect(c.endsWith('TTT')).toBe(true);
    expect(c).toContain('characters omitted');
  });
});

describe('event folding', () => {
  it('is deterministic and resets interrupted nodes on resume', () => {
    const p = pipe([{ id: 'a' }, { id: 'b' }], [['a', 'b']]);
    const ev = (seq: number, event: any) => ({ runId: 'r', seq, ts: seq, event });
    const base = [
      ev(1, { type: 'run.started', pipeline: p, task: 't', repo: '/r', workdir: '/w', baseSha: 's', branch: 'b' }),
      ev(2, { type: 'node.started', node: 'a', attempt: 1 }),
      ev(3, { type: 'node.finished', node: 'a', status: 'done', output: 'o', durationMs: 1, attempt: 1, costUsd: 0.1 }),
      ev(4, { type: 'node.started', node: 'b', attempt: 1 }),
    ];
    const s1 = foldRun(base)!;
    expect(s1.nodes.b!.status).toBe('running');
    expect(JSON.stringify(foldRun(base))).toBe(JSON.stringify(s1));
    const s2 = foldRun([...base, ev(5, { type: 'run.resumed' })])!;
    expect(s2.nodes.a!.status).toBe('done');
    expect(s2.nodes.b!.status).toBe('queued');
    expect(s2.costUsd).toBeCloseTo(0.1);
  });
});
