/**
 * Teams (spec docs/superpowers/specs/2026-10-29-teams-design.md): people and agents (Crew bots) in one place. Shared by the
 * server (src/teams) and the dashboard (web), with type-only imports so web can use them.
 */
import type { Cite } from '../assistant/types.js';
import type { RunStatus } from '../types.js';

export type Place = 'tether' | 'slack' | 'telegram';
/** Tight: plan and result approved. Balanced: approve before ship. Loose: ship when gates pass. */
export type Level = 'tight' | 'balanced' | 'loose';
export interface Person {
  id: string;
  name: string;
}
export interface Limits {
  usdPerDay: number;
  runsPerDay: number;
}
export interface Team {
  id: string;
  name: string;
  place: Place;
  /** Slack channel id or Telegram chat id (later phases). */
  link?: string;
  /** The project (workspace id) its runs work in. */
  project: string;
  /** Crew bot ids. */
  agents: string[];
  people: Person[];
  /** Who may approve, reject and ask for a merge: anyone in the team, or these person ids. */
  approvers: 'any' | string[];
  level: Level;
  limits: Limits;
  /** false: agents learn no lessons from this team. */
  learn: boolean;
  createdAt: number;
}
/** What a Crew bot adds to be an agent (its memory is its lessons). */
export interface AgentProfile {
  /** Short label, e.g. "code". */
  specialty?: string;
  /** How it talks in a team, ≤ 500 chars. */
  personality?: string;
}

export interface Step {
  id: string;
  status: string;
  title?: string;
}
export type ApprovalWhat = 'plan' | 'ship' | 'next';
export type Card =
  | { kind: 'run'; runId: string; title: string; steps: Step[]; status: RunStatus; costUsd: number }
  /** `said`: what the channel last said about the loop, "<runs posted>|<status>", so each change is posted once. */
  | { kind: 'loop'; goalId: string; said?: string }
  | { kind: 'approval'; what: ApprovalWhat; title: string; detail?: string; runId?: string; node?: string; goalId?: string; status: 'pending' | 'approved' | 'rejected'; by?: string; at?: number; reason?: string }
  | { kind: 'proposal'; agent: string; task: string; status: 'proposed' | 'started' | 'dismissed'; runId?: string }
  | { kind: 'pr'; url: string; number: number; title: string; merged?: boolean };

export interface TeamMessage {
  id: string;
  at: number;
  from: { kind: 'person' | 'agent' | 'tether'; id: string; name: string };
  text: string;
  /** The run this message is about: a hand-off that answers it builds on that run's branch. */
  run?: string;
  card?: Card;
  cites?: Cite[];
  /** An agent is still writing it; the text is a placeholder. */
  pending?: boolean;
}

/** A run a team agent started, and how it hangs together with the runs before it. */
export interface TeamTask {
  runId: string;
  agent: string;
  kind: 'task' | 'rework' | 'loop';
  task: string;
  /** The first run of the chain: hand-offs and reworks share it. */
  chain: string;
  /** The chain's first base commit: what a ship's diff is measured from. */
  base: string;
  /** The message holding its run card. */
  msg: string;
  goal?: string;
  /** Agent-to-agent hand-offs so far in the chain. */
  hops: number;
  reworked?: boolean;
  startedAt: number;
  pr?: { url: string; number: number };
}
export interface TeamState {
  messages: TeamMessage[];
  tasks: TeamTask[];
  /** Today's answer turns and what each cost (runs are costed from the run store). */
  answers: { at: number; usd: number }[];
}

export type TeamStatus = 'idle' | 'live' | 'needs';
export type AgentState = 'idle' | 'answering' | 'coding' | 'looping' | 'reviewing' | 'waiting';
export interface TeamSummary {
  id: string;
  name: string;
  place: Place;
  project: string;
  agents: string[];
  status: TeamStatus;
}
export interface WorkItem {
  kind: 'loop' | 'task';
  title: string;
  agent: string;
  needs: boolean;
  runId?: string;
  goalId?: string;
  /** 0 to 1, loops only. */
  progress?: number;
  line: string;
}
/** GET /api/agents/:bot: a Crew bot as an agent — its profile, memory, teams and recent team work. */
export interface AgentView {
  bot: string;
  profile: AgentProfile;
  lessons: { id: string; text: string; team?: string; teamName?: string; at: string }[];
  teams: { id: string; name: string; place: Place; state: AgentState }[];
  recent: { runId: string; title: string; status: string; costUsd: number; team: string }[];
}
export interface TeamView {
  team: Team;
  messages: TeamMessage[];
  members: { id: string; name: string; specialty: string; state: AgentState }[];
  working: WorkItem[];
  spend: { usd: number; runs: number };
  status: TeamStatus;
}
