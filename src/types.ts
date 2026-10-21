// Shared types. The pipeline file is the visual builder's document; RunEvent is the
// append-only log every run is rebuilt from (that is what makes runs resumable).

export type Mode = 'pipeline' | 'swarm' | 'orchestration';
/** Modes the engine has a scheduler for. Others are refused in preflight AND in the engine. */
export const SUPPORTED_MODES: Mode[] = ['pipeline'];

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
  delayMs?: number;
  costUsd?: number;
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
  /** For gates and verdict nodes: re-run this upstream agent node with the failure output. */
  fixNode?: string;
  /** Max fix loops for this check (default 2). */
  maxLoops?: number;
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
    }
  | { type: 'run.resumed'; retryFailed?: boolean }
  | { type: 'setup.result'; ok: boolean; output: string; durationMs: number; artifacts?: string[] }
  | { type: 'node.started'; node: string; attempt: number }
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
    }
  | { type: 'node.skipped'; node: string; reason: string }
  | { type: 'gate.result'; node: string; ok: boolean; exitCode: number | null; output: string; durationMs: number }
  | { type: 'loop'; check: string; fixNode: string; n: number }
  | { type: 'consult'; from: string; to: string; question: string; answer: string; round: number; costUsd?: number }
  | { type: 'approval.requested'; node: string }
  | { type: 'approval.resolved'; node: string; approved: boolean; by?: string }
  /** A step was re-pointed at a different agent/model (by the supervisor or a person). The run records exactly what ran. */
  | { type: 'node.amended'; node: string; agent?: string; model?: string; reason: string }
  | { type: 'supervisor.action'; round: number; action: 'retry' | 'escalate' | 'stop'; node?: string; detail: string }
  | { type: 'run.coach'; findings: CoachFinding[] }
  | { type: 'vault.note'; path: string }
  | { type: 'run.finished'; status: RunStatus; error?: string };

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
  autoApprove: boolean;
  setupDone: boolean;
  /** Paths the setup command left in the worktree; kept out of agent commits and diffs. */
  setupArtifacts: string[];
  nodes: Record<string, NodeState>;
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
        autoApprove: !!e.autoApprove,
        setupDone: false,
        setupArtifacts: [],
        nodes: Object.fromEntries(
          e.pipeline.nodes.map((n) => [n.id, { status: 'queued', attempts: 0, costUsd: 0, loops: 0 } as NodeState]),
        ),
        costUsd: 0,
        startedAt: ts,
        notes: [],
        actions: [],
      };
      continue;
    }
    if (!s) continue;
    const n = 'node' in e && e.node ? s.nodes[e.node] : undefined;
    switch (e.type) {
      case 'run.resumed':
        s.status = 'running';
        s.finishedAt = undefined;
        s.error = undefined;
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
          n.status = 'running';
          n.attempts = e.attempt;
          n.startedAt = ts;
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
        s.pipeline = { ...s.pipeline, nodes: s.pipeline.nodes.map((x) => (x.id === e.node ? { ...x, agent: e.agent ?? x.agent, model: e.model } : x)) };
        break;
      case 'consult':
        (s.talk ??= []).push({ from: e.from, to: e.to, question: e.question, answer: e.answer, round: e.round, ts });
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
        s.status = e.status;
        s.error = e.error;
        s.finishedAt = ts;
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
  supportsResume: boolean;
  /** Models this adapter can offer for `--model` (best effort; empty when unknown). */
  listModels?(): Promise<string[]>;
  /** Command that reopens this agent's interactive session for a step, run inside the run's worktree. */
  attachCommand?(sessionId?: string): { cmd: string; args: string[] } | undefined;
}
