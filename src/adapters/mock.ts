import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { AgentAdapter, AgentRequest, AgentResult } from '../types.js';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res) => {
    // a signal aborted before the call began never fires 'abort' again
    if (signal.aborted) return res();
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), res()), { once: true });
  });

/** Deterministic, scriptable agent. Lets the whole engine be exercised without spending tokens. */
export class MockAdapter implements AgentAdapter {
  readonly id = 'mock';
  readonly reportsCost = true;
  /** Treated as budget-enforcing so probes can be tested; it reports whatever cost its script says. */
  readonly enforcesBudget = true;
  /** Off by default; `new MockAdapter({ resume: true })` reports a session for every agent call and accepts it back, like Claude. */
  readonly supportsResume: boolean;
  /** Every request the adapter has served, for assertions. */
  readonly calls: { nodeId: string; attempt: number; prompt: string; readOnly: boolean; resumeSessionId?: string; budgetUsd?: number }[] = [];

  constructor(o: { resume?: boolean } = {}) {
    this.supportsResume = !!o.resume;
  }

  async detect() {
    return { ok: true, version: 'mock' };
  }

  async run(req: AgentRequest): Promise<AgentResult> {
    this.calls.push({ nodeId: req.nodeId, attempt: req.attempt, prompt: req.prompt, readOnly: req.readOnly, ...(req.resumeSessionId ? { resumeSessionId: req.resumeSessionId } : {}), ...(req.budgetUsd !== undefined ? { budgetUsd: req.budgetUsd } : {}) });
    let m = req.mock ?? {};
    const when = m.whenPrompt?.find((w) => req.prompt.includes(w.includes));
    if (when) m = { ...m, ...when.then };
    if (m.delayMs) await sleep(m.delayMs, req.signal);
    if (req.signal.aborted) return { output: '', exitCode: 130, error: 'aborted' };
    if (m.failFirst && req.attempt <= m.failFirst) {
      return { output: '', exitCode: 1, error: `mock failure (attempt ${req.attempt})`, ...(m.costUsd !== undefined && !m.noCost ? { costUsd: m.costUsd } : {}) };
    }
    if (m.writeFile && req.attempt >= (m.writeFileFromAttempt ?? 1)) {
      const target = resolve(req.cwd, m.writeFile.path);
      if (!target.startsWith(resolve(req.cwd) + sep)) return { output: '', exitCode: 1, error: 'mock: path escapes cwd' };
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, m.writeFile.content);
    }
    if (m.proposal !== undefined) {
      const out = typeof m.proposal === 'string' ? m.proposal : '```json\n' + JSON.stringify(m.proposal) + '\n```';
      req.onChunk(out + '\n');
      return { output: out, exitCode: 0, costUsd: m.costUsd ?? 0 };
    }
    const planRound = /^plan\.(\d+)$/.exec(req.nodeId)?.[1];
    if (planRound && (m.questions || m.plan)) {
      const n = Number(planRound);
      const entry = m.questions?.[n - 1];
      const out = entry !== undefined ? (typeof entry === 'string' ? entry : JSON.stringify({ questions: entry })) : typeof m.plan === 'string' ? m.plan : JSON.stringify({ plan: m.plan ?? {} });
      req.onChunk(out + '\n');
      return { output: out, exitCode: 0, costUsd: m.costUsd ?? 0 };
    }
    // a resumable session: one per step, announced as soon as the call starts (a step that pauses still has it)
    const sessionId = this.supportsResume ? (req.resumeSessionId ?? `mock-${req.nodeId}`) : `mock-${req.nodeId}-${req.attempt}`;
    if (this.supportsResume) req.onSession(sessionId);
    const phase = /\.([^.]+)$/.exec(req.nodeId)?.[1];
    const scripted = phase ? m.replies?.[phase] : undefined;
    let out = scripted?.length
      ? scripted[Math.min(req.attempt - 1, scripted.length - 1)]!
      : m.echoPrompt ? req.prompt : (m.output ?? `mock output from ${req.nodeId}`);
    req.onChunk(out + '\n');
    if (req.verdictNode) {
      const vs = m.verdicts ?? ['PASS'];
      const v = vs[Math.min(req.attempt - 1, vs.length - 1)];
      out += `\nVERDICT: ${v}`;
    }
    return { output: out, exitCode: 0, ...(m.noCost ? {} : { costUsd: m.costUsd ?? 0 }), sessionId };
  }
}
