import { beforeEach, describe, expect, it } from 'vitest';
import type { PipelineNode } from '../../../src/types';
import { makeRun } from '../test/fixtures';
import { loadComments, sendBackNote, sendBackTarget, type LineComment } from './comments';
import { autofixLine, costParts, decisionLine, decisionOf, defaultStep, storyRows } from './storyModel';

const NAMES: Record<string, string> = { coder: 'Bolt', reviewer: 'Lens', tester: 'Probe', planner: 'Sage', tether: 'Tether' };
const botOf = (n: Pick<PipelineNode, 'kind' | 'role'>) => (n.kind === 'gate' ? 'tester' : (n.role ?? 'coder'));
const nameOf = (b: string) => NAMES[b] ?? b;

/** fix → tests → review → you approve, paused at the approval with everything passed. */
const shipRun = () =>
  makeRun({
    status: 'paused',
    live: false,
    costUsd: 0.63,
    pipeline: {
      ...makeRun().pipeline,
      nodes: [
        { id: 'fix', kind: 'agent', role: 'coder', title: 'Fix', x: 0, y: 0, model: 'sonnet' },
        { id: 'tests', kind: 'gate', command: 'npm test -- auth', title: 'tests', x: 0, y: 0 },
        { id: 'review', kind: 'agent', role: 'reviewer', verdict: true, readOnly: true, x: 0, y: 0, model: 'haiku' },
        { id: 'ok', kind: 'approval', title: 'You approve', x: 0, y: 0 },
      ],
      edges: [{ from: 'fix', to: 'tests' }, { from: 'tests', to: 'review' }, { from: 'review', to: 'ok' }],
    },
    nodes: {
      fix: { status: 'done', attempts: 1, costUsd: 0.41, loops: 0, commit: 'c1', startedAt: 0, finishedAt: 220_000, stat: { files: 3, added: 42, deleted: 9 } },
      tests: { status: 'done', attempts: 1, costUsd: 0, loops: 0, gate: { ok: true, exitCode: 0, output: '24 passed' } },
      review: { status: 'done', attempts: 1, costUsd: 0.08, loops: 0, verdict: 'PASS' },
      ok: { status: 'awaiting', attempts: 0, costUsd: 0, loops: 0 },
    },
  });

describe('a skipped step says why', () => {
  it('the reason is on its row', () => {
    const base = shipRun();
    const r = { ...base, nodes: { ...base.nodes, review: { status: 'skipped' as const, attempts: 0, costUsd: 0, loops: 0, error: 'upstream "tests" did not succeed' } } };
    expect(storyRows(r, botOf, nameOf).find((x) => x.id === 'review')!.line).toContain('upstream "tests" did not succeed');
  });
});

describe('auto-fix in the story', () => {
  it('a row per round, saying what it did; a gave-up row says why; Allow edits waits on you', () => {
    const base = shipRun();
    const r = { ...base, status: 'running' as const, autofix: { round: 2, of: 3, rounds: [{ round: 1, action: 'retry' as const, detail: 'retrying fix with the diagnosis attached', ts: 1 }, { round: 2, action: 'escalate' as const, node: 'review', to: { agent: 'claude', model: 'opus' }, detail: 'moving review to claude · opus', ts: 2 }] } };
    const rows = storyRows(r, botOf, nameOf).filter((x) => x.id.startsWith('autofix'));
    expect(rows.map((x) => [x.sentence, x.line, x.state])).toEqual([
      ['Tether auto-fixed: round 1 of 3', 'retried with the diagnosis attached', 'done'],
      ['Tether auto-fixed: round 2 of 3', 'moved Lens to opus', 'working'],
    ]);
    const gave = storyRows({ ...r, status: 'error', autofix: { ...r.autofix, gaveUp: 'still failing' } }, botOf, nameOf).at(-1)!;
    expect([gave.sentence, gave.line, gave.state]).toEqual(['Auto-fix gave up after 2 rounds', 'still failing', 'failed']);
    const ask = storyRows({ ...r, status: 'error', autofix: { ...r.autofix, needsWrites: 'this run is read-only' } }, botOf, nameOf).at(-1)!;
    expect(ask).toMatchObject({ sentence: 'Tether asks: allow edits and retry?', state: 'waiting', you: true });
  });
  it('the header line: Auto-fixing · round 2 of 3 · moved Lens to opus', () => {
    const r = { ...shipRun(), status: 'running' as const, autofix: { round: 2, of: 3, rounds: [{ round: 2, action: 'escalate' as const, node: 'review', to: { agent: 'claude', model: 'opus' }, detail: 'x', ts: 2 }] } };
    expect(autofixLine(r, nameOf, botOf)).toBe('Auto-fixing · round 2 of 3 · moved Lens to opus');
    expect(autofixLine({ ...r, status: 'done' }, nameOf, botOf)).toBe('Fixed by auto-fix in round 2');
    expect(autofixLine({ ...r, autofix: undefined }, nameOf, botOf)).toBeUndefined();
  });
});

describe('a run told as a story', () => {
  it('one row per step in order: who did what, the files and ±, the result, and you approve last', () => {
    const rows = storyRows(shipRun(), botOf, nameOf);
    expect(rows.map((r) => [r.sentence, r.line, r.state])).toEqual([
      ['Bolt made the changes', 'Fix · 3 files · +42 −9 · 3m 40s · $0.41', 'done'],
      ['Probe ran tests', 'npm test -- auth · passed', 'done'],
      ['Lens reviewed', 'verdict PASS · $0.08', 'done'],
      ['You approve', 'waiting on you', 'waiting'],
    ]);
    expect(rows.at(-1)!.you).toBe(true);
  });

  it('a team run starts with Tether’s planning, and its questions wait on you as a row', () => {
    const team = makeRun({ kind: 'team', plan: { assignments: [{ bot: 'coder', mode: 'write', task: 't', why: 'w' }] } as never, answers: [{ question: 'q', option: 'a' }] as never, pending: [{ id: 'q2', title: 'Which?', options: [] }] as never });
    const rows = storyRows(team, botOf, nameOf);
    expect(rows[0]).toMatchObject({ id: 'planning', sentence: 'Tether planned', line: 'picked Bolt · 1 answer', state: 'done' });
    expect(rows[1]).toMatchObject({ id: 'questions', sentence: 'Tether asks you', line: '1 question', you: true });
    expect(storyRows(makeRun({ kind: 'team', planning: true, round: 1, pipeline: { ...makeRun().pipeline, nodes: [], edges: [] }, nodes: {} }), botOf, nameOf)).toEqual([{ id: 'planning', bot: 'tether', sentence: 'Tether is planning', line: 'round 1', state: 'working' }]);
  });

  it('a failed review says it found problems; a failed gate says so; the page opens on the step that wrote', () => {
    const r = shipRun();
    r.nodes.review = { ...r.nodes.review!, status: 'error', verdict: 'FAIL' };
    r.nodes.tests = { ...r.nodes.tests!, status: 'error', loops: 2, gate: { ok: false, exitCode: 1, output: '' } };
    const rows = storyRows(r, botOf, nameOf);
    expect(rows[1]).toMatchObject({ sentence: 'tests failed', line: 'npm test -- auth · failed (exit 1) · 2 fix loops' });
    expect(rows[2]!.sentence).toBe('Lens found problems');
    expect(defaultStep(r, rows)).toBe('fix');
  });
});

describe('the decision', () => {
  it('is the final approval with what the checks and reviewers say', () => {
    const r = shipRun();
    expect(decisionOf(r)).toEqual({ node: 'ok', title: 'You approve', final: true });
    expect(decisionLine(r, (n) => nameOf(botOf(n)))).toBe('Checks pass and Lens approved. Ship it?');
    const mid = makeRun({ pipeline: { ...r.pipeline, edges: [...r.pipeline.edges.filter((e) => e.to !== 'ok'), { from: 'fix', to: 'ok' }, { from: 'ok', to: 'tests' }] }, nodes: r.nodes });
    expect(decisionOf(mid)!.final).toBe(false);
    expect(decisionOf(makeRun())).toBeUndefined();
  });

  it('costs per agent and model, with Tether’s planning as the rest, dearest first', () => {
    expect(costParts(shipRun(), botOf, nameOf)).toEqual([
      { label: 'Bolt · sonnet', usd: 0.41, bot: 'coder' },
      { label: 'Tether · planning', usd: expect.closeTo(0.14), bot: 'tether' },
      { label: 'Lens · haiku', usd: 0.08, bot: 'reviewer' },
    ]);
  });
});

describe('comments → send back', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  const c = (o: Partial<LineComment>): LineComment => ({ id: 'c1', node: 'fix', file: 'src/auth/callback.ts', line: '1-2', quote: "+ return redirect(next ?? '/home');", text: 'Also reject //evil.com', at: 1, ...o });

  it('quotes each comment under the reason, cut to what a step keeps', () => {
    expect(sendBackNote([c({})], 'Tighten the check')).toBe("Tighten the check\n\nComments on the diff:\n- src/auth/callback.ts: \"+ return redirect(next ?? '/home');\": Also reject //evil.com");
    expect(sendBackNote([], '  just this ')).toBe('just this');
    expect(sendBackNote([c({ text: 'x'.repeat(2000) })], '')).toHaveLength(1000);
  });

  it('goes to the earliest step a comment is on, else the open step, else the last that wrote', () => {
    const r = shipRun();
    expect(sendBackTarget(r, [c({ node: 'review' }), c({ node: 'fix' })])).toBe('fix');
    expect(sendBackTarget(r, [], 'review')).toBe('review');
    expect(sendBackTarget(r, [], 'ok')).toBe('fix');
  });

  it('reads nothing back from broken storage', () => {
    localStorage.setItem('tether.run.comments.r1', '{nope');
    expect(loadComments('r1')).toEqual([]);
  });
});
