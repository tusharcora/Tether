import { describe, expect, it } from 'vitest';
import type { PipelineNode } from '../src/types.js';
import { makeRepo, pipe, setup } from './helpers.js';

const texts = (s: { notices?: { text: string }[] }) => (s.notices ?? []).map((n) => n.text);

describe('no silent failures: refused, skipped, cut or degraded work says why on the run page', () => {
  it('a refused hand-off ("unknown bot") is a run notice, not only a log line', async () => {
    const { engine } = setup();
    const p = pipe([{ id: 'w', role: 'planner', readOnly: true, mock: { replies: {}, output: 'done\n@HAND ghost: do it' } }], [], { handoff: 1 });
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo(), workspace: false });
    const s = await engine.wait(id);
    expect(texts(s).find((t) => t.startsWith('w could not hand work to ghost: unknown bot'))).toBeTruthy();
    expect(s.notices![0]!.node).toBe('w');
  });

  it('a question to a step that is not there, and long text passed on as a file, are said', async () => {
    const { engine } = setup();
    const p = pipe(
      [
        { id: 'plan', role: 'planner', readOnly: true, mock: { output: `S${'p'.repeat(30_000)}E` } },
        { id: 'code', role: 'coder', mock: { output: 'Wrote it.\n@ASK nobody: why?' } },
      ],
      [['plan', 'code']],
      { consult: 1 },
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo(), workspace: false });
    const s = await engine.wait(id);
    expect(texts(s)).toContain('code asked "nobody", which is not a finished step; it carried on without an answer');
    expect(texts(s).some((t) => /^long text \(\d[\d,]* more characters\) reached code as a file it was told to read: \S+\.txt$/.test(t))).toBe(true);
  });

  it("a manager's ignored redo is said", async () => {
    const J = JSON.stringify;
    const lead = { id: 'lead', role: 'planner', readOnly: true, manager: true, roster: ['coder'], mock: { replies: { plan: [J({ tasks: [{ id: 'a', to: 'coder', goal: 'g' }] })], review: [J({ redo: [{ id: 'a', reason: 'again' }] })] } } } as Partial<PipelineNode>;
    const { engine } = setup();
    const id = await engine.start({ pipeline: pipe([lead], []), task: 't', repo: makeRepo(), workspace: false });
    const s = await engine.wait(id);
    expect(texts(s)).toContain('lead: redo of lead-a ignored: it was already sent back 2 times');
  });
});
