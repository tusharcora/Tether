import type { Pipeline } from "../src/types.js";
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../src/adapters/index.js';
import { readPipeline } from '../src/config.js';
import { interpret, savePipeline } from '../src/maestro.js';

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), 'aorch-m-'));
  const repo = mkdtempSync(join(tmpdir(), 'aorch-r-'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
  return { home, repo, registry: defaultRegistry({}, {}) };
};

describe('Tether chat', () => {
  it('plain prose is just a reply', () => {
    const o = setup();
    expect(interpret('Sure, ask away.', o)).toMatchObject({ text: 'Sure, ask away.' });
  });

  it('a save intent becomes a checked proposal, and saving it keeps a backup on overwrite', () => {
    const o = setup();
    const r = interpret(JSON.stringify({ reply: 'Saved a bugfix flow.', intent: 'save', name: 'quick-fix', steps: ['coder', 'tester', { type: 'reviewer', prompt: 'be strict' }] }), o);
    expect(r.proposal?.kind).toBe('save');
    const p = r.proposal!.kind === 'save' ? r.proposal!.pipeline : undefined!;
    expect(p.nodes.map((n) => n.id)).toEqual(['coder', 'tests', 'review']);
    expect(p.nodes[2]!.prompt).toBe('be strict');
    expect(savePipeline(o.home, p)).toBeUndefined();
    expect(readPipeline(o.home, 'quick-fix').nodes).toHaveLength(3);
    const again = interpret(JSON.stringify({ reply: 'Tightened.', intent: 'optimize', name: 'quick-fix', steps: ['planner', 'coder', 'reviewer'] }), o);
    expect(again.proposal?.kind).toBe('optimize');
    const bk = savePipeline(o.home, (again.proposal as unknown as { pipeline: Pipeline }).pipeline);
    expect(bk).toContain('.backup');
    expect(readdirSync(join(o.home, 'pipelines', '.backup'))).toHaveLength(1);
  });

  it('refuses bad names, unknown steps, unknown workflows', () => {
    const o = setup();
    for (const bad of [
      { intent: 'save', name: '../evil', steps: ['coder'] },
      { intent: 'save', name: 'ok', steps: ['hacker'] },
      { intent: 'optimize', name: 'ghost', steps: ['coder'] },
      { intent: 'run', name: 'ghost', task: 'x' },
    ]) {
      const r = interpret(JSON.stringify({ reply: 'Okay.', ...bad }), o);
      expect(r.proposal).toBeUndefined();
      expect(r.text).toContain('could not use');
    }
  });

  it('drops a test gate when the repo has no test command', () => {
    const o = setup();
    const noTests = { ...o, repo: mkdtempSync(join(tmpdir(), 'aorch-n-')) };
    const r = interpret(JSON.stringify({ reply: 'ok', intent: 'save', name: 'x', steps: ['coder', 'tester'] }), noTests);
    expect(r.warnings.join()).toContain('dropped a test gate');
  });
});
