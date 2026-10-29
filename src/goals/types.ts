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
  budgetUsd: number;
  maxRuns: number;
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
