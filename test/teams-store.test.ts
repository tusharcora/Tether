import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanProfile, cleanTeam, loadTeams, MAX_MESSAGES, OWNER, readState, saveTeams, writeState } from '../src/teams/store.js';
import type { TeamMessage } from '../src/teams/types.js';
import { tmp } from './helpers.js';

const ctx = { bots: ['coder', 'reviewer'], projects: ['app'] };
const raw = { name: 'Tether core', place: 'tether', project: 'app', agents: ['coder', 'reviewer'], approvers: 'any', level: 'balanced', limits: { usdPerDay: 10, runsPerDay: 20 } };
const mode = (f: string) => statSync(f).mode & 0o777;

describe('team storage', () => {
  it('round-trips a team and an agent profile at 0600', () => {
    const home = tmp();
    const team = { ...cleanTeam(raw, ctx), id: 'core', createdAt: 1 };
    expect(team).toMatchObject({ name: 'Tether core', place: 'tether', people: [OWNER], approvers: 'any', level: 'balanced', learn: true, limits: { usdPerDay: 10, runsPerDay: 20 } });
    saveTeams(home, { teams: [team], agents: { coder: cleanProfile({ specialty: 'code', personality: 'Direct and brief.' }) } });
    expect(loadTeams(home)).toEqual({ teams: [team], agents: { coder: { specialty: 'code', personality: 'Direct and brief.' } } });
    expect(mode(join(home, 'teams', 'teams.json'))).toBe(0o600);
  });

  it('refuses a Slack place, an unknown bot or project, and approvers outside the team', () => {
    expect(() => cleanTeam({ ...raw, place: 'slack' }, ctx)).toThrow(/later phase/);
    expect(() => cleanTeam({ ...raw, place: 'irc' }, ctx)).toThrow(/place/);
    expect(() => cleanTeam({ ...raw, agents: ['ghost'] }, ctx)).toThrow(/unknown agent/);
    expect(() => cleanTeam({ ...raw, project: 'nope' }, ctx)).toThrow(/unknown project/);
    expect(() => cleanTeam({ ...raw, approvers: ['maya'] }, ctx)).toThrow(/approvers/);
    expect(() => cleanTeam({ ...raw, name: ' ' }, ctx)).toThrow(/name/);
    expect(() => cleanTeam({ ...raw, limits: { usdPerDay: 0, runsPerDay: 20 } }, ctx)).toThrow(/usdPerDay/);
    expect(cleanTeam({ ...raw, approvers: ['owner'], level: undefined, limits: undefined }, ctx)).toMatchObject({ approvers: ['owner'], level: 'balanced', limits: { usdPerDay: 10, runsPerDay: 20 } });
    expect(() => cleanProfile({ specialty: 'x'.repeat(25) })).toThrow(/specialty/);
  });

  it('a Telegram team: approvers default to the owner, no link from the client, the owner stays an approver', () => {
    const t = cleanTeam({ ...raw, place: 'telegram', approvers: undefined, link: '-100123' }, ctx);
    expect(t).toMatchObject({ place: 'telegram', approvers: ['owner'], people: [OWNER] });
    expect(t.link).toBeUndefined();
    const team = { ...t, id: 'ops', createdAt: 1, link: '-100123', people: [OWNER, { id: 'tg42', name: 'Maya', via: 'telegram' as const, tgUserId: 42 }] };
    expect(cleanTeam({ approvers: ['tg42'] }, ctx, team)).toMatchObject({ approvers: ['tg42', 'owner'], link: '-100123' });
    expect(cleanTeam({ approvers: 'any' }, ctx, team).approvers).toBe('any');
    expect(() => cleanTeam({ place: 'tether' }, ctx, team)).toThrow(/place/);
  });

  it('a patch keeps what it does not name', () => {
    const team = { ...cleanTeam(raw, ctx), id: 'core', createdAt: 1 };
    expect(cleanTeam({ level: 'loose' }, ctx, team)).toEqual({ ...team, level: 'loose' });
  });

  it('caps messages at 300 keeping the newest, at 0600', () => {
    const home = tmp();
    const msg = (i: number): TeamMessage => ({ id: `m${i}`, at: i, from: { kind: 'person', id: 'owner', name: 'you' }, text: `hi ${i}` });
    writeState(home, 'core', { messages: Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => msg(i)), tasks: [], answers: [] });
    const s = readState(home, 'core');
    expect(s.messages).toHaveLength(MAX_MESSAGES);
    expect(s.messages[0]!.id).toBe('m5');
    expect(mode(join(home, 'teams', 'core.json'))).toBe(0o600);
  });

  it('reads a missing or corrupt state file as empty', () => {
    const home = tmp();
    expect(readState(home, 'core')).toEqual({ messages: [], tasks: [], answers: [] });
    saveTeams(home, { teams: [], agents: {} });
    writeFileSync(join(home, 'teams', 'core.json'), '{nope');
    expect(readState(home, 'core')).toEqual({ messages: [], tasks: [], answers: [] });
    writeFileSync(join(home, 'teams', 'teams.json'), '[]');
    expect(loadTeams(home)).toEqual({ teams: [], agents: {} });
  });
});
