/**
 * Squads (spec 2026-10-30-squads-tickets; they were Teams, spec 2026-10-29-teams-design): people and agents (Crew bots)
 * and a project, in one place. The code keeps the name `team` so stored squads and Telegram links stay valid. Shared by
 * the server (src/teams) and the dashboard (web), with type-only imports so web can use them.
 */
import type { Cite } from '../assistant/types.js';
import type { RunStatus } from '../types.js';

export type Place = 'tether' | 'slack' | 'telegram';
/** Tight: plan and result approved. Balanced: approve before ship. Loose: ship when gates pass. */
export type Level = 'tight' | 'balanced' | 'loose';
export interface Person {
  id: string;
  name: string;
  /** A teammate who came in from a Telegram group (spec 2026-10-30 §6.1): their Telegram user id and @username. */
  via?: 'telegram';
  tgUserId?: number;
  username?: string;
  /** May start runs, loops and goals (board 7); off for new people, the owner always may. */
  canStartRuns?: boolean;
  joinedAt?: number;
}
export interface Limits {
  usdPerDay: number;
  runsPerDay: number;
}
export interface Team {
  id: string;
  name: string;
  place: Place;
  /** The linked Telegram chat id (set by `/pair`, never by the client); Slack's channel id later. */
  link?: string;
  /** The project (workspace id) its runs work in. */
  project: string;
  /** Crew bot ids. */
  agents: string[];
  people: Person[];
  /** Who may approve, reject and ask for a merge: any person in the team (never an agent), or these person ids. */
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
  | {
      kind: 'approval';
      what: ApprovalWhat;
      title: string;
      detail?: string;
      runId?: string;
      node?: string;
      goalId?: string;
      /** superseded: a later run of the same work replaced it. */
      status: 'pending' | 'approved' | 'rejected' | 'superseded';
      by?: string;
      at?: number;
      reason?: string;
      /** The ship card's facts (board 8): the change's size, the test gate, the review. */
      files?: number;
      plus?: number;
      minus?: number;
      tests?: { ok: boolean; line: string };
      review?: { by: string; pass?: boolean };
      /** After Ship it: the PR, opening then merging; Undo is possible until it is merged. */
      ship?: { state: 'shipping' | 'open' | 'merged' | 'failed'; pr?: { url: string; number: number }; error?: string };
    }
  /** `loop`: Start makes it a loop. `asker`: the person whose ask needs someone allowed to start it. */
  | { kind: 'proposal'; agent: string; task: string; status: 'proposed' | 'started' | 'dismissed'; runId?: string; loop?: boolean; asker?: string; by?: string }
  | { kind: 'pr'; url: string; number: number; title: string; merged?: boolean };

/** What I did (board 9): the facts behind an agent's message. */
export interface Work {
  files: string[];
  plus: number;
  minus: number;
  ran: { command: string; ok: boolean; summary?: string }[];
  ms?: number;
  model?: string;
}
export const REACTIONS = ['Nice', 'Thanks', '+1', 'Looking'] as const;
export interface TeamMessage {
  id: string;
  at: number;
  from: { kind: 'person' | 'agent' | 'tether'; id: string; name: string };
  /** What the channel shows: for agents, one or two sentences in a teammate's voice. */
  text: string;
  /** The run this message is about: a hand-off that answers it builds on that run's branch. */
  run?: string;
  card?: Card;
  cites?: Cite[];
  /** An agent is still writing it; the text is a placeholder. */
  pending?: boolean;
  /** The message whose thread it is in. */
  thread?: string;
  /** The agent's raw output behind the message (Full report); never shown in the channel. */
  report?: string;
  work?: Work;
  /** This message handed work to another agent (the chip "Handed to Lens for a review"). */
  handoff?: { to: string; name: string; review: boolean };
  /** Reaction -> the names of the people who reacted. */
  reactions?: Record<string, string[]>;
  pinned?: { by: string; at: number };
  /** The ticket it is about. */
  ticket?: string;
}
/** An ask waiting for an agent that is busy (board 8: "busy · will queue"). */
export interface Queued {
  id: string;
  bot: string;
  task: string;
  msg: string;
  ticket?: string;
  asker?: string;
  at: number;
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
  /** The person behind the chain (who asked, or who started the proposal): hand-offs from it need their permission. */
  by?: string;
  /** The ticket the work is for: the chain's. */
  ticket?: string;
  /** The thread its messages go in. */
  thread?: string;
  /** A later run of the chain replaced it while it waited: its end says nothing. */
  superseded?: boolean;
}
export interface TeamState {
  messages: TeamMessage[];
  tasks: TeamTask[];
  /** Today's answer turns and what each cost (runs are costed from the run store). */
  answers: { at: number; usd: number }[];
  /** People already told why their ask became a proposal (told once). */
  told?: string[];
  queue?: Queued[];
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
  /** Approvals and proposals waiting on a person. */
  needs: number;
  /** When the newest messages from others came (newest 50): the sidebar counts the unread ones. */
  recent: number[];
  queue: Queued[];
}
/** What an agent is doing now (board 8's Right now strip and the sidebar's Agents). */
export interface AgentNow {
  state: AgentState;
  /** "editing Tabs.tsx", "reviewing Bolt's change". */
  line?: string;
  since?: number;
  /** 0 to 1: steps done of steps. */
  progress?: number;
  title?: string;
  runId?: string;
  ticket?: string;
  squad?: string;
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
  members: ({ id: string; name: string; specialty: string } & AgentNow)[];
  queue: Queued[];
  working: WorkItem[];
  spend: { usd: number; runs: number };
  status: TeamStatus;
}
