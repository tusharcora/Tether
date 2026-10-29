/**
 * The outcome loop. A goal with a finish check runs the check, and while it fails and the caps allow, proposes a run
 * (the default crew agent through the assistant's lean call and ```tether proposal format), waits for the person on
 * `ask` or starts it at once on `auto`, then re-checks when the run finishes. It ends `met` (the check passes) or
 * `stopped` (the budget or the run cap). Pause and Stop never kill a run already going: nothing new starts.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AdapterRegistry } from '../adapters/index.js';
import { checkReply } from '../assistant/reply.js';
import { loadBindings } from '../bindings.js';
import { assistantAgent } from '../assistant/turn.js';
import { projectRoot } from '../codeRoutes.js';
import { readPipeline } from '../config.js';
import type { Engine } from '../engine.js';
import { runProcess } from '../proc.js';
import { isFinished } from '../runLabels.js';
import { HttpError } from '../serverkit.js';
import type { Store } from '../store.js';
import { TEAM_MAX_BUDGET_USD } from '../team.js';
import { GoalStore } from './store.js';
import type { Assignee, Attempt, CheckResult, Goal, GoalCheck, GoalItem, Plan } from './types.js';

const CHECK_MS = 300_000;
const TAIL = 4000;
const tail = (s: string) => (s.length > TAIL ? s.slice(s.length - TAIL) : s);

/** Counts from a test runner's output (vitest, jest, pytest and the like). */
export function parseCounts(out: string): { failing?: number; passing?: number; summary?: string } {
  const n = (re: RegExp) => {
    const m = re.exec(out)?.[1];
    return m ? Number(m) : undefined;
  };
  const failing = n(/(\d+)\s+(?:failed|failing)/i);
  const passing = n(/(\d+)\s+(?:passed|passing)/i);
  const parts = [failing !== undefined && `${failing} failing`, passing !== undefined && `${passing} passing`].filter(Boolean);
  return { ...(failing !== undefined ? { failing } : {}), ...(passing !== undefined ? { passing } : {}), ...(parts.length ? { summary: parts.join(' · ') } : {}) };
}

/** Did a check's output meet its target? number checks compare the last number printed. */
export function judge(check: GoalCheck, code: number | null, out: string): Pick<CheckResult, 'ok' | 'value'> {
  if (check.kind !== 'number') return { ok: code === 0 };
  const nums = out.match(/-?\d+(?:\.\d+)?/g);
  const m = /^(<=|>=)\s*(-?\d+(?:\.\d+)?)$/.exec(check.target ?? '');
  if (!nums || !m) return { ok: false };
  const value = Number(nums.at(-1));
  return { ok: code === 0 && (m[1] === '<=' ? value <= Number(m[2]) : value >= Number(m[2])), value };
}

/** How a team's loop starts its runs (the agent's workflow, on the chain's branch) and why its team lets nothing start. */
export interface GoalHooks {
  start(g: Goal, plan: Plan): Promise<string>;
  blocked(g: Goal): string | undefined;
}

export interface GoalsDeps {
  home: string;
  store: Store;
  engine: Engine;
  registry: AdapterRegistry;
  /** For goals with a `team`. */
  hooks?: GoalHooks;
}

export class Goals {
  readonly db: GoalStore;
  private listeners = new Set<(g: Goal) => void>();
  /** run id -> goal id, for the runs this loop is waiting on. */
  private watched = new Map<string, string>();
  private jobs = new Set<Promise<unknown>>();

  constructor(private d: GoalsDeps) {
    this.db = new GoalStore(d.store.raw());
    d.store.onAppend((e) => {
      const gid = this.watched.get(e.runId);
      if (gid && this.runDone(e.runId)) this.job(this.afterRun(gid, e.runId));
    });
    // after a restart: pick up the runs that were in flight
    for (const g of this.db.list()) {
      if (g.kind !== 'loop' || g.status === 'met' || g.status === 'stopped') continue;
      const open = this.db.items(g.id).find((i) => i.kind === 'run' && i.runId && !i.attempt?.after);
      if (!open) continue;
      this.watched.set(open.runId!, g.id);
      if (this.runDone(open.runId!)) this.job(this.afterRun(g.id, open.runId!));
    }
  }

  /** Resolves when no check, proposal or run hand-off is in flight (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.allSettled([...this.jobs]);
  }
  onChange(fn: (g: Goal) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private job(p: Promise<unknown>): void {
    const j: Promise<unknown> = p.catch(() => {}).finally(() => this.jobs.delete(j));
    this.jobs.add(j);
  }
  private save(goal: Goal): Goal {
    // the one place status lands: a goal that is met or stopped keeps the moment it ended; a resumed one loses it
    const ended = goal.status === 'met' || goal.status === 'stopped';
    const g = { ...goal, endedAt: ended ? (goal.endedAt ?? Date.now()) : undefined };
    this.db.save(g);
    for (const l of this.listeners) l(g);
    return g;
  }
  private runDone(runId: string): boolean {
    const s = this.d.store.state(runId);
    return !s || isFinished(s.status);
  }
  private stop(g: Goal, reason: string): void {
    this.save({ ...g, status: 'stopped', reason, pending: undefined });
  }

  /** Create: a loop begins at once with its first check. */
  create(g: Goal): Goal {
    this.db.insert(g);
    this.save(g);
    if (g.kind === 'loop') this.job(this.checkAndAdvance(g.id));
    return g;
  }

  /** Run the finish check in the workspace (or `dir`, a run's worktree) and keep the result. */
  async runCheck(g: Goal, dir?: string): Promise<CheckResult> {
    if (!g.check) throw new HttpError(400, 'this goal has no finish check');
    const cwd = dir && existsSync(dir) ? dir : projectRoot(this.d.home, g.workspace);
    const r = await runProcess({ cmd: '/bin/sh', args: ['-c', g.check.command], cwd, signal: AbortSignal.timeout(CHECK_MS), env: { ...process.env, CI: '1' } });
    const out = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim() || r.spawnError || '';
    const j = judge(g.check, r.code, r.stdout);
    return { ...j, at: Date.now(), ...(g.check.kind === 'tests' ? parseCounts(out) : {}), tail: tail(out) };
  }

  /** Record a check result: a pass ends the goal `met`; returns the goal as it now stands. */
  private settle(id: string, r: CheckResult): Goal {
    const g = this.db.must(id);
    if (r.ok && g.kind === 'loop' && g.status !== 'met') return this.save({ ...g, lastCheck: r, status: 'met', pending: undefined, reason: undefined });
    return this.save({ ...g, lastCheck: r });
  }

  /** Edit a goal. Adding a finish check to a tracker turns it into a loop, which starts at once. */
  update(id: string, patch: Partial<Pick<Goal, 'title' | 'approval' | 'budgetUsd' | 'maxRuns' | 'dueDate' | 'workflow' | 'check' | 'type' | 'description' | 'assignees'>>): Goal {
    const g = this.db.must(id);
    const loops = !!patch.check && g.kind === 'tracker';
    const r = this.save({ ...g, ...patch, ...(loops ? { kind: 'loop' as const, status: 'active' as const } : {}) });
    if (loops) this.job(this.checkAndAdvance(id));
    return r;
  }

  async check(id: string): Promise<Goal> {
    const r = await this.runCheck(this.db.must(id));
    return this.settle(id, r);
  }

  private async checkAndAdvance(id: string): Promise<void> {
    try {
      const g = this.settle(id, await this.runCheck(this.db.must(id)));
      if (g.status === 'active') await this.advance(id);
    } catch (e) {
      this.failed(id, e);
    }
  }
  private failed(id: string, e: unknown): void {
    const g = this.db.get(id);
    if (g && g.status !== 'met') this.stop(g, (e as Error).message.split('\n')[0]!.slice(0, 200));
  }

  /** Caps, then a proposal; `ask` waits for the person, `auto` starts. */
  private async advance(id: string): Promise<void> {
    let g = this.db.must(id);
    const attempts = this.db.items(id).filter((i) => i.kind === 'run').length;
    if (g.spentUsd >= g.budgetUsd) return this.stop(g, `Budget reached ($${g.spentUsd.toFixed(2)} of $${g.budgetUsd.toFixed(2)})`);
    if (attempts >= g.maxRuns) return this.stop(g, `Run cap reached (${attempts} of ${g.maxRuns})`);
    if (this.teamBlocked(g)) return;
    const { plan, costUsd } = await this.propose(g);
    g = this.db.must(id);
    g = this.save({ ...g, spentUsd: g.spentUsd + costUsd });
    if (g.status !== 'active') return; // paused or stopped while the agent was thinking: the plan is dropped
    if (g.approval === 'auto') await this.startRun(g, plan);
    else this.save({ ...g, status: 'needs_you', pending: plan });
  }

  /** A team goal whose team lets nothing new start (its daily limit) pauses with the reason; a run in flight finishes. */
  private teamBlocked(g: Goal): boolean {
    const why = g.team ? this.d.hooks?.blocked(g) : undefined;
    if (why) this.save({ ...g, status: 'paused', reason: why, pending: undefined });
    return !!why;
  }

  /** The default crew agent (a team goal: its own agent) proposes the next run; with no agent set up, a plain task from the check's output. */
  private async propose(g: Goal): Promise<{ plan: Plan; costUsd: number }> {
    const last = g.lastCheck;
    const plan: Plan = { task: `${g.title}\n\nMake this check pass: ${g.check!.command}\n\nIts last output:\n${last?.tail ?? ''}`.slice(0, 2000), why: last?.summary ?? 'The check is failing' };
    const bound = g.agent ? loadBindings(this.d.home)[g.agent] : undefined;
    const { agent, model } = g.agent ? { agent: bound?.agent ?? 'claude', model: bound?.model } : assistantAgent(this.d.home);
    if (!this.d.registry.has(agent)) return { plan, costUsd: 0 };
    const root = projectRoot(this.d.home, g.workspace);
    const tries = this.db
      .items(g.id)
      .filter((i) => i.kind === 'run')
      .map((i, n) => `${n + 1}. ${i.text.split('\n')[0]!.slice(0, 120)}: ${i.attempt?.before?.summary ?? 'failing'} -> ${i.attempt?.after?.summary ?? (i.attempt?.after?.ok ? 'passing' : 'still failing')}`);
    const prompt = [
      `You are Tether. Goal: ${g.title}`,
      `Finish check: ${g.check!.command}`,
      `Last check output:\n${last?.tail ?? '(not run yet)'}`,
      tries.length ? `Earlier attempts:\n${tries.join('\n')}` : '',
      'Propose the single next run that gets the check to pass. Do not repeat an earlier attempt. Reply with one line of reasoning and then:',
      '```tether\n{"proposals":[{"kind":"team","task":"what the run should do","why":"one line"}]}\n```',
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const res = await this.d.registry.get(agent).run({ runId: `goal-${g.id}`, nodeId: 'propose', prompt, cwd: root, model, readOnly: true, lean: true, attempt: 1, timeoutMs: 120_000, signal: AbortSignal.timeout(120_000), onChunk: () => {}, onSession: () => {} });
      const costUsd = res.costUsd ?? 0;
      if (res.exitCode !== 0 || res.error) return { plan, costUsd };
      const p = (await checkReply(res.output, { home: this.d.home, repo: root, store: this.d.store })).proposals[0];
      return { plan: p ? { task: p.task, ...(p.why ? { why: p.why } : {}) } : plan, costUsd };
    } catch {
      return { plan, costUsd: 0 };
    }
  }

  /** Start the proposed run. It is the one place a goal starts anything; callers have checked the approval. */
  private async startRun(g: Goal, plan: Plan): Promise<void> {
    const repo = resolve(projectRoot(this.d.home, g.workspace));
    const budgetUsd = Math.min(Math.max(g.budgetUsd - g.spentUsd, 0.01), TEAM_MAX_BUDGET_USD);
    const auto = g.approval === 'auto';
    if (this.teamBlocked(g)) return;
    let runId: string;
    try {
      runId =
        g.team && this.d.hooks
          ? await this.d.hooks.start(g, plan)
          : g.workflow === 'team'
          ? await this.d.engine.startTeam({ task: plan.task, repo, budgetUsd, background: true, ...(auto ? { mode: 'autonomous' as const } : {}) })
          : await this.d.engine.start({ pipeline: readPipeline(this.d.home, g.workflow), task: plan.task, repo, autoApprove: auto });
    } catch (e) {
      return this.stop(g, `Could not start the run: ${(e as Error).message.split('\n')[0]!.slice(0, 160)}`);
    }
    this.db.addItem({ goalId: g.id, kind: 'run', text: plan.task, runId, attempt: { ...(g.lastCheck ? { before: g.lastCheck } : {}) } });
    this.watched.set(runId, g.id);
    this.save({ ...g, status: g.status === 'paused' ? 'paused' : 'active', pending: undefined });
    if (this.runDone(runId)) this.job(this.afterRun(g.id, runId));
  }

  /** A run finished: record its cost and the check after it, then end or go on. */
  private async afterRun(id: string, runId: string): Promise<void> {
    if (this.watched.get(runId) !== id) return;
    this.watched.delete(runId);
    try {
      const s = this.d.store.state(runId);
      const item = this.db.items(id).find((i) => i.runId === runId)!;
      const after = await this.runCheck(this.db.must(id), s?.workdir);
      const attempt: Attempt = { ...item.attempt, after, costUsd: s?.costUsd ?? 0, runStatus: s?.status ?? 'gone' };
      this.db.saveItem({ ...item, attempt, done: after.ok });
      const g = this.db.must(id);
      this.save({ ...g, spentUsd: g.spentUsd + (s?.costUsd ?? 0) });
      const now = this.settle(id, after);
      if (now.status === 'active') await this.advance(id);
    } catch (e) {
      this.failed(id, e);
    }
  }

  // ---- the person's calls ----

  /** Pause or resume (`active`), or Stop. A run already going finishes. */
  setStatus(id: string, to: 'active' | 'paused' | 'stopped'): Goal {
    const g = this.db.must(id);
    if (g.status === 'met') throw new HttpError(409, 'this goal is already met');
    if (to === g.status) return g;
    if (to === 'stopped') return this.save({ ...g, status: 'stopped', reason: 'Stopped by you', pending: undefined });
    if (to === 'paused') return this.save({ ...g, status: 'paused', pending: undefined });
    // resume: a run in flight carries on by itself; otherwise check again and propose
    const inflight = [...this.watched.values()].includes(id);
    const r = this.save({ ...g, status: 'active', reason: undefined });
    if (g.kind === 'loop' && !inflight) this.job(this.checkAndAdvance(id));
    return r;
  }

  /** The person's answer to a proposed run. */
  async next(id: string, action: 'start' | 'skip', plan?: string): Promise<Goal> {
    const g = this.db.must(id);
    if (g.status !== 'needs_you' || !g.pending) throw new HttpError(409, 'no run is waiting for you');
    // decided once: the status moves before anything awaits, so a second click is refused
    const taken = this.save({ ...g, status: 'active', pending: undefined });
    if (action === 'skip') {
      this.job(this.advance(id).catch((e) => this.failed(id, e)));
      return taken;
    }
    await this.startRun(taken, { task: plan?.trim() || g.pending.task, ...(g.pending.why ? { why: g.pending.why } : {}) });
    return this.db.must(id);
  }

  addItem(id: string, i: { text: string; runId?: string }): GoalItem {
    const g = this.db.must(id);
    const item = this.db.addItem({ goalId: id, kind: i.runId ? 'run' : 'manual', text: i.text, runId: i.runId });
    this.save(g);
    return item;
  }
  /** Tick an item or set who works on it. */
  editItem(id: string, itemId: number, patch: { done?: boolean; assignees?: Assignee[] }): GoalItem {
    const it = this.db.items(id).find((x) => x.id === itemId);
    if (!it) throw new HttpError(404, 'unknown item');
    const next = { ...it, ...patch };
    if (!next.assignees?.length) delete next.assignees;
    this.db.saveItem(next);
    this.save(this.db.must(id));
    return next;
  }
}
