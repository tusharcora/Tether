import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { Engine } from '../src/engine.js';
import { buildPrompt } from '../src/prompt.js';
import { diagnose, failureKey, fallbackChoices, parseChoices, perform } from '../src/runchat.js';
import { blankSession, listSessions, loadSession, rememberLast, lastSessionId, saveSession } from '../src/sessions.js';
import { Store } from '../src/store.js';
import { makeRepo, pipe, tmp } from './helpers.js';

function rig() {
  const registry = new AdapterRegistry().register(new MockAdapter());
  const store = Store.open(':memory:');
  const engine = new Engine(store, { home: tmp('home-'), registry });
  return { engine, store, registry };
}
const failing = (engine: Engine, failFirst: number) =>
  engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { failFirst, writeFile: { path: 'A.md', content: 'x' } } as never }], []), task: 'do it', repo: makeRepo() });

describe('run conversations', () => {
  it('validates options against the real run and drops the rest', async () => {
    const { engine, store } = rig();
    const id = await failing(engine, 99);
    await engine.wait(id);
    const s = store.state(id)!;
    const ok = parseChoices(
      [
        { label: 'Retry', action: { type: 'retry' } },
        { label: 'Tighten', detail: 'x', action: { type: 'guide', node: 'code', guidance: 'be small' } },
        { label: 'Bad node', action: { type: 'guide', node: 'nope', guidance: 'x' } },
        { label: 'Bad agent', action: { type: 'escalate', node: 'code', agent: 'gpt-9000' } },
        { label: 'Shell', action: { type: 'run', cmd: 'rm -rf /' } },
        { label: 'Stop a failed run', action: { type: 'stop' } },
      ],
      s,
      ['mock', 'claude'],
    );
    expect(ok.map((o) => o.action.type)).toEqual(['retry', 'guide']);
  });

  it('falls back to rules when there is no model, and recommends a retry', async () => {
    const { engine, store, registry } = rig();
    const id = await failing(engine, 99);
    await engine.wait(id);
    const s = store.state(id)!;
    const c = fallbackChoices(s, { agent: 'strong' });
    expect(c.options.map((o) => o.action.type)).toEqual(['retry', 'escalate', 'open']);
    const d = await diagnose(s, { registry, agent: 'nonexistent' });
    expect(d.options[0]!.action.type).toBe('retry');
    expect(failureKey(s)).toContain(id);
  });

  it('guidance is recorded, shown to the step, and the step is retried from where it stopped', async () => {
    const { engine, store } = rig();
    const id = await failing(engine, 1);
    await engine.wait(id);
    expect(store.state(id)!.status).toBe('error');
    await perform(engine, id, { type: 'guide', node: 'code', guidance: 'Make the smallest possible change.' });
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    const node = s.pipeline.nodes[0]!;
    expect(node.guidance).toBe('Make the smallest possible change.');
    expect(buildPrompt({ pipeline: s.pipeline, node, state: s })).toContain('Guidance from the person in charge');
  });

  it('refuses to change a step while the run is live', async () => {
    const { engine } = rig();
    const id = await engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { delayMs: 300 } as never }], []), task: 't', repo: makeRepo() });
    await expect(perform(engine, id, { type: 'guide', node: 'code', guidance: 'x' })).rejects.toThrow(/stop the run/);
    await engine.wait(id);
  });
});

describe('sessions', () => {
  it('saves, lists and restores a conversation, and remembers the last one', () => {
    const home = mkdtempSync(join(tmpdir(), 'aorch-s-'));
    const s = blankSession('run-abc', 'flow · abc', { runId: 'abc' });
    s.log.push({ k: 'you', text: 'hi' }, { k: 'choice', title: 't', options: [{ label: 'Retry', action: { type: 'retry' } }], recommended: 0, sel: 0, st: 'pending' });
    s.diagnosed.push('k1');
    saveSession(home, s);
    saveSession(home, blankSession('main', 'Tether'));
    rememberLast(home, 'run-abc');
    expect(listSessions(home).map((x) => x.id).sort()).toEqual(['main', 'run-abc']);
    const back = loadSession(home, 'run-abc')!;
    expect(back.log).toHaveLength(2);
    expect(back.diagnosed).toEqual(['k1']);
    expect(back.runId).toBe('abc');
    expect(lastSessionId(home)).toBe('run-abc');
    expect(loadSession(home, '../etc/passwd')).toBeUndefined();
  });
});
