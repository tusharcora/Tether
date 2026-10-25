import type { HttpGate } from './http/types.js';
export type { HttpGate };

// Shared types. The pipeline file is the visual builder's document; RunEvent is the
// append-only log every run is rebuilt from (that is what makes runs resumable).

export type Mode = 'pipeline' | 'swarm' | 'orchestration';
/** Modes the engine has a scheduler for. Others are refused in preflight AND in the engine. */
export const SUPPORTED_MODES: Mode[] = ['pipeline'];

/** A person's thumbs up or down on a step's output. */
export type Rating = 'up' | 'down';
export type NodeKind = 'agent' | 'gate' | 'approval';
export type PipeMode = 'ancestors' | 'direct';

/** Scripted behaviour for the built-in `mock` adapter (tests, demos, dry runs). */
export interface MockScript {
  output?: string;
  echoPrompt?: boolean;
  writeFile?: { path: string; content: string };
  /** First attempt (1-based) on which writeFile happens. Default 1. */
  writeFileFromAttempt?: number;
  /** Fail the first N attempts with exit code 1. */
  failFirst?: number;
  /** Per-attempt verdicts for reviewer nodes; the last entry repeats. */
  verdicts?: ('PASS' | 'FAIL')[];
  /** Scripted replies per phase: a request whose nodeId ends in `.<phase>` gets replies[phase][min(attempt-1, len-1)]. */
  replies?: Record<string, string[]>;
  /** On a manager: scripts for the steps it spawns, keyed by the plan's local task id. */
  spawned?: Record<string, MockScript>;
  /** Planning dialogue: card batches per round (a string is a raw, possibly malformed reply). After the last, the plan is returned. */
  questions?: (Question[] | string)[];
  /** Planning dialogue: the plan (object, or a raw string) returned once the questions run out. */
  plan?: Record<string, unknown> | string;
  /** Evolve editor: the reply to the harness-editing prompt (an object is wrapped in a ```json block; a string is returned as is). */
  proposal?: unknown;
  /** Test hook: the first entry whose `includes` text is in the prompt overrides this script with `then` (probes: react to harness guidance). */
  whenPrompt?: { includes: string; then: MockScript }[];
  delayMs?: number;
  costUsd?: number;
  /** Report no cost at all (like an adapter cut off before its final result). */
  noCost?: boolean;
}

/** The hand-off a manager gives a step it spawns. */
export interface Contract {
  to: string;
  goal: string;
  expected?: string;
  context: string[];
  mode: 'read' | 'write';
  after: string[];
}

export interface PipelineNode {
  id: string;
  kind: NodeKind;
  role?: string;
  title?: string;
  x: number;
  y: number;
  /** Adapter id: claude | codex | opencode | mock | <custom from config>. */
  agent?: string;
  model?: string;
  /** Role instructions. Falls back to a default for the role. */
  prompt?: string;
  /** Extra direction added mid-run (by you or Maestro) after an attempt went wrong. Appended to the prompt. */
  guidance?: string;
  /** Claude Code permission mode override (default: plan if readOnly else acceptEdits). */
  permissionMode?: string;
  /** Does not modify files. Read-only agent nodes in the same frontier run concurrently. */
  readOnly?: boolean;
  /** Append the current diff vs. the run's base commit to this node's prompt. */
  includeDiff?: boolean;
  /** Node must end with `VERDICT: PASS|FAIL`; FAIL is a check failure. */
  verdict?: boolean;
  /** Inject knowledge-graph context from the vault (default true). */
  vault?: boolean;
  /** gate: shell command, run in the run's worktree. Exit 0 = pass. */
  command?: string;
  /** gate: run a saved API request instead of a command (exactly one of the two). */
  http?: HttpGate;
  /** For gates and verdict nodes: re-run this upstream agent node with the failure output. */
  fixNode?: string;
  /** Max fix loops for this check (default 2). */
  maxLoops?: number;
  /** This step may spawn further steps at run time. */
  manager?: boolean;
  /** Bot ids / built-in roles a manager may spawn (default: any). */
  roster?: string[];
  /** Set on steps created at run time by a manager. */
  spawn?: { parent: string; depth: number; contract: Contract; /** 'hand' = worker handoff; absent = 'plan' (manager). */ kind?: 'plan' | 'hand' };
  mock?: MockScript;
}

export interface Edge {
  from: string;
  to: string;
}

export interface PipelineSettings {
  /** Max concurrently running read-only agent nodes. */
  parallel: number;
  nodeTimeoutMs: number;
  /** Stop before starting a node once spend reaches this. Needs adapters that report cost. */
  maxCostUsd?: number;
  wallClockMs?: number;
  pipeMode: PipeMode;
  /** Shell command run once in the fresh worktree before any node (e.g. `npm ci`). */
  setup?: string;
  /** Rounds a step may spend asking already-finished steps questions (0 or unset: off). */
  consult?: number;
  /** How deep managers may nest (default 3, 1..5). */
  maxDepth?: number;
  /** Max steps spawned in one run (default 12, 1..30). */
  maxSpawn?: number;
  /** Managers must have their plan approved before spawning. */
  planApproval?: boolean;
  /** Team runs: the person already approved the plan, so the manager's first batch needs no second approval. */
  planPreapproved?: boolean;
  /** Managers may hand out write tasks (spawned steps that edit files). Default off: read-only plans only. */
  allowWrites?: boolean;
  /** Rounds of worker-to-worker @HAND handoffs a step may start (1..3; unset: off). */
  handoff?: number;
  /** Handed-off workers may edit files. Default off: read-only. */
  allowWorkerWrites?: boolean;
}

export interface Pipeline {
  name: string;
  version: 1;
  mode: Mode;
  nodes: PipelineNode[];
  edges: Edge[];
  settings: PipelineSettings;
}

export const DEFAULT_SETTINGS: PipelineSettings = {
  parallel: 4,
  nodeTimeoutMs: 30 * 60_000,
  pipeMode: 'ancestors',
};

// ---------- events ----------

export type RunStatus = 'running' | 'paused' | 'done' | 'error' | 'stopped';
export type NodeStatus = 'queued' | 'running' | 'awaiting' | 'done' | 'error' | 'skipped';

export interface CoachFinding {
  id: string;
  title: string;
  detail: string;
  action: string;
}

/** The project a run belongs to, as it was when the run began: shown in the UI and pasted into every agent's prompt. */
export interface RunWorkspace {
  id: string;
  name: string;
  context: string;
  /** The saved API requests block for prompts, when the workspace has requests and the block is on. */
  endpoints?: string;
}

export type RunKind = 'workflow' | 'team';
export type TeamMode = 'live' | 'autonomous';

export interface Question {
  id: string;
  ask: string;
  why?: string;
  options: { id: string; label: string; detail?: string }[];
  /** One of the option ids. */
  recommended: string;
  allowOther?: boolean;
  /** The step that asked (worker questions). */
  from?: string;
}

export interface Answer {
  question: string;
  option?: string;
  text?: string;
  by: 'user' | 'default' | 'maestro';
}

export interface TeamPlan {
  goal: string;
  success: string[];
  assignments: {
    bot: string;
    goal: string;
    expected?: string;
    mode: 'read' | 'write';
    /** Maestro's reason for this bot. */
    why?: string;
    /** The person picked another bot before approving. */
    swapped?: true;
  }[];
  limits: { maxCostUsd?: number; wallClockMs?: number; allowWrites: boolean };
  answers: Answer[];
  /** The bots Maestro could choose from; a swap may only pick one of these. */
  roster?: string[];
}

/** A probe replay's tag: the proposal it tests, the side, and (candidate) which edit of the proposal was applied alone. */
export interface ProbeTag {
  proposal: string;
  side: 'baseline' | 'candidate';
  edit?: number;
}

/** Which bot harness an attempt ran with. `probe`: a probe replay's harness override (not a saved version's content; the version is the base it was built on). */
export interface HarnessRef {
  bot: string;
  version: number;
  probe?: ProbeTag['side'];
}

export type RunEvent =
  | {
      type: 'run.started';
      pipeline: Pipeline;
      task: string;
      repo: string;
      workdir: string;
      baseSha: string;
      branch: string;
      vault?: string;
      autoApprove?: boolean;
      workspace?: RunWorkspace;
      kind?: RunKind;
      mode?: TeamMode;
      /** Team runs: planning settings, kept in the log so a restart honours them. */
      roster?: string[];
      maxRounds?: number;
      yes?: boolean;
      /** Team runs: spend cap chosen at start; it overrides the plan's own cap. */
      budgetUsd?: number;
      /** Evolve probe replay: which proposal it tests and on which side. Probe runs never teach lessons or count in signals. */
      probe?: ProbeTag;
    }
  | { type: 'plan.question'; round: number; questions: Question[] }
  | { type: 'plan.answer'; answers: Answer[] }
  | { type: 'plan.ready'; plan: TeamPlan }
  /** Before approval the person gave assignment `assignment` (0-based) to another roster bot. */
  /** `mode`: set when the new bot is read-only and the assignment was a write; the assignment becomes read. */
  | { type: 'plan.edit'; assignment: number; from: string; to: string; mode?: 'read' }
  /** A background planning step failed; the run stays as it was and the person can try again. */
  | { type: 'team.error'; message: string }
  | { type: 'team.mode'; mode: TeamMode }
  /** A worker's question for the person. `wait`: the asking step pauses (awaiting) until the answer; `false`: answered at once by Maestro. */
  | { type: 'user.ask'; node: string; question: Question; wait?: boolean }
  | { type: 'user.answer'; question: string; answer: Answer }
  /** A team run's approved plan became its pipeline: replaces the empty placeholder made at start (ignored once the pipeline has steps). */
  | { type: 'team.pipeline'; pipeline: Pipeline }
  | { type: 'node.spawned'; node: PipelineNode; parent: string; depth: number; after: string[] }
  | { type: 'run.resumed'; retryFailed?: boolean }
  | { type: 'setup.result'; ok: boolean; output: string; durationMs: number; artifacts?: string[] }
  | { type: 'node.started'; node: string; attempt: number; /** Which version of the bot's harness this attempt ran with. */ harness?: HarnessRef }
  | { type: 'node.session'; node: string; sessionId: string }
  | { type: 'node.chunk'; node: string; text: string }
  | {
      type: 'node.finished';
      node: string;
      status: 'done' | 'error';
      output: string;
      error?: string;
      costUsd?: number;
      durationMs: number;
      commit?: string;
      sessionId?: string;
      verdict?: 'PASS' | 'FAIL';
      attempt: number;
      /** The step was refused or cut short by the run's spend cap (structured; never inferred from error text). */
      budget?: true;
    }
  | { type: 'node.skipped'; node: string; reason: string }
  | { type: 'gate.result'; node: string; ok: boolean; exitCode: number | null; output: string; durationMs: number }
  | { type: 'loop'; check: string; fixNode: string; n: number }
  /** Spend of a manager's own plan/review calls, recorded as it happens (the step may pause before it finishes). */
  | { type: 'manager.cost'; node: string; costUsd: number }
  /** A skipped step is queued again (its failed upstream was redone). */
  | { type: 'node.requeued'; node: string; reason: string }
  | { type: 'handoff'; from: string; to: string; goal: string; answer: string; round: number; costUsd?: number }
  | { type: 'consult'; from: string; to: string; question: string; answer: string; round: number; costUsd?: number; /** The consulted step's bot and harness version (the one its session ran with). */ harness?: { bot: string; version: number } }
  /** The person's thumbs up/down on a step's output. Last one per step wins. `note` is free text from a person: data, capped at 500 chars. */
  | { type: 'feedback'; node: string; rating: Rating; note?: string }
  | { type: 'approval.requested'; node: string }
  | { type: 'approval.resolved'; node: string; approved: boolean; by?: string }
  /** A step was re-pointed at a different agent/model (by the supervisor or a person). The run records exactly what ran. */
  | { type: 'node.amended'; node: string; agent?: string; model?: string; guidance?: string; reason: string }
  | { type: 'supervisor.action'; round: number; action: 'retry' | 'escalate' | 'stop'; node?: string; detail: string }
  | { type: 'run.coach'; findings: CoachFinding[] }
  | { type: 'vault.note'; path: string }
  | { type: 'run.finished'; status: RunStatus; error?: string; /** The run ended because its spend cap was reached. */ budget?: true };

export interface StoredEvent {
  runId: string;
  seq: number;
  ts: number;
  event: RunEvent;
}

// ---------- folded state ----------

export interface NodeState {
  status: NodeStatus;
  attempts: number;
  output?: string;
  error?: string;
  /** Tail of streamed output while running. */
  live?: string;
  costUsd: number;
  commit?: string;
  sessionId?: string;
  verdict?: 'PASS' | 'FAIL';
  startedAt?: number;
  finishedAt?: number;
  gate?: { ok: boolean; exitCode: number | null; output: string };
  loops: number;
  /** Team runs: this attempt is the step carrying on after the person answered its question (not a redo or a retry). */
  resumedWithAnswer?: boolean;
  /** Team runs: the person answered while the step waited; the next attempt carries on with the answer. */
  answeredWhileWaiting?: boolean;
  /** The bot and harness version the latest attempt ran with (absent in logs from before Evolve). */
  harness?: HarnessRef;
  /** The person's latest thumbs up/down on this step (absent in logs from before Evolve). */
  feedback?: { rating: Rating; note?: string };
}

export interface RunState {
  id: string;
  status: RunStatus;
  pipeline: Pipeline;
  task: string;
  repo: string;
  workdir: string;
  baseSha: string;
  branch: string;
  vault?: string;
  /** The project this run works on (its context is in every agent's prompt). */
  workspace?: RunWorkspace;
  autoApprove: boolean;
  /** 'workflow' unless the run was started as a team run. */
  kind: RunKind;
  mode: TeamMode;
  /** A team run is planning until plan.ready. */
  planning: boolean;
  /** Latest planning round asked. */
  round: number;
  /** Unanswered plan.question / user.ask questions, oldest first. */
  pending: Question[];
  plan?: TeamPlan;
  /** Team runs: the planning settings chosen at start. */
  team?: { roster?: string[]; maxRounds: number; yes: boolean; budgetUsd?: number };
  /** Answers given in the planning dialogue, in order. */
  answers: Answer[];
  /** Every card ever asked (planning questions and worker questions), in order, so answers can be shown with their question. */
  cards?: Question[];
  /** Worker questions to the person: who asked, whether the step waits, and the answer once given. */
  userAsks?: { node: string; question: Question; wait: boolean; answer?: Answer }[];
  setupDone: boolean;
  /** Paths the setup command left in the worktree; kept out of agent commits and diffs. */
  setupArtifacts: string[];
  nodes: Record<string, NodeState>;
  /** Work steps spawned at run time (node.spawned events, not counting plan approvals). */
  spawned: number;
  costUsd: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  coach?: CoachFinding[];
  notes: string[];
  /** What the supervisor did about failures, in order. */
  actions: { round: number; action: string; node?: string; detail: string; ts: number }[];
  /** Questions steps put to each other, in order. */
  talk?: { from: string; to: string; question: string; answer: string; round: number; ts: number }[];
  /** Set on Evolve probe replays (from run.started). */
  probe?: ProbeTag;
  /** The spend cap stopped the run or one of its steps (run.finished.budget / node.finished.budget). */
  budgetStop?: true;
}

/** A team run whose plan is finished and waits for the person's go-ahead. */
export function planWaiting(s: RunState): boolean {
  return s.kind === 'team' && s.status === 'running' && !s.planning && !!s.plan && s.pipeline.nodes.length === 0 && s.pending.length === 0;
}

const LIVE_TAIL = 4000;

/** Rebuild a run's state from its event log. Pure and deterministic. */
export function foldRun(events: StoredEvent[]): RunState | undefined {
  let s: RunState | undefined;
  for (const { runId, ts, event: e } of events) {
    if (e.type === 'run.started') {
      s = {
        id: runId,
        status: 'running',
        pipeline: e.pipeline,
        task: e.task,
        repo: e.repo,
        workdir: e.workdir,
        baseSha: e.baseSha,
        branch: e.branch,
        vault: e.vault,
        workspace: e.workspace,
        autoApprove: !!e.autoApprove,
        kind: e.kind ?? 'workflow',
        mode: e.mode ?? 'live',
        planning: e.kind === 'team',
        ...(e.probe ? { probe: e.probe } : {}),
        ...(e.kind === 'team' ? { team: { ...(e.roster?.length ? { roster: e.roster } : {}), maxRounds: e.maxRounds ?? 3, yes: !!e.yes, ...(e.budgetUsd !== undefined ? { budgetUsd: e.budgetUsd } : {}) } } : {}),
        round: 0,
        pending: [],
        answers: [],
        setupDone: false,
        setupArtifacts: [],
        nodes: Object.fromEntries(
          e.pipeline.nodes.map((n) => [n.id, { status: 'queued', attempts: 0, costUsd: 0, loops: 0 } as NodeState]),
        ),
        spawned: 0,
        costUsd: 0,
        startedAt: ts,
        notes: [],
        actions: [],
      };
      continue;
    }
    if (!s) continue;
    if (e.type === 'node.spawned') {
      s.pipeline = {
        ...s.pipeline,
        nodes: [...s.pipeline.nodes, e.node],
        edges: [...s.pipeline.edges, ...e.after.map((from) => ({ from, to: e.node.id }))],
      };
      s.nodes[e.node.id] = { status: 'queued', attempts: 0, costUsd: 0, loops: 0 };
      // plan approvals are control steps, not work: they do not use up the spawn budget
      if (e.node.kind !== 'approval') s.spawned += 1;
      continue;
    }
    if (e.type === 'team.pipeline') {
      if (!s.pipeline.nodes.length) {
        s.pipeline = e.pipeline;
        for (const n of e.pipeline.nodes) s.nodes[n.id] ??= { status: 'queued', attempts: 0, costUsd: 0, loops: 0 };
      }
      continue;
    }
    if (e.type === 'plan.question') {
      s.planning = true;
      s.round = e.round;
      s.pending = [...s.pending, ...e.questions];
      s.cards = [...(s.cards ?? []), ...e.questions];
      continue;
    }
    if (e.type === 'plan.answer') {
      const done = new Set(e.answers.map((a) => a.question));
      s.pending = s.pending.filter((x) => !done.has(x.id));
      s.answers = [...s.answers, ...e.answers];
      continue;
    }
    if (e.type === 'plan.ready') {
      s.planning = false;
      s.plan = e.plan;
      continue;
    }
    if (e.type === 'plan.edit') {
      // copy, never mutate: the plan object is the stored plan.ready event's
      const a = s.plan?.assignments[e.assignment];
      if (s.plan && a) s.plan = { ...s.plan, assignments: s.plan.assignments.map((x, i) => (i === e.assignment ? { ...a, bot: e.to, swapped: true as const, ...(e.mode ? { mode: e.mode } : {}) } : x)) };
      continue;
    }
    if (e.type === 'team.mode') {
      s.mode = e.mode;
      continue;
    }
    if (e.type === 'user.ask') {
      const question = { ...e.question, from: e.question.from ?? e.node };
      // absent means waiting (the engine always writes it): the card is pending and its step awaits, never one without the other
      const wait = e.wait !== false;
      // an ask answered at once by Maestro never shows as a pending card
      if (wait) s.pending = [...s.pending, question];
      s.cards = [...(s.cards ?? []), question];
      (s.userAsks ??= []).push({ node: e.node, question, wait });
      const ns = s.nodes[e.node];
      if (wait && ns && ns.status === 'running') ns.status = 'awaiting';
      continue;
    }
    if (e.type === 'user.answer') {
      s.pending = s.pending.filter((x) => x.id !== e.question);
      const a = s.userAsks?.find((x) => x.question.id === e.question && !x.answer);
      if (a) a.answer = e.answer;
      const asker = a ? s.nodes[a.node] : undefined;
      if (asker?.status === 'awaiting') asker.answeredWhileWaiting = true;
      continue;
    }
    // own keys only: an id like "__proto__" or "constructor" in a persisted event must never resolve to a prototype member
    const n = 'node' in e && e.node && Object.hasOwn(s.nodes, e.node) ? s.nodes[e.node] : undefined;
    switch (e.type) {
      case 'run.resumed':
        s.status = 'running';
        s.finishedAt = undefined;
        s.error = undefined;
        // a team run stopped before its plan existed plans again
        if (s.kind === 'team' && !s.pipeline.nodes.length && !s.plan) s.planning = true;
        for (const ns of Object.values(s.nodes)) {
          if (ns.status === 'running') ns.status = 'queued';
          else if (e.retryFailed && (ns.status === 'error' || ns.status === 'skipped')) {
            ns.status = 'queued';
            ns.error = undefined;
            ns.loops = 0;
          }
        }
        break;
      case 'setup.result':
        s.setupDone = e.ok;
        s.setupArtifacts = e.artifacts ?? [];
        break;
      case 'node.started':
        if (n) {
          n.resumedWithAnswer = n.answeredWhileWaiting || undefined;
          n.answeredWhileWaiting = undefined;
          n.status = 'running';
          n.attempts = e.attempt;
          n.startedAt = ts;
          n.harness = e.harness;
          n.live = '';
          n.error = undefined;
        }
        break;
      case 'node.session':
        if (n) n.sessionId = e.sessionId;
        break;
      case 'node.chunk':
        if (n) n.live = ((n.live ?? '') + e.text).slice(-LIVE_TAIL);
        break;
      case 'node.finished':
        if (n) {
          n.status = e.status === 'done' && e.verdict !== 'FAIL' ? 'done' : 'error';
          n.output = e.output;
          n.error = e.error ?? (e.verdict === 'FAIL' ? 'reviewer verdict: FAIL' : undefined);
          n.finishedAt = ts;
          n.commit = e.commit ?? n.commit;
          n.sessionId = e.sessionId ?? n.sessionId;
          n.verdict = e.verdict;
          n.costUsd += e.costUsd ?? 0;
          s.costUsd += e.costUsd ?? 0;
          n.live = undefined;
        }
        if (e.budget) s.budgetStop = true;
        break;
      case 'node.skipped':
        if (n) {
          n.status = 'skipped';
          n.error = e.reason;
        }
        break;
      case 'gate.result':
        if (n) n.gate = { ok: e.ok, exitCode: e.exitCode, output: e.output };
        break;
      case 'loop': {
        const c = s.nodes[e.check];
        if (c) {
          c.loops = e.n;
          c.status = 'running';
        }
        break;
      }
      case 'approval.requested':
        if (n) {
          n.status = 'awaiting';
          n.startedAt = ts;
        }
        break;
      case 'approval.resolved':
        if (n) {
          n.status = e.approved ? 'done' : 'error';
          n.output = e.approved ? 'approved' : 'rejected';
          n.error = e.approved ? undefined : 'rejected by reviewer';
          n.finishedAt = ts;
        }
        break;
      case 'node.amended':
        s.pipeline = { ...s.pipeline, nodes: s.pipeline.nodes.map((x) => (x.id === e.node ? { ...x, agent: e.agent ?? x.agent, model: e.agent || e.model ? e.model : x.model, ...(e.guidance ? { guidance: [x.guidance, e.guidance].filter(Boolean).join('\n').slice(-2000) } : {}) } : x)) };
        break;
      case 'manager.cost':
        if (n) n.costUsd += e.costUsd;
        s.costUsd += e.costUsd;
        break;
      case 'node.requeued':
        if (n) {
          n.status = 'queued';
          n.error = undefined;
        }
        break;
      case 'feedback':
        if (n) n.feedback = { rating: e.rating, ...(e.note ? { note: e.note } : {}) };
        break;
      case 'consult':
        (s.talk ??= []).push({ from: e.from, to: e.to, question: e.question, answer: e.answer, round: e.round, ts });
        break;
      case 'handoff':
        // the child step's own node.finished already records its cost
        (s.talk ??= []).push({ from: e.from, to: e.to, question: e.goal, answer: e.answer, round: e.round, ts });
        break;
      case 'supervisor.action':
        s.actions.push({ round: e.round, action: e.action, node: e.node, detail: e.detail, ts });
        break;
      case 'run.coach':
        s.coach = e.findings;
        break;
      case 'vault.note':
        if (!s.notes.includes(e.path)) s.notes.push(e.path);
        break;
      case 'run.finished':
        if (e.budget) s.budgetStop = true;
        s.status = e.status;
        s.error = e.error;
        s.finishedAt = ts;
        // a run that is over (stopped, failed, done) has no open cards: drop them, and let a step that waited on one run again if the run is resumed
        if (e.status !== 'paused') {
          if (s.userAsks?.some((a) => !a.answer)) {
            for (const a of s.userAsks) if (!a.answer && s.nodes[a.node]?.status === 'awaiting') s.nodes[a.node]!.status = 'queued';
            s.userAsks = s.userAsks.filter((a) => a.answer);
          }
          // planning cards nobody answered: gone, and their round counts as not asked, so a resume asks it again
          const dropped = new Set(s.pending.map((q) => q.id));
          if (s.kind === 'team' && s.planning && dropped.size) {
            s.cards = (s.cards ?? []).filter((q) => !dropped.has(q.id));
            s.round = Math.max(0, s.round - 1);
          }
          s.pending = [];
          s.planning = false;
        }
        break;
    }
  }
  return s;
}

// ---------- adapter contract ----------

export interface AgentRequest {
  runId: string;
  nodeId: string;
  prompt: string;
  cwd: string;
  model?: string;
  readOnly: boolean;
  permissionMode?: string;
  attempt: number;
  timeoutMs: number;
  /** Remaining budget in USD, if the run has a cap. */
  budgetUsd?: number;
  /** Resume this vendor session instead of starting fresh (if the adapter supports it). */
  resumeSessionId?: string;
  signal: AbortSignal;
  mock?: MockScript;
  verdictNode?: boolean;
  onChunk(text: string): void;
  onSession(id: string): void;
}

export interface AgentResult {
  output: string;
  exitCode: number;
  costUsd?: number;
  sessionId?: string;
  error?: string;
}

export interface AgentAdapter {
  id: string;
  /** True if the underlying CLI is installed and runnable. */
  detect(): Promise<{ ok: boolean; version?: string; detail?: string }>;
  run(req: AgentRequest): Promise<AgentResult>;
  /** Does this adapter report USD cost (so spend caps are enforceable)? */
  reportsCost: boolean;
  /** Does it stop a call at the request's budgetUsd? Probe replays only use adapters that do. */
  enforcesBudget?: boolean;
  supportsResume: boolean;
  /** Models this adapter can offer for `--model` (best effort; empty when unknown). */
  listModels?(): Promise<string[]>;
  /** Command that reopens this agent's interactive session for a step, run inside the run's worktree. */
  attachCommand?(sessionId?: string): { cmd: string; args: string[] } | undefined;
}
