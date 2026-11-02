import { describe, expect, it } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { attentionFor } from '../src/attention.js';
import { Engine } from '../src/engine.js';
import { planConflict } from '../src/runLabels.js';
import { Store } from '../src/store.js';
import type { TeamPlan } from '../src/types.js';
import { makeRepo, tmp } from './helpers.js';
import { seedRun } from './home-helpers.js';

const plan = (o: Partial<TeamPlan> = {}): TeamPlan => ({ goal: 'Produce a proposed README in the report', success: [], assignments: [{ bot: 'planner', goal: 'write the README text in your report', mode: 'read' }], limits: { allowWrites: false }, answers: [], ...o });

describe('the plan check: constraints that contradict the goal are flagged before the run', () => {
  it("the owner's README run: read-only, but the task changes a file", () => {
    expect(planConflict(plan(), 'Update README.md to match the current app')).toMatch(/read-only, but the task changes files/);
    // writes on, yet no step may change files
    expect(planConflict(plan({ limits: { allowWrites: true } }), 'Fix the login bug')).toMatch(/no step in the plan may change files/);
    // success criteria that need a change count too
    expect(planConflict(plan({ success: ['README.md is updated'] }), 'Bring the docs up to date')).toBeDefined();
  });

  it('a plan that can do its task, or a task that changes nothing, passes', () => {
    expect(planConflict(plan({ limits: { allowWrites: true }, assignments: [{ bot: 'coder', goal: 'edit README.md', mode: 'write' }] }), 'Update README.md')).toBeUndefined();
    expect(planConflict(plan(), 'Explain how the auth middleware works')).toBeUndefined();
    expect(planConflict(plan(), 'Review the change in PR 12 and report problems')).toBeUndefined();
  });

  it('Needs you shows the plan check, with why and Allow edits, instead of plain Plan ready', () => {
    const s = Store.open(':memory:');
    seedRun(s, 't1', { kind: 'team', task: 'Update README.md to match the current app' });
    s.append('t1', { type: 'plan.ready', plan: plan() });
    const [item] = attentionFor({ state: s.state('t1')!, events: s.eventsNoChunks('t1'), live: true, lastTs: s.lastTs('t1') });
    expect(item).toMatchObject({ kind: 'plan_conflict', actions: ['allow_edits', 'review'] });
    expect(item!.title).toMatch(/^Check the plan: the plan is read-only, but the task changes files/);
  });

  it('Allow edits on a waiting plan plans again with writes on', async () => {
    const home = tmp('home-');
    const store = Store.open(':memory:');
    const engine = new Engine(store, { home, registry: new AdapterRegistry().register(new MockAdapter()), bindings: () => ({ orchestrator: { agent: 'mock' } }) });
    const writes = { id: 'writes', ask: 'w', options: [{ id: 'yes', label: 'y' }, { id: 'no', label: 'n' }], recommended: 'yes' };
    const id = await engine.startTeam({ task: 'Update README.md', repo: makeRepo(), workspace: false, roster: ['coder'], mock: { questions: [[writes]], plan: { goal: 'update the readme', assignments: [{ bot: 'coder', goal: 'edit README.md', mode: 'write' }] } } });
    await engine.answerPlan(id, [{ question: 'writes', option: 'no', by: 'user' }]);
    expect(planConflict(store.state(id)!.plan!, 'Update README.md')).toBeDefined();
    await engine.allowEdits(id);
    const s = store.state(id)!;
    expect(s.plan!.limits.allowWrites).toBe(true);
    expect(s.plan!.assignments[0]!.mode).toBe('write');
    expect(planConflict(s.plan!, s.task)).toBeUndefined();
    expect(store.events(id).map((e) => e.event.type)).toContain('plan.reopened');
  });
});
