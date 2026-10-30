/** Goal types shared by the server (src/goals) and the dashboard (web), with no imports so web can use them. */
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
  /** Where it was made: a chat's goal card. */
  origin?: GoalOrigin;
}
/** A goal's optional caps and their ranges: [lowest, highest, whole numbers only]. */
export type LimitKey = 'budgetUsd' | 'maxRuns' | 'maxMinutes';
export const LIMITS: Record<LimitKey, readonly [lo: number, hi: number, whole: boolean]> = { budgetUsd: [0.01, 1000, false], maxRuns: [1, 50, true], maxMinutes: [1, 1440, true] };
export const GOAL_TYPES: readonly GoalType[] = ['feature', 'bugfix', 'refactor', 'chore'];
export interface GoalOrigin {
  kind: 'chat';
  chat: string;
  message: string;
}
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
/** A goal as the dashboard gets it (GET /api/goals): items carry their run's status; progress runs 0 to 1. */
export interface GoalView extends Goal {
  items: (GoalItem & { runStatus?: string })[];
  progress: number;
}
