/** Spending caps (spec 2026-10-30-optional-run-budgets): off by default, so cost never stops work; on = the old caps. */
import { describe, expect, it } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { Engine } from '../src/engine.js';
import { preflight } from '../src/pipeline.js';
import { capsOn, savePrefs } from '../src/prefs.js';
import { Store } from '../src/store.js';
import { limitReason } from '../src/teams/rules.js';
import type { Team } from '../src/teams/types.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const twoSteps = (settings: Record<string, unknown> = { maxCostUsd: 0.5 }) =>
  pipe(
    [
      { id: 'a', role: 'planner', readOnly: true, mock: { costUsd: 0.6 } },
      { id: 'b', role: 'coder', mock: { costUsd: 0.6 } },
    ],
    [['a', 'b']],
    settings,
  );

describe('the setting', () => {
  it('is off unless saved on', () => {
    const home = tmp('home-');
    expect(capsOn(home)).toBe(false);
    savePrefs(home, { spendingCaps: true });
    expect(capsOn(home)).toBe(true);
  });
});

describe('workflow runs', () => {
  it('off: a pipeline’s maxCostUsd stops nothing and no call gets a budget', async () => {
    const { engine, mock } = setup();
    const s = await engine.wait(await engine.start({ pipeline: twoSteps(), task: 't', repo: makeRepo() }));
    expect(s.status).toBe('done');
    expect(s.costUsd).toBeCloseTo(1.2);
    expect(s.capsOn).toBe(false);
    expect(s.pipeline.settings.maxCostUsd).toBeUndefined();
    expect(mock.calls.map((c) => c.budgetUsd)).toEqual([undefined, undefined]);
  });

  it('on: the cap stops the run and each call gets what is left', async () => {
    const { engine, mock, home } = setup();
    savePrefs(home, { spendingCaps: true });
    const s = await engine.wait(await engine.start({ pipeline: twoSteps(), task: 't', repo: makeRepo() }));
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/budget exhausted/);
    expect(s.capsOn).toBe(true);
    expect(mock.calls.map((c) => c.budgetUsd)).toEqual([0.5]);
  });

  it('a run keeps the setting it started with', async () => {
    const gated = () =>
      pipe(
        [
          { id: 'ok', kind: 'approval' },
          { id: 'a', role: 'planner', readOnly: true, mock: { costUsd: 0.6 } },
          { id: 'b', role: 'coder', mock: { costUsd: 0.6 } },
        ],
        [['ok', 'a'], ['a', 'b']],
        { maxCostUsd: 0.5 },
      );
    // started off, turned on while it waits: still no cap
    const off = setup();
    const id = await off.engine.start({ pipeline: gated(), task: 't', repo: makeRepo() });
    expect((await off.engine.wait(id)).status).toBe('paused');
    savePrefs(off.home, { spendingCaps: true });
    off.engine.approve(id, 'ok', true);
    await off.engine.resume(id);
    expect((await off.engine.wait(id)).status).toBe('done');
    // started on, turned off while it waits: the cap still stops it
    const on = setup();
    savePrefs(on.home, { spendingCaps: true });
    const id2 = await on.engine.start({ pipeline: gated(), task: 't', repo: makeRepo() });
    expect((await on.engine.wait(id2)).status).toBe('paused');
    savePrefs(on.home, { spendingCaps: false });
    on.engine.approve(id2, 'ok', true);
    await on.engine.resume(id2);
    const s = await on.engine.wait(id2);
    expect(s.error).toMatch(/budget exhausted/);
    expect(s.nodes.b!.status).toBe('skipped');
  });

  it('an explicit cap (capsOn: true at start) is enforced with the setting off', async () => {
    const { engine } = setup();
    const s = await engine.wait(await engine.start({ pipeline: twoSteps(), task: 't', repo: makeRepo(), capsOn: true }));
    expect(s.error).toMatch(/budget exhausted/);
  });

  it('preflight only warns about an unenforceable cap when caps are on', () => {
    const reg = new AdapterRegistry().register(new MockAdapter());
    const noCost = { ...new MockAdapter(), id: 'nocost', reportsCost: false } as never;
    reg.register(noCost);
    const p = pipe([{ id: 'a', agent: 'nocost' }], [], { maxCostUsd: 1 });
    expect(preflight(p, reg).some((i) => /cannot be enforced/.test(i.message))).toBe(true);
    expect(preflight(p, reg, false).some((i) => /cannot be enforced/.test(i.message))).toBe(false);
  });
});

describe('team runs', () => {
  const mk = (caps?: boolean) => {
    const home = tmp('home-');
    if (caps) savePrefs(home, { spendingCaps: true });
    const mock = new MockAdapter();
    const store = Store.open(':memory:');
    const engine = new Engine(store, { home, registry: new AdapterRegistry().register(mock), bindings: () => ({ orchestrator: { agent: 'mock' }, manager: { agent: 'mock' } }) });
    return { home, mock, store, engine, repo: makeRepo() };
  };
  const card = (id: string) => ({ id, ask: `ask ${id}`, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommended: 'b' });
  const plan = { goal: 'g', assignments: [{ bot: 'coder', goal: 'c' }], limits: { maxCostUsd: 3 } };

  it('off: no default cap, no planning budget, and planning never stops on cost', async () => {
    const t = mk();
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], mock: { costUsd: 6, questions: [[card('q1')]], plan } as never });
    await t.engine.answerPlan(id, [{ question: 'q1', option: 'a', by: 'user' }]);
    const s = t.store.state(id)!;
    expect(s.status).toBe('running');
    expect(s.capsOn).toBe(false);
    expect(s.plan!.limits).not.toHaveProperty('maxCostUsd');
    expect(t.mock.calls.filter((c) => c.nodeId.startsWith('plan.')).map((c) => c.budgetUsd)).toEqual([undefined, undefined]);
    await t.engine.approveTeamPlan(id, true);
    expect(t.store.state(id)!.pipeline.settings.maxCostUsd).toBeUndefined();
    t.engine.stop(id);
    await t.engine.wait(id);
  });

  it('on: the default cap and the planning budget apply', async () => {
    const t = mk(true);
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], mock: { costUsd: 6, questions: [[card('q1')]], plan } as never });
    const s = t.store.state(id)!;
    expect(s.capsOn).toBe(true);
    expect(s.error).toMatch(/planning used up the budget/);
    expect(t.mock.calls[0]!.budgetUsd).toBe(5);
  });

  it('an explicit --budget is honoured with the setting off', async () => {
    const t = mk();
    const id = await t.engine.startTeam({ task: 'x', repo: t.repo, workspace: false, roster: ['coder'], budgetUsd: 1.25, yes: true, mock: { questions: [], plan } as never });
    const s = t.store.state(id)!;
    expect(s.capsOn).toBe(true);
    expect(s.plan!.limits.maxCostUsd).toBe(1.25);
    expect(t.mock.calls[0]!.budgetUsd).toBe(1.25);
  });
});

describe('team daily limits', () => {
  const team = { limits: { usdPerDay: 10, runsPerDay: 3 } } as Team;
  it('off: the daily $ limit blocks nothing; runs per day still do', () => {
    expect(limitReason(team, { usd: 50, runs: 0 }, false)).toBeUndefined();
    expect(limitReason(team, { usd: 0, runs: 3 }, false)).toMatch(/3 of 3 runs/);
  });
  it('on: the daily $ limit blocks', () => {
    expect(limitReason(team, { usd: 50, runs: 0 }, true)).toMatch(/\$50\.00 of \$10\.00/);
  });
});
