/**
 * Asks become goals (spec 2026-10-29-asks-goals-runs §6.1): the goal a reply drafts is checked here against what exists in
 * the project (teams, crew agents, saved workflows) before a goal is made from it. A reply's draft is lenient (unknown ids
 * are dropped, limits clamped); edits sent with Start are strict (an error to answer 400 with).
 */
import { randomBytes } from 'node:crypto';
import { listPipelines } from '../config.js';
import { loadBindings } from '../bindings.js';
import { AGENT_KINDS, loadCrew } from '../crew.js';
import { checkOf } from '../goals/routes.js';
import { GOAL_TYPES, LIMITS, type Assignee, type Goal, type GoalOrigin, type GoalType, type LimitKey } from '../goals/types.js';
import { loadTeams } from '../teams/store.js';
import type { GoalDraft } from './types.js';

export const DRAFT_AGENTS_MAX = 5;

/** What a draft may name: the project's teams (with their agents), the crew's agents and the saved workflows. */
export interface DraftCtx {
  teams: { id: string; name: string; agents: string[] }[];
  agents: { id: string; name: string; specialty: string; model?: string }[];
  workflows: string[];
}

export function draftContext(home: string, ws: string): DraftCtx {
  const f = loadTeams(home);
  const bots = loadCrew(home).filter((b) => AGENT_KINDS.has(b.kind));
  const known = new Set(bots.map((b) => b.id));
  const links = loadBindings(home);
  // what the card says each agent runs on: its model, or "free model" on OpenRouter and NVIDIA
  const modelOf = (id: string) => {
    const l = links[id];
    return l?.model ?? (l?.agent === 'openrouter' || l?.agent === 'nvidia' ? 'free model' : l?.agent);
  };
  return {
    teams: f.teams.filter((t) => t.project === ws).map((t) => ({ id: t.id, name: t.name, agents: t.agents.filter((a) => known.has(a)) })),
    agents: bots.map((b) => ({ id: b.id, name: b.name, specialty: f.agents[b.id]?.specialty ?? b.title ?? '', ...(modelOf(b.id) ? { model: modelOf(b.id) } : {}) })),
    workflows: listPipelines(home).map((p) => p.name),
  };
}

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** The draft as it may be kept, or why not (strict: any unknown id or out-of-range limit; lenient: only a missing title or a bad type). */
export function checkDraft(raw: unknown, ctx: DraftCtx, strict = false): GoalDraft | string {
  const x = obj(raw);
  if (!x) return 'a goal draft must be an object';
  const title = str(x.title, 200);
  if (!title) return 'a goal needs a "title"';
  const type = x.type === undefined || x.type === null ? 'feature' : GOAL_TYPES.find((t) => t === x.type);
  if (!type) return `"type" must be one of ${GOAL_TYPES.join(', ')}`;
  const description = str(x.description, 500);

  let team = typeof x.team === 'string' && x.team ? x.team : undefined;
  if (team && !ctx.teams.some((t) => t.id === team)) {
    if (strict) return `unknown team "${team}"`;
    team = undefined;
  }
  const rawAgents = Array.isArray(x.agents) ? x.agents : [];
  if (strict && rawAgents.length > DRAFT_AGENTS_MAX) return `at most ${DRAFT_AGENTS_MAX} agents`;
  const agents: GoalDraft['agents'] = [];
  for (const a of rawAgents) {
    const o = obj(a) ?? {};
    const id = typeof o.id === 'string' ? o.id : '';
    const known = ctx.agents.find((b) => b.id === id);
    if (!known) {
      if (strict) return `unknown agent "${id}"`;
      continue;
    }
    if (agents.some((b) => b.id === id) || agents.length >= DRAFT_AGENTS_MAX) continue;
    const why = str(o.why, 120);
    agents.push({ id, role: str(o.role, 60) || 'works on it', ...(why ? { why } : {}), ...(known.model ? { model: known.model } : {}) });
  }

  let workflow = str(x.workflow, 64) || 'team';
  if (workflow !== 'team' && !ctx.workflows.includes(workflow)) {
    if (strict) return `unknown workflow "${workflow}"`;
    workflow = 'team';
  }

  let check: GoalDraft['check'];
  if (x.check !== undefined && x.check !== null) {
    try {
      check = checkOf(x.check);
    } catch (e) {
      if (strict) return (e as Error).message;
    }
  }

  const limits: NonNullable<GoalDraft['limits']> = {};
  const lim = obj(x.limits) ?? {};
  for (const k of Object.keys(LIMITS) as LimitKey[]) {
    const v = lim[k];
    if (v === undefined || v === null) continue;
    const [lo, hi, whole] = LIMITS[k];
    const ok = typeof v === 'number' && Number.isFinite(v);
    if (strict && (!ok || v < lo || v > hi || (whole && !Number.isInteger(v)))) return `"limits.${k}" must be ${whole ? 'a whole number' : 'a number'} from ${lo} to ${hi}`;
    if (ok) limits[k] = Math.min(hi, Math.max(lo, whole ? Math.round(v) : v));
  }

  if (strict && x.approval !== undefined && x.approval !== 'ask' && x.approval !== 'auto') return '"approval" must be "ask" or "auto"';
  return {
    title,
    type: type as GoalType,
    ...(description ? { description } : {}),
    ...(check ? { check } : {}),
    ...(team ? { team } : {}),
    agents,
    workflow,
    ...(Object.keys(limits).length ? { limits } : {}),
    approval: x.approval === 'auto' ? 'auto' : 'ask',
  };
}

/** Who works on it and who owns it: the team and its agents as assignees; with a team, the first agent (or the team's) runs it. */
function people(d: GoalDraft, ctx: DraftCtx): Pick<Goal, 'assignees' | 'team' | 'agent'> {
  const assignees: Assignee[] = [...(d.team ? [{ kind: 'team' as const, id: d.team }] : []), ...d.agents.map((a) => ({ kind: 'agent' as const, id: a.id }))];
  const owner = d.team ? (d.agents[0]?.id ?? ctx.teams.find((t) => t.id === d.team)?.agents[0]) : undefined;
  return { assignees: assignees.length ? assignees : undefined, team: owner ? d.team : undefined, agent: owner };
}

/** The goal a draft makes: paused ("not started") until the person's Start. */
export function goalFromDraft(d: GoalDraft, o: { workspace: string; origin: GoalOrigin; ctx: DraftCtx }): Goal {
  const p = people(d, o.ctx);
  return {
    id: `g${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    workspace: o.workspace,
    title: d.title,
    kind: d.check ? 'loop' : 'tracker',
    status: 'paused',
    ...(d.check ? { check: d.check } : {}),
    ...d.limits,
    approval: d.approval,
    workflow: d.workflow,
    createdAt: Date.now(),
    spentUsd: 0,
    type: d.type,
    ...(d.description ? { description: d.description } : {}),
    ...(p.assignees ? { assignees: p.assignees } : {}),
    ...(p.team ? { team: p.team, agent: p.agent } : {}),
    origin: o.origin,
  };
}

/** The edits a Start brings, as a goal patch (a limit left out is cleared: the card shows every limit it keeps). */
export function draftPatch(d: GoalDraft, ctx: DraftCtx) {
  return {
    title: d.title,
    type: d.type,
    description: d.description,
    workflow: d.workflow,
    approval: d.approval,
    budgetUsd: d.limits?.budgetUsd,
    maxRuns: d.limits?.maxRuns,
    maxMinutes: d.limits?.maxMinutes,
    ...(d.check ? { check: d.check } : {}),
    ...people(d, ctx),
  };
}

/** What the goal's first run is asked to do: the ask, what it is for, and when it is done. */
export const firstTask = (task: string, d: GoalDraft) => [task, d.description && d.description !== task ? d.description : '', d.check ? `Done when \`${d.check.command}\` passes.` : ''].filter(Boolean).join('\n\n').slice(0, 2000);

/** The prompt's part that asks for a goal card and lists what it may name. */
export function goalsPromptPart(ctx: DraftCtx): string {
  const name = (id: string) => ctx.agents.find((a) => a.id === id)?.name ?? id;
  const teams = ctx.teams.map((t) => `- ${t.id} "${t.name}": ${t.agents.map((a) => `${a} (${name(a)})`).join(', ') || 'no agents'}`).join('\n');
  const agents = ctx.agents.map((a) => `- ${a.id} "${a.name}"${a.specialty ? `: ${a.specialty}` : ''}`).join('\n');
  return `Asks become tickets: when the person asks you to build, fix, change or do something in this project (or says "make a ticket to …"), end with exactly one "goal" proposal (not "workflow" or "team") so the work is set up as a ticket; a question gets no proposal. Name only what exists here:
Squads in this project (as "team"):
${teams || '- none'}
Crew agents:
${agents || '- none'}
Workflows: ${[...ctx.workflows, 'team (Tether plans a squad run)'].join(', ')}
A goal proposal: {"kind":"goal","task":"the ask in one line","draft":{"title":"what done looks like","type":"feature|bugfix|refactor|chore","description":"one or two sentences","check":{"kind":"tests","command":"npm test -- auth"},"team":"<team id, or leave out>","agents":[{"id":"<agent id>","role":"fixes it","why":"one line: its specialty, or files it worked on lately"}],"workflow":"<workflow name or team>","approval":"ask"}}
Up to ${DRAFT_AGENTS_MAX} agents. Add a "check" only when a command can tell it is done. No "limits" unless the person asked for a cap ({"budgetUsd":2,"maxRuns":3,"maxMinutes":60}). In your prose say in a sentence that you made it a ticket and that it starts when they press Start.
`;
}
