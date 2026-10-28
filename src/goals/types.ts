/** Goal types shared by the server (src/goals) and the dashboard (web), with no imports so web can use them. */
export type GoalKind = 'loop' | 'tracker';
export type GoalStatus = 'active' | 'needs_you' | 'paused' | 'met' | 'stopped';
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
}
/** A goal as the dashboard gets it (GET /api/goals): items carry their run's status; progress runs 0 to 1. */
export interface GoalView extends Goal {
  items: (GoalItem & { runStatus?: string })[];
  progress: number;
}
