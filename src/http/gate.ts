/** A gate step that runs a saved request (read from the run's worktree) instead of a shell command. */
import type { RunState } from '../types.js';
import { getWorkspace } from '../workspace.js';
import { passed } from './assert.js';
import { describeCheckResult, describeResult } from './describe.js';
import { HttpClientError } from './errors.js';
import type { Db } from './history.js';
import { runRequest } from './index.js';
import { MAX_REPEAT, type HttpGate, type SendOutput } from './types.js';

export { MAX_REPEAT };
const BODY_HEAD = 2048;

export async function runHttpGate(o: { home: string; db: Db; state: Pick<RunState, 'workdir' | 'workspace'>; gate: HttpGate; runId: string; signal: AbortSignal }): Promise<{ ok: boolean; output: string }> {
  const wsId = o.state.workspace?.id && o.state.workspace.id !== 'local' ? o.state.workspace.id : undefined;
  // requests come from the worktree (the code's own saved requests at this commit); environments and secrets from the workspace
  const envDir = (wsId && getWorkspace(o.home, wsId)?.path) || o.state.workdir;
  const repeat = Math.min(MAX_REPEAT, Math.max(1, Math.trunc(o.gate.repeat ?? 1)));
  const expect = o.gate.expect ?? 'all';
  const sends: SendOutput[] = [];
  try {
    for (let n = 0; n < repeat && !o.signal.aborted; n++) {
      const out = await runRequest({ home: o.home, db: o.db, workspace: wsId ?? 'default', dir: o.state.workdir, envDir, id: o.gate.run, env: o.gate.env, source: 'gate', runId: o.runId, allowSecrets: true, signal: o.signal });
      sends.push(out);
      if (expect === 'all' && !passed(out.result, out.checks)) break; // the first failing send decides
    }
  } catch (e) {
    if (e instanceof HttpClientError) return { ok: false, output: `request gate ${o.gate.run}: ${e.message}` };
    throw e;
  }
  const last = sends.at(-1);
  const ok = !!last && (expect === 'last' ? passed(last.result, last.checks) : sends.length === repeat && sends.every((s) => passed(s.result, s.checks)));
  return { ok, output: gateSummary(o.gate, sends, ok, repeat) };
}

/**
 * What the run log and the fix node see: the verdict, the send line from describeResult (method, URL, status, time),
 * each failed check with its actual value, and the response body head. The sends are already redacted.
 */
export function gateSummary(g: HttpGate, sends: SendOutput[], ok: boolean, repeat: number): string {
  const last = sends.at(-1);
  if (!last) return `request gate ${g.run}: nothing was sent`;
  const lines = [`${ok ? 'PASS' : 'FAIL'} request ${g.run}${repeat > 1 ? ` (send ${sends.length} of ${repeat}, expect ${g.expect ?? 'all'})` : ''}`, describeResult(last.request, last.result, last.checks)];
  const failed = last.checks.filter((c) => !c.ok);
  if (failed.length) lines.push('failed checks:', ...failed.map((c) => `- ${describeCheckResult(c)}`));
  if (last.result.body) lines.push(`response body (first 2 KB):`, last.result.body.slice(0, BODY_HEAD));
  return lines.join('\n');
}
