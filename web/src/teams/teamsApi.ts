import type { AgentState, AgentView, Card, Level, Place, Team, TeamMessage, TeamSummary, TeamView, WorkItem } from '../../../src/teams/types.js';
import { api } from '../api';

export type { AgentState, AgentView, Card, Level, Place, Team, TeamMessage, TeamSummary, TeamView, WorkItem };

export const TEAMS_PATH = '/api/teams';
/** GET /api/teams: every team, and the crew bots that can join one. */
export interface TeamsReply {
  teams: TeamSummary[];
  agents: { id: string; name: string; specialty: string }[];
}
/** The sidebar's place mark: # a Tether channel, S Slack, T Telegram. */
export const MARK: Record<Place, string> = { tether: '#', slack: 'S', telegram: 'T' };
export const PLACE: Record<Place, string> = { tether: 'Tether', slack: 'Slack', telegram: 'Telegram' };
export const LEVELS: { id: Level; label: string; hint: string }[] = [
  { id: 'tight', label: 'Tight', hint: 'A person approves the plan and the result.' },
  { id: 'balanced', label: 'Balanced', hint: 'Agents plan and code freely; a person approves before anything ships.' },
  { id: 'loose', label: 'Loose', hint: "Agents ship on their own when the gates pass, within the team's limits." },
];
export const STATE_LABEL: Record<AgentState, string> = { idle: 'idle', answering: 'answering', coding: 'coding', looping: 'looping', reviewing: 'reviewing', waiting: 'waiting' };

/** "any teammate" or the chosen people's names. */
export const approversLine = (t: Team): string => (t.approvers === 'any' ? 'any teammate' : t.people.filter((p) => (t.approvers as string[]).includes(p.id)).map((p) => p.name).join(', '));

export const teamsApi = {
  create: (body: Record<string, unknown>) => api<Team>('POST', TEAMS_PATH, body),
  patch: (id: string, body: Record<string, unknown>) => api<Team>('PATCH', `${TEAMS_PATH}/${id}`, body),
  remove: (id: string) => api('DELETE', `${TEAMS_PATH}/${id}`),
  post: (id: string, text: string) => api<TeamMessage>('POST', `${TEAMS_PATH}/${id}/messages`, { text }),
  decide: (id: string, msg: string, body: { action: string; reason?: string; task?: string }) => api<TeamMessage>('POST', `${TEAMS_PATH}/${id}/cards/${msg}`, body),
  diff: (id: string, msg: string) => api<{ diff: string; truncated: boolean }>('GET', `${TEAMS_PATH}/${id}/diff/${msg}`),
  agent: (bot: string) => api<AgentView>('GET', `/api/agents/${bot}`),
  saveAgent: (bot: string, body: { specialty?: string; personality?: string }) => api<AgentView>('PUT', `/api/agents/${bot}`, body),
  forget: (bot: string, lesson?: string) => api<AgentView>('DELETE', `/api/agents/${bot}/lessons${lesson ? `/${encodeURIComponent(lesson)}` : ''}`),
};
