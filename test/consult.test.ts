import { describe, expect, it } from 'vitest';
import { answersBlock, parseAsks, stripAsks } from '../src/consult.js';
import { makeRepo, pipe, setup } from './helpers.js';

const two = (coder: Record<string, unknown>, settings: Record<string, unknown>) =>
  pipe(
    [
      { id: 'plan', role: 'planner', readOnly: true, mock: { output: 'PLAN: use a map, not an array', costUsd: 0.01 } },
      { id: 'code', role: 'coder', mock: { costUsd: 0.02, ...coder } },
    ],
    [['plan', 'code']],
    settings,
  );

describe('asking questions', () => {
  it('parses questions, including ones that continue on the next line', () => {
    const t = 'Done mostly.\n@ASK plan: why a map\nand not an array?\n\n@ask `review`: did you run the tests?';
    expect(parseAsks(t)).toEqual([{ target: 'plan', question: 'why a map and not an array?' }, { target: 'review', question: 'did you run the tests?' }]);
    expect(stripAsks(t)).toBe('Done mostly.');
    expect(parseAsks('no questions here')).toEqual([]);
    expect(answersBlock([{ to: 'plan', question: 'q', answer: 'a' }])).toMatch(/You asked plan: q\n\s+Answer: a/);
  });

  it('puts a question to a finished step and hands the answer back', async () => {
    const { engine, mock, store } = setup();
    const id = await engine.start({ pipeline: two({ output: 'Wrote it.\n@ASK plan: why a map?' }, { consult: 1 }), task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    const calls = mock.calls.filter((c) => c.nodeId === 'code');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.prompt).toMatch(/@ASK <step-id>/);
    expect(calls[0]!.prompt).toMatch(/Steps you can ask: plan/);
    expect(calls[1]!.prompt).toMatch(/Answers to your questions/);
    expect(calls[1]!.prompt).toMatch(/\(plan\) answer to: why a map/);
    const ask = mock.calls.find((c) => c.nodeId === 'plan.consult')!;
    expect(ask.readOnly).toBe(true);
    expect(ask.prompt).toMatch(/A teammate has a question/);
    expect(s.talk).toHaveLength(1);
    expect(s.talk![0]).toMatchObject({ from: 'code', to: 'plan', round: 1 });
    expect(s.nodes.code!.output).not.toMatch(/@ASK/);
    expect(store.events(id).some((e) => e.event.type === 'consult')).toBe(true);
  });

  it('is off unless the pipeline turns it on', async () => {
    const { engine, mock } = setup();
    const id = await engine.start({ pipeline: two({ output: 'x\n@ASK plan: why?' }, {}), task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(mock.calls.filter((c) => c.nodeId === 'code')).toHaveLength(1);
    expect(mock.calls.find((c) => c.nodeId === 'code')!.prompt).not.toMatch(/@ASK/);
    expect(s.talk ?? []).toHaveLength(0);
  });

  it('answers a question about a step that does not exist without failing', async () => {
    const { engine } = setup();
    const id = await engine.start({ pipeline: two({ output: 'x\n@ASK ghost: hello?' }, { consult: 1 }), task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(s.talk![0]!.answer).toMatch(/no finished step called "ghost".*plan/);
  });

  it('stops after the allowed rounds and bills the questions to the asker', async () => {
    const { engine, mock } = setup();
    const id = await engine.start({ pipeline: two({ output: 'x\n@ASK plan: again?' }, { consult: 2 }), task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(mock.calls.filter((c) => c.nodeId === 'code')).toHaveLength(3); // first try + one retry per round
    expect(s.talk).toHaveLength(2);
    expect(s.nodes.code!.costUsd).toBeGreaterThan(0.02);
    expect(s.nodes.code!.output).toBe('x');
  });

  it('a step cannot ask one that has not finished or itself', async () => {
    const { engine } = setup();
    const p = pipe([{ id: 'a', role: 'coder', mock: { output: 'hi\n@ASK a: me?\n@ASK b: you?' } }, { id: 'b', role: 'coder', mock: { output: 'b' } }], [['a', 'b']], { consult: 1 });
    const s = await engine.wait(await engine.start({ pipeline: p, task: 't', repo: makeRepo() }));
    expect(s.talk!.every((t) => /no finished step/.test(t.answer))).toBe(true);
  });

  it('a fixing step can ask the reviewer that sent it back', async () => {
    const { engine, mock } = setup();
    const p = pipe(
      [
        { id: 'code', role: 'coder', mock: { output: 'fixed?\n@ASK review: which line exactly?' } },
        { id: 'review', role: 'reviewer', readOnly: true, verdict: true, fixNode: 'code', mock: { verdicts: ['FAIL', 'PASS'], output: 'line 3 is wrong' } },
      ],
      [['code', 'review']],
      { consult: 1 },
    );
    const s = await engine.wait(await engine.start({ pipeline: p, task: 't', repo: makeRepo() }));
    expect(s.talk!.some((t) => t.from === 'code' && t.to === 'review')).toBe(true);
    expect(mock.calls.some((c) => c.nodeId === 'review.consult')).toBe(true);
  });
});
