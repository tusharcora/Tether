/**
 * Schedules: a cron rule that starts a workflow in a workspace, or gives a goal its next turn. They live in
 * <home>/schedules.json (owner-only). While the server runs, a ticker every 30 s starts what is due; a fire missed while
 * the app was closed runs once on start (deepseek-harness's catch-up rule), then the next fire moves past now.
 * Fire times are local (the machine's time zone); see cron.ts for DST.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { CronError, nextFire, parseCron } from './cron.js';
import { HttpError, readJson, reqObject, send } from './serverkit.js';

export type ScheduleTarget = { kind: 'workflow'; workflow: string; task: string } | { kind: 'goal'; goalId: string };
export interface Schedule {
  id: string;
  name: string;
  cron: string;
  /** The workspace a workflow target runs in. */
  workspace?: string;
  target: ScheduleTarget;
  enabled: boolean;
  /** The next fire (ISO); absent while it is off, or when the rule never fires again. */
  nextAt?: string;
  lastRunAt?: string;
  /** A goal's turn has no run id of its own. */
  lastRunId?: string;
  lastError?: string;
}

const TICK_MS = 30_000;
const MAX_SCHEDULES = 100;
const ID_RE = /^s-[0-9a-f]{8}$/;
const WORKFLOW_RE = /^[A-Za-z0-9._-]{1,64}$/;
const file = (home: string) => join(home, 'schedules.json');
const iso = (ms: number) => new Date(ms).toISOString();

export function loadSchedules(home: string): Schedule[] {
  try {
    const j = JSON.parse(readFileSync(file(home), 'utf8')) as { schedules?: unknown };
    return Array.isArray(j.schedules) ? (j.schedules as Schedule[]).filter((s) => s && typeof s.id === 'string' && typeof s.cron === 'string' && !!s.target) : [];
  } catch {
    return [];
  }
}

function save(home: string, list: Schedule[]): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(`${file(home)}.tmp`, JSON.stringify({ schedules: list }, null, 2) + '\n', { mode: 0o600 });
  renameSync(`${file(home)}.tmp`, file(home));
}

/** Change one schedule in place (load, patch, save in one synchronous step); undefined fields are removed. */
function update(home: string, id: string, patch: Partial<Schedule>): Schedule | undefined {
  const list = loadSchedules(home);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return undefined;
  const next = { ...list[i]!, ...patch } as Schedule & Record<string, unknown>;
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  list[i] = next;
  save(home, list);
  return next;
}

/** The next fire strictly after `now`, as ISO; undefined when the rule never fires again. */
export function nextAt(cron: string, now: number): string | undefined {
  const t = nextFire(parseCron(cron), now);
  return t === undefined ? undefined : iso(t);
}

export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;

  constructor(
    private readonly home: string,
    /** Starts a schedule's target; the run id, if it made a run. */
    private readonly start: (s: Schedule) => Promise<string | undefined>,
  ) {}

  /** Run what is due now (fires missed while closed, once each), then check every 30 s. */
  begin(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const s of loadSchedules(this.home)) if (s.enabled && s.nextAt && Date.parse(s.nextAt) <= now) await this.fire(s, now);
    } finally {
      this.ticking = false;
    }
  }

  /** Start one schedule's target now and record the outcome. The next fire moves past `now` first, so it never starts twice. */
  async fire(s: Schedule, now = Date.now()): Promise<Schedule> {
    if (s.enabled) update(this.home, s.id, { nextAt: nextAt(s.cron, now) });
    try {
      const runId = await this.start(s);
      return update(this.home, s.id, { lastRunAt: iso(now), lastRunId: runId, lastError: undefined }) ?? s;
    } catch (e) {
      const why = (e as Error).message.split('\n')[0]!.slice(0, 300);
      console.error(`[aorch] schedule ${s.id} (${s.name}) could not start: ${why}`);
      return update(this.home, s.id, { lastRunAt: iso(now), lastRunId: undefined, lastError: why }) ?? s;
    }
  }
}

/** What a new schedule may point at; each says whether the thing exists. */
export interface ScheduleRefs {
  /** The workspace's folder, or undefined when there is no such workspace (or its folder is gone). */
  workspacePath(id: string): string | undefined;
  /** Throws when no saved workflow or skill has this name. */
  checkWorkflow(name: string, dir: string): void;
  hasGoal(id: string): boolean;
}

function line(b: Record<string, unknown>, k: string, max: number): string | undefined {
  const v = b[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new HttpError(400, `"${k}" must be a string`);
  const t = v.trim();
  if (/[\n\r]/.test(t)) throw new HttpError(400, `"${k}" must be a single line`);
  if (t.length > max) throw new HttpError(400, `"${k}" is too long (max ${max})`);
  return t || undefined;
}

/** A checked cron, single-spaced; 400 with the parser's reason, or when it never fires. */
function cronOf(v: unknown, now: number): { cron: string; nextAt: string } {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, '"cron" is required: minute hour day-of-month month day-of-week, e.g. "0 2 * * *"');
  const cron = v.trim().replace(/\s+/g, ' ');
  try {
    const at = nextAt(cron, now);
    if (!at) throw new HttpError(400, `"${cron}" never fires`);
    return { cron, nextAt: at };
  } catch (e) {
    if (e instanceof CronError) throw new HttpError(400, e.message);
    throw e;
  }
}

function targetOf(b: Record<string, unknown>, refs: ScheduleRefs): { target: ScheduleTarget; workspace?: string } {
  const t = reqObject(b.target);
  if (t.kind === 'goal') {
    const goalId = line(t, 'goalId', 100);
    if (!goalId || !refs.hasGoal(goalId)) throw new HttpError(400, `no goal "${goalId ?? ''}"`);
    return { target: { kind: 'goal', goalId } };
  }
  if (t.kind !== 'workflow') throw new HttpError(400, '"target.kind" must be workflow or goal');
  const workflow = line(t, 'workflow', 64);
  if (!workflow || !WORKFLOW_RE.test(workflow)) throw new HttpError(400, '"target.workflow" must be a workflow name (letters, digits, . _ -)');
  const task = typeof t.task === 'string' ? t.task.trim() : '';
  if (!task || task.length > 4000) throw new HttpError(400, '"target.task" is required (at most 4000 characters): what the run should do');
  const workspace = line(b, 'workspace', 100);
  const dir = workspace ? refs.workspacePath(workspace) : undefined;
  if (!workspace || !dir) throw new HttpError(400, workspace ? `no workspace "${workspace}" (or its folder is gone)` : '"workspace" is required for a workflow');
  try {
    refs.checkWorkflow(workflow, dir);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  return { target: { kind: 'workflow', workflow, task }, workspace };
}

/** /api/schedules: list, create, switch on and off or edit (name, cron), delete, and run now. Host and Origin are checked by server.ts first. */
export async function schedulesRoute(c: { home: string; scheduler: Scheduler; refs: ScheduleRefs }, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const m = req.method ?? 'GET';
  if (p === '/api/schedules' && m === 'GET') return send(res, 200, loadSchedules(c.home)), true;
  if (p === '/api/schedules' && m === 'POST') {
    const b = reqObject(await readJson(req));
    const name = line(b, 'name', 80);
    if (!name) throw new HttpError(400, '"name" is required');
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') throw new HttpError(400, '"enabled" must be true or false');
    const enabled = b.enabled !== false;
    const { cron, nextAt: at } = cronOf(b.cron, Date.now());
    const { target, workspace } = targetOf(b, c.refs);
    const list = loadSchedules(c.home);
    if (list.length >= MAX_SCHEDULES) throw new HttpError(400, `at most ${MAX_SCHEDULES} schedules`);
    const s: Schedule = { id: `s-${randomBytes(4).toString('hex')}`, name, cron, ...(workspace ? { workspace } : {}), target, enabled, ...(enabled ? { nextAt: at } : {}) };
    save(c.home, [...list, s]);
    return send(res, 200, s), true;
  }
  const g = /^\/api\/schedules\/([^/]+)(\/run)?$/.exec(p);
  if (!g) return false;
  const id = decodeURIComponent(g[1]!);
  if (!ID_RE.test(id)) throw new HttpError(400, 'not a schedule id');
  const s = loadSchedules(c.home).find((x) => x.id === id);
  if (!s) throw new HttpError(404, `no schedule "${id}"`);
  if (g[2]) {
    if (m !== 'POST') return false;
    return send(res, 200, await c.scheduler.fire(s)), true;
  }
  if (m === 'DELETE') {
    save(c.home, loadSchedules(c.home).filter((x) => x.id !== id));
    return send(res, 200, { ok: true }), true;
  }
  if (m !== 'PATCH') return false;
  const b = reqObject(await readJson(req));
  if (b.enabled !== undefined && typeof b.enabled !== 'boolean') throw new HttpError(400, '"enabled" must be true or false');
  const enabled = typeof b.enabled === 'boolean' ? b.enabled : s.enabled;
  const name = b.name === undefined ? s.name : line(b, 'name', 80);
  if (!name) throw new HttpError(400, '"name" cannot be empty');
  const cron = b.cron === undefined ? s.cron : cronOf(b.cron, Date.now()).cron;
  // switched on again or a new rule: the next fire counts from now, so old missed fires do not run
  const fresh = enabled && (!s.enabled || cron !== s.cron);
  return send(res, 200, update(c.home, id, { name, cron, enabled, nextAt: enabled ? (fresh ? nextAt(cron, Date.now()) : s.nextAt) : undefined })), true;
}
