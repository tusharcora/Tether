import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { AgentAdapter, AgentRequest, AgentResult } from '../types.js';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), res()), { once: true });
  });

/** Deterministic, scriptable agent. Lets the whole engine be exercised without spending tokens. */
export class MockAdapter implements AgentAdapter {
  readonly id = 'mock';
  readonly reportsCost = true;
  readonly supportsResume = false;
  /** Every request the adapter has served, for assertions. */
  readonly calls: { nodeId: string; attempt: number; prompt: string; readOnly: boolean }[] = [];

  async detect() {
    return { ok: true, version: 'mock' };
  }

  async run(req: AgentRequest): Promise<AgentResult> {
    this.calls.push({ nodeId: req.nodeId, attempt: req.attempt, prompt: req.prompt, readOnly: req.readOnly });
    const m = req.mock ?? {};
    if (m.delayMs) await sleep(m.delayMs, req.signal);
    if (req.signal.aborted) return { output: '', exitCode: 130, error: 'aborted' };
    if (m.failFirst && req.attempt <= m.failFirst) {
      return { output: '', exitCode: 1, error: `mock failure (attempt ${req.attempt})` };
    }
    if (m.writeFile && req.attempt >= (m.writeFileFromAttempt ?? 1)) {
      const target = resolve(req.cwd, m.writeFile.path);
      if (!target.startsWith(resolve(req.cwd) + sep)) return { output: '', exitCode: 1, error: 'mock: path escapes cwd' };
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, m.writeFile.content);
    }
    let out = m.echoPrompt ? req.prompt : (m.output ?? `mock output from ${req.nodeId}`);
    req.onChunk(out + '\n');
    if (req.verdictNode) {
      const vs = m.verdicts ?? ['PASS'];
      const v = vs[Math.min(req.attempt - 1, vs.length - 1)];
      out += `\nVERDICT: ${v}`;
    }
    return { output: out, exitCode: 0, costUsd: m.costUsd ?? 0, sessionId: `mock-${req.nodeId}-${req.attempt}` };
  }
}
