import { toolChunk } from '../activity.js';
import { runProcess } from '../proc.js';
import type { AgentAdapter, AgentRequest, AgentResult } from '../types.js';
import { detectBin } from './cli.js';

/** Parse one line of `claude -p --output-format stream-json --verbose`. Exported for tests. */
export function parseClaudeLine(
  line: string,
  acc: { text: string; result?: string; costUsd?: number; sessionId?: string; isError?: boolean },
  onChunk: (t: string) => void,
  onSession: (id: string) => void,
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
  if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
    for (const b of o.message.content) {
      if (b?.type === 'text' && typeof b.text === 'string') {
        acc.text += b.text + '\n';
        onChunk(b.text + '\n');
      } else if (b?.type === 'tool_use') {
        onChunk(toolChunk(String(b.name ?? 'tool'), b.input));
      }
    }
  } else if (o.type === 'result') {
    if (typeof o.result === 'string') acc.result = o.result;
    const cost = o.total_cost_usd ?? o.cost_usd;
    if (typeof cost === 'number') acc.costUsd = cost;
    if (o.is_error === true || (typeof o.subtype === 'string' && o.subtype.startsWith('error'))) acc.isError = true;
  }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly reportsCost = true;
  /** `--max-budget-usd` stops a call at the request's budget (checked between turns, so it can run slightly over). */
  readonly enforcesBudget = true;
  readonly supportsResume = true;

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
    ];
    const acc: Parameters<typeof parseClaudeLine>[1] = { text: '' };
    const r = await runProcess({
      cmd: 'claude',
      args,
      cwd: req.cwd,
      stdin: req.prompt, // via stdin: no argv size limit, and the prompt stays out of `ps`
      signal: req.signal,
      onStdoutLine: (l) => parseClaudeLine(l, acc, req.onChunk, req.onSession),
    });
    if (r.spawnError) return { output: '', exitCode: 127, error: `claude: ${r.spawnError}` };
    const exitCode = r.aborted ? 130 : acc.isError ? 1 : (r.code ?? 1);
    const output = (acc.result ?? acc.text).trim();
    return {
      output,
      exitCode,
      costUsd: acc.costUsd,
      sessionId: acc.sessionId,
      error: exitCode === 0 ? undefined : acc.isError ? output.slice(-2000) : r.stderr.trim().slice(-2000) || `claude exited with ${exitCode}`,
    };
  }
}
