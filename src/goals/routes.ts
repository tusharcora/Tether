/**
 * /api/goals*: the loopback server has checked Host and Origin. Every field is validated here; the only calls that start
 * a run are POST /api/goals/:id/next (the person's Start) and a goal on `auto`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from '../codeRoutes.js';
import { pipelinesDir } from '../config.js';
import { NAME_RE } from '../pipeline.js';
import { HttpError, readJson, reqObject, send } from '../serverkit.js';
import type { Store } from '../store.js';
import type { Goals } from './loop.js';
import type { Assignee, Goal, GoalCheck, GoalType, GoalView } from './types.js';

const num = (b: Record<string, unknown>, k: string, lo: number, hi: number, whole = false): number | undefined => {
  const v = b[k];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) throw new HttpError(400, `"${k}" must be ${whole ? 'a whole number' : 'a number'} from ${lo} to ${hi}`);
  return v;
};
const text = (b: Record<string, unknown>, k: string, max: number, oneLine = true): string | undefined => {
  const v = b[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new HttpError(400, `"${k}" must be a string`);
  const t = v.trim();
  if (oneLine && /[\n\r]/.test(t)) throw new HttpError(400, `"${k}" must be a single line`);
  if (t.length > max) throw new HttpError(400, `"${k}" is too long (max ${max})`);
  return t || undefined;
};
function checkOf(v: unknown): GoalCheck {
  const c = reqObject(v);
  if (c.kind !== 'command' && c.kind !== 'tests' && c.kind !== 'number') throw new HttpError(400, '"check.kind" must be "command", "tests" or "number"');
  const command = text(c, 'command', 1000);
  if (!command) throw new HttpError(400, '"check.command" is required');
  const target = text(c, 'target', 20);
  if (c.kind === 'number' && !/^(<=|>=)\s*-?\d+(\.\d+)?$/.test(target ?? '')) throw new HttpError(400, '"check.target" must look like "<=5" or ">=90"');
  return { kind: c.kind, command, ...(c.kind === 'number' ? { target } : {}) };
}
const enumOf = <T extends string>(b: Record<string, unknown>, k: string, ok: readonly T[]): T | undefined => {
  if (b[k] === undefined) return undefined;
  if (!ok.includes(b[k] as T)) throw new HttpError(400, `"${k}" must be one of ${ok.join(', ')}`);
  return b[k] as T;
};
const dateOf = (b: Record<string, unknown>) => {
  const d = text(b, 'dueDate', 10);
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, '"dueDate" must look like 2026-11-30');
  return d;
};
const TYPES = ['feature', 'bugfix', 'refactor', 'chore'] as const satisfies readonly GoalType[];
/** Who works on it: at most 20 teams or agents. An id that no longer exists is kept (the page shows it as removed). */
const assigneesOf = (b: Record<string, unknown>): Assignee[] | undefined => {
  const v = b.assignees;
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20) throw new HttpError(400, '"assignees" must be a list of at most 20');
  return v.map((a) => {
    const o = reqObject(a);
    const kind = enumOf(o, 'kind', ['team', 'agent'] as const);
    const id = text(o, 'id', 100);
    if (!kind || !id) throw new HttpError(400, 'an assignee needs a "kind" (team or agent) and an "id"');
    return { kind, id };
  });
};
const workflowOf = (home: string, b: Record<string, unknown>) => {
  const w = text(b, 'workflow', 64);
  if (w && w !== 'team' && (!NAME_RE.test(w) || !existsSync(join(pipelinesDir(home), `${w}.json`)))) throw new HttpError(400, `unknown workflow "${w}"`);
  return w;
};

export function goalView(goals: Goals, store: Store, g: Goal): GoalView {
  const items = goals.db.items(g.id).map((i) => ({ ...i, ...(i.runId ? { runStatus: store.state(i.runId)?.status } : {}) }));
  const done = (i: (typeof items)[number]) => i.done || i.runStatus === 'done';
  const last = g.lastCheck;
  const counts = last?.passing !== undefined || last?.failing !== undefined ? (last.passing ?? 0) / Math.max(1, (last.passing ?? 0) + (last.failing ?? 0)) : undefined;
  const progress = g.kind === 'tracker' ? (items.length ? items.filter(done).length / items.length : 0) : g.status === 'met' ? 1 : (counts ?? 0);
  return { ...g, items, progress };
}

export async function goalsRoute(c: { home: string; store: Store; goals: Goals }, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const { goals } = c;
  const p = url.pathname;
  const m = req.method ?? 'GET';
  const view = (g: Goal) => goalView(goals, c.store, g);
  let g: RegExpMatchArray | null;

  if (p === '/api/goals' && m === 'GET') {
    const ws = url.searchParams.get('ws');
    return send(res, 200, goals.db.list().filter((x) => !ws || x.workspace === ws).map(view)), true;
  }

  // goal changes, the way a run streams: the whole list on connect, then each goal that changes
  if (p === '/api/goals/stream' && m === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const write = (event: string, data: unknown) => void (!res.destroyed && res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    write('goals', goals.db.list().map(view));
    const off = goals.onChange((x) => write('goal', view(x)));
    const beat = setInterval(() => res.write(': hb\n\n'), 15_000);
    req.on('close', () => (off(), clearInterval(beat)));
    return true;
  }

  if (p === '/api/goals' && m === 'POST') {
    const b = reqObject(await readJson(req));
    const title = text(b, 'title', 200);
    if (!title) throw new HttpError(400, '"title" is required');
    const workspace = text(b, 'workspace', 100);
    projectRoot(c.home, workspace); // 400/404 for a missing or unknown project
    const check = b.check === undefined || b.check === null ? undefined : checkOf(b.check);
    const kind = enumOf(b, 'kind', ['loop', 'tracker'] as const) ?? (check ? 'loop' : 'tracker');
    if (kind === 'loop' && !check) throw new HttpError(400, 'a loop needs a "check"');
    const dueDate = dateOf(b);
    const type = enumOf(b, 'type', TYPES);
    const description = text(b, 'description', 500, false);
    const assignees = assigneesOf(b);
    const goal: Goal = {
      id: `g${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
      workspace: workspace!,
      title,
      kind,
      status: 'active',
      ...(check ? { check } : {}),
      budgetUsd: num(b, 'budgetUsd', 0.01, 1000) ?? 5,
      maxRuns: num(b, 'maxRuns', 1, 50, true) ?? 5,
      approval: enumOf(b, 'approval', ['ask', 'auto'] as const) ?? 'ask',
      workflow: workflowOf(c.home, b) ?? 'team',
      ...(dueDate ? { dueDate } : {}),
      createdAt: Date.now(),
      spentUsd: 0,
      ...(type ? { type } : {}),
      ...(description ? { description } : {}),
      ...(assignees?.length ? { assignees } : {}),
    };
    return send(res, 201, view(goals.create(goal))), true;
  }

  if ((g = p.match(/^\/api\/goals\/([^/]+)(?:\/(check|next|items)(?:\/(\d+))?)?$/))) {
    let id: string;
    try {
      id = decodeURIComponent(g[1]!);
    } catch {
      throw new HttpError(400, 'malformed id');
    }
    const sub = g[2];
    goals.db.must(id);

    if (!sub && m === 'GET') return send(res, 200, view(goals.db.must(id))), true;
    if (!sub && m === 'DELETE') {
      goals.db.remove(id);
      return send(res, 200, { deleted: id }), true;
    }
    if (!sub && m === 'PATCH') {
      const b = reqObject(await readJson(req));
      const status = enumOf(b, 'status', ['active', 'paused', 'stopped'] as const);
      const patch: Parameters<Goals['update']>[1] = {};
      const title = text(b, 'title', 200);
      if (b.title !== undefined && !title) throw new HttpError(400, '"title" cannot be empty');
      if (title) patch.title = title;
      const approval = enumOf(b, 'approval', ['ask', 'auto'] as const);
      if (approval) patch.approval = approval;
      const budgetUsd = num(b, 'budgetUsd', 0.01, 1000);
      if (budgetUsd !== undefined) patch.budgetUsd = budgetUsd;
      const maxRuns = num(b, 'maxRuns', 1, 50, true);
      if (maxRuns !== undefined) patch.maxRuns = maxRuns;
      const wf = workflowOf(c.home, b);
      if (wf) patch.workflow = wf;
      if (b.dueDate !== undefined) patch.dueDate = dateOf(b);
      if (b.check !== undefined && b.check !== null) patch.check = checkOf(b.check);
      const type = enumOf(b, 'type', TYPES);
      if (type) patch.type = type;
      if (b.description !== undefined) patch.description = text(b, 'description', 500, false);
      const assignees = assigneesOf(b);
      if (assignees) patch.assignees = assignees.length ? assignees : undefined;
      if (Object.keys(patch).length) goals.update(id, patch);
      return send(res, 200, view(status ? goals.setStatus(id, status) : goals.db.must(id))), true;
    }
    if (sub === 'check' && m === 'POST') return send(res, 200, view(await goals.check(id))), true;
    if (sub === 'next' && m === 'POST') {
      const b = reqObject(await readJson(req));
      const action = enumOf(b, 'action', ['start', 'skip'] as const);
      if (!action) throw new HttpError(400, '"action" must be "start" or "skip"');
      return send(res, 200, view(await goals.next(id, action, text(b, 'plan', 2000, false)))), true;
    }
    if (sub === 'items' && m === 'POST') {
      const b = reqObject(await readJson(req));
      const t = text(b, 'text', 300);
      const runId = text(b, 'runId', 64);
      if (runId && !c.store.state(runId)) throw new HttpError(404, `unknown run ${runId}`);
      if (!t && !runId) throw new HttpError(400, '"text" or "runId" is required');
      const item = goals.addItem(id, { text: t ?? `Run ${runId}`, ...(runId ? { runId } : {}) });
      return send(res, 201, item), true;
    }
    if (sub === 'items' && g[3] && m === 'PATCH') {
      const b = reqObject(await readJson(req));
      if (b.done !== undefined && typeof b.done !== 'boolean') throw new HttpError(400, '"done" must be true or false');
      const assignees = assigneesOf(b);
      if (b.done === undefined && !assignees) throw new HttpError(400, '"done" or "assignees" is required');
      return send(res, 200, goals.editItem(id, Number(g[3]), { ...(b.done !== undefined ? { done: b.done as boolean } : {}), ...(assignees ? { assignees } : {}) })), true;
    }
  }
  return false;
}
