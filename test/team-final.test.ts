/**
 * Final review fixes for team runs: each test reproduces one failure scenario from the review against the real
 * Engine, Store and MockAdapter (with resume support where the scenario needs a resumable session).
 */
import { describe, expect, it, vi } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';
import { foldRun, type StoredEvent } from '../src/types.js';
import { parseUserAsks } from '../src/consult.js';
import { parsePlan, parseQuestions, TeamError } from '../src/team.js';
import { progressLines, CardInput } from '../src/teamchat.js';
import { briefing } from '../src/prompt.js';
import { makeRepo, pipe, tmp } from './helpers.js';
import { savePrefs } from '../src/prefs.js';

const J = JSON.stringify;
const ACCEPT = J({ decision: 'accept' });
const ASK1 = '@ASK user: Which database? | options: postgres; sqlite | recommended: sqlite';
const card = (id: string, extra: object = {}) => ({ id, ask: `ask ${id}`, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommended: 'b', ...extra });
const tasks = (...ts: object[]) => J({ tasks: ts.map((t) => ({ to: 'coder', goal: 'do it', mode: 'read', context: [], after: [], ...t })) });
const BINDS = () => ({ orchestrator: { agent: 'mock' }, manager: { agent: 'mock' } });
const WRITES = { id: 'writes', ask: 'writes?', options: [{ id: 'yes', label: 'yes' }, { id: 'no', label: 'no' }], recommended: 'no' };
const evs = (store: Store, id: string, type: string) => store.events(id).filter((e) => e.event.type === type).map((e) => e.event as never as Record<string, any>);

function mk(adapter: MockAdapter = new MockAdapter()) {
  const store = Store.open(':memory:');
  const home = tmp('home-');
  return { mock: adapter, store, home, engine: new Engine(store, { home, registry: new AdapterRegistry().register(adapter), bindings: BINDS }), repo: makeRepo() };
}
type T = ReturnType<typeof mk>;
/** A Boss script: plan the given tasks, review with the given replies; `spawned` scripts the workers. */
const boss = (spawned: Record<string, object>, o: { tasks?: object[]; review?: string[]; assignments?: object[]; extra?: object } = {}) => ({
  plan: { goal: 'ship', success: ['works'], assignments: o.assignments ?? [{ bot: 'coder', goal: 'c' }] },
  replies: { plan: [tasks(...(o.tasks ?? [{ id: 'a' }]))], review: o.review ?? [ACCEPT] },
  spawned,
  ...o.extra,
});
async function approvedRun(t: T, script: object, o: { mode?: 'live' | 'autonomous'; writes?: boolean; roster?: string[] } = {}) {
  const id = await t.engine.startTeam({ task: 'build x', repo: t.repo, workspace: false, roster: o.roster ?? ['coder', 'reviewer'], mode: o.mode, mock: { ...script, ...(o.writes ? { questions: [[WRITES]] } : {}) } as never });
  if (o.writes) await t.engine.answerPlan(id, [{ question: 'writes', option: 'yes', by: 'user' }]);
  await t.engine.approveTeamPlan(id, true);
  return id;
}
const calls = (t: T, node: string) => t.mock.calls.filter((c) => c.nodeId === node);

// ---------- 1. redo / fix / retry instructions reach a resumed session ----------
describe('#1 a resumed session still gets redo instructions after an answered question', () => {
  const redo = J({ redo: [{ id: 'a', reason: 'handle nulls' }] });

  it('live: answer, finish, Boss redo -> the redo attempt carries the reason (and the answers)', async () => {
    const t = mk(new MockAdapter({ resume: true }));
    const id = await approvedRun(t, boss({ a: { output: ASK1 } }, { review: [redo, ACCEPT] }));
    expect((await t.engine.wait(id)).status).toBe('paused');
    await t.engine.answerUser(id, 'u1', { option: 'o1' });
    const s = await t.engine.wait(id);
    expect(s.status).toBe('done');
    const a = calls(t, 'manager-a');
    expect(a).toHaveLength(3);
    // the first rerun after the pause resumes the session with the answers only
    expect(a[1]!.resumeSessionId).toBeTruthy();
    expect(a[1]!.prompt.startsWith('# Answers to your questions')).toBe(true);
    // the redo resumes the session too, but with the full prompt: the reason and the answers
    expect(a[2]!.resumeSessionId).toBeTruthy();
    expect(a[2]!.prompt).toContain('handle nulls');
    expect(a[2]!.prompt).toMatch(/<answer>\s*postgres/);
  });

  it('autonomous: Tether answered at once; the redo still carries the reason', async () => {
    const t = mk(new MockAdapter({ resume: true }));
    const id = await approvedRun(t, boss({ a: { output: ASK1 } }, { review: [redo, ACCEPT] }), { mode: 'autonomous' });
    const s = await t.engine.wait(id);
    expect(s.status).toBe('done');
    const last = calls(t, 'manager-a').at(-1)!;
    expect(last.prompt).toContain('handle nulls');
  });
});

// ---------- 8. reverted edits are mentioned on resume ----------
describe('#8 a resumed write step is told its edits were reverted', () => {
  it('the answers block says the worktree was reset and the changes must be redone', async () => {
    const t = mk(new MockAdapter({ resume: true }));
    const id = await approvedRun(t, boss({ a: { output: ASK1, writeFile: { path: 'a.txt', content: 'x' } } }, { tasks: [{ id: 'a', mode: 'write' }], assignments: [{ bot: 'coder', goal: 'c', mode: 'write' }] }), { writes: true, roster: ['coder'] });
    expect((await t.engine.wait(id)).status).toBe('paused');
    await t.engine.answerUser(id, 'u1', { option: 'o1' });
    expect((await t.engine.wait(id)).status).toBe('done');
    const rerun = calls(t, 'manager-a')[1]!.prompt;
    expect(rerun.startsWith('# Answers to your questions')).toBe(true);
    expect(rerun).toMatch(/reverted/i);
    expect(rerun).toMatch(/redo/i);
  });
});

// ---------- 2. planning spend counts against the cap ----------
describe('#2 the cap covers planning', () => {
  it('a planning call gets the remaining budget, and planning stops with a clear message once the cap is spent', async () => {
    const t = mk();
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], budgetUsd: 0.5, mock: { costUsd: 0.4, questions: [[card('q1')], [card('q2')]], plan: { goal: 'g', assignments: [{ bot: 'coder', goal: 'c' }] } } as never });
    expect(calls(t, 'plan.1')[0]!.budgetUsd).toBeCloseTo(0.5);
    await t.engine.answerPlan(id, [{ question: 'q1', option: 'a', by: 'user' }]);
    expect(calls(t, 'plan.2')[0]!.budgetUsd).toBeCloseTo(0.1);
    const s = t.store.state(id)!;
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/planning used up the budget/);
    expect(s.error).toMatch(/\$0\.8.*\$0\.5/);
    expect(s.plan).toBeUndefined();
    expect(s.pending).toEqual([]);
    expect(s.planning).toBe(false);
  });

  it('no further planning call is made once the cap is reached', async () => {
    const t = mk();
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], budgetUsd: 0.5, mock: { costUsd: 0.6, questions: [[card('q1')]] } as never });
    expect(t.store.state(id)!.status).toBe('error');
    expect(calls(t, 'plan.1')).toHaveLength(1);
  });

  it('approval of a plan whose cap planning already spent is refused with a clear message; the plan stays', async () => {
    const t = mk();
    savePrefs(t.home, { spendingCaps: true });
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], mock: { costUsd: 0.3, questions: [[card('q1')]], plan: { goal: 'g', assignments: [{ bot: 'coder', goal: 'c' }], limits: { maxCostUsd: 0.5 } } } as never });
    await t.engine.answerPlan(id, [{ question: 'q1', option: 'a', by: 'user' }]);
    let s = t.store.state(id)!;
    expect(s.plan!.limits.maxCostUsd).toBe(0.5);
    expect(s.costUsd).toBeCloseTo(0.6);
    const e = await t.engine.approveTeamPlan(id, true).then(() => undefined, (x: TeamError) => x);
    expect(e).toBeInstanceOf(TeamError);
    expect(e!.code).toBe('conflict');
    expect(e!.message).toMatch(/planning already spent/);
    s = t.store.state(id)!;
    expect(s.status).toBe('running');
    expect(s.pipeline.nodes).toEqual([]);
    expect(t.engine.isLive(id)).toBe(false);
  });

  it('with money left, the approved run runs under the same total cap', async () => {
    const t = mk();
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], budgetUsd: 2, mock: { costUsd: 0.1, questions: [], plan: { goal: 'g', assignments: [{ bot: 'coder', goal: 'c' }] }, replies: { plan: [tasks({ id: 'a' })], review: [ACCEPT] } } as never });
    await t.engine.approveTeamPlan(id, true);
    const s = await t.engine.wait(id);
    expect(s.status).toBe('done');
    expect(s.pipeline.settings.maxCostUsd).toBe(2);
  });
});

// ---------- 3 and 5. stop on a ready plan; a stopped planning run ----------
describe('#3 #5 stopping and resuming team runs before execution', () => {
  it('stop() ends a run whose plan is ready', async () => {
    const t = mk();
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], yes: true, mock: { questions: [], plan: { goal: 'g', assignments: [{ bot: 'coder', goal: 'c' }] } } as never });
    expect(t.store.list().find((r) => r.id === id)!.planReady).toBe(true);
    expect(t.engine.stop(id)).toBe(true);
    expect(t.store.state(id)!.status).toBe('stopped');
    expect(t.store.list().find((r) => r.id === id)!.planReady).toBe(false);
  });

  it('a stopped planning run has no pending cards and is not planning', async () => {
    const t = mk();
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], mock: { questions: [[card('q1'), card('q2')]] } as never });
    expect(t.engine.stop(id)).toBe(true);
    const s = t.store.state(id)!;
    expect(s.status).toBe('stopped');
    expect(s.planning).toBe(false);
    expect(s.pending).toEqual([]);
    expect(t.store.list().find((r) => r.id === id)!.pending).toBe(0);
  });

  it('resuming a stopped planning run asks that round again', async () => {
    const t = mk();
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], mock: { questions: [[card('q1'), card('q2')]], plan: { goal: 'g', assignments: [{ bot: 'coder', goal: 'c' }] } } as never });
    t.engine.stop(id);
    await t.engine.resume(id);
    const s = t.store.state(id)!;
    expect(s.status).toBe('running');
    expect(s.planning).toBe(true);
    expect(s.round).toBe(1);
    expect(s.pending.map((q) => q.id)).toEqual(['q1', 'q2']);
    await t.engine.answerPlan(id, [{ question: 'q1', option: 'a', by: 'user' }, { question: 'q2', option: 'a', by: 'user' }]);
    expect(t.store.state(id)!.plan).toBeDefined();
  });

  it('resuming a stopped plan-ready run brings the plan back for approval', async () => {
    const t = mk();
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], yes: true, mock: { questions: [], plan: { goal: 'g', assignments: [{ bot: 'coder', goal: 'c' }] } } as never });
    t.engine.stop(id);
    await t.engine.resume(id);
    expect(t.store.list().find((r) => r.id === id)!.planReady).toBe(true);
  });

  it('a fold keeps a stopped planning run consistent even with cards answered in part', () => {
    const base = { type: 'run.started', pipeline: pipe([], []), task: 't', repo: '/r', workdir: '/w', baseSha: 'x', branch: 'b', kind: 'team' };
    const log = (...events: object[]) => events.map((event, i) => ({ runId: 'r', ts: i + 1, seq: i + 1, event })) as unknown as StoredEvent[];
    const s = foldRun(log(base, { type: 'plan.question', round: 1, questions: [card('q1'), card('q2')] }, { type: 'plan.answer', answers: [{ question: 'q1', option: 'a', by: 'user' }] }, { type: 'run.finished', status: 'stopped' }))!;
    expect(s.pending).toEqual([]);
    expect(s.planning).toBe(false);
    const r = foldRun(log(base, { type: 'plan.question', round: 1, questions: [card('q1'), card('q2')] }, { type: 'run.finished', status: 'stopped' }, { type: 'run.resumed' }))!;
    expect(r.planning).toBe(true);
    expect(r.status).toBe('running');
  });
});

// ---------- 6. repeated question ids ----------
describe('#6 a question id reused in a later round', () => {
  it('is renamed, not dropped; no retry is needed', async () => {
    const t = mk();
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], mock: { questions: [[card('q1')], [card('q1', { ask: 'a new question' })]] } as never });
    await t.engine.answerPlan(id, [{ question: 'q1', option: 'a', by: 'user' }]);
    const s = t.store.state(id)!;
    expect(s.pending.map((q) => q.id)).toEqual(['q1-r2']);
    expect(s.pending[0]!.ask).toBe('a new question');
    expect(calls(t, 'plan.2')).toHaveLength(1);
  });

  it('a repeated id within one batch is renamed too, and a repeated writes card is dropped', () => {
    const r = parseQuestions(J({ questions: [card('q1'), card('q1', { ask: 'other' }), WRITES, WRITES] }));
    expect(r.questions.map((q) => q.id)).toEqual(['q1', 'q1-2', 'writes']);
  });

  it('a JSON reply that cannot be used never shows raw JSON on the fallback card, and the retry says why', async () => {
    const t = mk();
    const bad = J({ questions: [{ id: 'q1', ask: 'x', options: [] }] });
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], mock: { questions: [bad] } as never });
    const s = t.store.state(id)!;
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]!.ask).not.toContain('{');
    expect(s.pending[0]!.ask).toMatch(/default plan/);
    expect(calls(t, 'plan.1')[1]!.prompt).toMatch(/rejected: .*has no options/);
  });
});

// ---------- 9. planPreapproved ----------
describe('#9 planPreapproved', () => {
  it('is ignored outside team runs: a workflow manager still asks for plan approval', async () => {
    const t = mk();
    const pl = pipe([{ id: 'm', manager: true, roster: ['coder'], mock: { replies: { plan: [tasks({ id: 'a' })], review: [ACCEPT] } } }], [], { planApproval: true, planPreapproved: true });
    const id = await t.engine.start({ task: 't', repo: t.repo, workspace: false, pipeline: pl });
    const s = await t.engine.wait(id);
    expect(s.status).toBe('paused');
    expect(s.pipeline.nodes.some((n) => n.kind === 'approval')).toBe(true);
  });

  it('a team Boss whose first batch goes beyond the approved assignments needs approval for it', async () => {
    const t = mk();
    const id = await approvedRun(t, boss({}, { tasks: [{ id: 'a', to: 'reviewer' }] }));
    const s = await t.engine.wait(id);
    expect(s.status).toBe('paused');
    expect(s.pipeline.nodes.some((n) => n.kind === 'approval')).toBe(true);
  });

  it('a write task for a bot the plan made read-only needs approval', async () => {
    const t = mk();
    const id = await approvedRun(t, boss({}, { tasks: [{ id: 'a', mode: 'write' }] }), { writes: true, roster: ['coder'] });
    const s = await t.engine.wait(id);
    expect(s.status).toBe('paused');
    expect(s.pipeline.nodes.some((n) => n.kind === 'approval')).toBe(true);
  });
});

// ---------- 10. the writes card ----------
describe('#10 the writes card text is the server\'s', () => {
  it('ask, labels and recommendation are fixed whatever the model wrote', () => {
    const tricky = { id: 'writes', ask: 'Keep it safe?', why: 'trust me', options: [{ id: 'yes', label: 'No, keep it read-only' }, { id: 'no', label: 'Yes, edit away' }], recommended: 'yes' };
    const q = parseQuestions(J({ questions: [tricky] })).questions[0]!;
    expect(q.ask).toBe('May agents change files in the worktree?');
    expect(q.options).toEqual([{ id: 'yes', label: 'Yes, allow edits' }, { id: 'no', label: 'No, read-only' }]);
    expect(q.recommended).toBe('no');
    expect(q.allowOther).toBeUndefined();
    expect(JSON.stringify(q)).not.toContain('trust me');
  });
  it('a writes card without a no option is still the fixed card', () => {
    const q = parseQuestions(J({ questions: [{ id: 'writes', ask: 'w', options: [{ id: 'go', label: 'go' }], recommended: 'go' }] })).questions[0]!;
    expect(q.options.map((o) => o.id)).toEqual(['yes', 'no']);
  });
});

// ---------- 11. wall clock ----------
describe('#11 the wall-clock limit is clamped', () => {
  const plan = (ms: number) => parsePlan(J({ goal: 'g', assignments: [{ bot: 'coder', goal: 'c' }], limits: { wallClockMs: ms } }), ['coder']).plan!.limits.wallClockMs;
  it('to 1 minute .. 4 hours', () => {
    expect(plan(1000)).toBe(60_000);
    expect(plan(1e12)).toBe(4 * 3600_000);
    expect(plan(1_800_000)).toBe(1_800_000);
  });
});

// ---------- 13. progress lines ----------
describe('#13 progress after an answer is not a redo', () => {
  const st = (nodes: Record<string, object>, extra: object = {}) =>
    ({
      id: 'r1', kind: 'team', mode: 'live', status: 'running', costUsd: 0, pending: [], answers: [], planning: false, round: 0,
      pipeline: { nodes: [{ id: 'manager', kind: 'agent', manager: true, x: 0, y: 0 }, { id: 'manager-a', kind: 'agent', title: 'Coder', x: 0, y: 0 }], edges: [], settings: {} },
      nodes, ...extra,
    }) as never;
  it('a worker rerun after its answer says it carries on; a manager rerun says nothing about a redo', () => {
    const seen: string[] = [];
    const lines = progressLines(st({ manager: { status: 'running', attempts: 3, costUsd: 0, loops: 0 }, 'manager-a': { status: 'running', attempts: 2, costUsd: 0, loops: 0, resumedWithAnswer: true } }), seen);
    expect(lines.join('\n')).not.toMatch(/working on it again/);
    expect(lines.join('\n')).toMatch(/Coder carries on with your answer/);
  });
  it('a real redo still says so', () => {
    const lines = progressLines(st({ manager: { status: 'running', attempts: 1, costUsd: 0, loops: 0 }, 'manager-a': { status: 'running', attempts: 2, costUsd: 0, loops: 0 } }), []);
    expect(lines.join('\n')).toMatch(/Coder is working on it again \(attempt 2\)/);
  });
  it('the fold marks an attempt that follows an answer', async () => {
    const t = mk();
    const id = await approvedRun(t, boss({ a: { output: ASK1, delayMs: 0 } }));
    await t.engine.wait(id);
    await t.engine.answerUser(id, 'u1', { option: 'o1' });
    await t.engine.wait(id);
    const events = t.store.events(id);
    const i = events.findIndex((e) => e.event.type === 'node.started' && e.event.node === 'manager-a' && e.event.attempt === 2);
    expect(foldRun(events.slice(0, i + 1))!.nodes['manager-a']!.resumedWithAnswer).toBe(true);
  });
});

// ---------- 14. docs match the code ----------
describe('#14 the briefing allows the same number of asks as the parser', () => {
  it('says at most four', () => {
    const p = pipe([{ id: 'a' }], []);
    const b = briefing(p, p.nodes[0]!, [], undefined, true);
    expect(b).toMatch(/at most four such lines/);
    expect(parseUserAsks(Array.from({ length: 6 }, (_, i) => `@ASK user: q${i}?`).join('\n'))).toHaveLength(4);
  });
});

// ---------- 15. several worker answers at once ----------
describe('#15 worker answers in one batch are all or nothing', () => {
  const two = `${ASK1}\n@ASK user: Second? | options: x; y`;
  it('an invalid second answer records nothing', async () => {
    const t = mk();
    const id = await approvedRun(t, boss({ a: { output: two } }));
    await t.engine.wait(id);
    await expect(t.engine.answerUsers(id, [{ question: 'u1', option: 'o1' }, { question: 'u2', option: 'zz' }])).rejects.toThrow(/not an option/);
    expect(evs(t.store, id, 'user.answer')).toHaveLength(0);
    expect(t.store.state(id)!.pending).toHaveLength(2);
  });
  it('a valid batch is recorded together and the run resumes once', async () => {
    const t = mk();
    const id = await approvedRun(t, boss({ a: { output: two } }));
    await t.engine.wait(id);
    await t.engine.answerUsers(id, [{ question: 'u1', option: 'o1' }, { question: 'u2', option: 'o2' }]);
    const s = await t.engine.wait(id);
    expect(s.status).toBe('done');
    expect(evs(t.store, id, 'user.answer')).toHaveLength(2);
    expect(evs(t.store, id, 'run.resumed')).toHaveLength(1);
  });
  it('a duplicate in the batch is refused whole', async () => {
    const t = mk();
    const id = await approvedRun(t, boss({ a: { output: two } }));
    await t.engine.wait(id);
    await expect(t.engine.answerUsers(id, [{ question: 'u1', option: 'o1' }, { question: 'u1', option: 'o2' }])).rejects.toThrow(/twice/);
    expect(evs(t.store, id, 'user.answer')).toHaveLength(0);
  });
});

// ---------- 16. control characters ----------
describe('#16 model text never carries terminal escapes', () => {
  const ESC = '\u001b]0;pwned\u0007\u001b[31m';
  it('in worker asks, planning cards and plans', () => {
    const a = parseUserAsks(`@ASK user: Which${ESC} db? | options: pg${ESC}; lite | why: be${ESC}cause`)[0]!;
    for (const s of [a.question, a.why!, ...a.options]) expect(s).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    const q = parseQuestions(J({ questions: [card('q1', { ask: `hi${ESC}`, why: `w${ESC}`, options: [{ id: 'a', label: `A${ESC}`, detail: `d${ESC}` }], recommended: 'a' })] })).questions[0]!;
    expect(J(q)).not.toMatch(/\\u001b|\\u0007/);
    const p = parsePlan(J({ goal: `g${ESC}\nline two`, success: [`s${ESC}`], assignments: [{ bot: 'coder', goal: `c${ESC}`, expected: `e${ESC}` }] }), ['coder']).plan!;
    expect(J(p)).not.toMatch(/\\u001b|\\u0007/);
    expect(p.goal).toContain('\n'); // newlines stay
  });
});

// ---------- 17. user.ask without wait ----------
describe('#17 a user.ask without "wait" folds one way', () => {
  it('it is pending and its step awaits', () => {
    const base = { type: 'run.started', pipeline: pipe([{ id: 'm' }], []), task: 't', repo: '/r', workdir: '/w', baseSha: 'x', branch: 'b', kind: 'team' };
    const log = (...events: object[]) => events.map((event, i) => ({ runId: 'r', ts: i + 1, seq: i + 1, event })) as unknown as StoredEvent[];
    const s = foldRun(log(base, { type: 'node.started', node: 'm', attempt: 1 }, { type: 'user.ask', node: 'm', question: card('u1') }))!;
    expect(s.pending.map((q) => q.id)).toEqual(['u1']);
    expect(s.nodes.m!.status).toBe('awaiting');
  });
});

// ---------- 12. TUI card focus ----------
describe('#12 card keys need card focus', () => {
  const mkEngine = () => ({
    recordPlanAnswers: vi.fn(() => true),
    continuePlanningInBackground: vi.fn(),
    answerUser: vi.fn(async () => {}),
  });
  const st = () => ({ kind: 'team', status: 'running', planning: true, pending: [card('db', { allowOther: true })], answers: [] }) as never;
  it('digits, o and enter do nothing until the card has focus; enter gives it focus; esc gives it back', () => {
    const e = mkEngine();
    const c = new CardInput();
    expect(c.key(e as never, 'r1', st(), '2', '', () => {}).used).toBe(false);
    expect(c.key(e as never, 'r1', st(), 'o', '', () => {}).used).toBe(false);
    expect(c.key(e as never, 'r1', st(), 'enter', '', () => {})).toMatchObject({ used: true });
    expect(e.recordPlanAnswers).not.toHaveBeenCalled();
    expect(c.focus).toBe(true);
    expect(c.key(e as never, 'r1', st(), 'esc', '', () => {}).used).toBe(true);
    expect(c.focus).toBe(false);
    c.key(e as never, 'r1', st(), 'enter', '', () => {});
    expect(c.key(e as never, 'r1', st(), '2', '', () => {}).used).toBe(true);
    expect(e.recordPlanAnswers).toHaveBeenCalledWith('r1', [{ question: 'db', option: 'b', by: 'user' }]);
  });
});

describe('#14 README matches the code', () => {
  it('describes the total cap, the list count, the status codes and card focus', async () => {
    const { readFileSync } = await import('node:fs');
    const readme = readFileSync(new URL('../docs/reference.md', import.meta.url), 'utf8');
    const section = readme.split(/^## /m).find((x) => x.startsWith('Team runs')) ?? '';
    for (const s of ['planning included', 'number of waiting cards (`pending`)', '400 for bad input (including an unknown roster bot', '422 when the run cannot be created', 'returns `201', 'Press enter to give the card the keys', 'At most 4 questions per reply', '1 minute to 4 hours', 'May agents change files in the worktree?']) {
      expect(section, s).toContain(s);
    }
    expect(section).not.toContain('a one-line reason.');
  });
});
