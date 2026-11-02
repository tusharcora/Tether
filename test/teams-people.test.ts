import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OWNER } from '../src/teams/store.js';
import type { Person, TeamMessage } from '../src/teams/types.js';
import { rig } from './teams-rig.js';

const MAYA: Person = { id: 'tg42', name: 'Maya', via: 'telegram', tgUserId: 42 };
const JON: Person = { id: 'tg43', name: 'Jon', via: 'telegram', tgUserId: 43, canStartRuns: true };
const people = () => rig({ place: 'telegram', people: [OWNER, MAYA, JON] });

describe('starting runs needs the permission (spec 2026-10-30 §2.4)', () => {
  it('a task from a person without it becomes a proposal, and they are told why once', async () => {
    const r = people();
    r.post('@Bolt fix the thing', MAYA);
    await r.idle();
    expect(r.store.listRows()).toHaveLength(0);
    expect(r.card('proposal')).toMatchObject({ from: { kind: 'tether' }, text: 'Maya asked: fix the thing', card: { agent: 'coder', task: 'fix the thing', status: 'proposed', asker: 'tg42' } });
    expect(r.msgs().filter((m) => /Can start runs/.test(m.text))).toHaveLength(1);
    r.post('@Bolt fix the other thing', MAYA);
    await r.idle();
    expect(r.msgs().filter((m) => m.card?.kind === 'proposal')).toHaveLength(2);
    expect(r.msgs().filter((m) => /Can start runs/.test(m.text))).toHaveLength(1);
    expect(r.store.listRows()).toHaveLength(0);
  });

  it('only a person with the permission can press Start; the run is theirs', async () => {
    const r = people();
    r.post('@Bolt fix the thing', MAYA);
    await r.idle();
    const card = r.card('proposal')!;
    await expect(r.teams.decide(r.team.id, card.id, { action: 'start', by: MAYA })).rejects.toThrow(/Can start runs/);
    expect(r.store.listRows()).toHaveLength(0);
    const done = await r.teams.decide(r.team.id, card.id, { action: 'start', by: JON });
    expect(done.card).toMatchObject({ status: 'started', runId: expect.any(String), by: 'Jon' });
    expect(r.tasks()[0]).toMatchObject({ agent: 'coder', by: 'tg43' });
    await r.engine.wait(r.tasks()[0]!.runId);
    await r.idle();
  });

  it('a loop from a person without it is a proposal too; Start makes the loop', async () => {
    const r = people();
    r.post('@Probe keep `test -f fix.txt` passing, 2 runs', MAYA);
    await r.idle();
    expect(r.goals.db.list()).toHaveLength(0);
    const card = r.card('proposal')!;
    expect(card.card).toMatchObject({ loop: true, agent: 'tester' });
    await r.teams.decide(r.team.id, card.id, { action: 'start', by: OWNER });
    expect(r.goals.db.list()[0]).toMatchObject({ team: r.team.id, agent: 'tester', maxRuns: 2 });
    await r.until(() => ['met', 'stopped', 'paused'].includes(r.goals.db.list()[0]!.status));
    await r.idle();
  });

  it('questions need no permission; a hand-off inherits the asker', async () => {
    const r = people();
    r.talk.reply = 'Bolt should take it. @Bolt fix the thing';
    r.post('@Lens what is wrong here?', MAYA);
    await r.idle();
    expect(r.msgs()[1]).toMatchObject({ from: { name: 'Lens' } });
    expect(r.store.listRows()).toHaveLength(0);
    expect(r.card('proposal')!.card).toMatchObject({ agent: 'coder', asker: 'tg42' });
  });

  it('the owner and allowed people start directly; /new forces a task and a reply-to pings that agent', async () => {
    const r = people();
    r.teams.post(r.team.id, { text: 'the back button is broken', from: JON, to: 'coder', force: 'task' });
    const runId = await r.until(() => r.tasks()[0]?.runId);
    expect(r.store.state(runId)!.task).toBe('the back button is broken');
    await r.engine.wait(runId);
    await r.idle();
    r.teams.post(r.team.id, { text: 'why is this red?', from: MAYA, to: 'reviewer' });
    await r.idle();
    expect(r.msgs().at(-1)).toMatchObject({ from: { name: 'Lens' }, text: 'It says fixture.' });
    expect(r.talk.prompts.at(-1)).toContain('<message>\nMaya: why is this red?\n</message>');
  });
});

describe('agents never approve or merge', () => {
  it('an agent telling another to merge is refused; only a person on the approver list may', async () => {
    const r = rig({ place: 'telegram', level: 'loose', people: [OWNER, MAYA] });
    await r.runTask('@Bolt fix the thing');
    r.talk.reply = 'Looks done. @Bolt merge it';
    r.post('@Lens is it done?');
    await r.idle();
    expect(r.calls.some((c) => c[1] === 'merge')).toBe(false);
    expect(r.msgs().at(-1)!.text).toBe('Only you can tell me to merge here.');
  });
});

describe('people and permissions (board 7)', () => {
  it('people join with both switches off; switches edit the approver list; the owner is fixed', () => {
    const r = rig({ place: 'telegram' });
    expect(r.now().approvers).toEqual(['owner']);
    const maya = r.teams.addPerson(r.team.id, { id: 'tg42', name: 'Maya', via: 'telegram', tgUserId: 42, username: 'mayak' });
    expect(maya).toMatchObject({ id: 'tg42', canStartRuns: false, joinedAt: expect.any(Number) });
    // a second sighting only refreshes the name; switches stay
    r.teams.setPerson(r.team.id, 'tg42', { canStartRuns: true });
    r.teams.addPerson(r.team.id, { id: 'tg42', name: 'Maya K.', via: 'telegram', tgUserId: 42 });
    expect(r.now().people.find((p) => p.id === 'tg42')).toMatchObject({ name: 'Maya K.', canStartRuns: true, username: 'mayak' });
    r.teams.setPerson(r.team.id, 'tg42', { approver: true });
    expect(r.now().approvers).toEqual(['owner', 'tg42']);
    r.teams.setPerson(r.team.id, 'tg42', { approver: false });
    expect(r.now().approvers).toEqual(['owner']);
    expect(() => r.teams.setPerson(r.team.id, 'owner', { approver: false })).toThrow(/owner/);
    expect(() => r.teams.setPerson(r.team.id, 'ghost', { approver: true })).toThrow(/no such person/);
    r.teams.removePerson(r.team.id, 'tg42');
    expect(r.now().people.map((p) => p.id)).toEqual(['owner']);
    expect(() => r.teams.removePerson(r.team.id, 'owner')).toThrow(/owner/);
  });

  it('"any person" becomes everyone else when one person is switched off', () => {
    const r = rig({ place: 'telegram', people: [OWNER, MAYA, JON], approvers: 'any' });
    r.teams.setPerson(r.team.id, 'tg42', { approver: false });
    expect(r.now().approvers).toEqual(['owner', 'tg43']);
  });
});

describe('the change listener', () => {
  it('hears every new message and every change to one, once', async () => {
    const r = rig({ level: 'loose' });
    const heard: TeamMessage[] = [];
    r.teams.onMessage((tid, m) => tid === r.team.id && heard.push(structuredClone(m)));
    r.post('@Lens what does the README say?');
    await r.idle();
    expect(heard.map((m) => [m.from.name, m.text, !!m.pending])).toEqual([
      ['you', '@Lens what does the README say?', false],
      ['Lens', '…', true],
      ['Lens', 'It says fixture.', false],
    ]);
  });
});

describe('Inbox parity (spec 2026-10-30 §2.2, §6.4)', () => {
  it('a team run’s items name the team and its place; a loop ship is an item decided through the team', async () => {
    const r = rig({ place: 'telegram' });
    const runId = await r.runTask('@Bolt fix the thing');
    const item = { id: `${runId}:approval:ship`, ts: 1, runId, kind: 'approval' as const, title: 'Approve ship waits for approval', meta: 'team-task', actions: ['approve' as const, 'open' as const], node: 'ship' };
    expect(r.teams.inbox([item])).toEqual([{ ...item, meta: 'Core · Telegram · team-task', team: { id: r.team.id, name: 'Core', place: 'telegram' } }]);
    r.engine.approve(runId, 'ship', true, 'dashboard');
    await r.engine.wait(runId);
    await r.idle();
    // a loop's ship card has no engine step: it is its own item
    r.post('@Probe keep `test -f fix.txt` passing, 2 runs');
    const goal = await r.until(() => r.goals.db.list()[0]);
    await r.until(() => r.goals.db.must(goal.id).status === 'met');
    await r.idle();
    const ship = r.msgs().find((m) => m.card?.kind === 'approval' && m.card.goalId === goal.id)!;
    const items = r.teams.inbox([]);
    expect(items).toEqual([expect.objectContaining({ kind: 'approval', title: ship.card!.kind === 'approval' ? ship.card!.title : '', team: { id: r.team.id, name: 'Core', place: 'telegram', msg: ship.id } })]);
    await r.teams.decide(r.team.id, ship.id, { action: 'approve', by: OWNER });
    await r.idle();
    expect(r.teams.inbox([])).toEqual([]);
  });

  it('a goal’s next run decided in the Inbox settles the team’s card', async () => {
    const r = rig({ level: 'tight' });
    r.post('@Probe keep `test -f fix.txt` passing, 3 runs');
    const goal = await r.until(() => r.goals.db.list()[0]);
    await r.until(() => r.goals.db.must(goal.id).status === 'needs_you');
    await r.idle();
    const ask = await r.until(() => r.msgs().find((m) => m.card?.kind === 'approval' && m.card.what === 'next'));
    await r.goals.next(goal.id, 'skip');
    expect(r.msgs().find((m) => m.id === ask.id)!.card).toMatchObject({ status: 'rejected', by: 'you' });
    r.goals.setStatus(goal.id, 'stopped');
    await r.idle();
  });
});

describe('photos reach a model that reads images, and are deleted after', () => {
  it('the answer gets the image files', async () => {
    const r = rig({ place: 'telegram' });
    const dir = mkdtempSync(join(tmpdir(), 'tether-img-'));
    const file = join(dir, 'photo.jpg');
    writeFileSync(file, 'jpeg');
    let seen: string[] | undefined;
    const run = r.talk.run.bind(r.talk);
    r.talk.run = async (req) => ((seen = req.images), run(req));
    r.teams.post(r.team.id, { text: 'why is this red?', from: OWNER, to: 'reviewer', images: [file] });
    await r.idle();
    expect(seen).toEqual([file]);
    expect(existsSync(dir)).toBe(false);
  });
});
