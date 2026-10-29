import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { attentionFor } from '../src/attention.js';
import { Engine } from '../src/engine.js';
import type { AgentAdapter, AgentRequest, AgentResult } from '../src/types.js';
import { makeRepo, pipe, setup } from './helpers.js';

/** An agent on a free model: the first `limited` calls write a half-done file and run out of free requests; later ones finish. */
class FreeAgent implements AgentAdapter {
  readonly reportsCost = false;
  readonly supportsResume = false;
  readonly calls: { prompt: string; model?: string }[] = [];
  constructor(
    readonly id: string,
    private limited: number,
    private readonly resetsAt: number,
  ) {}
  async detect() {
    return { ok: true };
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    this.calls.push({ prompt: req.prompt, model: req.model });
    if (this.limited-- > 0) {
      writeFileSync(join(req.cwd, 'half.txt'), 'half done\n');
      return { output: '', exitCode: 1, error: 'Out of free requests until 00:00 · Switch model', limit: { resetsAt: this.resetsAt } };
    }
    writeFileSync(join(req.cwd, 'done.txt'), 'done\n');
    return { output: 'finished', exitCode: 0 };
  }
}

function freeRun(o: { limited?: number; resetsAt?: number } = {}) {
  const t = setup();
  const agent = new FreeAgent('openrouter', o.limited ?? 1, o.resetsAt ?? Date.now() + 3_600_000);
  t.registry.register(agent);
  const repo = makeRepo();
  const p = pipe([{ id: 'code', role: 'coder', agent: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' }, { id: 'review', role: 'reviewer', readOnly: true, mock: { output: 'ok' } }], [['code', 'review']]);
  return { ...t, agent, start: () => t.engine.start({ pipeline: p, task: 'add a toggle', repo }) };
}

describe('free daily limit', () => {
  it('pauses the run with the step awaiting, its edits kept, and one free_limit item', async () => {
    const { engine, store, agent, start } = freeRun();
    const id = await start();
    const s = await engine.wait(id);
    expect(s.status).toBe('paused');
    expect(s.nodes.code).toMatchObject({ status: 'awaiting', limit: { resetsAt: expect.any(Number) } });
    expect(s.nodes.review!.status).toBe('queued');
    expect(existsSync(join(s.workdir, 'half.txt'))).toBe(true);
    const sh = (...args: string[]) => execFileSync('git', args, { cwd: s.workdir, encoding: 'utf8' });
    expect(sh('log', '-1', '--format=%s')).toMatch(/code \(coder\) paused on the free limit/);
    expect(sh('status', '--porcelain')).toBe('');
    const items = attentionFor({ state: s, events: store.eventsNoChunks(id), live: false, lastTs: store.lastTs(id) });
    expect(items.map((i) => [i.kind, i.title, i.node])).toEqual([['free_limit', 'Out of free requests for today', 'code']]);
    expect(agent.calls).toHaveLength(1);
  });

  it('resumes the step where it stopped, telling it nothing was lost', async () => {
    const { engine, agent, start } = freeRun();
    const id = await start();
    await engine.wait(id);
    await engine.resume(id);
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(s.nodes.code!.limit).toBeUndefined();
    expect(agent.calls[1]!.prompt).toContain('Nothing you produced was discarded');
  });

  it('switches the paused step to another model for this run only', async () => {
    const { engine, store, agent, start } = freeRun();
    const id = await start();
    await engine.wait(id);
    await engine.resume(id, { switchTo: { agent: 'openrouter', model: 'recursive/flint-v1.0:free' } });
    expect((await engine.wait(id)).status).toBe('done');
    expect(agent.calls[1]!.model).toBe('recursive/flint-v1.0:free');
    expect(store.eventsNoChunks(id).some((e) => e.event.type === 'node.amended' && e.event.node === 'code' && e.event.model === 'recursive/flint-v1.0:free')).toBe(true);
  });

  it('a limited run that was stopped can be resumed and reruns the step', async () => {
    const { engine, start } = freeRun();
    const id = await start();
    await engine.wait(id);
    expect(engine.stop(id)).toBe(true);
    expect(engine.store.state(id)!.nodes.code!.status).toBe('queued');
    await engine.resume(id);
    expect((await engine.wait(id)).status).toBe('done');
  });

  it('resumes by itself once the free requests are back', async () => {
    const { engine, start } = freeRun({ resetsAt: Date.now() - 60_000 });
    const id = await start();
    // the timer armed at the pause fires at once (the reset is past): wait for the second pass to end
    for (let i = 0; i < 200 && engine.store.state(id)!.status !== 'done'; i++) await new Promise((r) => setTimeout(r, 25));
    expect(engine.store.state(id)!.status).toBe('done');
  });

  it('re-arms the timers of runs paused before the server started', async () => {
    const resetsAt = Date.now() + 3_600_000;
    const { engine, store, registry, home, start } = freeRun({ resetsAt });
    const id = await start();
    await engine.wait(id);
    // a new server process, started after the reset (this test's first engine still waits an hour)
    const again = new Engine(store, { home, registry });
    vi.useFakeTimers({ toFake: ['Date'], now: resetsAt + 60_000 });
    again.armLimitTimers();
    vi.useRealTimers();
    for (let i = 0; i < 200 && store.state(id)!.status !== 'done'; i++) await new Promise((r) => setTimeout(r, 25));
    expect(store.state(id)!.status).toBe('done');
  });
});
