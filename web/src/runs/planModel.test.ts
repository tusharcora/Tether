import { describe, expect, it } from 'vitest';
import { makeAwaitingRun, makeRun } from '../test/fixtures';
import { costLine, planRows } from './planModel';

const run = () => {
  const base = makeRun();
  return makeRun({
    pipeline: { ...base.pipeline, nodes: [...base.pipeline.nodes, { id: 'ship', kind: 'approval', title: 'Open a PR', x: 780, y: 0 }] },
    nodes: {
      ...base.nodes,
      plan: { status: 'done', attempts: 1, costUsd: 0.05, loops: 0, startedAt: 1000, finishedAt: 43_000 },
      code: { status: 'running', attempts: 1, costUsd: 0.07, loops: 0, live: '[tool] Read src/limit.ts\n[tool] Edit src/limit.ts\nRaising the probe timeout\n[tool] Bash npm test\n' },
    },
  });
};

describe('planRows', () => {
  it('lists the steps in order: done with its time, the current one with its newest events, pending dimmed, the approval as a gate', () => {
    const rows = planRows(run());
    expect(rows.map((r) => [r.title, r.state, r.right])).toEqual([
      ['planner', 'done', '42.0s'],
      ['coder', 'live', 'Writing'],
      ['gate', 'todo', undefined],
      ['Open a PR', 'gate', 'Asks first'],
    ]);
    expect(rows[1]!.subs).toEqual([
      { text: 'Edit src/limit.ts', newest: false },
      { text: 'Raising the probe timeout', newest: false },
      { text: 'Run npm test', newest: true },
    ]);
    expect(rows[0]!.subs).toEqual([]);
  });

  it('says a gate is testing, a step that waits needs you, and a failed one failed', () => {
    const r = makeRun({ nodes: { plan: { status: 'error', attempts: 1, costUsd: 0, loops: 0 }, code: { status: 'skipped', attempts: 0, costUsd: 0, loops: 0 }, gate: { status: 'running', attempts: 1, costUsd: 0, loops: 0 } } });
    expect(planRows(r).map((x) => [x.state, x.right])).toEqual([['failed', 'Failed'], ['skipped', 'Skipped'], ['live', 'Testing']]);
    expect(planRows(makeAwaitingRun()).at(-1)).toMatchObject({ title: 'Ship it', state: 'waiting', right: 'Needs you' });
  });
});

describe('costLine', () => {
  it('shows spend so far against the cap when there is one', () => {
    const r = makeRun({ costUsd: 1.4 });
    expect(costLine(r)).toBe('$1.40');
    expect(costLine({ ...r, pipeline: { ...r.pipeline, settings: { ...r.pipeline.settings, maxCostUsd: 5 } } })).toBe('$1.40 of $5.00');
    expect(costLine({ ...r, kind: 'team', team: { maxRounds: 3, yes: false, budgetUsd: 2 } })).toBe('$1.40 of $2.00');
  });
});
