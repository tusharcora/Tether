/**
 * Maestro inside one run's conversation: explain what went wrong, offer options with a recommended one,
 * and carry out the one the person picks. A model only *proposes* options; every option is an action from a
 * fixed list, validated against the real run before it is shown, and only executed on a person's say-so.
 */
import type { AdapterRegistry } from './adapters/index.js';
import type { Bindings } from './bindings.js';
import { extractJson } from './composer.js';
import { culprit, DEFAULT_ESCALATION, failureBrief } from './supervisor.js';
import type { Engine } from './engine.js';
import type { Choice, RunAction, Turn } from './sessions.js';
import type { NodeState, RunState } from './types.js';

export interface Choices {
  /** What Maestro says: what went wrong, or the answer. */
  text: string;
  options: Choice[];
  /** Index into `options`. */
  recommended: number;
}

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const tail = (t: string | undefined, n: number) => (t ? t.trim().split('\n').slice(-n).join('\n') : '');

/** A key for one failure, so the same failure is explained once. */
export function failureKey(s: RunState): string {
  const failed = Object.entries(s.nodes)
    .filter(([, n]) => n.status === 'error')
    .map(([id, n]) => `${id}:${n.attempts}:${n.loops}`)
    .join(',');
  return `${s.id}|${failed}|${clip(s.error ?? '', 60)}`;
}

/** Everything Maestro needs to talk about this run: the steps, where each stands, and what went wrong. */
export function runDetail(s: RunState): string {
  const lines = [`Run ${s.id} · workflow "${s.pipeline.name}" · status: ${s.status} · cost $${s.costUsd.toFixed(2)}`, `Task: ${clip(s.task.split('\n')[0]!, 240)}`, `Repo: ${s.repo}  ·  worktree: ${s.workdir}  ·  branch: ${s.branch}`, 'Steps:'];
  for (const n of s.pipeline.nodes) {
    const ns: NodeState | undefined = s.nodes[n.id];
    const who = n.kind === 'agent' ? `${n.agent ?? 'claude'}${n.model ? '/' + n.model : ''}` : n.kind;
    lines.push(`- ${n.id} (${n.role ?? n.kind}, ${who}): ${ns?.status ?? 'queued'}${ns?.attempts ? `, ${ns.attempts} attempt${ns.attempts === 1 ? '' : 's'}` : ''}${n.guidance ? ', has guidance' : ''}${ns?.error ? `, error: ${clip(ns.error.split('\n')[0]!, 160)}` : ''}`);
    if (ns?.status === 'error') {
      if (ns.gate && !ns.gate.ok) lines.push(`    check output: ${clip(tail(ns.gate.output, 8).replace(/\n/g, ' | '), 500)}`);
      else if (ns.output) lines.push(`    last output: ${clip(tail(ns.output, 6).replace(/\n/g, ' | '), 400)}`);
    }
  }
  if (s.error) lines.push(`Run error: ${clip(s.error.split('\n')[0]!, 200)}`);
  const acts = s.actions.slice(-3).map((a) => `${a.action}${a.node ? ' ' + a.node : ''}: ${clip(a.detail, 100)}`);
  if (acts.length) lines.push(`Maestro already tried: ${acts.join(' ; ')}`);
  return lines.join('\n');
}

const SCHEMA = (agents: string[]) => `Each option is one of these actions (exactly this JSON, nothing else):
- {"type":"retry"}                                                      run only the failed step(s) again
- {"type":"resume"}                                                     continue a run that stopped before finishing
- {"type":"escalate","node":"<step id>","agent":"<one of: ${agents.join(', ')}>","model":"<model or omit>"}   move an agent step to another model, then retry
- {"type":"guide","node":"<step id>","guidance":"<extra instructions, max 400 chars>"}   give that agent step new direction, then retry
- {"type":"manual","steps":"<what the person should do by hand in the worktree, then ask to retry>"}
- {"type":"stop"}                                                       stop the run
- {"type":"open"}                                                       open the run view
- {"type":"command","command":"<one shell command run in the worktree>"}      e.g. a read-only check; shown to the person, who must allow it`;

const OPTIONS_FORMAT = `Reply with ONLY a JSON object, no prose, no code fences:
{"reply":"your message to the user","command":{"command":"optional one shell command","why":"what it tells us"},"options":[{"label":"short title","detail":"one line on what it does and its trade-off","action":{...}}],"recommended":0}
Give 2 to 4 options, most useful first, and "recommended" is the index of the one you would pick. Only offer actions that make sense for the run's current status.`;

export function parseChoices(raw: unknown, s: RunState, agents: string[]): Choice[] {
  if (!Array.isArray(raw)) return [];
  const out: Choice[] = [];
  const agentNode = (id: unknown) => s.pipeline.nodes.find((n) => n.id === id && n.kind === 'agent');
  for (const r of raw.slice(0, 6)) {
    const o = r as { label?: unknown; detail?: unknown; action?: Record<string, unknown> };
    const a = o?.action;
    if (!a || typeof a.type !== 'string' || typeof o.label !== 'string' || !o.label.trim()) continue;
    let action: RunAction | undefined;
    if (a.type === 'retry' && s.status === 'error') action = { type: 'retry' };
    else if (a.type === 'resume' && s.status !== 'done' && s.status !== 'error') action = { type: 'resume' };
    else if (a.type === 'escalate' && agentNode(a.node) && typeof a.agent === 'string' && agents.includes(a.agent) && s.status === 'error') action = { type: 'escalate', node: String(a.node), agent: a.agent, ...(typeof a.model === 'string' && a.model ? { model: a.model.slice(0, 80) } : {}) };
    else if (a.type === 'guide' && agentNode(a.node) && typeof a.guidance === 'string' && a.guidance.trim() && s.status === 'error') action = { type: 'guide', node: String(a.node), guidance: a.guidance.trim().slice(0, 400) };
    else if (a.type === 'manual' && typeof a.steps === 'string' && a.steps.trim()) action = { type: 'manual', steps: a.steps.trim().slice(0, 400) };
    else if (a.type === 'stop' && (s.status === 'running' || s.status === 'paused')) action = { type: 'stop' };
    else if (a.type === 'open') action = { type: 'open' };
    else if (a.type === 'command' && typeof a.command === 'string' && a.command.trim()) action = { type: 'command', command: a.command.trim().slice(0, 600) };
    if (action) out.push({ label: clip(o.label.trim(), 70), ...(typeof o.detail === 'string' && o.detail.trim() ? { detail: clip(o.detail.trim(), 200) } : {}), action });
  }
  return out.slice(0, 4);
}

/** Rule-based options for a failed run, used when no model is available to think about it. */
export function fallbackChoices(s: RunState, escalate: { agent: string; model?: string } = DEFAULT_ESCALATION): Choices {
  const failed = Object.entries(s.nodes).filter(([, n]) => n.status === 'error').map(([id]) => id);
  const c = culprit(s);
  const options: Choice[] = [{ label: 'Retry the failed step', detail: `run ${failed.join(', ') || 'it'} again; nothing already done is repeated`, action: { type: 'retry' } }];
  if (c && !((c.agent ?? 'claude') === escalate.agent && (c.model ?? '') === (escalate.model ?? ''))) {
    options.push({ label: `Try ${c.id} on ${escalate.agent}${escalate.model ? ' · ' + escalate.model : ''}`, detail: 'a stronger model for the step that keeps failing, then retry', action: { type: 'escalate', node: c.id, agent: escalate.agent, ...(escalate.model ? { model: escalate.model } : {}) } });
  }
  options.push({ label: 'Open the run', detail: 'look at the step output and the worktree yourself', action: { type: 'open' } });
  const brief = failureBrief(s).split('\n').slice(1).join(' ');
  return { text: `The run failed. ${clip(brief || 'No step reported a reason.', 320)}`, options, recommended: 0 };
}

async function ask(prompt: string, o: { registry: AdapterRegistry; agent?: string; model?: string; cwd: string; signal?: AbortSignal; timeoutMs?: number }): Promise<unknown> {
  const agent = o.agent ?? 'claude';
  if (!o.registry.has(agent)) throw new Error(`agent "${agent}" is not set up`);
  let text = '';
  const res = await o.registry.get(agent).run({ runId: 'maestro', nodeId: 'run-chat', prompt, cwd: o.cwd, model: o.model, readOnly: true, attempt: 1, timeoutMs: o.timeoutMs ?? 120_000, signal: o.signal ?? new AbortController().signal, onChunk: (t) => (text += t), onSession: () => {} });
  if (res.exitCode !== 0 || res.error) throw new Error(res.error ?? `agent exited ${res.exitCode}`);
  return extractJson(res.output || text);
}

export interface RunChatOpts {
  registry: AdapterRegistry;
  agent?: string;
  model?: string;
  escalate?: { agent: string; model?: string };
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Explain a failure and offer ways forward. Never throws: without a model it falls back to rules. */
export async function diagnose(s: RunState, o: RunChatOpts): Promise<Choices> {
  const agents = o.registry.ids().filter((i) => i !== 'mock');
  const prompt = `You are Maestro, supervising a team of coding agents. This run failed. Work out what went wrong and what the person can do about it. Do NOT modify any files.

${runDetail(s)}

Short failure brief:
${failureBrief(s)}

${SCHEMA(agents)}

In "reply", say in one to three plain sentences what went wrong and the most likely cause, no jargon. ${OPTIONS_FORMAT}`;
  try {
    const raw = (await ask(prompt, { ...o, cwd: s.repo })) as { reply?: unknown; options?: unknown; recommended?: unknown };
    const options = parseChoices(raw.options, s, agents);
    if (!options.length) throw new Error('no usable options');
    const rec = Number.isInteger(raw.recommended) && (raw.recommended as number) >= 0 && (raw.recommended as number) < options.length ? (raw.recommended as number) : 0;
    return { text: typeof raw.reply === 'string' && raw.reply.trim() ? clip(raw.reply.trim(), 700) : fallbackChoices(s, o.escalate).text, options, recommended: rec };
  } catch {
    return fallbackChoices(s, o.escalate);
  }
}

/** One message from the person inside a run's conversation. */
export async function chatAboutRun(message: string, s: RunState, history: Turn[], o: RunChatOpts): Promise<{ text: string; choices?: Choices; command?: { command: string; why?: string } }> {
  const agents = o.registry.ids().filter((i) => i !== 'mock');
  const hist = history.slice(-6).map((t) => `${t.who === 'you' ? 'User' : 'Maestro'}: ${clip(t.text, 400)}`).join('\n');
  const prompt = `You are Maestro, supervising a team of coding agents, in a conversation about ONE run. Answer the user's message in one to three plain sentences. If they want something changed, or the run needs action, include options. Do NOT modify any files.

${runDetail(s)}

${SCHEMA(agents)}

${hist ? 'Conversation so far:\n' + hist + '\n\n' : ''}User: ${message}

${OPTIONS_FORMAT} Leave "options" empty ([]) when they only asked a question.`;
  try {
    const raw = (await ask(prompt, { ...o, cwd: s.repo })) as { reply?: unknown; options?: unknown; recommended?: unknown; command?: { command?: unknown; why?: unknown } };
    const text = typeof raw.reply === 'string' && raw.reply.trim() ? clip(raw.reply.trim(), 700) : 'Done.';
    const c = raw.command;
    const command = c && typeof c.command === 'string' && c.command.trim() ? { command: c.command.trim().slice(0, 600), ...(typeof c.why === 'string' ? { why: c.why.slice(0, 200) } : {}) } : undefined;
    const options = parseChoices(raw.options, s, agents);
    if (!options.length) return { text, ...(command ? { command } : {}) };
    const rec = Number.isInteger(raw.recommended) && (raw.recommended as number) >= 0 && (raw.recommended as number) < options.length ? (raw.recommended as number) : 0;
    return { text, choices: { text, options, recommended: rec }, ...(command ? { command } : {}) };
  } catch (e) {
    return { text: `I could not answer (${clip((e as Error).message.split('\n')[0]!, 140)}).` };
  }
}

/** Carry out a picked option. Returns one line saying what happened. Throws with a readable reason. */
export async function perform(engine: Engine, runId: string, a: RunAction, bindings?: Bindings): Promise<string> {
  void bindings;
  const live = engine.isLive(runId);
  switch (a.type) {
    case 'retry':
      if (live) throw new Error('the run is still going');
      await engine.resume(runId, { retryFailed: true });
      return 'retrying the failed step; everything already done is kept';
    case 'resume':
      if (live) throw new Error('the run is already going');
      await engine.resume(runId);
      return 'resumed where it left off';
    case 'escalate':
      if (live) throw new Error('stop the run before changing a step');
      engine.amend(runId, a.node, { agent: a.agent, model: a.model }, 'chosen in chat');
      await engine.resume(runId, { retryFailed: true });
      return `${a.node} now runs on ${a.agent}${a.model ? ' · ' + a.model : ''}; retrying`;
    case 'guide':
      if (live) throw new Error('stop the run before changing a step');
      engine.amend(runId, a.node, { guidance: a.guidance }, 'chosen in chat');
      await engine.resume(runId, { retryFailed: true });
      return `guidance added to ${a.node}; retrying`;
    case 'stop':
      return engine.stop(runId) ? 'stopping…' : 'the run is not live in this window';
    case 'command':
      throw new Error('commands go through the permission prompt');
    case 'manual':
    case 'open':
      return a.type === 'manual' ? 'noted: do that, then ask me to retry' : 'opened';
  }
}
