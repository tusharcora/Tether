/**
 * The rules of a team, as pure functions: who a message is for and what it asks (a question, a task, a loop, a review, a
 * merge), who may approve, what today has cost, and the workflow a task runs as. Message text is untrusted: nothing here
 * runs it, it only decides which of the team's own actions applies.
 */
import { personaOf, relink } from '../composer.js';
import { BUILTIN_IDS, type BotDef } from '../crew.js';
import { DEFAULT_ROLE_PROMPTS } from '../prompt.js';
import type { Pipeline, PipelineNode } from '../types.js';
import { startOfDay } from './store.js';
import type { Level, Team, TeamState, TeamTask } from './types.js';

export type Intent = 'merge' | 'review' | 'loop' | 'task' | 'ask';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRe = (n: string) => new RegExp(`(^|[^\\w@])@${esc(n)}(?![\\w-])`, 'i');

/** The agents a message @mentions (by name or id), in the order they appear, once each. */
export function mentionsOf(text: string, who: { id: string; name: string }[]): string[] {
  const hits: { id: string; at: number }[] = [];
  for (const w of who) {
    const at = Math.min(...[w.name, w.id].map((n) => text.search(nameRe(n))).filter((i) => i >= 0));
    if (Number.isFinite(at)) hits.push({ id: w.id, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

/** What the message asks of the agent named `name`: the words after its mention, or before it when nothing follows. */
export function instructionOf(text: string, name: string): string {
  const m = nameRe(name).exec(text);
  if (!m) return text.trim();
  const after = text.slice(m.index + m[0].length).replace(/^[\s,:;-]+/, '').trim();
  return after || text.slice(0, m.index + m[1]!.length).trim();
}

/** Verbs that hand over work (a run); questions and "check/look/explain" stay answers. */
const TASK_VERBS = new Set(
  'add fix make implement write update change refactor remove delete rename build create rewrite bump upgrade migrate clean move improve document port replace split extract wire convert tidy speed optimize optimise handle support finish continue rework run test set'.split(' '),
);
const POLITE = /^(hey|hi|ok|okay|please|pls|so|can you|could you|would you|will you|can u)\b[\s,]*/;

export function intentOf(instruction: string): Intent {
  let t = instruction.trim().toLowerCase();
  for (let prev = ''; prev !== t; ) (prev = t), (t = t.replace(POLITE, ''));
  const first = /^[a-z-]+/.exec(t)?.[0] ?? '';
  if (first === 'merge') return 'merge';
  if (first === 'review' || first === 're-review') return 'review';
  if (first === 'keep' || first === 'loop' || /\buntil\b[^.?!]*\b(pass|passes|green|clean)\b/.test(t) || /\bstop (when|at)\b/.test(t)) return 'loop';
  if (TASK_VERBS.has(first)) return 'task';
  return 'ask';
}

/** A loop's limits and check as the person wrote them ("stop at $5", "6 runs", a `backticked` command). */
export function loopSpec(text: string): { budgetUsd?: number; maxRuns?: number; command?: string } {
  const usd = /\$\s?(\d+(?:\.\d+)?)/.exec(text)?.[1];
  const runs = /\b(\d{1,2})\s*runs?\b/i.exec(text)?.[1];
  const command = /`([^`\n]{1,200})`/.exec(text)?.[1]?.trim();
  return { ...(usd ? { budgetUsd: Number(usd) } : {}), ...(runs ? { maxRuns: Number(runs) } : {}), ...(command ? { command } : {}) };
}

/** The team run a message names: `R-XXXX` (a run id's last four, as the dashboard shows it) or a full run id; the latest wins. */
export function runRefOf(text: string, tasks: TeamTask[]): TeamTask | undefined {
  const short = /\bR-([0-9A-Z]{4})\b/i.exec(text)?.[1]?.toLowerCase();
  const full = /\b(r[0-9a-z]{8,40})\b/.exec(text)?.[1];
  return [...tasks].reverse().find((t) => t.runId === full || (!!short && t.runId.slice(-4) === short));
}

/** The approver rule (spec §6.3), checked on every approve, reject and merge. `people` are persons only: an agent never is one. */
export function mayApprove(team: Team, personId: string): boolean {
  const inTeam = team.people.some((p) => p.id === personId);
  return inTeam && (team.approvers === 'any' || team.approvers.includes(personId));
}
/** Who may start runs, loops and goals (spec 2026-10-30 §2.4): the owner, or a person with "Can start runs". */
export function mayStart(team: Team, personId: string): boolean {
  const p = team.people.find((x) => x.id === personId);
  return !!p && (p.id === 'owner' || p.canStartRuns === true);
}
export function approverNames(team: Team): string {
  if (team.approvers === 'any') return 'Any teammate';
  const names = team.approvers.flatMap((id) => team.people.find((p) => p.id === id)?.name ?? []);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? 'nobody');
}

/** Runs the team's agents started today and what today cost (runs plus answers). */
export function spendToday(s: TeamState, costOf: (runId: string) => number, now = Date.now()): { usd: number; runs: number } {
  const from = startOfDay(now);
  const today = s.tasks.filter((t) => t.startedAt >= from);
  const usd = today.reduce((a, t) => a + costOf(t.runId), 0) + s.answers.filter((x) => x.at >= from).reduce((a, x) => a + x.usd, 0);
  return { usd: Math.round(usd * 1e6) / 1e6, runs: today.length };
}
/** Why nothing new may start today, or undefined. The $ limit counts only with Spending caps on (`caps`); runs per day always do. */
export function limitReason(team: Team, spend: { usd: number; runs: number }, caps: boolean): string | undefined {
  const l = team.limits;
  if (spend.runs >= l.runsPerDay) return `Today's limit is reached (${spend.runs} of ${l.runsPerDay} runs). Nothing new starts until tomorrow.`;
  if (caps && spend.usd >= l.usdPerDay) return `Today's limit is reached ($${spend.usd.toFixed(2)} of $${l.usdPerDay.toFixed(2)}). Nothing new starts until tomorrow.`;
  return undefined;
}

const PLAN_PROMPT = 'Write a short plan for the task: what you will change, in which files, and how you will check it. Do not modify any files.';
const WORK_PROMPT = "Do the task in the working tree in small steps, with tests alongside. Run the project's tests if you can.";
const LOOK_PROMPT = 'Do the task without modifying any files, and report what you found.';
/** A built-in role whose default instructions fit a step that does the task itself (a manager's or a gate's do not). */
const DIRECT_ROLES = new Set(['planner', 'architect', 'coder', 'reviewer']);

/**
 * The workflow a task runs as (spec §6.2, §6.3): the agent's own work step (on its binding), the project's gates, and the
 * level's approvals. Tight: plan → approve plan → work → gates → approve ship. Balanced: work → gates → approve ship. Loose
 * (or `ship: false`, a loop's runs): work → gates. A read-only agent only works: it has nothing to ship.
 */
export function taskPipeline(o: { bot: BotDef; level: Level; gates: { build?: string; test?: string }; budgetUsd?: number; ship: boolean }): Pipeline {
  const b = o.bot;
  const readOnly = b.kind === 'verdict' || !!b.readOnly;
  const own = BUILTIN_IDS.has(b.id) ? (DIRECT_ROLES.has(b.id) ? DEFAULT_ROLE_PROMPTS[b.id] : undefined) : personaOf(b);
  const node = (n: Omit<PipelineNode, 'x' | 'y'>): PipelineNode => ({ ...n, x: 0, y: 140 });
  const nodes: PipelineNode[] = [];
  if (!readOnly && o.level === 'tight') nodes.push(node({ id: 'plan', kind: 'agent', role: b.id, title: 'Plan', readOnly: true, prompt: PLAN_PROMPT }), node({ id: 'approve-plan', kind: 'approval', title: 'Approve plan' }));
  nodes.push(node({ id: 'work', kind: 'agent', role: b.id, title: 'Work', ...(readOnly ? { readOnly: true } : {}), prompt: own ?? (readOnly ? LOOK_PROMPT : WORK_PROMPT) }));
  if (!readOnly) {
    if (o.gates.build) nodes.push(node({ id: 'build', kind: 'gate', title: 'build', command: o.gates.build, maxLoops: 2 }));
    if (o.gates.test) nodes.push(node({ id: 'tests', kind: 'gate', title: 'tests', command: o.gates.test, maxLoops: 2 }));
    if (o.ship && o.level !== 'loose') nodes.push(node({ id: 'ship', kind: 'approval', title: 'Approve ship' }));
  }
  return relink({ name: 'team-task', version: 1, mode: 'pipeline', nodes, edges: [], settings: { parallel: 1, nodeTimeoutMs: 30 * 60_000, pipeMode: 'ancestors', ...(o.budgetUsd !== undefined ? { maxCostUsd: o.budgetUsd } : {}) } });
}
