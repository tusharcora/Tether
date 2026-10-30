/**
 * Goal and ticket types shared by the server (src/goals) and the dashboard (web), with no imports so web can use them.
 * Every goal is a ticket (spec 2026-10-30-squads-tickets §2.5): the goal's `status` is the loop engine's state, `stage`
 * is the ticket status people see.
 */
export type GoalKind = 'loop' | 'tracker';
export type GoalStatus = 'active' | 'needs_you' | 'paused' | 'met' | 'stopped';
/** What kind of work a goal is; a goal without one reads as a feature. */
export type GoalType = 'feature' | 'bugfix' | 'refactor' | 'chore';
/** Who works on a goal or a step: a Teams team id or a crew agent's name. */
export interface Assignee {
  kind: 'team' | 'agent';
  id: string;
}
export interface GoalCheck {
  kind: 'command' | 'tests' | 'number';
  command: string;
  /** number checks only: "<=5" or ">=90" against the number the command prints last. */
  target?: string;
}
/** One run of the finish check. */
export interface CheckResult {
  ok: boolean;
  at: number;
  /** "1 failing · 11 passing" where the output says so, and the counts behind it. */
  summary?: string;
  failing?: number;
  passing?: number;
  /** number checks: what the command printed. */
  value?: number;
  tail: string;
}
/** The next run Tether proposes (or will start at once on auto). */
export interface Plan {
  task: string;
  why?: string;
}
export interface Attempt {
  before?: CheckResult;
  after?: CheckResult;
  costUsd?: number;
  runStatus?: string;
}
/** The ticket status (Backlog, Todo, In progress, In review, Done, Canceled). */
export type Stage = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled';
export const STAGES: readonly Stage[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export const PRIORITIES: readonly Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
/** A ticket's assignee or reviewer: a crew agent or a person (`owner`, or a squad's Telegram person). */
export interface Member {
  kind: 'agent' | 'person';
  id: string;
}
export interface TicketPr {
  number: number;
  url: string;
  merged?: boolean;
  runId?: string;
}
/** One line of a ticket's activity, said the way a person would ("fixed it in 3 files, tests pass"). */
export interface TicketActivity {
  at: number;
  who: { kind: 'agent' | 'person' | 'tether'; id: string; name: string };
  text: string;
  runId?: string;
  /** A review's verdict. */
  verdict?: 'pass' | 'fail';
}
/** One acceptance criterion: a manual item people tick, or the auto-checked one (the old goal check's command). */
export interface Criterion {
  id: string;
  text: string;
  done: boolean;
  auto?: true;
  /** The tracker item behind a manual criterion. */
  item?: number;
}
export interface Goal {
  id: string;
  workspace: string;
  title: string;
  kind: GoalKind;
  status: GoalStatus;
  check?: GoalCheck;
  /** Caps, each optional: none set means none checked (a team goal is still held by its team's daily limits). */
  budgetUsd?: number;
  maxRuns?: number;
  /** Stop once this long has passed since the first Start. */
  maxMinutes?: number;
  approval: 'ask' | 'auto';
  /** 'team' or a saved workflow's name. */
  workflow: string;
  dueDate?: string;
  createdAt: number;
  spentUsd: number;
  /** Why a goal stopped. */
  reason?: string;
  lastCheck?: CheckResult;
  pending?: Plan;
  /** Loop work in a team: the team's id and the agent (crew bot) that owns it. Its runs start through the team. */
  team?: string;
  agent?: string;
  type?: GoalType;
  /** One or two sentences, at most 500 characters. */
  description?: string;
  /** Who is responsible; they do not change how runs start (the Owner, `team`/`agent`, does). */
  assignees?: Assignee[];
  /** When the goal became met or stopped. */
  endedAt?: number;
  /** The first Start (a goal made from chat waits paused, "not started", until then). */
  startedAt?: number;
  /** Where it was made: a chat's ticket card, a squad message or a trigger. */
  origin?: GoalOrigin;
  // ---- ticket fields (every goal is a ticket) ----
  /** The number in its key, `<PREFIX>-<num>`, per project in creation order. */
  num?: number;
  stage?: Stage;
  priority?: Priority;
  assignee?: Member;
  reviewer?: Member;
  labels?: string[];
  prs?: TicketPr[];
  /** The squad it belongs to (a squad's id). `team` is the squad that runs a recurring ticket's loop. */
  squad?: string;
  /** Newest last, at most ACTIVITY_MAX. */
  activity?: TicketActivity[];
}
export const ACTIVITY_MAX = 100;
export const LABELS_MAX = 8;
/** A goal's optional caps and their ranges: [lowest, highest, whole numbers only]. */
export type LimitKey = 'budgetUsd' | 'maxRuns' | 'maxMinutes';
export const LIMITS: Record<LimitKey, readonly [lo: number, hi: number, whole: boolean]> = { budgetUsd: [0.01, 1000, false], maxRuns: [1, 50, true], maxMinutes: [1, 1440, true] };
export const GOAL_TYPES: readonly GoalType[] = ['feature', 'bugfix', 'refactor', 'chore'];
export type GoalOrigin = { kind: 'chat'; chat: string; message: string } | { kind: 'squad'; squad: string; message: string } | { kind: 'trigger'; trigger: string };
export interface GoalItem {
  id: number;
  goalId: string;
  kind: 'manual' | 'run';
  text: string;
  runId?: string;
  done: boolean;
  attempt?: Attempt;
  at: number;
  assignees?: Assignee[];
}
/**
 * A ticket as the dashboard gets it (GET /api/tickets): items carry their run's status; progress runs 0 to 1. `key` is
 * `<PREFIX>-<num>`; `needs` says why it waits on a person, when it does.
 */
export interface GoalView extends Goal {
  items: (GoalItem & { runStatus?: string })[];
  progress: number;
  key: string;
  stage: Stage;
  criteria: Criterion[];
  needs?: string;
}
export type TicketView = GoalView;
