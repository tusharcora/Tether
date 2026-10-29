import { toolChunk } from '../activity.js';
import { claudeCodeModeArgs } from '../codemode/delivery.js';
import { runProcess } from '../proc.js';
import type { AgentAdapter, AgentRequest, AgentResult, AgentUsage } from '../types.js';
import { detectBin } from './cli.js';

/** Parse one line of `claude -p --output-format stream-json --verbose`. Exported for tests. */
export function parseClaudeLine(
  line: string,
  acc: { text: string; result?: string; costUsd?: number; sessionId?: string; isError?: boolean; usage?: AgentUsage; toolCalls?: number; tools?: string[] },
  onChunk: (t: string) => void,
  onSession: (id: string) => void,
  onDelta?: (t: string) => void,
): void {
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return; // not JSON (warnings etc.)
  }
  if (!o || typeof o !== 'object') return;
  if (typeof o.session_id === 'string' && !acc.sessionId) {
    acc.sessionId = o.session_id;
    onSession(o.session_id);
  }
  if (o.type === 'stream_event') {
    const d = o.event?.type === 'content_block_delta' ? o.event.delta : undefined;
    if (onDelta && d?.type === 'text_delta' && typeof d.text === 'string') onDelta(d.text);
    return;
  }
  if (o.type === 'system' && o.subtype === 'init' && Array.isArray(o.tools)) {
    const tools: string[] = o.tools.filter((t: unknown): t is string => typeof t === 'string');
    acc.tools = tools;
    // which MCP tools the agent was given: with Code Mode, exactly Tether's run_code
    const mcp = tools.filter((t) => t.startsWith('mcp__'));
    if (mcp.length) onChunk(`[code mode] MCP tools: ${mcp.join(', ')}\n`);
  } else if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
    const u = o.message.usage;
    if (u && typeof u === 'object' && acc.usage?.promptTokens === undefined) {
      const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
      acc.usage = { ...acc.usage, promptTokens: n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens') };
    }
    for (const b of o.message.content) {
      if (b?.type === 'text' && typeof b.text === 'string') {
        acc.text += b.text + '\n';
        onChunk(b.text + '\n');
      } else if (b?.type === 'tool_use') {
        acc.toolCalls = (acc.toolCalls ?? 0) + 1;
        onChunk(toolChunk(String(b.name ?? 'tool'), b.input));
      }
    }
  } else if (o.type === 'result') {
    if (typeof o.result === 'string') acc.result = o.result;
    const cost = o.total_cost_usd ?? o.cost_usd;
    if (typeof cost === 'number') acc.costUsd = cost;
    const u = o.usage;
    if (u && typeof u === 'object') {
      const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
      acc.usage = { inputTokens: n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens'), outputTokens: n('output_tokens'), ...(typeof o.num_turns === 'number' ? { turns: o.num_turns } : {}), ...(acc.usage?.promptTokens !== undefined ? { promptTokens: acc.usage.promptTokens } : {}) };
    }
    if (o.is_error === true || (typeof o.subtype === 'string' && o.subtype.startsWith('error'))) acc.isError = true;
  }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly reportsCost = true;
  /** `--max-budget-usd` stops a call at the request's budget (checked between turns, so it can run slightly over). */
  readonly enforcesBudget = true;
  readonly supportsResume = true;
  /** run_code over a per-run MCP config (--mcp-config + --strict-mcp-config); its own Read/Edit/Bash stay. */
  readonly codeMode = 'mcp' as const;

  detect() {
    return detectBin('claude');
  }

  attachCommand(sessionId?: string) {
    return sessionId ? { cmd: 'claude', args: ['--resume', sessionId] } : undefined;
  }

  /** Aliases the CLI resolves to the current model of each tier; a full model id also works. */
  async listModels() {
    return ['opus', 'sonnet', 'haiku'];
  }

  async run(req: AgentRequest): Promise<AgentResult> {
    const mode = req.permissionMode ?? (req.readOnly ? 'plan' : 'acceptEdits');
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      mode,
      ...(req.model ? ['--model', req.model] : []),
      ...(req.budgetUsd !== undefined && req.budgetUsd > 0 ? ['--max-budget-usd', req.budgetUsd.toFixed(4)] : []),
      ...(req.resumeSessionId ? ['--resume', req.resumeSessionId] : []),
      ...(req.onDelta ? ['--include-partial-messages'] : []),
      ...(req.lean ? ['--setting-sources', 'project', '--disable-slash-commands'] : []),
      ...(req.codeMode ? claudeCodeModeArgs(req.codeMode) : []),
    ];
    const acc: Parameters<typeof parseClaudeLine>[1] = { text: '' };
    const r = await runProcess({
      cmd: 'claude',
      args,
      cwd: req.cwd,
      stdin: req.prompt, // via stdin: no argv size limit, and the prompt stays out of `ps`
      signal: req.signal,
      onStdoutLine: (l) => parseClaudeLine(l, acc, req.onChunk, req.onSession, req.onDelta),
    });
    if (r.spawnError) return { output: '', exitCode: 127, error: `claude: ${r.spawnError}` };
    const exitCode = r.aborted ? 130 : acc.isError ? 1 : (r.code ?? 1);
    const output = (acc.result ?? acc.text).trim();
    return {
      output,
      exitCode,
      costUsd: acc.costUsd,
      sessionId: acc.sessionId,
      usage: { ...acc.usage, toolCalls: acc.toolCalls ?? 0 },
      error: exitCode === 0 ? undefined : acc.isError ? output.slice(-2000) : r.stderr.trim().slice(-2000) || `claude exited with ${exitCode}`,
    };
  }
}
