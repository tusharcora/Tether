import { describe, expect, it } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { attentionFor } from '../src/attention.js';
import { AutoFix, autoFixRefusal } from '../src/autofix.js';
import { link } from '../src/bindings.js';
import { writePipeline } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { Goals } from '../src/goals/loop.js';
import { savePrefs } from '../src/prefs.js';
import { Store } from '../src/store.js';
import type { AgentRequest, AgentResult, PipelineNode, RunState } from '../src/types.js';
import { initWorkspace } from '../src/workspace.js';
import { makeRepo, pipe, tmp } from './helpers.js';

/** The assistant's agent for the diagnose turn: scripted guidance, read-only, prompts kept. */
class Doctor extends MockAdapter {
  override readonly id = 'doctor' as never;
  prompts: { prompt: string; readOnly: boolean }[] = [];
  constructor(private reply: Record<string, unknown> = { guidance: '1. Add the missing test. 2. Run it.' }) {
    super();
  }
  override async run(req: AgentRequest): Promise<AgentResult> {
    this.prompts.push({ prompt: req.prompt, readOnly: req.readOnly });
    return { output: JSON.stringify(this.reply), exitCode: 0, costUsd: 0 };
  }
}
const strong = () => Object.assign(new MockAdapter(), { id: 'strong' }) as MockAdapter;

function rig(o: { reply?: Record<string, unknown>; prefs?: Parameters<typeof savePrefs>[1] } = {}) {
  const home = tmp('home-');
  if (o.prefs) savePrefs(home, o.prefs);
  const doctor = new Doctor(o.reply);
  const mock = new MockAdapter();
  const registry = new AdapterRegistry().register(mock).register(strong()).register(doctor);
  link(home, 'orchestrator', { agent: 'doctor' });
  link(home, 'escalate', { agent: 'strong', model: 'big' });
  const store = Store.open(':memory:');
  // planning and managers run on the mock; the diagnose turn on the doctor (the assistant's agent, from bots.json)
  const engine = new Engine(store, { home, registry, reflectTimeoutMs: 10, bindings: () => ({ orchestrator: { agent: 'mock' }, manager: { agent: 'mock' } }) });
  const autofix = new AutoFix({ home, store, engine, registry });
  /** Until the run and every auto-fix round are over. */
  const settle = async (id: string) => {
    for (let i = 0; i < 40; i++) {
      await engine.wait(id);
      await autofix.idle();
      if (!engine.isLive(id) && !autofix.busy(id)) break;
    }
    return store.state(id)!;
  };
  const types = (id: string) => store.events(id).map((e) => e.event.type).filter((t) => t.startsWith('autofix.'));
  return { home, store, engine, autofix, doctor, mock, registry, settle, types };
}
const failing = (failFirst: number, extra: Partial<PipelineNode> = {}) => pipe([{ id: 'code', role: 'coder', mock: { failFirst, writeFile: { path: 'A.md', content: 'x' } } as never, ...extra }], []);
const attention = (store: Store, id: string, live = false) => attentionFor({ state: store.state(id)!, events: store.eventsNoChunks(id), live, lastTs: store.lastTs(id) });

describe('auto-fix in the app', () => {
  it('round 1 diagnoses read-only, attaches the guidance to the failed step and retries it', async () => {
    const t = rig();
    const id = await t.engine.start({ pipeline: failing(1), task: 'do it', repo: makeRepo(), workspace: false });
    const s = await t.settle(id);
    expect(s.status).toBe('done');
    expect(t.types(id)).toEqual(['autofix.started', 'autofix.round']);
    expect(t.doctor.prompts).toHaveLength(1);
    expect(t.doctor.prompts[0]!.readOnly).toBe(true);
    expect(t.doctor.prompts[0]!.prompt).toContain('mock failure (attempt 1)');
    expect(s.pipeline.nodes[0]!.guidance).toContain('Add the missing test');
    expect(t.mock.calls.filter((c) => c.nodeId === 'code')[1]!.prompt).toContain('Add the missing test');
    expect(s.autofix).toMatchObject({ round: 1, of: 3 });
  });

  it('round 2 escalates the failing step to the stronger link, then retries', async () => {
    const t = rig();
    const id = await t.engine.start({ pipeline: failing(2), task: 'do it', repo: makeRepo(), workspace: false });
    const s = await t.settle(id);
    expect(s.status).toBe('done');
    expect(s.autofix!.rounds.map((r) => r.action)).toEqual(['retry', 'escalate']);
    expect(s.pipeline.nodes[0]).toMatchObject({ agent: 'strong', model: 'big' });
    expect(t.doctor.prompts).toHaveLength(1); // only round 1 diagnoses
  });

  it('gives up after its rounds with a Needs you item that says why, and offers Retry / Open', async () => {
    const t = rig({ prefs: { autoFixRounds: 2 } });
    const id = await t.engine.start({ pipeline: failing(99), task: 'do it', repo: makeRepo(), workspace: false });
    const s = await t.settle(id);
    expect(s.status).toBe('error');
    expect(t.types(id)).toEqual(['autofix.started', 'autofix.round', 'autofix.round', 'autofix.gave_up']);
    expect(t.autofix.pending(id)).toBe(false);
    const [item] = attention(t.store, id);
    expect(item).toMatchObject({ kind: 'failed', actions: ['retry', 'open'] });
    expect(item!.title).toMatch(/^Auto-fix gave up after 2 rounds: /);
    // a person's retry starts a fresh cycle when it fails again
    await t.engine.resume(id, { retryFailed: true });
    await t.settle(id);
    expect(t.types(id).filter((x) => x === 'autofix.started')).toHaveLength(2);
  });

  it('stops when there is nothing stronger to try', async () => {
    const t = rig();
    const id = await t.engine.start({ pipeline: failing(99, { agent: 'strong', model: 'big' }), task: 'do it', repo: makeRepo(), workspace: false });
    const s = await t.settle(id);
    expect(s.autofix!.gaveUp).toMatch(/nothing stronger/);
    expect(attention(t.store, id)[0]!.title).toMatch(/^Auto-fix gave up after 1 round: .*nothing stronger/);
  });

  it('is off when the setting is off', async () => {
    const t = rig({ prefs: { autoFix: false } });
    const id = await t.engine.start({ pipeline: failing(1), task: 'do it', repo: makeRepo(), workspace: false });
    const s = await t.settle(id);
    expect(s.status).toBe('error');
    expect(t.types(id)).toEqual([]);
    expect(attention(t.store, id)[0]!.title).toBe('Failed');
  });

  it('never touches a run a person rejected', async () => {
    const t = rig();
    const p = pipe([{ id: 'code', role: 'coder' }, { id: 'ok', kind: 'approval' }], [['code', 'ok']]);
    const id = await t.engine.start({ pipeline: p, task: 'do it', repo: makeRepo(), workspace: false });
    await t.engine.wait(id);
    t.engine.approve(id, 'ok', false);
    await t.engine.resume(id);
    const s = await t.settle(id);
    expect(s.status).toBe('error');
    expect(t.types(id)).toEqual([]);
  });

  it('refuses probes, spend-cap stops with caps on, stopped runs and runs whose worktree is gone', () => {
    const base = { status: 'error', workdir: tmp(), nodes: { a: { status: 'error', attempts: 1, costUsd: 0, loops: 0 } }, pipeline: { nodes: [{ id: 'a', kind: 'agent' }] } } as unknown as RunState;
    expect(autoFixRefusal(base)).toBeUndefined();
    expect(autoFixRefusal({ ...base, probe: { id: 'p', side: 'baseline' } as never })).toMatch(/probe/);
    expect(autoFixRefusal({ ...base, budgetStop: true, capsOn: true })).toMatch(/spending cap/);
    expect(autoFixRefusal({ ...base, budgetStop: true, capsOn: false })).toBeUndefined();
    expect(autoFixRefusal({ ...base, status: 'stopped' })).toBeDefined();
    expect(autoFixRefusal({ ...base, workdir: '/nonexistent/wt' })).toMatch(/worktree/);
  });

  it("a goal's run that auto-fixes counts as one run item", async () => {
    const home = tmp('home-');
    const repo = makeRepo();
    const ws = initWorkspace(home, repo).workspace;
    const registry = new AdapterRegistry().register(new MockAdapter()).register(new Doctor());
    link(home, 'orchestrator', { agent: 'doctor' });
    const store = Store.open(':memory:');
    const engine = new Engine(store, { home, registry, reflectTimeoutMs: 10 });
    // auto-fix listens before the goal loop, as in the server
    const autofix = new AutoFix({ home, store, engine, registry });
    writePipeline(home, pipe([{ id: 'code', role: 'coder', mock: { failFirst: 1, writeFile: { path: 'done.txt', content: 'ok\n' } } as never }], []));
    const goals = new Goals({ home, store, engine, registry, autofixing: (id) => autofix.pending(id) });
    const g = goals.create({ id: 'g1', workspace: ws.id, title: 'Add done.txt', kind: 'loop', status: 'active', check: { kind: 'command', command: 'test -f done.txt' }, maxRuns: 3, approval: 'auto', workflow: 'test', createdAt: Date.now(), spentUsd: 0 });
    for (let i = 0; i < 300 && goals.db.must(g.id).status !== 'met'; i++) {
      await goals.idle();
      await autofix.idle();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(goals.db.must(g.id).status).toBe('met');
    const runs = goals.db.items(g.id).filter((i) => i.kind === 'run');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.attempt?.runStatus).toBe('done');
  });

  it('a read-only team run whose failure needs edits asks once to allow edits, then retries with them', async () => {
    const t = rig({ reply: { guidance: 'Edit README.md in place.', needsWrites: true } });
    const writes = { id: 'writes', ask: 'w', options: [{ id: 'yes', label: 'y' }, { id: 'no', label: 'n' }], recommended: 'yes' };
    const lead = { replies: { plan: [JSON.stringify({ tasks: [{ id: 'a', to: 'coder', goal: 'update the readme' }] })], review: [JSON.stringify({ decision: 'accept' })] }, spawned: { a: { failFirst: 1 } } };
    const id = await t.engine.startTeam({ task: 'Update README.md', repo: makeRepo(), workspace: false, roster: ['coder'], mock: { questions: [[writes]], plan: { goal: 'g', assignments: [{ bot: 'coder', goal: 'c', mode: 'read' }] }, ...lead } as never });
    await t.engine.answerPlan(id, [{ question: 'writes', option: 'no', by: 'user' }]);
    expect(t.store.state(id)!.plan!.limits.allowWrites).toBe(false);
    await t.engine.approveTeamPlan(id, true);
    let s = await t.settle(id);
    expect(s.status).toBe('error');
    expect(s.autofix?.needsWrites).toBeTruthy();
    expect(t.autofix.pending(id)).toBe(true);
    const item = attention(t.store, id, true).find((i) => i.kind === 'autofix_writes');
    expect(item).toMatchObject({ title: expect.stringMatching(/^Allow edits and retry\?/), actions: ['allow_edits', 'open'] });
    await t.autofix.allowEdits(id);
    s = await t.settle(id);
    expect(s.pipeline.settings.allowWrites).toBe(true);
    expect(s.plan!.limits.allowWrites).toBe(true);
    expect(s.status).toBe('done');
    expect(t.types(id).filter((x) => x === 'autofix.needs_writes')).toHaveLength(1);
  });
});

describe('a retry gives a manager\'s review loop a fresh budget', () => {
  it('redos are counted since the last retry', async () => {
    const home = tmp('home-');
    const mock = new MockAdapter();
    const store = Store.open(':memory:');
    const engine = new Engine(store, { home, registry: new AdapterRegistry().register(mock), reflectTimeoutMs: 10 });
    const redo = JSON.stringify({ redo: [{ id: 'a', reason: 'still failing' }] });
    const lead = { id: 'lead', role: 'planner', readOnly: true, manager: true, roster: ['coder'], mock: { replies: { plan: [JSON.stringify({ tasks: [{ id: 'a', to: 'coder', goal: 'g' }] })], review: [redo] }, spawned: { a: { failFirst: 4 } } } } as Partial<PipelineNode>;
    const id = await engine.start({ pipeline: pipe([lead], []), task: 't', repo: makeRepo(), workspace: false });
    let s = await engine.wait(id);
    expect(s.status).toBe('error');
    expect(s.nodes['lead-a']!.attempts).toBe(3); // first try + 2 redos
    await engine.resume(id, { retryFailed: true });
    s = await engine.wait(id);
    expect(s.nodes['lead-a']!.attempts).toBe(6); // retried, then redone twice more on a fresh budget
    expect(s.status).toBe('done');
  });
});
