import { describe, expect, it } from 'vitest';
import { normalizePipeline, preflight } from '../src/pipeline.js';
import { foldRun, type PipelineNode, type RunState, type StoredEvent } from '../src/types.js';
import { buildPrompt } from '../src/prompt.js';
import { MockAdapter } from '../src/adapters/mock.js';
import { limitsOf, parsePlan, parseReview, planPrompt, reviewPrompt, rosterOf, toNode, validatePlan, type PlanTask } from '../src/handoff.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';
import { refreshCrew } from '../src/bots.js';
import { crewWarnings, loadCrew, sanitizeBot, saveBot } from '../src/crew.js';
import { fromTemplate } from '../src/composer.js';
import { culprit } from '../src/supervisor.js';
import { fallbackChoices } from '../src/runchat.js';

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
    for (let i = 0; i < 200 && store.state(id)?.nodes['lead-approve']?.status !== 'awaiting'; i++) await new Promise((r) => setTimeout(r, 10));
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
