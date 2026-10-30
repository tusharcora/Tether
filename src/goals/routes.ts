/**
 * /api/tickets* (and /api/goals*, its alias for one release): the loopback server has checked Host and Origin. Every
 * field is validated here; the only calls that start a run are Start, the next run (POST /api/tickets/:id/next), a goal on
 * `auto`, and an @agent comment, which hands the ticket to that agent in its squad.
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
import { getWorkspace } from '../workspace.js';
import { draftContext, goalFromDraft } from '../assistant/goalDraft.js';
import { listChats, readChat, saveChat } from '../assistant/history.js';
import type { Goals } from './loop.js';
import { criteriaOf, keyOf, prefixFrom, PREFIX_RE, stageOf } from './tickets.js';
import { GOAL_TYPES, LABELS_MAX, LIMITS, PRIORITIES, STAGES, type Assignee, type Goal, type GoalCheck, type GoalItem, type GoalView, type LimitKey, type Member } from './types.js';

const num = (b: Record<string, unknown>, k: string, lo: number, hi: number, whole = false): number | undefined => {
  const v = b[k];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) throw new HttpError(400, `"${k}" must be ${whole ? 'a whole number' : 'a number'} from ${lo} to ${hi}`);
  return v;
};
/** The caps: each optional; `null` clears one on a PATCH. */
const limitsOf = (b: Record<string, unknown>): Partial<Record<LimitKey, number | null>> =>
  Object.fromEntries((Object.keys(LIMITS) as LimitKey[]).flatMap((k): [LimitKey, number | null][] => (b[k] === null ? [[k, null]] : b[k] === undefined ? [] : [[k, num(b, k, ...LIMITS[k])!]])));
const text = (b: Record<string, unknown>, k: string, max: number, oneLine = true): string | undefined => {
  const v = b[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new HttpError(400, `"${k}" must be a string`);
  const t = v.trim();
  if (oneLine && /[\n\r]/.test(t)) throw new HttpError(400, `"${k}" must be a single line`);
  if (t.length > max) throw new HttpError(400, `"${k}" is too long (max ${max})`);
  return t || undefined;
};
export function checkOf(v: unknown): GoalCheck {
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

/** Why a ticket waits on a person: a next run to approve, its latest run waiting on an approval, or its latest run failed. */
function needsOf(g: Goal, items: GoalItem[], store: Store): string | undefined {
  if (g.status === 'needs_you') return 'Its next run waits for you';
  const last = [...items].reverse().find((i) => i.kind === 'run' && i.runId && store.state(i.runId));
  const s = last && store.state(last.runId!);
  if (!s) return undefined;
  const waiting = s.pipeline.nodes.find((n) => n.kind === 'approval' && s.nodes[n.id]?.status === 'awaiting');
  if (waiting) return waiting.id === 'approve-plan' ? 'The plan waits for your approval' : 'Ready to ship: it waits for your approval';
  if (s.status === 'error' && stageOf(g) === 'in_progress') return `The last run failed${s.error ? `: ${s.error.split('\n')[0]!.slice(0, 160)}` : ''}`;
  return undefined;
}

/** Key prefixes, read once per request: the edited one, else from the project's name. */
export const prefixes = (home: string, goals: Goals) => {
  const seen = new Map<string, string>();
  return (ws: string) => seen.get(ws) ?? (seen.set(ws, goals.db.prefix(ws) ?? prefixFrom(getWorkspace(home, ws)?.name ?? ws)), seen.get(ws)!);
};

export function goalView(goals: Goals, store: Store, g: Goal, prefix: (ws: string) => string = prefixFrom): GoalView {
  const raw = goals.db.items(g.id);
  const items = raw.map((i) => ({ ...i, ...(i.runId ? { runStatus: store.state(i.runId)?.status } : {}) }));
  const done = (i: (typeof items)[number]) => i.done || i.runStatus === 'done';
  const last = g.lastCheck;
  const counts = last?.passing !== undefined || last?.failing !== undefined ? (last.passing ?? 0) / Math.max(1, (last.passing ?? 0) + (last.failing ?? 0)) : undefined;
  const progress = g.kind === 'tracker' ? (items.length ? items.filter(done).length / items.length : 0) : g.status === 'met' ? 1 : (counts ?? 0);
  const needs = needsOf(g, raw, store);
  return { ...g, items, progress, key: keyOf(prefix(g.workspace), g.num), stage: stageOf(g), criteria: criteriaOf(g, raw), ...(needs ? { needs } : {}) };
}

const memberOf = (v: unknown, k: string): Member | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const o = reqObject(v);
  if ((o.kind !== 'agent' && o.kind !== 'person') || typeof o.id !== 'string' || !o.id || o.id.length > 100) throw new HttpError(400, `"${k}" must be {"kind":"agent"|"person","id":"..."} or null`);
  return { kind: o.kind, id: o.id };
};
const labelsOf = (v: unknown): string[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > LABELS_MAX || !v.every((x) => typeof x === 'string' && x.trim() && x.length <= 30 && !/[\n\r]/.test(x))) throw new HttpError(400, `"labels" must be at most ${LABELS_MAX} short words`);
  return [...new Set(v.map((x: string) => x.trim().toLowerCase()))];
};
/** The ticket fields of a create or a patch; `null` clears an assignee or reviewer. */
function ticketFields(b: Record<string, unknown>) {
  const priority = enumOf(b, 'priority', PRIORITIES);
  const assignee = memberOf(b.assignee, 'assignee');
  const reviewer = memberOf(b.reviewer, 'reviewer');
  const labels = labelsOf(b.labels);
  const squad = b.squad === null ? null : text(b, 'squad', 40);
  return { priority, assignee, reviewer, labels, squad };
}

/** What the ticket routes need from squads and runs: handing a ticket to an agent, shipping it, sending it back. */
export interface TicketHooks {
  /** A comment: when it @mentions an agent, the agent gets the ticket in a squad. Throws an HttpError when it cannot. */
  hand?(g: Goal, text: string): Promise<void>;
  /** Start on a ticket assigned to a squad agent: the agent takes it in its squad. False: not such a ticket. */
  start?(g: Goal): Promise<boolean>;
  /** Merge PR / Ship it: the ticket's waiting run ships, or its open PR merges once checks pass. */
  ship?(g: Goal): Promise<void>;
  /** Send back: the waiting run is rejected with the reason (its agent reworks it once). */
  sendBack?(g: Goal, reason?: string): Promise<void>;
}
const IDEAS_MAX = 20;
/** Asks that did not become tickets: dismissed goal cards of the project's chats whose goal is gone, newest first. */
export function ideasOf(home: string, ws: string, goals: Goals): { chat: string; proposal: string; title: string; type?: string; at: number }[] {
  return listChats(home, ws)
    .flatMap((ch) => ch.messages.flatMap((m) => (m.proposals ?? []).filter((x) => x.kind === 'goal' && x.status === 'dismissed' && x.draft && !(x.goalId && goals.db.get(x.goalId))).map((x) => ({ chat: ch.id, proposal: x.id, title: x.draft!.title, type: x.draft!.type, at: m.at }))))
    .sort((a, b) => b.at - a.at);
}
/** Manual criteria of a new ticket: at most 20 lines. */
function criteriaIn(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 20 || !v.every((x) => typeof x === 'string' && x.trim() && x.length <= 300 && !/[\n\r]/.test(x))) throw new HttpError(400, '"criteria" must be at most 20 single lines');
  return v.map((x: string) => x.trim());
}

export async function goalsRoute(c: { home: string; store: Store; goals: Goals; hooks?: TicketHooks }, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const { goals } = c;
  const p = url.pathname;
  const m = req.method ?? 'GET';
  const prefix = prefixes(c.home, goals);
  const view = (g: Goal) => goalView(goals, c.store, g, prefix);
  let g: RegExpMatchArray | null;

  // a project's key prefix (spec §2.5: from the project name, editable); every key of the project follows it
  if (p === '/api/tickets/prefix' && m === 'PUT') {
    const b = reqObject(await readJson(req));
    const ws = text(b, 'workspace', 100);
    projectRoot(c.home, ws);
    const pre = text(b, 'prefix', 6)?.toUpperCase();
    if (!pre || !PREFIX_RE.test(pre)) throw new HttpError(400, '"prefix" must be 1 to 6 letters or digits, starting with a letter');
    goals.db.setPrefix(ws!, pre);
    return send(res, 200, { workspace: ws, prefix: pre }), true;
  }

  // board 10's "Ideas from your chats": goal cards a chat drafted that were answered "Just answer, no goal"
  if (p === '/api/tickets/ideas' && m === 'GET') {
    const ws = url.searchParams.get('ws') ?? undefined;
    projectRoot(c.home, ws);
    return send(res, 200, ideasOf(c.home, ws!, goals).slice(0, IDEAS_MAX)), true;
  }
  // "+": the idea becomes a Backlog ticket, made from its chat; it leaves the list
  if (p === '/api/tickets/ideas' && m === 'POST') {
    const b = reqObject(await readJson(req));
    const ws = text(b, 'workspace', 100);
    projectRoot(c.home, ws);
    const chat = text(b, 'chat', 40);
    const pid = text(b, 'proposal', 40);
    const found = chat ? readChat(c.home, ws, chat) : undefined;
    const msg = found?.messages.find((x) => x.proposals?.some((y) => y.id === pid));
    const prop = msg?.proposals?.find((y) => y.id === pid);
    if (!found || !msg || !prop?.draft || prop.kind !== 'goal' || prop.status !== 'dismissed' || (prop.goalId && goals.db.get(prop.goalId))) throw new HttpError(404, 'no such idea (it may already be a ticket)');
    const g = goals.create({ ...goalFromDraft(prop.draft, { workspace: ws!, origin: { kind: 'chat', chat: found.id, message: msg.id }, ctx: draftContext(c.home, ws!) }), stage: 'backlog', activity: [{ at: Date.now(), who: { kind: 'person', id: 'owner', name: 'You' }, text: 'made this from an idea in a chat' }] });
    prop.goalId = g.id;
    saveChat(c.home, ws, found);
    return send(res, 201, view(g)), true;
  }

  if (p === '/api/tickets' && m === 'GET') {
    const ws = url.searchParams.get('ws');
    return send(res, 200, goals.db.list().filter((x) => !ws || x.workspace === ws).map(view)), true;
  }

  // goal changes, the way a run streams: the whole list on connect, then each goal that changes
  if (p === '/api/tickets/stream' && m === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const write = (event: string, data: unknown) => void (!res.destroyed && res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    write('goals', goals.db.list().map(view));
    const off = goals.onChange((x) => write('goal', goalView(goals, c.store, x, prefixes(c.home, goals))));
    const beat = setInterval(() => res.write(': hb\n\n'), 15_000);
    req.on('close', () => (off(), clearInterval(beat)));
    return true;
  }

  if (p === '/api/tickets' && m === 'POST') {
    const b = reqObject(await readJson(req));
    const title = text(b, 'title', 200);
    if (!title) throw new HttpError(400, '"title" is required');
    const workspace = text(b, 'workspace', 100);
    projectRoot(c.home, workspace); // 400/404 for a missing or unknown project
    const check = b.check === undefined || b.check === null ? undefined : checkOf(b.check);
    const kind = enumOf(b, 'kind', ['loop', 'tracker'] as const) ?? (check ? 'loop' : 'tracker');
    if (kind === 'loop' && !check) throw new HttpError(400, 'a loop needs a "check"');
    const dueDate = dateOf(b);
    const type = enumOf(b, 'type', GOAL_TYPES);
    const description = text(b, 'description', 2000, false);
    const assignees = assigneesOf(b);
    const t = ticketFields(b);
    // a ticket made on the Tickets screen waits in Backlog or Todo for its Start; without `stage`, a goal starts as before
    const stage = enumOf(b, 'stage', ['backlog', 'todo'] as const);
    const criteria = criteriaIn(b.criteria);
    const goal: Goal = {
      id: `g${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
      workspace: workspace!,
      title,
      kind: b.recurring === true && check ? 'loop' : b.recurring === false && stage ? 'tracker' : kind,
      status: stage ? 'paused' : 'active',
      ...(stage ? { stage } : {}),
      ...(t.priority ? { priority: t.priority } : {}),
      ...(t.assignee ? { assignee: t.assignee } : {}),
      ...(t.reviewer ? { reviewer: t.reviewer } : {}),
      ...(t.labels?.length ? { labels: t.labels } : {}),
      ...(t.squad ? { squad: t.squad } : {}),
      activity: [{ at: Date.now(), who: { kind: 'person', id: 'owner', name: 'You' }, text: 'created this' }],
      ...(check ? { check } : {}),
      ...Object.fromEntries(Object.entries(limitsOf(b)).filter(([, v]) => v !== null)),
      approval: enumOf(b, 'approval', ['ask', 'auto'] as const) ?? 'ask',
      workflow: workflowOf(c.home, b) ?? 'team',
      ...(dueDate ? { dueDate } : {}),
      createdAt: Date.now(),
      spentUsd: 0,
      ...(type ? { type } : {}),
      ...(description ? { description } : {}),
      ...(assignees?.length ? { assignees } : {}),
    };
    const made = goals.create(goal);
    for (const x of criteria) goals.addItem(made.id, { text: x });
    return send(res, 201, view(goals.db.must(made.id))), true;
  }

  if ((g = p.match(/^\/api\/tickets\/([^/]+)(?:\/(check|next|items|start|comments|ship|send-back)(?:\/(\d+))?)?$/))) {
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
      for (const [k, v] of Object.entries(limitsOf(b))) patch[k as LimitKey] = v ?? undefined;
      const wf = workflowOf(c.home, b);
      if (wf) patch.workflow = wf;
      if (b.dueDate !== undefined) patch.dueDate = dateOf(b);
      if (b.check !== undefined && b.check !== null) patch.check = checkOf(b.check);
      const type = enumOf(b, 'type', GOAL_TYPES);
      if (type) patch.type = type;
      if (b.description !== undefined) patch.description = text(b, 'description', 2000, false);
      const assignees = assigneesOf(b);
      if (assignees) patch.assignees = assignees.length ? assignees : undefined;
      const t = ticketFields(b);
      if (t.priority) patch.priority = t.priority;
      if (t.assignee !== undefined) patch.assignee = t.assignee ?? undefined;
      if (t.reviewer !== undefined) patch.reviewer = t.reviewer ?? undefined;
      if (t.labels) patch.labels = t.labels;
      if (t.squad !== undefined) patch.squad = t.squad ?? undefined;
      if (b.recurring !== undefined && typeof b.recurring !== 'boolean') throw new HttpError(400, '"recurring" must be true or false');
      if (typeof b.recurring === 'boolean') patch.recurring = b.recurring;
      const stage = enumOf(b, 'stage', STAGES);
      if (Object.keys(patch).length) goals.update(id, patch);
      if (stage) goals.setStage(id, stage, { kind: 'person', id: 'owner', name: 'You' });
      return send(res, 200, view(status ? goals.setStatus(id, status) : goals.db.must(id))), true;
    }
    // a comment; an @agent in it hands the ticket to that agent (spec §2.5)
    if (sub === 'comments' && m === 'POST') {
      const body = text(reqObject(await readJson(req)), 'text', 2000, false);
      if (!body) throw new HttpError(400, '"text" is required');
      const x = goals.db.must(id);
      goals.note(id, { who: { kind: 'person', id: 'owner', name: 'You' }, text: body });
      await c.hooks?.hand?.(x, body);
      return send(res, 201, view(goals.db.must(id))), true;
    }
    if (sub === 'ship' && m === 'POST') {
      if (!c.hooks?.ship) throw new HttpError(409, 'Nothing can ship this ticket here.');
      await c.hooks.ship(goals.db.must(id));
      return send(res, 200, view(goals.db.must(id))), true;
    }
    if (sub === 'send-back' && m === 'POST') {
      if (!c.hooks?.sendBack) throw new HttpError(409, 'Nothing can send this ticket back here.');
      await c.hooks.sendBack(goals.db.must(id), text(reqObject(await readJson(req)), 'reason', 300, false));
      return send(res, 200, view(goals.db.must(id))), true;
    }
    if (sub === 'check' && m === 'POST') return send(res, 200, view(await goals.check(id))), true;
    // the first Start of a goal that waits "not started": its title and description are the first run's task
    if (sub === 'start' && m === 'POST') {
      const x = goals.db.must(id);
      if (x.startedAt || x.status !== 'paused') throw new HttpError(409, 'this ticket has already started');
      if (await c.hooks?.start?.(x)) return send(res, 200, view(goals.db.must(id))), true;
      return send(res, 200, view(goals.begin(id, [x.title, x.description].filter(Boolean).join('\n\n')))), true;
    }
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
