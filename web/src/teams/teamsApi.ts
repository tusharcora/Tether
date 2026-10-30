import type { AgentNow, AgentState, AgentView, Card, Level, Person, Place, Queued, Team, TeamMessage, TeamSummary, TeamView, Work, WorkItem } from '../../../src/teams/types.js';
import { REACTIONS } from '../../../src/teams/types.js';
import { api } from '../api';

export type { AgentNow, AgentState, AgentView, Card, Level, Person, Place, Queued, Team, TeamMessage, TeamSummary, TeamView, Work, WorkItem };
export { REACTIONS };

export const TEAMS_PATH = '/api/squads';
/** GET /api/squads: every squad, and the crew bots that can join one with what each is doing now. */
export interface TeamsReply {
  squads: TeamSummary[];
  /** The same list under its old name (one release). */
  teams?: TeamSummary[];
  agents: ({ id: string; name: string; specialty: string } & Partial<AgentNow>)[];
}
/** The sidebar's place mark: # a Tether channel, S Slack, T Telegram. */
export const MARK: Record<Place, string> = { tether: '#', slack: 'S', telegram: 'T' };
export const PLACE: Record<Place, string> = { tether: 'Tether', slack: 'Slack', telegram: 'Telegram' };
export const LEVELS: { id: Level; label: string; hint: string }[] = [
  { id: 'tight', label: 'Tight', hint: 'A person approves the plan and the result.' },
  { id: 'balanced', label: 'Balanced', hint: 'Agents plan and code freely; a person approves before anything ships.' },
  { id: 'loose', label: 'Loose', hint: "Agents ship on their own when the gates pass, within the squad's limits." },
];
export const STATE_LABEL: Record<AgentState, string> = { idle: 'idle', answering: 'answering', coding: 'coding', looping: 'looping', reviewing: 'reviewing', waiting: 'waiting' };

/** What the @ picker says about an agent (board 8): a task for a busy one waits its turn. */
export const availability = (s?: AgentState): { line: string; free: boolean } =>
  !s || s === 'idle' || s === 'waiting' ? { line: 'free now', free: true } : { line: 'busy · will queue', free: false };

/** "any teammate" or the chosen people's names. */
export const approversLine = (t: Team): string => (t.approvers === 'any' ? 'any teammate' : t.people.filter((p) => (t.approvers as string[]).includes(p.id)).map((p) => p.name).join(', '));

export const teamsApi = {
  create: (body: Record<string, unknown>) => api<Team>('POST', TEAMS_PATH, body),
  patch: (id: string, body: Record<string, unknown>) => api<Team>('PATCH', `${TEAMS_PATH}/${id}`, body),
  remove: (id: string) => api('DELETE', `${TEAMS_PATH}/${id}`),
  post: (id: string, text: string, thread?: string) => api<TeamMessage>('POST', `${TEAMS_PATH}/${id}/messages`, { text, ...(thread ? { thread } : {}) }),
  react: (id: string, msg: string, reaction: string) => api<TeamMessage>('POST', `${TEAMS_PATH}/${id}/messages/${msg}/react`, { reaction }),
  pin: (id: string, msg: string, on: boolean) => api<TeamMessage>('POST', `${TEAMS_PATH}/${id}/messages/${msg}/pin`, { on }),
  undo: (id: string, msg: string) => api<TeamMessage>('POST', `${TEAMS_PATH}/${id}/cards/${msg}/undo`, {}),
  startQueued: (id: string, q: string) => api<{ runId?: string }>('POST', `${TEAMS_PATH}/${id}/queue/${q}/start`, {}),
  decide: (id: string, msg: string, body: { action: string; reason?: string; task?: string }) => api<TeamMessage>('POST', `${TEAMS_PATH}/${id}/cards/${msg}`, body),
  diff: (id: string, msg: string) => api<{ diff: string; truncated: boolean }>('GET', `${TEAMS_PATH}/${id}/diff/${msg}`),
  agent: (bot: string) => api<AgentView>('GET', `/api/agents/${bot}`),
  saveAgent: (bot: string, body: { specialty?: string; personality?: string }) => api<AgentView>('PUT', `/api/agents/${bot}`, body),
  forget: (bot: string, lesson?: string) => api<AgentView>('DELETE', `/api/agents/${bot}/lessons${lesson ? `/${encodeURIComponent(lesson)}` : ''}`),
  /** A one-time `/pair` code for a Telegram team (and the bot to add to the group). */
  pair: (id: string) => api<{ code: string; exp: number; bot?: string }>('POST', `${TEAMS_PATH}/${id}/pair`),
  /** Board 7's switches for one person. */
  person: (id: string, person: string, body: { approver?: boolean; canStartRuns?: boolean }) => api<Team>('PATCH', `${TEAMS_PATH}/${id}/people/${person}`, body),
  removePerson: (id: string, person: string) => api<Team>('DELETE', `${TEAMS_PATH}/${id}/people/${person}`),
};
/** May this person approve? Any person when the team says "any", else the chosen ones. */
export const isApprover = (t: Team, id: string) => t.approvers === 'any' || t.approvers.includes(id);
