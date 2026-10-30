import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PASS_ON_MAX, passOn } from '../src/codemode/spill.js';
import { answersBlock } from '../src/consult.js';
import { handoffBlock, reviewPrompt } from '../src/handoff.js';
import { foldRun, type PipelineNode, type StoredEvent } from '../src/types.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const J = (x: unknown) => JSON.stringify(x);
/** Eleven numbered fixes, each long: the shape of the owner's reviewer FAIL (spec §2.2). */
const fixes = (each: number) => Array.from({ length: 11 }, (_, i) => `(${i + 1}) fix number ${i + 1}: ${'x'.repeat(each)}`).join(' ');
const pointer = /Read the full text before acting on it: (\S+\.txt)/;

describe('passOn: inline up to 16,000 characters, else a spill file and a pointer', () => {
  it('keeps text whole up to the limit', () => {
    const t = 'a'.repeat(PASS_ON_MAX);
    expect(passOn(t, tmp())).toBe(t);
  });

  it('spills longer text: head, tail and the path of the full text, within the limit; the same text names one file', () => {
    const dir = tmp();
    const t = `HEAD-${'m'.repeat(40_000)}-TAIL`;
    const out = passOn(t, dir);
    expect(out.length).toBeLessThanOrEqual(PASS_ON_MAX);
    expect(out.startsWith('HEAD-')).toBe(true);
    expect(out.endsWith('-TAIL')).toBe(true);
    const path = pointer.exec(out)![1]!;
    expect(path.startsWith(dir)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(t);
    expect(passOn(t, dir)).toBe(out);
  });

  it('without a worktree it says how much was left out', () => {
    const out = passOn('z'.repeat(30_000), undefined);
    expect(out.length).toBeLessThanOrEqual(PASS_ON_MAX);
    expect(out).toMatch(/characters left out/);
  });
});

describe('nothing important gets cut between steps', () => {
  it("a manager's redo reason reaches the step whole (the owner's 11 fixes), and a longer one as a file", async () => {
    const short = fixes(150); // ~2k: past the old 1,000-character cut
    const long = fixes(2000); // ~22k: spilled
    const lead = { id: 'lead', role: 'planner', readOnly: true, manager: true, roster: ['coder'], mock: { replies: { plan: [J({ tasks: [{ id: 'a', to: 'coder', goal: 'g' }] })], review: [J({ redo: [{ id: 'a', reason: short }] }), J({ redo: [{ id: 'a', reason: long }] }), J({ decision: 'accept' })] } } } as Partial<PipelineNode>;
    const { engine, mock } = setup();
    const id = await engine.start({ pipeline: pipe([lead], []), task: 't', repo: makeRepo(), workspace: false });
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    const runs = mock.calls.filter((c) => c.nodeId === 'lead-a');
    expect(runs[1]!.prompt).toContain('(1) fix number 1');
    expect(runs[1]!.prompt).toContain('(11) fix number 11');
    const path = pointer.exec(runs[2]!.prompt)![1]!;
    expect(readFileSync(path, 'utf8')).toContain(`Redo requested by lead: ${long}`);
    // the redone step's guidance keeps the newest reason whole, not the last 2,000 characters
    expect(s.pipeline.nodes.find((n) => n.id === 'lead-a')!.guidance).toMatch(pointer);
  });

  it('upstream output, check findings, hand-off and consult answers and reports to a manager pass on whole up to the limit', async () => {
    const big = `START${'o'.repeat(14_000)}END`;
    const { engine, mock } = setup();
    const p = pipe(
      [
        { id: 'plan', role: 'planner', readOnly: true, mock: { output: big } },
        { id: 'code', role: 'coder', mock: { output: 'done' } },
        { id: 'rev', role: 'reviewer', readOnly: true, verdict: true, fixNode: 'code', maxLoops: 1, mock: { output: big, verdicts: ['FAIL', 'PASS'] } },
      ],
      [['plan', 'code'], ['code', 'rev']],
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo(), workspace: false });
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    const code = mock.calls.filter((c) => c.nodeId === 'code');
    expect(code[0]!.prompt).toContain(big); // was cut at 12,000
    expect(code[1]!.prompt).toContain(big); // the reviewer's findings: was cut at 8,000
    expect(handoffBlock([{ to: 'coder', goal: 'g', answer: big, ok: true }], s.workdir)).toContain('END');
    expect(answersBlock([{ to: 'plan', question: 'q', answer: big }], s.workdir)).toContain('END');
    const kid = { id: 'm-a', kind: 'agent', role: 'coder', x: 0, y: 0, spawn: { parent: 'm', depth: 1, contract: { to: 'coder', goal: 'g', context: [], mode: 'read', after: [] } } } as PipelineNode;
    const mgr = { id: 'm', kind: 'agent', manager: true, x: 0, y: 0 } as PipelineNode;
    const withKid = { ...s, pipeline: { ...s.pipeline, nodes: [...s.pipeline.nodes, mgr, kid] }, nodes: { ...s.nodes, 'm-a': { status: 'done', attempts: 1, costUsd: 0, loops: 0, output: big } } } as typeof s;
    expect(reviewPrompt(withKid, mgr, [kid], 1)).toContain(big); // was cut at 4,000
  });

  it('amended guidance keeps up to the limit, and the fold keeps the newest guidance whole', async () => {
    const { engine } = setup();
    const id = await engine.start({ pipeline: pipe([{ id: 'a', mock: { failFirst: 1 } }], []), task: 't', repo: makeRepo(), workspace: false });
    await engine.wait(id);
    const g = `G${'g'.repeat(5000)}!`;
    engine.amend(id, 'a', { guidance: g }, 'test');
    engine.amend(id, 'a', { guidance: g.replace('G', 'H') }, 'test');
    const s = engine.store.state(id)!;
    expect(s.pipeline.nodes[0]!.guidance).toBe(`${g}\n${g.replace('G', 'H')}`);
    const events = [
      { runId: 'r', seq: 1, ts: 1, event: { type: 'run.started', pipeline: pipe([{ id: 'a' }], []), task: 't', repo: '/r', workdir: '/w', baseSha: 'x', branch: 'b' } },
      ...[1, 2, 3].map((n) => ({ runId: 'r', seq: n + 1, ts: n + 1, event: { type: 'node.amended', node: 'a', guidance: `${n}${'q'.repeat(15_000)}`, reason: 'x' } })),
    ] as unknown as StoredEvent[];
    const folded = foldRun(events)!.pipeline.nodes[0]!.guidance!;
    expect(folded.startsWith('3')).toBe(true);
    expect(folded.length).toBe(15_001);
  });
});
