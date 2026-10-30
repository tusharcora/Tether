import { describe, expect, it } from 'vitest';
import { addTeamLessons, loadLessons } from '../src/lessons.js';
import { OWNER } from '../src/teams/store.js';
import { g, rig } from './teams-rig.js';

describe('a ping', () => {
  it('gets one answer from the agent, as itself, with its memory and the message fenced; nothing runs', async () => {
    const r = rig();
    addTeamLessons(r.home, 'reviewer', r.team.id, 'r0', ['The README is the only doc']);
    r.post('@Lens what does the README say?');
    await r.idle();
    const [, a] = r.msgs();
    expect(a).toMatchObject({ from: { kind: 'agent', id: 'reviewer', name: 'Lens' }, text: 'It says fixture.' });
    expect(a!.pending).toBeUndefined();
    const p = r.talk.prompts.at(-1)!;
    expect(p).toContain('You are Lens, an agent in the team "Core"');
    expect(p).toMatch(/<memory>\n- The README is the only doc\n<\/memory>/);
    expect(p).toContain('<message>\nyou: what does the README say?\n</message>');
    expect(r.store.listRows()).toHaveLength(0);
  });

  it('a message that mentions no team agent starts nothing', async () => {
    const r = rig();
    r.post('hello team, @Ghost fix it');
    await r.idle();
    expect(r.msgs()).toHaveLength(1);
    expect(r.store.listRows()).toHaveLength(0);
    expect(() => r.post('hi', { id: 'stranger', name: 'S' })).toThrow(/only people in this team/);
  });

  it('a proposal in the answer becomes a card that starts a run on that agent', async () => {
    const r = rig();
    r.talk.reply = 'That needs a run.\n```tether\n{"proposals":[{"kind":"team","task":"tidy the README","why":"it is out of date"}]}\n```';
    r.post('@Lens is the README any good?');
    await r.idle();
    const m = r.card('proposal')!;
    expect(m.card).toMatchObject({ agent: 'reviewer', task: 'tidy the README', status: 'proposed' });
    const done = await r.teams.decide(r.team.id, m.id, { action: 'start', by: OWNER });
    expect(done.card).toMatchObject({ status: 'started', runId: expect.any(String) });
    expect(r.store.state((done.card as { runId: string }).runId)!.pipeline.nodes.map((n) => n.id)).toEqual(['work']);
  });
});

describe('a task', () => {
  it('balanced: runs on the agent’s binding, then the gates, then a ship card; approving opens a PR', async () => {
    const r = rig();
    const runId = await r.runTask('@Bolt fix the thing');
    const s = r.store.state(runId)!;
    expect(s.pipeline.nodes.map((n) => n.id)).toEqual(['work', 'tests', 'ship']);
    expect(r.writer.prompts.length).toBeGreaterThan(0);
    expect(r.msgs()[1]).toMatchObject({ from: { name: 'Bolt' }, text: expect.stringMatching(/^On it\. Started R-/), card: { kind: 'run', runId } });
    const ship = r.card('approval')!;
    expect(ship.card).toMatchObject({ what: 'ship', status: 'pending', node: 'ship', detail: expect.stringContaining('test -f fix.txt passed') });
    expect(r.teams.view(r.team.id).status).toBe('needs');
    // paused at the approval is not the end of the run: nothing is reported as failed or done yet
    expect(r.msgs().filter((m) => /failed|^Done/.test(m.text))).toEqual([]);
    await r.teams.decide(r.team.id, ship.id, { action: 'approve', by: OWNER });
    await r.engine.wait(runId);
    await r.idle();
    expect(r.calls.find((c) => c[1] === 'create')).toEqual(['pr', 'create', '--head', s.branch, '--title', 'fix the thing', '--body', expect.stringContaining('Opened by Bolt')]);
    expect(g(r.bare, 'rev-parse', s.branch)).toBe(g(r.repo, 'rev-parse', s.branch));
    expect(r.card('pr')!.card).toMatchObject({ number: 7, url: 'https://github.com/o/r/pull/7' });
    expect(r.msgs()[1]!.card).toMatchObject({ status: 'done', steps: [{ id: 'work', status: 'done' }, { id: 'tests', status: 'done' }, { id: 'ship', status: 'done' }] });
  });

  it('tight: a plan to approve comes first', async () => {
    const r = rig({ level: 'tight' });
    const runId = await r.runTask('@Bolt fix the thing');
    expect(r.store.state(runId)!.pipeline.nodes.map((n) => n.id)).toEqual(['plan', 'approve-plan', 'work', 'tests', 'ship']);
    expect(r.card('approval')!.card).toMatchObject({ what: 'plan', node: 'approve-plan', detail: 'Fixed it.' });
  });

  it('loose: ships on its own when the gates pass', async () => {
    const r = rig({ level: 'loose' });
    await r.runTask('@Bolt fix the thing');
    expect(r.card('approval')).toBeUndefined();
    expect(r.card('pr')).toBeDefined();
  });

  it('only the chosen approvers may approve; one decision only, from any surface', async () => {
    const r = rig({ people: [OWNER, { id: 'maya', name: 'Maya' }], approvers: ['maya'] });
    const runId = await r.runTask('@Bolt fix the thing');
    const ship = r.card('approval')!;
    await expect(r.teams.decide(r.team.id, ship.id, { action: 'approve', by: OWNER })).rejects.toThrow(/Only Maya can approve here/);
    expect(r.teams.mayApproveRun(runId, 'owner')).toBe(false);
    expect(r.teams.mayApproveRun('r-not-a-team-run', 'owner')).toBe(true);
    // decided on the run page: the card follows, and a second decision is refused
    r.engine.approve(runId, 'ship', true, 'Maya');
    expect(r.card('approval')!.card).toMatchObject({ status: 'approved', by: 'Maya' });
    await expect(r.teams.decide(r.team.id, ship.id, { action: 'approve', by: { id: 'maya', name: 'Maya' } })).rejects.toThrow(/already approved/);
  });

  it('a rejection is reworked once on the same branch with the reason, then the agent asks', async () => {
    const r = rig();
    const first = await r.runTask('@Bolt fix the thing');
    await r.teams.decide(r.team.id, r.card('approval', 'pending')!.id, { action: 'reject', by: OWNER, reason: 'needs a test' });
    await r.engine.wait(first);
    await r.idle();
    const second = await r.until(() => r.tasks()[1]?.runId);
    await r.engine.wait(second);
    await r.idle();
    const s2 = r.store.state(second)!;
    expect(r.tasks()[1]).toMatchObject({ kind: 'rework', chain: first, base: r.store.state(first)!.baseSha });
    expect(s2.baseSha).toBe(g(r.repo, 'rev-parse', r.store.state(first)!.branch));
    expect(s2.task).toContain('<reason>\nneeds a test\n</reason>');
    await r.teams.decide(r.team.id, r.card('approval', 'pending')!.id, { action: 'reject', by: OWNER });
    await r.engine.wait(second);
    await r.idle();
    expect(r.msgs().at(-1)!.text).toMatch(/^Rejected again\. Tell me what to change/);
    expect(r.tasks()).toHaveLength(2);
  });
});

describe('hand-offs', () => {
  it('work goes on the earlier run’s branch; a review reads the chain’s diff and starts no run', async () => {
    const r = rig({ level: 'loose' });
    const first = await r.runTask('@Bolt fix the thing');
    const ref = `R-${first.slice(-4).toUpperCase()}`;
    const second = await r.runTask(`@Probe continue ${ref}: add a note`);
    expect(r.tasks()[1]).toMatchObject({ agent: 'tester', chain: first });
    expect(r.store.state(second)!.baseSha).toBe(g(r.repo, 'rev-parse', r.store.state(first)!.branch));
    expect(r.msgs().find((m) => m.run === second && m.card?.kind === 'run')!.text).toBe(`Taking it. Started R-${second.slice(-4).toUpperCase()} on ${ref}'s branch.`);
    r.talk.reply = 'Small and fine.\nVERDICT: PASS';
    const runs = r.store.listRows().length;
    r.post(`@Lens review ${ref}`);
    await r.idle();
    expect(r.store.listRows()).toHaveLength(runs);
    expect(r.talk.prompts.at(-1)).toMatch(/<diff>[\s\S]*fix\.txt[\s\S]*<\/diff>/);
    expect(r.msgs().at(-1)).toMatchObject({ from: { name: 'Lens' }, text: 'Small and fine.\nVERDICT: PASS', run: first });
  });
});

describe('loop work', () => {
  it('becomes a goal owned by the agent and the team, reports each run, and asks to ship when met', async () => {
    const r = rig();
    r.post('@Probe keep `test -f fix.txt` passing, $2, 3 runs');
    const goal = await r.until(() => r.goals.db.list()[0]);
    expect(goal).toMatchObject({ team: r.team.id, agent: 'tester', approval: 'auto', budgetUsd: 2, maxRuns: 3, check: { kind: 'command', command: 'test -f fix.txt' } });
    await r.until(() => r.goals.db.must(goal.id).status === 'met');
    await r.idle();
    const texts = r.msgs().map((m) => m.text);
    expect(texts).toContain('On it. I made it a loop: the goal is `test -f fix.txt` passing, limit $2.00 or 3 runs. I\'ll post after each run.');
    expect(texts.some((t) => /^Run 1 done: check failing → passing/.test(t))).toBe(true);
    expect(texts).toContain('Loop met: `test -f fix.txt` passes.');
    const ship = r.card('approval', 'pending')!;
    expect(ship.card).toMatchObject({ what: 'ship', goalId: goal.id });
    await r.teams.decide(r.team.id, ship.id, { action: 'approve', by: OWNER });
    await r.idle();
    expect(r.card('pr')).toBeDefined();
    expect(r.tasks()[0]).toMatchObject({ kind: 'loop', goal: goal.id });
  });
});

describe('a goal made elsewhere', () => {
  it('a chat goal on a team runs as its agent, gets its card in the channel, and asks to ship when done', async () => {
    const r = rig();
    const goal = r.goals.create({ id: 'gchat', workspace: 'app', title: 'Write fix.txt', kind: 'tracker', status: 'paused', approval: 'ask', workflow: 'team', createdAt: Date.now(), spentUsd: 0, team: r.team.id, agent: 'coder', origin: { kind: 'chat', chat: 'c1', message: 'm1' } });
    r.goals.begin(goal.id, 'write fix.txt');
    await r.until(() => r.goals.db.must(goal.id).status === 'met');
    await r.idle();
    expect(r.card('loop')).toMatchObject({ text: 'Goal: Write fix.txt', from: { kind: 'tether' } });
    expect(r.msgs().map((m) => m.text)).toContain('Done: Write fix.txt.');
    expect(r.card('approval', 'pending')!.card).toMatchObject({ what: 'ship', goalId: goal.id });
    expect(r.tasks()[0]).toMatchObject({ kind: 'loop', goal: goal.id, agent: 'coder' });
  });
});

describe('merging', () => {
  it('merges the team’s PR when an allowed approver says so and its checks pass; nobody else can', async () => {
    const r = rig({ level: 'loose', people: [OWNER, { id: 'maya', name: 'Maya' }], approvers: ['owner'] });
    await r.runTask('@Bolt fix the thing');
    r.post('@Bolt merge it', { id: 'maya', name: 'Maya' });
    await r.idle();
    expect(r.msgs().at(-1)!.text).toBe('Only you can tell me to merge here.');
    expect(r.calls.some((c) => c[1] === 'merge')).toBe(false);
    r.post('@Bolt merge it once the checks pass');
    await r.idle();
    expect(r.calls.find((c) => c[1] === 'merge')).toEqual(['pr', 'merge', 'https://github.com/o/r/pull/7', '--merge']);
    expect(r.msgs().at(-1)!.text).toBe('Merged PR #7.');
    expect(r.card('pr')!.card).toMatchObject({ merged: true });
  });
});

describe('limits and memory', () => {
  it('once the day’s runs are used, nothing new starts and the agent says so', async () => {
    const r = rig({ level: 'loose', limits: { usdPerDay: 10, runsPerDay: 1 } });
    await r.runTask('@Bolt fix the thing');
    r.post('@Bolt fix another thing');
    await r.idle();
    expect(r.msgs().at(-1)!.text).toMatch(/Today's limit is reached \(1 of 1 runs\)/);
    expect(r.store.listRows()).toHaveLength(1);
    expect(r.teams.view(r.team.id).spend).toEqual({ usd: 0, runs: 1 });
  });

  it('after a task the agent keeps a few lessons, never quotes; a team can turn learning off', async () => {
    const on = rig({ level: 'loose' });
    await on.runTask('@Bolt fix the thing');
    expect(loadLessons(on.home, 'coder').map((l) => [l.text, l.team])).toEqual([['The README is the only doc', on.team.id]]);
    const off = rig({ level: 'loose', learn: false });
    await off.runTask('@Bolt fix the thing');
    expect(loadLessons(off.home, 'coder')).toEqual([]);
  });
});
