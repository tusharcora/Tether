/**
 * Code Mode around one agent step, for the engine: which tool style the step runs with (its own, else its bot's, else
 * `code`), the session and, for MCP agents, the per-run MCP server; what each call adds to the step's answer (questions,
 * approvals, hand-offs as the lines the engine already understands); and the step's metrics.
 */
import { CREW } from '../bots.js';
import type { Store } from '../store.js';
import type { AgentAdapter, AgentResult, CodeModeRequest, PipelineNode, RunState, ToolStyle } from '../types.js';
import type { Vault } from '../vault.js';
import type { CodeModeHost } from './host.js';
import { loadMcpServers } from './mcpServers.js';
import { CODE_MODE_NOTE } from './prompt.js';
import { CodeSession, grantsFrom } from './session.js';

export interface StepCodeMode {
  toolStyle: ToolStyle;
  /** Code Mode was wanted but this agent has no route for it: the step runs direct. */
  fallback: boolean;
  request?: CodeModeRequest;
  /** Adds the call's usage to the step's and the session's follow-up lines to its answer. */
  record(r: AgentResult): AgentResult;
  /** The `node.metrics` event, when there is anything to report. */
  metrics(node: string): { type: 'node.metrics'; node: string; toolStyle: ToolStyle; fallback?: boolean; roundTrips?: number; runCode: number; connectorCalls: number; inputTokens?: number; outputTokens?: number } | undefined;
  close(): Promise<void>;
}

/** An approval step before this one (by the pipeline's edges) said yes. */
export function approvedUpstream(state: RunState, nodeId: string): boolean {
  const seen = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of state.pipeline.edges.filter((x) => x.to === id && !seen.has(x.from))) {
      seen.add(e.from);
      const n = state.pipeline.nodes.find((x) => x.id === e.from);
      if (n?.kind === 'approval' && state.nodes[n.id]?.status === 'done') return true;
      queue.push(e.from);
    }
  }
  return false;
}

export async function openStepCodeMode(o: { host: CodeModeHost; adapter: AgentAdapter; node: PipelineNode; state: RunState; home: string; store: Store; vault?: Vault; onNote: (text: string) => void }): Promise<StepCodeMode> {
  const { node, state, adapter } = o;
  const wanted: ToolStyle = node.toolStyle ?? 'code';
  const usage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, reported: false };
  const record = (r: AgentResult) => {
    if (r.usage) {
      usage.reported = true;
      usage.inputTokens += r.usage.inputTokens ?? 0;
      usage.outputTokens += r.usage.outputTokens ?? 0;
      usage.toolCalls += r.usage.toolCalls ?? 0;
    }
    return r;
  };
  const tokens = () => (usage.reported ? { roundTrips: usage.toolCalls, ...(usage.inputTokens ? { inputTokens: usage.inputTokens } : {}), ...(usage.outputTokens ? { outputTokens: usage.outputTokens } : {}) } : {});
  if (wanted === 'direct' || !adapter.codeMode) {
    const fallback = wanted === 'code';
    return {
      toolStyle: 'direct',
      fallback,
      record,
      // a fallback with nothing measured says nothing (the Crew card explains it)
      metrics: (n) => (usage.reported ? { type: 'node.metrics', node: n, toolStyle: 'direct', ...(fallback ? { fallback } : {}), runCode: 0, connectorCalls: 0, ...tokens() } : undefined),
      close: async () => {},
    };
  }
  const bot = CREW[node.role ?? '']?.name ?? node.role ?? node.id;
  const session = new CodeSession(
    {
      home: o.home,
      runId: state.id,
      nodeId: node.id,
      bot,
      workdir: state.workdir,
      writable: !node.readOnly,
      base: state.baseSha,
      kind: state.kind === 'team' ? 'team' : 'workflow',
      approved: !!state.autoApprove || approvedUpstream(state, node.id),
      grants: grantsFrom(state.userAsks, node.id, bot),
      handoff: (state.pipeline.settings.handoff ?? 0) > 0 && !node.manager,
      workspace: state.workspace?.id && state.workspace.id !== 'local' ? state.workspace.id : undefined,
    },
    { store: o.store, vault: o.vault, db: o.store.raw(), mcpServers: loadMcpServers(o.home), onNote: o.onNote },
  );
  const opened = adapter.codeMode === 'mcp' ? await o.host.open(session) : undefined;
  return {
    toolStyle: 'code',
    fallback: false,
    request: { runner: session, note: CODE_MODE_NOTE, ...(opened ? { mcp: opened.launch } : {}), ...(node.codeReads ? { readsOnly: true } : {}) },
    record: (r) => {
      record(r);
      const extra = session.followUps();
      session.asks.length = 0;
      session.approvals.length = 0;
      session.hands.length = 0;
      return extra ? { ...r, output: `${r.output.trimEnd()}\n${extra}` } : r;
    },
    metrics: (n) => ({ type: 'node.metrics', node: n, toolStyle: 'code', runCode: session.metrics.runCode, connectorCalls: session.metrics.connectorCalls, ...tokens() }),
    close: async () => {
      opened?.close();
      await session.close();
    },
  };
}
