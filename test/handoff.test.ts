import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePipeline, preflight } from '../src/pipeline.js';
import { foldRun, type PipelineNode, type RunState, type StoredEvent } from '../src/types.js';
import { briefing, buildPrompt } from '../src/prompt.js';
import { MockAdapter } from '../src/adapters/mock.js';
import { handNode, handoffBlock, limitsOf, parseHands, parsePlan, parseReview, planPrompt, reviewPrompt, rosterOf, stripHands, toNode, validateHand, validatePlan, PLAN_CAPS, type HandRequest, type PlanTask } from '../src/handoff.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';
import { refreshCrew, registerCrew } from '../src/bots.js';
import { BUILTIN_BOTS, crewWarnings, loadCrew, sanitizeBot, saveBot } from '../src/crew.js';
import { fromTemplate } from '../src/composer.js';
import { spawnedLabel, underManagers } from '../src/ui.js';
import { culprit } from '../src/supervisor.js';
import { fallbackChoices } from '../src/runchat.js';
import { describeEvent } from '../web/src/api.js';

const issues = (p: ReturnType<typeof pipe>, level: 'error' | 'warn') =>
  preflight(p).filter((i) => i.level === level).map((i) => i.message);

describe('spawned steps', () => {
  it('folds node.spawned into the pipeline, edges and node state', () => {
    const base = pipe([{ id: 'm' }, { id: 'a' }], []);
    const node: PipelineNode = { id: 's1', kind: 'agent', agent: 'mock', x: 0, y: 0 };
    const events = [
      { runId: 'r', ts: 1, event: { type: 'run.started', pipeline: base, task: 't', repo: '/r', workdir: '/w', baseSha: 'x', branch: 'b' } },
      { runId: 'r', ts: 2, event: { type: 'node.spawned', node, parent: 'm', depth: 1, after: ['a', 'm'] } },
    ] as unknown as StoredEvent[];
    const s = foldRun(events)!;
    expect(s.pipeline.nodes.map((n) => n.id)).toEqual(['m', 'a', 's1']);
    expect(s.pipeline.edges).toEqual([{ from: 'a', to: 's1' }, { from: 'm', to: 's1' }]);
    expect(s.nodes.s1!.status).toBe('queued');
    expect(s.spawned).toBe(1);
  });

  it('normalizes manager, roster and limits', () => {
    const p = normalizePipeline({
      name: 'x',
      nodes: [{ id: 'm', manager: true, roster: ['coder', 7, ''] }],
      settings: { maxDepth: 99, maxSpawn: 0, planApproval: true },
    });
    expect(p.nodes[0]!.manager).toBe(true);
    expect(p.nodes[0]!.roster).toEqual(['coder']);
    expect(p.settings.maxDepth).toBe(5);
    expect(p.settings.maxSpawn).toBe(1);
    expect(p.settings.planApproval).toBe(true);
    const q = normalizePipeline({ name: 'x', nodes: [{ id: 'm' }], settings: { maxDepth: 0, maxSpawn: 500 } });
    expect(q.settings.maxDepth).toBe(1);
    expect(q.settings.maxSpawn).toBe(30);
    const d = normalizePipeline({ name: 'x', nodes: [{ id: 'm' }] });
    expect(d.settings.maxDepth).toBeUndefined();
  });

  it('preflight checks managers and rosters', () => {
    expect(issues(pipe([{ id: 'g', kind: 'gate', command: 'true', manager: true }], []), 'error').join()).toMatch(/manager/);
    expect(issues(pipe([{ id: 'a', kind: 'approval', manager: true }], []), 'error').join()).toMatch(/manager/);
    expect(issues(pipe([{ id: 'm', manager: true, roster: ['coder', 'nope'] }], []), 'error').join()).toMatch(/roster.*nope/);
    expect(issues(pipe([{ id: 'm', manager: true, roster: ['coder'] }], []), 'error').join()).not.toMatch(/roster/);
    const w = issues(pipe([{ id: 'a' }, { id: 'm', manager: true, fixNode: 'a' }], [['a', 'm']]), 'warn');
    expect(w.join()).toMatch(/manager.*fixNode/);
  });
});

const task = (id: string, o: Partial<PlanTask> = {}): PlanTask => ({ id, to: 'coder', goal: 'do it', context: [], mode: 'read', after: [], ...o });
const mgr: PipelineNode = { id: 'lead', kind: 'agent', manager: true, x: 0, y: 0 };
const stateOf = (spawned = 0, extra: Partial<RunState> = {}) =>
  ({ ...foldRun([{ runId: 'r', ts: 1, event: { type: 'run.started', pipeline: pipe([{ id: 'lead' }, { id: 'a' }], []), task: 'the task', repo: '/r', workdir: '/w', baseSha: 'x', branch: 'b' } }] as unknown as StoredEvent[])!, spawned, ...extra }) as RunState;
const ok = (tasks: PlanTask[], o: { spawned?: number; allowWrite?: boolean; roster?: string[] } = {}) =>
  validatePlan(tasks, { manager: mgr, state: stateOf(o.spawned ?? 0), roster: o.roster ?? ['coder', 'reviewer'], allowWrite: o.allowWrite ?? true });

describe('parsePlan', () => {
  it('accepts JSON in prose and fences, with defaults', () => {
    const r = parsePlan('Here you go:\n```json\n{"tasks":[{"id":"a","to":"coder","goal":"g"}]}\n```\nthanks');
    expect(r).toEqual({ tasks: [{ id: 'a', to: 'coder', goal: 'g', expected: undefined, context: [], mode: 'read', after: [] }] });
  });
  it('keeps given fields', () => {
    const r = parsePlan('{"tasks":[{"id":"b","to":"coder","goal":"g","expected":"e","context":["a"],"mode":"write","after":["a"]}]}') as { tasks: PlanTask[] };
    expect(r.tasks[0]).toMatchObject({ expected: 'e', context: ['a'], mode: 'write', after: ['a'] });
  });
  it('errors on non-JSON and non-array tasks', () => {
    expect(parsePlan('no json here')).toHaveProperty('error');
    expect(parsePlan('{"tasks":"x"}')).toHaveProperty('error');
    expect(parsePlan('{"tasks":[{"id":"a"}]}')).toHaveProperty('error');
  });
});

describe('validatePlan', () => {
  it('accepts a good plan', () => expect(ok([task('a'), task('b', { after: ['a'], context: ['a'] })])).toBeUndefined());
  it('rejects zero tasks', () => expect(ok([])).toMatch(/no tasks/));
  it('rejects bad and duplicate ids', () => {
    expect(ok([task('bad id')])).toMatch(/id/);
    expect(ok([task('x'.repeat(31))])).toMatch(/id/);
    expect(ok([task('a'), task('a')])).toMatch(/duplicate/);
  });
  it('rejects unknown bot', () => expect(ok([task('a', { to: 'ghost' })])).toMatch(/unknown bot/));
  it('rejects empty goal', () => expect(ok([task('a', { goal: '  ' })])).toMatch(/goal/));
  it('rejects unknown after and cycles', () => {
    expect(ok([task('a', { after: ['zz'] })])).toMatch(/unknown/);
    expect(ok([task('a', { after: ['b'] }), task('b', { after: ['a'] })])).toMatch(/cycle/);
    expect(ok([task('a', { after: ['a'] })])).toMatch(/cycle/);
  });
  it('checks context ids', () => {
    expect(ok([task('a', { context: ['nope'] })])).toMatch(/context/);
    expect(ok([task('a', { context: ['a'] })])).toBeUndefined(); // existing pipeline step
    expect(ok([task('a'), task('b', { context: ['a'] })])).toBeUndefined(); // sibling
  });
  it('enforces the spawn budget', () => {
    expect(ok([task('a'), task('b')], { spawned: 11 })).toMatch(/spawn budget/);
    expect(ok([task('a')], { spawned: 11 })).toBeUndefined();
  });
  it('counts redos toward the spawn budget when given the used count', () => {
    expect(validatePlan([task('a'), task('b')], { manager: mgr, state: stateOf(0), roster: ['coder'], allowWrite: true, used: 11 })).toMatch(/spawn budget/);
    expect(validatePlan([task('a')], { manager: mgr, state: stateOf(0), roster: ['coder'], allowWrite: true, used: 11 })).toBeUndefined();
  });
  it('rejects write when not allowed', () => {
    expect(ok([task('a', { mode: 'write' })], { allowWrite: false })).toMatch(/write/);
    expect(ok([task('a', { mode: 'write' })])).toBeUndefined();
  });
});

describe('limitsOf / rosterOf', () => {
  it('applies defaults', () => {
    expect(limitsOf(pipe([{ id: 'm' }], []))).toEqual({ maxDepth: 3, maxSpawn: 12 });
    const p = pipe([{ id: 'm' }], []);
    p.settings = { ...p.settings, maxDepth: 2, maxSpawn: 5 };
    expect(limitsOf(p)).toEqual({ maxDepth: 2, maxSpawn: 5 });
  });
  it('uses the given roster, else the whole crew', () => {
    expect(rosterOf({ ...mgr, roster: ['coder'] })).toEqual(['coder']);
    const all = rosterOf(mgr);
    expect(all).toEqual(expect.arrayContaining(['planner', 'architect', 'coder', 'reviewer']));
    for (const x of ['tester', 'approval', 'manager']) expect(all).not.toContain(x);
    expect(rosterOf({ ...mgr, roster: [] })).toEqual(all);
  });
});

describe('toNode', () => {
  it('builds a spawned agent node with full ids', () => {
    const n = toNode(task('b', { after: ['a'], context: ['a', 'other'], mode: 'read' }), mgr, 1, 'mock', ['a', 'b']);
    expect(n).toMatchObject({ id: 'lead-b', kind: 'agent', role: 'coder', readOnly: true, agent: 'mock' });
    expect(n.spawn).toMatchObject({ parent: 'lead', depth: 1 });
    expect(n.spawn!.contract.after).toEqual(['lead-a']);
    expect(n.spawn!.contract.context).toEqual(['lead-a', 'other']);
    expect(toNode(task('c', { mode: 'write' }), mgr, 1).readOnly).toBe(false);
  });
});

describe('parseReview', () => {
  it('parses the three decisions', () => {
    expect(parseReview('ok {"decision":"accept"}')).toEqual({ accept: true });
    expect(parseReview('{"redo":[{"id":"a","reason":"bad"}]}')).toEqual({ redo: [{ id: 'a', reason: 'bad' }] });
    const m = parseReview('{"more":[{"id":"z","to":"coder","goal":"g"}]}') as { more: PlanTask[] };
    expect(m.more[0]).toMatchObject({ id: 'z', mode: 'read', context: [], after: [] });
  });
  it('errors on {} and garbage', () => {
    expect(parseReview('{}')).toHaveProperty('error');
    expect(parseReview('nope')).toHaveProperty('error');
    expect(parseReview('{"redo":[]}')).toHaveProperty('error');
  });
});

describe('prompts', () => {
  it('plan prompt lists task, roster, limits, shape and rejection', () => {
    const s = stateOf(2);
    const p = planPrompt(s, mgr, ['coder', 'reviewer'], 'unknown bot "x"');
    for (const w of ['the task', 'coder', 'reviewer', '"tasks"', 'unknown bot "x"', '10']) expect(p).toContain(w);
    expect(planPrompt(s, mgr, ['coder'])).not.toContain('rejected');
    expect(planPrompt(s, mgr, ['coder'])).toContain('at most 10 more');
    expect(planPrompt(s, mgr, ['coder'], undefined, 5)).toContain('at most 7 more'); // 2 spawned + 3 redos

  });
  it('plan prompt describes a bot by its when-to-use when it has one', () => {
    registerCrew([...BUILTIN_BOTS, { id: 'go-reviewer', name: 'Go', title: 'go', kind: 'verdict', readOnly: true, persona: '', look: BUILTIN_BOTS[0]!.look, source: 'ecc@v2.2.3', whenToUse: 'Use for Go\n  changes' }]);
    try {
      const p = planPrompt(stateOf(2), mgr, ['coder', 'go-reviewer']);
      expect(p).toContain('- go-reviewer (go): Use for Go changes');
      expect(p).toMatch(/- coder \([^)]*\): \S/); // a built-in keeps its step blurb
    } finally {
      registerCrew(BUILTIN_BOTS);
    }
  });
  it('review prompt shows children and clips output', () => {
    const s = stateOf();
    s.nodes['lead-a'] = { status: 'done', attempts: 1, costUsd: 0, loops: 0, output: 'y'.repeat(9000) };
    s.nodes['lead-b'] = { status: 'error', attempts: 1, costUsd: 0, loops: 0, error: 'boom' };
    const kids = [toNode(task('a', { expected: 'works' }), mgr, 1), toNode(task('b'), mgr, 1)];
    const p = reviewPrompt(s, mgr, kids, 1);
    expect(p).toContain('lead-a');
    expect(p).toContain('works');
    expect(p).toContain('boom');
    expect(p.length).toBeLessThan(7000);
  });
});

describe('spawned step prompts and scripted mock replies', () => {
  const spawnedPipeline = () => {
    const p = pipe(
      [{ id: 'a' }, { id: 'b' }, { id: 'lead', manager: true }, { id: 'lead-x' }],
      [['a', 'lead'], ['b', 'lead'], ['lead', 'lead-x']],
    );
    const node = p.nodes.find((n) => n.id === 'lead-x')!;
    node.spawn = {
      parent: 'lead',
      depth: 1,
      contract: { to: 'coder', goal: 'Write the parser', expected: 'EXPECTED-TEXT', context: ['b'], mode: 'read', after: [] },
    };
    return { p, node };
  };
  const finishedState = (p: ReturnType<typeof pipe>) => {
    const s = foldRun([{ runId: 'r', ts: 1, event: { type: 'run.started', pipeline: p, task: 'the task', repo: '/r', workdir: '/w', baseSha: 'x', branch: 'b' } }] as unknown as StoredEvent[])!;
    s.nodes.a = { status: 'done', attempts: 1, costUsd: 0, loops: 0, output: 'UNRELATED-OUT' };
    s.nodes.b = { status: 'done', attempts: 1, costUsd: 0, loops: 0, output: 'CONTEXT-OUT' };
    return s;
  };

  it('spawned step gets an assignment section and only context-selected upstream output', () => {
    const { p, node } = spawnedPipeline();
    const s = finishedState(p);
    const prompt = buildPrompt({ pipeline: p, node, state: s });
    expect(prompt).toContain('# Your assignment');
    expect(prompt).toContain('Write the parser');
    expect(prompt).toContain('EXPECTED-TEXT');
    expect(prompt).toContain('lead');
    expect(prompt.indexOf('# Your assignment')).toBeLessThan(prompt.indexOf('# Task'));
    expect(prompt).toContain('CONTEXT-OUT');
    expect(prompt).not.toContain('UNRELATED-OUT');
  });

  it('nodes without spawn get no assignment section and keep all ancestor output', () => {
    const { p } = spawnedPipeline();
    const plain = p.nodes.find((n) => n.id === 'lead')!;
    const s = finishedState(p);
    const prompt = buildPrompt({ pipeline: p, node: { ...plain, id: 'lead' }, state: s });
    expect(prompt).not.toContain('# Your assignment');
    expect(prompt).toContain('UNRELATED-OUT');
    expect(prompt).toContain('CONTEXT-OUT');
  });

  it('mock adapter returns scripted replies per phase, clamped to the last entry', async () => {
    const mock = new MockAdapter();
    const base = { runId: 'r', prompt: '', cwd: '/tmp', readOnly: true, timeoutMs: 1000, signal: new AbortController().signal, mock: { replies: { plan: ['A', 'B'] } }, onChunk: () => {}, onSession: () => {} };
    const out = async (nodeId: string, attempt: number) => (await mock.run({ ...base, nodeId, attempt })).output;
    expect(await out('x.plan', 1)).toBe('A');
    expect(await out('x.plan', 2)).toBe('B');
    expect(await out('x.plan', 3)).toBe('B');
    expect(await out('x.other', 1)).toBe('mock output from x.other');
  });
});

// ---------- engine: manager rounds ----------

const J = (x: unknown) => JSON.stringify(x);
const ACCEPT = J({ decision: 'accept' });
const plan = (...tasks: Record<string, unknown>[]) => J({ tasks });
const lead = (mock: Record<string, unknown>, o: Partial<PipelineNode> = {}) => ({ id: 'lead', role: 'planner', readOnly: true, manager: true, roster: ['coder', 'reviewer'], mock, ...o }) as Partial<PipelineNode>;
const startRun = async (p: ReturnType<typeof pipe>, o: { autoApprove?: boolean } = {}) => {
  const env = setup();
  const id = await env.engine.start({ pipeline: p, task: 'build the thing', repo: makeRepo(), workspace: false, ...o });
  return { ...env, id, s: await env.engine.wait(id) };
};
const seqOf = (store: ReturnType<typeof setup>['store'], id: string, pred: (e: StoredEvent['event']) => boolean) => store.events(id).find((e) => pred(e.event))?.seq ?? -1;

describe('engine: manager steps', () => {
  it('plans, runs the spawned steps in order, and is accepted', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'write it', mode: 'write' }, { id: 'b', to: 'reviewer', goal: 'check it', after: ['a'], context: ['a'] })], review: [ACCEPT] } })], [], { planApproval: false, allowWrites: true });
    const { s, store, id, mock } = await startRun(p);
    expect(s.status).toBe('done');
    const a = s.pipeline.nodes.find((n) => n.id === 'lead-a')!;
    const b = s.pipeline.nodes.find((n) => n.id === 'lead-b')!;
    expect(a.spawn!.parent).toBe('lead');
    expect(b.spawn!.parent).toBe('lead');
    expect(b.spawn!.contract.context).toEqual(['lead-a']);
    expect(s.nodes['lead-a']!.status).toBe('done');
    expect(s.nodes['lead-b']!.status).toBe('done');
    expect(s.nodes.lead!.status).toBe('done');
    expect(s.spawned).toBe(2);
    const finishedA = seqOf(store, id, (e) => e.type === 'node.finished' && e.node === 'lead-a');
    const startedB = seqOf(store, id, (e) => e.type === 'node.started' && e.node === 'lead-b');
    expect(finishedA).toBeGreaterThan(0);
    expect(startedB).toBeGreaterThan(finishedA);
    // manager calls are read-only
    expect(mock.calls.filter((c) => c.nodeId.startsWith('lead.')).every((c) => c.readOnly)).toBe(true);
  });

  it('re-asks once when the plan is not valid JSON', async () => {
    const p = pipe([lead({ replies: { plan: ['Sure, I will get the team on it.', plan({ id: 'a', to: 'coder', goal: 'g' })], review: [ACCEPT] } })], []);
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    const plans = mock.calls.filter((c) => c.nodeId === 'lead.plan');
    expect(plans).toHaveLength(2);
    const reason = (parsePlan('Sure, I will get the team on it.') as { error: string }).error;
    expect(plans[1]!.prompt).toContain('Your previous plan was rejected');
    expect(plans[1]!.prompt).toContain(reason);
  });

  it('fails the manager when the plan names an unknown bot twice', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'ghost', goal: 'g' })] } })], []);
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('error');
    expect(s.nodes.lead!.status).toBe('error');
    expect(s.nodes.lead!.error).toMatch(/manager plan rejected.*unknown bot/);
    expect(s.spawned).toBe(0);
    expect(mock.calls.filter((c) => c.nodeId === 'lead.plan')).toHaveLength(2);
  });

  it('sends a step back on redo with the reason as guidance', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [J({ redo: [{ id: 'a', reason: 'missing tests' }] }), ACCEPT] } })], []);
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    expect(s.nodes['lead-a']!.attempts).toBe(2);
    const runs = mock.calls.filter((c) => c.nodeId === 'lead-a');
    expect(runs).toHaveLength(2);
    expect(runs[0]!.prompt).not.toContain('missing tests');
    expect(runs[1]!.prompt).toContain('missing tests');
  });

  it('caps redos at 2 per step', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [J({ redo: [{ id: 'a', reason: 'again' }] })] } })], []);
    const { s, store, id } = await startRun(p);
    expect(s.nodes['lead-a']!.attempts).toBeLessThanOrEqual(3);
    expect(s.nodes['lead-a']!.attempts).toBe(3);
    expect(store.events(id).filter((e) => e.event.type === 'loop')).toHaveLength(2);
    expect(s.status).toBe('done'); // third redo ignored, treated as accept; the step itself is done
    expect(s.nodes.lead!.output).toMatch(/redo/i);
  });

  it('enforces the spawn budget', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' }, { id: 'b', to: 'coder', goal: 'h' })] } })], [], { maxSpawn: 1 });
    const { s } = await startRun(p);
    expect(s.status).toBe('error');
    expect(s.nodes.lead!.error).toMatch(/manager plan rejected.*spawn budget/);
    expect(s.spawned).toBe(0);
  });

  it('enforces the depth limit', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })] } })], []);
    p.settings = { ...p.settings, maxDepth: 0 }; // normalize clamps to >= 1; set below it to exercise the engine check
    const { s } = await startRun(p);
    expect(s.status).toBe('error');
    expect(s.nodes.lead!.error).toMatch(/manager plan rejected.*depth/);
    expect(s.spawned).toBe(0);
  });

  it('pauses for plan approval when a task writes, then proceeds on resume without re-planning', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g', mode: 'write' })], review: [ACCEPT] } })], [], { allowWrites: true });
    const { s, engine, id, mock, store } = await startRun(p);
    expect(s.status).toBe('paused');
    expect(s.nodes['lead-approve']!.status).toBe('awaiting');
    expect(s.pipeline.nodes.find((n) => n.id === 'lead-approve')!.kind).toBe('approval');
    expect(s.pipeline.edges).toContainEqual({ from: 'lead-approve', to: 'lead-a' });
    expect(s.nodes['lead-a']!.status).toBe('queued');
    expect(store.events(id).some((e) => e.event.type === 'node.started' && e.event.node === 'lead-a')).toBe(false);
    expect(s.nodes.lead!.status).toBe('running');
    engine.approve(id, 'lead-approve', true);
    await engine.resume(id);
    const t = await engine.wait(id);
    expect(t.status).toBe('done');
    expect(t.nodes['lead-a']!.status).toBe('done');
    expect(mock.calls.filter((c) => c.nodeId === 'lead.plan')).toHaveLength(1);
    expect(t.spawned).toBe(1); // the approval step does not use up the spawn budget
  });

  it('shows a failed spawned step to the manager; accepting it still fails the manager', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [ACCEPT] }, spawned: { a: { failFirst: 9 } } })], []);
    const { s, mock } = await startRun(p);
    expect(s.nodes['lead-a']!.status).toBe('error');
    expect(mock.calls.find((c) => c.nodeId === 'lead.review')!.prompt).toContain('mock failure');
    expect(s.nodes.lead!.status).toBe('error');
    expect(s.nodes.lead!.error).toMatch(/spawned step\(s\) failed: lead-a/);
    expect(s.status).toBe('error');
  });

  it('stops spawned work at the cost cap', async () => {
    const p = pipe(
      [lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' }, { id: 'b', to: 'coder', goal: 'h', after: ['a'] })], review: [ACCEPT] }, spawned: { a: { costUsd: 0.02 } } })],
      [],
      { maxCostUsd: 0.01 },
    );
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/budget exhausted/);
    expect(s.nodes['lead-b']!.status).toBe('skipped');
    expect(mock.calls.some((c) => c.nodeId === 'lead-b')).toBe(false);
  });

  it('stop mid-work, then resume reuses the spawned steps', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [ACCEPT] }, spawned: { a: { delayMs: 400 } } })], []);
    const { engine, store, mock } = setup();
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo(), workspace: false });
    for (let i = 0; i < 100 && store.state(id)?.nodes['lead-a']?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 10));
    expect(store.state(id)!.nodes['lead-a']!.status).toBe('running');
    engine.stop(id);
    let s = await engine.wait(id);
    expect(s.status).toBe('stopped');
    await engine.resume(id);
    s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(store.events(id).filter((e) => e.event.type === 'node.spawned')).toHaveLength(1);
    expect(mock.calls.filter((c) => c.nodeId === 'lead.plan')).toHaveLength(1);
    expect(s.nodes['lead-a']!.status).toBe('done');
  });

  it('does not run a ready step outside its own spawned steps while it works', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [ACCEPT] } }), { id: 'x', role: 'coder' }], []);
    const { s, store, id } = await startRun(p);
    expect(s.status).toBe('done');
    const leadDone = seqOf(store, id, (e) => e.type === 'node.finished' && e.node === 'lead');
    const xStarted = seqOf(store, id, (e) => e.type === 'node.started' && e.node === 'x');
    expect(leadDone).toBeGreaterThan(0);
    expect(xStarted).toBeGreaterThan(leadDone);
  });

  it('adds more work on review, and a downstream step gets the manager summary', async () => {
    const more = J({ more: [{ id: 'b', to: 'reviewer', goal: 'check a', context: ['a'] }] });
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [more, ACCEPT] } }), { id: 'after', role: 'tester', readOnly: true }], [['lead', 'after']]);
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    expect(s.spawned).toBe(2);
    expect(s.pipeline.nodes.find((n) => n.id === 'lead-b')!.spawn!.contract.context).toEqual(['lead-a']);
    expect(mock.calls.find((c) => c.nodeId === 'lead-b')!.prompt).toContain('mock output from lead-a');
    expect(mock.calls.find((c) => c.nodeId === 'after')!.prompt).toContain('lead-b');
  });

  it('treats an unreadable review as accept after one retry, with a note', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: ['looks fine to me'] } })], []);
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    const reviews = mock.calls.filter((c) => c.nodeId === 'lead.review');
    expect(reviews).toHaveLength(2);
    expect(reviews[1]!.prompt).toContain('Your previous reply was rejected');
    expect(s.nodes.lead!.output).toMatch(/treated as accept/);
  });

  it('a rejected plan approval fails the manager', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g', mode: 'write' })], review: [ACCEPT] } })], [], { allowWrites: true });
    const { engine, id, mock } = await startRun(p);
    engine.approve(id, 'lead-approve', false);
    await engine.resume(id);
    const t = await engine.wait(id);
    expect(t.status).toBe('error');
    expect(t.nodes.lead!.error).toMatch(/not approved/);
    expect(mock.calls.some((c) => c.nodeId === 'lead-a')).toBe(false);
  });

  it('a redo uses spawn budget and is refused when none is left', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' }, { id: 'b', to: 'coder', goal: 'h' })], review: [J({ redo: [{ id: 'a', reason: 'again' }] }), ACCEPT] } })], [], { maxSpawn: 2 });
    const { s, store, id } = await startRun(p);
    expect(s.status).toBe('done');
    expect(s.nodes['lead-a']!.attempts).toBe(1);
    expect(store.events(id).some((e) => e.event.type === 'loop')).toBe(false);
    expect(s.nodes.lead!.output).toMatch(/refused: the spawn budget is used up \(2 of 2/);
  });

  it('a redo counts against the budget later work sees', async () => {
    const more = J({ more: [{ id: 'b', to: 'coder', goal: 'h' }, { id: 'c', to: 'coder', goal: 'i' }] });
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [J({ redo: [{ id: 'a', reason: 'again' }] }), more, ACCEPT] } })], [], { maxSpawn: 3 });
    const { s, mock } = await startRun(p);
    // 1 spawned + 1 redo = 2 used, so two more tasks exceed the budget of 3: retried, then treated as accept
    expect(s.spawned).toBe(1);
    expect(mock.calls.filter((c) => c.nodeId === 'lead.review').at(-1)!.prompt).toContain('spawn budget (1 left)');
    expect(s.status).toBe('done');
  });

  it('cost cap counts the manager\'s own spend', async () => {
    const p = pipe([lead({ costUsd: 0.02, replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [ACCEPT] } })], [], { maxCostUsd: 0.01 });
    const { s, mock, store, id } = await startRun(p);
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/budget exhausted/);
    expect(s.costUsd).toBeCloseTo(0.02);
    expect(s.nodes.lead!.costUsd).toBeCloseTo(0.02);
    expect(s.nodes['lead-a']!.status).toBe('skipped');
    expect(mock.calls.some((c) => c.nodeId === 'lead-a')).toBe(false);
    expect(store.events(id).filter((e) => e.event.type === 'manager.cost')).toHaveLength(1);
  });

  it('manager spend is recorded before a pause for approval and kept across resume', async () => {
    const p = pipe([lead({ costUsd: 0.02, replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g', mode: 'write' })], review: [ACCEPT] } })], [], { allowWrites: true });
    const { s, engine, id } = await startRun(p);
    expect(s.status).toBe('paused');
    expect(s.costUsd).toBeCloseTo(0.02);
    expect(s.nodes.lead!.costUsd).toBeCloseTo(0.02);
    engine.approve(id, 'lead-approve', true);
    await engine.resume(id);
    const t = await engine.wait(id);
    expect(t.status).toBe('done');
    expect(t.costUsd).toBeCloseTo(0.04); // plan + review, each counted once
    expect(t.nodes.lead!.costUsd).toBeCloseTo(0.04);
  });

  it('enforces the wall-clock limit inside the manager', async () => {
    const p = pipe(
      [lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' }, { id: 'b', to: 'coder', goal: 'h', after: ['a'] })], review: [ACCEPT] }, spawned: { a: { delayMs: 300 } } })],
      [],
      { wallClockMs: 100 },
    );
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('error');
    expect(s.nodes.lead!.status).toBe('error');
    expect(s.nodes.lead!.error).toBe('wall-clock limit reached');
    expect(s.nodes['lead-b']!.status).toBe('skipped');
    expect(mock.calls.some((c) => c.nodeId === 'lead-b' || c.nodeId === 'lead.review')).toBe(false);
  });

  it('a successful redo re-queues the steps that were skipped below it', async () => {
    const p = pipe(
      [lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' }, { id: 'b', to: 'reviewer', goal: 'check', after: ['a'], context: ['a'] })], review: [J({ redo: [{ id: 'a', reason: 'it failed' }] }), ACCEPT] }, spawned: { a: { failFirst: 1 } } })],
      [],
    );
    const { s, store, id } = await startRun(p);
    expect(s.nodes['lead-a']!.attempts).toBe(2);
    expect(s.nodes['lead-a']!.status).toBe('done');
    expect(s.nodes['lead-b']!.status).toBe('done');
    expect(store.events(id).some((e) => e.event.type === 'node.requeued' && e.event.node === 'lead-b')).toBe(true);
    expect(s.nodes.lead!.status).toBe('done');
    expect(s.status).toBe('done');
  });

  it('leaves pipelines without a manager untouched by spawning', async () => {
    const { s, mock } = await startRun(pipe([{ id: 'a', role: 'coder' }], []));
    expect(s.status).toBe('done');
    expect(s.spawned).toBe(0);
    expect(mock.calls.map((c) => c.nodeId)).toEqual(['a']);
  });
});

describe('manager authoring and display', () => {
  it('makes a manager step, lists it, and builds the team template', async () => {
    const { makeStep, stepChoices, fromTemplate, blankPipeline } = await import('../src/composer.js');
    const m = makeStep('manager', blankPipeline('t'));
    expect(m).toMatchObject({ kind: 'agent', role: 'manager', readOnly: true, manager: true });
    expect(stepChoices()).toContain('manager');
    const p = fromTemplate('team', 't', 'mock');
    expect(p.nodes.map((n) => n.id)).toEqual(['manager', 'review', 'approve']);
    expect(p.nodes[0]!.fixNode).toBeUndefined();
    expect(() => normalizePipeline(p)).not.toThrow();
  });

  it('labels a spawned step with the arrow and its bot name', async () => {
    const { spawnedLabel } = await import('../src/ui.js');
    const n: PipelineNode = { id: 's1', kind: 'agent', role: 'coder', title: 'add login', x: 0, y: 0, spawn: { parent: 'manager', depth: 1, contract: { to: 'coder', goal: 'g', context: [], mode: 'write', after: [] } } };
    const l = spawnedLabel(n);
    expect(l.startsWith('↳')).toBe(true);
    expect(l).toContain('Bolt');
    expect(spawnedLabel({ id: 'x', kind: 'agent', x: 0, y: 0 })).not.toContain('↳');
  });

  it('counts manager.cost events in costSeries', async () => {
    const { costSeries } = await import('../src/metrics.js');
    const ev = [
      { runId: 'r', ts: 1, event: { type: 'manager.cost', node: 'm', costUsd: 0.5 } },
      { runId: 'r', ts: 2, event: { type: 'node.finished', node: 'm', costUsd: 0.25 } },
    ] as unknown as StoredEvent[];
    expect(costSeries(ev)).toEqual([0, 0.5, 0.75]);
  });
});

describe('underManagers', () => {
  it('puts spawned steps right after their manager and keeps the rest in order', async () => {
    const { underManagers } = await import('../src/ui.js');
    const c = { to: 'coder', goal: 'g', context: [], mode: 'write' as const, after: [] };
    const mk = (id: string, parent?: string): PipelineNode => ({ id, kind: 'agent', x: 0, y: 0, ...(parent ? { spawn: { parent, depth: 1, contract: c } } : {}) });
    const out = underManagers([mk('m'), mk('t'), mk('m-a', 'm'), mk('m-b', 'm')]).map((n) => n.id);
    expect(out).toEqual(['m', 'm-a', 'm-b', 't']);
  });
});

describe('run view selection order', () => {
  it('maps a display index to the right step and keeps plain pipelines unchanged', async () => {
    const { underManagers } = await import('../src/ui.js');
    const { proposableSteps, stepChoices } = await import('../src/composer.js');
    const c = { to: 'coder', goal: 'g', context: [], mode: 'write' as const, after: [] };
    const mk = (id: string, parent?: string): PipelineNode => ({ id, kind: 'agent', x: 0, y: 0, ...(parent ? { spawn: { parent, depth: 1, contract: c } } : {}) });
    const plain = [mk('a'), mk('b'), mk('c')];
    expect(underManagers(plain)).toEqual(plain);
    const nodes = [mk('m'), mk('t'), mk('m-a', 'm'), mk('m-b', 'm')];
    const order = underManagers(nodes);
    // pressing right twice from the manager lands on its second spawned step; enter would open that node id
    expect(order[2]!.id).toBe('m-b');
    expect(order[3]!.id).toBe('t');
    expect(proposableSteps()).not.toContain('manager');
    expect(stepChoices()).toContain('manager');
  });
});

// ---------- final fix wave ----------

describe('manager: approvals resolved while the run is live', () => {
  const livePipe = () =>
    pipe(
      [lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g', mode: 'write' })], review: [ACCEPT] } }), { id: 'x', role: 'coder', mock: { delayMs: 600 } }, { id: 'after', role: 'planner', readOnly: true }],
      [['lead', 'after']],
      { allowWrites: true },
    );
  const untilAwaiting = async (store: ReturnType<typeof setup>['store'], id: string) => {
    // x starts a moment after the approval is asked for (its step records the worktree's HEAD first)
    for (let i = 0; i < 200 && (store.state(id)?.nodes['lead-approve']?.status !== 'awaiting' || store.state(id)?.nodes.x?.status !== 'running'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(store.state(id)!.nodes['lead-approve']!.status).toBe('awaiting');
    expect(store.state(id)!.nodes.x!.status).toBe('running'); // the run is still live
  };

  it('approving mid-run lets the manager carry on and the run finishes done', async () => {
    const { engine, store } = setup();
    const id = await engine.start({ pipeline: livePipe(), task: 't', repo: makeRepo(), workspace: false });
    await untilAwaiting(store, id);
    engine.approve(id, 'lead-approve', true);
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    for (const n of ['lead', 'lead-a', 'x', 'after']) expect(s.nodes[n]!.status).toBe('done');
    expect(store.events(id).some((e) => e.event.type === 'node.requeued' && e.event.node === 'lead')).toBe(true);
  });

  it('rejecting mid-run fails the manager with a clear message', async () => {
    const { engine, store, mock } = setup();
    const id = await engine.start({ pipeline: livePipe(), task: 't', repo: makeRepo(), workspace: false });
    await untilAwaiting(store, id);
    engine.approve(id, 'lead-approve', false);
    const s = await engine.wait(id);
    expect(s.status).toBe('error');
    expect(s.nodes.lead!.status).toBe('error');
    expect(s.nodes.lead!.error).toMatch(/^plan rejected/);
    expect(s.error).toMatch(/lead.*plan rejected/);
    expect(s.nodes['lead-a']!.status).toBe('skipped');
    expect(s.nodes.after!.status).toBe('skipped');
    expect(mock.calls.some((c) => c.nodeId === 'lead-a')).toBe(false);
  });
});

describe('manager: write permission', () => {
  it('a write plan is rejected without allowWrites, and the reason goes back to the manager', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g', mode: 'write' })] } })], []);
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('error');
    expect(s.nodes.lead!.error).toMatch(/manager plan rejected.*allowWrites/);
    const plans = mock.calls.filter((c) => c.nodeId === 'lead.plan');
    expect(plans[0]!.prompt).toContain('must use "mode":"read"');
    expect(plans[1]!.prompt).toMatch(/rejected: .*allowWrites/);
    expect(s.spawned).toBe(0);
  });

  it('the team template allows write plans', () => {
    const t = fromTemplate('team', 't', 'mock', 'npm test');
    expect(t.settings.allowWrites).toBe(true);
    expect(normalizePipeline(JSON.parse(JSON.stringify(t))).settings.allowWrites).toBe(true);
    expect(pipe([{ id: 'a' }], []).settings.allowWrites).toBeUndefined();
  });
});

describe('spawned steps are built from the bot', () => {
  it('a custom bot keeps its persona and read-only setting; a reviewer gets verdict and diff', () => {
    const home = tmp('crew-');
    saveBot(home, sanitizeBot({ id: 'quant', name: 'Quant', title: 'quant', kind: 'agent', readOnly: true, persona: 'Backtests ideas.', look: { body: 'wide', eyes: 'visor', mouth: 'flat', top: 'antenna', side: 'none', pattern: 'none', color: '#f08a4b', accent: 'auto' } }).bot!);
    refreshCrew(home);
    try {
      const q = toNode(task('q', { to: 'quant' }), mgr, 1, 'mock');
      expect(q).toMatchObject({ id: 'lead-q', role: 'quant', readOnly: true, prompt: 'Backtests ideas.', agent: 'mock' });
      expect(validatePlan([task('q', { to: 'quant', mode: 'write' })], { manager: mgr, state: stateOf(), roster: ['quant'], allowWrite: true })).toMatch(/read-only/);
    } finally {
      refreshCrew(tmp('crew-'));
    }
    const r = toNode(task('r', { to: 'reviewer' }), mgr, 1);
    expect(r).toMatchObject({ role: 'reviewer', readOnly: true, verdict: true, includeDiff: true });
    expect(r.fixNode).toBeUndefined();
    expect(r.maxLoops).toBeUndefined();
  });

  it('a read-only role cannot take a write task', () => {
    expect(ok([task('a', { to: 'reviewer', mode: 'write' })])).toMatch(/"reviewer" is read-only/);
    expect(ok([task('a', { to: 'coder', mode: 'write' })])).toBeUndefined();
  });

  it('caps plan sizes', () => {
    expect(ok(Array.from({ length: 13 }, (_, i) => task(`t${i}`)), { spawned: -20 })).toMatch(/too many/);
    expect(ok([task('a', { goal: 'g'.repeat(501) })])).toMatch(/goal is longer than 500/);
    expect(ok([task('a', { expected: 'e'.repeat(501) })])).toMatch(/expected is longer than 500/);
    expect(ok([task('a', { context: Array.from({ length: 11 }, () => 'a') })])).toMatch(/more than 10/);
    expect(ok([task('a', { goal: 'g'.repeat(500) })])).toBeUndefined();
  });
});

describe('manager context in prompts', () => {
  it('the plan prompt carries upstream output, the step list, the manager\'s instructions, guidance and the project', async () => {
    const p = pipe([{ id: 'scout', role: 'planner', readOnly: true, mock: { output: 'PLANNER-OUT' } }, lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g', context: ['scout'] })], review: [ACCEPT] } }, { prompt: 'MANAGER-INSTRUCTIONS' })], [['scout', 'lead']]);
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    const pp = mock.calls.find((c) => c.nodeId === 'lead.plan')!.prompt;
    expect(pp).toContain('PLANNER-OUT');
    expect(pp).toContain('MANAGER-INSTRUCTIONS');
    expect(pp).toContain('- scout (planner): done');
    expect(mock.calls.find((c) => c.nodeId === 'lead-a')!.prompt).toContain('PLANNER-OUT');
    const rp = mock.calls.find((c) => c.nodeId === 'lead.review')!.prompt;
    expect(rp).toContain('PLANNER-OUT');
  });

  it('guidance and workspace context reach the manager', () => {
    const st = stateOf(0, { workspace: { id: 'w', name: 'W', context: 'PROJECT-CTX' } });
    const m = { ...mgr, guidance: 'KEEP-IT-SMALL' };
    for (const text of [planPrompt(st, m, ['coder']), reviewPrompt(st, m, [], 1)]) {
      expect(text).toContain('KEEP-IT-SMALL');
      expect(text).toContain('PROJECT-CTX');
    }
  });
});

describe('manager failures, blame and layout', () => {
  it('blames the failed spawned step, not the manager', async () => {
    const p = pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [ACCEPT] }, spawned: { a: { failFirst: 9 } } })], []);
    const { s } = await startRun(p);
    expect(s.nodes.lead!.error).toMatch(/^spawned step\(s\) failed/);
    expect(culprit(s)!.id).toBe('lead-a');
    const c = fallbackChoices(s, { agent: 'strong' });
    expect(c.options.find((o) => o.action.type === 'escalate')!.action).toMatchObject({ node: 'lead-a' });
  });

  it('spawned steps get distinct positions below the manager', async () => {
    const p = pipe(
      [lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g', mode: 'write' }, { id: 'b', to: 'coder', goal: 'h' }, { id: 'c', to: 'coder', goal: 'i' }, { id: 'd', to: 'coder', goal: 'j' })], review: [ACCEPT] } }, { x: 100, y: 50 })],
      [],
      { allowWrites: true },
    );
    const { s } = await startRun(p, { autoApprove: true });
    expect(s.status).toBe('done');
    const kids = s.pipeline.nodes.filter((n) => n.spawn?.parent === 'lead');
    expect(kids.map((k) => k.id)).toEqual(['lead-approve', 'lead-a', 'lead-b', 'lead-c', 'lead-d']);
    const spots = kids.map((k) => `${k.x},${k.y}`);
    expect(new Set([...spots, '100,50']).size).toBe(kids.length + 1);
    expect(kids.every((k) => k.y > 50)).toBe(true);
  });
});

describe('preflight and crew guards for managers', () => {
  it('rejects non-workers in an explicit roster', () => {
    for (const r of ['tester', 'approval', 'manager', 'orchestrator']) {
      expect(issues(pipe([{ id: 'm', manager: true, roster: ['coder', r] }], []), 'error').join()).toMatch(new RegExp(`roster entry "${r}" cannot take hand-offs`));
    }
    expect(issues(pipe([{ id: 'm', manager: true, roster: ['coder', 'reviewer'] }], []), 'error').join()).not.toMatch(/roster/);
  });

  it('warns when a saved custom bot uses the built-in manager id', () => {
    const home = tmp('crew-');
    saveBot(home, sanitizeBot({ id: 'manager', name: 'Mona', title: 'my manager', kind: 'verdict', persona: 'Mine.', look: { body: 'wide', eyes: 'visor', mouth: 'flat', top: 'antenna', side: 'none', pattern: 'none', color: '#f08a4b', accent: 'auto' } }).bot!);
    const seen: string[] = [];
    const crew = loadCrew(home, (m) => seen.push(m));
    const m = crew.find((b) => b.id === 'manager')!;
    expect(m.name).toBe('Mona');
    expect(m.kind).toBe('agent');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/"manager".*built-in/);
    expect(crewWarnings).toEqual(seen);
    expect(loadCrew(tmp('crew-'))).toBeTruthy();
    expect(crewWarnings).toEqual([]);
  });
});

describe('worker handoffs: data model', () => {
  const raw = (settings: Record<string, unknown>) => ({
    name: 'p', version: 1, mode: 'pipeline', nodes: [{ id: 'a', kind: 'agent', agent: 'mock', x: 0, y: 0 }], edges: [], settings,
  });

  it('normalizes handoff and allowWorkerWrites', () => {
    const s = normalizePipeline(raw({ handoff: 2, allowWorkerWrites: true })).settings;
    expect(s.handoff).toBe(2);
    expect(s.allowWorkerWrites).toBe(true);
    expect(normalizePipeline(raw({ handoff: 9 })).settings.handoff).toBe(3);
    expect(normalizePipeline(raw({ handoff: 2.7 })).settings.handoff).toBe(2);
    for (const bad of [0, -1, 'x', null, true]) expect(normalizePipeline(raw({ handoff: bad })).settings.handoff).toBeUndefined();
    expect(normalizePipeline(raw({})).settings.allowWorkerWrites).toBeUndefined();
  });

  const started = (base: ReturnType<typeof pipe>) =>
    ({ runId: 'r', ts: 1, event: { type: 'run.started', pipeline: base, task: 't', repo: '/r', workdir: '/w', baseSha: 'x', branch: 'b' } });

  it('folds a handoff event into talk without touching cost', () => {
    const base = pipe([{ id: 'a' }], []);
    const events = [
      started(base),
      { runId: 'r', ts: 5, event: { type: 'handoff', from: 'a', to: 'a.h1', goal: 'write the tests', answer: 'done', round: 1, costUsd: 0.5 } },
    ] as unknown as StoredEvent[];
    const s = foldRun(events)!;
    expect(s.talk).toEqual([{ from: 'a', to: 'a.h1', question: 'write the tests', answer: 'done', round: 1, ts: 5 }]);
    expect(s.costUsd).toBe(0);
  });

  it('folds a spawned node with kind hand like any spawned node', () => {
    const base = pipe([{ id: 'a' }], []);
    const node: PipelineNode = { id: 'a.h1', kind: 'agent', agent: 'mock', x: 0, y: 0, spawn: { parent: 'a', depth: 1, kind: 'hand', contract: { goal: 'g' } } as never };
    const events = [started(base), { runId: 'r', ts: 2, event: { type: 'node.spawned', node, parent: 'a', depth: 1, after: ['a'] } }] as unknown as StoredEvent[];
    const s = foldRun(events)!;
    expect(s.nodes['a.h1']!.status).toBe('queued');
    expect(s.spawned).toBe(1);
    expect(s.pipeline.nodes.find((n) => n.id === 'a.h1')!.spawn!.kind).toBe('hand');
  });
});

describe('worker @HAND lines', () => {
  it('parses read and write, optional parts, multiple lines', () => {
    const out = 'done\n@HAND coder: fix the bug | expect: a patch | context: a, b\n@HAND! Reviewer: check it\nnot @HAND x: y';
    expect(parseHands(out)).toEqual([
      { to: 'coder', goal: 'fix the bug', expected: 'a patch', context: ['a', 'b'], write: false },
      { to: 'reviewer', goal: 'check it', expected: undefined, context: [], write: true },
    ]);
    expect(parseHands('@hand coder: g | context: x | expect: y')[0]).toMatchObject({ goal: 'g', expected: 'y', context: ['x'] });
  });
  it('ignores @HAND not at the start of a line and caps lengths and count', () => {
    expect(parseHands('see @HAND coder: x\n> @HAND coder: x')).toEqual([]);
    const long = 'x'.repeat(2000);
    const ctx = Array.from({ length: 20 }, (_, i) => `c${i}`).join(',');
    const r = parseHands(`@HAND coder: ${long} | expect: ${long} | context: ${ctx}`)[0]!;
    expect(r.goal.length).toBe(PLAN_CAPS.goal);
    expect(r.expected!.length).toBe(PLAN_CAPS.expected);
    expect(r.context.length).toBe(PLAN_CAPS.context);
    expect(parseHands('@HAND a: 1\n@HAND b: 2\n@HAND c: 3')).toHaveLength(2);
  });
  it('ignores indented lines, fenced code and tolerates CRLF', () => {
    expect(parseHands('    @HAND coder: x\n\t@HAND coder: y')).toEqual([]);
    expect(stripHands('a\n  @HAND coder: x')).toBe('a\n  @HAND coder: x');
    const fenced = 'text\n```\n@HAND coder: x\n```\n@HAND coder: real';
    expect(parseHands(fenced).map((r) => r.goal)).toEqual(['real']);
    expect(stripHands(fenced)).toBe('text\n```\n@HAND coder: x\n```');
    const crlf = 'a\r\n@HAND coder: do it | expect: e\r\nb\r\n';
    expect(parseHands(crlf)).toEqual([{ to: 'coder', goal: 'do it', expected: 'e', context: [], write: false }]);
    expect(stripHands(crlf)).toBe('a\r\nb');
  });
  it('stripHands removes only those lines', () => {
    expect(stripHands('keep\n@HAND coder: x\n@HAND! coder: y\nalso keep @HAND z')).toBe('keep\nalso keep @HAND z');
  });

  const req = (o: Partial<HandRequest> = {}): HandRequest => ({ to: 'coder', goal: 'g', context: [], write: false, ...o });
  const worker: PipelineNode = { id: 'w', kind: 'agent', role: 'reviewer', x: 0, y: 0 };
  const vh = (r: HandRequest, o: { delegator?: PipelineNode; state?: RunState; used?: number; allowWrite?: boolean; roster?: string[] } = {}) =>
    validateHand(r, { delegator: o.delegator ?? worker, state: o.state ?? stateOf(), roster: o.roster ?? ['coder', 'reviewer', 'planner'], allowWrite: o.allowWrite ?? true, used: o.used ?? 0 });
  it('accepts a good request', () => expect(vh(req())).toBeUndefined());
  it('rejects each bad case with its own reason', () => {
    expect(vh(req({ goal: ' ' }))).toMatch(/goal/);
    expect(vh(req({ to: 'ghost' }))).toMatch(/unknown bot/);
    expect(vh(req({ to: 'reviewer' }))).toMatch(/loop/);
    expect(vh(req({ to: 'w' }), { roster: ['w'] })).toMatch(/loop/);
    expect(vh(req({ write: true }), { allowWrite: false })).toMatch(/write/);
    expect(vh(req({ to: 'reviewer', write: true }), { delegator: { ...worker, role: 'coder' } })).toMatch(/write/);
    expect(vh(req({ context: ['nope'] }))).toMatch(/context/);
    expect(vh(req({ context: ['a'] }))).toBeUndefined();
    expect(vh(req(), { used: 12 })).toMatch(/spawn budget/);
    expect(vh(req(), { delegator: { ...worker, spawn: { parent: 'lead', depth: 3, contract: task('x') } } })).toMatch(/depth/);
  });
  it('rejects a target equal to a role anywhere in the spawn chain', () => {
    const nodes: PipelineNode[] = [
      { id: 'lead', kind: 'agent', role: 'planner', x: 0, y: 0 },
      { id: 'lead-t1', kind: 'agent', role: 'coder', x: 0, y: 0, spawn: { parent: 'lead', depth: 1, contract: task('t1') } },
      { id: 'lead-t1-h1', kind: 'agent', role: 'reviewer', x: 0, y: 0, spawn: { parent: 'lead-t1', depth: 2, kind: 'hand', contract: task('h1') } },
    ];
    const base = stateOf();
    const st = { ...base, pipeline: { ...base.pipeline, nodes: [...base.pipeline.nodes, ...nodes] } } as RunState;
    const d = nodes[2]!;
    expect(vh(req({ to: 'planner' }), { delegator: d, state: st, roster: ['planner', 'coder', 'tester'] })).toMatch(/loop/);
    expect(vh(req({ to: 'coder' }), { delegator: d, state: st })).toMatch(/loop/);
    expect(vh(req({ to: 'tester' }), { delegator: d, state: st, roster: ['tester'] })).toBeUndefined();
  });
  it('handNode builds a hand step', () => {
    const n = handNode(req({ expected: 'e', context: ['a'] }), worker, 1);
    expect(n.id).toBe('w-h1');
    expect(n.spawn).toMatchObject({ parent: 'w', depth: 1, kind: 'hand', contract: { to: 'coder', goal: 'g', expected: 'e', context: ['a'], mode: 'read', after: [] } });
    expect(n.readOnly).toBe(true);
    expect(handNode(req({ write: true }), { ...worker, spawn: { parent: 'lead', depth: 1, contract: task('x') } }, 2).spawn!.depth).toBe(2);
    expect(handNode(req({ to: 'reviewer', write: true }), worker, 1).readOnly).toBe(true);
    expect(handNode(req({ write: true }), worker, 3).readOnly).toBeFalsy();
  });
  it('handoffBlock marks failures', () => {
    const b = handoffBlock([{ to: 'coder', goal: 'g1', answer: 'fine', ok: true }, { to: 'tester', goal: 'g2', answer: 'boom', ok: false }, { to: 'x', goal: 'g3', answer: 'y'.repeat(9000), ok: true }]);
    expect(b).toMatch(/^# Handoff results/);
    expect(b).toContain('fine');
    expect(b).toContain('failed: boom');
    expect(b).toContain('chars omitted');
  });
  it('briefing mentions hand-offs only when canHand is given, otherwise is unchanged', () => {
    const p = pipe([{ id: 'a' }, { id: 'b' }], [['a', 'b']]);
    const node = p.nodes[0]!;
    const legacy = [
      'You are one step in an automated software-development pipeline ("test"). The steps:',
      '- agent (a)  ← YOU · receives: — · feeds: agent (b)',
      '- agent (b) · receives: agent (a) · feeds: —',
      '',
      "Rules: do your own role's part and stop; do not redo upstream work; no person is available to answer questions, so state your assumptions instead of asking; write for the next step, not for a human.",
    ].join('\n');
    expect(briefing(p, node)).toBe(legacy);
    expect(briefing(p, node, [], [])).toBe(legacy);
    const h = briefing(p, node, [], ['coder', 'tester']);
    expect(h.startsWith(legacy)).toBe(true);
    expect(h).toContain('@HAND <bot>: <goal> | expect: <expected> | context: <ids>');
    expect(h).toContain('@HAND!');
    expect(h).toContain('coder, tester');
  });
});

// ---------- engine: worker handoffs ----------

describe('engine: worker @HAND handoffs', () => {
  const HAND = '@HAND reviewer: check a.txt | expect: PASS or problems';
  const worker = (mock: Record<string, unknown>, o: Partial<PipelineNode> = {}) => ({ id: 'w', role: 'coder', mock, ...o }) as Partial<PipelineNode>;
  const spawnedEvents = (store: ReturnType<typeof setup>['store'], id: string) => store.events(id).filter((e) => e.event.type === 'node.spawned');
  const waitFor = async (pred: () => boolean) => {
    for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 10));
  };

  it('happy path: spawns a hand child, feeds its output back, strips the @HAND line', async () => {
    const p = pipe([worker({ output: `did it\n${HAND}`, spawned: { reviewer: { output: 'looks good LGTM-123' } } })], [], { handoff: 1 });
    const { s, mock, store, id } = await startRun(p);
    expect(s.status).toBe('done');
    const child = s.pipeline.nodes.find((n) => n.id === 'w-h1')!;
    expect(child.role).toBe('reviewer');
    expect(child.spawn).toMatchObject({ parent: 'w', depth: 1, kind: 'hand', contract: { to: 'reviewer', goal: 'check a.txt', expected: 'PASS or problems' } });
    expect(mock.calls.filter((c) => c.nodeId === 'w-h1')).toHaveLength(1);
    const wCalls = mock.calls.filter((c) => c.nodeId === 'w');
    expect(wCalls).toHaveLength(2);
    expect(wCalls[0]!.prompt).toContain('@HAND <bot>');
    expect(wCalls[1]!.prompt).toContain('# Handoff results');
    expect(wCalls[1]!.prompt).toContain('LGTM-123');
    expect(s.spawned).toBe(1);
    expect(s.nodes['w-h1']!.status).toBe('done');
    expect(s.nodes.w!.output).not.toMatch(/@HAND/);
    expect(s.nodes.w!.output).toContain('did it');
    const ev = store.events(id).find((e) => e.event.type === 'handoff')!.event as Extract<StoredEvent['event'], { type: 'handoff' }>;
    expect(ev).toMatchObject({ from: 'w', to: 'w-h1', goal: 'check a.txt', round: 1 });
    expect(ev.answer).toContain('LGTM-123');
    expect(s.talk!.some((t) => t.from === 'w' && t.to === 'w-h1')).toBe(true);
  });

  it('refuses bad hand-offs with the reason, spawning nothing', async () => {
    const cases: { line: string; reason: RegExp; settings?: Record<string, unknown>; tweak?: (p: ReturnType<typeof pipe>) => void }[] = [
      { line: '@HAND ghost: do x', reason: /refused: unknown bot "ghost"/ },
      { line: '@HAND coder: do x', reason: /refused: handing to "coder" would loop/ },
      { line: '@HAND! architect: write x', reason: /refused: write hand-offs are not allowed/ },
      { line: '@HAND reviewer: do x', reason: /refused: nesting depth would exceed/, tweak: (p) => (p.settings = { ...p.settings, maxDepth: 0 }) },
      { line: '@HAND reviewer: do x', reason: /refused: the spawn budget is used up/, tweak: (p) => (p.settings = { ...p.settings, maxSpawn: 0 }) },
    ];
    for (const c of cases) {
      const p = pipe([worker({ output: `out\n${c.line}` })], [], { handoff: 1, ...c.settings });
      c.tweak?.(p);
      const { s, mock, store, id } = await startRun(p);
      expect(s.status, c.line).toBe('done');
      expect(s.spawned).toBe(0);
      expect(spawnedEvents(store, id)).toHaveLength(0);
      const wCalls = mock.calls.filter((x) => x.nodeId === 'w');
      expect(wCalls).toHaveLength(2);
      expect(wCalls[1]!.prompt).toMatch(c.reason);
      expect(s.nodes.w!.output).not.toMatch(/@HAND/);
    }
  });

  it('refuses a hand-off back to the manager\'s own role (three-level chain)', async () => {
    const p = pipe(
      [lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [ACCEPT] }, spawned: { a: { output: 'x\n@HAND planner: replan it' } } }, { roster: ['coder', 'reviewer', 'planner'] })],
      [],
      { handoff: 1 },
    );
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    expect(s.spawned).toBe(1);
    const calls = mock.calls.filter((c) => c.nodeId === 'lead-a');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toMatch(/refused: handing to "planner" would loop/);
  });

  it('a write hand-off runs serially in the worktree and is committed', async () => {
    const p = pipe(
      [worker({ output: 'plan done\n@HAND! coder: write b.txt', spawned: { coder: { writeFile: { path: 'b.txt', content: 'B\n' } } } }, { role: 'planner', readOnly: true })],
      [],
      { handoff: 1, allowWorkerWrites: true },
    );
    const { s, mock, store, id } = await startRun(p);
    expect(s.status).toBe('done');
    expect(existsSync(join(s.workdir, 'b.txt'))).toBe(true);
    expect(s.nodes['w-h1']!.commit).toBeTruthy();
    expect(s.pipeline.nodes.find((n) => n.id === 'w-h1')!.readOnly).toBeFalsy();
    expect(mock.calls.map((c) => c.nodeId)).toEqual(['w', 'w-h1', 'w']);
    const childStart = seqOf(store, id, (e) => e.type === 'node.started' && e.node === 'w-h1');
    const childEnd = seqOf(store, id, (e) => e.type === 'node.finished' && e.node === 'w-h1');
    const wEnd = seqOf(store, id, (e) => e.type === 'node.finished' && e.node === 'w');
    expect(childStart).toBeGreaterThan(seqOf(store, id, (e) => e.type === 'node.started' && e.node === 'w'));
    expect(wEnd).toBeGreaterThan(childEnd);
    expect(s.nodes.w!.status).toBe('done'); // the read-only delegator is not blamed for the child's committed change
  });

  it('a failed child is reported to the worker; the run still ends done', async () => {
    const p = pipe([worker({ output: `x\n${HAND}`, spawned: { reviewer: { failFirst: 9 } } })], [], { handoff: 1 });
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    expect(s.nodes['w-h1']!.status).toBe('error');
    expect(mock.calls.filter((c) => c.nodeId === 'w')[1]!.prompt).toContain('failed: mock failure');
  });

  it('stop while the child runs, then resume: one spawn, child cost counted once', async () => {
    const p = pipe([worker({ output: `x\n${HAND}`, costUsd: 0.01, spawned: { reviewer: { delayMs: 400, costUsd: 0.1 } } })], [], { handoff: 1 });
    const { engine, store } = setup();
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo(), workspace: false });
    await waitFor(() => store.state(id)?.nodes['w-h1']?.status === 'running');
    expect(store.state(id)!.nodes['w-h1']!.status).toBe('running');
    engine.stop(id);
    let s = await engine.wait(id);
    expect(s.status).toBe('stopped');
    await engine.resume(id);
    s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(spawnedEvents(store, id)).toHaveLength(1);
    expect(s.nodes['w-h1']!.status).toBe('done');
    expect(s.nodes['w-h1']!.costUsd).toBeCloseTo(0.1);
    expect(s.costUsd).toBeCloseTo(0.12); // the child once, the worker's two calls of the resumed attempt
    expect(store.events(id).filter((e) => e.event.type === 'handoff')).toHaveLength(1);
  });

  it('a resumed delegator that no longer hands off leaves its child skipped, and the run is done', async () => {
    const p = pipe([worker({ output: `x\n${HAND}`, spawned: { reviewer: { delayMs: 400 } } })], [], { handoff: 1 });
    const { engine, store, registry } = setup();
    registry.register({ id: 'alt', reportsCost: true, supportsResume: false, detect: async () => ({ ok: true }), run: async () => ({ output: 'final answer', exitCode: 0, costUsd: 0 }) });
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo(), workspace: false });
    await waitFor(() => store.state(id)?.nodes['w-h1']?.status === 'running');
    engine.stop(id);
    await engine.wait(id);
    engine.amend(id, 'w', { agent: 'alt' }, 'test');
    await engine.resume(id);
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(s.nodes.w!.output).toBe('final answer');
    expect(s.nodes['w-h1']!.status).toBe('skipped');
    expect(s.nodes['w-h1']!.error).toBe('delegator finished without using it');
  });

  it('bounds the rounds: a worker that always hands off still finishes', async () => {
    const p = pipe([worker({ output: `x\n${HAND}` })], [], { handoff: 2 });
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    expect(mock.calls.filter((c) => c.nodeId === 'w')).toHaveLength(3);
    expect(s.spawned).toBe(1); // the same hand-off again reuses the finished child
    expect(mock.calls.filter((c) => c.nodeId === 'w-h1')).toHaveLength(1);
    expect(s.nodes.w!.output).not.toMatch(/@HAND/);
  });

  it('without the handoff setting nothing changes', async () => {
    const p = pipe([worker({ output: `x\n${HAND}` })], []);
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    expect(s.spawned).toBe(0);
    expect(mock.calls.map((c) => c.nodeId)).toEqual(['w']);
    expect(mock.calls[0]!.prompt).not.toContain('@HAND');
    expect(s.nodes.w!.output).toBe(`x\n${HAND}`);
  });

  it('with a manager: a spawned worker hands off; the manager reviews only its own children; budget is shared', async () => {
    const lp = (maxSpawn: number) =>
      pipe([lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [ACCEPT] }, spawned: { a: { output: 'x\n@HAND reviewer: check it', spawned: { reviewer: { output: 'R-OK' } } } } })], [], { handoff: 1, maxSpawn });
    const { s, mock } = await startRun(lp(2));
    expect(s.status).toBe('done');
    expect(s.spawned).toBe(2);
    expect(s.pipeline.nodes.find((n) => n.id === 'lead-a-h1')!.spawn).toMatchObject({ parent: 'lead-a', depth: 2, kind: 'hand' });
    expect(mock.calls.filter((c) => c.nodeId === 'lead-a')[1]!.prompt).toContain('R-OK');
    const review = mock.calls.find((c) => c.nodeId === 'lead.review')!.prompt;
    expect(review).toContain('### lead-a (');
    expect(review).not.toContain('### lead-a-h1');
    const tight = await startRun(lp(1));
    expect(tight.s.status).toBe('done');
    expect(tight.s.spawned).toBe(1);
    expect(tight.mock.calls.filter((c) => c.nodeId === 'lead-a')[1]!.prompt).toMatch(/refused: the spawn budget is used up/);
  });

  it('places hand children below the delegator at distinct spots', async () => {
    const p = pipe([worker({ output: 'x\n@HAND reviewer: one\n@HAND architect: two' }, { x: 100, y: 50 })], [], { handoff: 1 });
    const { s } = await startRun(p);
    const kids = s.pipeline.nodes.filter((n) => n.spawn?.parent === 'w');
    expect(kids.map((k) => k.id)).toEqual(['w-h1', 'w-h2']);
    expect(new Set([...kids.map((k) => `${k.x},${k.y}`), '100,50']).size).toBe(3);
    expect(kids.every((k) => k.y > 50)).toBe(true);
  });

  it('a retried failed run does not leave a finished delegator\'s failed child unfinished', async () => {
    const p = pipe([worker({ output: `x\n${HAND}`, spawned: { reviewer: { failFirst: 9 } } }), { id: 'g', kind: 'gate', command: 'false' }], [['w', 'g']], { handoff: 1 });
    const { s, engine, id } = await startRun(p);
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/"g"/);
    await engine.resume(id, { retryFailed: true });
    const t = await engine.wait(id);
    expect(t.status).toBe('error');
    expect(t.error).toMatch(/"g"/);
    expect(t.error).not.toMatch(/unfinished/);
    expect(t.nodes['w-h1']!.status).toBe('skipped');
  });
  it('refuses a new hand-off once the wall clock is past, finishes the worker without a follow-up, and the run ends on the limit', async () => {
    const p = pipe([worker({ output: 'x\n@HAND reviewer: one\n@HAND architect: two', spawned: { reviewer: { delayMs: 300 } } })], [], { handoff: 1, wallClockMs: 150 });
    const { s, mock, store, id } = await startRun(p);
    expect(s.status).toBe('error');
    expect(s.error).toBe('wall-clock limit reached');
    expect(s.spawned).toBe(1);
    const ev = store.events(id).map((e) => e.event).filter((e) => e.type === 'handoff') as Extract<StoredEvent['event'], { type: 'handoff' }>[];
    expect(ev.find((e) => e.to === 'architect')!.answer).toBe('refused: wall-clock limit reached');
    expect(mock.calls.filter((c) => c.nodeId === 'w')).toHaveLength(1);
    expect(s.nodes.w!.status).toBe('done');
    expect(s.nodes.w!.output).not.toMatch(/@HAND/);
  });

  it('refuses to re-run an existing unfinished child once the wall clock is past', async () => {
    const p = pipe([worker({ output: 'x\n@HAND architect: two', spawned: { architect: { delayMs: 1000 }, reviewer: { delayMs: 400 } } })], [], { handoff: 1, wallClockMs: 250 });
    const { engine, store, registry, mock } = setup();
    registry.register({ id: 'swap', reportsCost: true, supportsResume: false, detect: async () => ({ ok: true }), run: async (req) => {
      if (req.nodeId !== 'w') {
        await new Promise((r) => setTimeout(r, 400));
        return { output: 'child\nVERDICT: PASS', exitCode: 0, costUsd: 0 };
      }
      return { output: 'y\n@HAND reviewer: three\n@HAND architect: two', exitCode: 0, costUsd: 0 };
    } });
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo(), workspace: false });
    await waitFor(() => store.state(id)?.nodes['w-h1']?.status === 'running');
    engine.stop(id);
    expect((await engine.wait(id)).status).toBe('stopped');
    engine.amend(id, 'w', { agent: 'swap' }, 'test');
    await engine.resume(id);
    const s = await engine.wait(id);
    const ev = store.events(id).map((e) => e.event).filter((e) => e.type === 'handoff') as Extract<StoredEvent['event'], { type: 'handoff' }>[];
    expect(ev.filter((e) => e.from === 'w').map((e) => [e.to, e.answer])).toEqual([['w-h2', 'child\nVERDICT: PASS'], ['architect', 'refused: wall-clock limit reached']]);
    expect(mock.calls.filter((c) => c.nodeId === 'w-h1')).toHaveLength(1); // not re-run
    expect(s.nodes['w-h2']!.status).toBe('done');
    expect(s.nodes['w-h1']!.status).toBe('skipped');
    expect(s.status).toBe('error');
    expect(s.error).toBe('wall-clock limit reached');
  });

  it('the follow-up call after a hand-off gets the budget left after the child and the worker\'s own spend', async () => {
    const budgets: (number | undefined)[] = [];
    const { engine, registry } = setup();
    registry.register({
      id: 'cap', reportsCost: true, supportsResume: false, detect: async () => ({ ok: true }),
      run: async (req) => {
        if (req.nodeId !== 'w') return { output: 'child done', exitCode: 0, costUsd: 0.04 };
        budgets.push(req.budgetUsd);
        return { output: budgets.length === 1 ? `x\n${HAND}` : 'final', exitCode: 0, costUsd: 0.001 };
      },
    });
    const p = pipe([{ id: 'w', role: 'coder', agent: 'cap' }], [], { handoff: 1, maxCostUsd: 0.05 });
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo(), workspace: false });
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(budgets).toHaveLength(2);
    expect(budgets[0]).toBeCloseTo(0.05);
    expect(budgets[1]).toBeCloseTo(0.009);
    expect(s.costUsd).toBeCloseTo(0.042);
  });

  it('a read and a write hand-off with the same bot and goal are different children', async () => {
    const p = pipe([worker({ output: 'x\n@HAND coder: do x\n@HAND! coder: do x' }, { role: 'planner', readOnly: true })], [], { handoff: 1, allowWorkerWrites: true });
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    expect(s.spawned).toBe(2);
    expect(s.pipeline.nodes.find((n) => n.id === 'w-h1')!.spawn!.contract.mode).toBe('read');
    expect(s.pipeline.nodes.find((n) => n.id === 'w-h2')!.spawn!.contract.mode).toBe('write');
    expect(mock.calls.filter((c) => c.nodeId.startsWith('w-h'))).toHaveLength(2);
  });
});

describe('handoff display and defaults', () => {
  const mk = (id: string, parent?: string, kind?: 'plan' | 'hand'): PipelineNode =>
    ({ id, kind: 'agent', role: 'coder', x: 0, y: 0, ...(parent ? { spawn: { parent, depth: 1, ...(kind ? { kind } : {}), contract: { goal: 'g' } } } : {}) }) as PipelineNode;

  it('the team template turns handoffs on', () => {
    expect(fromTemplate('team', 't', 'mock').settings.handoff).toBe(1);
    expect(fromTemplate('feature', 't', 'mock').settings.handoff).toBeUndefined();
  });
  it('labels hand children as handoffs and leaves plan children alone', () => {
    const hand = spawnedLabel({ ...mk('w-h1', 'w', 'hand'), role: 'reviewer' });
    expect(hand).toContain('handoff');
    expect(hand).toMatch(/^↳ .*\(handoff\)/);
    const plan = spawnedLabel(mk('m-t1', 'm'));
    expect(plan).not.toContain('handoff');
    expect(plan.startsWith('↳')).toBe(true);
  });
  it('orders a hand child directly under its (spawned) delegator', () => {
    const nodes = [mk('m'), mk('m-t1', 'm'), mk('m-t2', 'm'), mk('m-t1-h1', 'm-t1', 'hand'), mk('z')];
    expect(underManagers(nodes).map((n) => n.id)).toEqual(['m', 'm-t1', 'm-t1-h1', 'm-t2', 'z']);
  });
  it('a manager redo of a worker that repeats its @HAND line runs a fresh child', async () => {
    const p = pipe(
      [lead({ replies: { plan: [plan({ id: 'a', to: 'coder', goal: 'g' })], review: [J({ redo: [{ id: 'a', reason: 'again' }] }), ACCEPT] }, spawned: { a: { output: 'x\n@HAND reviewer: check it' } } })],
      [],
      { handoff: 1 },
    );
    const { s, mock } = await startRun(p);
    expect(s.status).toBe('done');
    expect(s.nodes['lead-a']!.attempts).toBe(2);
    expect(s.pipeline.nodes.filter((n) => n.spawn?.parent === 'lead-a').map((n) => n.id)).toEqual(['lead-a-h1', 'lead-a-h2']);
    expect(mock.calls.filter((c) => c.nodeId.startsWith('lead-a-h'))).toHaveLength(2);
    expect(s.spawned).toBe(3);
  });

  it('a hand-off chain cannot overshoot the cost cap by the delegators\' unrecorded spend', async () => {
    const budgets: Record<string, (number | undefined)[]> = {};
    const { engine, registry, store } = setup();
    registry.register({
      id: 'cap', reportsCost: true, supportsResume: false, detect: async () => ({ ok: true }),
      run: async (req) => {
        (budgets[req.nodeId] ??= []).push(req.budgetUsd);
        const out = req.nodeId === 'w' ? 'x\n@HAND architect: look' : req.nodeId === 'w-h1' ? 'y\n@HAND planner: plan it' : 'z';
        return { output: out, exitCode: 0, costUsd: 0.03 };
      },
    });
    const p = pipe([{ id: 'w', role: 'coder', agent: 'cap' }], [], { handoff: 1, maxCostUsd: 0.05 });
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo(), workspace: false });
    const s = await engine.wait(id);
    expect(budgets['w-h1']![0]).toBeCloseTo(0.02); // the cap minus w's first call
    expect(s.pipeline.nodes.some((n) => n.id === 'w-h1-h1')).toBe(false);
    const ev = store.events(id).map((e) => e.event).filter((e) => e.type === 'handoff') as Extract<StoredEvent['event'], { type: 'handoff' }>[];
    expect(ev.find((e) => e.from === 'w-h1')!.answer).toBe('refused: the run is out of budget');
  });

  it('only the last allowed round tells the worker to stop handing off', async () => {
    const p = pipe([{ id: 'w', role: 'coder', mock: { output: 'x\n@HAND reviewer: check a.txt' } }], [], { handoff: 2 });
    const { mock } = await startRun(p);
    const calls = mock.calls.filter((c) => c.nodeId === 'w');
    expect(calls).toHaveLength(3);
    expect(calls[1]!.prompt).toContain('# Handoff results');
    expect(calls[1]!.prompt).not.toContain('Do not add new @HAND lines');
    expect(calls[2]!.prompt).toContain('Do not add new @HAND lines');
    const r = [{ to: 'coder', goal: 'g', answer: 'a', ok: true }];
    expect(handoffBlock(r)).toContain('Do not add new @HAND lines');
    expect(handoffBlock(r, false)).not.toContain('Do not add new @HAND lines');
  });

  it('the timeline says refused for a refused hand-off and answered otherwise', () => {
    const id = (x: string) => x;
    const refused = describeEvent({ type: 'handoff', from: 'w', to: 'ghost', goal: 'g', answer: 'refused: unknown bot "ghost"', round: 1 }, id)!.text;
    expect(refused).toMatch(/refused: unknown bot "ghost"/);
    expect(refused).not.toMatch(/answered/);
    expect(describeEvent({ type: 'handoff', from: 'w', to: 'w-h1', goal: 'g', answer: 'fine', round: 1 }, id)!.text).toMatch(/w-h1 answered/);
  });
});
