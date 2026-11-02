import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../src/adapters/index.js';
import { MockAdapter } from '../src/adapters/mock.js';
import { Attempts } from '../src/attempts.js';
import { autoFixRefusal } from '../src/autofix.js';
import { Engine } from '../src/engine.js';
import { Goals } from '../src/goals/loop.js';
import type { Goal } from '../src/goals/types.js';
import { Store } from '../src/store.js';
import { clearTrust, setTrust, trustState } from '../src/trust.js';
import type { AgentAdapter, AgentRequest, AgentResult } from '../src/types.js';
import { initWorkspace } from '../src/workspace.js';
import { pipe, plainFolder, tmp } from './helpers.js';
import { rig } from './teams-rig.js';

const SAID = "This folder isn't trusted, so the check didn't run.";
const GIT_WORDS = /\b(git|branch|merge|commit|repository)\b/i;

class Recording implements AgentAdapter {
  readonly id = 'rec';
  readonly reportsCost = false;
  readonly supportsResume = false;
  prompts: string[] = [];
  async detect() {
    return { ok: true };
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    this.prompts.push(req.prompt);
    return { output: 'Done.', exitCode: 0 };
  }
}

function world() {
  const home = tmp('home-');
  const rec = new Recording();
  const registry = new AdapterRegistry().register(new MockAdapter()).register(rec);
  const store = Store.open(':memory:');
  const engine = new Engine(store, { home, registry });
  const folder = plainFolder({ 'a.txt': 'one\n' });
  const marker = join(tmp('marks-'), 'ran');
  return { home, rec, registry, store, engine, folder, marker };
}

const withGate = (marker: string) =>
  pipe(
    [
      { id: 'work', kind: 'agent', role: 'coder', agent: 'mock' },
      { id: 'check', kind: 'gate', command: `touch ${marker}`, fixNode: 'work', maxLoops: 2 },
    ],
    [['work', 'check']],
  );

describe('a run started without commands (Not now)', () => {
  it('Try more ways keeps Not now: the sibling runs no gate or setup, is not done, and the folder stays unknown', async () => {
    const w = world();
    const setupMark = join(tmp('marks-'), 'setup');
    const p = pipe(withGate(w.marker).nodes, [['work', 'check']], { setup: `touch ${setupMark}` });
    const id = await w.engine.start({ pipeline: p, task: 'x', repo: w.folder, noCommands: true });
    await w.engine.wait(id);
    const attempts = new Attempts({ home: w.home, store: w.store, engine: w.engine, registry: w.registry, ship: { decide: async () => {} } });
    const [sib] = await attempts.start(id, { count: 1, agents: [{ agent: 'mock' }] });
    await w.engine.wait(sib!);
    expect(existsSync(w.marker)).toBe(false);
    expect(existsSync(setupMark)).toBe(false);
    const s = w.store.state(sib!)!;
    expect(s.noCommands).toBe(true);
    expect(s.status).not.toBe('done');
    expect(trustState(w.home, w.folder)).toBe('unknown');
  });

  it('a gate does not run and does not pass; the folder stays unasked, and the next run is not held back', async () => {
    const w = world();
    const id = await w.engine.start({ pipeline: withGate(w.marker), task: 'x', repo: w.folder, noCommands: true });
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(false);
    const s = w.store.state(id)!;
    expect(s).toMatchObject({ status: 'stopped', error: SAID, noCommands: true });
    expect(s.nodes.check).toMatchObject({ status: 'error', error: SAID });
    expect(trustState(w.home, w.folder)).toBe('unknown');
    const next = await w.engine.start({ pipeline: withGate(w.marker), task: 'x', repo: w.folder });
    await w.engine.wait(next);
    expect(existsSync(w.marker)).toBe(true);
    expect(w.store.state(next)!.status).toBe('done');
  });

  it('a plain resume changes nothing until the folder says yes, then picks it up; forgetting a no is not a yes', async () => {
    const w = world();
    const id = await w.engine.start({ pipeline: withGate(w.marker), task: 'x', repo: w.folder, noCommands: true });
    await w.engine.wait(id);
    await w.engine.resume(id);
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(false);
    expect(w.store.state(id)).toMatchObject({ status: 'stopped', error: SAID });
    setTrust(w.home, w.folder, false);
    clearTrust(w.home, w.folder);
    await w.engine.resume(id);
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(false);
    setTrust(w.home, w.folder, true);
    await w.engine.resume(id);
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(true);
    expect(w.store.state(id)).toMatchObject({ status: 'done', error: undefined });
    expect(w.store.state(id)!.nodes.work!.attempts).toBe(1);
  });

  it('setup is skipped, and runs on a resume after a yes', async () => {
    const w = world();
    const gate = join(tmp('marks-'), 'gate');
    const pipeline = { ...withGate(gate), settings: { ...withGate(gate).settings, setup: `touch ${w.marker}` } };
    const id = await w.engine.start({ pipeline, task: 'x', repo: w.folder, noCommands: true });
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(false);
    expect(w.store.events(id).find((e) => e.event.type === 'setup.result')!.event).toMatchObject({ ok: false, skipped: true });
    setTrust(w.home, w.folder, true);
    await w.engine.resume(id);
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(true);
    expect(existsSync(gate)).toBe(true);
    expect(w.store.state(id)).toMatchObject({ status: 'done', setupDone: true });
  });

  it('a folder already trusted runs its gate: the flag only holds until a yes', async () => {
    const w = world();
    setTrust(w.home, w.folder, true);
    const id = await w.engine.start({ pipeline: withGate(w.marker), task: 'x', repo: w.folder, noCommands: true });
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(true);
    expect(w.store.state(id)!.status).toBe('done');
  });

  it('a fork and a rewind keep it', async () => {
    const w = world();
    const id = await w.engine.start({ pipeline: withGate(w.marker), task: 'x', repo: w.folder, noCommands: true });
    await w.engine.wait(id);
    const fork = await w.engine.fork(id, 'work');
    await w.engine.wait(fork);
    expect(w.store.state(fork)).toMatchObject({ noCommands: true, status: 'stopped', error: SAID });
    await w.engine.rewind(id, 'work');
    expect(w.store.state(id)!.noCommands).toBe(true);
    await w.engine.resume(id);
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(false);
    expect(w.store.state(id)).toMatchObject({ status: 'stopped', error: SAID });
  });
});

describe('a folder that said no', () => {
  it('a gate does not run, does not pass and does not loop: the run stops and says why', async () => {
    const w = world();
    setTrust(w.home, w.folder, false);
    const id = await w.engine.start({ pipeline: withGate(w.marker), task: 'x', repo: w.folder });
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(false);
    const s = w.store.state(id)!;
    expect(s.status).toBe('stopped');
    expect(s.error).toBe(SAID);
    expect(s.error).not.toMatch(GIT_WORDS);
    expect(s.nodes.check).toMatchObject({ status: 'error', error: SAID });
    expect(s.nodes.work!.attempts).toBe(1);
    expect(w.store.events(id).some((e) => e.event.type === 'loop')).toBe(false);
    expect(autoFixRefusal(s)).toBeTruthy();
  });

  it('after a yes, a plain resume runs the gate and the run finishes', async () => {
    const w = world();
    setTrust(w.home, w.folder, false);
    const id = await w.engine.start({ pipeline: withGate(w.marker), task: 'x', repo: w.folder });
    await w.engine.wait(id);
    setTrust(w.home, w.folder, true);
    await w.engine.resume(id);
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(true);
    expect(w.store.state(id)).toMatchObject({ status: 'done', error: undefined });
    expect(w.store.state(id)!.nodes.work!.attempts).toBe(1);
  });

  it('a resume that withdrew the answer runs too; one that did not stops again with the same text and runs nothing', async () => {
    const w = world();
    setTrust(w.home, w.folder, false);
    const id = await w.engine.start({ pipeline: withGate(w.marker), task: 'x', repo: w.folder });
    await w.engine.wait(id);
    await w.engine.resume(id);
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(false);
    expect(w.store.state(id)).toMatchObject({ status: 'stopped', error: SAID });
    expect(w.store.state(id)!.nodes.work!.attempts).toBe(1);
    clearTrust(w.home, w.folder);
    await w.engine.resume(id);
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(true);
    expect(w.store.state(id)!.status).toBe('done');
  });

  it('after a yes, a plain resume runs the setup that was skipped; still refused, it stays skipped', async () => {
    const w = world();
    const gate = join(tmp('marks-'), 'gate');
    setTrust(w.home, w.folder, false);
    const pipeline = { ...withGate(gate), settings: { ...withGate(gate).settings, setup: `touch ${w.marker}` } };
    const id = await w.engine.start({ pipeline, task: 'x', repo: w.folder });
    await w.engine.wait(id);
    await w.engine.resume(id);
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(false);
    expect(w.store.state(id)!.status).toBe('stopped');
    setTrust(w.home, w.folder, true);
    await w.engine.resume(id);
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(true);
    expect(existsSync(gate)).toBe(true);
    expect(w.store.state(id)).toMatchObject({ status: 'done', setupDone: true });
    expect(w.store.state(id)!.setupSkipped).toBeFalsy();
  });

  it('an unknown folder’s gate and a trusted folder’s gate still run', async () => {
    for (const trust of [undefined, true]) {
      const w = world();
      if (trust) setTrust(w.home, w.folder, trust);
      const id = await w.engine.start({ pipeline: withGate(w.marker), task: 'x', repo: w.folder });
      await w.engine.wait(id);
      expect(existsSync(w.marker)).toBe(true);
      expect(w.store.state(id)!.status).toBe('done');
    }
  });

  it('setup is skipped, and the step is told it did not run', async () => {
    const w = world();
    setTrust(w.home, w.folder, false);
    const id = await w.engine.start({ pipeline: pipe([{ id: 'work', kind: 'agent', role: 'coder', agent: 'rec' }], [], { setup: `touch ${w.marker}` }), task: 'x', repo: w.folder });
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(false);
    expect(w.store.state(id)!.status).toBe('done');
    expect(w.rec.prompts[0]).toContain("The project's setup command didn't run");
    expect(w.store.events(id).find((e) => e.event.type === 'setup.result')!.event).toMatchObject({ ok: false, skipped: true });
  });

  it('an unknown folder’s setup still runs', async () => {
    const w = world();
    const id = await w.engine.start({ pipeline: pipe([{ id: 'work', kind: 'agent', role: 'coder', agent: 'rec' }], [], { setup: `touch ${w.marker}` }), task: 'x', repo: w.folder });
    await w.engine.wait(id);
    expect(existsSync(w.marker)).toBe(true);
    expect(w.rec.prompts[0]).not.toContain("The project's setup command didn't run");
  });

  it('a goal’s check does not run, is not met, and starts no runs', async () => {
    const w = world();
    const ws = initWorkspace(w.home, w.folder).workspace;
    setTrust(w.home, w.folder, false);
    const goals = new Goals({ home: w.home, store: w.store, engine: w.engine, registry: w.registry });
    const base: Goal = { id: 'g1', workspace: ws.id, title: 'Pass', kind: 'loop', status: 'active', check: { kind: 'tests', command: `touch ${w.marker}` }, approval: 'auto', workflow: 'team', createdAt: 1, spentUsd: 0 };
    goals.create(base);
    for (let i = 0; i < 100 && goals.db.must('g1').status === 'active'; i++) await new Promise((r) => setTimeout(r, 10));
    expect(goals.db.must('g1')).toMatchObject({ status: 'stopped', reason: SAID, lastCheck: { ok: false, tail: SAID } });
    expect(w.store.list()).toHaveLength(0);
    // a ticket's check by hand: unmet, with the same reason, and the ticket stays as it was
    goals.create({ ...base, id: 'g2', kind: 'tracker', status: 'paused' });
    expect(await goals.check('g2')).toMatchObject({ status: 'paused', lastCheck: { ok: false, tail: SAID } });
    expect(existsSync(w.marker)).toBe(false);
  });

  it('a squad’s gate does not run: no ship card, and the squad says why', async () => {
    const r = rig();
    setTrust(r.home, r.repo, false);
    const runId = await r.runTask('@Bolt fix the thing');
    await r.engine.wait(runId);
    await r.idle();
    const s = r.store.state(runId)!;
    expect(s.status).toBe('stopped');
    expect(s.nodes.tests).toMatchObject({ status: 'error', error: SAID });
    expect(s.nodes.ship!.status).not.toBe('done');
    expect(r.card('approval')).toBeUndefined();
    expect(r.calls.find((c) => c[1] === 'merge')).toBeUndefined();
    expect(r.msgs().some((m) => /this folder isn't trusted/i.test(m.text))).toBe(true);
  });
});
