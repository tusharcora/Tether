import { describe, expect, it } from 'vitest';
import { BUILTIN_BOTS } from '../src/crew.js';
import { approverNames, intentOf, instructionOf, limitReason, loopSpec, mayApprove, mentionsOf, runRefOf, spendToday, taskPipeline } from '../src/teams/rules.js';
import { OWNER } from '../src/teams/store.js';
import type { Team, TeamState, TeamTask } from '../src/teams/types.js';

const who = [
  { id: 'coder', name: 'Bolt' },
  { id: 'tester', name: 'Probe' },
  { id: 'planner', name: 'Scout' },
  { id: 'reviewer', name: 'Lens' },
];
const bot = (id: string) => BUILTIN_BOTS.find((b) => b.id === id)!;
const team = (o: Partial<Team> = {}): Team => ({ id: 'core', name: 'Tether core', place: 'tether', project: 'app', agents: ['coder'], people: [OWNER, { id: 'maya', name: 'Maya' }], approvers: 'any', level: 'balanced', limits: { usdPerDay: 10, runsPerDay: 3 }, learn: true, createdAt: 1, ...o });
const task = (runId: string, startedAt: number): TeamTask => ({ runId, agent: 'coder', kind: 'task', task: 't', chain: runId, base: 'abc', msg: 'm1', hops: 0, startedAt });

describe('mentions and intents (the boards’ own lines)', () => {
  it('finds mentions by name or id, in order, once each', () => {
    expect(mentionsOf('@Probe keep main green', who)).toEqual(['tester']);
    expect(mentionsOf('Run 1 done. @bolt can you make it hold? cc @Lens @Bolt', who)).toEqual(['coder', 'reviewer']);
    expect(mentionsOf('@coder fix it', who)).toEqual(['coder']);
    expect(mentionsOf('mail me@Bolting.dev or @Nobody', who)).toEqual([]);
  });
  it('reads the instruction after the addressed mention', () => {
    expect(instructionOf('Run 1 done: 2 timeouts left. @Bolt can you make the probe timeout hold up under load?', 'Bolt')).toBe('can you make the probe timeout hold up under load?');
    expect(instructionOf('Thanks @Bolt', 'Bolt')).toBe('Thanks');
  });
  it('tells a loop, a task, a review, a merge and a question apart', () => {
    expect(intentOf('keep main green: fix the failing suite one test at a time. Stop when it all passes or at $5.')).toBe('loop');
    expect(intentOf('can you make the probe timeout hold up under load?')).toBe('task');
    expect(intentOf('please fix the README typo')).toBe('task');
    expect(intentOf("what's left before PR #18 can merge?")).toBe('ask');
    expect(intentOf('merge it once that turn works.')).toBe('merge');
    expect(intentOf('review R-5A21 please')).toBe('review');
    expect(intentOf('why did the README run fail?')).toBe('ask');
  });
  it('takes a loop’s limits and check from the ask', () => {
    expect(loopSpec('keep main green. Stop when it all passes or at $5.')).toEqual({ budgetUsd: 5 });
    expect(loopSpec('keep `npm run lint` clean, 4 runs max, $2.50')).toEqual({ budgetUsd: 2.5, maxRuns: 4, command: 'npm run lint' });
  });
  it('finds the run a message refers to', () => {
    const tasks = [task('rmh1abc5a21', 1), task('rmh1abc9999', 2)];
    expect(runRefOf('review R-5A21', tasks)?.runId).toBe('rmh1abc5a21');
    expect(runRefOf('look at rmh1abc9999', tasks)?.runId).toBe('rmh1abc9999');
    expect(runRefOf('review R-0000', tasks)).toBeUndefined();
  });
});

describe('who may approve', () => {
  it('any teammate by default, else only the chosen people', () => {
    expect(mayApprove(team(), 'maya')).toBe(true);
    expect(mayApprove(team(), 'stranger')).toBe(false);
    expect(mayApprove(team({ approvers: ['maya'] }), 'owner')).toBe(false);
    expect(mayApprove(team({ approvers: ['maya'] }), 'maya')).toBe(true);
    expect(approverNames(team())).toBe('Any teammate');
    expect(approverNames(team({ approvers: ['maya', 'owner'] }))).toBe('Maya and you');
  });
});

describe('daily limits', () => {
  const now = new Date(2026, 9, 29, 15).getTime();
  const yesterday = new Date(2026, 9, 28, 23, 59).getTime();
  it('counts today’s runs and spend only', () => {
    const s: TeamState = { messages: [], tasks: [task('ra', yesterday), task('rb', now - 1000), task('rc', now - 500)], answers: [{ at: now - 100, usd: 0.25 }, { at: yesterday, usd: 9 }] };
    const cost: Record<string, number> = { ra: 5, rb: 1, rc: 0.5 };
    expect(spendToday(s, (id) => cost[id] ?? 0, now)).toEqual({ usd: 1.75, runs: 2 });
  });
  it('says why nothing new starts', () => {
    expect(limitReason(team(), { usd: 1, runs: 2 }, true)).toBeUndefined();
    expect(limitReason(team(), { usd: 1, runs: 3 }, true)).toMatch(/3 of 3 runs/);
    expect(limitReason(team(), { usd: 10, runs: 0 }, true)).toMatch(/\$10\.00 of \$10\.00/);
  });
});

describe('the task pipeline', () => {
  const gates = { build: 'npx tsc --noEmit', test: 'npm test' };
  const ids = (p: { nodes: { id: string }[] }) => p.nodes.map((n) => n.id);
  it('balanced: work, gates, ship approval; tight adds a plan approval first; loose ships on gates', () => {
    expect(ids(taskPipeline({ bot: bot('coder'), level: 'balanced', gates, budgetUsd: 4, ship: true }))).toEqual(['work', 'build', 'tests', 'ship']);
    const tight = taskPipeline({ bot: bot('coder'), level: 'tight', gates, budgetUsd: 4, ship: true });
    expect(ids(tight)).toEqual(['plan', 'approve-plan', 'work', 'build', 'tests', 'ship']);
    expect(tight.nodes.find((n) => n.id === 'plan')).toMatchObject({ role: 'coder', readOnly: true });
    expect(tight.nodes.find((n) => n.id === 'tests')).toMatchObject({ kind: 'gate', command: 'npm test', fixNode: 'work' });
    expect(tight.settings.maxCostUsd).toBe(4);
    expect(ids(taskPipeline({ bot: bot('coder'), level: 'loose', gates, budgetUsd: 4, ship: true }))).toEqual(['work', 'build', 'tests']);
    expect(ids(taskPipeline({ bot: bot('coder'), level: 'balanced', gates: {}, budgetUsd: 4, ship: false }))).toEqual(['work']);
  });
  it('a read-only agent only works; a gate bot works as an agent on its own binding', () => {
    const p = taskPipeline({ bot: bot('planner'), level: 'tight', gates, budgetUsd: 1, ship: true });
    expect(p.nodes).toEqual([expect.objectContaining({ id: 'work', kind: 'agent', role: 'planner', readOnly: true })]);
    expect(taskPipeline({ bot: bot('tester'), level: 'balanced', gates, budgetUsd: 1, ship: true }).nodes[0]).toMatchObject({ id: 'work', kind: 'agent', role: 'tester' });
  });
});
