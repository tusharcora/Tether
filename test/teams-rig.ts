/** The Teams test rig: a repo with an origin, four agents on two scripted adapters, a fake `gh`, and one team. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { link, loadBindings } from '../src/bindings.js';
import { Engine } from '../src/engine.js';
import type { Exec } from '../src/exec.js';
import { Goals } from '../src/goals/loop.js';
import { Store } from '../src/store.js';
import { loadTeams, OWNER, readState, saveTeams } from '../src/teams/store.js';
import { Teams } from '../src/teams/teams.js';
import type { Level, Person, Place, Team, TeamMessage } from '../src/teams/types.js';
import type { AgentAdapter, AgentRequest, AgentResult } from '../src/types.js';
import { Vault } from '../src/vault.js';
import { initWorkspace, updateMeta } from '../src/workspace.js';
import { makeRepo, tmp } from './helpers.js';

export const LESSONS = '{"lessons":["The README is the only doc","Maya said use tabs"]}';

/** Answers questions and reviews from a script. */
export class Talk implements AgentAdapter {
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
export class Writer implements AgentAdapter {
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

export const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

export function rig(o: { place?: Place; level?: Level; limits?: Team['limits']; learn?: boolean; people?: Person[]; approvers?: Team['approvers']; autofixing?: (runId: string) => boolean; prView?: string } = {}) {
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
    if (args[1] === 'view') return { code: 0, stdout: o.prView ?? '{"state":"OPEN","statusCheckRollup":[]}', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  // eslint-disable-next-line prefer-const
  let teams: Teams;
  const goals = new Goals({ home, store, engine, registry, hooks: { start: (x, p) => teams.loopRun(x, p), blocked: (x) => teams.blocked(x), decided: (x, a) => teams.goalDecided(x, a) } });
  teams = new Teams({ home, store, engine, registry, goals, vault, exec, ...(o.autofixing ? { autofixing: o.autofixing } : {}) });
  let team = teams.create({ name: 'Core', place: o.place ?? 'tether', project: 'app', agents: ['coder', 'reviewer', 'tester', 'planner'], level: o.level ?? 'balanced', ...(o.limits ? { limits: o.limits } : {}), ...(o.learn === false ? { learn: false } : {}) });
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
  /** The team as stored now (people and approvers change). */
  const now = (): Team => loadTeams(home).teams.find((t) => t.id === team.id)!;
  return { home, repo, bare, talk, writer, store, engine, goals, teams, team, calls, idle, msgs, tasks, until, post, card, runTask, now, registry };
}

