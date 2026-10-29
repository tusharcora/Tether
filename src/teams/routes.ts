/**
 * /api/teams* and /api/agents/:bot*: the loopback server has checked Host and Origin, so the caller is the owner (a Tether
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

  if (p === '/api/teams' && m === 'GET') {
    // the crew bots that can join a team, with their specialty (New team's agent list)
    const profiles = loadTeams(c.home).agents;
    const agents = teams.agentBots().map((b) => ({ id: b.id, name: b.name, specialty: profiles[b.id]?.specialty ?? b.title }));
    return send(res, 200, { teams: teams.list(), agents }), true;
  }
  if (p === '/api/teams' && m === 'POST') return send(res, 201, teams.create(await readJson(req))), true;

  if ((g = p.match(/^\/api\/teams\/([a-z0-9][a-z0-9_-]{0,39})(?:\/(messages|cards|diff)(?:\/([A-Za-z0-9]{1,40}))?)?$/))) {
    const [, id, sub, msg] = g as unknown as [string, string, string | undefined, string | undefined];
    if (!sub && m === 'GET') return send(res, 200, teams.view(id)), true;
    if (!sub && m === 'PATCH') return send(res, 200, teams.update(id, await readJson(req))), true;
    if (!sub && m === 'DELETE') return teams.remove(id), send(res, 200, { deleted: id }), true;
    if (sub === 'messages' && !msg && m === 'POST') {
      const text = opt(reqObject(await readJson(req)), 'text');
      if (!text) throw new HttpError(400, '"text" is required');
      return send(res, 201, teams.post(id, { text, from: OWNER })), true;
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
