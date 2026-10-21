/**
 * Team handoffs: parsing, validating and prompting for the plans and reviews a manager step produces.
 * Pure: no I/O, no engine imports.
 */
import { CREW } from './bots.js';
import { STEP_BLURB, STEP_TYPES, blurbFor, extractJson, makeStep, type StepType } from './composer.js';
import { ancestorsOf, parentsOf } from './pipeline.js';
import { DEFAULT_ROLE_PROMPTS } from './prompt.js';
import type { Contract, Pipeline, PipelineNode, RunState } from './types.js';

export interface PlanTask extends Contract {
  id: string;
}

export const DEFAULT_MAX_DEPTH = 3;
export const DEFAULT_MAX_SPAWN = 12;
const LOCAL_ID = /^[A-Za-z0-9_]{1,30}$/;
const OUTPUT_CLIP = 4000;
const UPSTREAM_CLIP = 12_000;
/** Plan size caps, checked before anything is spawned. */
export const PLAN_CAPS = { tasks: 12, goal: 500, expected: 500, context: 10 };

/** The step a bot or role would be in a hand-built workflow (persona, read-only, reviewer settings). */
export function baseStep(to: string): PipelineNode {
  const scratch = { name: 'spawn', version: 1, mode: 'pipeline', nodes: [], edges: [], settings: { parallel: 1, nodeTimeoutMs: 1000, pipeMode: 'ancestors' } } as Pipeline;
  return makeStep(to, scratch);
}

export function limitsOf(p: Pipeline): { maxDepth: number; maxSpawn: number } {
  return { maxDepth: p.settings?.maxDepth ?? DEFAULT_MAX_DEPTH, maxSpawn: p.settings?.maxSpawn ?? DEFAULT_MAX_SPAWN };
}

/** Who a manager may hand work to: its roster, or (absent/empty) the whole crew minus gates, approvals and managers. */
export function rosterOf(manager: PipelineNode): string[] {
  if (manager.roster?.length) return manager.roster;
  const builtin = STEP_TYPES.filter((t) => t !== 'tester' && t !== 'approval') as string[];
  const custom = Object.values(CREW).flatMap((c) => (c.def && !builtin.includes(c.def.id) && !(STEP_TYPES as string[]).includes(c.def.id) && c.def.kind !== 'orchestrator' && c.def.kind !== 'gate' && c.def.kind !== 'approval' ? [c.def.id] : []));
  return [...new Set([...builtin, ...custom])].filter((id) => id !== 'manager');
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function toTask(raw: unknown): PlanTask | string {
  if (!raw || typeof raw !== 'object') return 'a task is not an object';
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.to !== 'string' || typeof r.goal !== 'string') return 'each task needs string "id", "to" and "goal"';
  return {
    id: r.id,
    to: r.to.toLowerCase(),
    goal: r.goal,
    expected: typeof r.expected === 'string' ? r.expected : undefined,
    context: strList(r.context),
    mode: r.mode === 'write' ? 'write' : 'read',
    after: strList(r.after),
  };
}

function toTasks(v: unknown): PlanTask[] | string {
  if (!Array.isArray(v)) return '"tasks" must be an array';
  const out: PlanTask[] = [];
  for (const x of v) {
    const t = toTask(x);
    if (typeof t === 'string') return t;
    out.push(t);
  }
  return out;
}

function json(output: string): { j: Record<string, unknown> } | { error: string } {
  try {
    const j = extractJson(output);
    if (j && typeof j === 'object' && !Array.isArray(j)) return { j: j as Record<string, unknown> };
    return { error: 'reply was not a JSON object' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export function parsePlan(output: string): { tasks: PlanTask[] } | { error: string } {
  const parsed = json(output);
  if ('error' in parsed) return parsed;
  const j = parsed.j;
  const tasks = toTasks(j.tasks);
  return typeof tasks === 'string' ? { error: tasks } : { tasks };
}

export function parseReview(output: string): { accept: true } | { redo: { id: string; reason: string }[] } | { more: PlanTask[] } | { error: string } {
  const parsed = json(output);
  if ('error' in parsed) return parsed;
  const j = parsed.j;
  if (j.decision === 'accept') return { accept: true };
  if (Array.isArray(j.redo)) {
    const redo = j.redo.flatMap((x) => (x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? [{ id: (x as { id: string }).id, reason: String((x as { reason?: unknown }).reason ?? '') }] : []));
    return redo.length ? { redo } : { error: '"redo" needs at least one {id, reason}' };
  }
  if (j.more !== undefined) {
    const more = toTasks(j.more);
    if (typeof more === 'string') return { error: more.replace('"tasks"', '"more"') };
    return more.length ? { more } : { error: '"more" needs at least one task' };
  }
  return { error: 'expected {"decision":"accept"}, {"redo":[...]} or {"more":[...]}' };
}

/**
 * Why this plan cannot be run, or undefined when it can. `used` is the spawn budget already spent
 * (spawned steps plus redos); it defaults to `state.spawned`.
 */
export function validatePlan(tasks: PlanTask[], o: { manager: PipelineNode; state: RunState; roster: string[]; allowWrite: boolean; used?: number }): string | undefined {
  if (!tasks.length) return 'the plan has no tasks';
  if (tasks.length > PLAN_CAPS.tasks) return `${tasks.length} tasks is too many for one plan (at most ${PLAN_CAPS.tasks})`;
  const budget = limitsOf(o.state.pipeline).maxSpawn - (o.used ?? o.state.spawned);
  if (tasks.length > budget) return `${tasks.length} tasks exceeds the spawn budget (${Math.max(0, budget)} left)`;
  const ids = new Set<string>();
  for (const t of tasks) {
    if (!LOCAL_ID.test(t.id)) return `task id "${t.id}" must be 1-30 letters, digits or underscores`;
    if (ids.has(t.id)) return `duplicate task id "${t.id}"`;
    ids.add(t.id);
  }
  const existing = new Set(o.state.pipeline.nodes.map((n) => n.id));
  for (const t of tasks) {
    if (!o.roster.includes(t.to)) return `task "${t.id}": unknown bot "${t.to}" (roster: ${o.roster.join(', ')})`;
    if (!t.goal.trim()) return `task "${t.id}" has an empty goal`;
    if (t.goal.length > PLAN_CAPS.goal) return `task "${t.id}": goal is longer than ${PLAN_CAPS.goal} characters`;
    if ((t.expected?.length ?? 0) > PLAN_CAPS.expected) return `task "${t.id}": expected is longer than ${PLAN_CAPS.expected} characters`;
    if (t.context.length > PLAN_CAPS.context) return `task "${t.id}": context names more than ${PLAN_CAPS.context} steps`;
    const base = baseStep(t.to);
    if (base.kind !== 'agent' || base.manager) return `task "${t.id}": "${t.to}" cannot take hand-offs (not a working bot)`;
    if (t.mode === 'write' && base.readOnly) return `task "${t.id}": "${t.to}" is read-only and cannot take a write task; use "mode":"read" or a bot that edits files`;
    for (const a of t.after) if (!ids.has(a)) return `task "${t.id}": after names unknown task "${a}"`;
    for (const c of t.context) if (!ids.has(c) && !existing.has(c)) return `task "${t.id}": context names unknown step "${c}"`;
    if (t.mode === 'write' && !o.allowWrite) return `task "${t.id}": write mode is not allowed in this workflow (settings.allowWrites is off); use "mode":"read"`;
  }
  // cycle check over `after` (Kahn)
  const indeg = new Map(tasks.map((t) => [t.id, t.after.length]));
  const ready = tasks.filter((t) => t.after.length === 0).map((t) => t.id);
  let seen = 0;
  while (ready.length) {
    const id = ready.pop()!;
    seen++;
    for (const t of tasks) if (t.after.includes(id)) {
      const d = indeg.get(t.id)! - t.after.filter((a) => a === id).length;
      indeg.set(t.id, d);
      if (d === 0) ready.push(t.id);
    }
  }
  if (seen < tasks.length) return 'the "after" links form a cycle';
  return undefined;
}

/**
 * The runnable step for a task: the receiving bot's own step (persona, read-only, reviewer settings) with the
 * contract on top. `siblings` are the plan's local ids, so `context` entries naming siblings are rewritten to full
 * ids while ids of existing pipeline steps are kept as they are. `after` is always local.
 */
export function toNode(t: PlanTask, manager: PipelineNode, depth: number, agent?: string, siblings: string[] = []): PipelineNode {
  const full = (id: string) => `${manager.id}-${id}`;
  const contract: Contract = { ...t, after: t.after.map(full), context: t.context.map((c) => (siblings.includes(c) ? full(c) : c)) };
  const { id: _id, x: _x, y: _y, maxLoops: _loops, fixNode: _fix, ...base } = baseStep(t.to);
  void [_id, _x, _y, _loops, _fix];
  return {
    ...base,
    id: full(t.id),
    kind: 'agent',
    role: base.role ?? t.to,
    ...(agent ? { agent } : {}),
    readOnly: !!base.readOnly || t.mode === 'read',
    x: manager.x,
    y: manager.y,
    spawn: { parent: manager.id, depth, contract },
  };
}

/** What a manager knows beyond the task: its own instructions, the project, upstream output and the steps so far. */
function managerContext(state: RunState, manager: PipelineNode): string[] {
  const p = state.pipeline;
  const out: string[] = [];
  const role = manager.prompt ?? DEFAULT_ROLE_PROMPTS[manager.role ?? ''];
  if (role) out.push(`Your instructions:\n${role}`);
  if (manager.guidance) out.push(`Guidance from the person in charge (follow it):\n${manager.guidance}`);
  if (state.workspace?.context) out.push(`Project context:\n${state.workspace.context}`);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const upstream = p.settings.pipeMode === 'direct' ? parentsOf(p, manager.id) : ancestorsOf(p, manager.id);
  const blocks: string[] = [];
  for (const id of upstream) {
    const un = byId.get(id);
    const o = state.nodes[id]?.output;
    if (un?.kind === 'agent' && o) blocks.push(`## ${un.role ?? un.kind} (${un.id})\n${clip(o, UPSTREAM_CLIP)}`);
  }
  if (blocks.length) out.push(`Upstream output:\n${blocks.join('\n\n')}`);
  const steps = p.nodes
    .filter((n) => n.id !== manager.id && n.spawn?.parent !== manager.id)
    .map((n) => `- ${n.id} (${n.role ?? n.kind}): ${state.nodes[n.id]?.status ?? 'queued'}`);
  if (steps.length) out.push(`Other steps in this run (a finished one can be named in "context"):\n${steps.join('\n')}`);
  return out;
}

function rosterLines(roster: string[]): string {
  return roster
    .map((id) => {
      const c = CREW[id];
      const blurb = id in STEP_BLURB ? STEP_BLURB[id as StepType] : blurbFor({ id: '', kind: 'agent', role: id, x: 0, y: 0 });
      return `- ${id}${c ? ` (${c.title || c.name})` : ''}: ${blurb}`;
    })
    .join('\n');
}

const TASK_SHAPE = '{"id":"short_id","to":"<roster id>","goal":"what to do","expected":"what done looks like","context":["ids of earlier steps whose output it needs"],"mode":"read|write","after":["ids of tasks in this plan that must finish first"]}';

/** `used`: spawn budget already spent (spawned steps plus redos), default `state.spawned`. */
export function planPrompt(state: RunState, manager: PipelineNode, roster: string[], rejection?: string, used = state.spawned): string {
  const { maxDepth, maxSpawn } = limitsOf(state.pipeline);
  const left = Math.max(0, maxSpawn - used);
  return [
    `You are "${manager.id}", a manager. Break the task below into hand-offs to your team.`,
    `Task:\n${state.task}`,
    ...managerContext(state, manager),
    `Your team (use these ids in "to"):\n${rosterLines(roster)}`,
    `Limits: at most ${left} more steps may be spawned in this run (${maxSpawn} total, redos included); nesting depth is at most ${maxDepth}. ${state.pipeline.settings.allowWrites ? 'Use "mode":"read" unless the step must change files.' : 'Every task must use "mode":"read": this workflow does not allow spawned steps to change files.'} Tasks with no "after" run in parallel.`,
    rejection ? `Your previous plan was rejected: ${rejection}\nFix it and answer again.` : '',
    `Reply with ONLY a JSON object, no prose:\n{"tasks":[${TASK_SHAPE}]}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function reviewPrompt(state: RunState, manager: PipelineNode, children: PipelineNode[], round: number): string {
  const parts = children.map((c) => {
    const ns = state.nodes[c.id];
    const exp = c.spawn?.contract.expected;
    const body = ns?.error ? `error: ${ns.error}` : `output:\n${clip(ns?.output ?? '(none)', OUTPUT_CLIP)}`;
    return `### ${c.id} (${c.role ?? c.kind})\ngoal: ${c.spawn?.contract.goal ?? ''}\nexpected: ${exp ?? '(unspecified)'}\nstatus: ${ns?.status ?? 'unknown'}\n${body}`;
  });
  return [
    `You are "${manager.id}", reviewing your team's work (round ${round}).`,
    `Task:\n${state.task}`,
    ...managerContext(state, manager),
    parts.join('\n\n'),
    `Decide. Reply with ONLY one JSON object:\n{"decision":"accept"}  when the work meets what was expected,\n{"redo":[{"id":"<step id>","reason":"what to fix"}]}  to send steps back,\n{"more":[${TASK_SHAPE}]}  to add further tasks.`,
  ].join('\n\n');
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.floor(max / 2))}\n[... ${s.length - max} chars omitted ...]\n${s.slice(-Math.floor(max / 2))}`;
}

// ---- Worker hand-offs: a working step ends its answer with `@HAND <bot>: <goal> | expect: <expected> | context: <ids>` ----

export interface HandRequest {
  to: string;
  goal: string;
  expected?: string;
  context: string[];
  write: boolean;
}

const HAND_LINE = /^@HAND(!)?[ \t]+([^\s:]+)[ \t]*:[ \t]*(.*)$/i;
const MAX_HANDS = 2;
const RESULT_CLIP = 6000;

/** Hand-off requests a step put on their own lines (at most two). */
export function parseHands(output: string): HandRequest[] {
  const out: HandRequest[] = [];
  for (const { line, hand } of scanHands(output)) {
    const m = hand ? HAND_LINE.exec(line) : null;
    if (!m) continue;
    const [goalPart = '', ...rest] = m[3]!.split(' | ');
    let expected: string | undefined;
    let context: string[] = [];
    for (const part of rest) {
      const kv = /^\s*(expect|context)\s*:\s*(.*)$/i.exec(part);
      if (!kv) continue;
      if (kv[1]!.toLowerCase() === 'expect') expected = kv[2]!.trim().slice(0, PLAN_CAPS.expected) || undefined;
      else context = kv[2]!.split(',').map((s) => s.trim()).filter(Boolean).slice(0, PLAN_CAPS.context);
    }
    out.push({ to: m[2]!.toLowerCase().replace(/^[`'"]+|[`'",.]+$/g, ''), goal: goalPart.trim().slice(0, PLAN_CAPS.goal), expected, context, write: !!m[1] });
    if (out.length >= MAX_HANDS) break;
  }
  return out;
}

export function stripHands(output: string): string {
  return scanHands(output).filter((l) => !l.hand).map((l) => l.raw).join('\n').trimEnd();
}

/** Lines of the output, flagged when they are a real @HAND line: at column 0 and outside ``` fences. CRLF tolerated. */
function scanHands(output: string): { raw: string; line: string; hand: boolean }[] {
  let fenced = false;
  return output.split('\n').map((raw) => {
    const line = raw.replace(/\r$/, '');
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return { raw, line, hand: false };
    }
    return { raw, line, hand: !fenced && HAND_LINE.test(line) };
  });
}

/** Why this hand-off cannot be run, or undefined when it can. `used` is the spawn budget already spent. */
export function validateHand(req: HandRequest, o: { delegator: PipelineNode; state: RunState; roster: string[]; allowWrite: boolean; used: number }): string | undefined {
  if (!req.goal.trim()) return 'the hand-off has an empty goal';
  if (!o.roster.includes(req.to)) return `unknown bot "${req.to}" (you may hand to: ${o.roster.join(', ')})`;
  const byId = new Map(o.state.pipeline.nodes.map((n) => [n.id, n]));
  const chain = new Set<string>([o.delegator.role ?? o.delegator.id, o.delegator.id]);
  const seen = new Set<string>([o.delegator.id]);
  for (let p = o.delegator.spawn?.parent; p && !seen.has(p); p = byId.get(p)?.spawn?.parent) {
    seen.add(p);
    const n = byId.get(p);
    chain.add(p);
    chain.add(n?.role ?? p);
  }
  if (chain.has(req.to)) return `handing to "${req.to}" would loop back to a bot already in this chain of hand-offs`;
  if (req.write) {
    if (!o.allowWrite) return 'write hand-offs are not allowed in this workflow (settings.allowWorkerWrites is off); use @HAND instead of @HAND!';
    if (baseStep(req.to).readOnly) return `"${req.to}" is read-only and cannot take a write hand-off; use @HAND`;
  }
  const { maxDepth, maxSpawn } = limitsOf(o.state.pipeline);
  if ((o.delegator.spawn?.depth ?? 0) + 1 > maxDepth) return `nesting depth would exceed the limit (${maxDepth})`;
  if (o.used >= maxSpawn) return `the spawn budget is used up (${maxSpawn})`;
  for (const c of req.context) if (!byId.has(c)) return `context names unknown step "${c}"`;
  return undefined;
}

/** The step a validated hand-off becomes. `n` numbers the delegator's hand-offs from 1. */
export function handNode(req: HandRequest, delegator: PipelineNode, n: number): PipelineNode {
  const depth = (delegator.spawn?.depth ?? 0) + 1;
  const node = toNode({ id: `h${n}`, to: req.to, goal: req.goal, expected: req.expected, context: req.context, mode: req.write ? 'write' : 'read', after: [] }, delegator, depth, undefined, []);
  return { ...node, spawn: { ...node.spawn!, kind: 'hand' } };
}

/** What the delegator receives for its next call. `last`: no further round of hand-offs is allowed. */
export function handoffBlock(results: { to: string; goal: string; answer: string; ok: boolean }[], last = true): string {
  const body = results
    .map((r, i) => `${i + 1}. You handed to ${r.to}: ${r.goal}\n   Result: ${(r.ok ? clip(r.answer, RESULT_CLIP) : `failed: ${clip(r.answer, RESULT_CLIP)}`).replace(/\n/g, '\n   ')}`)
    .join('\n\n');
  return `# Handoff results\n${body}\n\n${last ? 'Now give your complete final answer using these results. Do not add new @HAND lines.' : 'Now give your complete final answer using these results. Hand off again (a new @HAND line) only if more work is clearly needed.'}`;
}
