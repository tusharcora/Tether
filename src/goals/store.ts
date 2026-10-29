/**
 * Goals live in the run store's database (runs.db): a goal and its items. `ensureGoals` is the migration: it only ever
 * adds tables and columns, so an older database opens unchanged and running it twice is harmless.
 */
import type { Db } from '../http/history.js';
import { HttpError } from '../serverkit.js';
import type { Attempt, CheckResult, Goal, GoalCheck, GoalItem, GoalKind, GoalStatus, Plan } from './types.js';

export function ensureGoals(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      check_json TEXT,
      budget_usd REAL NOT NULL,
      max_runs INTEGER NOT NULL,
      approval TEXT NOT NULL,
      workflow TEXT NOT NULL,
      due_date TEXT,
      created_at INTEGER NOT NULL,
      spent_usd REAL NOT NULL DEFAULT 0,
      reason TEXT,
      last_check TEXT,
      pending TEXT
    );
    CREATE TABLE IF NOT EXISTS goal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      run_id TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      attempt TEXT,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS goal_items_goal ON goal_items(goal_id, id);
  `);
  // teams (2026-10-29): a loop owned by a team agent
  const cols = new Set((db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]).map((c) => c.name));
  for (const c of ['team', 'agent']) if (!cols.has(c)) db.exec(`ALTER TABLE goals ADD COLUMN ${c} TEXT`);
}

const json = <T>(s: unknown): T | undefined => (typeof s === 'string' ? (JSON.parse(s) as T) : undefined);
type Row = Record<string, unknown>;
const toGoal = (r: Row): Goal => ({
  id: r.id as string,
  workspace: r.workspace as string,
  title: r.title as string,
  kind: r.kind as GoalKind,
  status: r.status as GoalStatus,
  ...(r.check_json ? { check: json<GoalCheck>(r.check_json) } : {}),
  budgetUsd: r.budget_usd as number,
  maxRuns: r.max_runs as number,
  approval: r.approval as 'ask' | 'auto',
  workflow: r.workflow as string,
  ...(r.due_date ? { dueDate: r.due_date as string } : {}),
  createdAt: r.created_at as number,
  spentUsd: r.spent_usd as number,
  ...(r.reason ? { reason: r.reason as string } : {}),
  ...(r.last_check ? { lastCheck: json<CheckResult>(r.last_check) } : {}),
  ...(r.pending ? { pending: json<Plan>(r.pending) } : {}),
  ...(r.team ? { team: r.team as string } : {}),
  ...(r.agent ? { agent: r.agent as string } : {}),
});
const toItem = (r: Row): GoalItem => ({
  id: r.id as number,
  goalId: r.goal_id as string,
  kind: r.kind as 'manual' | 'run',
  text: r.text as string,
  ...(r.run_id ? { runId: r.run_id as string } : {}),
  done: r.done === 1,
  ...(r.attempt ? { attempt: json<Attempt>(r.attempt) } : {}),
  at: r.at as number,
});

export class GoalStore {
  constructor(private db: Db) {
    ensureGoals(db);
  }
  list(): Goal[] {
    return (this.db.prepare('SELECT * FROM goals ORDER BY created_at DESC, rowid DESC').all() as Row[]).map(toGoal);
  }
  get(id: string): Goal | undefined {
    const r = this.db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Row | undefined;
    return r && toGoal(r);
  }
  must(id: string): Goal {
    const g = this.get(id);
    if (!g) throw new HttpError(404, `unknown goal ${id}`);
    return g;
  }
  insert(g: Goal): void {
    this.db
      .prepare('INSERT INTO goals(id, workspace, title, kind, status, check_json, budget_usd, max_runs, approval, workflow, due_date, created_at, spent_usd, team, agent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)')
      .run(g.id, g.workspace, g.title, g.kind, g.status, g.check ? JSON.stringify(g.check) : null, g.budgetUsd, g.maxRuns, g.approval, g.workflow, g.dueDate ?? null, g.createdAt, g.team ?? null, g.agent ?? null);
  }
  /** Replace the fields that change after creation. */
  save(g: Goal): void {
    this.db
      .prepare('UPDATE goals SET title=?, kind=?, status=?, check_json=?, budget_usd=?, max_runs=?, approval=?, workflow=?, due_date=?, spent_usd=?, reason=?, last_check=?, pending=? WHERE id=?')
      .run(g.title, g.kind, g.status, g.check ? JSON.stringify(g.check) : null, g.budgetUsd, g.maxRuns, g.approval, g.workflow, g.dueDate ?? null, g.spentUsd, g.reason ?? null, g.lastCheck ? JSON.stringify(g.lastCheck) : null, g.pending ? JSON.stringify(g.pending) : null, g.id);
  }
  remove(id: string): void {
    this.db.prepare('DELETE FROM goal_items WHERE goal_id = ?').run(id);
    this.db.prepare('DELETE FROM goals WHERE id = ?').run(id);
  }
  items(goalId: string): GoalItem[] {
    return (this.db.prepare('SELECT * FROM goal_items WHERE goal_id = ? ORDER BY id').all(goalId) as Row[]).map(toItem);
  }
  addItem(i: { goalId: string; kind: 'manual' | 'run'; text: string; runId?: string; attempt?: Attempt }): GoalItem {
    const r = this.db
      .prepare('INSERT INTO goal_items(goal_id, kind, text, run_id, done, attempt, at) VALUES (?,?,?,?,0,?,?) RETURNING *')
      .get(i.goalId, i.kind, i.text, i.runId ?? null, i.attempt ? JSON.stringify(i.attempt) : null, Date.now()) as Row;
    return toItem(r);
  }
  saveItem(i: GoalItem): void {
    this.db.prepare('UPDATE goal_items SET text=?, done=?, attempt=? WHERE id=?').run(i.text, i.done ? 1 : 0, i.attempt ? JSON.stringify(i.attempt) : null, i.id);
  }
}
