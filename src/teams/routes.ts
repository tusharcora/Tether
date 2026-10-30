/**
 * /api/squads* (and /api/teams*, its alias for one release) and /api/agents/:bot*: the loopback server has checked Host and Origin, so the caller is the owner (a Tether
 * team's one person). Every field is validated by the team service or here; the approver rule is the service's.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { forgetLessons, loadLessons, retireNotes } from '../lessons.js';
import { HttpError, readJson, reqObject, send } from '../serverkit.js';
import type { Vault } from '../vault.js';
import { cleanProfile, loadTeams, OWNER, saveTeams } from './store.js';
import type { Teams } from './teams.js';
import type { AgentView } from './types.js';

const opt = (b: Record<string, unknown>, k: string): string | undefined => {
  if (b[k] === undefined || b[k] === null) return undefined;
  if (typeof b[k] !== 'string') throw new HttpError(400, `"${k}" must be a string`);
  return b[k] as string;
};

function agentView(home: string, teams: Teams, bot: string): AgentView {
  const names = new Map(teams.all().map((t) => [t.id, t.name]));
  const lessons = loadLessons(home, bot)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((l) => ({ id: l.id, text: l.text, at: l.updatedAt, ...(l.team ? { team: l.team, ...(names.has(l.team) ? { teamName: names.get(l.team) } : {}) } : {}) }));
  return { bot, profile: loadTeams(home).agents[bot] ?? {}, lessons, ...teams.agentTeams(bot) };
}

export async function teamsRoute(c: { home: string; teams: Teams; vault: Vault }, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const { teams } = c;
  const p = url.pathname;
  const m = req.method ?? 'GET';
  let g: RegExpMatchArray | null;

  if (p === '/api/squads' && m === 'GET') {
    // the crew bots that can join a squad, with their specialty and what they are doing now (the sidebar's Agents)
    const profiles = loadTeams(c.home).agents;
    const live = teams.agentsNow();
    const agents = teams.agentBots().map((b) => ({ id: b.id, name: b.name, specialty: profiles[b.id]?.specialty ?? b.title, ...live[b.id] }));
    const squads = teams.list();
    // `teams`: the same list under its old name, for one release
    return send(res, 200, { squads, teams: squads, agents }), true;
  }
  if (p === '/api/squads' && m === 'POST') return send(res, 201, teams.create(await readJson(req))), true;

  if ((g = p.match(/^\/api\/squads\/([a-z0-9][a-z0-9_-]{0,39})\/people\/([a-z0-9]{1,40})$/))) {
    const [, id, person] = g as unknown as [string, string, string];
    if (m === 'DELETE') return send(res, 200, teams.removePerson(id, person)), true;
    if (m === 'PATCH') {
      const b = reqObject(await readJson(req));
      const flag = (k: string) => {
        if (b[k] !== undefined && typeof b[k] !== 'boolean') throw new HttpError(400, `"${k}" must be true or false`);
        return b[k] as boolean | undefined;
      };
      return send(res, 200, teams.setPerson(id, person, { approver: flag('approver'), canStartRuns: flag('canStartRuns') })), true;
    }
  }
  // board 8: a reaction, a pin, Undo of a ship, a queued task started now
  if ((g = p.match(/^\/api\/squads\/([a-z0-9][a-z0-9_-]{0,39})\/(messages|cards|queue)\/([A-Za-z0-9]{1,40})\/(react|pin|undo|start)$/)) && m === 'POST') {
    const [, id, kind, ref, act] = g as unknown as [string, string, string, string, string];
    const b = reqObject(await readJson(req));
    if (kind === 'messages' && act === 'react') {
      const reaction = opt(b, 'reaction');
      if (!reaction) throw new HttpError(400, '"reaction" is required');
      return send(res, 200, teams.react(id, ref, reaction, OWNER)), true;
    }
    if (kind === 'messages' && act === 'pin') {
      if (typeof b.on !== 'boolean') throw new HttpError(400, '"on" must be true or false');
      return send(res, 200, teams.pin(id, ref, b.on, OWNER)), true;
    }
    if (kind === 'cards' && act === 'undo') return send(res, 200, await teams.undoShip(id, ref, OWNER)), true;
    if (kind === 'queue' && act === 'start') return send(res, 200, { runId: await teams.startQueued(id, ref, OWNER) }), true;
  }
  if ((g = p.match(/^\/api\/squads\/([a-z0-9][a-z0-9_-]{0,39})(?:\/(messages|cards|diff)(?:\/([A-Za-z0-9]{1,40}))?)?$/))) {
    const [, id, sub, msg] = g as unknown as [string, string, string | undefined, string | undefined];
    if (!sub && m === 'GET') return send(res, 200, teams.view(id)), true;
    if (!sub && m === 'PATCH') return send(res, 200, teams.update(id, await readJson(req))), true;
    if (!sub && m === 'DELETE') return teams.remove(id), send(res, 200, { deleted: id }), true;
    if (sub === 'messages' && !msg && m === 'POST') {
      // a Telegram team's room in Tether is a read-only mirror: its people talk in the group
      if (teams.must(id).place === 'telegram') throw new HttpError(409, 'This squad lives in Telegram: talk to it there.');
      const b = reqObject(await readJson(req));
      const text = opt(b, 'text');
      if (!text) throw new HttpError(400, '"text" is required');
      const thread = opt(b, 'thread');
      return send(res, 201, teams.post(id, { text, from: OWNER, ...(thread ? { thread } : {}) })), true;
    }
    if (sub === 'cards' && msg && m === 'POST') {
      const b = reqObject(await readJson(req));
      const action = opt(b, 'action');
      if (!action) throw new HttpError(400, '"action" is required');
      return send(res, 200, await teams.decide(id, msg, { action, by: OWNER, reason: opt(b, 'reason'), task: opt(b, 'task') })), true;
    }
    if (sub === 'diff' && msg && m === 'GET') {
      const diff = await teams.diff(id, msg);
      return send(res, 200, { diff: diff.slice(0, 500_000), truncated: diff.length > 500_000 }), true;
    }
  }

  if ((g = p.match(/^\/api\/agents\/([a-z][a-z0-9_-]{0,23})(\/lessons(?:\/([\w-]{1,64}))?)?$/))) {
    const [, bot, lessons, lesson] = g as unknown as [string, string, string | undefined, string | undefined];
    if (!teams.agentBots().some((b) => b.id === bot)) throw new HttpError(404, `no crew bot "${bot}" that can be an agent`);
    if (!lessons && m === 'GET') return send(res, 200, agentView(c.home, teams, bot)), true;
    if (!lessons && m === 'PUT') {
      const profile = cleanProfile(await readJson(req));
      const f = loadTeams(c.home);
      saveTeams(c.home, { ...f, agents: { ...f.agents, [bot]: profile } });
      return send(res, 200, agentView(c.home, teams, bot)), true;
    }
    if (lessons && m === 'DELETE') {
      const gone = forgetLessons(c.home, bot, lesson ? [lesson] : undefined);
      if (lesson && !gone.length) throw new HttpError(404, 'no such lesson');
      await retireNotes(c.vault, bot, gone);
      return send(res, 200, agentView(c.home, teams, bot)), true;
    }
  }
  return false;
}
