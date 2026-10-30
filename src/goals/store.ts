/**
 * Goals live in the run store's database (runs.db): a goal and its items. `ensureGoals` is the migration: it only ever
 * adds tables and columns, so an older database opens unchanged and running it twice is harmless. Tickets (spec
 * 2026-10-30-squads-tickets §2.6) are the same rows with ticket columns; `migrateTickets` fills them in once per goal.
 */
import type { Db } from '../http/history.js';
import { HttpError } from '../serverkit.js';
import { membersOf, stageOfStatus } from './tickets.js';
import type { Assignee, Attempt, CheckResult, Goal, GoalCheck, GoalItem, GoalKind, GoalOrigin, GoalStatus, GoalType, Member, Plan, Priority, Stage, TicketActivity, TicketPr } from './types.js';

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
  // teams (2026-10-29): a loop owned by a team agent; goals redesign (2026-10-29): type, description, assignees, ended_at
  const add = (table: string, cols: [string, string][]) => {
    const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const [c, t] of cols) if (!have.has(c)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} ${t}`);
  };
  // asks become goals (2026-10-29): a time limit, the first Start, and the chat a goal came from
  add('goals', [['team', 'TEXT'], ['agent', 'TEXT'], ['type', 'TEXT'], ['description', 'TEXT'], ['assignees', 'TEXT'], ['ended_at', 'INTEGER'], ['max_minutes', 'INTEGER'], ['started_at', 'INTEGER'], ['origin', 'TEXT']]);
  add('goal_items', [['assignees', 'TEXT']]);
  // squads and tickets (2026-10-30): every goal is a ticket
  add('goals', [['num', 'INTEGER'], ['stage', 'TEXT'], ['priority', 'TEXT'], ['assignee', 'TEXT'], ['reviewer', 'TEXT'], ['labels', 'TEXT'], ['prs', 'TEXT'], ['squad', 'TEXT'], ['activity', 'TEXT']]);
  // per project: the next ticket number (never reused) and the key prefix, once someone edits it
  db.exec('CREATE TABLE IF NOT EXISTS ticket_keys (workspace TEXT PRIMARY KEY, next INTEGER NOT NULL, prefix TEXT)');
  migrateTickets(db);
}

/** Take the next ticket number of a project. */
function takeNum(db: Db, ws: string): number {
  db.prepare('INSERT INTO ticket_keys(workspace, next) VALUES (?, 1) ON CONFLICT(workspace) DO NOTHING').run(ws);
  const r = db.prepare('UPDATE ticket_keys SET next = next + 1 WHERE workspace = ? RETURNING next').get(ws) as { next: number };
  return r.next - 1;
}

/**
 * Goals become tickets (spec §2.6), once each: a goal without a number gets the next one of its project in creation
 * order, a status (paused not started → Todo, paused → Backlog, active → In progress, needs_you → In review, met → Done,
 * stopped → Canceled), and an assignee and reviewer from its loop agent and assignees; a team assignee becomes its squad.
 * Only empty ticket columns are written: the check, items and runs stay as they are (they are the criteria and history).
 */
export function migrateTickets(db: Db): number {
  const rows = db.prepare('SELECT id, workspace, status, started_at, agent, assignees, team, stage, assignee, reviewer, squad FROM goals WHERE num IS NULL ORDER BY created_at, rowid').all() as Row[];
  if (!rows.length) return 0;
  db.exec('BEGIN');
  try {
    // a project whose numbers were set before its counter existed starts after them
    db.exec("INSERT INTO ticket_keys(workspace, next) SELECT workspace, MAX(num) + 1 FROM goals WHERE num IS NOT NULL GROUP BY workspace ON CONFLICT(workspace) DO UPDATE SET next = MAX(next, excluded.next)");
    const upd = db.prepare('UPDATE goals SET num=?, stage=?, assignee=?, reviewer=?, squad=? WHERE id=?');
    for (const r of rows) {
      const assignees = json<Assignee[]>(r.assignees) ?? [];
      const m = membersOf({ ...(r.agent ? { agent: r.agent as string } : {}), assignees });
      const squad = (r.squad as string | null) ?? (r.team as string | null) ?? assignees.find((a) => a.kind === 'team')?.id ?? null;
      upd.run(takeNum(db, r.workspace as string), (r.stage as string | null) ?? stageOfStatus(r.status as GoalStatus, !!r.started_at), (r.assignee as string | null) ?? (m.assignee ? JSON.stringify(m.assignee) : null), (r.reviewer as string | null) ?? (m.reviewer ? JSON.stringify(m.reviewer) : null), squad, r.id as string);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return rows.length;
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
  // the old columns are NOT NULL: 0 (outside both ranges) is "no limit"
  ...((r.budget_usd as number) > 0 ? { budgetUsd: r.budget_usd as number } : {}),
  ...((r.max_runs as number) > 0 ? { maxRuns: r.max_runs as number } : {}),
  ...(r.max_minutes ? { maxMinutes: r.max_minutes as number } : {}),
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
  ...(r.type ? { type: r.type as GoalType } : {}),
  ...(r.description ? { description: r.description as string } : {}),
  ...(r.assignees ? { assignees: json<Assignee[]>(r.assignees) } : {}),
  ...(r.ended_at ? { endedAt: r.ended_at as number } : {}),
  ...(r.started_at ? { startedAt: r.started_at as number } : {}),
  ...(r.origin ? { origin: json<GoalOrigin>(r.origin) } : {}),
  ...(r.num ? { num: r.num as number } : {}),
  ...(r.stage ? { stage: r.stage as Stage } : {}),
  ...(r.priority ? { priority: r.priority as Priority } : {}),
  ...(r.assignee ? { assignee: json<Member>(r.assignee) } : {}),
  ...(r.reviewer ? { reviewer: json<Member>(r.reviewer) } : {}),
  ...(r.labels ? { labels: json<string[]>(r.labels) } : {}),
  ...(r.prs ? { prs: json<TicketPr[]>(r.prs) } : {}),
  ...(r.squad ? { squad: r.squad as string } : {}),
  ...(r.activity ? { activity: json<TicketActivity[]>(r.activity) } : {}),
});
/** A JSON column: null for none (an empty list too). */
const col = (v: unknown) => (v === undefined || (Array.isArray(v) && !v.length) ? null : JSON.stringify(v));
/** Assignees as stored: JSON, or null for none. */
const who = (a?: Assignee[]) => (a?.length ? JSON.stringify(a) : null);
const toItem = (r: Row): GoalItem => ({
  id: r.id as number,
  goalId: r.goal_id as string,
  kind: r.kind as 'manual' | 'run',
  text: r.text as string,
  ...(r.run_id ? { runId: r.run_id as string } : {}),
  done: r.done === 1,
  ...(r.attempt ? { attempt: json<Attempt>(r.attempt) } : {}),
  at: r.at as number,
  ...(r.assignees ? { assignees: json<Assignee[]>(r.assignees) } : {}),
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
  /** Insert a goal; it gets the next ticket number of its project. Returns it as stored. */
  insert(g: Goal): Goal {
    const t: Goal = { ...g, num: g.num ?? takeNum(this.db, g.workspace), stage: g.stage ?? stageOfStatus(g.status, !!g.startedAt), ...(!g.assignee && !g.reviewer ? membersOf(g) : {}) };
    this.db
      .prepare('INSERT INTO goals(id, workspace, title, kind, status, check_json, budget_usd, max_runs, approval, workflow, due_date, created_at, spent_usd, team, agent, type, description, assignees, max_minutes, started_at, origin, num, stage, priority, assignee, reviewer, labels, prs, squad, activity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(t.id, t.workspace, t.title, t.kind, t.status, t.check ? JSON.stringify(t.check) : null, t.budgetUsd ?? 0, t.maxRuns ?? 0, t.approval, t.workflow, t.dueDate ?? null, t.createdAt, t.team ?? null, t.agent ?? null, t.type ?? null, t.description ?? null, who(t.assignees), t.maxMinutes ?? null, t.startedAt ?? null, t.origin ? JSON.stringify(t.origin) : null, t.num!, t.stage!, t.priority ?? null, col(t.assignee), col(t.reviewer), col(t.labels), col(t.prs), t.squad ?? null, col(t.activity));
    return t;
  }
  /** Replace the fields that change after creation. */
  save(g: Goal): void {
    this.db
      .prepare('UPDATE goals SET title=?, kind=?, status=?, check_json=?, budget_usd=?, max_runs=?, approval=?, workflow=?, due_date=?, spent_usd=?, reason=?, last_check=?, pending=?, type=?, description=?, assignees=?, ended_at=?, max_minutes=?, started_at=?, team=?, agent=?, stage=?, priority=?, assignee=?, reviewer=?, labels=?, prs=?, squad=?, activity=? WHERE id=?')
      .run(g.title, g.kind, g.status, g.check ? JSON.stringify(g.check) : null, g.budgetUsd ?? 0, g.maxRuns ?? 0, g.approval, g.workflow, g.dueDate ?? null, g.spentUsd, g.reason ?? null, g.lastCheck ? JSON.stringify(g.lastCheck) : null, g.pending ? JSON.stringify(g.pending) : null, g.type ?? null, g.description ?? null, who(g.assignees), g.endedAt ?? null, g.maxMinutes ?? null, g.startedAt ?? null, g.team ?? null, g.agent ?? null, g.stage ?? null, g.priority ?? null, col(g.assignee), col(g.reviewer), col(g.labels), col(g.prs), g.squad ?? null, col(g.activity), g.id);
  }
  /** The ticket a run belongs to: the goal it is a run item of. */
  ofRun(runId: string): string | undefined {
    return (this.db.prepare('SELECT goal_id FROM goal_items WHERE run_id = ? ORDER BY id DESC LIMIT 1').get(runId) as { goal_id?: string } | undefined)?.goal_id;
  }
  /** A project's edited key prefix, if any. */
  prefix(ws: string): string | undefined {
    return ((this.db.prepare('SELECT prefix FROM ticket_keys WHERE workspace = ?').get(ws) as { prefix?: string | null } | undefined)?.prefix ?? undefined) || undefined;
  }
  setPrefix(ws: string, prefix: string): void {
    this.db.prepare('INSERT INTO ticket_keys(workspace, next, prefix) VALUES (?, 1, ?) ON CONFLICT(workspace) DO UPDATE SET prefix = excluded.prefix').run(ws, prefix);
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
    this.db.prepare('UPDATE goal_items SET text=?, done=?, attempt=?, assignees=? WHERE id=?').run(i.text, i.done ? 1 : 0, i.attempt ? JSON.stringify(i.attempt) : null, who(i.assignees), i.id);
  }
}
