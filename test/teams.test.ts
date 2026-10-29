import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { link, loadBindings } from '../src/bindings.js';
import { Engine } from '../src/engine.js';
import type { Exec } from '../src/exec.js';
import { Goals } from '../src/goals/loop.js';
import { addTeamLessons, loadLessons } from '../src/lessons.js';
import { Store } from '../src/store.js';
import { loadTeams, OWNER, readState, saveTeams } from '../src/teams/store.js';
import { Teams } from '../src/teams/teams.js';
import type { Level, Person, Team, TeamMessage } from '../src/teams/types.js';
import type { AgentAdapter, AgentRequest, AgentResult } from '../src/types.js';
import { Vault } from '../src/vault.js';
import { initWorkspace, updateMeta } from '../src/workspace.js';
import { makeRepo, tmp } from './helpers.js';

const LESSONS = '{"lessons":["The README is the only doc","Maya said use tabs"]}';

/** Answers questions and reviews from a script. */
class Talk implements AgentAdapter {
  readonly id = 'talk';
  readonly reportsCost = true;
  readonly supportsResume = false;
  prompts: string[] = [];
  reply = 'It says fixture.';
  async detect() {
    return { ok: true };
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    this.prompts.push(req.prompt);
    return { output: req.nodeId === 'lessons' ? LESSONS : this.reply, exitCode: 0, costUsd: 0.01 };
  }
}
/** Does the work: a writing step changes fix.txt, so the gate passes and there is something to ship. */
class Writer implements AgentAdapter {
  readonly id = 'writer';
  readonly reportsCost = true;
  readonly supportsResume = false;
  prompts: string[] = [];
  reply = 'Fixed it.';
  n = 0;
  async detect() {
    return { ok: true };
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    this.prompts.push(req.prompt);
    if (req.nodeId === 'lessons') return { output: LESSONS, exitCode: 0, costUsd: 0 };
    if (!req.readOnly) writeFileSync(join(req.cwd, 'fix.txt'), `fix ${++this.n}\n`);
    return { output: this.reply, exitCode: 0, costUsd: 0 };
  }
}

const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

function rig(o: { level?: Level; limits?: Team['limits']; learn?: boolean; people?: Person[]; approvers?: Team['approvers'] } = {}) {
  const home = tmp('home-');
  const repo = makeRepo();
  const bare = tmp('bare-');
  g(bare, 'init', '-q', '--bare');
  g(repo, 'remote', 'add', 'origin', bare);
  initWorkspace(home, repo, { id: 'app', name: 'App' });
  updateMeta(repo, { test: 'test -f fix.txt' });
  const talk = new Talk();
  const writer = new Writer();
  for (const b of ['coder', 'tester']) link(home, b, { agent: 'writer' });
  for (const b of ['reviewer', 'planner']) link(home, b, { agent: 'talk' });
  const registry = new AdapterRegistry().register(new MockAdapter()).register(talk).register(writer);
  const store = Store.open(':memory:');
  const vault = new Vault(tmp('vault-'));
  const engine = new Engine(store, { home, registry, vault, bindings: () => loadBindings(home) });
  const calls: string[][] = [];
  const exec: Exec = async (_cmd, args) => {
    calls.push(args);
    if (args[1] === 'create') return { code: 0, stdout: 'https://github.com/o/r/pull/7\n', stderr: '' };
    if (args[1] === 'view') return { code: 0, stdout: '{"state":"OPEN","statusCheckRollup":[]}', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  // eslint-disable-next-line prefer-const
  let teams: Teams;
  const goals = new Goals({ home, store, engine, registry, hooks: { start: (x, p) => teams.loopRun(x, p), blocked: (x) => teams.blocked(x) } });
  teams = new Teams({ home, store, engine, registry, goals, vault, exec });
  let team = teams.create({ name: 'Core', place: 'tether', project: 'app', agents: ['coder', 'reviewer', 'tester', 'planner'], level: o.level ?? 'balanced', ...(o.limits ? { limits: o.limits } : {}), ...(o.learn === false ? { learn: false } : {}) });
  if (o.people || o.approvers) {
    team = { ...team, people: o.people ?? team.people, approvers: o.approvers ?? team.approvers };
    const f = loadTeams(home);
    saveTeams(home, { ...f, teams: [team] });
  }
  const idle = async () => {
    for (let i = 0; i < 3; i++) {
      await teams.idle();
      await goals.idle();
    }
  };
  const msgs = (): TeamMessage[] => readState(home, team.id).messages;
  const tasks = () => readState(home, team.id).tasks;
  const until = async <T>(f: () => T | undefined | false): Promise<T> => {
    for (let i = 0; i < 400; i++) {
      const v = f();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timed out');
  };
  const post = (text: string, from: Person = OWNER) => teams.post(team.id, { text, from });
  const card = (kind: string, status?: string) => msgs().find((m) => m.card?.kind === kind && (!status || (m.card as { status?: string }).status === status));
  /** A task, run until it waits or ends; its run id. */
  const runTask = async (text: string, nth = tasks().length): Promise<string> => {
    post(text);
    const runId = await until(() => tasks()[nth]?.runId);
    await engine.wait(runId);
    await idle();
    return runId;
  };
  return { home, repo, bare, talk, writer, store, engine, goals, teams, team, calls, idle, msgs, tasks, until, post, card, runTask };
}

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
