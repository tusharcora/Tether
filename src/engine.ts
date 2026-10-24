import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath, sep } from 'node:path';
import type { AdapterRegistry } from './adapters/index.js';
import { computeCoach } from './coach.js';
import { cloneShared, commitAll, commitFiles, createWorktree, removeBranch, removeWorktree, diffAgainst, entryPaths, revertEntries, statusEntries } from './git.js';
import { answersBlock, askable, consultPrompt, parseAsks, parseUserAsks, resolveTarget, stripAsks, stripUserAsks, type Ask } from './consult.js';
import { childrenOf, normalizePipeline, parentsOf, preflight } from './pipeline.js';
import { baseStep, handNode, handoffBlock, limitsOf, parseHands, parsePlan, parseReview, planPrompt, reviewPrompt, rosterOf, stripHands, toNode, validateHand, validatePlan, type HandRequest, type PlanTask } from './handoff.js';
import { getVersion, harnessForRun, NON_EVOLVABLE, type Harness } from './harness.js';
import { cleanNote, RATINGS } from './signals.js';
import { BUILTIN_BOTS } from './crew.js';
import { buildPrompt, describeAnswer, userAnswersBlock } from './prompt.js';
import { teamPipeline } from './composer.js';
import { buildRoster, entryFor, loadRouting, routingHints, type RosterEntry } from './roster.js';
import { runProcess } from './proc.js';
import { deleteSession, sessionIdForRun } from './sessions.js';
import type { Store } from './store.js';
import { planWaiting, type HarnessRef, type ProbeTag, type AgentResult, type Answer, type MockScript, type Pipeline, type PipelineNode, type Question, type Rating, type RunKind, type RunState, type TeamMode } from './types.js';

let harnessWarned = false; // log a broken harness store once per process, not once per step
import { CREW, crewFor } from './bots.js';
import { TeamError, cleanAnswerText, TEAM_DEFAULT_BUDGET_USD, TEAM_MAX_BUDGET_USD, askToQuestion, clampRounds, defaultPlan, extractAny, freshId, parsePlan as parseTeamPlan, parseQuestions, planningPrompt, recommendedAnswers, stripControl, WRITES_QUESTION, type BotSummary } from './team.js';
import { applyBindings, hintFor, type Bindings } from './bindings.js';
import { reflect } from './lessons.js';
import { Vault } from './vault.js';
import { resolveWorkspace, snapshot } from './workspace.js';

/** How long a finished run waits for its reflection before moving on. */
const REFLECT_TIMEOUT_MS = 3000;
const NO_REFLECT_MAX = 1000;

export interface EngineOptions {
  /** Where worktrees live (state dir). */
  home: string;
  registry: AdapterRegistry;
  /** Bot ↔ model links, read fresh for every run so edits apply to the next start. */
  bindings?: () => Bindings;
  vault?: Vault;
  /** How long a finished run waits for its reflection (lessons, vault notes) before moving on. Default 3000. */
  reflectTimeoutMs?: number;
}

export interface StartInput {
  pipeline: Pipeline;
  task: string;
  repo: string;
  ref?: string;
  autoApprove?: boolean;
  /** Run kind; absent means a workflow. */
  kind?: RunKind;
  mode?: TeamMode;
  /** A workspace id, or false for none. Default: the registered workspace that holds the repo, or the repo's own .aorch files. */
  workspace?: string | false;
  /** false: do not learn lessons from this run (probe replays). Default true. */
  reflect?: boolean;
}

/** How a probe replay runs: which bot's harness is replaced (never saved as a version), the probe tag, and its spend cap. */
export interface ProbeStart {
  tag: ProbeTag;
  bot: string;
  /** The harness the bot runs with in this replay: the current one (baseline) or the current one with edits applied (candidate). */
  harness: Pick<Harness, 'version' | 'persona' | 'guidance' | 'skills'>;
  /** Hard spend cap for this replay (USD, > 0): the run's maxCostUsd, and every agent call gets what is left of it. */
  maxCostUsd: number;
  /** What one agent step is expected to cost at most; a step is not started unless spend + max(this, the dearest step so far) fits the cap. */
  nodeEstimateUsd?: number;
  /** Allow gate and setup commands of the pipeline to run again (in the throwaway clone). Default: refuse such pipelines. */
  allowCommands?: boolean;
}

/** Permission modes a read-only step may carry in a probe: anything else could let it write. */
const PROBE_PERMISSION_MODES = new Set(['plan', 'default']);

/**
 * Why a pipeline cannot be replayed by a probe, or undefined when it can. Shared by Engine.startProbe and Evolve's run selection.
 * Refused: any agent step that is not read-only or carries a permission override other than plan/default; managers and spawned steps;
 * hand-offs; settings that allow writes; gate or setup commands (unless allowed); adapters that cannot cap a call at its budget.
 */
export function probeRefusal(p: Pipeline, registry: AdapterRegistry, o: { allowCommands?: boolean } = {}): string | undefined {
  const agents = p.nodes.filter((n) => n.kind === 'agent');
  if (agents.some((n) => !n.readOnly)) return 'a probe replays read-only steps only';
  if (agents.some((n) => n.permissionMode !== undefined && !PROBE_PERMISSION_MODES.has(n.permissionMode))) return 'a probe cannot replay a step with a permission override (it could write)';
  if (p.nodes.some((n) => n.manager)) return 'a probe cannot replay managers';
  if (p.nodes.some((n) => n.spawn)) return 'a probe cannot replay spawned steps';
  if ((p.settings.handoff ?? 0) > 0 || p.settings.allowWorkerWrites) return 'a probe cannot replay hand-offs';
  if (p.settings.allowWrites) return 'a probe cannot replay a pipeline that allows writes';
  if (!o.allowCommands && (p.settings.setup || p.nodes.some((n) => n.kind === 'gate'))) return 'the replay would re-run gate or setup commands (allow it with --allow-commands)';
  for (const n of agents) {
    const a = n.agent ?? 'claude';
    if (!registry.has(a) || !registry.get(a).reportsCost || !registry.get(a).enforcesBudget) return `agent "${a}" cannot enforce a per-call budget`;
  }
  return undefined;
}

const PROBE_DIR_RE = /^p[0-9a-z]{1,40}$/;
const RUN_ID_RE = /^r[0-9a-z]{1,40}$/;
const pidAlive = (pid: unknown): boolean => {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** In-memory state of a live probe replay. */
interface ProbeRun {
  tag: ProbeTag;
  bot: string;
  harness: ProbeStart['harness'];
  nodeEstimateUsd: number;
  /** The dearest single agent call so far in this replay. */
  maxSeen: number;
  /** A call's cost was not reported and was charged as its whole cap: the replay's spend is an upper bound, not a measurement. */
  estimated?: boolean;
}

export interface TeamStartInput {
  task: string;
  repo: string;
  mode?: TeamMode;
  roster?: string[];
  /** Answer every card with its recommendation (headless). */
  yes?: boolean;
  /** Spend cap in USD; replaces the plan's own cap. */
  budgetUsd?: number;
  /** Planning rounds before Maestro must plan (default 3, 1..6). */
  maxRounds?: number;
  workspace?: string | false;
  /** Scripted planning replies for the mock adapter (tests). */
  mock?: MockScript;
  /** Return as soon as the run exists; the first planning round runs in the background (the HTTP API). */
  background?: boolean;
}

/** Test-only: the scripted planning replies. Roster, rounds and yes live in the run's events. */
interface TeamMeta {
  mock?: MockScript;
}

const MAX_OUTPUT = 200_000;
/** Worker questions waiting for the person at once, per run; later ones are answered by Maestro. */
const MAX_OPEN_ASKS = 2;
/** Questions one step may put to the person over its life. */
const MAX_ASKS_PER_STEP = 4;
/** Times a manager may send one spawned step back. */
const MAX_REDOS = 2;
/** Canvas spacing for spawned steps. */
const SPAWN_DX = 260;
const SPAWN_DY = 160;
const tail = (s: string, n: number) => (s.length > n ? s.slice(s.length - n) : s);

interface NodeOutcome {
  ok: boolean;
  aborted?: boolean;
}

interface HandResult {
  to: string;
  goal: string;
  answer: string;
  ok: boolean;
  aborted?: boolean;
}

const HAND_ORPHAN = 'delegator finished without using it';
/** A worker's hand-off step whose delegator is done: its failure is the delegator's business, not the run's. */
const handOfDone = (s: RunState, n: PipelineNode) => n.spawn?.kind === 'hand' && s.nodes[n.spawn.parent]?.status === 'done';

export class Engine {
  private active = new Map<string, AbortController>();
  private running = new Map<string, Promise<void>>();
  /** Runs that must not teach lessons (probe replays). In memory: a probe finishes in the process that started it. */
  private noReflect = new Set<string>();
  /** Live probe replays: their harness override and spend estimate. */
  private probes = new Map<string, ProbeRun>();
  /** When each live run's current execution pass began, for the wall-clock limit (managers check it too). */
  private wallStart = new Map<string, number>();
  private teams = new Map<string, TeamMeta>();
  /** The planning round in flight for a run, and the way to cancel it. */
  private planning = new Map<string, Promise<void>>();
  private planAbort = new Map<string, AbortController>();

  constructor(
    readonly store: Store,
    readonly opts: EngineOptions,
  ) {
    this.reapProbes();
  }

  /**
   * Clean up after probes whose process ended without cleaning up (a crash, a kill): each probe writes `<home>/probes/<dir>.json` with its
   * pid and run id. For every marker whose process is gone: the run, if still open, is closed as stopped; its worktree and clone are removed.
   * Clone directories without a marker are removed too. Probes of live processes (this one included) are left alone. Best effort.
   */
  reapProbes(): void {
    const root = join(this.opts.home, 'probes');
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      return;
    }
    const marked = new Set<string>();
    for (const f of names) {
      if (!f.endsWith('.json') || !PROBE_DIR_RE.test(f.slice(0, -5))) continue;
      const dir = f.slice(0, -5);
      marked.add(dir);
      try {
        let m: { pid?: unknown; runId?: unknown } = {};
        try {
          m = JSON.parse(readFileSync(join(root, f), 'utf8')) as typeof m;
        } catch {
          /* unreadable marker: its owner is unknown, treat as gone */
        }
        if (pidAlive(m.pid)) continue;
        if (typeof m.runId === 'string' && RUN_ID_RE.test(m.runId)) {
          const s = this.store.state(m.runId);
          if (s?.probe && !this.active.has(m.runId)) {
            if (s.status === 'running' || s.status === 'paused') this.store.append(m.runId, { type: 'run.finished', status: 'stopped', error: 'probe interrupted (its process ended); probe replays cannot be resumed' });
            const wt = resolvePath(s.workdir);
            if (wt.startsWith(resolvePath(this.opts.home, 'worktrees') + sep)) rmSync(wt, { recursive: true, force: true });
          }
        }
        rmSync(join(root, dir), { recursive: true, force: true });
        rmSync(join(root, f), { force: true });
      } catch {
        /* best effort */
      }
    }
    for (const d of names) {
      if (d.endsWith('.json') || marked.has(d) || !PROBE_DIR_RE.test(d)) continue;
      try {
        rmSync(join(root, d), { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  isLive(runId: string): boolean {
    return this.active.has(runId);
  }

  /** A team run's planning call is in flight in this process. */
  isPlanning(runId: string): boolean {
    return this.planning.has(runId);
  }

  /**
   * Delete a run: its event log, its worktree and branch, and its chat. A live run must be stopped first.
   * `keepWork` leaves the worktree and branch on disk so the changes are not lost.
   */
  async deleteRun(runId: string, o: { keepWork?: boolean } = {}): Promise<void> {
    if (this.active.has(runId)) throw new Error('that run is still live: stop it first');
    const s = this.store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    if (!o.keepWork) {
      await removeWorktree(s.repo, s.workdir).catch(() => {});
      if (existsSync(s.workdir)) rmSync(s.workdir, { recursive: true, force: true });
      if (s.branch) await removeBranch(s.repo, s.branch).catch(() => {});
    }
    this.planAbort.get(runId)?.abort();
    this.teams.delete(runId);
    deleteSession(this.opts.home, sessionIdForRun(runId));
    this.store.deleteRun(runId);
  }

  /** Resolves when the run's current execution pass ends (done, error, paused or stopped). */
  async wait(runId: string): Promise<RunState> {
    await this.running.get(runId);
    const s = this.store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    return s;
  }

  /**
   * Agent and model for a spawned step (`bound`: the draft after bindings). With no agent of its own or from its bot it
   * follows the delegator. Its model: the step's or its binding's; else the bot's model hint, only when the final agent
   * is claude; else the delegator's model when it runs on the delegator's agent.
   */
  private spawnedRunner(draft: PipelineNode, bound: PipelineNode, delegator: PipelineNode): { agent?: string; model?: string } {
    const agent = bound.agent ?? delegator.agent;
    const model = bound.model ?? hintFor(crewFor(draft), agent) ?? (agent === delegator.agent ? delegator.model : undefined);
    return { agent, model };
  }

  /** The pipeline as it will actually run: steps without their own agent follow their bot's binding. */
  resolve(p: Pipeline): Pipeline {
    return applyBindings(p, this.opts.bindings?.() ?? {});
  }

  async start(rawInput: StartInput): Promise<string> {
    return this.startRun(rawInput);
  }

  /**
   * Evolve probe: replay a read-only pipeline with `probe.harness` in place of the bot's current harness. The replay runs in a
   * throwaway shared clone of `input.repo` (under <home>/probes), never in the user's checkout; the clone and its worktree are removed
   * when the replay's pass ends. The run is tagged (`run.started.probe`, `node.started.harness.probe`), never teaches lessons, writes no
   * vault notes, is ignored by signals, and auto-approves approvals (nothing in it can write). A step that waits for a person ends it.
   * Throws when the pipeline has any step that could write, a manager, hand-offs, or the cap is not > 0.
   */
  async startProbe(input: StartInput, probe: ProbeStart): Promise<string> {
    if (!(typeof probe.maxCostUsd === 'number' && Number.isFinite(probe.maxCostUsd) && probe.maxCostUsd > 0)) throw new Error('probe needs a budget');
    const p = input.pipeline;
    const agents = p.nodes.filter((n) => n.kind === 'agent');
    const refused = probeRefusal(this.resolve(p), this.opts.registry, { allowCommands: probe.allowCommands });
    if (refused) throw new Error(refused);
    if (!agents.some((n) => n.role === probe.bot)) throw new Error(`the pipeline has no ${probe.bot} step`);
    const cap = Math.min(probe.maxCostUsd, p.settings.maxCostUsd ?? Number.POSITIVE_INFINITY);
    // one step at a time (spend is checked before each), no consults (they would spend outside the step check)
    const pipeline = { ...p, settings: { ...p.settings, parallel: 1, consult: 0, maxCostUsd: cap } };
    const name = `p${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
    const dir = join(this.opts.home, 'probes', name);
    const marker = `${dir}.json`;
    mkdirSync(join(this.opts.home, 'probes'), { recursive: true });
    // the marker lets a later process clean up if this one dies mid-replay (reapProbes)
    const mark = (runId?: string) => writeFileSync(marker, JSON.stringify({ pid: process.pid, ...(runId ? { runId } : {}) }));
    mark();
    const drop = () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(marker, { force: true });
    };
    try {
      await cloneShared(input.repo, dir);
    } catch (e) {
      drop();
      throw e;
    }
    const run: ProbeRun = { tag: probe.tag, bot: probe.bot, harness: probe.harness, nodeEstimateUsd: Math.max(0, probe.nodeEstimateUsd ?? 0), maxSeen: 0 };
    try {
      return await this.startRun(
        { pipeline, task: input.task, repo: dir, ...(input.ref ? { ref: input.ref } : {}), autoApprove: true, workspace: false, reflect: false },
        {
          probe: run,
          onId: (runId) => mark(runId),
          after: async (runId) => {
            try {
              const s = this.store.state(runId);
              if (s?.status === 'paused') this.store.append(runId, { type: 'run.finished', status: 'stopped', error: 'a probe replay cannot wait for a person' });
              if (s) await removeWorktree(dir, s.workdir).catch(() => {});
              if (s && existsSync(s.workdir)) rmSync(s.workdir, { recursive: true, force: true });
            } finally {
              this.probes.delete(runId);
              drop();
            }
          },
        },
      );
    } catch (e) {
      drop();
      throw e;
    }
  }

  private async startRun(rawInput: StartInput, extra: { probe?: ProbeRun; onId?: (runId: string) => void; after?: (runId: string) => Promise<void> } = {}): Promise<string> {
    const input = { ...rawInput, pipeline: this.resolve(rawInput.pipeline) };
    const ws = rawInput.workspace === false ? undefined : resolveWorkspace(this.opts.home, { workspace: rawInput.workspace, repo: input.repo });
    // the project's setup command is the run's default; a workflow that sets its own keeps it
    if (ws?.setup && !input.pipeline.settings.setup) input.pipeline = { ...input.pipeline, settings: { ...input.pipeline.settings, setup: ws.setup } };
    const errors = preflight(input.pipeline, this.opts.registry).filter((i) => i.level === 'error');
    if (errors.length) {
      throw new TeamError('conflict', `preflight failed:\n${errors.map((e) => `- ${e.node ? `[${e.node}] ` : ''}${e.message}`).join('\n')}`);
    }
    const runId = `r${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    if (rawInput.reflect === false) {
      this.noReflect.add(runId);
      // keep the set bounded: forget the oldest opt-outs (a probe is long over by then)
      if (this.noReflect.size > NO_REFLECT_MAX) this.noReflect.delete(this.noReflect.values().next().value!);
    }
    let wt;
    try {
      wt = await createWorktree(input.repo, this.opts.home, runId, input.ref);
    } catch (e) {
      this.noReflect.delete(runId);
      throw e;
    }
    if (extra.probe) this.probes.set(runId, extra.probe);
    extra.onId?.(runId);
    this.store.append(runId, {
      type: 'run.started',
      pipeline: input.pipeline,
      task: input.task,
      repo: input.repo,
      workdir: wt.workdir,
      baseSha: wt.baseSha,
      branch: wt.branch,
      vault: this.opts.vault?.root,
      autoApprove: input.autoApprove,
      workspace: ws ? snapshot(ws) : undefined,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(extra.probe ? { probe: extra.probe.tag } : {}),
    });
    this.launch(runId, extra.after);
    return runId;
  }

  /** Continue a run from its event log. Finished nodes are never re-run. */
  async resume(runId: string, o: { retryFailed?: boolean; /** A team run still planning: run the next round in the background. */ background?: boolean } = {}): Promise<void> {
    if (this.active.has(runId)) throw new Error('run is already live');
    const s = this.store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    // a probe replay only means something inside its probe (harness override, spend guard, cleanup): never run it again
    if (s.probe) throw new Error('a probe replay cannot be resumed or retried; delete it instead');
    if (s.status === 'done') throw new Error('run already finished');
    if (!existsSync(s.workdir)) throw new Error(`worktree is gone (${s.workdir}); cannot resume`);
    // a team run before its plan was approved has no pipeline to run: pick the dialogue up where it stopped
    if (s.kind === 'team' && !s.pipeline.nodes.length) {
      // stopped or failed while planning (or with its plan waiting): start again from the log; the fold re-opens planning
      if (s.status !== 'running') this.store.append(runId, { type: 'run.resumed' });
      if (o.background) this.continuePlanningInBackground(runId);
      else await this.continuePlanning(runId);
      return;
    }
    this.store.append(runId, { type: 'run.resumed', retryFailed: o.retryFailed ?? s.status === 'error' });
    this.launch(runId);
  }

  /** Re-point one agent step at another agent/model before a resume. Recorded in the log. */
  amend(runId: string, node: string, patch: { agent?: string; model?: string; guidance?: string }, reason: string): void {
    const s = this.store.state(runId);
    const n = s?.pipeline.nodes.find((x) => x.id === node);
    if (!s || !n) throw new Error(`unknown step "${node}"`);
    if (n.kind !== 'agent') throw new Error(`step "${node}" is not an agent step`);
    if (this.active.has(runId)) throw new Error('stop the run before amending it');
    const agent = patch.agent ?? n.agent ?? 'claude';
    if (!this.opts.registry.has(agent)) throw new Error(`unknown agent adapter "${agent}"`);
    this.store.append(runId, { type: 'node.amended', node, agent: patch.agent ?? n.agent, model: patch.agent ? patch.model : n.model, guidance: patch.guidance?.slice(0, 1000), reason });
  }

  // ---------- team runs: planning dialogue ----------

  /**
   * Start a team run in its planning phase. No worker runs and no scheduler is launched: the run carries an
   * empty placeholder pipeline until the plan is approved (Task 3 builds the real one).
   */
  async startTeam(i: TeamStartInput): Promise<string> {
    const known = rosterOf({} as PipelineNode);
    const bad = (i.roster ?? []).filter((id) => !known.includes(id));
    if (bad.length) throw new TeamError('invalid', `unknown bot in roster: ${bad.join(', ')} (crew: ${known.join(', ')})`);
    const ws = i.workspace === false ? undefined : resolveWorkspace(this.opts.home, { workspace: i.workspace, repo: i.repo });
    const runId = `r${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const wt = await createWorktree(i.repo, this.opts.home, runId);
    // test-only scripted replies; kept until the plan is approved or rejected (the manager step uses them too)
    if (i.mock) this.teams.set(runId, { mock: i.mock });
    this.store.append(runId, {
      type: 'run.started',
      pipeline: normalizePipeline({ name: 'team', nodes: [], edges: [], settings: {} }),
      task: i.task,
      repo: i.repo,
      workdir: wt.workdir,
      baseSha: wt.baseSha,
      branch: wt.branch,
      vault: this.opts.vault?.root,
      workspace: ws ? snapshot(ws) : undefined,
      kind: 'team',
      mode: i.mode ?? 'live',
      ...(i.roster?.length ? { roster: i.roster } : {}),
      maxRounds: clampRounds(i.maxRounds),
      yes: !!i.yes,
      ...(i.budgetUsd !== undefined && i.budgetUsd > 0 ? { budgetUsd: Math.min(TEAM_MAX_BUDGET_USD, i.budgetUsd) } : {}),
    });
    if (i.background) this.continuePlanningInBackground(runId);
    else await this.planRound(runId, 1);
    return runId;
  }

  /** Record answers to pending cards, then ask the next round or finish with a plan. Never applies an answer twice. */
  async answerPlan(runId: string, answers: Answer[]): Promise<void> {
    if (this.recordPlanAnswers(runId, answers)) await this.continuePlanning(runId);
  }

  /**
   * Validate every answer, then record them all or none. Returns whether anything was recorded; the next round is not run
   * (callers that cannot wait, like the HTTP API, run `continuePlanning` themselves).
   */
  recordPlanAnswers(runId: string, answers: Answer[]): boolean {
    const s = this.teamState(runId);
    if (!s.planning) throw new TeamError('conflict', 'planning is over for this run');
    const seen = new Set<string>();
    const clean: Answer[] = [];
    for (const a of answers) {
      const q = s.pending.find((x) => x.id === a.question);
      if (!q || seen.has(a.question)) throw q || s.answers.some((x) => x.question === a.question) ? new TeamError('already_answered', `already answered: ${a.question}`) : new TeamError('unknown_question', `unknown question: ${a.question}`);
      // 'maestro' answers are made inside the engine only; a caller may record its own choice or accept the recommendation
      if (a.by !== 'user' && a.by !== 'default') throw new TeamError('invalid', `invalid answer: by must be "user" or "default"`);
      if (a.by === 'default' && a.option !== q.recommended) throw new TeamError('invalid', `invalid answer: a default answer must be the recommended option of ${q.id}`);
      const text = cleanAnswerText(a.text);
      if (a.option !== undefined && !q.options.some((o) => o.id === a.option)) throw new TeamError('invalid', `invalid answer: "${a.option}" is not an option of ${q.id}`);
      if (a.option === undefined && !(text && q.allowOther)) throw new TeamError('invalid', `invalid answer: ${q.id} needs one of its options`);
      seen.add(a.question);
      clean.push({ question: q.id, ...(a.option !== undefined ? { option: a.option } : {}), ...(text ? { text } : {}), by: a.by });
    }
    if (!clean.length) return false;
    this.store.append(runId, { type: 'plan.answer', answers: clean });
    return true;
  }

  /** Run the next planning round without making the caller wait. A failure is logged to the console and to the run's event log. */
  continuePlanningInBackground(runId: string): void {
    void this.continuePlanning(runId).catch((e: unknown) => {
      const message = `planning could not continue: ${(e as Error).message}`;
      console.error(`[team ${runId}] ${message}`);
      try {
        this.store.append(runId, { type: 'team.error', message });
      } catch {
        /* the run may be gone */
      }
    });
  }

  /** If every card is answered and no plan exists yet, run the next round. Safe to call after a restart. */
  async continuePlanning(runId: string): Promise<void> {
    const s = this.teamState(runId);
    if (!s.planning || s.pending.length) return;
    await this.planRound(runId, s.round + 1);
  }

  /** Approve or reject the finished plan. Approval starts execution (Task 3); rejection ends the run. */
  async approveTeamPlan(runId: string, approved: boolean): Promise<void> {
    const s = this.teamState(runId);
    if (!approved && s.planning) {
      // rejecting mid-dialogue: end the run and drop any planning call still in flight
      this.planAbort.get(runId)?.abort();
      this.teams.delete(runId);
      this.store.append(runId, { type: 'run.finished', status: 'stopped' });
      return;
    }
    if (s.planning || !s.plan) throw new TeamError('conflict', 'no plan is ready to approve');
    if (s.pipeline.nodes.length) throw new TeamError('conflict', 'the plan was already approved');
    if (!approved) {
      this.store.append(runId, { type: 'run.finished', status: 'stopped' });
      return;
    }
    // the cap covers the whole run, planning included: a plan whose money planning already spent would fail at once
    const cap = s.plan.limits.maxCostUsd;
    if (cap !== undefined && s.costUsd >= cap) {
      throw new TeamError('conflict', `planning already spent $${s.costUsd.toFixed(2)} of this plan's $${cap.toFixed(2)} cap, so nothing is left for the team; reject it and start again with a larger --budget`);
    }
    // Approving the plan is the plan approval: the placeholder pipeline becomes the plan's manager pipeline
    // (a `team.pipeline` event, which folds into state.pipeline only while the pipeline is still empty), and the run starts.
    // Nothing below awaits, so two racing approvals cannot both get through.
    const roster = s.team?.roster?.length ? s.team.roster : [...new Set(s.plan.assignments.map((a) => a.bot))];
    let pipeline = this.resolve(teamPipeline(s.plan, roster));
    // Boss without a binding of its own is Maestro: it follows the orchestrator's agent and model
    const maestro = this.opts.bindings?.().orchestrator;
    if (maestro) pipeline = { ...pipeline, nodes: pipeline.nodes.map((n) => (n.manager && !n.agent ? { ...n, agent: maestro.agent, ...(maestro.model ? { model: maestro.model } : {}) } : n)) };
    const mock = this.teams.get(runId)?.mock;
    if (mock) pipeline = { ...pipeline, nodes: pipeline.nodes.map((n) => (n.manager ? { ...n, mock } : n)) };
    try {
      const ws = s.workspace?.id ? resolveWorkspace(this.opts.home, { workspace: s.workspace.id, repo: s.repo }) : undefined;
      if (ws?.setup) pipeline = { ...pipeline, settings: { ...pipeline.settings, setup: ws.setup } };
    } catch {
      /* the project may have been removed since the run began: run without its setup command */
    }
    const errors = preflight(pipeline, this.opts.registry).filter((i) => i.level === 'error');
    if (errors.length) throw new TeamError('conflict', `preflight failed:\n${errors.map((e) => `- ${e.node ? `[${e.node}] ` : ''}${e.message}`).join('\n')}`);
    this.teams.delete(runId);
    this.store.append(runId, { type: 'team.pipeline', pipeline });
    this.launch(runId);
  }

  /** Before approval, the person may give an assignment to another bot from the planning roster. */
  swapAssignment(runId: string, assignment: number, bot: string): RunState {
    const s = this.teamState(runId);
    if (!planWaiting(s) || !s.plan) throw new TeamError('conflict', 'the plan can only be changed while it waits for approval');
    const a = Number.isInteger(assignment) ? s.plan.assignments[assignment] : undefined;
    if (!a) throw new TeamError('invalid', `no assignment ${assignment + 1}`);
    const roster = s.plan.roster ?? rosterOf({ roster: s.team?.roster } as PipelineNode);
    if (!roster.includes(bot)) throw new TeamError('invalid', `"${bot}" is not on this plan's roster`);
    // a read-only bot cannot take a write: the plan says read, as the step it spawns will be
    const readOnly = a.mode === 'write' && !!baseStep(bot).readOnly;
    if (a.bot !== bot) this.store.append(runId, { type: 'plan.edit', assignment, from: a.bot, to: bot, ...(readOnly ? { mode: 'read' as const } : {}) });
    return this.state(runId);
  }

  /** Switch a team run between live and autonomous. A card that is already pending stays pending. */
  setMode(runId: string, mode: TeamMode): void {
    const s = this.store.state(runId);
    if (!s) throw new TeamError('unknown_run', `unknown run ${runId}`);
    if (s.kind !== 'team') throw new TeamError('not_team', 'not a team run');
    if (mode !== 'live' && mode !== 'autonomous') throw new TeamError('invalid', `invalid mode "${String(mode)}" (live or autonomous)`);
    if (s.status !== 'running' && s.status !== 'paused') throw new TeamError('conflict', `this run is not active (${s.status})`);
    this.store.append(runId, { type: 'team.mode', mode });
  }

  /**
   * The person's answer to a worker's question (`@ASK user:`). Applies once: an unknown or already answered question
   * is refused. The asking step is queued again and, when nothing else waits, the paused run carries on.
   */
  answerUser(runId: string, questionId: string, answer: { option?: string; text?: string }): Promise<void> {
    return this.answerUsers(runId, [{ question: questionId, ...answer }]);
  }

  /**
   * Several answers to workers' questions, all or none: every answer is checked first (known, open, valid, not twice),
   * then all are recorded together, each asking step that has nothing left open is queued again, and the run resumes once.
   */
  async answerUsers(runId: string, answers: { question: string; option?: string; text?: string }[]): Promise<void> {
    const s = this.store.state(runId);
    if (!s) throw new TeamError('unknown_run', `unknown run ${runId}`);
    if (s.kind !== 'team') throw new TeamError('not_team', 'not a team run');
    if (!answers.length) throw new TeamError('invalid', 'no answers given');
    const seen = new Set<string>();
    const clean: { node: string; answer: Answer }[] = [];
    for (const answer of answers) {
      const ask = s.userAsks?.find((a) => a.question.id === answer.question);
      if (!ask) throw new TeamError('unknown_question', `unknown question: ${answer.question}`);
      if (ask.answer) throw new TeamError('already_answered', `already answered: ${answer.question}`);
      if (seen.has(answer.question)) throw new TeamError('invalid', `invalid answer: ${answer.question} is answered twice`);
      if (s.status !== 'running' && s.status !== 'paused') throw new TeamError('conflict', `this run is not active (${s.status})`);
      const q = ask.question;
      const text = cleanAnswerText(answer.text);
      if (answer.option !== undefined && !q.options.some((o) => o.id === answer.option)) throw new TeamError('invalid', `invalid answer: "${answer.option}" is not an option of ${q.id}`);
      if (answer.option === undefined && !(text && q.allowOther)) throw new TeamError('invalid', `invalid answer: ${q.id} needs one of its options`);
      seen.add(q.id);
      clean.push({ node: ask.node, answer: { question: q.id, ...(answer.option !== undefined ? { option: answer.option } : {}), ...(text ? { text } : {}), by: 'user' } });
    }
    // no await from the checks to the appends: a second answer to the same card finds it answered
    for (const c of clean) this.store.append(runId, { type: 'user.answer', question: c.answer.question, answer: c.answer });
    const now = this.state(runId);
    for (const node of new Set(clean.map((c) => c.node))) {
      if (now.nodes[node]?.status === 'awaiting' && !(now.userAsks ?? []).some((a) => a.node === node && !a.answer)) {
        this.store.append(runId, { type: 'node.requeued', node, reason: 'its question was answered' });
      }
    }
    if (this.active.has(runId)) {
      // the scheduler may be about to stop for lack of work: look again when it has
      void this.running.get(runId)?.then(() => this.carryOn(runId)).catch((e: unknown) => console.error(`[team ${runId}] answered, but could not resume: ${(e as Error).message}`));
      return;
    }
    try {
      await this.carryOn(runId);
    } catch (e) {
      throw new TeamError('resume_failed', `answered, but could not resume: ${(e as Error).message}`);
    }
  }

  /** A paused team run with no step still waiting on a person carries on. */
  private async carryOn(runId: string): Promise<void> {
    const s = this.store.state(runId);
    if (!s || s.status !== 'paused' || this.active.has(runId)) return;
    if (Object.values(s.nodes).some((n) => n.status === 'awaiting')) return;
    await this.resume(runId);
  }

  private teamState(runId: string): RunState {
    const s = this.store.state(runId);
    if (!s) throw new TeamError('unknown_run', `unknown run ${runId}`);
    if (s.kind !== 'team') throw new TeamError('not_team', 'not a team run');
    if (s.status !== 'running') throw new TeamError('conflict', `this run is not running (${s.status})`);
    return s;
  }

  /** One planning round at a time per run: a second caller joins the first. */
  private planRound(runId: string, round: number): Promise<void> {
    const cur = this.planning.get(runId);
    if (cur) return cur;
    const ac = new AbortController();
    this.planAbort.set(runId, ac);
    const p = (async () => {
      try {
        await this.planRoundOnce(runId, round, ac.signal);
      } finally {
        this.planning.delete(runId);
        this.planAbort.delete(runId);
      }
      const s = this.store.state(runId);
      if (s?.kind === 'team' && s.status === 'running' && s.planning && s.pending.length && s.team?.yes) {
        await this.answerPlan(runId, recommendedAnswers(s.pending));
      }
    })();
    this.planning.set(runId, p);
    return p;
  }

  private async planRoundOnce(runId: string, round: number, signal: AbortSignal): Promise<void> {
    const s = this.teamState(runId);
    const maxRounds = s.team?.maxRounds ?? clampRounds(undefined);
    // an explicit --roster wins; otherwise the repo- and task-aware roster (built-ins, your bots, fitting imported specialists)
    const explicit = s.team?.roster?.length ? s.team.roster : undefined;
    const registered = Object.values(CREW).flatMap((c) => (c.def ? [c.def] : []));
    // a crew registry that was never loaded (no defs) still offers the built-in bots, as rosterOf did
    const crew = registered.length ? registered : BUILTIN_BOTS;
    const routing = loadRouting(this.opts.home);
    const defs = new Map(crew.map((b) => [b.id, b]));
    // an explicit roster is taken as given (no repo scan); each bot keeps its own when-to-use
    const entries: RosterEntry[] = explicit
      ? explicit.map((id): RosterEntry => {
          const d = defs.get(id);
          return d ? entryFor(d) : { id, kind: 'agent', readOnly: false, when: '', builtin: false };
        })
      : buildRoster({ dir: s.workdir, task: s.task, crew, routing });
    const roster = entries.map((e) => e.id);
    const bots: BotSummary[] = entries.map((e) => ({ id: e.id, title: CREW[e.id]?.title ?? e.id, kind: e.kind, readOnly: e.readOnly, ...(e.when ? { when: e.when } : {}) }));
    const hints = routingHints(routing, entries);
    const final = round > maxRounds;
    const asked = this.store.events(runId).flatMap((e) => (e.event.type === 'plan.question' ? e.event.questions : []));
    const base = planningPrompt(s.task, bots, s.answers, round, maxRounds, asked, hints);
    let raw = '';
    let questions: Question[] = [];
    let plan: ReturnType<typeof parseTeamPlan>['plan'];
    let why = '';
    // every card id ever asked or answered in this run (a dropped card from a stopped round included)
    const used = (st: RunState) => new Set([...st.answers.map((a) => a.question), ...st.pending.map((q) => q.id), ...(st.cards ?? []).map((q) => q.id)]);
    /** The cap covers planning: past it, planning ends here and the run says why. */
    const broke = (st: RunState): boolean => {
      const cap = planningCap(st);
      if (st.costUsd < cap) return false;
      this.store.append(runId, { type: 'run.finished', status: 'error', error: `planning used up the budget ($${st.costUsd.toFixed(2)} of $${cap.toFixed(2)}); start again with a larger --budget` });
      return true;
    };
    for (let attempt = 1; attempt <= 2 && !questions.length && !plan; attempt++) {
      if (broke(this.state(runId))) return;
      const prompt = attempt === 1 ? base : `${base}\n\nYour previous reply was rejected: ${why || 'it was not valid JSON'}. Reply again with ONLY the JSON object.`;
      const before = this.state(runId);
      const r = await this.askMaestro(runId, round, attempt, prompt, s.workdir, this.teams.get(runId)?.mock, signal, Math.max(0, planningCap(before) - before.costUsd));
      raw = r.text;
      // the run may have been deleted, finished or moved on while the model thought
      const now = this.store.state(runId);
      if (!now || now.status !== 'running' || !now.planning || signal.aborted) return;
      if (r.costUsd > 0) this.store.append(runId, { type: 'manager.cost', node: `plan.${round}`, costUsd: r.costUsd });
      if (now.round >= round || now.pending.length) return;
      if (broke(this.state(runId))) return;
      const asPlan = parseTeamPlan(raw, roster, now.answers);
      if (asPlan.plan) plan = asPlan.plan;
      else if (!final) {
        const pq = parseQuestions(raw);
        // an id already used in an earlier round is renamed (q1 -> q1-r2); the writes card is only ever asked once
        const taken = used(now);
        questions = [];
        const errs = [...pq.errors];
        for (const q of pq.questions) {
          if (!taken.has(q.id)) questions.push(q);
          else if (q.id === WRITES_QUESTION) errs.push('the writes question was already asked');
          else questions.push({ ...q, id: freshId(q.id, taken, round) });
          taken.add(questions.at(-1)?.id ?? q.id);
        }
        why = r.error ?? [...asPlan.errors, ...errs].join('; ');
      } else why = r.error ?? asPlan.errors.join('; ');
      if (!plan && !questions.length) console.error(`[team ${runId}] planning reply unusable (round ${round}, attempt ${attempt}): ${why || 'empty'}`);
    }
    const now = this.store.state(runId);
    if (!now || now.status !== 'running' || !now.planning || signal.aborted || now.round >= round || now.pending.length) return;
    if (plan || final) {
      const ready = { ...(plan ?? defaultPlan(now.task, roster, now.answers)), roster };
      const cap = now.team?.budgetUsd;
      this.store.append(runId, { type: 'plan.ready', plan: cap !== undefined ? { ...ready, limits: { ...ready.limits, maxCostUsd: cap } } : ready });
      return;
    }
    if (!questions.length) {
      const taken = used(now);
      const id = taken.has('fallback') ? freshId('fallback', taken, round) : 'fallback';
      // prose is worth showing; a JSON reply that failed validation is not (it would show as raw JSON)
      let isJson = false;
      try {
        extractAny(raw);
        isJson = true;
      } catch {
        /* prose */
      }
      const prose = isJson ? '' : stripControl(raw).trim().slice(0, 2000);
      const ask = prose || `Maestro could not draft usable questions${why ? ` (${why.slice(0, 300)})` : ''}. Go with the default plan?`;
      questions = [{ id, ask, options: [{ id: 'go', label: 'Go with the default plan' }], recommended: 'go' }];
    }
    this.store.append(runId, { type: 'plan.question', round, questions });
  }

  /** One planning call to the Maestro binding. Failures come back as empty text (and are logged) so the caller falls back. */
  private async askMaestro(runId: string, round: number, attempt: number, prompt: string, cwd: string, mock: MockScript | undefined, signal: AbortSignal, budgetUsd: number): Promise<{ text: string; costUsd: number; error?: string }> {
    const b = this.opts.bindings?.().orchestrator;
    const agent = b?.agent ?? 'claude';
    const fail = (error: string) => {
      console.error(`[team ${runId}] planning call failed (round ${round}): ${error}`);
      return { text: '', costUsd: 0, error };
    };
    if (!this.opts.registry.has(agent)) return fail(`agent "${agent}" is not set up`);
    try {
      let text = '';
      const res = await this.opts.registry.get(agent).run({
        runId,
        nodeId: `plan.${round}`,
        prompt,
        cwd,
        model: b?.model,
        readOnly: true,
        attempt,
        timeoutMs: 120_000,
        budgetUsd,
        signal,
        mock,
        onChunk: (t) => (text += t),
        onSession: () => {},
      });
      if (res.exitCode !== 0 || res.error) return fail(res.error ?? `agent exited ${res.exitCode}`);
      return { text: res.output || text, costUsd: res.costUsd ?? 0 };
    } catch (e) {
      return fail((e as Error).message);
    }
  }

  /** Stop a live run, or end a paused one (waiting on a card or an approval) or one still planning. */
  stop(runId: string): boolean {
    const ac = this.active.get(runId);
    if (ac) {
      ac.abort();
      return true;
    }
    const s = this.store.state(runId);
    if (!s) return false;
    // a team run before execution: still planning, or its plan waiting for approval
    const planning = s.kind === 'team' && s.status === 'running' && (s.planning || planWaiting(s));
    if (s.status !== 'paused' && !planning) return false;
    this.planAbort.get(runId)?.abort();
    // the scripted test replies stay: a stopped run before its plan was approved can be resumed
    this.store.append(runId, { type: 'run.finished', status: 'stopped' });
    return true;
  }

  approve(runId: string, node: string, approved: boolean, by = 'user'): void {
    const s = this.store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    if (s.nodes[node]?.status !== 'awaiting') throw new Error(`node "${node}" is not awaiting approval`);
    this.store.append(runId, { type: 'approval.resolved', node, approved, by });
  }

  /** The person's thumbs up/down on a step's output. The note is data: control characters stripped, capped at 500 characters. */
  feedback(runId: string, node: string, rating: Rating, note?: string): void {
    const s = this.store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    if (!RATINGS.includes(rating)) throw new Error('rating must be "up" or "down"');
    if (!Object.hasOwn(s.nodes, node)) throw new Error(`no step "${node}" in run ${runId}`);
    const clean = cleanNote(note);
    this.store.append(runId, { type: 'feedback', node, rating, ...(clean ? { note: clean } : {}) });
    // feedback usually arrives after the run finished: learn from it now (best effort; the same run never counts twice)
    if (s.status === 'done' || s.status === 'error') void this.reflectRun(runId, s.status);
  }

  // ------------------------------------------------------------------

  private launch(runId: string, after?: (runId: string) => Promise<void>) {
    const ac = new AbortController();
    this.active.set(runId, ac);
    const p = this.execute(runId, ac.signal)
      .catch((err: unknown) => {
        this.store.append(runId, { type: 'run.finished', status: 'error', error: (err as Error).message });
      })
      .then(() => after?.(runId))
      .catch(() => {})
      .finally(() => {
        this.active.delete(runId);
        this.running.delete(runId);
        this.wallStart.delete(runId);
      });
    this.running.set(runId, p);
  }

  private async execute(runId: string, signal: AbortSignal): Promise<void> {
    const wallStart = Date.now();
    this.wallStart.set(runId, wallStart);
    let state = this.state(runId);
    const pipe = state.pipeline;
    const st = pipe.settings;

    // Defence in depth: preflight already refused this, but the engine is callable without it.
    if (pipe.mode !== 'pipeline') throw new Error(`mode "${pipe.mode}" has no scheduler in this build`);

    if (st.setup && !state.setupDone) {
      const t0 = Date.now();
      const r = await runProcess({ cmd: '/bin/sh', args: ['-c', st.setup], cwd: state.workdir, signal, env: { ...process.env, CI: '1' } });
      if (signal.aborted) return this.finish(runId, 'stopped');
      const ok = r.code === 0;
      const artifacts = ok ? entryPaths(await statusEntries(state.workdir)) : [];
      this.store.append(runId, { type: 'setup.result', ok, output: tail(r.stdout + r.stderr, 20_000), durationMs: Date.now() - t0, artifacts });
      if (!ok) return this.finish(runId, 'error', `setup command failed (exit ${r.code})`);
    }

    for (;;) {
      if (signal.aborted) return this.finish(runId, 'stopped');
      state = this.state(runId);

      if (st.wallClockMs !== undefined && Date.now() - wallStart > st.wallClockMs) {
        this.skipQueued(state, 'wall-clock limit reached');
        return this.finish(runId, 'error', 'wall-clock limit reached');
      }
      if (st.maxCostUsd !== undefined && state.costUsd >= st.maxCostUsd && this.hasQueued(state)) {
        this.skipQueued(state, 'budget exhausted');
        return this.finish(runId, 'error', `budget exhausted ($${state.costUsd.toFixed(4)} of $${st.maxCostUsd})`, { budget: true });
      }

      const r = await this.stepFrontier(runId, signal);
      if (r === 'stopped') return this.finish(runId, 'stopped');
      if (r === 'idle') {
        // A manager left running while its plan approval waited: if nothing of its own is awaiting any more
        // (the plan was approved or rejected while the run was live), queue it again so it carries on.
        const now = this.state(runId);
        const stalled = now.pipeline.nodes.filter(
          (n) => n.manager && now.nodes[n.id]?.status === 'running' && !this.spawnedBy(now, n.id).some((k) => now.nodes[k.id]?.status === 'awaiting'),
        );
        for (const m of stalled) this.store.append(runId, { type: 'node.requeued', node: m.id, reason: 'its plan approval was resolved' });
        if (stalled.length) continue;
        break;
      }
    }

    state = this.state(runId);
    // a hand-off step whose delegator already finished will never run (e.g. requeued by a retry): skip it
    const stale = state.pipeline.nodes.filter((n) => handOfDone(state, n) && ['queued', 'running'].includes(state.nodes[n.id]?.status ?? ''));
    for (const n of stale) this.store.append(runId, { type: 'node.skipped', node: n.id, reason: HAND_ORPHAN });
    if (stale.length) state = this.state(runId);
    const ignored = new Set(state.pipeline.nodes.filter((n) => handOfDone(state, n) && ['error', 'skipped'].includes(state.nodes[n.id]?.status ?? '')).map((n) => n.id));
    const nodes = Object.entries(state.nodes).filter(([id]) => !ignored.has(id)).map(([, n]) => n);
    if (nodes.some((n) => n.status === 'awaiting')) return this.finish(runId, 'paused');
    if (nodes.some((n) => n.status === 'error' || n.status === 'skipped')) {
      const failed = state.pipeline.nodes.find((n) => !ignored.has(n.id) && state.nodes[n.id]?.status === 'error');
      return this.finish(runId, 'error', failed ? `node "${failed.id}" failed: ${state.nodes[failed.id]?.error ?? 'unknown error'}` : undefined);
    }
    // fail closed: a step that never finished must not let the run report success
    const unfinished = state.pipeline.nodes.filter((n) => ['running', 'queued'].includes(state.nodes[n.id]?.status ?? ''));
    if (unfinished.length) return this.finish(runId, 'error', `run ended with unfinished steps: ${unfinished.map((n) => n.id).join(', ')}`);
    return this.finish(runId, 'done');
  }

  /**
   * One scheduler pass: propagate skips, find ready nodes, request approvals, run the
   * concurrent read-only batch then the serial nodes. When `only` is given, only those
   * node ids are considered.
   */
  private async stepFrontier(runId: string, signal: AbortSignal, only?: Set<string>): Promise<'progress' | 'idle' | 'stopped'> {
    const state = this.state(runId);
    const pipe = state.pipeline;
    const st = pipe.settings;
    // Spawned steps belong to their manager: only its own frontier (`only`) runs them.
    const spawnedIds = new Set(pipe.nodes.filter((n) => n.spawn).map((n) => n.id));
    const inScope = (id: string) => (only ? only.has(id) : !spawnedIds.has(id));

    // A node whose upstream failed can never run.
    let propagated = false;
    for (const n of pipe.nodes) {
      if (!inScope(n.id)) continue;
      if (state.nodes[n.id]?.status !== 'queued') continue;
      const bad = parentsOf(pipe, n.id).find((p) => ['error', 'skipped'].includes(state.nodes[p]?.status ?? ''));
      if (bad) {
        this.store.append(runId, { type: 'node.skipped', node: n.id, reason: `upstream "${bad}" did not succeed` });
        propagated = true;
      }
    }
    if (propagated) return 'progress';

    const ready = pipe.nodes.filter(
      (n) =>
        inScope(n.id) &&
        state.nodes[n.id]?.status === 'queued' &&
        parentsOf(pipe, n.id).every((p) => state.nodes[p]?.status === 'done'),
    );
    if (!ready.length) return 'idle';

    for (const n of ready.filter((x) => x.kind === 'approval')) {
      this.store.append(runId, { type: 'approval.requested', node: n.id });
      if (state.autoApprove) this.store.append(runId, { type: 'approval.resolved', node: n.id, approved: true, by: 'auto' });
    }
    const work = ready.filter((x) => x.kind !== 'approval');
    // Read-only agents without a fix loop can't disturb each other: run those concurrently.
    // A manager runs its spawned (possibly writing) steps itself, so it never shares the worktree with a read-only batch.
    // A worker that may hand out write work changes the worktree mid-step, so with worker writes on nothing shares it.
    const writeHands = (st.handoff ?? 0) > 0 && st.allowWorkerWrites === true;
    const concurrent = work.filter((n) => n.kind === 'agent' && n.readOnly && !n.fixNode && !n.manager && !writeHands);
    const serial = work.filter((n) => !concurrent.includes(n));

    await pool(concurrent, st.parallel, (n) => this.runNode(runId, n, signal));
    if (signal.aborted) return 'stopped';
    for (const n of serial) {
      const out = await this.runNode(runId, n, signal);
      if (out.aborted || signal.aborted) return 'stopped';
    }
    return 'progress';
  }

  private state(runId: string): RunState {
    const s = this.store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    return s;
  }

  private hasQueued(s: RunState) {
    return Object.values(s.nodes).some((n) => n.status === 'queued');
  }

  private skipQueued(s: RunState, reason: string) {
    for (const [id, n] of Object.entries(s.nodes)) if (n.status === 'queued') this.store.append(s.id, { type: 'node.skipped', node: id, reason });
  }

  private async finish(runId: string, status: RunState['status'], error?: string, flags: { budget?: true } = {}): Promise<void> {
    const before = this.state(runId);
    const findings = computeCoach(before);
    if (findings.length && status !== 'stopped') this.store.append(runId, { type: 'run.coach', findings });
    this.store.append(runId, { type: 'run.finished', status, error, ...(flags.budget ? { budget: true as const } : {}) });
    const vault = this.opts.vault;
    // probe replays are experiments, not work: no vault notes
    if (vault && !before.probe) await this.recordToVault(runId, vault);
    await this.reflectRun(runId, status);
  }

  /** Learn from a finished run: best effort, bounded by a timeout, never fails or changes the run. Probe runs opt out. */
  private async reflectRun(runId: string, status: RunState['status']): Promise<void> {
    if (status !== 'done' && status !== 'error') return;
    if (this.noReflect.has(runId)) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      const s = this.store.state(runId);
      if (!s || s.probe) return;
      const work = reflect(this.opts.home, s, this.opts.vault, this.store.events(runId)).catch(() => []);
      await Promise.race([work, new Promise((r) => (timer = setTimeout(r, this.opts.reflectTimeoutMs ?? REFLECT_TIMEOUT_MS)))]);
    } catch {
      /* reflection must never fail a run */
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async recordToVault(runId: string, vault: Vault): Promise<void> {
    try {
      const s = this.state(runId);
      const files: Record<string, string[]> = {};
      for (const [id, ns] of Object.entries(s.nodes)) {
        if (ns.commit) files[id] = await commitFiles(s.workdir, ns.commit);
      }
      const written = await vault.recordRun(s, files);
      for (const p of written.slice(0, 60)) this.store.append(runId, { type: 'vault.note', path: p });
    } catch {
      /* a vault problem must never fail a run */
    }
  }

  // ------------------------------------------------------------------

  private async runNode(runId: string, node: PipelineNode, signal: AbortSignal): Promise<NodeOutcome> {
    try {
      if (node.manager && node.kind === 'agent') return await this.runManager(runId, node, signal);
      if (node.kind === 'gate') return await this.runCheck(runId, node, signal);
      if (node.verdict) return await this.runCheck(runId, node, signal);
      const r = await this.runAgentOnce(runId, node, signal);
      return { ok: r.ok, aborted: r.aborted };
    } catch (err) {
      // an engine fault inside a node is that node's failure, not the run's crash
      const attempt = this.state(runId).nodes[node.id]?.attempts ?? 0;
      this.store.append(runId, {
        type: 'node.finished',
        node: node.id,
        status: 'error',
        output: '',
        error: `engine error: ${(err as Error).message}`,
        durationMs: 0,
        attempt,
      });
      this.skipOrphans(runId, node);
      return { ok: false };
    }
  }

  /** The run's wall-clock limit, when this execution pass has passed it. */
  private overClock(runId: string): string | undefined {
    const limit = this.state(runId).pipeline.settings.wallClockMs;
    const since = this.wallStart.get(runId);
    return limit !== undefined && since !== undefined && Date.now() - since > limit ? 'wall-clock limit reached' : undefined;
  }

  /** A delegator finished: its hand-off steps that never ran (or were cut off) will not be used. */
  private skipOrphans(runId: string, delegator: PipelineNode): void {
    const s = this.state(runId);
    for (const n of s.pipeline.nodes) {
      if (n.spawn?.kind !== 'hand' || n.spawn.parent !== delegator.id) continue;
      if (['queued', 'running'].includes(s.nodes[n.id]?.status ?? '')) this.store.append(runId, { type: 'node.skipped', node: n.id, reason: HAND_ORPHAN });
    }
  }

  /**
   * One worker hand-off: reuse the delegator's existing step for the same bot, goal and mode from its current attempt
   * (a resumed run), or validate and spawn a new one, then run it now through runAgentOnce while the delegator waits.
   * A refusal is an answer too. `spent` is the delegators' spend not yet in the log (their own calls so far).
   */
  private async handoffStep(runId: string, delegator: PipelineNode, req: HandRequest, round: number, sig: AbortSignal, spent = 0): Promise<HandResult> {
    const st = this.state(runId);
    const settings = st.pipeline.settings;
    const log = (to: string, answer: string, costUsd?: number) =>
      this.store.append(runId, { type: 'handoff', from: delegator.id, to, goal: req.goal, answer: answer.slice(0, 8000), round, costUsd: costUsd || undefined });
    const result = (answer: string, ok: boolean): HandResult => ({ to: req.to, goal: req.goal, answer, ok });
    const mine = st.pipeline.nodes.filter((n) => n.spawn?.kind === 'hand' && n.spawn.parent === delegator.id);
    const mode = req.write ? 'write' : 'read';
    // a child from an attempt of the delegator that already finished (a redo, a fix loop, a retry) is not reused
    const events = this.store.eventsNoChunks(runId);
    const current = (c: PipelineNode) => {
      const born = events.find((e) => e.event.type === 'node.spawned' && e.event.node.id === c.id)?.seq ?? 0;
      return !events.some((e) => e.seq > born && e.event.type === 'node.finished' && e.event.node === delegator.id);
    };
    let child = mine.filter((n) => n.spawn!.contract.to === req.to && n.spawn!.contract.goal === req.goal && n.spawn!.contract.mode === mode && current(n)).at(-1);
    if (child && st.nodes[child.id]?.status === 'done') {
      const out = st.nodes[child.id]!.output ?? '';
      const id = child.id;
      if (!events.some((e) => e.event.type === 'handoff' && e.event.to === id)) log(id, out, st.nodes[id]!.costUsd);
      return result(out, true);
    }
    const refuse = (why: string) => {
      log(req.to, `refused: ${why}`);
      return result(`refused: ${why}`, false);
    };
    // re-running an existing step costs time too
    const late = this.overClock(runId);
    if (child && late) return refuse(late);
    if (!child) {
      const why =
        validateHand(req, { delegator, state: st, roster: rosterOf(delegator), allowWrite: settings.allowWorkerWrites === true, used: this.spawnUsed(st) }) ??
        (settings.maxCostUsd !== undefined && st.costUsd + spent >= settings.maxCostUsd ? 'the run is out of budget' : undefined) ??
        late;
      if (why) return refuse(why);
      const taken = new Set(st.pipeline.nodes.map((n) => n.id));
      let n = mine.length + 1;
      while (taken.has(`${delegator.id}-h${n}`)) n++;
      const draft = handNode(req, delegator, n);
      const bound = this.resolve({ ...st.pipeline, nodes: [draft] }).nodes[0]!;
      const { agent, model } = this.spawnedRunner(draft, bound, delegator);
      const script = delegator.mock?.spawned?.[req.to];
      // a team run's workers hand off only inside the plan's roster, not to the whole crew
      const roster = st.kind === 'team' && delegator.roster?.length ? { roster: delegator.roster } : {};
      // below the delegator, three to a row, after anything it spawned before
      const k = this.spawnedBy(st, delegator.id).length;
      child = { ...bound, agent, ...(model ? { model } : {}), ...roster, ...(script ? { mock: script } : {}), x: delegator.x + SPAWN_DX * (k % 3), y: delegator.y + SPAWN_DY * (1 + Math.floor(k / 3)) };
      this.store.append(runId, { type: 'node.spawned', node: child, parent: delegator.id, depth: child.spawn!.depth, after: [] });
    }
    const id = child.id;
    const node = this.state(runId).pipeline.nodes.find((x) => x.id === id)!;
    let r: { ok: boolean; aborted?: boolean; paused?: boolean; output: string; error?: string };
    try {
      r = await this.runAgentOnce(runId, node, sig, undefined, spent);
    } catch (err) {
      const error = `engine error: ${(err as Error).message}`;
      this.store.append(runId, { type: 'node.finished', node: id, status: 'error', output: '', error, durationMs: 0, attempt: this.state(runId).nodes[id]?.attempts ?? 0 });
      this.skipOrphans(runId, node);
      r = { ok: false, output: '', error };
    }
    if (r.aborted) return { ...result('', false), aborted: true };
    const answer = r.ok ? r.output : [r.error, r.output].filter(Boolean).join('\n') || 'no output';
    log(id, answer, this.state(runId).nodes[id]?.costUsd);
    return result(answer, r.ok);
  }

  /** Gate or verdict node, with the fix loop: failure output goes back to `fixNode`. */
  private async runCheck(runId: string, node: PipelineNode, signal: AbortSignal): Promise<NodeOutcome> {
    const isGate = node.kind === 'gate';
    const max = node.maxLoops ?? 2;
    const t0 = Date.now();
    if (isGate) {
      const attempt = this.state(runId).nodes[node.id]!.attempts + 1;
      this.store.append(runId, { type: 'node.started', node: node.id, attempt });
    }
    const finishGate = (ok: boolean, output: string, error?: string) => {
      const attempt = this.state(runId).nodes[node.id]!.attempts;
      this.store.append(runId, {
        type: 'node.finished',
        node: node.id,
        status: ok ? 'done' : 'error',
        output: tail(output, MAX_OUTPUT),
        error,
        durationMs: Date.now() - t0,
        attempt,
      });
    };

    for (;;) {
      let ok: boolean;
      let failureText: string;
      if (isGate) {
        const g0 = Date.now();
        const r = await runProcess({
          cmd: '/bin/sh',
          args: ['-c', node.command!],
          cwd: this.state(runId).workdir,
          signal: AbortSignal.any([signal, AbortSignal.timeout(this.state(runId).pipeline.settings.nodeTimeoutMs)]),
          env: { ...process.env, CI: '1' },
        });
        if (signal.aborted) return { ok: false, aborted: true };
        const out = tail(`${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim(), 20_000);
        ok = r.code === 0 && !r.spawnError;
        this.store.append(runId, { type: 'gate.result', node: node.id, ok, exitCode: r.code, output: out, durationMs: Date.now() - g0 });
        failureText = out || r.spawnError || `exit ${r.code}`;
      } else {
        const r = await this.runAgentOnce(runId, node, signal);
        if (r.aborted) return { ok: false, aborted: true };
        if (r.paused) return { ok: false };
        ok = r.ok;
        failureText = r.output || r.error || 'verdict: FAIL';
      }
      if (ok) {
        if (isGate) finishGate(true, this.state(runId).nodes[node.id]?.gate?.output ?? '');
        return { ok: true };
      }

      const loops = this.state(runId).nodes[node.id]!.loops;
      if (!node.fixNode || loops >= max) {
        if (isGate) finishGate(false, failureText, loops ? `gate still failing after ${loops} fix loop(s)` : 'gate failed');
        return { ok: false };
      }
      this.store.append(runId, { type: 'loop', check: node.id, fixNode: node.fixNode, n: loops + 1 });
      const fixNode = this.state(runId).pipeline.nodes.find((n) => n.id === node.fixNode)!;
      const fix = await this.runAgentOnce(runId, fixNode, signal, { check: node.title ?? node.role ?? node.id, output: failureText });
      if (fix.aborted) return { ok: false, aborted: true };
      if (fix.paused) return { ok: false };
      if (!fix.ok) {
        if (isGate) finishGate(false, failureText, `fix node "${fixNode.id}" failed`);
        else this.store.append(runId, { type: 'node.finished', node: node.id, status: 'error', output: failureText, error: `fix node "${fixNode.id}" failed`, durationMs: 0, attempt: this.state(runId).nodes[node.id]!.attempts });
        return { ok: false };
      }
    }
  }

  // ---------- managers ----------

  /** Steps this manager has spawned so far, in spawn order. */
  private spawnedBy(s: RunState, managerId: string): PipelineNode[] {
    return s.pipeline.nodes.filter((n) => n.spawn?.parent === managerId);
  }

  /**
   * A manager step: plan hand-offs, spawn them, let them run (stepFrontier scoped to its own steps), review the
   * results and send work back or add more, within the run's limits. The manager itself never edits files.
   * While a spawned approval is awaiting it returns without finishing, so the run pauses; on resume it picks up
   * its existing steps instead of planning again.
   */
  private async runManager(runId: string, node: PipelineNode, signal: AbortSignal): Promise<NodeOutcome> {
    const t0 = Date.now();
    const first = this.state(runId);
    const attempt = (first.nodes[node.id]?.attempts ?? 0) + 1;
    this.store.append(runId, { type: 'node.started', node: node.id, attempt });
    const settings = first.pipeline.settings;
    const { maxDepth } = limitsOf(first.pipeline);
    const depth = (node.spawn?.depth ?? 0) + 1;
    const roster = rosterOf(node);
    const notes: string[] = [];
    let lastReview = '';
    let reviewCalls = 0;

    const finish = (status: 'done' | 'error', error?: string): NodeOutcome => {
      this.store.append(runId, {
        type: 'node.finished',
        node: node.id,
        status,
        output: tail(managerSummary(this.state(runId), node, this.spawnedBy(this.state(runId), node.id), notes, lastReview), MAX_OUTPUT),
        error,
        durationMs: Date.now() - t0,
        attempt,
      });
      return { ok: status === 'done' };
    };
    const overBudget = (): string | undefined => {
      if (settings.maxCostUsd === undefined) return undefined;
      const spent = this.state(runId).costUsd;
      return spent >= settings.maxCostUsd ? `budget exhausted ($${spent.toFixed(4)} of $${settings.maxCostUsd})` : undefined;
    };
    const overClock = (): string | undefined => {
      const since = this.wallStart.get(runId);
      return settings.wallClockMs !== undefined && since !== undefined && Date.now() - since > settings.wallClockMs ? 'wall-clock limit reached' : undefined;
    };
    /** Out of money or time: skip this manager's queued steps and end it. */
    const halted = (why: string): NodeOutcome => {
      const s = this.state(runId);
      for (const k of this.spawnedBy(s, node.id)) if (s.nodes[k.id]?.status === 'queued') this.store.append(runId, { type: 'node.skipped', node: k.id, reason: why.startsWith('budget') ? 'budget exhausted' : why });
      return finish('error', why);
    };
    const limit = () => overBudget() ?? overClock();
    const ask = (phase: 'plan' | 'review', round: number, prompt: string) => this.askManager(runId, node, phase, round, prompt, signal);
    /** Parse-free checks on a batch of tasks: the plan rules plus id clashes with steps that already exist. */
    const vet = (tasks: PlanTask[]): string | undefined => {
      const s = this.state(runId);
      const why = validatePlan(tasks, { manager: node, state: s, roster, allowWrite: settings.allowWrites === true, used: this.spawnUsed(s) });
      if (why) return why;
      const taken = new Set(s.pipeline.nodes.map((n) => n.id));
      const approval = this.nextApprovalId(s, node);
      for (const t of tasks) {
        const full = `${node.id}-${t.id}`;
        if (taken.has(full) || full === approval) return `task id "${t.id}" is already in use (${full}); pick another`;
      }
      return undefined;
    };
    /** In a follow-up batch, `context` may name earlier spawned steps by their local id. */
    const localize = (tasks: PlanTask[]): PlanTask[] => {
      const earlier = new Set(this.spawnedBy(this.state(runId), node.id).map((k) => k.id));
      const local = new Set(tasks.map((t) => t.id));
      return tasks.map((t) => ({ ...t, context: t.context.map((c) => (!local.has(c) && earlier.has(`${node.id}-${c}`) ? `${node.id}-${c}` : c)) }));
    };
    const spawn = (tasks: PlanTask[]) => {
      const s = this.state(runId);
      // A team run's person approved the plan itself, so the manager's first batch needs no second approval when it stays
      // inside that plan: bots it names, and writes only where it said write. Later batches (more work) always ask.
      // Only a team run's own pipeline carries this switch; in any other pipeline it is ignored.
      const preapproved = settings.planPreapproved === true && s.kind === 'team' && !!s.plan && !this.spawnedBy(s, node.id).length && withinPlan(tasks, s.plan);
      const needsApproval = !preapproved && (settings.planApproval ?? tasks.some((t) => t.mode === 'write'));
      const approvalId = needsApproval ? this.nextApprovalId(s, node) : undefined;
      const batch: { node: PipelineNode; after: string[] }[] = [];
      if (approvalId) {
        const approval: PipelineNode = {
          id: approvalId,
          kind: 'approval',
          title: 'approve plan',
          x: node.x,
          y: node.y,
          spawn: { parent: node.id, depth, contract: { to: 'approval', goal: `approve the plan of ${node.id}`, context: [], mode: 'read', after: [] } },
        };
        batch.push({ node: approval, after: [] });
      }
      const siblings = tasks.map((t) => t.id);
      for (const t of tasks) {
        const draft = toNode(t, node, depth, undefined, siblings);
        const bound = this.resolve({ ...s.pipeline, nodes: [draft] }).nodes[0]!;
        const { agent, model } = this.spawnedRunner(draft, bound, node);
        const script = node.mock?.spawned?.[t.id];
        // a team run's workers inherit the manager's roster: their hand-offs stay inside the approved plan's bots
        const roster = s.kind === 'team' ? rosterOf(node) : undefined;
        const child: PipelineNode = { ...bound, agent, ...(model ? { model } : {}), ...(roster ? { roster } : {}), ...(script ? { mock: script } : {}) };
        const after = [...child.spawn!.contract.after, ...(approvalId ? [approvalId] : [])];
        batch.push({ node: child, after });
      }
      // lay them out below the manager, three to a row, after any it spawned before (the canvas shows them apart)
      const already = this.spawnedBy(s, node.id).length;
      batch.forEach((b, i) => {
        const k = already + i;
        b.node = { ...b.node, x: node.x + SPAWN_DX * (k % 3), y: node.y + SPAWN_DY * (1 + Math.floor(k / 3)) };
      });
      // built in full first, so a fault cannot leave a half-spawned plan behind
      for (const b of batch) this.store.append(runId, { type: 'node.spawned', node: b.node, parent: node.id, depth, after: b.after });
    };
    /** Run the spawned steps until nothing more is ready. */
    const work = async (): Promise<'idle' | 'paused' | 'aborted' | { error: string }> => {
      for (;;) {
        if (signal.aborted) return 'aborted';
        const s = this.state(runId);
        const kids = this.spawnedBy(s, node.id);
        if (kids.some((k) => s.nodes[k.id]?.status === 'awaiting')) return 'paused';
        const queued = kids.filter((k) => s.nodes[k.id]?.status === 'queued');
        const late = overClock();
        if (late) return { error: late };
        const broke = overBudget();
        if (broke && queued.length) return { error: broke };
        const r = await this.stepFrontier(runId, signal, new Set(kids.map((k) => k.id)));
        if (r === 'stopped') return 'aborted';
        if (r === 'idle') return 'idle';
      }
    };
    /** After work: undefined to carry on, or what runManager should return. */
    const afterWork = (w: Awaited<ReturnType<typeof work>>): NodeOutcome | undefined => {
      if (w === 'aborted') return { ok: false, aborted: true };
      if (w === 'paused') return { ok: true };
      if (typeof w === 'object') return halted(w.error);
      const s = this.state(runId);
      const refused = this.spawnedBy(s, node.id).find((k) => k.kind === 'approval' && s.nodes[k.id]?.status === 'error');
      if (refused) return finish('error', `plan rejected (${refused.id} was not approved)`);
      return undefined;
    };

    // 1. Plan, unless this manager already has spawned steps (a resumed run).
    if (!this.spawnedBy(first, node.id).length) {
      if (depth > maxDepth) return finish('error', `manager plan rejected: spawn depth ${depth} exceeds maxDepth ${maxDepth}`);
      let rejection: string | undefined;
      let tasks: PlanTask[] | undefined;
      for (let round = 1; round <= 2 && !tasks; round++) {
        const broke = limit();
        if (broke) return halted(broke);
        const now = this.state(runId);
        const r = await ask('plan', round, planPrompt(now, node, roster, rejection, this.spawnUsed(now)));
        if (r.aborted) return { ok: false, aborted: true };
        if (!r.ok) return finish('error', `manager failed: ${r.error ?? 'no answer'}`);
        const parsed = parsePlan(r.output);
        rejection = 'error' in parsed ? parsed.error : vet(parsed.tasks);
        if (!rejection && !('error' in parsed)) tasks = parsed.tasks;
      }
      if (!tasks) return finish('error', `manager plan rejected: ${rejection}`);
      spawn(tasks);
    }

    // 2. Work.
    const stop = afterWork(await work());
    if (stop) return stop;

    // 3. Review: accept, redo or more, at most 3 rounds.
    type Decision = { accept: true } | { redo: { id: string; reason: string }[] } | { more: PlanTask[] };
    const review = async (round: number): Promise<Decision | 'aborted'> => {
      let extra = '';
      let reason = '';
      for (let tryN = 1; tryN <= 2; tryN++) {
        const s = this.state(runId);
        const r = await ask('review', ++reviewCalls, reviewPrompt(s, node, this.spawnedBy(s, node.id), round) + extra);
        if (r.aborted) return 'aborted';
        if (!r.ok) reason = `no answer (${r.error ?? 'unknown error'})`;
        else {
          lastReview = r.output;
          const d = parseReview(r.output);
          if ('error' in d) reason = d.error;
          else if ('more' in d) {
            const more = localize(d.more);
            const why = vet(more);
            if (!why) return { more };
            reason = why;
          } else return d;
        }
        extra = `\n\nYour previous reply was rejected: ${reason}\nAnswer again with ONLY one JSON object.`;
      }
      notes.push(`review reply could not be used (${reason}); treated as accept`);
      return { accept: true };
    };

    for (let round = 1; round <= 3; round++) {
      const broke = limit();
      if (broke) return halted(broke);
      const d = await review(round);
      if (d === 'aborted') return { ok: false, aborted: true };
      if ('accept' in d) break;
      if ('redo' in d) {
        let did = 0;
        for (const item of d.redo) {
          const kids = this.spawnedBy(this.state(runId), node.id);
          const child = kids.find((k) => k.kind === 'agent' && (k.id === item.id || k.id === `${node.id}-${item.id}`));
          if (!child) {
            notes.push(`redo of "${item.id}" ignored: not a step ${node.id} spawned`);
            continue;
          }
          const done = this.store.eventsNoChunks(runId).filter((e) => e.event.type === 'loop' && e.event.check === node.id && e.event.fixNode === child.id).length;
          if (done >= MAX_REDOS) {
            notes.push(`redo of ${child.id} ignored: it was already sent back ${MAX_REDOS} times`);
            continue;
          }
          const now = this.state(runId);
          const used = this.spawnUsed(now);
          const { maxSpawn } = limitsOf(now.pipeline);
          if (used >= maxSpawn) {
            notes.push(`redo of ${child.id} refused: the spawn budget is used up (${used} of ${maxSpawn}, redos included)`);
            continue;
          }
          const brokeNow = limit();
          if (brokeNow) return halted(brokeNow);
          this.store.append(runId, { type: 'loop', check: node.id, fixNode: child.id, n: done + 1 });
          this.store.append(runId, { type: 'node.amended', node: child.id, guidance: `Redo requested by ${node.id}: ${item.reason}`.slice(0, 1000), reason: `redo requested by ${node.id}` });
          const fresh = this.state(runId).pipeline.nodes.find((n) => n.id === child.id)!;
          const r = await this.runAgentOnce(runId, fresh, signal);
          if (r.aborted || signal.aborted) return { ok: false, aborted: true };
          if (r.ok && !r.paused) this.requeueSkippedBelow(runId, node, child.id);
          did++;
        }
        if (!did) {
          notes.push('nothing left to redo; treated as accept');
          break;
        }
        // steps that were skipped because the redone one had failed can run now
        const after = afterWork(await work());
        if (after) return after;
      } else {
        spawn(d.more);
        const halt = afterWork(await work());
        if (halt) return halt;
      }
      if (round === 3) notes.push('review limit reached (3 rounds); finished with the work as it stands');
    }

    // 4. Done. A spawned step that is still failed fails the manager, even if it accepted.
    const s = this.state(runId);
    const failed = this.spawnedBy(s, node.id).filter((k) => ['error', 'skipped'].includes(s.nodes[k.id]?.status ?? '')).map((k) => k.id);
    if (failed.length) return finish('error', `spawned step(s) failed: ${failed.join(', ')}`);
    return finish('done');
  }

  /** Spawn budget used so far in this run: spawned work steps plus every redo a manager asked for. */
  private spawnUsed(s: RunState): number {
    const managers = new Set(s.pipeline.nodes.filter((n) => n.manager).map((n) => n.id));
    const redos = this.store.eventsNoChunks(s.id).filter((e) => e.event.type === 'loop' && managers.has(e.event.check)).length;
    return s.spawned + redos;
  }

  /** After a redo succeeded: queue again the manager's steps that were skipped below it. */
  private requeueSkippedBelow(runId: string, manager: PipelineNode, from: string): void {
    const s = this.state(runId);
    const mine = new Set(this.spawnedBy(s, manager.id).map((k) => k.id));
    const seen = new Set<string>();
    const stack = childrenOf(s.pipeline, from);
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || !mine.has(id)) continue;
      seen.add(id);
      stack.push(...childrenOf(s.pipeline, id));
    }
    for (const id of seen) if (s.nodes[id]?.status === 'skipped') this.store.append(runId, { type: 'node.requeued', node: id, reason: `${from} was redone` });
  }

  /** Id for the manager's next plan-approval step: `<id>-approve`, then `<id>-approve-2`, ... */
  private nextApprovalId(s: RunState, node: PipelineNode): string {
    const n = this.spawnedBy(s, node.id).filter((k) => k.kind === 'approval').length;
    return n ? `${node.id}-approve-${n + 1}` : `${node.id}-approve`;
  }

  /** One plan or review call to a manager: read-only, any stray file changes reverted, its cost logged as a manager.cost event. */
  private async askManager(
    runId: string,
    node: PipelineNode,
    phase: 'plan' | 'review',
    round: number,
    prompt: string,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; aborted?: boolean; output: string; error?: string; cost: number }> {
    const st = this.state(runId);
    const settings = st.pipeline.settings;
    const remaining = settings.maxCostUsd !== undefined ? Math.max(0, settings.maxCostUsd - st.costUsd) : undefined;
    const adapter = this.opts.registry.get(node.agent ?? 'claude');
    const dirtyBefore = new Set(await statusEntries(st.workdir));
    const sig = AbortSignal.any([signal, AbortSignal.timeout(settings.nodeTimeoutMs)]);
    let res: AgentResult;
    try {
      res = await adapter.run({
        runId,
        nodeId: `${node.id}.${phase}`,
        prompt,
        cwd: st.workdir,
        model: node.model,
        readOnly: true,
        attempt: round,
        timeoutMs: settings.nodeTimeoutMs,
        budgetUsd: remaining,
        signal: sig,
        mock: node.mock,
        onChunk: () => undefined,
        onSession: () => undefined,
      });
    } catch (err) {
      res = { output: '', exitCode: 1, error: (err as Error).message };
    }
    try {
      const touched = (await statusEntries(st.workdir)).filter((l) => !dirtyBefore.has(l));
      if (touched.length) await revertEntries(st.workdir, touched);
    } catch {
      /* best effort: the manager is read-only */
    }
    const cost = res.costUsd ?? 0;
    // recorded now, not when the manager finishes: it may pause or be stopped first
    if (cost) this.store.append(runId, { type: 'manager.cost', node: node.id, costUsd: cost });
    if (signal.aborted) return { ok: false, aborted: true, output: res.output, cost };
    const ok = res.exitCode === 0 && !sig.aborted;
    if (res.output) this.store.append(runId, { type: 'node.chunk', node: node.id, text: `[${phase} ${round}]\n${tail(res.output, 4000)}\n` });
    return { ok, output: res.output, error: sig.aborted ? `timed out after ${Math.round(settings.nodeTimeoutMs / 1000)}s` : (res.error ?? (ok ? undefined : `exit ${res.exitCode}`)), cost };
  }

  /** Put one question to a finished step, read-only, and log it. Always yields an answer (even "no such step"). */
  private async consultStep(runId: string, asker: PipelineNode, ask: Ask, round: number, sig: AbortSignal): Promise<{ to: string; answer: string; cost: number }> {
    const st = this.state(runId);
    const target = resolveTarget(st, asker, ask.target);
    const tnsHarness = target ? st.nodes[target.id]?.harness : undefined;
    const done = (to: string, answer: string, cost = 0) => {
      this.store.append(runId, { type: 'consult', from: asker.id, to, question: ask.question, answer: answer.slice(0, 8000), round, costUsd: cost || undefined, ...(tnsHarness ? { harness: tnsHarness } : {}) });
      return { to, answer, cost };
    };
    if (!target) {
      const names = askable(st, asker).map((n) => n.id).join(', ') || 'none yet';
      return done(ask.target, `There is no finished step called "${ask.target}". Steps that can be asked: ${names}.`);
    }
    const remaining = st.pipeline.settings.maxCostUsd !== undefined ? st.pipeline.settings.maxCostUsd - st.costUsd : undefined;
    if (remaining !== undefined && remaining <= 0) return done(target.id, 'The run is out of budget, so this question was not asked. Proceed on your best assumption.');
    const adapter = this.opts.registry.get(target.agent ?? 'claude');
    const tns = st.nodes[target.id]!;
    const resumed = adapter.supportsResume && !!tns.sessionId;
    const dirtyBefore = new Set(await statusEntries(st.workdir));
    let res: AgentResult;
    try {
      res = await adapter.run({
        runId,
        nodeId: `${target.id}.consult`,
        prompt: consultPrompt(st, asker, target, ask.question, resumed),
        cwd: st.workdir,
        model: target.model,
        readOnly: true,
        permissionMode: target.permissionMode,
        attempt: 1,
        timeoutMs: Math.min(st.pipeline.settings.nodeTimeoutMs, 300_000),
        budgetUsd: remaining,
        resumeSessionId: resumed ? tns.sessionId : undefined,
        signal: sig,
        mock: target.mock ? { output: `(${target.id}) answer to: ${ask.question.slice(0, 80)}`, costUsd: target.mock.costUsd ?? 0, delayMs: 50 } : undefined,
        onChunk: () => undefined,
        onSession: () => undefined,
      });
    } catch (err) {
      res = { output: '', exitCode: 1, error: (err as Error).message };
    }
    try {
      const touched = (await statusEntries(st.workdir)).filter((l) => !dirtyBefore.has(l));
      if (touched.length) await revertEntries(st.workdir, touched);
    } catch {
      /* best effort: a consult must not break the run */
    }
    const answer = res.exitCode === 0 && res.output.trim() ? res.output.trim() : `${target.id} could not answer (${res.error ?? 'no output'}). Proceed on your best assumption.`;
    return done(target.id, answer, res.costUsd ?? 0);
  }

  /**
   * Record the `@ASK user:` lines of a team step's output as cards. A question this step already asked (same text) is
   * not asked again. It waits only in live mode, with fewer than 2 cards open and the step under 4 questions; any other
   * ask is answered at once by Maestro with the recommended option (and says so). Returns what Maestro answered, and
   * whether the step now waits for the person. Synchronous, so racing steps cannot both take the last open slot.
   */
  private takeUserAsks(runId: string, node: PipelineNode, output: string, canWait: boolean): { answered: { question: string; answer: string; by: string }[]; waiting: boolean } {
    const answered: { question: string; answer: string; by: string }[] = [];
    let waiting = false;
    for (const a of parseUserAsks(output)) {
      const st = this.state(runId);
      const known = st.userAsks ?? [];
      if (known.some((k) => k.node === node.id && k.question.ask === a.question)) continue;
      const taken = new Set([...known.map((k) => k.question.id), ...(st.cards ?? []).map((c) => c.id), ...st.answers.map((x) => x.question)]);
      let n = known.length + 1;
      while (taken.has(`u${n}`)) n++;
      const q = askToQuestion(a, `u${n}`, node.id);
      const open = known.filter((k) => !k.answer).length;
      const mine = known.filter((k) => k.node === node.id).length;
      const why =
        st.mode === 'autonomous' ? undefined
        : !canWait ? 'this step cannot wait for the person'
        : open >= MAX_OPEN_ASKS ? `${MAX_OPEN_ASKS} questions are already waiting for the person`
        : mine >= MAX_ASKS_PER_STEP ? `this step has already asked ${MAX_ASKS_PER_STEP} questions`
        : null;
      if (why === null) {
        this.store.append(runId, { type: 'user.ask', node: node.id, question: q, wait: true });
        waiting = true;
        continue;
      }
      const text = why ? `Maestro used the recommended option: ${why}.` : undefined;
      this.store.append(runId, { type: 'user.ask', node: node.id, question: q, wait: false });
      const ans: Answer = { question: q.id, option: q.recommended, ...(text ? { text } : {}), by: 'maestro' };
      this.store.append(runId, { type: 'user.answer', question: q.id, answer: ans });
      if (why) this.store.append(runId, { type: 'node.chunk', node: node.id, text: `[maestro] answered "${a.question.slice(0, 80)}" with the recommended option: ${why}\n` });
      answered.push({ question: a.question, answer: describeAnswer(ans, [q]), by: 'maestro' });
    }
    return { answered, waiting };
  }

  /**
   * The step is carrying on after a pause: its newest answer came after its last finish and its last amendment
   * (a redo's guidance), so nothing but the answers is new to its session.
   */
  private answeredSinceLastRun(runId: string, nodeId: string, questions: string[]): boolean {
    const qs = new Set(questions);
    let answer = 0;
    let other = 0;
    for (const { seq, event: e } of this.store.eventsNoChunks(runId)) {
      if (e.type === 'user.answer' && qs.has(e.question)) answer = seq;
      else if ((e.type === 'node.finished' || e.type === 'node.amended') && e.node === nodeId) other = seq;
    }
    return answer > other;
  }

  private async runAgentOnce(
    runId: string,
    node: PipelineNode,
    runSignal: AbortSignal,
    failure?: { check: string; output: string },
    /** Spend of the steps waiting on this one (hand-off delegators) that is not in the log yet. */
    unrecorded = 0,
  ): Promise<{ ok: boolean; aborted?: boolean; /** The step is waiting for the person to answer a question; it has not finished. */ paused?: boolean; output: string; error?: string }> {
    const state = this.state(runId);
    const ns = state.nodes[node.id]!;
    const attempt = ns.attempts + 1;
    const adapter = this.opts.registry.get(node.agent ?? 'claude');
    const abandoned = ns.output === undefined && !!ns.sessionId;
    const probe = this.probes.get(runId);
    if (probe) {
      // A probe never starts a step it may not afford: spend so far plus the dearest step seen (or the estimate) must fit the cap.
      const cap = state.pipeline.settings.maxCostUsd;
      const next = Math.max(probe.nodeEstimateUsd, probe.maxSeen);
      if (cap !== undefined && state.costUsd + unrecorded + next > cap + 1e-9) {
        const error = `probe budget: the next step may cost $${next.toFixed(4)} and $${Math.max(0, cap - state.costUsd - unrecorded).toFixed(4)} is left`;
        this.store.append(runId, { type: 'node.started', node: node.id, attempt });
        this.store.append(runId, { type: 'node.finished', node: node.id, status: 'error', output: '', error, durationMs: 0, attempt, budget: true });
        return { ok: false, output: '', error };
      }
    }

    // The bot's harness (best-effort: a broken store must never stop a run). Its guidance notes join the prompt.
    let harness: HarnessRef | undefined;
    let harnessGuidance: string[] | undefined;
    let harnessPersona: string | undefined;
    try {
      // Only a step whose role IS a known bot has a harness; an unknown or missing role gets none (never a fallback bot's).
      const botId = node.kind === 'agent' && node.role && !NON_EVOLVABLE.includes(node.role) ? node.role : undefined;
      const def = botId ? (CREW[botId]?.def ?? BUILTIN_BOTS.find((b) => b.id === botId)) : undefined;
      if (def && (def.kind === 'agent' || def.kind === 'verdict')) {
        // A resumed attempt carries the session it was started with: record and use that version, not a newer one.
        if (probe && probe.bot === def.id) {
          // the probe's override: used for this replay only, never saved; recorded with the version it was built on, marked as a probe
          const v1 = getVersion(this.opts.home, def, 1);
          harness = { bot: def.id, version: probe.harness.version, probe: probe.tag.side };
          harnessGuidance = [...probe.harness.guidance];
          harnessPersona = v1 && probe.harness.persona !== v1.persona ? probe.harness.persona : undefined;
        } else {
          const pin = abandoned && ns.harness?.bot === def.id ? ns.harness.version : undefined;
          const r = harnessForRun(this.opts.home, def, pin);
          harness = { bot: def.id, version: r.harness.version, ...(probe ? { probe: probe.tag.side } : {}) };
          harnessGuidance = r.harness.guidance;
          harnessPersona = r.persona;
        }
      }
    } catch (err) {
      if (!harnessWarned) {
        harnessWarned = true;
        console.error(`[harness] could not read or write the harness store (${(err as Error).message}); runs continue without harness data`);
      }
    }
    this.store.append(runId, { type: 'node.started', node: node.id, attempt, ...(harness ? { harness } : {}) });

    let vaultContext: string | undefined;
    if (this.opts.vault && node.vault !== false) {
      try {
        vaultContext = await this.opts.vault.contextFor(`${state.task} ${node.role ?? ''} ${node.title ?? ''}`, {
          exclude: new Set(state.notes.concat(Vault.runNotePath(state))),
        });
      } catch {
        /* context is best-effort */
      }
    }
    const diff = node.includeDiff ? await diffAgainst(state.workdir, state.baseSha, state.setupArtifacts) : undefined;
    // What was already dirty when this node began (setup output, a gate's artifacts): not this node's doing.
    const dirtyBefore = new Set(await statusEntries(state.workdir));
    const prompt = buildPrompt({ pipeline: state.pipeline, node, state: this.state(runId), vaultContext, diff, failure, resumed: abandoned, harnessGuidance, harnessPersona });

    let buf = '';
    let timer: NodeJS.Timeout | undefined;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (buf) this.store.append(runId, { type: 'node.chunk', node: node.id, text: buf });
      buf = '';
    };
    const onChunk = (t: string) => {
      buf += t;
      if (buf.length > 2000) flush();
      else timer ??= setTimeout(flush, 400);
    };

    const timeoutMs = state.pipeline.settings.nodeTimeoutMs;
    let sig = AbortSignal.any([runSignal, AbortSignal.timeout(timeoutMs)]);
    let budgetUsd =
      state.pipeline.settings.maxCostUsd !== undefined ? Math.max(0, state.pipeline.settings.maxCostUsd - state.costUsd - unrecorded) : undefined;
    const t0 = Date.now();

    /**
     * Probe replays: every call's spend is logged the moment it returns (a manager.cost event), so a step cut short still counts. A call
     * that reports no cost (aborted, timed out, killed, or an adapter that stayed silent) is charged what was left of the cap: an upper
     * bound, so under-reporting can never push the probe past its budget. The replay is then marked as estimated (not a result).
     */
    const charge = (r: AgentResult): AgentResult => {
      if (!probe) return r;
      const cap = this.state(runId).pipeline.settings.maxCostUsd;
      const left = cap !== undefined ? Math.max(0, cap - this.state(runId).costUsd - unrecorded) : 0;
      const known = typeof r.costUsd === 'number' && Number.isFinite(r.costUsd) && r.costUsd >= 0;
      const cost = known ? r.costUsd! : left;
      if (!known) probe.estimated = true;
      probe.maxSeen = Math.max(probe.maxSeen, cost);
      if (cost > 0) this.store.append(runId, { type: 'manager.cost', node: node.id, costUsd: cost });
      return { ...r, costUsd: undefined };
    };
    const call = async (resumeSessionId?: string, promptText: string = prompt): Promise<AgentResult> => charge(await callRaw(resumeSessionId, promptText));
    const callRaw = async (resumeSessionId?: string, promptText: string = prompt): Promise<AgentResult> => {
      try {
        return await adapter.run({
          runId,
          nodeId: node.id,
          prompt: promptText,
          cwd: state.workdir,
          model: node.model,
          readOnly: !!node.readOnly,
          permissionMode: node.permissionMode,
          attempt,
          timeoutMs,
          budgetUsd,
          resumeSessionId,
          signal: sig,
          mock: node.mock,
          verdictNode: node.verdict,
          onChunk,
          onSession: (id) => this.store.append(runId, { type: 'node.session', node: node.id, sessionId: id }),
        });
      } catch (err) {
        return { output: '', exitCode: 1, error: (err as Error).message };
      }
    };

    const resumeId = adapter.supportsResume ? ns.sessionId : undefined;
    // Right after a pause on the person's answer, a session that can resume only needs the answers, not the whole briefing
    // again. Any other attempt (a redo, a fix loop, a retry) gets the full prompt, which carries the answers as well.
    const answered = (state.userAsks ?? []).filter((a) => a.node === node.id && a.answer);
    const afterPause = !!resumeId && !failure && answered.length > 0 && this.answeredSinceLastRun(runId, node.id, answered.map((a) => a.question.id));
    let res = await call(
      resumeId,
      afterPause ? userAnswersBlock(answered.map((a) => ({ question: a.question.ask, answer: describeAnswer(a.answer!, [a.question]), by: a.answer!.by })), { reverted: !node.readOnly }) : prompt,
    );
    // A vendor session can expire; fall back to a fresh one rather than failing the node.
    if (resumeId && res.exitCode !== 0 && !res.output && !sig.aborted) res = await call(undefined);
    flush();

    // Team runs: a worker's `@ASK user:` lines, taken from the first reply and from every follow-up (after consults and hand-offs).
    // Live: the step waits for the person (awaiting) and runs again once answered.
    // Autonomous, over the limit, or a hand-off step nobody can wait for: Maestro answers with the recommended option and the step carries on.
    let extraCost = 0;
    let handCost = 0;
    const teamStep = state.kind === 'team' && node.kind === 'agent' && !node.manager;
    const userRounds = async (): Promise<{ ok: false; paused: true; output: string } | undefined> => {
      if (!teamStep) return undefined;
      const canWait = node.spawn?.kind !== 'hand';
      for (let round = 1; round <= 2 && res.exitCode === 0 && !sig.aborted && !runSignal.aborted; round++) {
        const got = this.takeUserAsks(runId, node, res.output, canWait);
        if (got.waiting) {
          const cost = (res.costUsd ?? 0) + extraCost + handCost;
          // the step has not finished, so its spend is logged now
          if (cost) this.store.append(runId, { type: 'manager.cost', node: node.id, costUsd: cost });
          try {
            // its own half-done edits must not be committed by the next step; it redoes them after the answer
            const touched = (await statusEntries(state.workdir)).filter((l) => !dirtyBefore.has(l));
            if (touched.length) await revertEntries(state.workdir, touched);
          } catch {
            /* best effort */
          }
          return { ok: false, paused: true, output: res.output };
        }
        if (!got.answered.length) break;
        const live = this.state(runId).nodes[node.id]!;
        const canResume = adapter.supportsResume && !!live.sessionId;
        const block = userAnswersBlock(got.answered);
        const follow = canResume ? block : `${prompt}\n\n# Your answer so far\n${stripUserAsks(res.output)}\n\n${block}`;
        const before = res;
        res = await call(canResume ? live.sessionId : undefined, follow);
        res = { ...res, costUsd: res.costUsd !== undefined || before.costUsd ? (res.costUsd ?? 0) + (before.costUsd ?? 0) : undefined };
        flush();
      }
      return undefined;
    };
    const first = await userRounds();
    if (first) return first;

    // Bots asking bots: a question at the end of the answer goes to a finished step; the answer comes back and this step finishes.
    const rounds = node.kind === 'agent' ? state.pipeline.settings.consult ?? 0 : 0;
    for (let round = 1; round <= rounds && res.exitCode === 0 && !sig.aborted && !runSignal.aborted; round++) {
      const asks = parseAsks(res.output).slice(0, 2);
      if (!asks.length) break;
      const answered: { to: string; question: string; answer: string }[] = [];
      for (const a of asks) {
        const r = await this.consultStep(runId, node, a, round, sig);
        extraCost += r.cost;
        answered.push({ to: r.to, question: a.question, answer: r.answer });
      }
      const live = this.state(runId).nodes[node.id]!;
      const canResume = adapter.supportsResume && !!live.sessionId;
      const follow = canResume ? answersBlock(answered) : `${prompt}\n\n# Your answer so far\n${stripAsks(res.output)}\n\n${answersBlock(answered)}`;
      const before = res;
      res = await call(canResume ? live.sessionId : undefined, follow);
      extraCost += before.costUsd ?? 0;
      flush();
    }
    if (rounds) res = { ...res, output: stripAsks(res.output), costUsd: res.costUsd !== undefined || extraCost ? (res.costUsd ?? 0) + extraCost : undefined };
    extraCost = 0;
    const afterConsult = await userRounds();
    if (afterConsult) return afterConsult;

    // Workers handing work to teammates: a @HAND line spawns a step that runs now; its result comes back and this step finishes.
    const handRounds = node.kind === 'agent' && !node.manager ? state.pipeline.settings.handoff ?? 0 : 0;
    for (let round = 1; round <= handRounds && res.exitCode === 0 && !sig.aborted && !runSignal.aborted; round++) {
      // out of time: finish with the answer as it stands (its @HAND lines are stripped below)
      if (this.overClock(runId)) break;
      const reqs = parseHands(res.output);
      if (!reqs.length) break;
      const results: HandResult[] = [];
      for (const q of reqs) {
        const r = await this.handoffStep(runId, node, q, round, runSignal, unrecorded + handCost + (res.costUsd ?? 0));
        if (r.aborted || runSignal.aborted) return { ok: false, aborted: true, output: res.output };
        results.push(r);
      }
      if (this.overClock(runId)) break;
      // this step's own clock does not run while its teammates work
      sig = AbortSignal.any([runSignal, AbortSignal.timeout(timeoutMs)]);
      const live = this.state(runId);
      const canResume = adapter.supportsResume && !!live.nodes[node.id]!.sessionId;
      const block = handoffBlock(results, round === handRounds);
      const follow = canResume ? block : `${prompt}\n\n# Your answer so far\n${stripHands(res.output)}\n\n${block}`;
      const before = res;
      handCost += before.costUsd ?? 0;
      // what is left after the teammates' recorded spend and this step's own spend so far
      const cap = live.pipeline.settings.maxCostUsd;
      if (cap !== undefined) budgetUsd = Math.max(0, cap - live.costUsd - handCost - unrecorded);
      res = await call(canResume ? live.nodes[node.id]!.sessionId : undefined, follow);
      flush();
    }
    if (handRounds) res = { ...res, output: stripHands(res.output), costUsd: res.costUsd !== undefined || handCost ? (res.costUsd ?? 0) + handCost : undefined };
    handCost = 0;
    const afterHands = await userRounds();
    if (afterHands) return afterHands;
    if (teamStep) res = { ...res, output: stripUserAsks(res.output) };

    if (runSignal.aborted) return { ok: false, aborted: true, output: res.output };
    const timedOut = sig.aborted;

    let commit: string | undefined;
    let error = res.error;
    let status: 'done' | 'error' = res.exitCode === 0 && !timedOut ? 'done' : 'error';
    if (timedOut) error = `timed out after ${Math.round(timeoutMs / 1000)}s`;

    try {
      if (node.readOnly) {
        const touched = (await statusEntries(state.workdir)).filter((l) => !dirtyBefore.has(l));
        if (touched.length) {
          await revertEntries(state.workdir, touched);
          status = 'error';
          error = `read-only node modified files (${entryPaths(touched).slice(0, 3).join(', ')}); changes were reverted`;
        }
      } else {
        commit = await commitAll(state.workdir, `aorch: ${node.id} (${node.role ?? 'agent'}) attempt ${attempt}`, state.setupArtifacts);
      }
    } catch (err) {
      status = 'error';
      error = `git: ${(err as Error).message}`;
    }

    let verdict: 'PASS' | 'FAIL' | undefined;
    if (node.verdict && status === 'done') {
      const all = [...res.output.matchAll(/VERDICT:\s*(PASS|FAIL)/gi)];
      const last = all[all.length - 1]?.[1]?.toUpperCase();
      verdict = last === 'PASS' ? 'PASS' : 'FAIL';
      if (!last) error = 'no "VERDICT: PASS|FAIL" line in the reviewer output';
    }

    this.store.append(runId, {
      type: 'node.finished',
      node: node.id,
      status,
      output: tail(res.output, MAX_OUTPUT),
      error,
      costUsd: res.costUsd,
      durationMs: Date.now() - t0,
      commit,
      sessionId: res.sessionId,
      verdict,
      attempt,
      ...(probe && (probe.estimated || (status === 'error' && (() => {
        const cap = this.state(runId).pipeline.settings.maxCostUsd;
        return cap !== undefined && this.state(runId).costUsd >= cap - 1e-9;
      })())) ? { budget: true as const } : {}),
    });
    if (handRounds) this.skipOrphans(runId, node);
    return { ok: status === 'done' && verdict !== 'FAIL', output: res.output, error };
  }
}

/** Every task goes to a bot the approved plan assigned, and writes only where the plan gave that bot a write assignment. */
function withinPlan(tasks: PlanTask[], plan: NonNullable<RunState['plan']>): boolean {
  return tasks.every((t) => plan.assignments.some((a) => a.bot === t.to && (t.mode === 'read' || a.mode === 'write')));
}

/**
 * What planning may spend: the run's --budget, or the default cap when none was given. The cap covers the whole run,
 * so whatever planning spends is gone from the plan's cap too (approval is refused when nothing is left).
 */
function planningCap(s: RunState): number {
  return s.team?.budgetUsd ?? TEAM_DEFAULT_BUDGET_USD;
}

/** What a manager step hands downstream: who did what, how it ended, and the manager's last word. */
function managerSummary(s: RunState, node: PipelineNode, kids: PipelineNode[], notes: string[], lastReview: string): string {
  const lines = [`${node.id} handed out ${kids.filter((k) => k.kind === 'agent').length} step(s).`];
  for (const k of kids) {
    const ns = s.nodes[k.id];
    if (k.kind !== 'agent') {
      lines.push(`- ${k.id} (approval): ${ns?.status ?? 'unknown'}`);
      continue;
    }
    lines.push(`- ${k.id} → ${k.role ?? 'agent'}: ${k.spawn?.contract.goal ?? ''} [${ns?.status ?? 'unknown'}]`);
    const body = ns?.error ? `error: ${ns.error}` : ns?.output;
    if (body) lines.push(`  ${tail(body, 1500).replace(/\n/g, '\n  ')}`);
  }
  if (notes.length) lines.push('', 'Notes:', ...notes.map((n) => `- ${n}`));
  if (lastReview) lines.push('', `Final review:\n${tail(lastReview, 2000)}`);
  return lines.join('\n');
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<unknown>): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]!);
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
}
