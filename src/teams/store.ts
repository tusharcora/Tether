/**
 * Squads on disk, under <home>/squads/ (0600 files, written atomically; they were teams, in <home>/teams/, moved once):
 *   teams.json   { teams, agents }: every team, and each agent's profile (specialty, personality) keyed by bot id
 *   <id>.json    { messages, tasks, answers, queue }: a squad's channel (the newest 300 messages), the runs its agents
 *                started (the newest 200), today's answer costs and the tasks waiting for a busy agent
 * Validation lives here too: a team comes in from the dashboard (and later Slack/Telegram) and is checked field by field.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from '../serverkit.js';
import type { AgentProfile, Level, Person, Team, TeamState } from './types.js';

export const MAX_MESSAGES = 300;
export const MAX_TASKS = 200;
export const MAX_TEAMS = 50;
export const MAX_AGENTS = 12;
export const SPECIALTY_MAX = 24;
export const PERSONALITY_MAX = 500;
export const TEAM_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** The person at this Tether: the only person in a Tether team. */
export const OWNER: Person = { id: 'owner', name: 'you' };
export const LEVELS: readonly Level[] = ['tight', 'balanced', 'loose'];
export const DEFAULT_LIMITS = { usdPerDay: 10, runsPerDay: 20 };

export interface TeamsFile {
  teams: Team[];
  agents: Record<string, AgentProfile>;
}

const moved = new Set<string>();
/**
 * Teams become squads (spec 2026-10-30-squads-tickets §2.6): the folder `<home>/teams/` is renamed `<home>/squads/`
 * once, with every file in it (same ids, same channels, the Telegram state). A home that already has `squads/` keeps it
 * and its `teams/` is left alone, so nothing is overwritten and running it again changes nothing.
 */
export function squadsDir(home: string): string {
  const to = join(home, 'squads');
  if (!moved.has(home)) {
    moved.add(home);
    const from = join(home, 'teams');
    if (!existsSync(to) && existsSync(from)) renameSync(from, to);
  }
  return to;
}
const dir = squadsDir;
const teamsFile = (home: string) => join(dir(home), 'teams.json');
const stateFile = (home: string, id: string) => {
  if (!TEAM_ID_RE.test(id)) throw new Error(`not a team id: ${id.slice(0, 60)}`);
  return join(dir(home), `${id}.json`);
};

function write(f: string, data: unknown): void {
  mkdirSync(join(f, '..'), { recursive: true, mode: 0o700 });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, f);
}
function read(f: string): unknown {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return undefined;
  }
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function loadTeams(home: string): TeamsFile {
  const j = read(teamsFile(home));
  if (!isObj(j)) return { teams: [], agents: {} };
  return { teams: Array.isArray(j.teams) ? (j.teams as Team[]).filter((t) => isObj(t) && TEAM_ID_RE.test(String(t.id))) : [], agents: isObj(j.agents) ? (j.agents as Record<string, AgentProfile>) : {} };
}
export const saveTeams = (home: string, f: TeamsFile): void => write(teamsFile(home), f);

/** Local midnight: "a day" for the team limits is the owner's day. */
export const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);

export function readState(home: string, id: string): TeamState {
  const j = read(stateFile(home, id));
  if (!isObj(j)) return { messages: [], tasks: [], answers: [] };
  const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
  return { messages: arr(j.messages), tasks: arr(j.tasks), answers: arr(j.answers), ...(Array.isArray(j.told) ? { told: arr<string>(j.told) } : {}), ...(Array.isArray(j.queue) ? { queue: arr(j.queue) } : {}) };
}
export function writeState(home: string, id: string, s: TeamState, now = Date.now()): void {
  write(stateFile(home, id), { messages: s.messages.slice(-MAX_MESSAGES), tasks: s.tasks.slice(-MAX_TASKS), answers: s.answers.filter((a) => a.at >= startOfDay(now)), ...(s.told?.length ? { told: s.told.slice(-MAX_TASKS) } : {}), ...(s.queue?.length ? { queue: s.queue } : {}) });
}
export const removeState = (home: string, id: string): void => {
  try {
    renameSync(stateFile(home, id), `${stateFile(home, id)}.deleted`);
  } catch {
    /* no messages yet */
  }
};

// ---------- validation ----------

const bad = (msg: string) => new HttpError(400, msg);
/** One line of text, control characters out. */
const line = (v: unknown, k: string, max: number): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw bad(`"${k}" must be a string`);
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
  if (t.length > max) throw bad(`"${k}" is too long (max ${max})`);
  return t;
};
const num = (v: unknown, k: string, lo: number, hi: number, whole = false): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) throw bad(`"${k}" must be ${whole ? 'a whole number' : 'a number'} from ${lo} to ${hi}`);
  return v;
};

/**
 * A team from untrusted JSON, or a patch of `prev`. People are not taken from the client: a Tether team is its owner, a
 * Telegram team adds people as they speak in the linked group. `link` is never taken from the client either (`/pair` sets it).
 */
export function cleanTeam(raw: unknown, ctx: { bots: string[]; projects: string[] }, prev?: Team): Omit<Team, 'id' | 'createdAt'> & Partial<Pick<Team, 'id' | 'createdAt'>> {
  if (!isObj(raw)) throw bad('expected a JSON object');
  const has = (k: string) => raw[k] !== undefined;
  const name = has('name') || !prev ? line(raw.name, 'name', 60) : prev.name;
  if (!name) throw bad('"name" is required');
  const place = has('place') || !prev ? raw.place : prev.place;
  if (place === 'slack') throw bad('Slack teams arrive in a later phase: make a Tether or Telegram team for now');
  if (place !== 'tether' && place !== 'telegram') throw bad('"place" must be "tether" or "telegram"');
  if (prev && place !== prev.place) throw bad('a team\'s place is fixed once it is made');
  const project = has('project') || !prev ? line(raw.project, 'project', 64) : prev.project;
  if (!project || !ctx.projects.includes(project)) throw bad(`unknown project "${project ?? ''}"`);
  let agents = prev?.agents ?? [];
  if (has('agents') || !prev) {
    if (!Array.isArray(raw.agents) || !raw.agents.length || raw.agents.length > MAX_AGENTS) throw bad(`"agents" must list 1 to ${MAX_AGENTS} crew bots`);
    agents = [...new Set(raw.agents.map(String))];
    const unknown = agents.find((a) => !ctx.bots.includes(a));
    if (unknown) throw bad(`unknown agent "${unknown.slice(0, 40)}"`);
  }
  const people = prev?.people ?? [OWNER];
  // a new Telegram team: only the owner approves until someone is switched on (board 7)
  let approvers = prev?.approvers ?? (place === 'telegram' ? [OWNER.id] : 'any');
  if (has('approvers')) {
    const a = raw.approvers;
    if (a === 'any') approvers = 'any';
    else if (Array.isArray(a) && a.length && a.every((x) => typeof x === 'string' && people.some((p) => p.id === x))) approvers = [...new Set(a as string[])];
    else throw bad('"approvers" must be "any" or a list of people in the team');
  }
  // the owner of a Telegram team always approves (board 7's switch is fixed on)
  if (place === 'telegram' && approvers !== 'any' && !approvers.includes(OWNER.id)) approvers = [...approvers, OWNER.id];
  const level = has('level') ? raw.level : (prev?.level ?? 'balanced');
  if (!LEVELS.includes(level as Level)) throw bad('"level" must be tight, balanced or loose');
  let limits = prev?.limits ?? DEFAULT_LIMITS;
  if (has('limits')) {
    const l = isObj(raw.limits) ? raw.limits : {};
    limits = { usdPerDay: num(l.usdPerDay ?? limits.usdPerDay, 'usdPerDay', 0.01, 1000), runsPerDay: num(l.runsPerDay ?? limits.runsPerDay, 'runsPerDay', 1, 500, true) };
  }
  if (has('learn') && typeof raw.learn !== 'boolean') throw bad('"learn" must be true or false');
  const learn = has('learn') ? (raw.learn as boolean) : (prev?.learn ?? true);
  return { ...(prev ? { id: prev.id, createdAt: prev.createdAt } : {}), name, place: place as Team['place'], project, agents, people, approvers, level: level as Level, limits, learn, ...(prev?.link ? { link: prev.link } : {}) };
}

export function cleanProfile(raw: unknown): AgentProfile {
  if (!isObj(raw)) throw bad('expected a JSON object');
  const specialty = line(raw.specialty, 'specialty', SPECIALTY_MAX);
  const p = raw.personality;
  if (p !== undefined && p !== null && typeof p !== 'string') throw bad('"personality" must be a string');
  const personality = typeof p === 'string' ? p.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ').trim() : undefined;
  if (personality && personality.length > PERSONALITY_MAX) throw bad(`"personality" is too long (max ${PERSONALITY_MAX})`);
  return { ...(specialty ? { specialty } : {}), ...(personality ? { personality } : {}) };
}
