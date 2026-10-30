import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { link } from '../src/bindings.js';
import { loadTeams, OWNER, readState, squadsDir } from '../src/teams/store.js';
import { loadTg } from '../src/teams/telegram/store.js';
import type { AgentAdapter, AgentRequest, AgentResult } from '../src/types.js';
import { tmp } from './helpers.js';
import { rig } from './teams-rig.js';

const FAIL = 'One thing: //evil.com still counts as same-site. @Bolt can you reject those too?\nVERDICT: FAIL';
const PASS = 'Checked it. Good to go from me.\nVERDICT: PASS';
/** Lens reviews with `replies` in order (then the last again); everything else as the rig's Talk does. */
function reviews(r: ReturnType<typeof rig>, replies: string[]) {
  let n = 0;
  const run = r.talk.run.bind(r.talk);
  r.talk.run = async (req: AgentRequest) => {
    if (/<diff>/.test(req.prompt)) r.talk.reply = replies[Math.min(n++, replies.length - 1)]!;
    return run(req);
  };
}
/** Bolt's work waits until `release()`, so Bolt is busy meanwhile. */
function hold(r: ReturnType<typeof rig>) {
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  const run = r.writer.run.bind(r.writer);
  r.writer.run = async (req: AgentRequest) => (req.nodeId === 'work' && !req.readOnly ? gate.then(() => run(req)) : run(req));
  return () => release();
}

describe('teams become squads on disk (spec §2.6)', () => {
  it('moves teams/ to squads/ once with every file, keeps the same ids, and twice changes nothing', () => {
    const home = tmp('home-');
    const old = join(home, 'teams');
    mkdirSync(old);
    const team = { id: 'core-1a2b', name: 'Core', place: 'telegram', link: '-100', project: 'app', agents: ['coder'], people: [OWNER], approvers: ['owner'], level: 'balanced', limits: { usdPerDay: 10, runsPerDay: 20 }, learn: true, createdAt: 1 };
    writeFileSync(join(old, 'teams.json'), JSON.stringify({ teams: [team], agents: { coder: { specialty: 'code' } } }));
    const state = { messages: [{ id: 'm1', at: 1, from: { kind: 'person', id: 'owner', name: 'you' }, text: '@Bolt hi' }], tasks: [{ runId: 'r1', agent: 'coder', kind: 'task', task: 'x', chain: 'r1', base: 'a', msg: 'm1', hops: 0, startedAt: 1 }], answers: [] };
    writeFileSync(join(old, 'core-1a2b.json'), JSON.stringify(state));
    writeFileSync(join(old, 'telegram.json'), JSON.stringify({ offset: 9, codes: [], teams: { 'core-1a2b': { pin: 5, msgs: { m1: 77 } } } }));
    expect(loadTeams(home)).toEqual({ teams: [team], agents: { coder: { specialty: 'code' } } });
    expect(existsSync(old)).toBe(false);
    expect(readdirSync(join(home, 'squads')).sort()).toEqual(['core-1a2b.json', 'teams.json', 'telegram.json']);
    expect(readState(home, 'core-1a2b')).toMatchObject(state);
    expect(loadTg(home)).toMatchObject({ offset: 9, teams: { 'core-1a2b': { pin: 5, msgs: { m1: 77 } } } });
    expect(squadsDir(home)).toBe(join(home, 'squads'));
    expect(loadTeams(home).teams).toEqual([team]);
  });

  it('a home that already has squads/ keeps it and leaves teams/ alone', () => {
    const home = tmp('home-');
    mkdirSync(join(home, 'teams'));
    mkdirSync(join(home, 'squads'));
    writeFileSync(join(home, 'teams', 'teams.json'), '{"teams":[],"agents":{"old":{}}}');
    writeFileSync(join(home, 'squads', 'teams.json'), '{"teams":[],"agents":{"new":{}}}');
    expect(loadTeams(home).agents).toEqual({ new: {} });
    expect(existsSync(join(home, 'teams', 'teams.json'))).toBe(true);
  });
});

describe('a squad ask is a ticket (spec §2.5)', () => {
  it('In progress with its run, In review at the ship card, Done once Ship it merges; the activity reads like the squad', async () => {
    const r = rig();
    reviews(r, [PASS]);
    const runId = await r.runTask('@Bolt fix the sign-in redirect');
    const [t] = r.goals.db.list();
    expect(t).toMatchObject({ title: 'Fix the sign-in redirect', type: 'bugfix', kind: 'tracker', squad: r.team.id, assignee: { kind: 'agent', id: 'coder' }, reviewer: { kind: 'agent', id: 'reviewer' }, origin: { kind: 'squad', squad: r.team.id, message: r.msgs()[0]!.id }, stage: 'in_review', num: 1 });
    expect(r.goals.key(t!.id)).toBe('APP-1');
    expect(r.goals.db.items(t!.id)).toEqual([expect.objectContaining({ kind: 'run', runId })]);
    expect(r.tasks()[0]).toMatchObject({ ticket: t!.id });
    // Lens's verdict lands on the ship card
    const ship = r.card('approval', 'pending')!;
    expect(ship.card).toMatchObject({ review: { by: 'Lens', pass: true } });
    expect(r.msgs().find((m) => m.from.name === 'Lens' && !m.pending)).toMatchObject({ text: 'Checked it. Good to go from me.', report: PASS, run: runId, ticket: t!.id });
    await r.teams.decide(r.team.id, ship.id, { action: 'approve', by: OWNER });
    await r.engine.wait(runId);
    await r.idle();
    const done = r.goals.db.must(t!.id);
    expect(done).toMatchObject({ stage: 'done', prs: [{ number: 7, merged: true, runId }], endedAt: expect.any(Number) });
    expect(done.activity!.map((a) => `${a.who.name}: ${a.text}`)).toEqual([
      'You: asked for this in # Core',
      'Bolt: On it.',
      'Bolt: Done, 1 file changed, tests pass. @Lens mind reviewing it?',
      'Lens: Checked it. Good to go from me.',
      'Tether: opened PR #7',
      'Tether: PR #7 merged',
    ]);
    expect(done.activity![3]).toMatchObject({ verdict: 'pass' });
  });

  it('a failed review hands the work back in Lens’s thread; the rework replaces the waiting ship card', async () => {
    const r = rig();
    reviews(r, [FAIL, PASS]);
    const first = await r.runTask('@Bolt fix the sign-in redirect');
    const lens = await r.until(() => r.msgs().find((m) => m.from.name === 'Lens' && !m.pending && /evil/.test(m.text)));
    expect(lens.thread).toBeUndefined();
    expect(lens.text).toBe('One thing: //evil.com still counts as same-site. @Bolt can you reject those too?');
    const second = await r.until(() => r.tasks()[1]?.runId);
    await r.engine.wait(second);
    await r.idle();
    expect(r.tasks()[1]).toMatchObject({ kind: 'rework', chain: first, thread: lens.id, ticket: r.tasks()[0]!.ticket });
    const inThread = r.msgs().filter((m) => m.thread === lens.id).map((m) => `${m.from.name}: ${m.text}`);
    expect(inThread).toEqual(['Bolt: Good catch, on it.', 'Bolt: Done, 1 file changed, tests pass. @Lens mind reviewing it?', 'Lens: Checked it. Good to go from me.']);
    // the hand-off chips: Bolt handed to Lens for a review, Lens handed back
    expect(r.msgs().find((m) => m.work && !m.thread)!.handoff).toEqual({ to: 'reviewer', name: 'Lens', review: true });
    expect(lens.handoff ?? r.msgs().find((m) => m.id === lens.id)!.handoff).toEqual({ to: 'coder', name: 'Bolt', review: false });
    const cards = r.msgs().filter((m) => m.card?.kind === 'approval');
    expect(cards.map((m) => (m.card as { status: string }).status)).toEqual(['superseded', 'pending']);
    expect(r.store.state(first)!.status).toBe('stopped');
    expect(r.goals.db.must(r.tasks()[0]!.ticket!).stage).toBe('in_review');
  });

  it('a person replies in a thread; the agent answers there', async () => {
    const r = rig();
    r.post('@Lens what does the README say?');
    await r.idle();
    const root = r.msgs().find((m) => m.from.name === 'Lens')!;
    const reply = r.teams.post(r.team.id, { text: 'and the CHANGELOG?', from: OWNER, thread: root.id });
    await r.idle();
    expect(reply.thread).toBe(root.id);
    expect(r.msgs().at(-1)).toMatchObject({ from: { name: 'Lens' }, text: 'It says fixture.', thread: root.id });
    expect(() => r.teams.post(r.team.id, { text: 'x', from: OWNER, thread: 'mnope' })).toThrow(/no such message/);
  });
});

describe('a busy agent queues (board 8: “busy · will queue”)', () => {
  it('waits in the squad’s queue as a Todo ticket, then starts when the agent’s run stops working', async () => {
    const r = rig();
    const release = hold(r);
    r.post('@Bolt fix the first thing');
    const first = await r.until(() => r.tasks()[0]?.runId);
    await r.until(() => r.store.state(first)?.nodes.work?.status === 'running');
    const now = r.teams.view(r.team.id).members.find((m) => m.id === 'coder')!;
    expect(now).toMatchObject({ state: 'coding', title: 'Fix the first thing', runId: first, since: expect.any(Number), progress: 0 });
    r.post('@Bolt fix the second thing');
    const q = await r.until(() => r.teams.view(r.team.id).queue[0]);
    expect(q).toMatchObject({ bot: 'coder', task: 'fix the second thing', ticket: expect.any(String) });
    expect(r.goals.db.must(q.ticket!)).toMatchObject({ stage: 'todo', status: 'paused' });
    expect(r.msgs().at(-1)).toMatchObject({ from: { name: 'Bolt' }, text: "I'm in the middle of APP-1, so I'll pick this up next.", ticket: q.ticket });
    expect(r.teams.list()[0]!.queue).toHaveLength(1);
    release();
    // the first run reaches its ship card: Bolt is free, so the queued task starts
    const second = await r.until(() => r.tasks()[1]?.runId);
    expect(r.tasks()[1]).toMatchObject({ ticket: q.ticket, task: 'fix the second thing' });
    expect(r.teams.view(r.team.id).queue).toEqual([]);
    expect(r.goals.db.must(q.ticket!)).toMatchObject({ status: 'active', startedAt: expect.any(Number) });
    await r.engine.wait(second);
    await r.idle();
    expect(r.goals.db.must(q.ticket!).stage).toBe('in_review');
  });

  it('Start now starts a queued task at once', async () => {
    const r = rig();
    const release = hold(r);
    r.post('@Bolt fix the first thing');
    const first = await r.until(() => r.tasks()[0]?.runId);
    await r.until(() => r.store.state(first)?.nodes.work?.status === 'running');
    r.post('@Bolt fix the second thing');
    const q = await r.until(() => r.teams.view(r.team.id).queue[0]);
    await expect(r.teams.startQueued(r.team.id, 'mnope', OWNER)).rejects.toThrow(/nothing like that is queued/);
    const runId = await r.teams.startQueued(r.team.id, q.id, OWNER);
    expect(r.tasks()[1]).toMatchObject({ runId, ticket: q.ticket });
    release();
    await r.engine.wait(first);
    await r.idle();
  });
});

describe('the ship card (board 8)', () => {
  it('Undo before the merge closes the PR and the card waits again; Ship it once more ships it', async () => {
    const r = rig({ prView: '{"state":"OPEN","statusCheckRollup":[{"status":"IN_PROGRESS"}]}' });
    reviews(r, [PASS]);
    const runId = await r.runTask('@Bolt fix the thing');
    const ship = r.card('approval', 'pending')!;
    await r.teams.decide(r.team.id, ship.id, { action: 'approve', by: OWNER });
    await r.engine.wait(runId);
    await r.idle();
    expect(r.card('approval')!.card).toMatchObject({ status: 'approved', ship: { state: 'open', pr: { number: 7 } } });
    const ticket = r.tasks()[0]!.ticket!;
    expect(r.goals.db.must(ticket)).toMatchObject({ stage: 'in_review', prs: [{ number: 7 }] });
    await expect(r.teams.undoShip(r.team.id, ship.id, { id: 'maya', name: 'Maya' })).rejects.toThrow(/can undo/);
    const undone = await r.teams.undoShip(r.team.id, ship.id, OWNER);
    expect(r.calls.find((c) => c[1] === 'close')).toEqual(['pr', 'close', 'https://github.com/o/r/pull/7']);
    expect(undone.card).toMatchObject({ status: 'pending' });
    expect(undone.card).not.toHaveProperty('ship');
    expect(undone.card).not.toHaveProperty('node');
    expect(r.goals.db.must(ticket).prs).toBeUndefined();
    expect(r.goals.db.must(ticket).activity!.at(-1)!.text).toBe('undid the ship: PR #7 is closed');
    await r.teams.decide(r.team.id, ship.id, { action: 'approve', by: OWNER });
    await r.idle();
    expect(r.calls.filter((c) => c[1] === 'create')).toHaveLength(2);
    expect(r.card('approval')!.card).toMatchObject({ ship: { state: 'open' } });
  });

  it('a merged ship has no Undo', async () => {
    const r = rig();
    const runId = await r.runTask('@Bolt fix the thing');
    const ship = r.card('approval', 'pending')!;
    await r.teams.decide(r.team.id, ship.id, { action: 'approve', by: OWNER });
    await r.engine.wait(runId);
    await r.idle();
    await expect(r.teams.undoShip(r.team.id, ship.id, OWNER)).rejects.toThrow(/already merged/);
  });
});

describe('reactions and pins', () => {
  it('toggles a reaction by person and pins a message to the pulse', async () => {
    const r = rig();
    const m = r.post('decision: redirects only follow same-site paths');
    expect(r.teams.react(r.team.id, m.id, 'Nice', OWNER).reactions).toEqual({ Nice: ['you'] });
    expect(r.teams.react(r.team.id, m.id, 'Nice', OWNER).reactions).toBeUndefined();
    expect(() => r.teams.react(r.team.id, m.id, 'Boo', OWNER)).toThrow(/reaction/);
    expect(r.teams.pin(r.team.id, m.id, true, OWNER).pinned).toEqual({ by: 'you', at: expect.any(Number) });
    expect(r.teams.pin(r.team.id, m.id, false, OWNER).pinned).toBeUndefined();
    expect(() => r.teams.pin(r.team.id, 'mnope', true, OWNER)).toThrow(/no such message/);
    await r.idle();
  });
});

describe('failures are said plainly (no silent failures)', () => {
  it('a failed run says what went wrong, its output kept as the report', async () => {
    const r = rig();
    const run = r.writer.run.bind(r.writer);
    r.writer.run = async (req: AgentRequest): Promise<AgentResult> => (req.nodeId === 'work' ? { output: 'Traceback: boom', exitCode: 1, error: 'the agent exited with code 1' } : run(req));
    const runId = await r.runTask('@Bolt fix the thing');
    expect(r.store.state(runId)!.status).toBe('error');
    const said = r.msgs().at(-1)!;
    expect(said).toMatchObject({ from: { name: 'Bolt' }, run: runId });
    expect(said.text).toMatch(/^I couldn't finish this: /);
    expect(said.report).toContain('boom');
  });

  it('while auto-fix works on it, its rounds speak; when it gives up it says so and asks', async () => {
    const r = rig({ autofixing: () => true });
    const run = r.writer.run.bind(r.writer);
    r.writer.run = async (req: AgentRequest): Promise<AgentResult> => (req.nodeId === 'work' ? { output: '', exitCode: 1, error: 'tests failed' } : run(req));
    const runId = await r.runTask('@Bolt fix the thing');
    expect(r.msgs().filter((m) => /couldn't/.test(m.text))).toEqual([]);
    r.store.append(runId, { type: 'autofix.round', round: 1, of: 3, action: 'retry', detail: 'retrying' });
    expect(r.msgs().at(-1)!.text).toBe("That didn't pass, so I'm having another go (round 1 of 3).");
    r.store.append(runId, { type: 'autofix.gave_up', rounds: 3, why: 'the auth tests still fail' });
    await r.idle();
    expect(r.msgs().at(-1)!.text).toBe("I tried 3 rounds and couldn't get it working: the auth tests still fail. Could you take a look?");
  });
});

class FreeModel implements AgentAdapter {
  readonly id = 'openrouter';
  readonly reportsCost = true;
  readonly supportsResume = false;
  prompts: string[] = [];
  reply = 'Fixed it. 1 file, tests pass. @lens mind checking the redirect check?';
  async detect() {
    return { ok: true };
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    this.prompts.push(req.prompt);
    return { output: req.nodeId === 'lessons' ? '{"lessons":[]}' : this.reply, exitCode: 0, costUsd: 0 };
  }
}

describe('the status writer in a squad', () => {
  it('uses the squad’s free model for a report, mentions in the members’ spelling; a reply that breaks a rule falls back', async () => {
    const r = rig();
    const free = new FreeModel();
    r.registry.register(free);
    link(r.home, 'planner', { agent: 'openrouter', model: 'some/model:free' });
    await r.runTask('@Bolt fix the sign-in redirect');
    expect(r.msgs().find((m) => m.work)!.text).toBe('Fixed it. 1 file, tests pass. @Lens mind checking the redirect check?');
    expect(free.prompts.some((p) => /<report>\nFixed it\.\n<\/report>/.test(p) && /You may @mention only: @Bolt, @Lens, @Probe, @Scout, @you/.test(p))).toBe(true);
    free.reply = '## Summary\n- changed fix.txt';
    await r.runTask('@Bolt fix the other thing');
    expect(r.msgs().filter((m) => m.work).at(-1)!.text).toBe('Done, 1 file changed, tests pass. @Lens mind reviewing it?');
  });
});
